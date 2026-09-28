import type { MetricId, MetricValues } from "@/lib/types";
import { emptyMetrics, OBJECTIVE_KPI } from "@/lib/metrics";
import { compareValues } from "@/lib/monitoring/historical-comparator";
import type { EntityEvaluation, MetricComparisons } from "@/lib/monitoring/types";
import type { HourlySeries } from "@/lib/monitoring/historical-comparator";

export function metrics(partial: Partial<MetricValues>): MetricValues {
  return { ...emptyMetrics(), ...partial };
}

/** Serie horaria plana: el valor diario se reparte igual en 24 horas. */
export function flatSeries(days: Record<string, Partial<MetricValues>>): HourlySeries {
  const s: HourlySeries = new Map();
  for (const [date, daily] of Object.entries(days)) {
    s.set(
      date,
      Array.from({ length: 24 }, () => {
        const m = emptyMetrics();
        for (const [k, v] of Object.entries(daily)) m[k as keyof MetricValues] = v === null ? null : (v as number) / 24;
        return m;
      }),
    );
  }
  return s;
}

/** Comparación sintética: current vs 4 muestras con leve variación alrededor de expected. */
export function cmp(current: number | null, expected: number) {
  const samples = [1.01, 0.99, 1.02, 0.98].map((f, i) => ({ date: `2026-09-${String(21 - 7 * i).padStart(2, "0")}`, value: expected * f }));
  return compareValues(current, samples, "mean", 2);
}

export function evaluation(opts: {
  level?: EntityEvaluation["level"];
  spend: [number | null, number];
  result?: [number | null, number];
  clicks?: [number | null, number];
  objective?: keyof typeof OBJECTIVE_KPI;
  status?: EntityEvaluation["status"];
  dataState?: EntityEvaluation["dataState"];
  share?: number;
  cutoffHour?: number;
  key?: string;
  platform?: EntityEvaluation["platform"];
  recentSpend?: [number | null, number];
}): EntityEvaluation {
  const objective = opts.objective ?? "SALES";
  const kpi = OBJECTIVE_KPI[objective];
  const cumulative: MetricComparisons = { spend: cmp(opts.spend[0], opts.spend[1]) };
  if (opts.result) cumulative[kpi.result] = cmp(opts.result[0], opts.result[1]);
  if (opts.clicks) cumulative.clicks = cmp(opts.clicks[0], opts.clicks[1]);
  if (opts.result) {
    const cur = opts.spend[0] !== null && opts.result[0] ? opts.spend[0] / opts.result[0] : null;
    cumulative.cpr = cmp(cur, opts.spend[1] / opts.result[1]);
  }
  const level = opts.level ?? "campaign";
  const platform = opts.platform ?? "meta";
  return {
    key: opts.key ?? `${level}:${platform}:x1`,
    level,
    platform,
    accountId: level === "platform" ? null : "acc-1",
    accountName: level === "platform" ? null : "Cuenta 1",
    campaignId: level === "campaign" ? "x1" : null,
    campaignName: level === "campaign" ? "Campaña X" : null,
    objective,
    kpi,
    status: opts.status ?? (level === "campaign" ? "ACTIVE" : null),
    dataState: opts.dataState ?? "OK",
    dataStateReason: opts.dataState && opts.dataState !== "OK" ? "Sin datos nuevos desde hace 3 h" : null,
    dataSeverity: opts.dataState && opts.dataState !== "OK" ? "ATTENTION" : "NORMAL",
    lastDataAt: null,
    lagMinutes: null,
    cutoffHour: opts.cutoffHour ?? 12,
    cumulative,
    recent: opts.recentSpend ? { spend: cmp(opts.recentSpend[0], opts.recentSpend[1]) } : null,
    recentFromHour: (opts.cutoffHour ?? 12) - 2,
    expectedSpendShare: opts.share ?? 0.3,
    excludedAccounts: [],
  };
}

export const metricIds = (m: MetricId) => m;
