import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignsTable, campaignTableTotals } from "@/components/monitoring/campaigns-table";
import { campaignQuery } from "@/lib/nexus/campaign-query";
import { answerNexus } from "@/lib/nexus/answer";
import { projectNexusData } from "@/lib/nexus/data";
import type { CampaignRowVM } from "@/lib/services/view-models";
import { nexusSnapshot } from "./nexus-fixtures";

function row(patch: Partial<CampaignRowVM> = {}): CampaignRowVM {
  return {
    id: "54321", name: "Paused target", platform: "google", accountName: "izzi", objective: "TRAFFIC", status: "PAUSED",
    statusText: "PAUSED", statusIssue: false, statusSilent: false, dataState: "OK", spend: 0, expected: 100,
    deviation: -1, vsPrev: null, histDeviation: null, resultLabel: "Clics", resultMetric: "clicks", results: 0,
    resultsExpected: 10, resultsDeviation: -1, resultLagging: false, costLabel: "CPC", cost: null, costDeviation: null,
    alertSeverity: null, alertType: null, alertId: null, grouped: false, impact: 100, share: null, ...patch,
  };
}

describe("Nexus campaign citations", () => {
  it("opens the actual linked paused campaign without excluding it under the active default filter", () => {
    const answer = answerNexus("Campaña 54321", projectNexusData(nexusSnapshot()));
    const url = new URL(answer.sources[0].href, "http://localhost");
    const filters = campaignQuery({ search: url.searchParams.get("search"), platform: url.searchParams.get("platform") });
    const markup = renderToStaticMarkup(createElement(CampaignsTable, {
      rows: [row(), row({ id: "12345", name: "Different active campaign", status: "ACTIVE" }), row({ id: "54321", name: "Same ID on another platform", platform: "meta", status: "ACTIVE" })],
      weeks: 4, ...filters,
    }));
    expect(markup).toContain("Paused target");
    expect(markup).not.toContain("Different active campaign");
    expect(markup).not.toContain("Same ID on another platform");
  });

  it("preserves the active default on ordinary pages and gives fixed platform precedence", () => {
    const rows = [row(), row({ id: "active", name: "Active default", status: "ACTIVE" }), row({ id: "54321", name: "Meta fixed target", platform: "meta" })];
    const ordinary = renderToStaticMarkup(createElement(CampaignsTable, { rows, weeks: 4 }));
    expect(ordinary).toContain("Active default");
    expect(ordinary).not.toContain("Paused target");
    const fixed = renderToStaticMarkup(createElement(CampaignsTable, { rows, weeks: 4, initialSearch: "54321", initialPlatform: "google", fixedPlatform: "meta" }));
    expect(fixed).toContain("Meta fixed target");
    expect(fixed).not.toContain("Paused target");
  });

  it("rejects array/prototype platform inputs and bounds control-containing URL search hints", () => {
    for (const platform of [["google", "meta"], "__proto__", "constructor", "http://external.invalid", null]) expect(campaignQuery({ platform }).initialPlatform).toBeUndefined();
    expect(campaignQuery({ search: ["123", "456"] }).initialSearch).toBe("");
    expect(campaignQuery({ search: " \u202e123\n456 " }).initialSearch).toBe("123 456");
    expect(campaignQuery({ search: "x".repeat(500) }).initialSearch).toHaveLength(160);
  });

  it("links open incidents using the already supported incident ID query", () => {
    const answer = answerNexus("Alertas abiertas", projectNexusData(nexusSnapshot()));
    expect(answer.items[0].href).toBe("/incidents?id=INC-1");
    expect(answer.items[0].detail).toContain("Abierto");
  });
});

describe("Campaign header total coverage", () => {
  it("does not label a partial known subtotal as a complete amount", () => {
    expect(campaignTableTotals([row({ spend: 25 }), row({ spend: null, dataState: "NO_DATA", expected: null })])).toEqual({ spend: null, expected: null, deviation: null, missingSpend: 1 });
  });

  it("never interprets missing data or a delayed placeholder zero as actual zero", () => {
    for (const dataState of ["NO_DATA", "ERROR", "DELAYED", "PARTIAL"] as const) {
      const totals = campaignTableTotals([row({ spend: 0, dataState })]);
      expect(totals.spend).toBeNull();
      expect(totals.deviation).toBeNull();
      expect(totals.expected).toBe(100);
    }
  });

  it("preserves complete reported zero and complete-reference deviation", () => {
    expect(campaignTableTotals([row({ spend: 0 }), row({ spend: 0, expected: 50 })])).toEqual({ spend: 0, expected: 150, deviation: -1, missingSpend: 0 });
  });

  it("returns unknown for an empty scope or nonfinite values rather than displaying invented totals", () => {
    expect(campaignTableTotals([])).toEqual({ spend: null, expected: null, deviation: null, missingSpend: 0 });
    expect(campaignTableTotals([row({ spend: Infinity, expected: NaN })])).toEqual({ spend: null, expected: null, deviation: null, missingSpend: 1 });
  });

  it("renders an explicit incomplete-cost explanation in the actual table header", () => {
    const markup = renderToStaticMarkup(createElement(CampaignsTable, { rows: [row({ status: "ACTIVE", dataState: "NO_DATA", spend: null })], weeks: 4 }));
    expect(markup).toContain("Sin total de gasto consolidado");
    expect(markup).not.toMatch(/Gasto.*?\$0\.00/);
  });
});
