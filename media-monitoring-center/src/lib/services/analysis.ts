import "server-only";
import type { MetricId, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { addMetrics, emptyMetrics, metricValue, METRICS, OBJECTIVE_KPI } from "@/lib/metrics";
import { PLATFORMS } from "@/lib/platforms/registry";
import { addDays, diffDays, hourLabel, sameWeekdayDates, shortDateLabel, weekdayOf } from "@/lib/time/tz";
import { cumulativeByHour, delta, mean, median, windowTotals, type HourlySeries } from "@/lib/monitoring/historical-comparator";
import type { HourlyRow } from "@/lib/types";
import type { AppContext } from "./context";

/** Métricas permitidas en Compare / Historical (derivadas siempre desde totales). */
export const ANALYSIS_METRICS: MetricId[] = ["spend", "conversions", "cpa", "whatsapp", "leads", "sales", "ctr", "cpc", "cpl", "cpm", "impressions", "clicks"];

const KPI = OBJECTIVE_KPI.CONVERSIONS;

function toSeries(rows: HourlyRow[]): Map<PlatformId | "total", HourlySeries> {
  const out = new Map<PlatformId | "total", HourlySeries>();
  const add = (key: PlatformId | "total", r: HourlyRow) => {
    let s = out.get(key);
    if (!s) {
      s = new Map();
      out.set(key, s);
    }
    let day = s.get(r.date);
    if (!day) {
      day = Array.from({ length: 24 }, () => null);
      s.set(r.date, day);
    }
    const cur = day[r.hour];
    if (cur) addMetrics(cur, r.metrics);
    else day[r.hour] = addMetrics(emptyMetrics(), r.metrics);
  };
  for (const r of rows) {
    add(r.platform, r);
    add("total", r);
  }
  return out;
}

export interface CompareColumn {
  key: string;
  date: string;
  label: string;
  kind: "base" | "week" | "custom";
}

export interface CompareResult {
  date: string;
  cutoffHour: number;
  metric: MetricId;
  metricLabel: string;
  scope: PlatformId | "total";
  columns: CompareColumn[];
  rows: Array<{ id: PlatformId | "total"; name: string; values: Array<number | null>; avg: number | null; median: number | null; vsPrev: number | null; vsAvg: number | null; vsMedian: number | null }>;
  series: Array<Record<string, number | string | null>>;
}

export async function getCompare(
  ctx: AppContext,
  params: { date: string; cutoffHour: number; weeksBack: number[]; customDates: string[]; metric: MetricId; scope: PlatformId | "total" },
): Promise<CompareResult> {
  const { date, cutoffHour, metric, scope } = params;
  const weeks = [...new Set(params.weeksBack.filter((w) => w >= 1 && w <= 12))].sort((a, b) => a - b);
  const custom = [...new Set(params.customDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== date))].slice(0, 4);
  const columns: CompareColumn[] = [
    { key: "c0", date, label: `${shortDateLabel(date)} (base)`, kind: "base" },
    ...weeks.map((w, i) => ({ key: `c${i + 1}`, date: addDays(date, -7 * w), label: `${shortDateLabel(addDays(date, -7 * w))} (−${w} sem)`, kind: "week" as const })),
    ...custom.map((d, i) => ({ key: `c${weeks.length + i + 1}`, date: d, label: shortDateLabel(d), kind: "custom" as const })),
  ];
  const rows = await ctx.source.getHourly({ dates: columns.map((c) => c.date), level: "platform" });
  const series = toSeries(rows);
  const scopes: Array<PlatformId | "total"> = [...PLATFORM_IDS, "total"];
  const outRows = scopes.map((id) => {
    const s: HourlySeries = series.get(id) ?? new Map();
    const values = columns.map((c) => {
      const t = windowTotals(s, c.date, 0, cutoffHour);
      return t ? metricValue(t, metric, KPI) : null;
    });
    const weekVals = values.slice(1, 1 + weeks.length).filter((v): v is number => v !== null);
    const avg = mean(weekVals);
    const med = median(weekVals);
    const prevIdx = weeks.indexOf(1);
    const prev = prevIdx >= 0 ? values[prevIdx + 1] : values[1] ?? null;
    return {
      id,
      name: id === "total" ? "Total izzi" : PLATFORMS[id].name,
      values,
      avg,
      median: med,
      vsPrev: delta(values[0], prev),
      vsAvg: delta(values[0], avg),
      vsMedian: delta(values[0], med),
    };
  });
  const scopeSeries: HourlySeries = series.get(scope) ?? new Map();
  const cum = columns.map((c) => cumulativeByHour(scopeSeries, c.date, metric, KPI, c.kind === "base" ? cutoffHour : 24));
  const chart = Array.from({ length: 24 }, (_, h) => {
    const pt: Record<string, number | string | null> = { hour: h + 1, label: hourLabel(h + 1) };
    columns.forEach((c, i) => (pt[c.key] = cum[i][h]));
    return pt;
  });
  return { date, cutoffHour, metric, metricLabel: METRICS[metric].label, scope, columns, rows: outRows, series: chart };
}

