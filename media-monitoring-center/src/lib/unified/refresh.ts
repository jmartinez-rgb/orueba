import "server-only";
import { z } from "zod";
import { addDays, businessDate, diffDays } from "@/lib/time/tz";
import type { RecordStore } from "@/lib/records/store";
import { mappingSchema, UnifiedDataError, type UnifiedScope } from "./schema";
import { syncUnified, type UnifiedSyncOptions } from "./sync";

const MIN_INTERVAL = 30 * 60_000;
const MAX_INTERVAL = 24 * 60 * 60_000;
const codes = ["IN_PROGRESS", "API_RATE_LIMITED", "API_AUTH_ERROR", "API_ACCESS_DENIED", "API_RESPONSE_ERROR", "API_TRANSPORT_ERROR", "PARTIAL_API_RESPONSE", "SYNC_LOCKED", "REFRESH_FAILED"] as const;
const stateSchema = z.object({ version: z.literal(1), startedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(), nextDueAt: z.iso.datetime(), failures: z.number().int().min(0).max(10), code: z.enum(codes).nullable() }).strict();
const historyStateSchema = z.object({ version: z.literal(1), retryAt: z.iso.datetime() }).strict();
/** After a failed history completion, the older days wait this long; the regular round is unaffected. */
const HISTORY_RETRY_MS = 12 * 60 * 60_000;
/** Days the monitor compares against: four same weekdays ±1, the sustained-change window and the month. */
export const DEFAULT_HISTORY_DAYS = 35;
export type RefreshResult = { platform: string; accountId: string; status: "SUCCESS" | "EMPTY" | "PARTIAL" | "FAILED" | "WAITING"; rows: number; code: string | null; nextDueAt: string; history?: { rows: number; missingDays: number } };
export type RefreshOptions = Omit<UnifiedSyncOptions, "from" | "to" | "granularities"> & {
  intervalMs?: number; signal?: AbortSignal; historyDays?: number;
  /**
   * First round after a (re)start, e.g. a republish with corrected credentials: a failed account is retried
   * now instead of waiting its backoff (up to 24 h). Never after a rate limit, and at most every 30 minutes.
   */
  retryFailures?: boolean;
};

/** Missing days in [from, to] as contiguous ranges, newest first. */
function missingRanges(stored: Set<string>, from: string, to: string): Array<{ from: string; to: string }> {
  const ranges: Array<{ from: string; to: string }> = [];
  for (let date = to; date >= from; date = addDays(date, -1)) {
    if (stored.has(date)) continue;
    const last = ranges.at(-1);
    if (last && last.from === addDays(date, 1)) last.from = date;
    else ranges.push({ from: date, to: date });
  }
  return ranges;
}
const daysIn = (ranges: Array<{ from: string; to: string }>) => ranges.reduce((total, range) => total + diffDays(range.to, range.from) + 1, 0);

/**
 * The regular round reads only today and the two previous days. A new database, or a gap after downtime,
 * would otherwise never get the same-weekday history that the comparison and the hourly curve need. The
 * missing older days are completed newest first, only for granularities whose regular round just worked;
 * stored days (empty ones included) are never requested again. A failure pauses only this completion.
 */
async function completeHistory(o: {
  store: RefreshOptions["store"]; records: RecordStore; key: string; scope: UnifiedScope; from: string; to: string; working: Set<string>; derived?: Set<string>;
  sync: (from: string, to: string, granularities: Array<"daily" | "hourly">) => Promise<Array<{ status: string; rows: number }>>;
  clock: () => Date; signal?: AbortSignal; ignorePause?: boolean;
}): Promise<NonNullable<RefreshResult["history"]>> {
  const saved = historyStateSchema.safeParse(await o.records.get(o.key));
  const paused = !o.ignorePause && saved.success && Date.parse(saved.data.retryAt) > o.clock().getTime();
  let rows = 0, missingDays = 0, failed = false;
  for (const granularity of ["daily", "hourly"] as const) {
    if (o.derived?.has(granularity)) continue;
    let ranges = missingRanges(await o.store.partitionDates(o.scope, granularity), o.from, o.to);
    if (ranges.length && !paused && !failed && o.working.has(granularity)) {
      for (const range of ranges) {
        if (o.signal?.aborted) break;
        const operations = await o.sync(range.from, range.to, [granularity]).catch(() => null);
        rows += operations?.reduce((total, operation) => total + operation.rows, 0) ?? 0;
        if (!operations || operations.some(operation => operation.status !== "SUCCESS")) { failed = true; break; }
      }
      ranges = missingRanges(await o.store.partitionDates(o.scope, granularity), o.from, o.to);
    }
    missingDays = Math.max(missingDays, daysIn(ranges));
  }
  if (failed) await o.records.set(o.key, { version: 1, retryAt: new Date(o.clock().getTime() + HISTORY_RETRY_MS).toISOString() });
  return { rows, missingDays };
}

