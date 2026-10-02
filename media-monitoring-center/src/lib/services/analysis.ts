import "server-only";
import type { MetricId, MetricValues, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { addMetrics, addCompleteMetrics, emptyMetrics, isBaseMetric, metricValue, sumMetrics, METRICS, OBJECTIVE_KPI, OBJECTIVE_LABEL } from "@/lib/metrics";
import { DEFAULT_CLASSIFIERS } from "@/lib/classifiers/defaults";
import { classifyCampaign } from "@/lib/classifiers/classify";
import { PLATFORMS } from "@/lib/platforms/registry";
import { addDays, diffDays, hourLabel, sameWeekdayDates, shortDateLabel, weekdayOf } from "@/lib/time/tz";
import { cumulativeByHour, delta, mean, median, windowTotals, type HourlySeries } from "@/lib/monitoring/historical-comparator";
import type { HourlyRow } from "@/lib/types";
import type { AppContext } from "./context";

/** Métricas permitidas en Compare / Historical (derivadas siempre desde totales). */
export const ANALYSIS_METRICS: MetricId[] = ["spend", "conversions", "cpa", "whatsapp", "leads", "sales", "ctr", "cpc", "cpl", "cpm", "impressions", "clicks"];

const KPI = OBJECTIVE_KPI.CONVERSIONS;

/** Paired base metrics include zero-result days; a null component excludes that sample pair. */
function referenceRatio(totals: Array<MetricValues | null>, metric: MetricId): number | null {
  const numerator = metric === "ctr" ? "clicks" : metric === "roas" ? "revenue" : "spend";
  const denominator = metric === "ctr" || metric === "cpm" ? "impressions" : metric === "cpc" ? "clicks" : metric === "cpl" ? "leads" : metric === "roas" ? "spend" : KPI.result;
  const complete = totals.filter((total): total is MetricValues => total !== null && total[numerator] !== null && total[denominator] !== null);
  if (!complete.length) return null;
  const result = metricValue(sumMetrics(complete), metric, KPI);
  return result !== null && Number.isFinite(result) ? result : null;
}

function toSeries(rows: HourlyRow[], strict = false): Map<PlatformId | "total", HourlySeries> {
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
    if (cur) (strict ? addCompleteMetrics : addMetrics)(cur, r.metrics);
    else day[r.hour] = { ...r.metrics };
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

export type CompareDimension = "platform" | "account" | "strategy" | "objective" | "campaign";

export const DIMENSION_LABEL: Record<CompareDimension, string> = {
  platform: "Plataforma",
  account: "Cuenta",
  strategy: "Estrategia",
  objective: "Objetivo",
  campaign: "Campaña",
};

export interface CompareRow {
  id: string;
  name: string;
  sub: string | null;
  platform: PlatformId | null;
  values: Array<number | null>;
  avg: number | null;
  median: number | null;
  vsPrev: number | null;
  vsAvg: number | null;
  vsMedian: number | null;
  /** Gasto de la fecha base (para ordenar). */
  spend: number;
}

export interface CompareResult {
  date: string;
  cutoffHour: number;
  metric: MetricId;
  metricLabel: string;
  dimension: CompareDimension;
  platform: PlatformId | "all";
  focus: string;
  focusName: string;
  columns: CompareColumn[];
  rows: CompareRow[];
  total: CompareRow;
  truncated: number;
  series: Array<Record<string, number | string | null>>;
}

const MAX_ROWS = 60;
type AnalysisContext = Pick<AppContext, "mode" | "source" | "brandInfo" | "settings">;

export async function getCompare(
  ctx: AnalysisContext,
  params: { date: string; cutoffHour: number; weeksBack: number[]; customDates: string[]; metric: MetricId; dimension: CompareDimension; platform: PlatformId | "all"; focus: string | null },
): Promise<CompareResult> {
  const { date, cutoffHour, metric, dimension, platform } = params;
  const strict = ctx.mode === "unified";
  const weeks = [...new Set(params.weeksBack.filter((w) => w >= 1 && w <= 12))].sort((a, b) => a - b);
  const custom = [...new Set(params.customDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== date))].slice(0, 4);
  const columns: CompareColumn[] = [
    { key: "c0", date, label: `${shortDateLabel(date)} (base)`, kind: "base" },
    ...weeks.map((w, i) => ({ key: `c${i + 1}`, date: addDays(date, -7 * w), label: `${shortDateLabel(addDays(date, -7 * w))} (−${w} sem)`, kind: "week" as const })),
    ...custom.map((d, i) => ({ key: `c${weeks.length + i + 1}`, date: d, label: shortDateLabel(d), kind: "custom" as const })),
  ];
  const catalog = await ctx.source.getCatalog();
  const campaignById = new Map(catalog.campaigns.map((c) => [c.id, c]));
  const accountById = new Map(catalog.accounts.map((a) => [a.id, a]));
  const classifiers = { ...DEFAULT_CLASSIFIERS, ...ctx.settings.classifiers };
  const rows = await ctx.source.getHourly({ dates: columns.map((c) => c.date), level: dimension === "platform" ? "platform" : "campaign", platforms: platform === "all" ? undefined : [platform] });

  const groups = new Map<string, { name: string; sub: string | null; platform: PlatformId | null; series: HourlySeries }>();
  const total: HourlySeries = new Map();
  const add = (series: HourlySeries, r: HourlyRow) => {
    let day = series.get(r.date);
    if (!day) {
      day = Array.from({ length: 24 }, () => null);
      series.set(r.date, day);
    }
    const cur = day[r.hour];
    if (cur) (strict ? addCompleteMetrics : addMetrics)(cur, r.metrics);
    else day[r.hour] = { ...r.metrics };
  };
  for (const r of rows) {
    const camp = r.campaignId ? campaignById.get(r.campaignId) : undefined;
    const accountId = r.accountId ?? camp?.accountId ?? null;
    let key: string;
    let name: string;
    let sub: string | null = null;
    let p: PlatformId | null = r.platform;
    if (dimension === "platform") {
      key = r.platform;
      name = PLATFORMS[r.platform].name;
    } else if (dimension === "account") {
      key = accountId ?? `${r.platform}-sin-cuenta`;
      name = (accountId && accountById.get(accountId)?.name) || "Sin cuenta";
      sub = accountById.get(accountId ?? "")?.currency === "USD" ? "USD → MXN" : null;
    } else if (dimension === "strategy") {
      const label = camp ? classifyCampaign(classifiers[r.platform], camp) : "Sin clasificar";
      key = `${r.platform}|${label}`;
      name = label;
    } else if (dimension === "objective") {
      const objective = camp ? (ctx.settings.objectiveOverrides[camp.id] ?? camp.objective) : "CONVERSIONS";
      key = objective;
      name = OBJECTIVE_LABEL[objective];
      p = null;
    } else {
      key = r.campaignId ?? "sin-campana";
      name = camp?.name ?? r.campaignId ?? "Sin campaña";
      sub = accountId ? (accountById.get(accountId)?.name ?? null) : null;
    }
    let g = groups.get(key);
    if (!g) {
      g = { name, sub, platform: p, series: new Map() };
      groups.set(key, g);
    }
    add(g.series, r);
    if (!strict || dimension === "platform") add(total, r);
  }

  // Campaign/strategy groupings cannot establish coverage of an absent account. Build the
  // global direct-source total from the coverage-aware platform query instead of visible rows.
  if (strict && dimension !== "platform") {
    const complete = await ctx.source.getHourly({ dates: columns.map(c => c.date), level: "platform", platforms: platform === "all" ? undefined : [platform] });
    for (const row of complete) add(total, row);
  }

  const buildRow = (id: string, name: string, sub: string | null, p: PlatformId | null, series: HourlySeries): CompareRow => {
    const values = columns.map((c) => {
      const t = windowTotals(series, c.date, 0, cutoffHour, strict);
      return t ? metricValue(t, metric, KPI) : null;
    });
    const weekVals = values.slice(1, 1 + weeks.length).filter((v): v is number => v !== null);
    const avg = isBaseMetric(metric) ? mean(weekVals) : referenceRatio(columns.slice(1, 1 + weeks.length).map(c => windowTotals(series, c.date, 0, cutoffHour, strict)), metric);
    const med = median(weekVals);
    const prevIdx = weeks.indexOf(1);
    const prev = prevIdx >= 0 ? values[prevIdx + 1] : (values[1] ?? null);
    return {
      id,
      name,
      sub,
      platform: p,
      values,
      avg,
      median: med,
      vsPrev: delta(values[0], prev),
      vsAvg: delta(values[0], avg),
      vsMedian: delta(values[0], med),
      spend: windowTotals(series, date, 0, cutoffHour, strict)?.spend ?? 0,
    };
  };
  const all = [...groups.entries()].map(([id, g]) => buildRow(id, g.name, g.sub, g.platform, g.series)).sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  const totalName = platform === "all" ? `Total ${ctx.brandInfo.name}` : `Total ${PLATFORMS[platform].name}`;
  const totalRow = buildRow("total", totalName, null, platform === "all" ? null : platform, total);
  const focus = params.focus && groups.has(params.focus) ? params.focus : "total";
  const focusSeries = focus === "total" ? total : groups.get(focus)!.series;
  const cum = columns.map((c) => cumulativeByHour(focusSeries, c.date, metric, KPI, c.kind === "base" ? cutoffHour : 24, strict));
  const chart = Array.from({ length: 24 }, (_, h) => {
    const pt: Record<string, number | string | null> = { hour: h + 1, label: hourLabel(h + 1) };
    columns.forEach((c, i) => (pt[c.key] = cum[i][h]));
    return pt;
  });
  return {
    date,
    cutoffHour,
    metric,
    metricLabel: METRICS[metric].label,
    dimension,
    platform,
    focus,
    focusName: focus === "total" ? totalName : groups.get(focus)!.name,
    columns,
    rows: all.slice(0, MAX_ROWS),
    total: totalRow,
    truncated: Math.max(0, all.length - MAX_ROWS),
    series: chart,
  };
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
  heatmap: Array<Array<number | null>>;
  cutoffHour: number;
  /** Marca del monitoreo (para "Total izzi" / "Total Sky"). */
  brandName: string;
}

export async function getHistorical(ctx: AnalysisContext, params: { today: string; weeks: number; metric: MetricId; cutoffHour: number }): Promise<HistoricalResult> {
  const { today, weeks, metric, cutoffHour } = params;
  const strict = ctx.mode === "unified";
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
      const cur = m.get(k);
      if (cur) (strict ? addCompleteMetrics : addMetrics)(cur, r.metrics);
      else m.set(k, { ...r.metrics });
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
    const weekdayDays = days.filter((d) => d.weekday === wd);
    const vals = weekdayDays.map((d) => d.total).filter((v): v is number => v !== null && v !== undefined);
    const avg = isBaseMetric(metric) ? mean(vals) : referenceRatio(weekdayDays.map(d => byDay.get(d.date)?.get("total") ?? null), metric);
    return { weekday: wd, avg };
  });
  // Mismo día de la semana a la misma hora de corte (regla principal) en todo el periodo.
  const sameDates = sameWeekdayDates(today, weeks);
  const hourly = await ctx.source.getHourly({ dates: [today, ...sameDates], level: "platform" });
  const series: HourlySeries = toSeries(hourly, strict).get("total") ?? new Map();
  const sameWeekday = [...sameDates].reverse().concat([today]).map((d) => {
    const t = windowTotals(series, d, 0, cutoffHour, strict);
    return { date: d, value: t ? metricValue(t, metric, KPI) : null };
  });
  // Mapa de calor día × hora (gasto promedio) con las mismas fechas de referencia.
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const cnt = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const heatDates = Array.from({ length: Math.min(28, 7 * weeks) }, (_, i) => addDays(today, -(i + 1)));
  const heatRows = await ctx.source.getHourly({ dates: heatDates, level: "platform" });
  const heatSeries: HourlySeries = toSeries(heatRows, strict).get("total") ?? new Map();
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
  const heatmap = heat.map((row, wd) => row.map((v, h) => (cnt[wd][h] ? v / cnt[wd][h] : strict ? null : 0)));
  return { from, to, weeks, metric, metricLabel: METRICS[metric].label, days, weekdayProfile, sameWeekday, heatmap, cutoffHour, brandName: ctx.brandInfo.name };
}
