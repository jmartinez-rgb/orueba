import { parseDateTimeLoose } from "@/lib/time/parse";

/**
 * Lectura tolerante de celdas de Google Sheets. La hoja se lee con valores sin formato
 * (números como número, fechas como número de serie), pero si una columna quedó como texto
 * ("$1.315,74", "23540%", "12,76") también se interpreta. Una celda vacía es NULL, nunca cero.
 */

export type Cell = string | number | boolean | null | undefined;

/** Encabezado normalizado para comparar sin importar mayúsculas, espacios o comillas sobrantes. */
export function normHeader(v: Cell): string {
  return String(v ?? "")
    .normalize("NFC")
    .trim()
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Llave de un ID de cuenta o campaña: sin "act_", espacios, guiones ni puntos (736-792-8294 = 7367928294). */
export function normId(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v)).trim();
  if (!s) return null;
  return s.toLowerCase().replace(/^act_/, "").replace(/[\s.\-]/g, "");
}

export function parseNumberLoose(v: Cell, decimalComma = false): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null;
  let s = v.trim();
  if (!s || /^(n\/a|na|-|—|#[a-z/!?0-9]+)$/i.test(s)) return null;
  const percent = s.endsWith("%");
  s = s.replace(/[%$€\s]|mxn|usd|cop/gi, "");
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Ambos separadores: el último es el decimal.
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const thousands = /^\d{1,3}(,\d{3})+$/.test(s) && !decimalComma;
    normalized = thousands ? s.replace(/,/g, "") : s.replace(/,/g, (m, i) => (i === lastComma ? "." : ""));
  } else if (lastDot >= 0) {
    const thousands = /^\d{1,3}(\.\d{3})+$/.test(s) && decimalComma;
    normalized = thousands ? s.replace(/\./g, "") : s;
  } else normalized = s;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return (neg ? -n : n) / (percent ? 100 : 1);
}

/** Fecha de negocio YYYY-MM-DD desde texto, número de serie o "20260928". */
export function parseDateLoose(v: Cell, tz: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const t = v.trim();
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const compact = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  if (typeof v === "number" && v >= 19000101 && v <= 21001231) {
    const s = String(v);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  const iso = parseDateTimeLoose(typeof v === "number" ? String(v) : v, tz);
  if (!iso) return null;
  // parseDateTimeLoose devuelve UTC: se vuelve a la fecha local de la zona de la hoja.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * Hora local 0..23: 13, "13", "13:00", "00:00:00 - 00:59:59" (Meta), "2026-09-28 13:00:00"
 * (TikTok), "1 PM", o la fracción del día de un número de serie.
 */
export function parseHourLoose(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 0 && v <= 23) return v;
    if (v > 0 && v < 1) return Math.floor(v * 24 + 1e-6);
    if (v > 30000) return Math.floor((v - Math.floor(v)) * 24 + 1e-6);
    return null;
  }
  const t = String(v).trim();
  const ampm = t.match(/^(\d{1,2})(?::\d{2})?\s*([ap])\.?\s*m\.?$/i);
  if (ampm) {
    const h = Number(ampm[1]) % 12;
    return ampm[2].toLowerCase() === "p" ? h + 12 : h;
  }
  const withDate = t.match(/^\d{4}-\d{2}-\d{2}[ T](\d{1,2}):/);
  if (withDate) return Number(withDate[1]) <= 23 ? Number(withDate[1]) : null;
  const time = t.match(/^(\d{1,2})(?::\d{2}){0,2}/);
  if (time && Number(time[1]) <= 23) return Number(time[1]);
  return null;
}

/** Filas desde "$A$1:$J$6816" (DataslayerQueries): 6815 filas de datos. */
export function rowsFromRange(v: Cell): number | null {
  const m = String(v ?? "").match(/\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)/i);
  if (!m) return null;
  return Math.max(0, Number(m[2]) - Number(m[1]));
}

/** Nombre de pestaña tal como lo guarda Dataslayer ("Google | General'" → "Google | General"). */
export function cleanSheetName(v: Cell): string {
  return String(v ?? "")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
}

/** Rango A1 seguro para una pestaña (las comillas simples del nombre se duplican). */
export function a1Range(sheet: string, cols = "A1:BZ"): string {
  return `'${sheet.replace(/'/g, "''")}'!${cols}`;
}

/** Locales donde la coma es el separador decimal (para números que quedaron como texto). */
export function usesDecimalComma(locale: string | null | undefined): boolean {
  const l = (locale ?? "").toLowerCase();
  if (!l) return false;
  if (/^(en|es_mx|es_us|es_419|ja|zh|ko|he|th)/.test(l)) return false;
  return /^(es|pt|fr|de|it|nl|ru|tr|pl|id)/.test(l);
}
