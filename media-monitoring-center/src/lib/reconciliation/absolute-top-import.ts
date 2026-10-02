import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/tz";
import { normalizeGoogleCustomerId } from "@/lib/domains/config";
import { AT_METRICS, parseAtReference, parseCell, type AtMetric, type AtReference } from "./absolute-top";
import { ReconciliationError } from "./reconcile";

/**
 * Turns a Google Ads UI CSV download into a strict Absolute Top reference. Column names differ by
 * interface language, so the operator maps each header explicitly; nothing is guessed by similarity.
 */
const header = z.string().min(1).max(120);
export const atColumnsSchema = z.strictObject({
  version: z.literal(1),
  level: z.enum(["campaign", "ad_group"]),
  columns: z.strictObject({
    campaignId: header,
    adGroupId: header.nullable(),
    network: header.nullable(),
    currency: header.nullable(),
    date: header.nullable(),
    ...(Object.fromEntries(AT_METRICS.map(m => [m, header.nullable()])) as Record<AtMetric, z.ZodNullable<typeof header>>),
  }),
}).superRefine((value, ctx) => {
  const c = value.columns;
  if ((value.level === "ad_group") !== (c.adGroupId !== null) || c.absolute_top_rate === null) ctx.addIssue({ code: "custom", message: "Level or primary metric column missing." });
  if (value.level === "ad_group" && c.search_lost_is_budget !== null) ctx.addIssue({ code: "custom", message: "Budget lost IS is campaign-only." });
  // Defense against mapping the impression-share column (another denominator) as the rate.
  if ([c.absolute_top_rate, c.top_of_page_rate].some(name => name !== null && /\bIS\b|share|cuota/i.test(name))) ctx.addIssue({ code: "custom", message: "Impression share is not a top rate." });
  const names = Object.values(c).filter((v): v is string => v !== null);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "A header can map one field only." });
});
export type AtColumns = z.infer<typeof atColumnsSchema>;

export interface AtImportOptions {
  customerId: string;
  level: "campaign" | "ad_group";
  date: string;
  timezone: string;
  currency: string;
  exportedAt: string;
  decimal: "." | ",";
  thousands: "," | "." | " " | "";
  delimiter: "," | ";" | "\t";
  /** Required with a mapped network column: only rows with this exact label are kept. */
  networkLabel?: string;
  /** Operator declaration when the UI report was already filtered to Google Search only. */
  networkFilteredInUi?: boolean;
}

export function decodeExport(bytes: Buffer): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
  } catch { throw new ReconciliationError("INVALID_AT_EXPORT_ENCODING"); }
}

/** RFC 4180 records with quoted fields; a stray quote is an error, never a silent repair. */
export function parseDelimited(text: string, delimiter: string, maxRows = 100005): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0, started = false;
  const push = () => { row.push(field); field = ""; started = false; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { if (started || field) throw new ReconciliationError("INVALID_AT_EXPORT_CSV"); quoted = true; started = true; i++; continue; }
    if (ch === delimiter) { push(); i++; continue; }
    if (ch === "\r" || ch === "\n") {
      push(); rows.push(row); row = [];
      if (rows.length > maxRows) throw new ReconciliationError("AT_EXPORT_TOO_LARGE");
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1; continue;
    }
    field += ch; started = true; i++;
  }
  if (quoted) throw new ReconciliationError("INVALID_AT_EXPORT_CSV");
  if (field || started || row.length) { push(); rows.push(row); }
  return rows;
}

export function importAtExport(text: string, columnsValue: unknown, options: AtImportOptions): AtReference {
  const columns = atColumnsSchema.safeParse(columnsValue);
  if (!columns.success || columns.data.level !== options.level) throw new ReconciliationError("INVALID_AT_COLUMNS");
  const customerId = normalizeGoogleCustomerId(options.customerId);
  if (!customerId || !z.iso.date().safeParse(options.date).success || !isValidTimeZone(options.timezone) || !/^[A-Z]{3}$/.test(options.currency) || !z.iso.datetime({ offset: true }).safeParse(options.exportedAt).success) throw new ReconciliationError("INVALID_AT_OPTIONS");
  const c = columns.data.columns;
  if ((c.network === null) === !options.networkFilteredInUi || (c.network !== null && !options.networkLabel)) throw new ReconciliationError("INVALID_AT_NETWORK_DECLARATION");
  const records = parseDelimited(text, options.delimiter);
  const mapped = Object.entries(c).filter((e): e is [string, string] => e[1] !== null);
  const headerIndex = records.findIndex(r => mapped.every(([, name]) => r.filter(cell => cell.trim() === name).length === 1));
  if (headerIndex < 0) throw new ReconciliationError("AT_EXPORT_HEADERS_NOT_FOUND");
  const head = records[headerIndex].map(cell => cell.trim());
  const at = (name: string | null) => (name === null ? -1 : head.indexOf(name));
  const format = { decimal: options.decimal, thousands: options.thousands };
  const rows: AtReference["rows"] = [];
  for (let n = headerIndex + 1; n < records.length; n++) {
    const record = records[n];
    if (record.every(cell => !cell.trim())) continue;
    const campaign = (record[at(c.campaignId)] ?? "").trim();
    if (!campaign || campaign === "--") {
      // Google appends "Total: ..." summary rows; any other row without an ID is rejected.
      if (/^total/i.test(record.find(cell => cell.trim())?.trim() ?? "")) continue;
      throw new ReconciliationError(`AT_EXPORT_ROW_WITHOUT_ID_${n + 1}`);
    }
    if (c.network !== null && (record[at(c.network)] ?? "").trim() !== options.networkLabel) continue;
    if (c.date !== null && (record[at(c.date)] ?? "").trim() !== options.date) throw new ReconciliationError(`AT_EXPORT_DATE_MISMATCH_${n + 1}`);
    if (c.currency !== null && (record[at(c.currency)] ?? "").trim() !== options.currency) throw new ReconciliationError(`AT_EXPORT_CURRENCY_MISMATCH_${n + 1}`);
    const adGroup = c.adGroupId === null ? null : (record[at(c.adGroupId)] ?? "").trim();
    if (!/^\d{1,20}$/.test(campaign) || (adGroup !== null && !/^\d{1,20}$/.test(adGroup))) throw new ReconciliationError(`AT_EXPORT_INVALID_ID_${n + 1}`);
    const cells: Partial<Record<AtMetric, string>> = {};
    for (const metric of AT_METRICS) {
      if (c[metric] === null) continue;
      const value = (record[at(c[metric])] ?? "").trim();
      try { parseCell(metric, value, format); } catch { throw new ReconciliationError(`AT_EXPORT_INVALID_CELL_${n + 1}`); }
      cells[metric] = value;
    }
    rows.push({ campaignId: campaign, adGroupId: adGroup, cells });
  }
  return parseAtReference({
    version: 1, origin: "GOOGLE_ADS_UI_EXPORT", exportedAt: options.exportedAt, customerId, level: options.level, date: options.date,
    timezone: options.timezone, currency: options.currency, network: "GOOGLE_SEARCH_ONLY",
    networkEvidence: c.network !== null ? "SEGMENT_COLUMN" : "FILTERED_IN_UI", numberFormat: format, rows,
  });
}
