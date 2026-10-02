import { describe, expect, it } from "vitest";
import { buildClientView, type ClientViewInput } from "@/lib/client/client-view";
import type { Alert, Incident } from "@/lib/alerts/types";

const base: ClientViewInput = {
  platforms: ["google"], platformStatus: { google: { severity: "NORMAL", dataState: "OK" } } as ClientViewInput["platformStatus"],
  pacing: { google: { pctOfExpected: 1 }, total: { pctOfExpected: 1 } },
  incidents: [], alerts: [], lastDataAt: "2026-10-02T17:00:00Z", nextEvaluationAt: "2026-10-02T17:15:00Z",
  month: { total: { usedPct: .5, expectedPct: .5 } },
};

describe("public client domain projection", () => {
  it.each([
    { platforms: [] },
    { hasAccounts: false },
    { domain: { id: "fixture_domain", name: "Dominio de prueba", available: false, configVersion: null } },
  ])("never reports normality for an empty or unavailable scope: %j", override => {
    const result = buildClientView({ ...base, ...override });
    expect(result.overall).toBe("nodata");
    expect(result.headline).not.toBe("Todo en orden");
    expect(result).toMatchObject({ platforms: [], attending: [], alerts: [], month: null, updatedAt: null });
  });

  it("keeps partial data out of the green client state", () => {
    const result = buildClientView({ ...base, platformStatus: { google: { severity: "NORMAL", dataState: "PARTIAL" } } as ClientViewInput["platformStatus"] });
    expect(result.overall).toBe("nodata");
    expect(result.platforms[0].level).toBe("nodata");
  });

  it("filters domain incidents by account before stripping private operational details", () => {
    const incident = { id: "PRIVATE-INC", platform: "google", accountId: "fixture-account", campaignId: "PRIVATE-CAMPAIGN", resolvedAt: null, maxSeverity: "CRITICAL", severity: "CRITICAL", type: "DELIVERY_CRITICAL", startedAt: "2026-10-02T16:00:00Z", status: "INVESTIGATING", owner: "PRIVATE-PERSON", notes: [{ text: "PRIVATE-NOTE" }] } as unknown as Incident;
    const alert = { ...incident, id: "PRIVATE-ALERT", detectedAt: incident.startedAt, groupedUnder: null, status: "NEW", diagnosis: "PRIVATE-DIAGNOSIS" } as unknown as Alert;
    const result = buildClientView({ ...base,
      domain: { id: "fixture_domain", name: "Dominio de prueba", available: true, configVersion: 4 },
      scopeAccounts: [{ id: "fixture-account", platform: "google" }],
      incidents: [incident, { ...incident, accountId: "outside-domain" }, { ...incident, accountId: null }],
      alerts: [alert, { ...alert, accountId: "outside-domain" }, { ...alert, accountId: null }],
    });
    expect(result.overall).toBe("action");
    expect(result.attending).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|fixture-account|outside-domain|accountId|campaignId|notes|owner/);
  });
});
