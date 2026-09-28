import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionControlRow } from "@/lib/types";
import { platformConfidence, summarizeExecution } from "@/lib/monitoring/confidence";
import type { PlatformDataHealth } from "@/lib/monitoring/data-health";
import { buildReportMessage, joinEs, shortAccount } from "@/lib/reports/format";
import type { ReportData } from "@/lib/reports/types";
import { DEFAULT_SETTINGS, setSettingAtPath } from "@/lib/config/settings";
import { resetRecordStore } from "@/lib/records/store";
import { createTicket, listTickets, openTicketStats, updateTicket } from "@/lib/records/tickets";
import { hasAck, listAcks, saveAck } from "@/lib/records/acks";
import { listAudit, recordAudit } from "@/lib/records/audit";

const NOW = new Date("2026-09-28T19:30:00Z");

function health(over: Partial<PlatformDataHealth> = {}): PlatformDataHealth {
  return {
    platform: "meta",
    state: "OK",
    lastDataAt: NOW.toISOString(),
    lastSyncAt: NOW.toISOString(),
    lastSyncStatus: "SUCCESS",
    lagMinutes: 5,
    effectiveCutoffHour: 13,
    score: 100,
    checks: [],
    delayedAccounts: [],
    ...over,
  };
}

const exec = (over: Partial<ExecutionControlRow>): ExecutionControlRow => ({
  id: "x",
  step: "Dataslayer · Meta Ads → Google Sheets",
  platform: "meta",
  source: "dataslayer",
  status: "OK",
  lastRunAt: new Date(NOW.getTime() - 30 * 60000).toISOString(),
  rows: 10,
  message: null,
  expectedEveryMinutes: 120,
  ...over,
});

describe("control de ejecución", () => {
  it("listo, pendiente, vencido y error", () => {
    expect(summarizeExecution([], NOW).status).toBe("SIN_CONTROL");
    expect(summarizeExecution([exec({})], NOW).status).toBe("LISTO");
    expect(summarizeExecution([exec({ status: "PENDIENTE" })], NOW).status).toBe("PENDIENTE");
    const stale = summarizeExecution([exec({ lastRunAt: new Date(NOW.getTime() - 5 * 3600000).toISOString() })], NOW);
    expect(stale.status).toBe("PENDIENTE");
    expect(stale.rows[0].stale).toBe(true);
    expect(summarizeExecution([exec({}), exec({ id: "y", status: "ERROR" })], NOW).status).toBe("ERROR");
    expect(summarizeExecution([exec({ status: "PARCIAL" })], NOW).status).toBe("PARCIAL");
  });
});

describe("confianza de datos", () => {
  const base = { platform: "meta" as const, delayedAfterMinutes: 120, excludedShare: 0, historySamples: 4, historyWeeks: 4, execution: [], fxIssues: [] };
  it("100 % con datos al día y completos", () => {
    const r = platformConfidence({ ...base, health: health() });
    expect(r.score).toBe(100);
    expect(r.level).toBe("ALTA");
  });
  it("techos por estado de datos", () => {
    expect(platformConfidence({ ...base, health: health({ state: "NO_DATA" }) }).score).toBe(0);
    expect(platformConfidence({ ...base, health: health({ state: "ERROR" }) }).score).toBeLessThanOrEqual(20);
    expect(platformConfidence({ ...base, health: health({ state: "DELAYED", lagMinutes: 200 }) }).score).toBeLessThanOrEqual(40);
  });
  it("descuenta pasos pendientes, tipo de cambio e histórico incompleto, con motivos", () => {
    const r = platformConfidence({
      ...base,
      health: health(),
      historySamples: 2,
      execution: [{ ...exec({ status: "PENDIENTE" }), stale: false }],
      fxIssues: [{ kind: "fallback", accountName: "izzi Discovery", month: "2026-09" }],
    });
    expect(r.score).toBe(100 - 20 - 5 - 10);
    expect(r.level).toBe("MEDIA");
    expect(r.reasons.map((x) => x.impact)).toEqual([20, 10, 5]);
  });
  it("cuentas excluidas descuentan según su peso (mínimo 10)", () => {
    const delayed = [{ accountId: "b-402", accountName: "izzi Bing Audience", state: "DELAYED" as const, lagMinutes: 210, reason: null }];
    expect(platformConfidence({ ...base, health: health({ state: "PARTIAL", delayedAccounts: delayed }), excludedShare: 0.1 }).score).toBe(90);
    expect(platformConfidence({ ...base, health: health({ state: "PARTIAL", delayedAccounts: delayed }), excludedShare: 0.5 }).score).toBe(80);
  });
});

