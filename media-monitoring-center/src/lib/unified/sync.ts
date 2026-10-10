import "server-only";
import { z } from "zod";
import { validUnifiedUrl } from "@/lib/integrations/unified-api";
import { addDays, diffDays } from "@/lib/time/tz";
import { accountSchema, campaignSchema, mappingSchema, performanceSchema, UnifiedDataError, type UnifiedMapping } from "./schema";
import { UnifiedSnapshotStore } from "./store";
import { dailyAligned, sameReportDay } from "./source";
import { fetchGoogleDomainConfig } from "@/lib/domains/api";
import { domainMetadata } from "@/lib/domains/config";
import { createHash } from "node:crypto";
import { responseDiagnostic } from "./diagnostic";

const errors = z.array(z.object({ provider: z.string().optional(), error: z.object({ code: z.string(), details: z.object({ limitation: z.string().optional(), account_id: z.string().optional(), provider: z.string().optional(), partial_data: z.boolean().optional(), unsupported_metrics: z.array(z.string()).optional() }).optional() }) })).default([]);
export interface UnifiedSyncOptions {
  mapping: UnifiedMapping; store: UnifiedSnapshotStore; url: string; apiKey: string;
  from: string; to: string; granularities: Array<"daily" | "hourly">;
  timeoutMs?: number; maxRows?: number; request?: typeof fetch; clock?: () => Date; timezone?: string;
}

