import "server-only";
import { z } from "zod";
import { validUnifiedUrl } from "@/lib/integrations/unified-api";
import { addDays, diffDays } from "@/lib/time/tz";
import { accountSchema, campaignSchema, mappingSchema, performanceSchema, UnifiedDataError, type UnifiedMapping } from "./schema";
import { UnifiedSnapshotStore } from "./store";
import { dailyAligned } from "./source";

const errors = z.array(z.object({ error: z.object({ code: z.string(), details: z.object({ limitation: z.string().optional() }).optional() }) })).default([]);
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
  if (!from.success || !to.success || diffDays(options.to, options.from) < 0 || diffDays(options.to, options.from) > 44 || !options.granularities.length || new Set(options.granularities).size !== options.granularities.length)
    throw new UnifiedDataError("INVALID_SYNC_RANGE");
  const base = validUnifiedUrl(options.url);
  if (!base || !options.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  const request = options.request ?? fetch, clock = options.clock ?? (() => new Date());
  const unlock = await options.store.lock();
  const result: Array<{ platform: string; accountId: string; granularity: string; status: string; rows: number; code: string | null }> = [];
  const call = async <T extends z.ZodType>(route: string, query: Record<string, string>, schema: T): Promise<z.infer<T>[]> => {
    const url = new URL(`/api/v1/${route}`, base); url.search = new URLSearchParams(query).toString();
    let response: Response;
    try { response = await request(url, { headers: { "X-API-Key": options.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 120000), redirect: "error", cache: "no-store" }); }
    catch { throw new UnifiedDataError("API_TRANSPORT_ERROR"); }
    if (!response.ok) throw new UnifiedDataError(response.status === 401 ? "API_AUTH_ERROR" : response.status === 429 ? "API_RATE_LIMITED" : response.status === 403 ? "API_ACCESS_DENIED" : "API_RESPONSE_ERROR");
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
    if (parsed.data.errors.some(e => e.error.details?.limitation !== "primary_conversion_not_selected")) throw new UnifiedDataError("PARTIAL_API_RESPONSE");
    return parsed.data.data;
  };
  try {
    for (const scope of mapping.data.accounts) {
      const at = clock().toISOString();
      try {
        // Unmapped manager accounts may have no currency/timezone. Validate only the selected account.
        const accounts = await call("accounts", { provider: scope.platform }, z.object({ platform: z.string(), account_id: z.string() }).passthrough());
        const selected = accounts.filter(a => a.account_id === scope.accountId && a.platform === scope.platform);
        if (selected.length !== 1) throw new UnifiedDataError("ACCOUNT_NOT_ACCESSIBLE");
        const parsedAccount = accountSchema.safeParse(selected[0]);
        if (!parsedAccount.success) throw new UnifiedDataError("INVALID_ACCOUNT_METADATA");
        const account = parsedAccount.data;
        if (!account || account.is_manager) throw new UnifiedDataError("ACCOUNT_NOT_ACCESSIBLE");
        if (account.currency !== scope.currency) throw new UnifiedDataError("ACCOUNT_CURRENCY_MISMATCH");
        const campaigns = await call("campaigns", { provider: scope.platform, account_id: scope.accountId }, campaignSchema);
        if (campaigns.some(c => c.account_id !== scope.accountId || c.platform !== scope.platform) || new Set(campaigns.map(c => c.campaign_id)).size !== campaigns.length) throw new UnifiedDataError("INVALID_CAMPAIGN_SCOPE");
        await options.store.saveCatalog({ version: 1, scope, account, campaigns, extractedAt: at });
      } catch (error) {
        const code = error instanceof UnifiedDataError ? error.code : "CATALOG_READ_FAILED";
        for (const granularity of options.granularities) {
          await options.store.saveAttempt(scope, granularity, { at, status: "FAILED", code, rows: 0 });
          result.push({ ...scope, granularity, status: "FAILED", rows: 0, code });
        }
        continue;
      }
      const catalog = (await options.store.catalog(scope))!;
      const known = new Set(catalog.campaigns.map(c => c.campaign_id));
      for (const granularity of options.granularities) {
        let count = 0;
        try {
          // Small windows let each successful block be checkpointed without erasing older days.
          for (let start = options.from; start <= options.to; start = addDays(start, 3)) {
            const end = [addDays(start, 2), options.to].sort()[0];
            const rows = await call("performance", { provider: scope.platform, account_id: scope.accountId, date_from: start, date_to: end, granularity }, performanceSchema);
            const keys = new Set<string>();
            for (const row of rows) {
              const key = `${row.date}/${row.hour}/${row.campaign_id}`;
              if (row.platform !== scope.platform || row.account_id !== scope.accountId || !known.has(row.campaign_id) || row.date < start || row.date > end || (granularity === "daily") !== (row.hour === null) || row.currency !== catalog.account.currency || keys.has(key) || Date.parse(row.extracted_at) > clock().getTime() + 300000) throw new UnifiedDataError("INVALID_PERFORMANCE_SCOPE");
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
          await options.store.saveAttempt(scope, granularity, { at: clock().toISOString(), status: "FAILED", code, rows: count });
          result.push({ ...scope, granularity, status: "FAILED", rows: count, code });
        }
      }
    }
  } finally { await unlock(); }
  return result;
}
