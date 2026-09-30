import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { applyAuthorizations } from "@/lib/alerts/authorizations";
import { detectAnomalies } from "@/lib/anomaly-engine/anomaly-engine";
import { mergeBudgets, planFor } from "@/lib/novedades/plan";
import { novedadActiveOn, type MonthKickoff, type Novedad } from "@/lib/records/novedad-model";
import type { BudgetRow } from "@/lib/types";
import { evaluation } from "./helpers";

const TZ = "America/Mexico_City";

function novedad(p: Partial<Novedad>): Novedad {
  return {
    id: "NOV-0001",
    brand: "izzi",
    createdAt: "2026-10-02T15:00:00.000Z",
    createdBy: "Ana",
    kind: "PAUSA",
    title: "Pausa de campañas en MXN 1",
    detail: "",
    platform: "meta",
    accountId: "acc-1",
    accountName: "MXN - izzi 1",
    campaignId: null,
    campaignName: null,
    approvedBy: "Cynthia",
    approvalChannel: "WHATSAPP",
    approvalRef: null,
    effectiveFrom: "2026-10-02",
    effectiveUntil: null,
    budget: null,
    expectedChange: -0.8,
    includesFullStop: false,
    silenceAlerts: true,
    incidentId: null,
    alertFingerprint: null,
    status: "VIGENTE",
    closedAt: null,
    closedBy: null,
    updates: [],
    ...p,
  };
}

describe("vigencia de una novedad", () => {
  it("aplica desde su inicio hasta la fecha final, o todo el mes si no tiene", () => {
    const n = novedad({});
    expect(novedadActiveOn(n, "2026-10-01")).toBe(false);
    expect(novedadActiveOn(n, "2026-10-02")).toBe(true);
    expect(novedadActiveOn(n, "2026-10-31")).toBe(true);
    expect(novedadActiveOn(n, "2026-11-01")).toBe(false);
    expect(novedadActiveOn({ ...n, effectiveUntil: "2026-10-05" }, "2026-10-06")).toBe(false);
    expect(novedadActiveOn({ ...n, status: "CERRADA" }, "2026-10-03")).toBe(false);
  });
});

