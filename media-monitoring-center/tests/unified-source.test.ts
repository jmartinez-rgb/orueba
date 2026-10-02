import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { UnifiedDataSource } from "@/lib/unified/source";
import { syncUnified } from "@/lib/unified/sync";
import { mappingSchema, performanceSchema, type UnifiedScope } from "@/lib/unified/schema";
import { BrandScopedSource } from "@/lib/data/brand-source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { windowTotals } from "@/lib/monitoring/historical-comparator";
import { getCompare, getHistorical } from "@/lib/services/analysis";
import { getBudgetControl } from "@/lib/services/budget";
import type { AppContext } from "@/lib/services/context";
import type { Snapshot } from "@/lib/services/snapshot";
import { BRANDS } from "@/lib/brands";

const scope: UnifiedScope = { platform: "tiktok", accountId: "acct1", brand: "izzi", currency: "MXN" };
const now = new Date("2026-09-30T18:00:00Z");
const row = (patch = {}) => ({ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", date: "2026-09-29", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", spend: 40, impressions: 80, clicks: 4, conversions: 999, cpa: 0.01, extracted_at: now.toISOString(), raw_metrics: { token: "private-fixture-should-not-survive", primary_conversion_metric: "conversion" }, ...patch });
let directory: string, store: UnifiedSnapshotStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "direct-api-")); store = new UnifiedSnapshotStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const request = (rows: unknown[] = [row()], error?: unknown): typeof fetch => async input => {
  const url = new URL(String(input));
  const route = url.pathname.split("/").pop();
  const data = route === "accounts" ? [{ platform: "tiktok", account_id: "acct1", account_name: "Sky en nombre pero cuenta izzi", currency: "MXN", timezone: "America/Mexico_City" }] : route === "campaigns" ? [{ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", campaign_name: "Sky también en campaña", campaign_status: "unknown", source_status: null, objective: null }] : rows;
  return Response.json({ data, errors: route === "performance" && error ? [error] : [] });
};
const sync = (fetcher = request(), extra = {}) => syncUnified({ mapping: { version: 1, accounts: [scope] }, store, url: "https://api.example.test", apiKey: "private-internal-key", from: "2026-09-29", to: "2026-09-29", granularities: ["daily"], request: fetcher, clock: () => now, ...extra });
const source = () => new UnifiedDataSource({ store: new UnifiedSnapshotStore(directory), accounts: [scope], timezone: "America/Mexico_City", clock: () => now });

describe("durable direct advertising source", () => {
  it("an unmapped manager or foreign-currency account does not block the mapped account", async () => {
    const base = request();
    const fetcher: typeof fetch = async (input, init) => {
      const response = await base(input, init);
      if (!String(input).includes("/accounts?")) return response;
      const body = await response.json();
      body.data.push({ platform: "tiktok", account_id: "manager", currency: null, timezone: null, is_manager: true });
      body.data.push({ platform: "tiktok", account_id: "japan", currency: "JPY", timezone: "Asia/Tokyo" });
      return Response.json(body);
    };
    expect((await sync(fetcher))[0].status).toBe("SUCCESS");
  });
  it("persists across instances; strips raw payloads and preserves unknown business conversions", async () => {
    expect((await sync())[0].status).toBe("SUCCESS");
    const data = await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "campaign" });
    expect(data[0]).toMatchObject({ accountId: "tiktok:acct1", campaignId: "tiktok:acct1:camp1", metrics: { spend: 40, clicks: 4, conversions: null, purchases: null, sales: null } });
    const saved = await readFile(join(directory, "izzi/tiktok/acct1/daily/2026-09-29.json"), "utf8");
    expect(saved).not.toContain("private-fixture"); expect(saved).not.toContain("999"); expect(saved).not.toContain("private-internal-key");
  });
  it("keeps last valid partition when a provider becomes denied; exposes the failure", async () => {
    await sync();
    const denied: typeof fetch = async () => new Response(null, { status: 403 });
    expect((await sync(denied))[0]).toMatchObject({ status: "FAILED", code: "API_ACCESS_DENIED" });
    expect((await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].metrics.spend).toBe(40);
    expect((await source().getExecutionControl(now))[0].status).toBe("ERROR");
  });
  it("rejects an unexpected campaign, duplicate row and mixed currency without replacing history", async () => {
    await sync();
    for (const rows of [[row({ campaign_id: "other" })], [row(), row()], [row({ currency: "USD" })]]) {
      expect((await sync(request(rows)))[0].code).toBe("INVALID_PERFORMANCE_SCOPE");
      expect((await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "campaign" }))[0].metrics.spend).toBe(40);
    }
  });
  it("accepts missing principal action but rejects other partial responses", async () => {
    const warning = { provider: "tiktok", error: { code: "INVALID_REQUEST", details: { limitation: "primary_conversion_not_selected" } } };
    expect((await sync(request([row()], warning)))[0].status).toBe("SUCCESS");
    expect((await sync(request([row({ spend: 500 })], { provider: "tiktok", error: { code: "ACCESS_DENIED" } })))[0].code).toBe("PARTIAL_API_RESPONSE");
    expect((await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "campaign" }))[0].metrics.spend).toBe(40);
  });
  it("daily data never creates hourly data or current-day freshness", async () => {
    await sync();
    expect(await source().getHourly({ dates: ["2026-09-29"], level: "campaign" })).toEqual([]);
    expect((await source().getFreshness(now))[0]).toMatchObject({ lastDataAt: null, lastSyncStatus: "UNKNOWN" });
  });
  it("UTC daily reports cannot silently become Mexico daily totals", async () => {
    expect((await sync(request([row({ source_timezone: "UTC" })])))[0].code).toBe("DAILY_TIMEZONE_MISMATCH");
    expect(await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "campaign" })).toEqual([]);
  });
  it("converts real hourly UTC clocks and excludes open and future hours", async () => {
    await sync();
    const rows = [row({ date: "2026-09-30", hour: 0, source_timezone: "UTC" }), row({ date: "2026-09-30", hour: 17, source_timezone: "UTC", extracted_at: "2026-09-30T17:30:00Z" }), row({ date: "2026-09-30", hour: 20, source_timezone: "UTC" })].map(r => performanceSchema.parse(r));
    await store.savePartition({ version: 1, scope, date: "2026-09-30", granularity: "hourly", extractedAt: now.toISOString(), rows });
    const data = await source().getHourly({ dates: ["2026-09-29", "2026-09-30"], level: "campaign" });
    expect(data).toHaveLength(1); expect(data[0]).toMatchObject({ date: "2026-09-29", hour: 18 });
  });
  it("keeps an empty valid report distinct from zeros", async () => {
    expect((await sync(request([])))[0]).toMatchObject({ status: "SUCCESS", rows: 0 });
    expect(await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" })).toEqual([]);
    expect((await source().getExecutionControl(now))[0].status).toBe("PARCIAL");
  });
  it("explicit brand overrides misleading names in the existing brand boundary", async () => {
    await sync();
    const izzi = new BrandScopedSource(source(), "izzi"), sky = new BrandScopedSource(source(), "sky");
    expect((await izzi.getCatalog()).campaigns[0].status).toBe("UNKNOWN");
    expect((await sky.getCatalog()).accounts).toHaveLength(0);
    expect(await sky.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" })).toEqual([]);
  });
  it("rejects duplicate cross-brand mapping and overlapping sync jobs", async () => {
    expect(mappingSchema.safeParse({ version: 1, accounts: [scope, { ...scope, brand: "sky" }] }).success).toBe(false);
    const unlock = await store.lock();
    await expect(sync()).rejects.toMatchObject({ code: "SYNC_LOCKED" });
    await unlock(); expect((await sync())[0].status).toBe("SUCCESS");
  });
  it("never claims a complete additive total when one campaign's cost is unknown", async () => {
    await sync();
    const c = (await store.catalog(scope))!;
    c.campaigns.push({ ...c.campaigns[0], campaign_id: "camp2" }); await store.saveCatalog(c);
    await store.savePartition({ version: 1, scope, date: "2026-09-29", granularity: "daily", extractedAt: now.toISOString(), rows: [performanceSchema.parse(row()), performanceSchema.parse(row({ campaign_id: "camp2", spend: null }))] });
    expect((await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "account" }))[0].metrics.spend).toBeNull();
  });
  it("a missing USD exchange rate keeps the platform cost unknown instead of reporting only MXN", async () => {
    await sync();
    const usd: UnifiedScope = { ...scope, accountId: "dollars", currency: "USD" };
    const catalog = (await store.catalog(scope))!;
    await store.saveCatalog({ ...catalog, scope: usd, account: { ...catalog.account, account_id: usd.accountId, currency: "USD" }, campaigns: catalog.campaigns.map(c => ({ ...c, account_id: usd.accountId })) });
    await store.savePartition({ version: 1, scope: usd, date: "2026-09-29", granularity: "daily", extractedAt: now.toISOString(), rows: [performanceSchema.parse(row({ account_id: usd.accountId, currency: "USD", spend: 2 }))] });
    const direct = new UnifiedDataSource({ store, accounts: [scope, usd], timezone: "America/Mexico_City", clock: () => now });
    const converted = new CurrencyConvertedSource(new BrandScopedSource(direct, "izzi"), { rates: {}, accountCurrency: {} });
    expect((await converted.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].metrics).toMatchObject({ spend: null, clicks: 8 });
    const withRate = new CurrencyConvertedSource(direct, { rates: { "2026-09": 20 }, accountCurrency: {} });
    expect((await withRate.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].metrics.spend).toBe(80);
  });
  it("the monitoring engine consumes the platform freshness and leaves sparse hourly windows unknown", async () => {
    await sync();
    await store.savePartition({ version: 1, scope, date: "2026-09-30", granularity: "hourly", extractedAt: now.toISOString(), rows: [performanceSchema.parse(row({ date: "2026-09-30", hour: 11 }))] });
    await store.saveAttempt(scope, "hourly", { at: now.toISOString(), status: "SUCCESS", code: null, rows: 1 });
    const run = await runMonitoring(source(), { settings: { ...DEFAULT_SETTINGS, monitoredPlatforms: ["tiktok"] }, asOf: now });
    expect(run.dataHealth.tiktok.state).toBe("OK");
    const platform = run.entities.find(e => e.key === "platform:tiktok")!;
    expect(platform.cumulative.spend?.current).toBeNull();
    expect(platform.cumulative.conversions?.current).toBeNull();
    expect(platform.recent?.spend?.current).toBeNull();
    expect(run.dataHealth.tiktok.checks.find(c => c.id === "missing")?.status).toBe("WARN");
  });
  it("direct comparisons do not omit an unknown cost from a complete hourly window", () => {
    const known = { spend: 40, impressions: 80, clicks: 4, conversions: null, leads: null, sales: null, whatsapp: null, calls: null, purchases: null, revenue: null };
    const hours = [known, { ...known, spend: null }];
    const series = new Map([["2026-09-29", hours]]);
    expect(windowTotals(series, "2026-09-29", 0, 2, true)?.spend).toBeNull();
    expect(windowTotals(series, "2026-09-29", 0, 2, true)?.clicks).toBe(8);
  });
  it("historical and compare pages preserve missing hours, unknown events and missing exchange rates", async () => {
    await sync();
    await store.savePartition({ version: 1, scope, date: "2026-09-29", granularity: "hourly", extractedAt: now.toISOString(), rows: [performanceSchema.parse(row({ hour: 11, spend: null }))] });
    const ctx = { mode: "unified" as const, source: new CurrencyConvertedSource(source(), { rates: {}, accountCurrency: {} }), brandInfo: BRANDS.izzi, settings: DEFAULT_SETTINGS };
    const history = await getHistorical(ctx, { today: "2026-09-30", weeks: 4, cutoffHour: 12, metric: "spend" });
    expect(history.days.find(d => d.date === "2026-09-29")?.total).toBe(40);
    expect(history.heatmap[2][11]).toBeNull();
    const comparison = await getCompare(ctx, { date: "2026-09-29", cutoffHour: 12, weeksBack: [1], customDates: [], metric: "spend", dimension: "platform", platform: "all", focus: null });
    expect(comparison.total.values[0]).toBeNull();
  });
  it("monthly budget control leaves gaps and current sparse cost unknown instead of reporting zero", async () => {
    await sync();
    const settings = { ...DEFAULT_SETTINGS, monitoredPlatforms: ["tiktok" as const] };
    const src = new CurrencyConvertedSource(source(), { rates: {}, accountCurrency: {} });
    const run = await runMonitoring(src, { settings, asOf: now });
    const ctx = { mode: "unified", brand: "izzi", brandInfo: BRANDS.izzi, source: src, settings, plan: { kickoffBudgets: [], novedadBudgets: [] }, store: { async getOverrides() { return { budgets: [{ month: "2026-09", level: "account", platform: "tiktok", accountId: "tiktok:acct1", campaignId: null, amount: 2000 }] }; } } } as unknown as AppContext;
    const snap = { run, catalog: await src.getCatalog(), meta: { cutoffHour: 12 }, platformStatus: run.platformStatus, currency: { usdAccounts: [], rates: [] } } as unknown as Snapshot;
    const control = await getBudgetControl(ctx, snap);
    expect(control.lines.find(l => l.accountId === "tiktok:acct1" && l.level === "account")).toMatchObject({ budget: 2000, spend: null, todaySpend: null, forecast: null, status: "ATTENTION", dataState: "PARTIAL" });
  });
  it("rate limiting preserves historical partitions and reports a safe actionable code", async () => {
    await sync();
    expect((await sync(async () => new Response(null, { status: 429 })))[0].code).toBe("API_RATE_LIMITED");
    expect((await source().getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].metrics.spend).toBe(40);
  });
});
