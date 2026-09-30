/**
 * Fórmulas normalizadas. Nunca devuelven NaN ni Infinity: si el denominador es 0, nulo o no
 * numérico, el resultado es null.
 */

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/** CTR en porcentaje: clics / impresiones × 100. */
export const ctr = (clicks: number | null | undefined, impressions: number | null | undefined) => {
  const r = safeDivide(clicks, impressions);
  return r === null ? null : r * 100;
};

/** CPC: gasto / clics. */
export const cpc = (spend: number | null | undefined, clicks: number | null | undefined) => safeDivide(spend, clicks);

/** CPM: gasto / impresiones × 1000. */
export const cpm = (spend: number | null | undefined, impressions: number | null | undefined) => {
  const r = safeDivide(spend, impressions);
  return r === null ? null : r * 1000;
};

/** CPA: gasto / conversiones (suma de costos entre suma de conversiones; nunca promediar CPAs). */
export const cpa = (spend: number | null | undefined, conversions: number | null | undefined) =>
  safeDivide(spend, conversions);

/** Redondeo para respuestas (evita 0.30000000000000004). */
export function round(v: number | null, decimals = 4): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Métricas derivadas a partir de las base. */
export function derivedMetrics(m: {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
}) {
  return {
    ctr: round(ctr(m.clicks, m.impressions)),
    cpc: round(cpc(m.spend, m.clicks)),
    cpm: round(cpm(m.spend, m.impressions)),
    cpa: round(cpa(m.spend, m.conversions)),
  };
}

/** Google Ads reporta costos en micros (1,000,000 = 1 unidad de moneda). */
export function microsToCurrency(micros: number | string | null | undefined): number | null {
  if (micros === null || micros === undefined || micros === "") return null;
  const n = typeof micros === "string" ? Number(micros) : micros;
  return Number.isFinite(n) ? n / 1_000_000 : null;
}
