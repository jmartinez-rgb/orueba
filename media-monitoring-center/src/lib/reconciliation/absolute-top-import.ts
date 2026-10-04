import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/tz";
import { normalizeGoogleCustomerId } from "@/lib/domains/config";
import { AT_METRICS, NAME_JOIN_METRICS, normalizeName, parseAtReference, parseCell, type AtMetric, type AtReference } from "./absolute-top";
import type { GoogleDomainConfig } from "@/lib/domains/config";
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
    campaignId: header.nullable(),
    /** Instead of campaignId, for a campaign report without IDs: exact-name join, top rates only. */
    campaignName: header.nullable().optional(),
    adGroupId: header.nullable(),
    network: header.nullable(),
    currency: header.nullable(),
    date: header.nullable(),
    ...(Object.fromEntries(AT_METRICS.map(m => [m, header.nullable()])) as Record<AtMetric, z.ZodNullable<typeof header>>),
  }),
}).superRefine((value, ctx) => {
  const c = value.columns;
  if ((value.level === "ad_group") !== (c.adGroupId !== null) || c.absolute_top_rate === null) ctx.addIssue({ code: "custom", message: "Level or primary metric column missing." });
  const byName = typeof c.campaignName === "string";
  if (byName === (c.campaignId !== null)) ctx.addIssue({ code: "custom", message: "Map either the campaign ID or the campaign name." });
  if (byName && (value.level !== "campaign" || AT_METRICS.some(m => c[m] !== null && !NAME_JOIN_METRICS.includes(m)))) ctx.addIssue({ code: "custom", message: "A name join is campaign-level and top rates only." });
  if (value.level === "ad_group" && c.search_lost_is_budget !== null) ctx.addIssue({ code: "custom", message: "Budget lost IS is campaign-only." });
  // Defense against mapping the impression-share column (another denominator) as the rate.
  if ([c.absolute_top_rate, c.top_of_page_rate].some(name => name !== null && /\bIS\b|share|cuota/i.test(name))) ctx.addIssue({ code: "custom", message: "Impression share is not a top rate." });
  const names = Object.values(c).filter((v): v is string => typeof v === "string");
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
  return importAtExportDetailed(text, columnsValue, options).reference;
}

/**
 * With a campaign-name mapping, rows whose every top-rate cell is a bare "0" (Google's value for
 * campaigns outside Search: Performance Max, Display, Demand Gen, video) are skipped and counted.
 */
export function importAtExportDetailed(text: string, columnsValue: unknown, options: AtImportOptions): { reference: AtReference; skippedRows: number } {
  const columns = atColumnsSchema.safeParse(columnsValue);
  if (!columns.success || columns.data.level !== options.level) throw new ReconciliationError("INVALID_AT_COLUMNS");
  const customerId = normalizeGoogleCustomerId(options.customerId);
  if (!customerId || !z.iso.date().safeParse(options.date).success || !isValidTimeZone(options.timezone) || !/^[A-Z]{3}$/.test(options.currency) || !z.iso.datetime({ offset: true }).safeParse(options.exportedAt).success) throw new ReconciliationError("INVALID_AT_OPTIONS");
  const c = columns.data.columns;
  const byName = typeof c.campaignName === "string";
  // Without a network column or UI filter, only a name join on the top rates can rely on those rates being Search-only.
  const searchOnlyByMetric = byName && c.network === null && !options.networkFilteredInUi && !options.networkLabel;
  if (!searchOnlyByMetric && ((c.network === null) === !options.networkFilteredInUi || (c.network !== null) !== Boolean(options.networkLabel))) throw new ReconciliationError("INVALID_AT_NETWORK_DECLARATION");
  const records = parseDelimited(text, options.delimiter);
  const mapped = Object.entries(c).filter((e): e is [string, string] => typeof e[1] === "string");
  const headerIndex = records.findIndex(r => mapped.every(([, name]) => r.filter(cell => cell.trim() === name).length === 1));
  if (headerIndex < 0) throw new ReconciliationError("AT_EXPORT_HEADERS_NOT_FOUND");
  const head = records[headerIndex].map(cell => cell.trim());
  const at = (name: string | null | undefined) => (typeof name === "string" ? head.indexOf(name) : -1);
  const format = { decimal: options.decimal, thousands: options.thousands };
  const rows: AtReference["rows"] = [];
  let skippedRows = 0;
  for (let n = headerIndex + 1; n < records.length; n++) {
    const record = records[n];
    if (record.every(cell => !cell.trim())) continue;
    const campaign = (record[at(byName ? c.campaignName : c.campaignId)] ?? "").trim();
    if (!campaign || campaign === "--") {
      // Google appends "Total: ..." summary rows; any other row without an ID or name is rejected.
      if (/^total/i.test(record.find(cell => cell.trim())?.trim() ?? "")) continue;
      throw new ReconciliationError(`AT_EXPORT_ROW_WITHOUT_${byName ? "NAME" : "ID"}_${n + 1}`);
    }
    if (c.network !== null && (record[at(c.network)] ?? "").trim() !== options.networkLabel) continue;
    if (c.date !== null && (record[at(c.date)] ?? "").trim() !== options.date) throw new ReconciliationError(`AT_EXPORT_DATE_MISMATCH_${n + 1}`);
    if (c.currency !== null && (record[at(c.currency)] ?? "").trim() !== options.currency) throw new ReconciliationError(`AT_EXPORT_CURRENCY_MISMATCH_${n + 1}`);
    const adGroup = c.adGroupId === null ? null : (record[at(c.adGroupId)] ?? "").trim();
    if (!byName && (!/^\d{1,20}$/.test(campaign) || (adGroup !== null && !/^\d{1,20}$/.test(adGroup)))) throw new ReconciliationError(`AT_EXPORT_INVALID_ID_${n + 1}`);
    const raw = (metric: AtMetric) => (record[at(c[metric])] ?? "").trim();
    const present = AT_METRICS.filter(metric => c[metric] !== null);
    if (byName && present.every(metric => raw(metric) === "0")) { skippedRows++; continue; }
    const cells: Partial<Record<AtMetric, string>> = {};
    for (const metric of present) {
      const value = raw(metric);
      try { parseCell(metric, value, format); } catch { throw new ReconciliationError(`AT_EXPORT_INVALID_CELL_${n + 1}`); }
      cells[metric] = value;
    }
    rows.push(byName ? { campaignId: null, campaignName: campaign, adGroupId: null, cells } : { campaignId: campaign, adGroupId: adGroup, cells });
  }
  const reference = parseAtReference({
    version: 1, origin: "GOOGLE_ADS_UI_EXPORT", exportedAt: options.exportedAt, customerId, level: options.level, date: options.date,
    timezone: options.timezone, currency: options.currency, joinBy: byName ? "CAMPAIGN_NAME" : "ID", network: "GOOGLE_SEARCH_ONLY",
    networkEvidence: c.network !== null ? "SEGMENT_COLUMN" : searchOnlyByMetric ? "TOP_METRICS_SEARCH_ONLY" : "FILTERED_IN_UI", numberFormat: format, rows,
  });
  return { reference, skippedRows };
}

/** Fixed Dataslayer headers of the Absolute Top sheet (query metrics AbsoluteTopImpressionPercentage, TopImpressionPercentage). */
export const DATASLAYER_AT_COLUMNS = { date: "Date", account: "Account", campaign: "Campaign", absolute_top_rate: "Absolute top impression percentage", top_of_page_rate: "Top impression percentage" } as const;

export interface DataslayerImportOptions {
  master: GoogleDomainConfig;
  date: string;
  timezone: string;
  currency: string;
  /** Instant of the Dataslayer refresh that produced the sheet (DataslayerQueries → Updated), with offset. */
  exportedAt: string;
  decimal: "." | ",";
  thousands: "," | "." | " " | "";
  delimiter: "," | ";" | "\t";
}

/**
 * Dataslayer sheet → one campaign-level reference per master account found. Accounts join by the exact
 * master name (no similarity) and campaigns later join by exact name; other accounts are skipped and
 * counted. Values are percent numbers (70.33) and become "70.33%" cells; an empty cell stays unknown.
 */
export function importDataslayerAbsoluteTop(text: string, options: DataslayerImportOptions): { references: AtReference[]; skippedAccounts: number; skippedRows: number } {
  if (!z.iso.date().safeParse(options.date).success || !isValidTimeZone(options.timezone) || !/^[A-Z]{3}$/.test(options.currency) || !z.iso.datetime({ offset: true }).safeParse(options.exportedAt).success) throw new ReconciliationError("INVALID_AT_OPTIONS");
  const records = parseDelimited(text, options.delimiter);
  const wanted = Object.values(DATASLAYER_AT_COLUMNS);
  const headerIndex = records.findIndex(r => wanted.every(name => r.filter(cell => cell.trim() === name).length === 1));
  if (headerIndex < 0) throw new ReconciliationError("AT_EXPORT_HEADERS_NOT_FOUND");
  const head = records[headerIndex].map(cell => cell.trim());
  const col = (name: string) => head.indexOf(name);
  const customerByName = new Map(options.master.domains.flatMap(d => d.accounts.map(a => [normalizeName(a.name), a.customerId] as const)));
  const format = { decimal: options.decimal, thousands: options.thousands };
  const rows = new Map<string, AtReference["rows"]>();
  const skipped = new Set<string>();
  let skippedRows = 0;
  for (let n = headerIndex + 1; n < records.length; n++) {
    const record = records[n];
    if (record.every(cell => !cell.trim())) continue;
    const date = (record[col(DATASLAYER_AT_COLUMNS.date)] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:[ T]00:00(?::00)?)?$/.test(date)) throw new ReconciliationError(`AT_EXPORT_DATE_FORMAT_${n + 1}`);
    if (date.slice(0, 10) !== options.date) { skippedRows++; continue; }
    const account = normalizeName(record[col(DATASLAYER_AT_COLUMNS.account)] ?? "");
    const customer = customerByName.get(account);
    if (!customer) { skipped.add(account); skippedRows++; continue; }
    const campaign = (record[col(DATASLAYER_AT_COLUMNS.campaign)] ?? "").trim();
    if (!campaign) throw new ReconciliationError(`AT_EXPORT_ROW_WITHOUT_NAME_${n + 1}`);
    const cells: Partial<Record<AtMetric, string>> = {};
    for (const metric of ["absolute_top_rate", "top_of_page_rate"] as const) {
      const raw = (record[col(DATASLAYER_AT_COLUMNS[metric])] ?? "").trim();
      const value = raw === "" ? "--" : `${raw}%`;
      try { parseCell(metric, value, format); } catch { throw new ReconciliationError(`AT_EXPORT_INVALID_CELL_${n + 1}`); }
      cells[metric] = value;
    }
    rows.set(customer, [...(rows.get(customer) ?? []), { campaignId: null, campaignName: campaign, adGroupId: null, cells }]);
  }
  const references = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([customerId, list]) => parseAtReference({
    version: 1, origin: "DATASLAYER", exportedAt: options.exportedAt, customerId, level: "campaign", date: options.date,
    timezone: options.timezone, currency: options.currency, joinBy: "CAMPAIGN_NAME", network: "GOOGLE_SEARCH_ONLY",
    networkEvidence: "TOP_METRICS_SEARCH_ONLY", numberFormat: format, rows: list,
  }));
  return { references, skippedAccounts: skipped.size, skippedRows };
}
