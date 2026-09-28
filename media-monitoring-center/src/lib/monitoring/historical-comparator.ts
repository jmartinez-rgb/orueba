import type { MetricId, MetricValues } from "@/lib/types";
import { BASE_METRICS, DERIVED_METRICS } from "@/lib/types";
import { emptyMetrics, metricValue, addMetrics, type Kpi } from "@/lib/metrics";
import type { MetricComparison, MetricComparisons } from "./types";

/**
 * Comparador histórico: REGLA PRINCIPAL = mismo día de la semana + misma franja horaria.
 * Hoy 00:00–12:00 se compara contra el mismo día de las N semanas anteriores 00:00–12:00.
 */

/** Serie horaria de una entidad por fecha: 24 posiciones, null = sin fila en esa hora. */
export type HourlySeries = Map<string, Array<MetricValues | null>>;

/** Suma horas [from, to) respetando NULL. Devuelve null si ninguna hora tiene datos. */
export function windowTotals(series: HourlySeries, date: string, from: number, to: number): MetricValues | null {
  const hours = series.get(date);
  if (!hours) return null;
  const acc = emptyMetrics();
  let has = false;
  for (let h = Math.max(0, from); h < Math.min(24, to); h++) {
    const v = hours[h];
    if (v) {
      addMetrics(acc, v);
      has = true;
    }
  }
  return has ? acc : null;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** Variación relativa: (actual - referencia) / referencia. null si no se puede calcular. */
export function delta(current: number | null, reference: number | null): number | null {
  if (current === null || reference === null) return null;
  if (reference === 0) return current === 0 ? 0 : null;
  return (current - reference) / reference;
}

export function compareValues(
  current: number | null,
  samples: Array<{ date: string; value: number | null }>,
  baseline: "mean" | "median",
  minSamples: number,
): MetricComparison {
  const vals = samples.map((s) => s.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const enough = vals.length >= minSamples;
  const m = enough ? mean(vals) : null;
  const md = enough ? median(vals) : null;
  const expected = baseline === "median" ? md : m;
  const sd = enough ? stdDev(vals) : null;
  const prevWeek = samples[0]?.value ?? null;
  return {
    current,
    prevWeek,
    mean: m,
    median: md,
    expected,
    samples,
    sampleCount: vals.length,
    deltaVsPrevWeek: delta(current, prevWeek),
    deltaVsMean: delta(current, m),
    deltaVsMedian: delta(current, md),
    deltaVsExpected: delta(current, expected),
    stdDev: sd,
    zScore: current !== null && expected !== null && sd !== null && sd > 0 ? (current - expected) / sd : null,
  };
}

/**
 * Compara una ventana horaria de hoy contra las mismas ventanas de las fechas de referencia.
 * Las métricas derivadas (CPA, CPL, CTR...) se calculan desde totales: el esperado es
 * SUMA(costo esperado) ÷ SUMA(resultado esperado), nunca un promedio de CPAs.
 */
export function compareWindow(params: {
  series: HourlySeries;
  date: string;
  referenceDates: string[];
  fromHour: number;
  toHour: number;
  kpi: Kpi;
  baseline: "mean" | "median";
  minSamples: number;
  metrics?: MetricId[];
}): MetricComparisons {
  const { series, date, referenceDates, fromHour, toHour, kpi, baseline, minSamples } = params;
  const current = windowTotals(series, date, fromHour, toHour);
  const refs = referenceDates.map((d) => ({ date: d, totals: windowTotals(series, d, fromHour, toHour) }));
  const wanted = params.metrics ?? [...BASE_METRICS, ...DERIVED_METRICS];
  const out: MetricComparisons = {};

  const baseComparisons = new Map<MetricId, MetricComparison>();
  for (const m of BASE_METRICS) {
    const cur = current ? current[m] : null;
    const samples = refs.map((r) => ({ date: r.date, value: r.totals ? r.totals[m] : null }));
    baseComparisons.set(m, compareValues(cur, samples, baseline, minSamples));
  }

  for (const m of wanted) {
    const isBase = (BASE_METRICS as MetricId[]).includes(m);
    if (isBase) {
      out[m] = baseComparisons.get(m)!;
      continue;
    }
    const cur = current ? metricValue(current, m, kpi) : null;
    const samples = refs.map((r) => ({ date: r.date, value: r.totals ? metricValue(r.totals, m, kpi) : null }));
    const cmp = compareValues(cur, samples, baseline, minSamples);
    // Esperado y referencias de métricas derivadas = cociente de totales esperados.
    const expectedTotals = emptyMetrics();
    const meanTotals = emptyMetrics();
    const medianTotals = emptyMetrics();
    for (const b of BASE_METRICS) {
      const c = baseComparisons.get(b)!;
      expectedTotals[b] = c.expected;
      meanTotals[b] = c.mean;
      medianTotals[b] = c.median;
    }
    const expected = cmp.sampleCount >= minSamples ? metricValue(expectedTotals, m, kpi) : null;
    const meanV = cmp.sampleCount >= minSamples ? metricValue(meanTotals, m, kpi) : null;
    const medianV = cmp.sampleCount >= minSamples ? metricValue(medianTotals, m, kpi) : null;
    out[m] = {
      ...cmp,
      expected,
      mean: meanV,
      median: medianV,
      deltaVsExpected: delta(cur, expected),
      deltaVsMean: delta(cur, meanV),
      deltaVsMedian: delta(cur, medianV),
      zScore: cur !== null && expected !== null && cmp.stdDev ? (cur - expected) / cmp.stdDev : null,
    };
  }
  return out;
}

/** Serie acumulada por hora (fin de hora 1..24) de una métrica para una fecha. */
export function cumulativeByHour(series: HourlySeries, date: string, metric: MetricId, kpi: Kpi, upTo = 24): Array<number | null> {
  const hours = series.get(date);
  const out: Array<number | null> = [];
  const acc = emptyMetrics();
  let has = false;
  for (let h = 0; h < 24; h++) {
    if (h >= upTo) {
      out.push(null);
      continue;
    }
    const v = hours?.[h];
    if (v) {
      addMetrics(acc, v);
      has = true;
    }
    out.push(has ? metricValue(acc, metric, kpi) : null);
  }
  return out;
}
