import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReconciliation, dateRange, parseReference } from "@/lib/reconciliation/reconcile";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { performanceSchema, type ApiPerformance, type UnifiedMapping, type UnifiedScope } from "@/lib/unified/schema";

const date = "2026-09-30";
const zone = "America/Mexico_City";
const extractedAt = "2026-10-01T12:00:00Z";
const now = new Date("2026-10-02T18:00:00Z");
const scope: UnifiedScope = { brand: "izzi", platform: "google", accountId: "7367928294", currency: "MXN" };
const mapping: UnifiedMapping = { version: 1, accounts: [scope] };
let directory: string;
let store: UnifiedSnapshotStore;

function metricRow(patch: Partial<ApiPerformance> = {}): ApiPerformance {
  return performanceSchema.parse({ platform: scope.platform, account_id: scope.accountId, campaign_id: "campaign1", date, hour: null, currency: scope.currency, source_timezone: zone, spend: 10.1, impressions: 10, clicks: 1, extracted_at: extractedAt, ...patch });
}

function reference(rowPatch: Record<string, unknown> = {}, documentPatch: Record<string, unknown> = {}) {
  return {
    version: 1,
    origin: "ADS_MANAGER",
    exportedAt: "2026-10-02T12:00:00Z",
    scope: "ALL_CAMPAIGNS",
    from: date,
    to: date,
    rows: [{ brand: scope.brand, platform: scope.platform, accountId: scope.accountId, date, granularity: "daily", currency: scope.currency, timezone: zone, metricDefinitions: { spend: "ACCOUNT_CURRENCY", impressions: "IMPRESSIONS", clicks: "PLATFORM_CLICKS" }, spend: 30.3, impressions: 30, clicks: 3, ...rowPatch }],
    ...documentPatch,
  };
}

async function saveCatalog(selected: UnifiedScope = scope, campaignIds = ["campaign1", "campaign2"], timezone: string | null = zone) {
  await store.saveCatalog({
    version: 1, scope: selected, extractedAt,
    account: { platform: selected.platform, account_id: selected.accountId, account_name: "Cuenta nominal izzi", currency: selected.currency, timezone },
    campaigns: campaignIds.map((campaign_id, index) => ({ platform: selected.platform, account_id: selected.accountId, campaign_id, campaign_name: `Campaña ${index + 1}`, campaign_status: index === 0 ? "active" : "paused", source_status: null, objective: null })),
  });
}

async function saveDaily(rows = [metricRow(), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })], selected: UnifiedScope = scope, selectedDate = date, at = extractedAt) {
  await store.savePartition({ version: 1, scope: selected, date: selectedDate, granularity: "daily", extractedAt: at, rows });
}