/** Bounded, explicit scopes. No OAuth bodies, raw metrics or provider error messages are stored. */
export async function syncUnified(options: UnifiedSyncOptions) {
  const mapping = mappingSchema.safeParse(options.mapping);
  if (!mapping.success) throw new UnifiedDataError("INVALID_ACCOUNT_MAPPING");
  const from = z.iso.date().safeParse(options.from), to = z.iso.date().safeParse(options.to);
  if (!from.success || !to.success || diffDays(options.to, options.from) < 0 || diffDays(options.to, options.from) > 44 || !z.array(z.enum(["daily", "hourly"])).min(1).max(2).safeParse(options.granularities).success || new Set(options.granularities).size !== options.granularities.length)
    throw new UnifiedDataError("INVALID_SYNC_RANGE");
  const base = validUnifiedUrl(options.url);
  if (!base || !options.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  const request = options.request ?? fetch, clock = options.clock ?? (() => new Date());
  const unlock = await options.store.lock();
  const result: Array<{ platform: string; accountId: string; granularity: string; status: string; rows: number; code: string | null; diagnostic?: string }> = [];
  const diagnosticOf = (error: unknown) => (error instanceof UnifiedDataError && error.diagnostic ? { diagnostic: error.diagnostic } : {});
  const call = async <T extends z.ZodType>(route: string, query: Record<string, string>, schema: T, selectedAccountId?: string): Promise<z.infer<T>[]> => {
    const url = new URL(`/api/v1/${route}`, base); url.search = new URLSearchParams(query).toString();
    let response: Response;
    try { response = await request(url, { headers: { "X-API-Key": options.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 120000), redirect: "error", cache: "no-store" }); }
    catch { throw new UnifiedDataError("API_TRANSPORT_ERROR"); }
    // The status alone hides the cause (every PROVIDER_ERROR is 502): keep only an allowlisted diagnosis.
    if (!response.ok) throw new UnifiedDataError(response.status === 401 ? "API_AUTH_ERROR" : response.status === 429 ? "API_RATE_LIMITED" : response.status === 403 ? "API_ACCESS_DENIED" : "API_RESPONSE_ERROR", (await responseDiagnostic(response)) ?? undefined);
    if (!response.body) throw new UnifiedDataError("INVALID_API_RESPONSE");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 25 * 1024 * 1024) throw new UnifiedDataError("RESPONSE_LIMIT"); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    let body: unknown;
    try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new UnifiedDataError("INVALID_API_RESPONSE"); }
    const parsed = z.object({ data: z.array(schema).max(options.maxRows ?? 100000), errors }).safeParse(body);
    if (!parsed.success) throw new UnifiedDataError("INVALID_API_RESPONSE");
    const selectedPresent = selectedAccountId && parsed.data.data.some(row => (row as { account_id?: string; platform?: string }).account_id === selectedAccountId && (row as { platform?: string }).platform === query.provider);
    if (parsed.data.errors.some(({ provider, error }) => {
      const d = error.details;
      if ((provider !== undefined && provider !== query.provider) || (d?.provider !== undefined && d.provider !== query.provider)) return true;
      if (route === "accounts" && selectedPresent && error.code === "ACCESS_DENIED" && d?.account_id && d.account_id !== selectedAccountId) return false;
      if (d?.account_id !== undefined && d.account_id !== query.account_id) return true;
      if (route === "performance" && query.provider === "x" && error.code === "INVALID_REQUEST" && d?.provider === "x" && d.account_id === query.account_id && d.limitation === "primary_conversion_not_selected") return false;
      // The adapter imports only spend/impressions/clicks; Meta's explicit limitation
      // concerns other metrics. Any warning touching imported metrics still fails closed.
      if (route === "performance" && query.provider === "meta" && query.granularity === "hourly" && error.code === "PROVIDER_ERROR" && d?.provider === "meta" && d.limitation === "hourly_breakdown" && d.partial_data === true && d.unsupported_metrics?.length && d.unsupported_metrics.every(m => ["reach", "frequency", "offsite_conversions"].includes(m))) return false;
      if (route === "performance" && query.provider === "spotify" && error.code === "PROVIDER_ERROR" && d?.provider === "spotify" && d.account_id === query.account_id && ["revenue_unavailable", "privacy_suppressed_conversions", "primary_conversion_not_configured", "revenue_not_split_by_event"].includes(d.limitation ?? "")) return false;
      return true;
    })) throw new UnifiedDataError("PARTIAL_API_RESPONSE");
    return parsed.data.data;
  };
  try {
    // An invalid cache blocks classification, not repair through the validated API contract.
    let domains = await options.store.domainConfig().catch(() => null);
    let domainFingerprint = domains ? createHash("sha256").update(JSON.stringify(domains)).digest("hex") : undefined;
    if (mapping.data.accounts.some(scope => scope.platform === "google" && scope.brand === "izzi")) {
      try {
        const next = await fetchGoogleDomainConfig({ base, apiKey: options.apiKey, request, timeoutMs: options.timeoutMs });
        domainFingerprint = await options.store.saveDomainConfig(next, clock().toISOString());
        domains = next;
      } catch { /* Existing validated configuration remains usable offline; no invented map. */ }
    }
    for (const scope of mapping.data.accounts) {
      const at = clock().toISOString();
      try {
        // Unmapped manager accounts may have no currency/timezone. Validate only the selected account.
        const accounts = await call("accounts", { provider: scope.platform }, z.object({ platform: z.string(), account_id: z.string() }).passthrough(), scope.accountId);
        const selected = accounts.filter(a => a.account_id === scope.accountId && a.platform === scope.platform);
        if (selected.length !== 1) throw new UnifiedDataError("ACCOUNT_NOT_ACCESSIBLE");
        const parsedAccount = accountSchema.safeParse(selected[0]);
        if (!parsedAccount.success) throw new UnifiedDataError("INVALID_ACCOUNT_METADATA");
        const account = parsedAccount.data;
        if (!account || account.is_manager) throw new UnifiedDataError("ACCOUNT_NOT_ACCESSIBLE");
        if (account.currency !== scope.currency) throw new UnifiedDataError("ACCOUNT_CURRENCY_MISMATCH");
        const meta = domainMetadata(domains, scope.platform, scope.accountId, account.account_name, scope.brand);
        const fingerprint = domainFingerprint ? { domain_config_fingerprint: domainFingerprint } : {};
        const campaigns = (await call("campaigns", { provider: scope.platform, account_id: scope.accountId }, campaignSchema)).map(campaign => ({ ...campaign, ...meta, ...fingerprint }));
        if (campaigns.some(c => c.account_id !== scope.accountId || c.platform !== scope.platform) || new Set(campaigns.map(c => c.campaign_id)).size !== campaigns.length) throw new UnifiedDataError("INVALID_CAMPAIGN_SCOPE");
        await options.store.saveCatalog({ version: 1, scope, account: { ...account, ...meta, account_name: account.account_name, ...fingerprint }, campaigns, extractedAt: at });
      } catch (error) {
        const code = error instanceof UnifiedDataError ? error.code : "CATALOG_READ_FAILED";
        for (const granularity of options.granularities) {
          await options.store.saveAttempt(scope, granularity, { at, status: "FAILED", code, rows: 0, ...diagnosticOf(error) });
          result.push({ ...scope, granularity, status: "FAILED", rows: 0, code, ...diagnosticOf(error) });
        }
        continue;
      }
      const catalog = (await options.store.catalog(scope))!;
      const known = new Set(catalog.campaigns.map(c => c.campaign_id));
      for (const granularity of options.granularities) {
        let count = 0;
        // An account in another report clock (e.g. America/Chicago with daylight saving time) has no Mexican
        // daily totals at the provider: its days are rebuilt from its hourly rows, so no daily request is made.
        if (granularity === "daily" && !sameReportDay(catalog.account.timezone, options.timezone ?? "America/Mexico_City", Number(options.from.slice(0, 4)))) {
          await options.store.saveAttempt(scope, granularity, { at: clock().toISOString(), status: "SUCCESS", code: "DAILY_FROM_HOURLY", rows: 0 });
          result.push({ ...scope, granularity, status: "SUCCESS", rows: 0, code: "DAILY_FROM_HOURLY" });
          continue;
        }
        try {
          // Small windows let each successful block be checkpointed without erasing older days.
          for (let start = options.from; start <= options.to; start = addDays(start, 3)) {
            const end = [addDays(start, 2), options.to].sort()[0];
            const rows = (await call("performance", { provider: scope.platform, account_id: scope.accountId, date_from: start, date_to: end, granularity }, performanceSchema)).map(row => ({ ...row, ...domainMetadata(domains, scope.platform, scope.accountId, catalog.account.account_name, scope.brand), ...(domainFingerprint ? { domain_config_fingerprint: domainFingerprint } : {}) }));
            const keys = new Set<string>();
            for (const row of rows) {
              const key = `${row.date}/${row.hour}/${row.campaign_id}`;
              // Name the failed check (fixed tokens only) so a rejected load can be diagnosed without data.
              const scopeFailure = row.platform !== scope.platform || row.account_id !== scope.accountId ? "foreign_account"
                : !known.has(row.campaign_id) ? "campaign_not_in_catalog"
                : row.date < start || row.date > end ? "date_out_of_range"
                : (granularity === "daily") !== (row.hour === null) ? "granularity_mismatch"
                : row.currency !== catalog.account.currency ? "currency_mismatch"
                : keys.has(key) ? "duplicate_row"
                : Date.parse(row.extracted_at) > clock().getTime() + 300000 ? "future_extraction" : null;
              if (scopeFailure) throw new UnifiedDataError("INVALID_PERFORMANCE_SCOPE", `scope=${scopeFailure}`);
              keys.add(key);
              if (granularity === "daily" && !dailyAligned(row, options.timezone ?? "America/Mexico_City")) throw new UnifiedDataError("DAILY_TIMEZONE_MISMATCH");
            }
            for (let date = start; date <= end; date = addDays(date, 1)) {
              await options.store.savePartition({ version: 1, scope, date, granularity, extractedAt: clock().toISOString(), rows: rows.filter(r => r.date === date) });
            }
            count += rows.length;
          }
          await options.store.saveAttempt(scope, granularity, { at: clock().toISOString(), status: "SUCCESS", code: null, rows: count });
          result.push({ ...scope, granularity, status: "SUCCESS", rows: count, code: null });
        } catch (error) {
          const code = error instanceof UnifiedDataError ? error.code : "PERFORMANCE_READ_FAILED";
          await options.store.saveAttempt(scope, granularity, { at: clock().toISOString(), status: "FAILED", code, rows: count, ...diagnosticOf(error) });
          result.push({ ...scope, granularity, status: "FAILED", rows: count, code, ...diagnosticOf(error) });
        }
      }
    }
  } finally { await unlock(); }
  return result;
}
