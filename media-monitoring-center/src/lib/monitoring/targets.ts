import type { MetricId, PlatformId } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { METRICS } from "@/lib/metrics";
import type { MonitoringSettings } from "@/lib/config/settings";
import type { EntityEvaluation } from "./types";

/**
 * Métricas/objetivos fijos: valores que el equipo quiere vigilar siempre (p. ej. "CPA máximo 350"
 * o "mínimo 800 conversiones al día"). Solo informan: no cambian nada en las plataformas.
 * Las métricas aditivas se comparan con la proyección al cierre del día (curva horaria histórica);
 * las derivadas (CPA, CTR, CPC…) con su valor acumulado a la hora de corte.
 */

export interface TargetCheck {
  id: string;
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  metric: MetricId;
  label: string;
  kind: "min" | "max";
  target: number;
  /** Valor comparado: proyección del día (aditivas) o acumulado (derivadas). */
  value: number | null;
  current: number | null;
  projected: boolean;
  ok: boolean | null;
  /** Diferencia relativa contra el objetivo (positiva = por encima). */
  gap: number | null;
  note: string;
}

export function evaluateTargets(settings: MonitoringSettings, entities: EntityEvaluation[]): TargetCheck[] {
  return settings.fixedTargets
    .filter((t) => t.active)
    .map((t) => {
      const e = entities.find((x) => (t.accountId ? x.level === "account" && x.accountId === t.accountId : x.level === "platform") && x.platform === t.platform);
      const cmp = e?.cumulative[t.metric];
      const current = cmp?.current ?? null;
      const additive = (BASE_METRICS as MetricId[]).includes(t.metric);
      const share = e?.dayShare ?? null;
      const projected = additive && current !== null && share !== null && share > 0.05;
      const value = current === null ? null : projected ? current / share! : current;
      const ok = value === null ? null : t.kind === "min" ? value >= t.value : value <= t.value;
      const bad = e && (e.dataState === "DELAYED" || e.dataState === "ERROR" || e.dataState === "NO_DATA");
      return {
        id: t.id,
        platform: t.platform,
        accountId: t.accountId,
        accountName: e?.accountName ?? null,
        metric: t.metric,
        label: `${t.kind === "min" ? "Mínimo" : "Máximo"} ${METRICS[t.metric].label}${additive ? " al día" : ""}`,
        kind: t.kind,
        target: t.value,
        value: bad ? null : value,
        current: bad ? null : current,
        projected,
        ok: bad ? null : ok,
        gap: bad || value === null || t.value === 0 ? null : (value - t.value) / t.value,
        note: t.note,
      };
    });
}
