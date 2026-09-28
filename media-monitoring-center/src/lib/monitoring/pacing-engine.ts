import type { DailyPacing } from "./types";
import type { HourlySeries } from "./historical-comparator";
import { delta } from "./historical-comparator";

/**
 * PacingEngine: no asume gasto lineal. Con histórico suficiente usa la CURVA HORARIA
 * HISTÓRICA del mismo día de la semana (p. ej. "a las 12:00 Meta ya gastó 42% del día").
 */

export interface HourlyCurve {
  /** cumShare[h] = fracción del gasto diario acumulada al terminar la hora h (0..23). */
  cumShare: number[];
  source: "historical" | "linear";
  daysUsed: number;
}

const LINEAR: number[] = Array.from({ length: 24 }, (_, h) => (h + 1) / 24);

export function buildHourlyCurve(series: HourlySeries, referenceDates: string[], minDays = 2): HourlyCurve {
  const curves: number[][] = [];
  for (const date of referenceDates) {
    const hours = series.get(date);
    if (!hours) continue;
    // Solo días completos (24 horas con dato) para no sesgar la curva.
    if (hours.some((h) => !h || h.spend === null)) continue;
    const total = hours.reduce((a, h) => a + (h?.spend ?? 0), 0);
    if (total <= 0) continue;
    let acc = 0;
    curves.push(hours.map((h) => (acc += h?.spend ?? 0) / total));
  }
  if (curves.length < minDays) return { cumShare: LINEAR, source: "linear", daysUsed: curves.length };
  const cumShare = Array.from({ length: 24 }, (_, h) => curves.reduce((a, c) => a + c[h], 0) / curves.length);
  cumShare[23] = 1;
  return { cumShare, source: "historical", daysUsed: curves.length };
}

/** Participación esperada del día transcurrida a la hora de corte (ventana [0, cutoffHour)). */
export function shareAtCutoff(curve: HourlyCurve, cutoffHour: number): number {
  if (cutoffHour <= 0) return 0;
  if (cutoffHour >= 24) return 1;
  return curve.cumShare[cutoffHour - 1];
}

export function dailyPacing(params: {
  spend: number | null;
  cutoffHour: number;
  curve: HourlyCurve;
  dailyBudget: number | null;
}): DailyPacing {
  const { spend, cutoffHour, curve, dailyBudget } = params;
  const share = shareAtCutoff(curve, cutoffHour);
  const expectedByCurve = dailyBudget !== null ? dailyBudget * share : null;
  const forecastClose = spend !== null && share > 0.02 ? spend / share : null;
  return {
    dailyBudget,
    spend,
    expectedByCurve,
    curveShare: share,
    curveSource: curve.source,
    pctOfExpected: spend !== null && expectedByCurve ? spend / expectedByCurve : null,
    deviation: delta(spend, expectedByCurve),
    forecastClose,
    forecastVsBudget: delta(forecastClose, dailyBudget),
  };
}

export interface MonthlyPacing {
  budget: number | null;
  spend: number;
  remaining: number | null;
  usedPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  forecast: number;
  forecastVsBudget: number | null;
}

/**
 * Pacing mensual: gasto del mes vs presupuesto, % esperado según días transcurridos y
 * pronóstico de cierre = gasto del mes + resto de hoy (curva) + días restantes al ritmo
 * reciente del mismo día de la semana.
 */
export function monthlyPacing(params: {
  budget: number | null;
  monthToDateSpend: number;
  todaySpend: number;
  todayForecast: number | null;
  elapsedFullDays: number;
  todayShare: number;
  daysInMonth: number;
  /** Gasto promedio reciente por día de la semana (0 = domingo). */
  weekdayAverages: number[];
  /** Días de la semana de los días restantes del mes (sin hoy). */
  remainingWeekdays: number[];
}): MonthlyPacing {
  const { budget, monthToDateSpend, todaySpend, todayForecast, elapsedFullDays, todayShare, daysInMonth } = params;
  const remainingToday = todayForecast !== null ? Math.max(0, todayForecast - todaySpend) : 0;
  const rest = params.remainingWeekdays.reduce((a, wd) => a + (params.weekdayAverages[wd] ?? 0), 0);
  const forecast = monthToDateSpend + remainingToday + rest;
  const expectedPct = (elapsedFullDays + todayShare) / daysInMonth;
  const usedPct = budget ? monthToDateSpend / budget : null;
  return {
    budget,
    spend: monthToDateSpend,
    remaining: budget !== null ? budget - monthToDateSpend : null,
    usedPct,
    expectedPct,
    variance: usedPct !== null ? usedPct - expectedPct : null,
    forecast,
    forecastVsBudget: budget ? forecast / budget - 1 : null,
  };
}
