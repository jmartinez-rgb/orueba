/** Utilidades comunes de presupuestos: días de un periodo y promedio diario de un total. */

const DAY = 86_400_000;

/** Fecha YYYY-MM-DD al inicio de un texto (acepta "2026-10-05 23:59:59" o ISO). */
export function datePart(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Días calendario entre dos fechas, ambas incluidas; null si falta alguna o están invertidas. */
export function inclusiveDays(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from),
    b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / DAY) + 1;
}

/** Promedio diario de un presupuesto total a lo largo de su periodo (estimación). */
export function averageDaily(total: number | null, from: string | null, to: string | null): number | null {
  const days = inclusiveDays(from, to);
  return total === null || days === null ? null : total / days;
}

/** Fecha de hoy en una zona IANA; UTC si la zona no es válida. */
export function todayIn(timezone: string | null, now = new Date()): string {
  try {
    if (timezone) return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    // zona inválida: se usa UTC
  }
  return now.toISOString().slice(0, 10);
}
