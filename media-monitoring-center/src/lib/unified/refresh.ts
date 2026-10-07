import "server-only";
import { z } from "zod";
import { addDays, businessDate } from "@/lib/time/tz";
import { mappingSchema, UnifiedDataError } from "./schema";
import { syncUnified, type UnifiedSyncOptions } from "./sync";

const MIN_INTERVAL = 30 * 60_000;
const MAX_INTERVAL = 24 * 60 * 60_000;
const codes = ["IN_PROGRESS", "API_RATE_LIMITED", "API_AUTH_ERROR", "API_ACCESS_DENIED", "API_RESPONSE_ERROR", "API_TRANSPORT_ERROR", "PARTIAL_API_RESPONSE", "SYNC_LOCKED", "REFRESH_FAILED"] as const;
const stateSchema = z.object({ version: z.literal(1), startedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(), nextDueAt: z.iso.datetime(), failures: z.number().int().min(0).max(10), code: z.enum(codes).nullable() }).strict();
export type RefreshResult = { platform: string; accountId: string; status: "SUCCESS" | "EMPTY" | "PARTIAL" | "FAILED" | "WAITING"; rows: number; code: string | null; nextDueAt: string };
export type RefreshOptions = Omit<UnifiedSyncOptions, "from" | "to" | "granularities"> & { intervalMs?: number; signal?: AbortSignal };

/** One bounded round. A persisted cooldown survives restart; never bypass provider quotas. */
export async function refreshUnified(options: RefreshOptions): Promise<RefreshResult[]> {
  const mapping = mappingSchema.safeParse(options.mapping);
  const interval = options.intervalMs ?? 120 * 60_000;
  if (!mapping.success || !Number.isInteger(interval) || interval < MIN_INTERVAL || interval > MAX_INTERVAL) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  const clock = options.clock ?? (() => new Date());
  const release = await options.store.schedulerLock();
  const records = options.store.schedulerRecords();
  const results: RefreshResult[] = [];
  try {
    for (const scope of mapping.data.accounts) {
      if (options.signal?.aborted) break;
      const key = `${scope.platform}/${scope.accountId}/${scope.brand}/${scope.currency}`;
      const raw = await records.get(key);
      const parsed = raw === null ? null : stateSchema.safeParse(raw);
      if (parsed && !parsed.success) throw new UnifiedDataError("INVALID_REFRESH_STATE");
      const previous = parsed?.data;
      const at = clock();
      if (previous && Date.parse(previous.nextDueAt) > at.getTime()) {
        results.push({ platform: scope.platform, accountId: scope.accountId, status: "WAITING", rows: 0, code: previous.code, nextDueAt: previous.nextDueAt });
        continue;
      }
      // Save before network access: a killed process cannot restart a quota-intensive round immediately.
      await records.set(key, { version: 1, startedAt: at.toISOString(), completedAt: null, nextDueAt: new Date(at.getTime() + interval).toISOString(), failures: previous?.failures ?? 0, code: "IN_PROGRESS" });
      let status: RefreshResult["status"] = "FAILED", rows = 0, code: typeof codes[number] | null = null;
      try {
        const today = businessDate(at, options.timezone ?? "America/Mexico_City");
        const operations = await syncUnified({ ...options, mapping: { version: 1, accounts: [scope] }, from: addDays(today, -2), to: today, granularities: ["daily", "hourly"], ...(options.signal ? { request: (input, init) => (options.request ?? fetch)(input, { ...init, signal: AbortSignal.any([options.signal!, ...(init?.signal ? [init.signal] : [])]) }) } : {}) });
        rows = operations.reduce((total, operation) => total + operation.rows, 0);
        const failed = operations.filter(operation => operation.status !== "SUCCESS");
        status = !failed.length ? (rows > 0 ? "SUCCESS" : "EMPTY") : failed.length < operations.length ? "PARTIAL" : "FAILED";
        const failureCode = failed.find(operation => operation.code === "API_RATE_LIMITED")?.code ?? failed[0]?.code;
        if (failed.length) code = codes.includes(failureCode as typeof codes[number]) ? failureCode as typeof codes[number] : "REFRESH_FAILED";
      } catch (error) {
        code = error instanceof UnifiedDataError && codes.includes(error.code as typeof codes[number]) ? error.code as typeof codes[number] : "REFRESH_FAILED";
      }
      const completed = clock();
      const failures = code ? Math.min((previous?.failures ?? 0) + 1, 10) : 0;
      const cooldown = code ? Math.min(interval * 2 ** failures, MAX_INTERVAL) : interval;
      const nextDueAt = new Date(completed.getTime() + cooldown).toISOString();
      await records.set(key, { version: 1, startedAt: at.toISOString(), completedAt: completed.toISOString(), nextDueAt, failures, code });
      results.push({ platform: scope.platform, accountId: scope.accountId, status, rows, code, nextDueAt });
    }
  } finally { await release(); }
  return results;
}
