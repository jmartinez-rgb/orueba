/**
 * Utilidades de tiempo con zona horaria de negocio.
 *
 * Todas las comparaciones (lunes vs lunes, hora vs hora) se hacen con fechas y horas
 * de negocio en la zona configurada. Los instantes se guardan en UTC (ISO) y solo se
 * convierten a hora local con estas funciones: nunca se mezcla UTC con hora local.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number; // 0..23
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha de negocio YYYY-MM-DD del instante dado. */
export function businessDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseDate(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

/** Suma días a una fecha de negocio (aritmética de calendario, independiente de zona). */
export function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function diffDays(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86400000);
}

/** Día de la semana de una fecha de negocio (0 = domingo). */
export function weekdayOf(dateStr: string): number {
  const { y, m, d } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Offset (ms) de la zona respecto a UTC en un instante. */
function tzOffsetMs(instant: number, tz: string): number {
  const p = zonedParts(new Date(instant), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Convierte fecha + hora local de negocio a instante UTC. */
export function zonedTimeToUtc(dateStr: string, hour: number, minute: number, tz: string): Date {
  const { y, m, d } = parseDate(dateStr);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let offset = tzOffsetMs(guess, tz);
  let result = guess - offset;
  // Segunda pasada por si el offset cambia (horario de verano).
  const offset2 = tzOffsetMs(result, tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset;
  }
  return new Date(result);
}

/** Mismo día de la semana en las N semanas anteriores: [fecha-7, fecha-14, ...]. */
export function sameWeekdayDates(dateStr: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => addDays(dateStr, -7 * (i + 1)));
}

export function hourLabel(hour: number): string {
  return `${pad(hour % 24 === 0 && hour > 0 ? 24 : hour)}:00`;
}

export function formatTimeInTz(iso: string | Date | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const p = zonedParts(d, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTimeInTz(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = zonedParts(d, tz);
  return `${pad(p.day)} ${MONTHS_SHORT[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}

export const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const WEEKDAYS_SHORT_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "lunes 28 de septiembre" */
export function longDateLabel(dateStr: string): string {
  const { m, d } = parseDate(dateStr);
  return `${WEEKDAYS_ES[weekdayOf(dateStr)]} ${d} de ${MONTHS_ES[m - 1]}`;
}

/** "lun 21 sep" */
export function shortDateLabel(dateStr: string): string {
  const { m, d } = parseDate(dateStr);
  return `${WEEKDAYS_SHORT_ES[weekdayOf(dateStr)]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

export function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (h < 24) return m === 0 ? `${h} h` : `${h} h ${m} min`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d} d` : `${d} d ${rh} h`;
}
