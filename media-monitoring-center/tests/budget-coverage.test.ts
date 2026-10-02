import { beforeEach, describe, expect, it } from "vitest";
import { BRANDS } from "@/lib/brands";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { invalidate } from "@/lib/data/cache";
import { emptyMetrics } from "@/lib/metrics";
import { getBudgetControl } from "@/lib/services/budget";
import type { AppContext } from "@/lib/services/context";
import type { Snapshot } from "@/lib/services/snapshot";
import type { Catalog, DailyRow, HourlyRow, PlatformId } from "@/lib/types";
import { addDays } from "@/lib/time/tz";

const metrics = (spend: number | null) => ({ ...emptyMetrics(), spend });
const account = (id: string, platform: PlatformId = "google") => ({ id, name: `Account ${id}`, platform, currency: "MXN" as const });
const campaign = (id: string, accountId = id, platform: PlatformId = "google") => ({ id, accountId, name: `Campaign ${id}`, platform, status: "ACTIVE" as const, objective: "TRAFFIC" as const, conversionEvent: null });
const daily = (id: string, spend: number | null = 100, date = "2026-10-01", accountId = id, platform: PlatformId = "google"): DailyRow => ({ date, accountId, campaignId: id, platform, metrics: metrics(spend) });
const hourly = (id: string, spend: number | null = 100, accountId = id, platform: PlatformId = "google"): HourlyRow => ({ date: "2026-10-02", hour: 0, accountId, campaignId: id, platform, metrics: metrics(spend) });

function fixture(options: { catalog?: Catalog; daily?: DailyRow[]; hourly?: HourlyRow[] } = {}) {
  const catalog = options.catalog ?? { accounts: [account("a"), account("b")], campaigns: [campaign("a"), campaign("b")] };
  const platforms = [...new Set(catalog.accounts.map(a => a.platform))];
  const ctx = {
    mode: "unified", brand: "izzi", brandInfo: BRANDS.izzi, settings: { ...DEFAULT_SETTINGS, monitoredPlatforms: platforms },
    plan: { kickoffBudgets: [], novedadBudgets: [] },
    store: { async getOverrides() { return { alerts: {}, incidents: {}, budgets: [] }; } },
    source: {
      async getDaily() { return options.daily ?? [daily("a"), daily("b")]; },
      async getHourly() { return options.hourly ?? [hourly("a"), hourly("b")]; },
      async getBudgets() { return []; },
    },
  } as unknown as AppContext;
  const snap = {
    catalog, meta: { cutoffHour: 1 },
    run: { businessDate: "2026-10-02", cutoffHour: 1, entities: [], pacing: Object.fromEntries([...platforms, "total"].map(p => [p, { curveShare: 0.1 }])) },
    currency: { usdAccounts: [], rates: [] },
    platformStatus: Object.fromEntries(platforms.map(p => [p, { dataState: "OK" }])),
  } as unknown as Snapshot;
  return { ctx, snap };
}

beforeEach(() => invalidate());

