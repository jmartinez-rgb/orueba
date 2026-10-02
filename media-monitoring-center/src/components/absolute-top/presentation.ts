import type { AbsoluteTopEvaluation, AbsoluteTopState } from "@/lib/absolute-top/types";
import type { Severity } from "@/lib/types";

export const STATE_LABELS: Record<AbsoluteTopState, string> = {
  meets: "Cumple",
  near: "Cerca del límite",
  below: "Fuera del objetivo",
  insufficient: "Datos insuficientes",
  unclassified: "Sin clasificar",
};
export const CROSS_LABELS: Record<AbsoluteTopEvaluation["cross_status"], string> = {
  generalized: "Problema generalizado",
  localized: "Problema localizado",
  concentrated: "Problema concentrado",
  healthy: "Estructura dentro del objetivo",
  unknown: "Diagnóstico cruzado no disponible",
};
export const SEVERITY_LABELS: Record<Severity, string> = { NORMAL: "Normal", ATTENTION: "Atención", ALERT: "Alerta", CRITICAL: "Crítica" };

export interface AbsoluteTopFilters { account: string; campaign: string; adGroup: string; level: string; state: string; severity: string }
export const EMPTY_FILTERS: AbsoluteTopFilters = { account: "all", campaign: "all", adGroup: "all", level: "all", state: "all", severity: "all" };
export const campaignKey = (row: Pick<AbsoluteTopEvaluation, "customer_id" | "campaign_id">) => `${row.customer_id}:${row.campaign_id}`;

/** Local selectors never choose a domain or recalculate an entity's independent evaluation. */
export function filterAbsoluteTopRows(rows: AbsoluteTopEvaluation[], filters: AbsoluteTopFilters): AbsoluteTopEvaluation[] {
  return rows.filter((row) =>
    (filters.account === "all" || row.customer_id === filters.account) &&
    (filters.campaign === "all" || campaignKey(row) === filters.campaign) &&
    (filters.adGroup === "all" || row.entity_key === filters.adGroup) &&
    (filters.level === "all" || row.level === filters.level) &&
    (filters.state === "all" || row.state === filters.state) &&
    (filters.severity === "all" || row.severity === filters.severity),
  ).sort((a, b) => b.severity_score - a.severity_score || (a.gap_pp ?? Infinity) - (b.gap_pp ?? Infinity) || a.entity_key.localeCompare(b.entity_key));
}

/** Display native ratios as percentages; unknown and invalid values remain explicit. */
export function rateText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(1)}%` : "N/D";
}

/** CTR is already in percentage units and may exceed 100 in the native segmented report. */
export function ctrText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)}%` : "N/D";
}

/** Gaps and changes arrive in percentage points, never as relative percent changes. */
export function pointText(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)} pp`;
}

export function countText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(value) : "N/D";
}

export function moneyText(value: number | null | undefined, currency: string | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || !currency || !/^[A-Z]{3}$/.test(currency)) return "N/D";
  try { return new Intl.NumberFormat("es-MX", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(value); } catch { return "N/D"; }
}

export function measuredAtText(value: string | null, timezone: string | null): string {
  if (!value) return "Sin auditoría";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/D";
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: timezone ?? "UTC", hour12: false }).format(date);
  } catch { return "N/D"; }
}

export function shareText(value: number | null, bound?: "lt_10_percent" | "gt_90_percent"): string {
  if (bound === "lt_10_percent") return "<10%";
  if (bound === "gt_90_percent") return ">90%";
  return rateText(value);
}

export function windowText(row: Pick<AbsoluteTopEvaluation, "date" | "hour" | "window_from" | "window_to" | "window_end_hour">): string {
  if (row.window_from && row.window_to) return `${row.window_from} → ${row.window_to}${row.window_end_hour === null || row.window_end_hour === undefined ? " · días completos" : ` · acumulado hasta ${String(row.window_end_hour + 1).padStart(2, "0")}:00 (último día)`}`;
  return `${row.date}${row.hour === null ? " · día completo" : ` · hora ${String(row.hour).padStart(2, "0")}:00`}`;
}
