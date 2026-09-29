import type { PlatformId } from "@/lib/types";
import type { LearnedCurves } from "./transform";

/**
 * Memoria del acumulado del día para plataformas sin pestaña por hora (p. ej. TikTok).
 *
 * Dataslayer sobrescribe la fila de hoy en cada actualización (cada 2 h), así que la hoja no guarda
 * cómo avanzó el gasto durante el día. La app anota el acumulado de cada cuenta a la hora de cada
 * actualización y, cuando el día cierra, lo divide entre el total final: con unos días sale la curva
 * horaria real de la cuenta y de la plataforma, sin pedirle nada más a Dataslayer.
 */

/** Acumulado de gasto por cuenta a la hora `h` (hora de negocio con decimales, 0–24). */
export interface IntradayPoint {
  h: number;
  spend: Record<string, number>;
}

/** Fecha → acumulados anotados ese día. */
export type IntradayDays = Record<string, IntradayPoint[]>;

export interface CurveMemory {
  load(platform: PlatformId): Promise<IntradayDays>;
  record(platform: PlatformId, date: string, point: IntradayPoint): Promise<void>;
}

/** Agrega un acumulado (reemplaza el de la misma actualización) y conserva los últimos `keepDays` días. */
export function addPoint(days: IntradayDays, date: string, point: IntradayPoint, keepDays = 35): IntradayDays {
  const list = (days[date] ?? []).filter((p) => Math.abs(p.h - point.h) >= 0.05);
  list.push(point);
  list.sort((a, b) => a.h - b.h);
  const out: IntradayDays = { ...days, [date]: list };
  const dates = Object.keys(out).sort();
  for (const d of dates.slice(0, Math.max(0, dates.length - keepDays))) delete out[d];
  return out;
}

/** Acumulado (0–1) al cierre de cada hora 1..24, interpolando entre los puntos conocidos. */
function cumulativeByHour(points: Array<[number, number]>): number[] {
  const known: Array<[number, number]> = [[0, 0]];
  let max = 0;
  for (const [h, share] of [...points].sort((a, b) => a[0] - b[0])) {
    if (h <= 0 || h >= 24) continue;
    max = Math.max(max, Math.min(1, Math.max(0, share)));
    known.push([h, max]);
  }
  known.push([24, 1]);
  return Array.from({ length: 24 }, (_, i) => {
    const h = i + 1;
    let k = 0;
    while (k < known.length - 2 && known[k + 1][0] < h) k++;
    const [h0, s0] = known[k];
    const [h1, s1] = known[k + 1];
    return h1 === h0 ? s1 : s0 + ((s1 - s0) * (h - h0)) / (h1 - h0);
  });
}

function averageCurve(days: number[][], minDays: number): number[] | null {
  if (days.length < minDays) return null;
  const cum = Array.from({ length: 24 }, (_, h) => days.reduce((a, d) => a + d[h], 0) / days.length);
  const weights = cum.map((c, h) => Math.max(0, c - (h === 0 ? 0 : cum[h - 1])));
  const total = weights.reduce((a, b) => a + b, 0);
  return total > 0 ? weights.map((w) => w / total) : null;
}

/**
 * Curvas horarias aprendidas de los acumulados anotados en días ya cerrados.
 * `finals`: fecha → cuenta → gasto final del día (lo que dice la hoja hoy para esa fecha).
 * Un día cuenta si tiene al menos 2 acumulados y gasto final; se necesitan `minDays` días.
 */
export function curvesFromSnapshots(days: IntradayDays, finals: Map<string, Map<string, number>>, today: string, minDays = 3): LearnedCurves & { days: number } {
  const platformDays: number[][] = [];
  const accountDays = new Map<string, number[][]>();
  for (const [date, points] of Object.entries(days)) {
    if (date >= today || points.length < 2) continue;
    const final = finals.get(date);
    if (!final) continue;
    const total = [...final.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    platformDays.push(cumulativeByHour(points.map((p) => [p.h, Object.values(p.spend).reduce((a, b) => a + b, 0) / total])));
    for (const [id, f] of final) {
      if (f <= 0) continue;
      // Una cuenta sin fila en esa actualización todavía no había gastado.
      const curve = cumulativeByHour(points.map((p) => [p.h, (p.spend[id] ?? 0) / f]));
      const list = accountDays.get(id);
      if (list) list.push(curve);
      else accountDays.set(id, [curve]);
    }
  }
  const accounts = new Map<string, number[]>();
  for (const [id, list] of accountDays) {
    const c = averageCurve(list, minDays);
    if (c) accounts.set(id, c);
  }
  return { platform: averageCurve(platformDays, minDays), accounts, days: platformDays.length };
}
