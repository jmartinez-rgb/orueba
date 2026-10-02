import { describe, expect, it } from "vitest";
import { projectNexusData } from "@/lib/nexus/data";
import { answerNexus } from "@/lib/nexus/answer";
import { nexusSnapshot } from "./nexus-fixtures";

describe("Nexus domain scope", () => {
  it("copies explicit domain metadata and excludes brand-wide incidents from a domain", () => {
    const snapshot = nexusSnapshot();
    snapshot.meta.domain = { id: "fixture_domain", name: "Dominio de prueba", available: true, configVersion: 8 };
    snapshot.catalog.accounts[0].domain_id = "fixture_domain";
    snapshot.catalog.accounts[0].domain_name = "Dominio de prueba";
    snapshot.catalog.campaigns[0].domain_id = "fixture_domain";
    snapshot.state.alerts.push({ ...snapshot.state.alerts[0], id: "GLOBAL-ALERT", accountId: null, campaignId: null });
    snapshot.state.incidents.push({ ...snapshot.state.incidents[0], id: "GLOBAL-INC", accountId: null, campaignId: null });
    const projected = projectNexusData(snapshot);
    expect(projected.context.domain).toEqual(snapshot.meta.domain);
    expect(projected.accounts.map(account => account.id)).toEqual(["acc1"]);
    expect(projected.accounts[0]).toMatchObject({ domain_id: "fixture_domain", domain_name: "Dominio de prueba" });
    expect(projected.campaigns[0].domain_id).toBe("fixture_domain");
    expect(projected.alerts.map(alert => alert.id)).toEqual(["ALERT-1"]);
    expect(projected.incidents.map(incident => incident.id)).toEqual(["INC-1"]);
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|GLOBAL-|FOREIGN|sky-secret/);
  });

  it("preserves platform-wide incidents in an all-domain view", () => {
    const snapshot = nexusSnapshot();
    snapshot.meta.domain = { id: "all", name: "Todos los dominios", available: true, configVersion: 8 };
    snapshot.state.incidents.push({ ...snapshot.state.incidents[0], id: "GLOBAL-INC", accountId: null, campaignId: null });
    expect(projectNexusData(snapshot).incidents.map(incident => incident.id)).toEqual(["INC-1", "GLOBAL-INC"]);
  });

  it("does not attribute data to an unavailable domain, while keeping local usage guidance", () => {
    const snapshot = nexusSnapshot();
    snapshot.meta.domain = { id: "unavailable_domain", name: "Dominio no disponible", available: false, configVersion: null };
    const data = projectNexusData(snapshot);
    expect(data.accounts).toEqual([]);
    expect(data.campaigns).toEqual([]);
    const answer = answerNexus("Gasto Google", data);
    expect(answer.kind).toBe("unavailable");
    expect(answer.facts).toEqual([]);
    expect(answer.items).toEqual([]);
    expect(JSON.stringify(answer)).not.toMatch(/acc1|Promociones|100\.00/);
    expect(answerNexus("Cómo usar el monitoreo", data).kind).toBe("guide");
  });
});