function reportData(): ReportData {
  return {
    generatedAt: NOW.toISOString(),
    businessDate: "2026-09-28",
    cutoffHour: 13,
    timezone: "America/Mexico_City",
    lastWeekDay: "lunes",
    greeting: "Buenos días",
    budget: { status: "ok", details: [] },
    platformProblems: { status: "ok", details: [] },
    confidence: 92,
    thresholds: { spendIncreaseVsYesterday: 0.25, spendChangeVsLastWeek: 0.15, conversionDrop: 0.2 },
    manualChecks: [{ id: "zapier", label: "Uso de tasks en Zapier" }],
    closingNote: "El día aún no termina y este gasto mayor al {umbral} puede variar.",
    accountBreakdown: ["meta"],
    platforms: [
      {
        platform: "google",
        name: "Google",
        activeStatus: "warn",
        conversionStatus: "warn",
        engineSeverity: "NORMAL",
        dataIssue: null,
        spendLowerVsLastWeek: ["izzi - móvil - mxn", "izzi - Ofertas"],
        spendHigherVsLastWeek: [],
        spendLowerVsYesterday: [],
        spendHigherVsYesterday: [],
        zeroSpend: [{ campaign: "DSP-Audience", account: "izzi - móvil - mxn" }],
        campaignsHigherVsYesterday: [{ account: "izzi - Ofertas", campaigns: ["MXSUR - CPC Manual", "CENTRO - CPC Manual"] }],
        conversionDropVsLastWeek: ["izzi – Performance ppal", "izzi - Paquetes - 2do Dominio"],
        conversionDropVsYesterday: ["izzi – Performance ppal"],
        metricLabel: "Conversiones",
        conversionsByAccount: [],
        criticalIncidents: [],
      },
      {
        platform: "meta",
        name: "Facebook",
        activeStatus: "ok",
        conversionStatus: "ok",
        engineSeverity: "NORMAL",
        dataIssue: null,
        spendLowerVsLastWeek: [],
        spendHigherVsLastWeek: [],
        spendLowerVsYesterday: [],
        spendHigherVsYesterday: [],
        zeroSpend: [],
        campaignsHigherVsYesterday: [],
        conversionDropVsLastWeek: [],
        conversionDropVsYesterday: [],
        metricLabel: "Conversiones",
        conversionsByAccount: [
          { account: "izzi ABCW", value: 82 },
          { account: "izzi Discovery", value: null },
        ],
        criticalIncidents: [],
      },
    ],
  };
}

describe("mensaje de monitoreo para WhatsApp", () => {
  it("sigue el formato del equipo", () => {
    const text = buildReportMessage(reportData(), { overrides: {}, includeConfidence: false, platforms: ["google", "meta"] });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Buenos días equipo, comparto el monitoreo:");
    expect(text).toContain("🟢Presupuesto y Línea de crédito");
    expect(text).toContain("🟠Campañas activas en Google");
    expect(text).toContain("🟢Campañas activas en Facebook");
    expect(text).toContain("👥 Conversiones en Facebook al momento en izzi ABCW: 82");
    expect(text).toContain("👥 Conversiones en Facebook al momento en izzi Discovery: sin dato");
    expect(text).toContain("🟢Uso de tasks en Zapier");
    expect(text).toContain("* Las cuentas móvil - mxn y Ofertas presentan una disminución en el gasto frente a la semana pasada.");
    expect(text).toContain("En la cuenta de móvil - mxn, la campaña DSP-Audience no presenta gasto de momento.");
    expect(text).toContain("* - MXSUR - CPC Manual, CENTRO - CPC Manual de izzi - Ofertas");
    expect(text).toContain("este gasto mayor al 25% puede variar");
    expect(text).toContain("Respecto al lunes pasado y al día de ayer, se presenta una disminución fuerte en conversiones para Performance ppal.");
    expect(text).toContain("Respecto al lunes pasado, se presenta una disminución fuerte en conversiones para Paquetes - 2do Dominio.");
    expect(text).not.toContain("🛡️");
  });
  it("respeta correcciones manuales, plataformas elegidas y confianza opcional", () => {
    const text = buildReportMessage(reportData(), { overrides: { "manual:zapier": "bad", "active:google": "ok" }, includeConfidence: true, platforms: ["google"] });
    expect(text).toContain("🔴Uso de tasks en Zapier");
    expect(text).toContain("🟢Campañas activas en Google");
    expect(text).not.toContain("Facebook");
    expect(text).not.toContain("🟢 Campañas activas en Google\n");
    expect(text).toContain("🛡️ Confianza de los datos: 92%");
  });
  it("utilidades de texto", () => {
    expect(joinEs(["A"])).toBe("A");
    expect(joinEs(["A", "B", "C"])).toBe("A, B y C");
    expect(shortAccount("izzi – Performance AO - mxn 2")).toBe("Performance AO - mxn 2");
    expect(shortAccount("izzi ABCW")).toBe("ABCW");
  });
});