const report = (referenceDoc?: unknown, options: Partial<Parameters<typeof buildReconciliation>[0]> = {}) => buildReconciliation({ mapping, store, from: date, to: date, now, reference: referenceDoc, ...options });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "reconciliation-"));
  store = new UnifiedSnapshotStore(directory);
  await saveCatalog();
  await saveDaily();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("bounded reconciliation contract", () => {
  it("treats one calendar day and the 45-day maximum as inclusive ranges", () => {
    expect(dateRange(date, date)).toEqual([date]);
    const dates = dateRange("2026-08-18", "2026-10-01");
    expect(dates).toHaveLength(45);
    expect(dates[0]).toBe("2026-08-18");
    expect(dates.at(-1)).toBe("2026-10-01");
  });

  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-02-29", "2026-03-01"],
    ["2026-13-01", "2026-13-02"],
    ["2026-00-01", "2026-01-01"],
    ["2026-09-30T00:00:00Z", date],
    ["2026-9-30", date],
    ["2026-10-01", date],
    ["2026-08-17", "2026-10-01"],
  ])("rejects invalid or unbounded calendar range %s to %s", (from, to) => {
    expect(() => dateRange(from, to)).toThrow(expect.objectContaining({ code: "INVALID_RANGE" }));
  });

  it("accepts February 29 only in a leap year", () => {
    expect(dateRange("2024-02-28", "2024-03-01")).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("requires an independent Ads Manager origin rather than an API export or template", () => {
    expect(parseReference(reference()).rows).toHaveLength(1);
    for (const origin of ["TEMPLATE", "UNIFIED_API", "verificar", undefined]) {
      expect(() => parseReference(reference({}, { origin }))).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
    }
  });

  it("preserves long account identifiers as text and rejects imprecise numeric IDs", () => {
    const accountId = "7688066712031182866";
    expect(parseReference(reference({ accountId })).rows[0].accountId).toBe(accountId);
    expect(() => parseReference(reference({ accountId: Number(accountId) }))).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
  });

  it.each([
    { timezone: "Mexico City" },
    { date: "2026-09-31" },
    { granularity: "hourly" },
    { currency: "EUR" },
    { spend: -1 },
    { spend: Infinity },
    { impressions: 1.5 },
    { clicks: NaN },
    { metricDefinitions: { spend: "ACCOUNT_CURRENCY", impressions: "IMPRESSIONS", clicks: "LINK_CLICKS" } },
    { access_token: "fixture-field-that-must-be-rejected" },
  ])("rejects an incompatible or unsafe reference row %j", patch => {
    expect(() => parseReference(reference(patch))).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
  });

  it("rejects unknown document fields and invalid export timestamps", () => {
    for (const patch of [{ authorization: "fixture-only" }, { exportedAt: "2026-09-31T12:00:00Z" }, { exportedAt: "yesterday" }, { scope: "ACTIVE_ONLY" }]) {
      expect(() => parseReference(reference({}, patch))).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
    }
  });

  it("rejects a duplicate account/day even when the duplicate changes currency or timezone", () => {
    const base = reference();
    for (const patch of [{}, { currency: "USD" }, { timezone: "UTC" }]) {
      expect(() => parseReference({ ...base, rows: [...base.rows, { ...base.rows[0], ...patch }] })).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
    }
  });

  it("rejects references outside the mapped accounts or requested range", async () => {
    for (const ref of [reference({ accountId: "foreign" }), reference({ date: "2026-09-29" }, { from: "2026-09-29" })]) {
      await expect(report(ref)).rejects.toMatchObject({ code: "INVALID_REFERENCE_SCOPE" });
    }
  });

  it("rejects an extra brand at the reference contract boundary", () => {
    expect(() => parseReference(reference({ brand: "sky" }))).toThrow(expect.objectContaining({ code: "INVALID_REFERENCE" }));
  });

  it("rejects an invalid observation clock before reading historical records", async () => {
    await expect(report(reference(), { now: new Date("not-a-clock") })).rejects.toMatchObject({ code: "INVALID_CLOCK" });
  });

  it("rejects an ambiguous mapping across brands and a source with no izzi account", async () => {
    const sky: UnifiedScope = { ...scope, brand: "sky" };
    await expect(report(undefined, { mapping: { version: 1, accounts: [scope, sky] } })).rejects.toMatchObject({ code: "INVALID_MAPPING" });
    await expect(report(undefined, { mapping: { version: 1, accounts: [sky] } })).rejects.toMatchObject({ code: "NO_IZZI_ACCOUNTS" });
  });

  it("rejects an independent export timestamp later than the observation clock", async () => {
    await expect(report(reference({}, { exportedAt: "2026-10-02T19:00:00Z" }))).rejects.toMatchObject({ code: "INVALID_REFERENCE_TIME" });
  });

  it("rejects an export made before its native reporting day closed", async () => {
    await expect(report(reference({}, { exportedAt: "2026-10-01T02:00:00Z" }))).rejects.toMatchObject({ code: "INVALID_REFERENCE_TIME" });
  });
});

