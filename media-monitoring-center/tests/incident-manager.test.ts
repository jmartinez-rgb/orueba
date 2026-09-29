import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { reconcile, applyAlertStatus } from "@/lib/alerts/incident-manager";
import { emptyAlertState, type AlertState } from "@/lib/alerts/types";
import type { Anomaly, MonitoringRun } from "@/lib/monitoring/types";
import type { Severity } from "@/lib/types";
import { zonedTimeToUtc } from "@/lib/time/tz";

const TZ = "America/Mexico_City";
const WA = { templateAlert: "izzi_media_alert", templateRecovery: "izzi_media_recovery", templateLanguage: "es_MX" };

function anomaly(severity: Severity, deviation: number): Anomaly {
  return {
    key: "platform:meta",
    level: "platform",
    platform: "meta",
    accountId: null,
    accountName: null,
    campaignId: null,
    campaignName: null,
    fingerprint: "platform:meta#delivery",
    type: "DELIVERY_ISSUE",
    family: "delivery",
    severity,
    rawSeverity: severity,
    metric: "spend",
    current: 825_000,
    expected: 1_240_000,
    deviation,
    title: "Caída de gasto y conversaciones",
    diagnosis: "…",
    adjustments: [],
    evidence: [
      { metric: "spend", label: "Gasto", current: 825_421, expected: 1_242_550, prevWeek: 1_100_000, deviation: -0.336 },
      { metric: "whatsapp", label: "Conversaciones WhatsApp", current: 8421, expected: 12_605, prevWeek: 12_000, deviation: -0.332 },
    ],
    objective: "WHATSAPP",
    expectedSpendShare: 1,
    cutoffHour: 9,
    groupedUnder: null,
  };
}

function run(hour: number, anomalies: Anomaly[]): MonitoringRun {
  return {
    runAt: zonedTimeToUtc("2026-09-28", hour, 0, TZ).toISOString(),
    timezone: TZ,
    businessDate: "2026-09-28",
    cutoffHour: hour,
    intervalHours: 2,
    comparisonDates: [],
    historyWeeks: 4,
    baseline: "mean",
    entities: [],
    anomalies,
    platformStatus: {} as MonitoringRun["platformStatus"],
    overall: "NORMAL",
    pacing: {} as MonitoringRun["pacing"],
    curves: {} as MonitoringRun["curves"],
    dataHealth: {} as MonitoringRun["dataHealth"],
    totalIncludes: [],
    totalCutoffHour: hour,
    platforms: ["google", "meta", "tiktok", "microsoft", "spotify", "x"],
  };
}

