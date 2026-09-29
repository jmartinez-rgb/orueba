import { addDays, sameWeekdayDates } from "@/lib/time/tz";
import { mean, median } from "./historical-comparator";
import type { SustainedLevel } from "./types";

/**
 * Cambio sostenido: los últimos `days` días completos gastaron, todos, por encima o por debajo de su
 * referencia (mismo día de las semanas anteriores) más allá del umbral de atención. Sirve para no
 * tratar como falla de hoy una reasignación de presupuesto que ya lleva días.
 * `valueOn(fecha)` devuelve el gasto del día, 0 si no gastó, o null si la fuente no tiene esa fecha.
 */
export function sustainedLevel(params: {
  date: string;
  days: number;
  weeks: number;
  baseline: "mean" | "median";
  minSamples: number;
  threshold: number;
  valueOn: (date: string) => number | null;
}): SustainedLevel | null {
  const { date, days, weeks, baseline, minSamples, threshold, valueOn } = params;
  let actual = 0;
  let reference = 0;
  let direction: SustainedLevel["direction"] | null = null;
  for (let i = 1; i <= days; i++) {
    const d = addDays(date, -i);
    const a = valueOn(d);
    const refs = sameWeekdayDates(d, weeks)
      .map(valueOn)
      .filter((v): v is number => v !== null);
    const b = refs.length >= minSamples ? (baseline === "median" ? median(refs) : mean(refs)) : null;
    if (a === null || b === null || b <= 0) return null;
    const dir = a / b <= 1 - threshold ? "down" : a / b >= 1 + threshold ? "up" : null;
    if (!dir || (direction && dir !== direction)) return null;
    direction = dir;
    actual += a;
    reference += b;
  }
  return direction ? { ratio: actual / reference, days, direction } : null;
}
