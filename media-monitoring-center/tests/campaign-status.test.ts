import { describe, expect, it } from "vitest";
import { applyEditedSettings, DEFAULT_SETTINGS, mergeSettings, settingsDiff } from "@/lib/config/settings";
import { detectAnomalies } from "@/lib/anomaly-engine/anomaly-engine";
import { isIntentionalStop, parseCampaignStatus } from "@/lib/platforms/campaign-status";
import { buildCatalog, type SheetRecord } from "@/lib/sheets/transform";
import { emptyMetrics } from "@/lib/metrics";
import type { EntityEvaluation } from "@/lib/monitoring/types";
import { evaluation } from "./helpers";

const ctx = { settings: DEFAULT_SETTINGS, cutoffHour: 12 };

describe("estado de campaña según la plataforma", () => {
  it.each([
    ["ENABLED", "ACTIVE", false],
    ["Paused", "PAUSED", false],
    ["REMOVED", "ENDED", false],
    ["ACTIVE", "ACTIVE", false],
    ["CAMPAIGN_PAUSED", "PAUSED", false],
    ["ARCHIVED", "ENDED", false],
    ["WITH_ISSUES", "ACTIVE", true],
    ["Not delivering", "ACTIVE", true],
    ["Inactive", "PAUSED", false],
    ["CAMPAIGN_STATUS_ENABLE", "ACTIVE", false],
    ["CAMPAIGN_STATUS_DISABLE", "PAUSED", false],
    ["CAMPAIGN_STATUS_DELETE", "ENDED", false],
    ["CAMPAIGN_STATUS_BUDGET_EXCEED", "ACTIVE", true],
    ["BudgetPaused", "PAUSED", true],
    ["Suspended", "PAUSED", true],
    ["PENDING_REVIEW", "ACTIVE", true],
    ["Activa", "ACTIVE", false],
    ["Pausada", "PAUSED", false],
    ["Eliminada", "ENDED", false],
  ])("%s → %s", (raw, status, issue) => {
    const st = parseCampaignStatus(raw, 1000);
    expect(st.status).toBe(status);
    expect(st.issue).toBe(issue);
    expect(st.source).toBe("platform");
    expect(st.text).toBe(raw);
  });

  it("sin columna (o con un texto desconocido) se deduce por gasto y se conserva el texto", () => {
    expect(parseCampaignStatus(null, 500)).toMatchObject({ status: "ACTIVE", source: "spend" });
    expect(parseCampaignStatus("", 0)).toMatchObject({ status: "PAUSED", source: "spend" });
    expect(parseCampaignStatus("Foo", 0)).toMatchObject({ status: "PAUSED", source: "spend", text: "Foo" });
  });

  it("activa en la plataforma pero sin gasto ayer ni hoy queda marcada como silenciosa", () => {
    expect(parseCampaignStatus("ENABLED", 0).silent).toBe(true);
    expect(parseCampaignStatus("ENABLED", 10).silent).toBe(false);
  });

  it("solo una pausa hecha a propósito explica una caída", () => {
    expect(isIntentionalStop({ status: "PAUSED", statusSource: "platform", statusIssue: false })).toBe(true);
    expect(isIntentionalStop({ status: "PAUSED", statusSource: "platform", statusIssue: true })).toBe(false);
    expect(isIntentionalStop({ status: "PAUSED", statusSource: "spend" })).toBe(false);
    expect(isIntentionalStop({ status: "ACTIVE", statusSource: "platform" })).toBe(false);
  });

  it("el catálogo de la hoja usa el estado más reciente de la columna", () => {
    const rec = (date: string, status: string | null, spend: number): SheetRecord => ({
      sheet: "Meta",
      platform: "meta",
      shape: "daily",
      level: "campaign",
      date,
      hour: null,
      accountId: "a1",
      accountName: "Cuenta",
      campaignId: "c1",
      campaignName: "Campaña",
      campaignStatus: status,
      campaignType: null,
      objective: null,
      currency: "MXN",
      metrics: { ...emptyMetrics(), spend },
    });
    const [paused] = buildCatalog([rec("2026-09-28", "ACTIVE", 900), rec("2026-09-29", "PAUSED", 300)], "2026-09-29", "2026-09-28").campaigns;
    expect(paused).toMatchObject({ status: "PAUSED", statusSource: "platform", statusText: "PAUSED" });
    const [inferred] = buildCatalog([rec("2026-09-29", null, 300)], "2026-09-29", "2026-09-28").campaigns;
    expect(inferred).toMatchObject({ status: "ACTIVE", statusSource: "spend" });
  });
});

