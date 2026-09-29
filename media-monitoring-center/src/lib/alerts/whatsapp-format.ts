import type { Severity } from "@/lib/types";
import type { AnomalyType } from "@/lib/monitoring/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { fmtDelta, fmtMetric } from "@/lib/format";
import { durationLabel, formatTimeInTz } from "@/lib/time/tz";
import type { Incident, NotificationKind, WhatsAppTemplatePayload } from "./types";

/**
 * Formato de mensajes para WhatsApp Business Cloud API.
 * Se generan dos versiones: texto libre (ventana de 24 h) y plantilla aprobada
 * (mensajes iniciados por el negocio fuera de la ventana requieren template).
 */

export const SEVERITY_ES: Record<Severity, string> = {
  NORMAL: "NORMAL",
  ATTENTION: "ATENCIÓN",
  ALERT: "ALERTA",
  CRITICAL: "CRÍTICO",
};

export const INCIDENT_KIND_ES: Record<AnomalyType, string> = {
  DATA_ISSUE: "Datos / sincronización",
  DELIVERY_CRITICAL: "Delivery crítico",
  PLATFORM_INCIDENT: "Delivery (plataforma)",
  DELIVERY_ISSUE: "Delivery",
  UNDERSPEND: "Bajo delivery",
  OVERSPEND: "Sobreinversión",
  TRACKING_ISSUE: "Tracking",
  PERFORMANCE_ISSUE: "Performance",
  EFFICIENCY_ISSUE: "Eficiencia",
  COST_INCREASE: "Costo por resultado",
  PACING_DEVIATION: "Pacing",
};

const HEADER_SUFFIX: Record<Exclude<NotificationKind, "RECOVERED">, string> = {
  OPENED: "",
  ESCALATED: " · ESCALAMIENTO",
  WORSENED: " · EMPEORA",
  DURATION_EXCEEDED: " · SIGUE ACTIVA",
};

export interface MessageContext {
  timezone: string;
  cutoffHour: number;
  now: string;
  /** Marca del monitoreo (izzi por defecto): va en el encabezado y en la referencia de la plantilla. */
  brand?: { name: string; upper: string };
}

function header(kind: Exclude<NotificationKind, "RECOVERED">, ctx: MessageContext): string {
  return `${kind === "DURATION_EXCEEDED" ? "⏱️" : "🚨"} ${ctx.brand?.upper ?? "IZZI"} MEDIA ALERT${HEADER_SUFFIX[kind]}`;
}

const brandPrefix = (ctx: MessageContext) => (ctx.brand ? `${ctx.brand.name} · ` : "");

function entityLines(inc: Incident): string[] {
  const lines = [PLATFORMS[inc.platform].name.toUpperCase()];
  if (inc.accountName) lines.push(`Cuenta: ${inc.accountName}`);
  if (inc.campaignName) lines.push(`Campaña: ${inc.campaignName}`);
  return lines;
}

export function buildAlertMessage(inc: Incident, kind: Exclude<NotificationKind, "RECOVERED">, ctx: MessageContext): { text: string; params: string[] } {
  const spend = inc.evidence.find((e) => e.metric === "spend");
  const result = inc.evidence.find((e) => e.metric !== "spend" && e.metric !== "cpr" && !["clicks", "ctr", "cpc", "cpm"].includes(e.metric));
  const cutoff = `${String(ctx.cutoffHour % 24).padStart(2, "0")}:00`;
  const detected = formatTimeInTz(inc.startedAt, ctx.timezone);
  const lines: string[] = [header(kind, ctx), ...entityLines(inc), `Estado: ${SEVERITY_ES[inc.severity]}`, ""];
  if (inc.type === "DATA_ISSUE") {
    lines.push(inc.title, "No se evalúa rendimiento hasta recibir datos.", "");
  } else {
    if (spend) {
      lines.push(`Gasto actual: ${fmtMetric("spend", spend.current)}`, `Esperado: ${fmtMetric("spend", spend.expected)}`, `Desviación: ${fmtDelta(spend.deviation)}`, "");
    }
    if (result) {
      lines.push(
        `${result.label}: ${fmtMetric(result.metric, result.current)}`,
        `Promedio histórico: ${fmtMetric(result.metric, result.expected)}`,
        `Variación: ${fmtDelta(result.deviation)}`,
        "",
      );
    }
  }
  lines.push(`Detectado: ${detected}`, `Corte: ${cutoff}`);
  if (kind === "DURATION_EXCEEDED") lines.push(`Duración: ${durationLabel(Date.parse(ctx.now) - Date.parse(inc.startedAt))}`);
  lines.push(`Posible incidencia: ${INCIDENT_KIND_ES[inc.type]}`, `Ref: ${inc.id}`);

  const params = [
    brandPrefix(ctx) + PLATFORMS[inc.platform].name + (inc.campaignName ? ` · ${inc.campaignName}` : inc.accountName ? ` · ${inc.accountName}` : ""),
    SEVERITY_ES[inc.severity],
    fmtMetric("spend", spend?.current ?? null),
    fmtMetric("spend", spend?.expected ?? null),
    fmtDelta(spend?.deviation ?? null),
    result ? `${result.label}: ${fmtMetric(result.metric, result.current)} (esperado ${fmtMetric(result.metric, result.expected)}, ${fmtDelta(result.deviation)})` : "s/d",
    detected,
    cutoff,
    INCIDENT_KIND_ES[inc.type],
    inc.id,
  ];
  return { text: lines.join("\n"), params };
}

export function buildRecoveryMessage(inc: Incident, ctx: MessageContext): { text: string; params: string[] } {
  const start = formatTimeInTz(inc.startedAt, ctx.timezone);
  const end = formatTimeInTz(inc.resolvedAt ?? ctx.now, ctx.timezone);
  const duration = durationLabel(Date.parse(inc.resolvedAt ?? ctx.now) - Date.parse(inc.startedAt));
  const who = brandPrefix(ctx) + (inc.campaignName ? `${PLATFORMS[inc.platform].name} · ${inc.campaignName}` : inc.accountName ? `${PLATFORMS[inc.platform].name} · ${inc.accountName}` : PLATFORMS[inc.platform].name);
  const text = [
    `✅ ${ctx.brand?.upper ?? "IZZI"} MEDIA RECOVERY`,
    `${who} regresó a parámetros normales.`,
    "",
    `Inicio: ${start}`,
    `Normalización: ${end}`,
    `Duración: ${duration}`,
    `Desviación máxima: ${fmtDelta(inc.maxDeviation, 0)}`,
    `Ref: ${inc.id}`,
  ].join("\n");
  return { text, params: [who, start, end, duration, fmtDelta(inc.maxDeviation, 0), inc.id] };
}

export function toTemplate(name: string, languageCode: string, params: string[]): WhatsAppTemplatePayload {
  return {
    name,
    language: { code: languageCode },
    components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1024) })) }],
  };
}