describe("account/day comparison in original currency and native clock", () => {
  it("includes paused campaigns and sums base metrics without using conversion data", async () => {
    const result = await report(reference());
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row).toMatchObject({ brand: "izzi", platform: "google", accountId: scope.accountId, date, currency: "MXN", timezone: zone, coverage: "COMPLETE_CATALOG", catalogExtractedAt: extractedAt, sourceExtractedAt: extractedAt });
    expect(row.sourceMetrics.spend).toBeCloseTo(30.3, 12);
    expect(row.sourceMetrics.impressions).toBe(30);
    expect(row.sourceMetrics.clicks).toBe(3);
    expect(Object.values(row.comparisons).map(value => value.code)).toEqual(["MATCH", "MATCH", "MATCH"]);
    expect(result.exitCode).toBe(0);
    expect(result.certifiesV1).toBe(false);
    expect(result.counts.MATCH).toBe(1);
    expect(result.policy).toMatchObject({ campaignScope: "ALL_CAMPAIGNS", currencyConversion: false, timezoneConversion: false });
  });

  it("does not fold hourly partitions into native daily reports", async () => {
    await store.savePartition({ version: 1, scope, date, granularity: "hourly", extractedAt, rows: [metricRow({ hour: 0, spend: 9999, impressions: 9999, clicks: 9999 })] });
    expect((await report(reference())).rows[0].sourceMetrics.spend).toBeCloseTo(30.3, 12);
  });

  it("filters Sky from the requested source even when names look like izzi", async () => {
    const sky: UnifiedScope = { ...scope, brand: "sky", accountId: "sky-account" };
    await saveCatalog(sky);
    await saveDaily([metricRow({ account_id: sky.accountId, spend: 900 })], sky);
    const rows = (await report(undefined, { mapping: { version: 1, accounts: [scope, sky] } })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("izzi");
    expect(rows[0].accountId).toBe(scope.accountId);
  });

  it("retains USD rather than inventing an exchange rate or consolidating currencies", async () => {
    const usd: UnifiedScope = { ...scope, currency: "USD", accountId: "usd-account" };
    await saveCatalog(usd);
    await saveDaily([metricRow({ account_id: usd.accountId, currency: "USD" }), metricRow({ account_id: usd.accountId, currency: "USD", campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })], usd);
    const row = (await report(reference({ accountId: usd.accountId, currency: "USD" }), { mapping: { version: 1, accounts: [usd] } })).rows[0];
    expect(row.currency).toBe("USD");
    expect(row.comparisons.spend.code).toBe("MATCH");
    expect(row.sourceMetrics.spend).toBeCloseTo(30.3, 12);
  });

  it("accepts the one-cent spending tolerance including floating point noise", async () => {
    const row = (await report(reference({ spend: 30.31 }))).rows[0];
    expect(row.comparisons.spend.code).toBe("MATCH");
    expect(Math.abs(row.comparisons.spend.delta!)).toBeCloseTo(0.01, 12);
  });

  it("reports spending differences outside tolerance and exact count differences", async () => {
    const row = (await report(reference({ spend: 30.311, impressions: 31, clicks: 4 }))).rows[0];
    expect(row.comparisons.spend.code).toBe("DIFFERENCE");
    expect(row.comparisons.impressions).toMatchObject({ code: "DIFFERENCE", source: 30, reference: 31, delta: -1 });
    expect(row.comparisons.clicks).toMatchObject({ code: "DIFFERENCE", source: 3, reference: 4, delta: -1 });
  });

  it("returns finite or null relative differences when the reference is zero", async () => {
    const row = (await report(reference({ spend: 0, impressions: 0, clicks: 0 }))).rows[0];
    for (const comparison of Object.values(row.comparisons)) {
      expect(comparison.code).toBe("DIFFERENCE");
      expect(comparison.relativeDelta).toBeNull();
      expect(Number.isFinite(comparison.delta)).toBe(true);
    }
  });

  it("preserves explicit zero as a complete observed metric", async () => {
    await saveDaily([metricRow({ spend: 0, impressions: 0, clicks: 0 }), metricRow({ campaign_id: "campaign2", spend: 0, impressions: 0, clicks: 0 })]);
    const row = (await report(reference({ spend: 0, impressions: 0, clicks: 0 }))).rows[0];
    expect(row.sourceMetrics).toEqual({ spend: 0, impressions: 0, clicks: 0 });
    expect(row.coverage).toBe("COMPLETE_CATALOG");
    for (const comparison of Object.values(row.comparisons)) expect(comparison).toMatchObject({ code: "MATCH", source: 0, reference: 0, delta: 0, relativeDelta: null });
  });

  it("keeps a null source metric unknown rather than omitting it from a positive total", async () => {
    await saveDaily([metricRow({ spend: null }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend).toMatchObject({ code: "UNKNOWN_METRIC", source: null, delta: null, relativeDelta: null });
    expect(row.comparisons.impressions.code).toBe("MATCH");
  });

  it("keeps a null independent reference unknown even when its source is zero", async () => {
    await saveDaily([metricRow({ spend: 0 }), metricRow({ campaign_id: "campaign2", spend: 0, impressions: 20, clicks: 2 })]);
    expect((await report(reference({ spend: null }))).rows[0].comparisons.spend).toMatchObject({ code: "UNKNOWN_METRIC", source: 0, reference: null, delta: null });
  });

  it("does not accept fractional source count totals as integer event counts", async () => {
    await saveDaily([metricRow({ impressions: 10.5 }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.sourceMetrics.impressions).toBeNull();
    expect(row.comparisons.impressions.code).toBe("UNKNOWN_METRIC");
    expect(row.comparisons.spend.code).toBe("MATCH");
  });

  it("does not round overflowing count totals into apparently exact reference counts", async () => {
    await saveDaily([metricRow({ impressions: Number.MAX_SAFE_INTEGER }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 1, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.sourceMetrics.impressions).toBeNull();
    expect(row.comparisons.impressions.code).toBe("UNKNOWN_METRIC");
  });

  it("does not infer zero or complete coverage from an absent campaign row", async () => {
    await saveDaily([metricRow()]);
    const row = (await report(reference())).rows[0];
    expect(row.coverage).toBe("INCOMPLETE");
    expect(row.sourceMetrics).toEqual({ spend: null, impressions: null, clicks: null });
    expect(row.observedSubtotal).toEqual({ spend: 10.1, impressions: 10, clicks: 1 });
    for (const comparison of Object.values(row.comparisons)) expect(comparison.code).toBe("MISSING_SOURCE");
  });

  it("keeps an empty valid daily partition distinct from a zero-cost complete report", async () => {
    await saveDaily([]);
    const row = (await report(reference({ spend: 0, impressions: 0, clicks: 0 }))).rows[0];
    expect(row.coverage).toBe("MISSING");
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it("marks a missing partition for each requested account/day without dropping that day", async () => {
    const rows = (await report(undefined, { from: "2026-09-29" })).rows;
    expect(rows).toHaveLength(2);
    const absent = rows.find(row => row.date === "2026-09-29")!;
    expect(absent.coverage).toBe("MISSING");
    expect(absent.sourceExtractedAt).toBeNull();
    expect(absent.sourceMetrics).toEqual({ spend: null, impressions: null, clicks: null });
  });

  it("requires a catalog before claiming account-wide totals from available campaign rows", async () => {
    const noCatalog: UnifiedScope = { ...scope, accountId: "without-catalog" };
    await saveDaily([metricRow({ account_id: noCatalog.accountId })], noCatalog);
    const row = (await report(reference({ accountId: noCatalog.accountId }), { mapping: { version: 1, accounts: [noCatalog] } })).rows[0];
    expect(row.catalogExtractedAt).toBeNull();
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it("does not count a source campaign absent from the declared catalog as complete", async () => {
    await saveDaily([metricRow(), metricRow({ campaign_id: "foreign-campaign", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it("keeps reference clock differences incompatible without relabeling an aggregated day", async () => {
    const row = (await report(reference({ timezone: "UTC" }))).rows[0];
    expect(row.timezone).toBe(zone);
    for (const comparison of Object.values(row.comparisons)) expect(comparison.code).toBe("INCOMPATIBLE_CLOCK");
  });

  it("marks a currency mismatch rather than comparing an MXN total with USD", async () => {
    const row = (await report(reference({ currency: "USD" }))).rows[0];
    expect(row.currency).toBe("MXN");
    for (const comparison of Object.values(row.comparisons)) expect(comparison.code).toBe("INCOMPATIBLE_CURRENCY");
  });

  it("uses the original report clock and blocks a reference on a different commercial clock", async () => {
    await saveDaily([metricRow({ source_timezone: "UTC" }), metricRow({ campaign_id: "campaign2", source_timezone: "UTC", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.timezone).toBe("UTC");
    expect(row.sourceMetrics.spend).toBeCloseTo(30.3, 12);
    expect(row.comparisons.spend.code).toBe("INCOMPATIBLE_CLOCK");
    expect((await report(reference({ timezone: "UTC" }))).rows[0].comparisons.spend.code).toBe("MATCH");
  });

  it("does not certify a day extracted before the native calendar day closed", async () => {
    const openAt = "2026-09-30T18:00:00Z";
    await saveDaily([metricRow({ extracted_at: openAt }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2, extracted_at: openAt })], scope, date, openAt);
    const row = (await report(reference())).rows[0];
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
    expect(row.sourceMetrics.spend).toBeNull();
  });

  it("does not certify early metric rows hidden inside a later-extracted partition", async () => {
    await saveDaily([metricRow({ extracted_at: "2026-09-30T18:00:00Z" }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.sourceExtractedAt).toBe(extractedAt);
    expect(row.metricExtractedAtFrom).toBe("2026-09-30T18:00:00Z");
    expect(row.metricExtractedAtTo).toBe(extractedAt);
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it("does not certify account totals whose campaigns report on different clocks", async () => {
    await saveDaily([metricRow(), metricRow({ campaign_id: "campaign2", source_timezone: "UTC", spend: 20.2, impressions: 20, clicks: 2 })]);
    const row = (await report(reference())).rows[0];
    expect(row.timezone).toBeNull();
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("INCOMPATIBLE_CLOCK");
  });

  it.each([
    { date: "2026-01-01", offset: -420 }, // IANA midnight is UTC-8; X's current offset is UTC-7.
    { date: "2026-03-08", offset: -480 }, // Start agrees, but DST changes the next midnight.
  ])("blocks X report offsets incompatible with either IANA boundary on $date", async ({ date: selectedDate, offset }) => {
    const x: UnifiedScope = { ...scope, platform: "x", accountId: "x-fixture" };
    const timezone = "America/Los_Angeles";
    await saveCatalog(x, ["campaign1", "campaign2"], timezone);
    await saveDaily([
      metricRow({ platform: "x", account_id: x.accountId, date: selectedDate, source_timezone: timezone, raw_metrics: { report_utc_offset_minutes: offset } }),
      metricRow({ platform: "x", account_id: x.accountId, campaign_id: "campaign2", date: selectedDate, source_timezone: timezone, spend: 20.2, impressions: 20, clicks: 2, raw_metrics: { report_utc_offset_minutes: offset } }),
    ], x, selectedDate);
    const result = await report(reference({ platform: "x", accountId: x.accountId, date: selectedDate, timezone }, { from: selectedDate, to: selectedDate }), { mapping: { version: 1, accounts: [x] }, from: selectedDate, to: selectedDate });
    expect(result.exitCode).toBe(2);
    expect(result.rows[0].coverage).toBe("INCOMPLETE");
    expect(result.rows[0].reasons).toContain("INCOMPATIBLE_REPORT_OFFSET");
    expect(result.rows[0].sourceMetrics).toEqual({ spend: null, impressions: null, clicks: null });
    expect(result.rows[0].observedSubtotal).toEqual({ spend: null, impressions: null, clicks: null });
    for (const comparison of Object.values(result.rows[0].comparisons)) expect(comparison.code).toBe("INCOMPATIBLE_CLOCK");
  });

  it("accepts an explicit fixed report offset only when both IANA boundaries agree", async () => {
    const x: UnifiedScope = { ...scope, platform: "x", accountId: "x-fixture" };
    await saveCatalog(x);
    await saveDaily([
      metricRow({ platform: "x", account_id: x.accountId, raw_metrics: { report_utc_offset_minutes: -360 } }),
      metricRow({ platform: "x", account_id: x.accountId, campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2, raw_metrics: { report_utc_offset_minutes: -360 } }),
    ], x);
    const result = await report(reference({ platform: "x", accountId: x.accountId }), { mapping: { version: 1, accounts: [x] } });
    expect(result.exitCode).toBe(0);
    expect(result.rows[0].coverage).toBe("COMPLETE_CATALOG");
    expect(result.rows[0].codes).toEqual(["MATCH"]);
  });

  it("uses the native account clock for open-day checks rather than the UTC calendar date", async () => {
    const nearMidnight = new Date("2026-10-01T02:00:00Z"); // Still September 30 in Mexico.
    const row = (await report(undefined, { now: nearMidnight })).rows[0];
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it.each(["catalog", "partition", "metric"] as const)("keeps a future %s extraction incomplete rather than trusting an impossible source clock", async where => {
    const futureAt = "2026-10-03T12:00:00Z";
    const rows = [metricRow({ ...(where === "metric" ? { extracted_at: futureAt } : {}) }), metricRow({ campaign_id: "campaign2", spend: 20.2, impressions: 20, clicks: 2 })];
    await saveDaily(rows, scope, date, where === "partition" ? futureAt : extractedAt);
    if (where === "catalog") await store.saveCatalog({ ...(await store.catalog(scope))!, extractedAt: futureAt });
    const row = (await report(reference())).rows[0];
    expect(row.coverage).toBe("INCOMPLETE");
    expect(row.reasons).toContain("FUTURE_EXTRACTION");
    expect(row.sourceMetrics.spend).toBeNull();
    expect(row.comparisons.spend.code).toBe("MISSING_SOURCE");
  });

  it("keeps unreferenced native totals available without calling them reconciled", async () => {
    const result = await report();
    const row = result.rows[0];
    expect(row.sourceMetrics.spend).toBeCloseTo(30.3, 12);
    for (const comparison of Object.values(row.comparisons)) expect(comparison).toMatchObject({ code: "MISSING_REFERENCE", reference: null, delta: null, relativeDelta: null });
    expect(result.exitCode).toBe(2);
    expect(result.reference).toBeNull();
    expect(result.certifiesV1).toBe(false);
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it("does not mutate private historical files while comparing them offline", async () => {
    const paths = [join(directory, "izzi/google", scope.accountId, "catalog.json"), join(directory, "izzi/google", scope.accountId, "daily", `${date}.json`)];
    const hashes = () => Promise.all(paths.map(async path => createHash("sha256").update(await readFile(path)).digest("hex")));
    const before = await hashes();
    await report(reference());
    await report();
    expect(await hashes()).toEqual(before);
  });
});