describe("caídas explicadas por campañas pausadas", () => {
  const platform = (spend: [number, number]) => evaluation({ level: "platform", key: "platform:meta", spend, result: [spend[0] / 200, spend[1] / 200], share: 1 });
  const campaign = (id: string, spend: [number, number], extra: Partial<EntityEvaluation>): EntityEvaluation => ({
    ...evaluation({ key: `campaign:meta:${id}`, spend, result: [spend[0] / 200, spend[1] / 200] }),
    campaignId: id,
    campaignName: `Campaña ${id}`,
    ...extra,
  });
  const top = (list: EntityEvaluation[]) => detectAnomalies(list, ctx).find((a) => a.level === "platform");

  it("sin estado de la plataforma la caída de la plataforma es crítica", () => {
    expect(top([platform([40_000, 100_000])])?.severity).toBe("CRITICAL");
  });

  it("una pausa intencional que explica la caída la deja en atención, con la explicación", () => {
    const paused = campaign("p1", [0, 55_000], { status: "PAUSED", statusSource: "platform", statusText: "PAUSED", statusIssue: false });
    const a = top([platform([40_000, 100_000]), paused]);
    expect(a?.severity).toBe("ATTENTION");
    expect(a?.adjustments.join(" ")).toContain("pausada o terminada");
  });

  it("si la pausa explica solo una parte, la severidad sale del resto", () => {
    const paused = campaign("p1", [0, 20_000], { status: "PAUSED", statusSource: "platform", statusText: "PAUSED", statusIssue: false });
    // Sin la pausada: 40k vs 80k esperados = -50% → sigue crítica; con 20k más de pausa: 40k vs 60k = -33% → alerta.
    expect(top([platform([40_000, 100_000]), paused])?.severity).toBe("CRITICAL");
    const bigger = campaign("p2", [0, 40_000], { status: "PAUSED", statusSource: "platform", statusText: "PAUSED", statusIssue: false });
    expect(top([platform([40_000, 100_000]), bigger])?.severity).toBe("ALERT");
  });

  it("una pausa por presupuesto agotado o deducida por gasto no explica nada", () => {
    const budget = campaign("p1", [0, 55_000], { status: "PAUSED", statusSource: "platform", statusText: "BudgetPaused", statusIssue: true });
    expect(top([platform([40_000, 100_000]), budget])?.severity).toBe("CRITICAL");
    const inferred = campaign("p2", [0, 55_000], { status: "PAUSED", statusSource: "spend" });
    expect(top([platform([40_000, 100_000]), inferred])?.severity).toBe("CRITICAL");
  });

  it("activa en la plataforma pero sin gasto desde ayer: alerta, no crítico", () => {
    const silent = campaign("s1", [0, 30_000], { status: "ACTIVE", statusSource: "platform", statusText: "ENABLED", statusSilent: true });
    const [a] = detectAnomalies([silent], ctx);
    expect(a.type).toBe("DELIVERY_CRITICAL");
    expect(a.severity).toBe("ALERT");
    expect(a.adjustments.join(" ")).toContain("la reporta activa");
  });

  it("con problema en la plataforma, la alerta de la campaña cita el estado", () => {
    const issue = campaign("i1", [0, 30_000], { status: "ACTIVE", statusSource: "platform", statusText: "WITH_ISSUES", statusIssue: true });
    const [a] = detectAnomalies([issue], ctx);
    expect(a.adjustments.join(" ")).toContain('"WITH_ISSUES"');
  });
});

describe("guardado de la configuración", () => {
  it("solo se guarda lo que difiere de los valores por omisión", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { platformMetrics: { meta: { primary: "clicks", pinned: [] } } });
    expect(settingsDiff(DEFAULT_SETTINGS, next)).toEqual({ platformMetrics: { meta: { primary: "clicks", pinned: [] } } });
    expect(settingsDiff(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual({});
    expect(mergeSettings(DEFAULT_SETTINGS, settingsDiff(DEFAULT_SETTINGS, next))).toEqual(next);
  });

  it("lo que no se tocó en Configuración conserva lo guardado (no congela ajustes por marca u hoja)", () => {
    const stored = DEFAULT_SETTINGS;
    // Vigente en Sky con la hoja: sin Bing ni Spotify y atraso ajustado al ciclo de Dataslayer.
    const effective = { ...stored, monitoredPlatforms: ["google", "meta", "tiktok"] as typeof stored.monitoredPlatforms, freshness: { ...stored.freshness, delayedAfterMinutes: 155 } };
    const submitted = { ...effective, thresholds: { ...effective.thresholds, attention: 0.1 } };
    const saved = applyEditedSettings(stored, effective, submitted)!;
    expect(saved.monitoredPlatforms).toEqual(stored.monitoredPlatforms);
    expect(saved.freshness.delayedAfterMinutes).toBe(stored.freshness.delayedAfterMinutes);
    expect(saved.thresholds.attention).toBe(0.1);
  });

  it("un objetivo quitado en Configuración se borra de lo guardado", () => {
    const stored = mergeSettings(DEFAULT_SETTINGS, { objectiveOverrides: { c1: "LEADS" } });
    const submitted = { ...stored, objectiveOverrides: {} };
    expect(applyEditedSettings(stored, stored, submitted)!.objectiveOverrides).toEqual({});
  });
});
