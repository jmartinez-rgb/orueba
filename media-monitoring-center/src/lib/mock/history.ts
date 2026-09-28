import type { Incident } from "@/lib/alerts/types";
import type { PlatformId, Severity } from "@/lib/types";
import type { AnomalyType } from "@/lib/monitoring/types";
import { addDays, zonedTimeToUtc } from "@/lib/time/tz";

/**
 * Incidentes históricos simulados (ya resueltos) para que el historial tenga contexto.
 * En producción estos registros vienen de la tabla monitoring_incidents de BigQuery.
 */

interface PastSeed {
  daysAgo: number;
  startHour: number;
  durationHours: number;
  platform: PlatformId;
  accountName: string | null;
  campaignName: string | null;
  type: AnomalyType;
  title: string;
  severity: Severity;
  maxDeviation: number;
  owner: string;
  note: string;
}

const SEEDS: PastSeed[] = [
  { daysAgo: 3, startHour: 11, durationHours: 6, platform: "google", accountName: "izzi | PMax y Display", campaignName: "izzi_PMax_Paquetes_Nacional", type: "TRACKING_ISSUE", title: "Ventas en cero con gasto normal", severity: "CRITICAL", maxDeviation: -1, owner: "Paid Media · Google", note: "Carga de MCC_Offline_Purchase detenida. Se reprocesó el archivo offline." },
  { daysAgo: 5, startHour: 9, durationHours: 4, platform: "spotify", accountName: null, campaignName: null, type: "DATA_ISSUE", title: "DATA DELAYED: Spotify Ads", severity: "ATTENTION", maxDeviation: 0, owner: "Data", note: "Retraso del conector. Sin impacto en performance." },
  { daysAgo: 6, startHour: 13, durationHours: 10, platform: "meta", accountName: "MXN - IZZI VENTAS", campaignName: "IZZI_Venta_Sitio_Paquetes", type: "EFFICIENCY_ISSUE", title: "Gasto al alza con CPA venta +31%", severity: "ALERT", maxDeviation: 0.31, owner: "Paid Media · Meta", note: "Se limitó el presupuesto diario y se pausaron 2 conjuntos con frecuencia alta." },
  { daysAgo: 9, startHour: 7, durationHours: 8, platform: "tiktok", accountName: null, campaignName: null, type: "PLATFORM_INCIDENT", title: "5 campañas con caída simultánea de delivery", severity: "CRITICAL", maxDeviation: -0.46, owner: "Paid Media · TikTok", note: "Rechazo masivo de anuncios por revisión. Se reenviaron creativos." },
  { daysAgo: 13, startHour: 15, durationHours: 2, platform: "x", accountName: "izzi X Ads", campaignName: null, type: "DATA_ISSUE", title: "ERROR de sincronización: izzi X Ads", severity: "ALERT", maxDeviation: 0, owner: "Data", note: "Token vencido en n8n. Se renovó la credencial." },
  { daysAgo: 17, startHour: 10, durationHours: 12, platform: "microsoft", accountName: "izzi Bing Search", campaignName: "izzi_Bing_Genericas", type: "OVERSPEND", title: "Sobreinversión", severity: "ALERT", maxDeviation: 0.34, owner: "Paid Media · Search", note: "Presupuesto compartido mal asignado. Corregido." },
];

export function pastIncidents(today: string, tz: string): Incident[] {
  return SEEDS.map((s, i) => {
    const date = addDays(today, -s.daysAgo);
    const start = zonedTimeToUtc(date, s.startHour, 0, tz).toISOString();
    const end = new Date(Date.parse(start) + s.durationHours * 3600000).toISOString();
    const id = `INC-${String(i + 1).padStart(4, "0")}`;
    return {
      id,
      fingerprint: `past:${id}`,
      alertId: `ALT-H${i + 1}`,
      level: s.campaignName ? "campaign" : s.accountName ? "account" : "platform",
      platform: s.platform,
      accountId: null,
      accountName: s.accountName,
      campaignId: null,
      campaignName: s.campaignName,
      type: s.type,
      title: s.title,
      metric: s.type === "DATA_ISSUE" ? "spend" : s.type === "TRACKING_ISSUE" ? "sales" : "spend",
      startedAt: start,
      resolvedAt: end,
      lastUpdateAt: end,
      severity: "NORMAL",
      maxSeverity: s.severity,
      currentDeviation: null,
      maxDeviation: s.maxDeviation,
      status: "RESOLVED",
      owner: s.owner,
      notes: [{ at: end, author: s.owner, text: s.note }],
      timeline: [
        { at: start, kind: "OPENED", severity: s.severity, deviation: s.maxDeviation, message: `Se abre incidente con severidad ${s.severity}.`, notified: s.severity !== "ATTENTION" },
        { at: end, kind: "RECOVERED", severity: "NORMAL", deviation: null, message: "Regresó a parámetros normales.", notified: s.severity !== "ATTENTION" },
      ],
      evidence: [],
      childAlertIds: [],
      expectedSpendShare: null,
      notification: { count: s.severity !== "ATTENTION" ? 2 : 0, lastNotifiedAt: end, lastSeverity: s.severity, lastDeviation: s.maxDeviation, durationReminderSent: false },
    } satisfies Incident;
  });
}

export const PAST_INCIDENT_COUNT = SEEDS.length;
