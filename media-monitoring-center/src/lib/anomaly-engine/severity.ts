import type { Severity } from "@/lib/types";
import { SEVERITY_ORDER } from "@/lib/types";
import type { MonitoringSettings } from "@/lib/config/settings";

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(...list: Severity[]): Severity {
  return list.reduce<Severity>((acc, s) => (severityRank(s) > severityRank(acc) ? s : acc), "NORMAL");
}

export function minSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) <= severityRank(b) ? a : b;
}

/** Semáforo base por magnitud de la desviación (valor absoluto, fracción). */
export function classifyDeviation(absDeviation: number | null, thresholds: MonitoringSettings["thresholds"]): Severity {
  if (absDeviation === null || !Number.isFinite(absDeviation)) return "NORMAL";
  if (absDeviation > thresholds.critical) return "CRITICAL";
  if (absDeviation >= thresholds.alert) return "ALERT";
  if (absDeviation >= thresholds.attention) return "ATTENTION";
  return "NORMAL";
}

export function downgrade(s: Severity, levels = 1): Severity {
  return SEVERITY_ORDER[Math.max(0, severityRank(s) - levels)];
}

export function upgrade(s: Severity, levels = 1): Severity {
  return SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, severityRank(s) + levels)];
}

export function atLeast(s: Severity, floor: Severity): boolean {
  return severityRank(s) >= severityRank(floor);
}