describe("anti-spam: una anomalía = un incidente que se actualiza", () => {
  const opts = { settings: DEFAULT_SETTINGS, notify: true, whatsapp: WA };
  let state: AlertState = emptyAlertState();
  const steps: Array<{ hour: number; a: Anomaly[] }> = [
    { hour: 9, a: [anomaly("ALERT", -0.3)] },
    { hour: 11, a: [anomaly("ALERT", -0.33)] },
    { hour: 13, a: [anomaly("CRITICAL", -0.42)] },
    { hour: 15, a: [anomaly("CRITICAL", -0.44)] },
    { hour: 16, a: [anomaly("CRITICAL", -0.45)] },
    { hour: 17, a: [] },
  ];
  const sent: string[][] = [];
  for (const s of steps) {
    const r = reconcile(state, run(s.hour, s.a), opts);
    state = r.state;
    sent.push(r.notifications.filter((n) => n.channel === "whatsapp").map((n) => n.kind));
  }

  it("09:00 crea INC-0001 y notifica; 11:00 actualiza sin notificar", () => {
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].id).toBe("INC-0001");
    expect(sent[0]).toEqual(["OPENED"]);
    expect(sent[1]).toEqual([]);
  });

  it("13:00 empeora: actualiza severidad del MISMO incidente y notifica escalamiento", () => {
    expect(sent[2]).toEqual(["ESCALATED"]);
    expect(state.alerts).toHaveLength(1);
  });

  it("15:00 cumple 6 h abierto: un solo recordatorio por duración; 16:00 ya no repite", () => {
    expect(sent[3]).toEqual(["DURATION_EXCEEDED"]);
    expect(sent[4]).toEqual([]);
  });

  it("17:00 se recupera: RESOLVED con inicio, fin, duración y desviación máxima", () => {
    const inc = state.incidents[0];
    expect(sent[5]).toEqual(["RECOVERED"]);
    expect(inc.status).toBe("RESOLVED");
    expect(inc.maxDeviation).toBeCloseTo(-0.45);
    expect(inc.maxSeverity).toBe("CRITICAL");
    expect(Date.parse(inc.resolvedAt!) - Date.parse(inc.startedAt)).toBe(8 * 3600 * 1000);
    const recovery = state.notifications.find((n) => n.kind === "RECOVERED" && n.channel === "whatsapp")!;
    expect(recovery.text).toContain("✅ IZZI MEDIA RECOVERY");
    expect(recovery.text).toContain("Inicio: 09:00");
    expect(recovery.text).toContain("Normalización: 17:00");
    expect(recovery.text).toContain("Duración: 8 h");
  });

  it("el mensaje de alerta sigue el formato acordado y trae plantilla de WhatsApp", () => {
    const opened = state.notifications.find((n) => n.kind === "OPENED" && n.channel === "whatsapp")!;
    expect(opened.text).toContain("🚨 IZZI MEDIA ALERT");
    expect(opened.text).toContain("META ADS");
    expect(opened.text).toContain("Posible incidencia: Delivery");
    expect(opened.template?.name).toBe("izzi_media_alert");
    expect(opened.recipients.every((r) => r.includes("***"))).toBe(true);
  });
});

describe("persistencia y falsos positivos", () => {
  const opts = { settings: DEFAULT_SETTINGS, notify: true, whatsapp: WA };

  it("una alerta de ATENCIÓN se vuelve incidente solo si persiste", () => {
    let st = emptyAlertState();
    st = reconcile(st, run(9, [anomaly("ATTENTION", -0.18)]), opts).state;
    expect(st.incidents).toHaveLength(0);
    const r = reconcile(st, run(11, [anomaly("ATTENTION", -0.19)]), opts);
    expect(r.state.incidents).toHaveLength(1);
    expect(r.notifications).toHaveLength(0); // atención no notifica
  });

  it("FALSE POSITIVE cierra el incidente sin mensaje de recuperación", () => {
    let st = reconcile(emptyAlertState(), run(9, [anomaly("CRITICAL", -0.5)]), opts).state;
    st = applyAlertStatus(st, st.alerts[0].id, "FALSE_POSITIVE", zonedTimeToUtc("2026-09-28", 10, 0, TZ).toISOString());
    const r = reconcile(st, run(11, [anomaly("CRITICAL", -0.5)]), opts);
    expect(r.notifications).toHaveLength(0);
    expect(r.state.incidents).toHaveLength(1);
    expect(r.state.incidents[0].status).toBe("RESOLVED");
  });
});

describe("idempotencia", () => {
  it("dos evaluaciones en la misma ventana (reintento de n8n) no cuentan como persistencia", () => {
    const opts = { settings: DEFAULT_SETTINGS, notify: true, whatsapp: WA };
    let st = reconcile(emptyAlertState(), run(9, [anomaly("ATTENTION", -0.18)]), opts).state;
    const retry = run(9, [anomaly("ATTENTION", -0.18)]);
    retry.runAt = new Date(Date.parse(retry.runAt) + 60_000).toISOString();
    st = reconcile(st, retry, opts).state;
    expect(st.alerts[0].consecutiveRuns).toBe(1);
    expect(st.incidents).toHaveLength(0);
  });
});
