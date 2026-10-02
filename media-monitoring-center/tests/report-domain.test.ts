import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportData } from "@/lib/services/report";
import { buildReportMessage } from "@/lib/reports/format";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { emptyMetrics } from "@/lib/metrics";
import { invalidate } from "@/lib/data/cache";
import type { AppContext } from "@/lib/services/context";
import type { Snapshot } from "@/lib/services/snapshot";
import type { Account, Campaign, HourlyRow } from "@/lib/types";

vi.mock("@/lib/services/budget", () => ({ getBudgetControl: async () => ({ lines: [] }) }));
const today = "2026-10-02";
const dates = [today, "2026-10-01", "2026-09-25"];
const domain = (id = "fixture_domain") => ({ id, name: `Dominio ${id}`, available: true, configVersion: 9 });

function fixture(id = "fixture_domain", count = 1, conversions = 15) {
  const accounts: Account[] = Array.from({ length: count }, (_, index) => ({
    id: `account-${index}`, platform: "google", brand: "izzi", name: "Identical account label", currency: "MXN",
    domain_id: id, domain_name: `Dominio ${id}`, customer_id: `customer-${index}`, account_name: "Explicit catalog label",
  }));
  const campaigns: Campaign[] = accounts.map((account, index) => ({ id: `campaign-${index}`, platform: "google", accountId: account.id, name: `Campaign ${index}`, status: "ACTIVE", objective: "CONVERSIONS", conversionEvent: null, domain_id: id, domain_name: `Dominio ${id}` }));
  const rows: HourlyRow[] = campaigns.flatMap(campaign => dates.map((date, index) => ({ date, hour: 0, platform: "google", accountId: campaign.accountId, campaignId: campaign.id, metrics: { ...emptyMetrics(), spend: index === 0 ? 900 : 300, clicks: 10, impressions: 1_000, conversions: index === 0 ? conversions : 10 } })));
  const source = { getHourly: vi.fn(async () => rows) };
  const ctx = { mode: "unified", brand: "izzi", brandInfo: { id: "izzi", name: "izzi" }, settings: DEFAULT_SETTINGS, settingsHash: "fixture-settings", domain: domain(id), scopeKey: `izzi:${id}:9`, source } as unknown as AppContext;
  const snap = {
    catalog: { accounts, campaigns }, meta: { generatedAt: "2026-10-02T18:00:00Z", asOf: "2026-10-02T18:00:00Z", domain: domain(id) },
    run: { businessDate: today, cutoffHour: 1, platforms: ["google"], entities: [{ key: "platform:google", dataState: "OK", cutoffHour: 1, excludedAccounts: [] }], anomalies: [] },
    platformStatus: { google: { severity: "NORMAL", dataState: "OK" } }, state: { incidents: [] },
    execution: { status: "LISTO", pending: [], errors: [] }, confidence: { overall: { score: 90 } },
  } as unknown as Snapshot;
  return { ctx, snap, source, rows };
}

beforeEach(() => invalidate("report:rows:"));

describe("domain-scoped monitoring report", () => {
  it("retains explicit catalog metadata and separates accounts even when their display names coincide", async () => {
    const { ctx, snap } = fixture("fixture_domain", 2);
    const report = await buildReportData(ctx, snap);
    expect(report.domain).toEqual(ctx.domain);
    expect(report.platforms.map(platform => platform.platform)).toEqual(["google"]);
    expect(report.platforms[0].campaignsHigherVsYesterday).toHaveLength(2);
    expect(report.platforms[0].campaignsHigherVsYesterday.map(group => group.customer_id)).toEqual(["customer-0", "customer-1"]);
    expect(report.platforms[0].conversionsByAccount).toEqual([
      { account: "Identical account label", value: 15, domain_id: "fixture_domain", domain_name: "Dominio fixture_domain", customer_id: "customer-0", account_name: "Explicit catalog label" },
      { account: "Identical account label", value: 15, domain_id: "fixture_domain", domain_name: "Dominio fixture_domain", customer_id: "customer-1", account_name: "Explicit catalog label" },
    ]);
    expect(buildReportMessage(report, { overrides: {}, includeConfidence: false, platforms: ["google"] }).split("\n")[0]).toContain("monitoreo · Dominio fixture_domain:");
  });

  it("keeps cached campaign windows separate across domains and reuses only the same scope", async () => {
    const first = fixture("scope_a", 1, 17);
    const second = fixture("scope_b", 1, 29);
    expect((await buildReportData(first.ctx, first.snap)).platforms[0].conversionsByAccount[0].value).toBe(17);
    expect((await buildReportData(second.ctx, second.snap)).platforms[0].conversionsByAccount[0].value).toBe(29);
    expect((await buildReportData(first.ctx, first.snap)).platforms[0].conversionsByAccount[0].value).toBe(17);
    expect(first.source.getHourly).toHaveBeenCalledOnce();
    expect(second.source.getHourly).toHaveBeenCalledOnce();
  });

  it("rejects foreign campaign/account rows before constructing current and reference windows", async () => {
    const { ctx, snap, rows } = fixture();
    rows.push(
      { ...rows[0], platform: "meta", metrics: { ...rows[0].metrics, conversions: 99_999 } },
      { ...rows[0], accountId: "foreign-account", metrics: { ...rows[0].metrics, conversions: 88_888 } },
      { ...rows[0], campaignId: "foreign-campaign", metrics: { ...rows[0].metrics, conversions: 77_777 } },
    );
    const report = await buildReportData(ctx, snap);
    expect(report.platforms[0].conversionsByAccount[0].value).toBe(15);
    expect(JSON.stringify(report)).not.toMatch(/99999|88888|77777|foreign-account|foreign-campaign/);
  });

  it("refuses to combine a snapshot and a data source from different domain selections", async () => {
    const { ctx, snap, source } = fixture();
    snap.meta.domain = domain("another_domain");
    await expect(buildReportData(ctx, snap)).rejects.toThrow("alcance del reporte cambió");
    expect(source.getHourly).not.toHaveBeenCalled();
  });

  it.each(["empty", "unavailable"])("keeps %s scope out of a green report", async kind => {
    const { ctx, snap } = fixture();
    if (kind === "empty") { snap.catalog.accounts = []; snap.catalog.campaigns = []; }
    else ctx.domain = { ...domain(), available: false };
    const report = await buildReportData(ctx, snap);
    expect(report.platforms).toEqual([]);
    expect(report.confidence).toBe(0);
    expect(report.budget.status).toBe("warn");
    expect(report.platformProblems.status).not.toBe("ok");
    expect(report.platformProblems.details.join(" ")).toContain("no confirma normalidad");
  });
});
