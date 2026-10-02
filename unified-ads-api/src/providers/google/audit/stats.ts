/**
 * Pruebas estadísticas sencillas para no confundir ruido con tendencia. Las conversiones de Google
 * pueden ser fraccionarias (atribución basada en datos); se redondean hacia abajo para las pruebas.
 */

function erf(x: number): number {
  // Abramowitz y Stegun 7.1.26 (error < 1.5e-7).
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * p-valor unilateral de que la tasa actual (x2/n2) sea MENOR que la base (x1/n1).
 * Devuelve null si no hay datos suficientes para la prueba.
 */
export function rateDropP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = Math.min(1, x1 / n1),
    p2 = Math.min(1, x2 / n2);
  const pooled = Math.min(1, (x1 + x2) / (n1 + n2));
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  return normalCdf((p2 - p1) / se);
}

function logFactorial(k: number): number {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

/** P(X <= k) con X ~ Poisson(lambda). Exacta hasta lambda 200; después, aproximación normal. */
export function poissonLowerTail(k: number, lambda: number): number {
  const kk = Math.floor(k);
  if (lambda <= 0) return 1;
  if (kk < 0) return 0;
  if (lambda > 200) return normalCdf((kk + 0.5 - lambda) / Math.sqrt(lambda));
  let sum = 0;
  for (let i = 0; i <= kk; i++) sum += Math.exp(i * Math.log(lambda) - lambda - logFactorial(i));
  return Math.min(1, sum);
}

/**
 * ¿Las conversiones observadas están por debajo de lo esperado con la eficiencia base?
 * expected = gasto actual / CPA base. p-valor unilateral (bajo = caída real).
 */
export function conversionShortfallP(observed: number, expected: number): number | null {
  if (!(expected > 0)) return null;
  return poissonLowerTail(observed, expected);
}
