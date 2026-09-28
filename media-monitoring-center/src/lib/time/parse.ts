import { zonedTimeToUtc } from "./tz";

/**
 * Fecha y hora de una hoja o tabla de control ("última ejecución") → ISO UTC.
 *
 * Acepta lo que suelen escribir Apps Script, Dataslayer o una persona:
 * - número de serie de Google Sheets (días desde 1899-12-30, hora local de la hoja);
 * - ISO con zona ("2026-09-28T16:05:00Z", "2026-09-28 16:05:00+00" de BigQuery);
 * - fecha y hora sin zona ("2026-09-28 10:05", "28/09/2026 10:05:00", "28/09/2026 10:05 a. m."),
 *   que se interpretan en la zona horaria de negocio (nunca en la del servidor).
 * Las fechas con diagonal van día/mes/año (formato de México); si el segundo número pasa de 12,
 * se toma como mes/día. Devuelve null si no se reconoce: nunca inventa una hora.
 */
export function parseDateTimeLoose(value: unknown, tz: string): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return parseDateTimeLoose((value as { value: unknown }).value, tz);
  const text = String(value).trim();
  if (!text) return null;

  // Número de serie de Sheets (1982–2119).
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial < 30000 || serial > 80000) return null;
    const days = Math.floor(serial);
    const seconds = Math.round((serial - days) * 86400);
    const date = new Date(Date.UTC(1899, 11, 30 + days)).toISOString().slice(0, 10);
    return local(date, Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60, tz);
  }

  // ISO con zona explícita.
  const withZone = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|UTC|[+-]\d{2}(?::?\d{2})?)$/i);
  if (withZone) {
    const [, date, time, zone] = withZone;
    const [hh, mm, ss] = time.split(":");
    const z = /^(z|utc)$/i.test(zone) ? "Z" : zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const d = new Date(`${date}T${hh.padStart(2, "0")}:${mm}:${ss ?? "00"}${z}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ISO sin zona → hora local de negocio.
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  if (naive) return local(naive[1], Number(naive[2] ?? 0), Number(naive[3] ?? 0), Number(naive[4] ?? 0), tz);

  // dd/mm/aaaa, con hora opcional (hh:mm o hh:mm:ss) y a. m. / p. m. opcional
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?)?$/i);
  if (slash) {
    let day = Number(slash[1]);
    let month = Number(slash[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let hour = Number(slash[4] ?? 0);
    const meridiem = slash[7]?.toLowerCase();
    if (meridiem === "p" && hour < 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
    const date = `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return local(date, hour, Number(slash[5] ?? 0), Number(slash[6] ?? 0), tz);
  }
  return null;
}

function local(date: string, hour: number, minute: number, second: number, tz: string): string | null {
  if (hour > 23 || minute > 59 || second > 59) return null;
  const [y, m, d] = date.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return new Date(zonedTimeToUtc(date, hour, minute, tz).getTime() + second * 1000).toISOString();
}