describe("lo que el monitoreo toma en cuenta", () => {
  it("una pausa aprobada en una cuenta se vuelve autorización del alcance hasta fin de mes", () => {
    const { authorizations } = planFor([novedad({})], null, "2026-10-10", TZ);
    expect(authorizations).toHaveLength(1);
    const a = authorizations[0];
    expect(a.fingerprint).toBe("account:meta:acc-1#delivery");
    expect(a.level).toBe("account");
    expect(a.deviation).toBe(-0.8);
    expect(a.authorizedBy).toBe("Cynthia");
    expect(a.until > "2026-10-31T00:00:00.000Z" && a.until < "2026-11-02T00:00:00.000Z").toBe(true);
  });

  it("no toma en cuenta novedades cerradas, futuras, sin plataforma o solo de registro", () => {
    const list = [novedad({ id: "NOV-0002", status: "CERRADA" }), novedad({ id: "NOV-0003", effectiveFrom: "2026-10-20" }), novedad({ id: "NOV-0004", platform: null }), novedad({ id: "NOV-0005", silenceAlerts: false })];
    expect(planFor(list, null, "2026-10-10", TZ).authorizations).toHaveLength(0);
  });

  it("desde una alerta usa su huella exacta", () => {
    const { authorizations } = planFor([novedad({ alertFingerprint: "account:meta:acc-1#delivery" })], null, "2026-10-10", TZ);
    expect(authorizations[0].fingerprint).toBe("account:meta:acc-1#delivery");
  });

  it("arranque de mes: lo que no corre y lo pendiente por iniciar cuenta como detenido a propósito", () => {
    const kickoff: MonthKickoff = {
      month: "2026-10",
      brand: "izzi",
      confirmedAt: "2026-10-01T15:00:00.000Z",
      confirmedBy: "Juan",
      budgets: [{ platform: "meta", accountId: null, accountName: null, amount: 3_000_000 }],
      items: [
        { key: "c1", platform: "meta", accountName: null, campaignId: "c1", name: "Vieja", state: "ENDED", expectedStart: null, note: null, startedAt: null },
        { key: "c2", platform: "meta", accountName: null, campaignId: "c2", name: "Nueva", state: "PENDING", expectedStart: "2026-10-05", note: null, startedAt: null },
        { key: "c3", platform: "meta", accountName: null, campaignId: "c3", name: "Ya inició", state: "PENDING", expectedStart: "2026-10-02", note: null, startedAt: "2026-10-02T18:00:00Z" },
        { key: "c4", platform: "meta", accountName: null, campaignId: "c4", name: "Activa", state: "ACTIVE", expectedStart: null, note: null, startedAt: null },
      ],
      updatedAt: "2026-10-01T15:00:00.000Z",
      updatedBy: "Juan",
    };
    const plan = planFor([], kickoff, "2026-10-03", TZ);
    expect(plan.declaredCampaigns.c1?.status).toBe("ENDED");
    expect(plan.declaredCampaigns.c2?.status).toBe("PAUSED");
    expect(plan.declaredCampaigns.c3).toBeUndefined();
    expect(plan.declaredCampaigns.c4).toBeUndefined();
    expect(plan.kickoffBudgets).toEqual([{ month: "2026-10", level: "platform", platform: "meta", accountId: null, campaignId: null, amount: 3_000_000, currency: "MXN" }]);
    // Un arranque de otro mes no aplica.
    expect(planFor([], kickoff, "2026-11-03", TZ).kickoffBudgets).toHaveLength(0);
  });

  it("el ajuste de presupuesto más reciente de cada alcance manda y reemplaza capas anteriores", () => {
    const list = [
      novedad({ id: "NOV-0010", kind: "PRESUPUESTO", accountId: null, accountName: null, budget: { month: "2026-10", amount: 2_000_000 }, effectiveFrom: "2026-10-01" }),
      novedad({ id: "NOV-0011", kind: "PRESUPUESTO", accountId: null, accountName: null, budget: { month: "2026-10", amount: 2_500_000 }, effectiveFrom: "2026-10-08" }),
    ];
    const plan = planFor(list, null, "2026-10-10", TZ);
    expect(plan.novedadBudgets).toHaveLength(1);
    expect(plan.novedadBudgets[0].amount).toBe(2_500_000);
    const sheet: BudgetRow[] = [{ month: "2026-10", level: "platform", platform: "meta", accountId: null, campaignId: null, amount: 1_000_000 }];
    expect(mergeBudgets(sheet, plan.novedadBudgets)[0].amount).toBe(2_500_000);
    // Antes de su fecha de inicio, el segundo ajuste no aplica.
    expect(planFor(list, null, "2026-10-05", TZ).novedadBudgets[0].amount).toBe(2_000_000);
  });

  it("una pausa aprobada de una campaña la declara pausada", () => {
    const plan = planFor([novedad({ campaignId: "c9", campaignName: "X" })], null, "2026-10-05", TZ);
    expect(plan.declaredCampaigns.c9?.status).toBe("PAUSED");
  });
});

describe("autorizaciones en el motor", () => {
  const ctx = { settings: DEFAULT_SETTINGS, cutoffHour: 12 };
  const account = evaluation({ level: "account", key: "account:meta:acc-1", spend: [20_000, 100_000], result: [100, 500] });
  const at = "2026-10-10T18:00:00.000Z";

  it("silencia la caída autorizada y sus alertas agrupadas", () => {
    const anomalies = detectAnomalies([account], ctx);
    expect(anomalies.length).toBeGreaterThan(0);
    const { authorizations } = planFor([novedad({})], null, "2026-10-10", TZ);
    const { kept, silenced } = applyAuthorizations(anomalies, authorizations, at, DEFAULT_SETTINGS);
    expect(kept).toHaveLength(0);
    expect(silenced[0].by).toBe("Cynthia");
  });

  it("si empeora más de 10 puntos que lo autorizado, vuelve a alertar y lo explica", () => {
    const worse = evaluation({ level: "account", key: "account:meta:acc-1", spend: [5_000, 100_000], result: [25, 500] });
    const { authorizations } = planFor([novedad({})], null, "2026-10-10", TZ);
    const { kept } = applyAuthorizations(detectAnomalies([worse], ctx), authorizations, at, DEFAULT_SETTINGS);
    expect(kept).toHaveLength(1);
    expect(kept[0].adjustments.join(" ")).toContain("vuelve a alertar");
  });

  it("fuera de su vigencia no silencia nada", () => {
    const { authorizations } = planFor([novedad({ effectiveUntil: "2026-10-05" })], null, "2026-10-04", TZ);
    const { kept } = applyAuthorizations(detectAnomalies([account], ctx), authorizations, at, DEFAULT_SETTINGS);
    expect(kept.length).toBeGreaterThan(0);
  });
});