describe("monthly budget coverage in direct API mode", () => {
  it("keeps missing account history unknown in its platform and total even when both dates have some rows", async () => {
    const { ctx, snap } = fixture({ daily: [daily("a")] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "account" && l.accountId === "a")).toMatchObject({ spend: 200, todaySpend: 100, dataState: "OK" });
    expect(lines.find(l => l.level === "account" && l.accountId === "b")).toMatchObject({ spend: null, todaySpend: 100, dataState: "PARTIAL" });
    for (const level of ["platform", "total"]) expect(lines.find(l => l.level === level)).toMatchObject({ spend: null, todaySpend: 200, forecast: null, dataState: "PARTIAL" });
  });

  it("propagates a missing campaign-day inside an otherwise present account", async () => {
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a")], campaigns: [campaign("a"), campaign("b", "a")] }, daily: [daily("a")], hourly: [hourly("a"), hourly("b", 100, "a")] });
    const { lines } = await getBudgetControl(ctx, snap);
    for (const level of ["account", "platform", "total"]) expect(lines.find(l => l.level === level)).toMatchObject({ spend: null, todaySpend: 200, forecast: null, dataState: "PARTIAL" });
  });

  it("preserves today's complete subtotal while a whole previous day is missing", async () => {
    const { ctx, snap } = fixture({ daily: [] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: null, todaySpend: 200, remaining: null, usedPct: null, variance: null, forecast: null, dataState: "PARTIAL" });
  });

  it("leaves the current subtotal unknown when a member's closed hour is absent", async () => {
    const { ctx, snap } = fixture({ hourly: [hourly("a")] });
    const { lines } = await getBudgetControl(ctx, snap);
    for (const level of ["platform", "total"]) expect(lines.find(l => l.level === level)).toMatchObject({ spend: null, todaySpend: null, forecast: null, dataState: "PARTIAL" });
  });

  it("does not present only the available platform as a complete brand total", async () => {
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a"), account("m", "meta")], campaigns: [campaign("a"), campaign("m", "m", "meta")] }, daily: [daily("a")], hourly: [hourly("a")] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "platform" && l.platform === "google")).toMatchObject({ spend: 200, todaySpend: 100, dataState: "OK" });
    expect(lines.find(l => l.level === "platform" && l.platform === "meta")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
  });

  it("does not infer zero for a catalog account that has no campaign data", async () => {
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a"), account("b")], campaigns: [campaign("a")] }, daily: [daily("a")], hourly: [hourly("a")] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "account" && l.accountId === "b")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
  });

  it("retains complete sums when every campaign and day has real data", async () => {
    const { ctx, snap } = fixture();
    const { lines } = await getBudgetControl(ctx, snap);
    for (const level of ["platform", "total"]) expect(lines.find(l => l.level === level)).toMatchObject({ spend: 400, todaySpend: 200, dataState: "OK" });
    expect(lines.filter(l => l.level === "account").map(l => l.spend)).toEqual([200, 200]);
  });

  it("preserves an explicit zero alongside known spending and distinguishes it from null", async () => {
    const { ctx, snap } = fixture({ daily: [daily("a"), daily("b", 0)], hourly: [hourly("a"), hourly("b", 0)] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 200, todaySpend: 100, dataState: "OK" });
    expect(lines.find(l => l.level === "account" && l.accountId === "b")).toMatchObject({ spend: 0, todaySpend: 0, dataState: "OK" });
  });

  it("checks each remaining weekday rather than the position of that weekday in the date list", async () => {
    const historical = ["2026-09-06", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12", "2026-10-01"];
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a")], campaigns: [campaign("a")] }, daily: historical.map(date => daily("a", 100, date)), hourly: [hourly("a")] });
    ctx.settings = { ...ctx.settings, history: { ...ctx.settings.history, minSamples: 1 } };
    const { lines } = await getBudgetControl(ctx, snap);
    // October has remaining Mondays, but Monday has no historical sample.
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 200, todaySpend: 100, dataState: "OK", forecast: null, forecastVsBudget: null, status: "ATTENTION" });
  });

  it("allows a forecast once all required weekdays have sufficient real samples", async () => {
    const historical = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12", "2026-10-01"];
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a")], campaigns: [campaign("a")] }, daily: historical.map(date => daily("a", 100, date)), hourly: [hourly("a")] });
    ctx.settings = { ...ctx.settings, history: { ...ctx.settings.history, minSamples: 1 } };
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 200, dataState: "OK", forecast: 4000 });
  });

  it("requires Sunday samples even when Sunday is the only day remaining in the month", async () => {
    const dates = Array.from({ length: 29 }, (_, index) => addDays("2026-05-01", index));
    const { ctx, snap } = fixture({ catalog: { accounts: [account("a")], campaigns: [campaign("a")] }, daily: dates.map(date => daily("a", 100, date)), hourly: [{ ...hourly("a"), date: "2026-05-30" }] });
    snap.run.businessDate = "2026-05-30";
    ctx.settings = { ...ctx.settings, history: { ...ctx.settings.history, weeks: 5, minSamples: 5 } };
    const { lines } = await getBudgetControl(ctx, snap);
    // Four Sundays are available; the configured minimum of five is unmet.
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 3000, todaySpend: 100, dataState: "OK", forecast: null, forecastVsBudget: null, status: "ATTENTION" });
  });

  it("never uses a future-date hourly row as a closed hour of today", async () => {
    const { ctx, snap } = fixture({ hourly: [hourly("a"), { ...hourly("b"), date: "2026-10-03" }] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "account" && l.accountId === "b")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: null, todaySpend: null, dataState: "PARTIAL" });
  });

  it("uses closed hourly data once when a daily source also supplies today's rows", async () => {
    const { ctx, snap } = fixture({ daily: [daily("a"), daily("b"), daily("a", 500, "2026-10-02"), daily("b", 500, "2026-10-02")] });
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 400, todaySpend: 200, dataState: "OK" });
  });

  it("does not forecast an aggregate from partial historical account samples outside this month", async () => {
    const historical = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12", "2026-10-01"];
    const rows = historical.flatMap(date => date === "2026-09-07" ? [daily("a", 100, date)] : [daily("a", 100, date), daily("b", 100, date)]);
    const { ctx, snap } = fixture({ daily: rows });
    ctx.settings = { ...ctx.settings, history: { ...ctx.settings.history, minSamples: 1 } };
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "account" && l.accountId === "a")).toMatchObject({ spend: 200, forecast: 4000, dataState: "OK" });
    expect(lines.find(l => l.level === "account" && l.accountId === "b")).toMatchObject({ spend: 200, forecast: null, dataState: "OK" });
    for (const level of ["platform", "total"]) expect(lines.find(l => l.level === level)).toMatchObject({ spend: 400, todaySpend: 200, forecast: null, dataState: "OK" });
  });

  it("does not invent the rest of today when its forecast divisor is zero", async () => {
    const historical = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12", "2026-10-01"];
    const { ctx, snap } = fixture({ daily: historical.flatMap(date => [daily("a", 100, date), daily("b", 100, date)]) });
    ctx.settings = { ...ctx.settings, history: { ...ctx.settings.history, minSamples: 1 } };
    snap.run.pacing.google.curveShare = 0;
    snap.run.pacing.total.curveShare = 0;
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ spend: 400, todaySpend: 200, forecast: null, dataState: "OK" });
  });

  it("keeps zero or absent budgets out of ratio denominators", async () => {
    const { ctx, snap } = fixture();
    ctx.source.getBudgets = async () => [{ month: "2026-10", level: "total", platform: null, accountId: null, campaignId: null, amount: 0 }];
    const { lines } = await getBudgetControl(ctx, snap);
    expect(lines.find(l => l.level === "total")).toMatchObject({ budget: 0, spend: 400, remaining: -400, usedPct: null, variance: null, forecastVsBudget: null });
    expect(lines.find(l => l.level === "account" && l.accountId === "a")).toMatchObject({ budget: null, usedPct: null, forecastVsBudget: null });
    expect(JSON.stringify(lines)).not.toContain("NaN");
    expect(lines.every(line => Object.values(line).every(value => typeof value !== "number" || Number.isFinite(value)))).toBe(true);
  });

  it("preserves coverage and sums across deterministic mixed-platform missing-data cases", async () => {
    const platforms = ["google", "meta", "spotify"] as const;
    const accounts = platforms.flatMap(platform => [account(`${platform}-a`, platform), account(`${platform}-b`, platform)]);
    const campaigns = accounts.flatMap(acc => [campaign(`${acc.id}-1`, acc.id, acc.platform), campaign(`${acc.id}-2`, acc.id, acc.platform)]);
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
    for (let seed = 1; seed <= 16; seed++) {
      invalidate();
      let state = seed;
      const amount = () => { state = (state * 1664525 + 1013904223) >>> 0; return state % 11; };
      const days = campaigns.flatMap(c => dates.map(date => daily(c.id, amount(), date, c.accountId, c.platform)));
      const hours = campaigns.flatMap(c => [0, 1].map(hour => ({ ...hourly(c.id, amount(), c.accountId, c.platform), date: "2026-10-04", hour })));
      if (seed % 4 === 1) days.splice(seed % days.length, 1);
      if (seed % 4 === 2) days[seed % days.length].metrics.spend = null;
      if (seed % 4 === 3) hours.splice(seed % hours.length, 1);
      const { ctx, snap } = fixture({ catalog: { accounts, campaigns }, daily: days, hourly: hours });
      snap.run.businessDate = "2026-10-04"; snap.run.cutoffHour = 2; snap.meta.cutoffHour = 2;
      const { lines } = await getBudgetControl(ctx, snap);
      for (const line of lines) {
        const members = campaigns.filter(c => (!line.platform || c.platform === line.platform) && (!line.accountId || c.accountId === line.accountId) && (!line.campaignId || c.id === line.campaignId));
        const current = members.flatMap(c => hours.filter(row => row.campaignId === c.id));
        const prior = members.flatMap(c => days.filter(row => row.campaignId === c.id));
        const todayComplete = members.every(c => [0, 1].every(hour => hours.some(row => row.campaignId === c.id && row.hour === hour && row.metrics.spend !== null)));
        const monthComplete = todayComplete && members.every(c => dates.every(date => days.some(row => row.campaignId === c.id && row.date === date && row.metrics.spend !== null)));
        const currentSum = current.reduce((sum, row) => sum + (row.metrics.spend ?? 0), 0);
        const priorSum = prior.reduce((sum, row) => sum + (row.metrics.spend ?? 0), 0);
        expect(line.todaySpend, `seed ${seed}, ${line.key}`).toBe(todayComplete ? currentSum : null);
        expect(line.spend, `seed ${seed}, ${line.key}`).toBe(monthComplete ? priorSum + currentSum : null);
        expect(line.dataState, `seed ${seed}, ${line.key}`).toBe(monthComplete ? "OK" : "PARTIAL");
      }
    }
  });
});