/** One bounded round. A persisted cooldown survives restart; never bypass provider quotas. */
export async function refreshUnified(options: RefreshOptions): Promise<RefreshResult[]> {
  const mapping = mappingSchema.safeParse(options.mapping);
  const interval = options.intervalMs ?? 120 * 60_000;
  const historyDays = options.historyDays ?? 0;
  if (!mapping.success || !Number.isInteger(interval) || interval < MIN_INTERVAL || interval > MAX_INTERVAL || !Number.isInteger(historyDays) || historyDays < 0 || historyDays > 44) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  const clock = options.clock ?? (() => new Date());
  const release = await options.store.schedulerLock();
  const records = options.store.schedulerRecords();
  const results: RefreshResult[] = [];
  // History is completed after every account has today's reading, so it never delays fresh data.
  const pendingHistory: Array<{ result: RefreshResult; run: () => Promise<RefreshResult["history"]> }> = [];
  try {
    for (const scope of mapping.data.accounts) {
      if (options.signal?.aborted) break;
      const key = `${scope.platform}/${scope.accountId}/${scope.brand}/${scope.currency}`;
      const raw = await records.get(key);
      const parsed = raw === null ? null : stateSchema.safeParse(raw);
      if (parsed && !parsed.success) throw new UnifiedDataError("INVALID_REFRESH_STATE");
      const previous = parsed?.data;
      const at = clock();
      const retryNow = !!options.retryFailures && !!previous?.completedAt && previous.code !== null && previous.code !== "API_RATE_LIMITED" && previous.code !== "IN_PROGRESS" && at.getTime() - Date.parse(previous.completedAt) >= MIN_INTERVAL;
      if (previous && Date.parse(previous.nextDueAt) > at.getTime() && !retryNow) {
        results.push({ platform: scope.platform, accountId: scope.accountId, status: "WAITING", rows: 0, code: previous.code, nextDueAt: previous.nextDueAt });
        continue;
      }
      // Save before network access: a killed process cannot restart a quota-intensive round immediately.
      await records.set(key, { version: 1, startedAt: at.toISOString(), completedAt: null, nextDueAt: new Date(at.getTime() + interval).toISOString(), failures: previous?.failures ?? 0, code: "IN_PROGRESS" });
      let status: RefreshResult["status"] = "FAILED", rows = 0, code: typeof codes[number] | null = null;
      let history: (() => Promise<RefreshResult["history"]>) | null = null;
      const sync = (from: string, to: string, granularities: Array<"daily" | "hourly">) => syncUnified({ ...options, mapping: { version: 1, accounts: [scope] }, from, to, granularities, ...(options.signal ? { request: (input, init) => (options.request ?? fetch)(input, { ...init, signal: AbortSignal.any([options.signal!, ...(init?.signal ? [init.signal] : [])]) }) } : {}) });
      try {
        const today = businessDate(at, options.timezone ?? "America/Mexico_City");
        const operations = await sync(addDays(today, -2), today, ["daily", "hourly"]);
        rows = operations.reduce((total, operation) => total + operation.rows, 0);
        const failed = operations.filter(operation => operation.status !== "SUCCESS");
        status = !failed.length ? (rows > 0 ? "SUCCESS" : "EMPTY") : failed.length < operations.length ? "PARTIAL" : "FAILED";
        const failureCode = failed.find(operation => operation.code === "API_RATE_LIMITED")?.code ?? failed[0]?.code;
        if (failed.length) code = codes.includes(failureCode as typeof codes[number]) ? failureCode as typeof codes[number] : "REFRESH_FAILED";
        if (historyDays > 3) {
          const working = new Set(operations.filter(operation => operation.status === "SUCCESS" && operation.code !== "DAILY_FROM_HOURLY").map(operation => operation.granularity));
          // Days rebuilt from hours have no daily partitions to complete or count.
          const derived = new Set(operations.filter(operation => operation.code === "DAILY_FROM_HOURLY").map(operation => operation.granularity));
          // Its own failures never change the regular status or its cooldown.
          history = () => completeHistory({ store: options.store, records, key: `history/${key}`, scope, from: addDays(today, -historyDays), to: addDays(today, -3), working, derived, sync, clock, signal: options.signal, ignorePause: retryNow }).catch(() => undefined);
        }
      } catch (error) {
        code = error instanceof UnifiedDataError && codes.includes(error.code as typeof codes[number]) ? error.code as typeof codes[number] : "REFRESH_FAILED";
      }
      const completed = clock();
      const failures = code ? Math.min((previous?.failures ?? 0) + 1, 10) : 0;
      const cooldown = code ? Math.min(interval * 2 ** failures, MAX_INTERVAL) : interval;
      const nextDueAt = new Date(completed.getTime() + cooldown).toISOString();
      await records.set(key, { version: 1, startedAt: at.toISOString(), completedAt: completed.toISOString(), nextDueAt, failures, code });
      const result: RefreshResult = { platform: scope.platform, accountId: scope.accountId, status, rows, code, nextDueAt };
      results.push(result);
      if (history) pendingHistory.push({ result, run: history });
    }
    for (const pending of pendingHistory) {
      if (options.signal?.aborted) break;
      const history = await pending.run();
      if (history) pending.result.history = history;
    }
  } finally { await release(); }
  return results;
}
