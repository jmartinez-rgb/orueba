import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { UnifiedDataSource, sameReportDay } from "@/lib/unified/source";
import { syncUnified } from "@/lib/unified/sync";
import { performanceSchema, type UnifiedScope } from "@/lib/unified/schema";

/**
 * An account that reports in America/Chicago (one hour ahead of Mexico City from March to November) cannot
 * provide Mexican daily totals: its days are rebuilt from its hourly rows in the Mexico City clock.
 */
const scope: UnifiedScope = { platform: "meta", accountId: "abcw", brand: "izzi", currency: "MXN" };
const now = new Date("2026-10-07T18:00:00Z");
const read = "2026-10-07T00:00:00.000Z";
const hourRow = (date: string, hour: number, spend: number) => performanceSchema.parse({ platform: "meta", account_id: "abcw", campaign_id: "c1", date, hour, currency: "MXN", source_timezone: "America/Chicago", spend, impressions: spend * 10, clicks: spend, conversions: null, cpa: null, extracted_at: read, raw_metrics: {} });
let directory: string, store: UnifiedSnapshotStore;
const source = () => new UnifiedDataSource({ store, accounts: [scope], timezone: "America/Mexico_City", clock: () => now });
async function catalog() {
  await store.saveCatalog({ version: 1, scope, extractedAt: read, account: { platform: "meta", account_id: "abcw", account_name: "izzi - ABCW", currency: "MXN", timezone: "America/Chicago" }, campaigns: [{ platform: "meta", account_id: "abcw", campaign_id: "c1", campaign_name: "ABCW", campaign_status: "active", source_status: null, objective: null }] });
}
async function hours(date: string, rows: ReturnType<typeof hourRow>[], extractedAt = read) {
  await store.savePartition({ version: 1, scope, date, granularity: "hourly", extractedAt, rows });
}
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "other-clock-")); store = new UnifiedSnapshotStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("accounts in another report clock", () => {
  it("detects a different day boundary, keeping unknown and equivalent zones on the provider's daily rows", () => {
    expect(sameReportDay("America/Chicago", "America/Mexico_City", 2026)).toBe(false);
    expect(sameReportDay("America/Monterrey", "America/Mexico_City", 2026)).toBe(true);
    expect(sameReportDay("America/Mexico_City", "America/Mexico_City", 2026)).toBe(true);
    expect(sameReportDay(null, "America/Mexico_City", 2026)).toBe(true);
    expect(sameReportDay("GuadalajaraMexicoCityMonterrey", "America/Mexico_City", 2026)).toBe(true);
  });

  it("rebuilds the Mexico City day from hourly rows: 01:00–23:00 of the Chicago day plus 00:00 of the next", async () => {
    await catalog();
    // Chicago 00:00 on Oct 5 is 23:00 on Oct 4 in Mexico City; Chicago 00:00 on Oct 6 is 23:00 on Oct 5.
    await hours("2026-10-05", Array.from({ length: 24 }, (_, hour) => hourRow("2026-10-05", hour, 1)));
    await hours("2026-10-06", [hourRow("2026-10-06", 0, 100), hourRow("2026-10-06", 1, 1000)]);
    const daily = await source().getDaily({ from: "2026-10-05", to: "2026-10-05", level: "campaign" });
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ date: "2026-10-05", accountId: "meta:abcw", campaignId: "meta:abcw:c1" });
    expect(daily[0].metrics).toMatchObject({ spend: 123, impressions: 1230, clicks: 123 });
    // Oct 4 lacks the Chicago Oct 4 report date and Oct 6 lacks Oct 7: unknown, never zero.
    expect((await source().getDaily({ from: "2026-10-04", to: "2026-10-06", level: "campaign" })).map(r => r.date)).toEqual(["2026-10-05"]);
    const coverage = await source().historyCoverage();
    expect([...coverage.daily.get("meta:abcw")!]).toEqual(["2026-10-05"]);
  });

  it("a report date read before the business day ended keeps that day unknown", async () => {
    await catalog();
    await hours("2026-10-05", [hourRow("2026-10-05", 5, 1)]);
    // Read at 23:30 Mexico City on Oct 5: the last business hour was not final yet.
    await hours("2026-10-06", [hourRow("2026-10-06", 0, 100)], "2026-10-06T05:30:00.000Z");
    expect(await source().getDaily({ from: "2026-10-05", to: "2026-10-05", level: "campaign" })).toEqual([]);
  });

  it("extraction asks the provider only for hours and records the day as rebuilt, not as an error", async () => {
    const asked: string[] = [];
    const request: typeof fetch = async input => {
      const url = new URL(String(input)), route = url.pathname.split("/").pop();
      if (route === "performance") asked.push(url.searchParams.get("granularity")!);
      const data = route === "accounts" ? [{ platform: "meta", account_id: "abcw", account_name: "izzi - ABCW", currency: "MXN", timezone: "America/Chicago" }]
        : route === "campaigns" ? [{ platform: "meta", account_id: "abcw", campaign_id: "c1", campaign_name: "ABCW", campaign_status: "active", source_status: null, objective: null }]
        : [{ ...hourRow("2026-10-05", 10, 5), extracted_at: now.toISOString() }];
      return Response.json({ data, errors: [] });
    };
    const result = await syncUnified({ mapping: { version: 1, accounts: [scope] }, store, url: "https://api.example.test", apiKey: "private-internal-key", from: "2026-10-05", to: "2026-10-05", granularities: ["daily", "hourly"], request, clock: () => now, timezone: "America/Mexico_City" });
    expect(result.map(r => [r.granularity, r.status, r.code])).toEqual([["daily", "SUCCESS", "DAILY_FROM_HOURLY"], ["hourly", "SUCCESS", null]]);
    expect(asked).toEqual(["hourly"]);
    const [dailyStep] = await source().getExecutionControl(now);
    expect(dailyStep).toMatchObject({ status: "OK", message: expect.stringContaining("otra zona horaria") });
  });
});
