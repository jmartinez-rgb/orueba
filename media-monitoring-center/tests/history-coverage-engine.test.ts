import { describe, expect, it } from "vitest";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { emptyMetrics } from "@/lib/metrics";
import type { HistoryCoverage, MonitoringDataSource } from "@/lib/data/source";
import type { HourlyRow } from "@/lib/types";

/**
 * A history still being loaded (initial load in a new database) must not compare today's spend of every
 * account against the history of only some of them: that produced a false +675 % platform alert.
 */
const asOf = new Date("2026-10-08T18:30:00Z"); // 12:30 in Mexico City: cutoff 12:00
const today = "2026-10-08", refs = ["2026-10-01", "2026-09-24", "2026-09-17", "2026-09-10"];
const accounts = [
  { id: "google:a", name: "A", platform: "google" as const, currency: "MXN" as const, brand: "izzi" as const },
  { id: "google:b", name: "B", platform: "google" as const, currency: "MXN" as const, brand: "izzi" as const },
];
const campaigns = accounts.map((a) => ({ id: `${a.id}:c`, accountId: a.id, name: `Search ${a.name}`, platform: "google" as const, status: "ACTIVE" as const, objective: "TRAFFIC" as const, conversionEvent: null }));
const hours = (accountId: string, date: string, upTo: number, spend: number): HourlyRow[] =>
  Array.from({ length: upTo }, (_, hour) => ({ date, hour, platform: "google", accountId, campaignId: `${accountId}:c`, metrics: { ...emptyMetrics(), spend, impressions: 10, clicks: 1 } }));

function source(coverage?: HistoryCoverage): MonitoringDataSource {
  return {
    kind: "unified",
    now: () => asOf,
    getCatalog: async () => ({ accounts, campaigns }),
    // Today both accounts spend; history is stored only for A (B is still being loaded).
    getHourly: async () => [...hours("google:a", today, 12, 10), ...hours("google:b", today, 12, 90), ...refs.flatMap((d) => hours("google:a", d, 24, 10))],
    getDaily: async () => [],
    getFreshness: async () => [null, ...accounts.map((a) => a.id)].map((accountId) => ({ platform: "google", accountId, lastDataAt: "2026-10-08T18:00:00Z", lastSyncAt: "2026-10-08T18:05:00Z", lastSyncStatus: "SUCCESS", lastError: null })),
    getBudgets: async () => [], getSyncLog: async () => [], getDataQuality: async () => [], getExecutionControl: async () => [], getFxRates: async () => [],
    ...(coverage ? { historyCoverage: async () => coverage } : {}),
  };
}
const settings = { ...DEFAULT_SETTINGS, monitoredPlatforms: ["google" as const] };
const platform = (run: Awaited<ReturnType<typeof runMonitoring>>) => run.entities.find((e) => e.key === "platform:google")!;
const account = (run: Awaited<ReturnType<typeof runMonitoring>>, id: string) => run.entities.find((e) => e.level === "account" && e.accountId === id)!;

describe("history coverage at platform level", () => {
  it("without coverage information the old comparison mixes complete today with partial history", async () => {
    const run = await runMonitoring(source(), { settings, asOf });
    expect(platform(run).cumulative.spend?.current).toBe(1200);
    expect(platform(run).cumulative.spend?.expected).toBe(120);
  });

  it("a reference day missing for an active account is unknown: no platform expectation, accounts keep theirs", async () => {
    const coverage: HistoryCoverage = { daily: new Map(), hourly: new Map([["google:a", new Set(refs)], ["google:b", new Set()]]) };
    const run = await runMonitoring(source(coverage), { settings, asOf });
    expect(platform(run).cumulative.spend?.current).toBe(1200);
    expect(platform(run).cumulative.spend?.expected ?? null).toBeNull();
    expect(platform(run).cumulative.spend?.deltaVsExpected ?? null).toBeNull();
    expect(account(run, "google:a").cumulative.spend?.expected).toBe(120);
    expect(account(run, "google:b").cumulative.spend?.expected ?? null).toBeNull();
  });

  it("once every active account has the day stored, the platform compares normally", async () => {
    const coverage: HistoryCoverage = { daily: new Map(), hourly: new Map([["google:a", new Set(refs)], ["google:b", new Set(refs)]]) };
    const run = await runMonitoring(source(coverage), { settings, asOf });
    // B truly spent nothing those days (stored, empty): it is a real zero, not unknown.
    expect(platform(run).cumulative.spend?.expected).toBe(120);
  });
});
