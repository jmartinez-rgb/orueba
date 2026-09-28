import type { PlatformId } from "@/lib/types";

/** Peso relativo de cada hora (0..23) en el gasto diario típico de cada plataforma. */
const RAW_CURVES: Record<PlatformId, number[]> = {
  // Meta gasta más temprano por presupuestos diarios: ~42% del día al corte de 12:00.
  meta: [3.0, 2.2, 1.5, 1.1, 1.0, 1.3, 2.4, 3.8, 4.9, 5.6, 5.9, 6.0, 5.4, 5.0, 4.8, 4.6, 4.4, 4.3, 4.3, 4.4, 4.5, 4.3, 3.8, 3.2],
  google: [0.8, 0.5, 0.35, 0.3, 0.35, 0.6, 1.3, 2.6, 4.0, 5.2, 5.9, 6.2, 6.2, 6.1, 6.0, 5.9, 5.8, 5.8, 5.9, 5.9, 5.6, 4.9, 3.7, 2.2],
  tiktok: [3.5, 2.5, 1.6, 1.0, 0.7, 0.7, 1.1, 1.9, 2.8, 3.4, 3.8, 4.1, 4.3, 4.4, 4.5, 4.6, 4.8, 5.1, 5.6, 6.2, 6.8, 7.0, 6.4, 5.0],
  microsoft: [0.5, 0.3, 0.2, 0.2, 0.3, 0.6, 1.5, 3.2, 5.0, 6.3, 6.8, 6.9, 6.6, 6.5, 6.4, 6.2, 6.0, 5.6, 5.0, 4.4, 3.8, 3.2, 2.3, 1.2],
  spotify: [1.5, 1.0, 0.7, 0.5, 0.6, 1.4, 3.5, 5.8, 6.4, 5.6, 4.9, 4.7, 4.9, 4.8, 4.6, 4.8, 5.3, 6.0, 6.2, 5.7, 5.0, 4.3, 3.4, 2.4],
  x: [2.5, 1.8, 1.2, 0.8, 0.7, 0.9, 1.8, 3.2, 4.3, 4.9, 5.2, 5.3, 5.3, 5.2, 5.1, 5.0, 5.0, 5.2, 5.4, 5.6, 5.6, 5.2, 4.5, 3.4],
};

export const HOURLY_SHARE: Record<PlatformId, number[]> = Object.fromEntries(
  Object.entries(RAW_CURVES).map(([k, arr]) => {
    const total = arr.reduce((a, b) => a + b, 0);
    return [k, arr.map((v) => v / total)];
  }),
) as Record<PlatformId, number[]>;

/** Factor por día de la semana (0 = domingo) para gasto y para costo por resultado. */
export const DOW_SPEND = [0.86, 1.04, 1.02, 1.0, 1.0, 0.97, 0.9];
export const DOW_COST = [1.1, 1.0, 1.0, 1.0, 1.0, 1.02, 1.05];

/** Crecimiento diario suave del histórico. */
export const DAILY_TREND = 0.0008;