export interface HistoricalResult {
  from: string;
  to: string;
  weeks: number;
  metric: MetricId;
  metricLabel: string;
  days: Array<{ date: string; label: string; weekday: number } & Partial<Record<PlatformId | "total", number | null>>>;
  weekdayProfile: Array<{ weekday: number; avg: number | null }>;
  sameWeekday: Array<{ date: string; value: number | null }>;
  heatmap: number[][];
  cutoffHour: number;
}

export async function getHistorical(ctx: AppContext, params: { today: string; weeks: number; metric: MetricId; cutoffHour: number }): Promise<HistoricalResult> {
  const { today, weeks, metric, cutoffHour } = params;
  const to = addDays(today, -1);
  const from = addDays(today, -7 * weeks);
  const daily = await ctx.source.getDaily({ from, to: today, level: "platform" });
  const byDay = new Map<string, Map<PlatformId | "total", ReturnType<typeof emptyMetrics>>>();
  for (const r of daily) {
    let m = byDay.get(r.date);
    if (!m) {
      m = new Map();
      byDay.set(r.date, m);
    }
    for (const k of [r.platform, "total"] as const) {
      const cur = m.get(k) ?? emptyMetrics();
      addMetrics(cur, r.metrics);
      m.set(k, cur);
    }
  }
  const days: HistoricalResult["days"] = [];
  const n = diffDays(to, from);
  for (let i = 0; i <= n; i++) {
    const d = addDays(from, i);
    const m = byDay.get(d);
    const row: HistoricalResult["days"][number] = { date: d, label: shortDateLabel(d), weekday: weekdayOf(d) };
    for (const k of [...PLATFORM_IDS, "total"] as const) {
      const t = m?.get(k);
      row[k] = t ? metricValue(t, metric, KPI) : null;
    }
    days.push(row);
  }
  const weekdayProfile = Array.from({ length: 7 }, (_, wd) => {
    const vals = days.filter((d) => d.weekday === wd).map((d) => d.total).filter((v): v is number => v !== null && v !== undefined);
    return { weekday: wd, avg: mean(vals) };
  });
  // Mismo día de la semana a la misma hora de corte (regla principal) en todo el periodo.
  const sameDates = sameWeekdayDates(today, weeks);
  const hourly = await ctx.source.getHourly({ dates: [today, ...sameDates], level: "platform" });
  const series: HourlySeries = toSeries(hourly).get("total") ?? new Map();
  const sameWeekday = [...sameDates].reverse().concat([today]).map((d) => {
    const t = windowTotals(series, d, 0, cutoffHour);
    return { date: d, value: t ? metricValue(t, metric, KPI) : null };
  });
  // Mapa de calor día × hora (gasto promedio) con las mismas fechas de referencia.
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const cnt = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const heatDates = Array.from({ length: Math.min(28, 7 * weeks) }, (_, i) => addDays(today, -(i + 1)));
  const heatRows = await ctx.source.getHourly({ dates: heatDates, level: "platform" });
  const heatSeries: HourlySeries = toSeries(heatRows).get("total") ?? new Map();
  for (const d of heatDates) {
    const hours = heatSeries.get(d);
    if (!hours) continue;
    const wd = weekdayOf(d);
    hours.forEach((v, h) => {
      if (v?.spend !== null && v?.spend !== undefined) {
        heat[wd][h] += v.spend;
        cnt[wd][h] += 1;
      }
    });
  }
  const heatmap = heat.map((row, wd) => row.map((v, h) => (cnt[wd][h] ? v / cnt[wd][h] : 0)));
  return { from, to, weeks, metric, metricLabel: METRICS[metric].label, days, weekdayProfile, sameWeekday, heatmap, cutoffHour };
}