describe("cambios puntuales de configuración", () => {
  it("aplica y valida por ruta; null borra", () => {
    const a = setSettingAtPath(DEFAULT_SETTINGS, "platformMetrics.meta", { primary: "conversions", pinned: ["cpa"] });
    expect(a?.platformMetrics.meta?.primary).toBe("conversions");
    const b = setSettingAtPath(a!, "currency.rates.2026-09", 18.44);
    expect(b?.currency.rates["2026-09"]).toBe(18.44);
    const c = setSettingAtPath(b!, "currency.rates.2026-09", null);
    expect(c?.currency.rates["2026-09"]).toBeUndefined();
    expect(setSettingAtPath(DEFAULT_SETTINGS, "budgetLevels.g-102", "campaign")?.budgetLevels["g-102"]).toBe("campaign");
  });
  it("rechaza rutas no permitidas, valores inválidos y contaminación de prototipos", () => {
    expect(setSettingAtPath(DEFAULT_SETTINGS, "thresholds.attention", 0.5)).toBeNull();
    expect(setSettingAtPath(DEFAULT_SETTINGS, "platformMetrics.meta", { primary: "cpa", pinned: [] })).toBeNull();
    expect(setSettingAtPath(DEFAULT_SETTINGS, "currency.rates.__proto__", 1)).toBeNull();
    expect(setSettingAtPath(DEFAULT_SETTINGS, "report.__proto__.x", 1)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("registros: tickets, acuses y bitácora", () => {
  beforeEach(() => resetRecordStore());
  it("crea tickets con folio consecutivo y guarda su histórico", async () => {
    const t1 = await createTicket(
      { title: "Meta sin entrega", description: "Campañas activas sin gasto", severity: "CRITICAL", category: "DELIVERY", platform: "meta", accountName: null, incidentIds: ["INC-0008"], reportedTo: "Líder Meta", channel: "WHATSAPP", externalRef: null, owner: null },
      "J. Martínez",
    );
    const t2 = await createTicket({ ...t1, title: "Otro caso", incidentIds: [], reportedTo: "" }, "Operaciones");
    expect(t1.id).toBe("TKT-0001");
    expect(t2.id).toBe("TKT-0002");
    expect(t1.status).toBe("REPORTADO");
    expect(t2.status).toBe("ABIERTO");
    const up = await updateTicket(t1.id, { status: "RESUELTO", text: "Meta reactivó el método de pago.", externalRef: "Caso 12345" }, "J. Martínez");
    expect(up?.resolvedAt).not.toBeNull();
    expect(up?.updates.at(-1)?.text).toContain("Caso 12345");
    const stats = await openTicketStats();
    expect(stats.open).toBe(1);
    expect((await listTickets()).map((t) => t.id)).toEqual(["TKT-0002", "TKT-0001"]);
  });
  it("registra acuses por persona e incidente", async () => {
    await saveAck({ incidentId: "INC-0008", openedAt: "2026-09-28T13:00:00.000Z", userId: "jmartinez", userName: "J. Martínez", at: NOW.toISOString(), text: "Revisado", reportTo: "Líder", ticketId: null });
    expect(await hasAck("INC-0008", "2026-09-28T13:00:00.000Z", "jmartinez")).toBe(true);
    expect(await hasAck("INC-0008", "2026-09-28T13:00:00.000Z", "operaciones")).toBe(false);
    expect(await hasAck("INC-0008", "2026-09-29T13:00:00.000Z", "jmartinez")).toBe(false);
    expect((await listAcks("INC-0008", "2026-09-28T13:00:00.000Z")).map((a) => a.userName)).toEqual(["J. Martínez"]);
  });
  it("guarda y lista la bitácora de accesos", async () => {
    await recordAudit({ type: "LOGIN_OK", user: { id: "jmartinez", name: "J. Martínez", role: "admin", kind: "named" }, detail: null, ip: "189.203.10.x", agent: "Chrome · macOS", sid: "s1" });
    await recordAudit({ type: "LOGIN_FAILED", user: { id: "x", name: "x", role: null, kind: "anon" }, detail: "Contraseña incorrecta", ip: null, agent: null, sid: null });
    const all = await listAudit({ days: 2 });
    expect(all).toHaveLength(2);
    expect((await listAudit({ days: 2, types: ["LOGIN_OK"] })).map((r) => r.user.name)).toEqual(["J. Martínez"]);
  });
});
