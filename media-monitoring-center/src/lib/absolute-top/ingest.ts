import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fetchGoogleDomainConfig } from "@/lib/domains/api";
import { validUnifiedUrl } from "@/lib/integrations/unified-api";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { diffDays } from "@/lib/time/tz";
import { AbsoluteTopStore } from "./store";
import { absoluteTopAuditSchema, absoluteTopRowSchema } from "./schema";
import { AbsoluteTopError, type AbsoluteTopAudit } from "./types";

export interface AbsoluteTopSyncOptions {
  url: string; apiKey: string; from: string; to: string; granularity: "daily" | "hourly";
  store?: AbsoluteTopStore; cache?: UnifiedSnapshotStore; request?: typeof fetch; clock?: () => Date;
  timeoutMs?: number; dryRun?: boolean;
}
const responseSchema = z.object({ data: z.array(absoluteTopRowSchema).max(100000), errors: z.array(z.unknown()).default([]) });

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AbsoluteTopError("INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 25 * 1024 * 1024) throw new AbsoluteTopError("RESPONSE_LIMIT"); chunks.push(chunk.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AbsoluteTopError("INVALID_RESPONSE"); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Explicit extraction, one bounded account at a time. It never reconciles or sends notifications. */
export async function syncAbsoluteTop(options: AbsoluteTopSyncOptions) {
  if (!z.iso.date().safeParse(options.from).success || !z.iso.date().safeParse(options.to).success || diffDays(options.to, options.from) < 0 || diffDays(options.to, options.from) > 6 || !["daily", "hourly"].includes(options.granularity)) throw new AbsoluteTopError("INVALID_RANGE");
  const base = validUnifiedUrl(options.url);
  if (!base || !options.apiKey) throw new AbsoluteTopError("API_CONFIGURATION_MISSING");
  const request = options.request ?? fetch, clock = options.clock ?? (() => new Date()), store = options.store ?? new AbsoluteTopStore();
  let config;
  try { config = await fetchGoogleDomainConfig({ base, apiKey: options.apiKey, request, timeoutMs: options.timeoutMs }); }
  catch { throw new AbsoluteTopError("DOMAIN_CONFIGURATION_UNAVAILABLE"); }
  if (!options.dryRun) await options.cache?.saveDomainConfig(config, clock().toISOString());
  const results: Array<{ customerId: string; status: "SUCCESS" | "FAILED"; rows: number; code: string | null; markerCode?: string }> = [];
  for (const account of config.domains.flatMap(domain => domain.accounts)) {
    const observedAt = clock().toISOString(), auditId = randomUUID();
    try {
      const url = new URL("/api/v1/google/absolute-top", base);
      url.search = new URLSearchParams({ account_id: account.customerId, date_from: options.from, date_to: options.to, granularity: options.granularity }).toString();
      let response: Response;
      try { response = await request(url, { headers: { Accept: "application/json", "X-API-Key": options.apiKey }, signal: AbortSignal.timeout(options.timeoutMs ?? 120000), redirect: "error", cache: "no-store" }); }
      catch { throw new AbsoluteTopError("API_TRANSPORT_ERROR"); }
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new AbsoluteTopError(response.status === 401 ? "API_AUTH_ERROR" : response.status === 403 ? "API_ACCESS_DENIED" : response.status === 429 ? "API_RATE_LIMITED" : "API_RESPONSE_ERROR"); }
      const parsed = responseSchema.safeParse(await boundedJson(response));
      if (!parsed.success) throw new AbsoluteTopError("INVALID_RESPONSE");
      if (parsed.data.errors.length) throw new AbsoluteTopError("PARTIAL_RESPONSE");
      if (parsed.data.data.some(row => row.customer_id !== account.customerId || row.account_id.replaceAll("-", "") !== account.customerId || Date.parse(row.extracted_at) > clock().getTime() + 60000)) throw new AbsoluteTopError("INVALID_SCOPE");
      const audit: AbsoluteTopAudit = { version: 1, auditId, customerId: account.customerId, observedAt: clock().toISOString(), from: options.from, to: options.to, granularity: options.granularity, coverage: "complete", rows: parsed.data.data, warnings: [] };
      if (!absoluteTopAuditSchema.safeParse(audit).success) throw new AbsoluteTopError("INVALID_AUDIT");
      if (!options.dryRun) await store.ingest(audit, config, clock());
      results.push({ customerId: account.customerId, status: "SUCCESS", rows: parsed.data.data.length, code: null });
    } catch (error) {
      const code = error instanceof AbsoluteTopError ? error.code : "EXTRACTION_FAILED";
      // A failed audit is persisted as unknown; it must not keep an older green result current.
      // If even that marker cannot be stored, report it and continue with the next account.
      let marker: string | null = null;
      if (!options.dryRun) {
        try { await store.ingest({ version: 1, auditId, customerId: account.customerId, observedAt, from: options.from, to: options.to, granularity: options.granularity, coverage: "unavailable", rows: [], warnings: [code] }, config, clock()); }
        catch (markerError) { marker = markerError instanceof AbsoluteTopError ? markerError.code : "STORE_FAILED"; }
      }
      results.push({ customerId: account.customerId, status: "FAILED", rows: 0, code, ...(marker ? { markerCode: marker } : {}) });
    }
  }
  return results;
}
