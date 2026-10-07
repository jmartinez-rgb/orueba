import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/tz";
import type { UnifiedMapping } from "@/lib/unified/schema";
import { parseCell } from "./absolute-top";
import { parseDelimited } from "./absolute-top-import";
import { METRIC_DEFINITIONS, METRICS, parseReference, ReconciliationError, type Metric, type ReferenceDocument, type ReferenceRow } from "./reconcile";

/**
 * Turns one interface export (Google Ads, Microsoft Advertising, Meta, TikTok, Spotify…) into account/day
 * rows of the `npm run conciliar` reference. Headers differ by platform and language, so the operator maps
 * them explicitly. Rows are summed per account; accounts outside the izzi mapping are skipped and counted.
 */
const header = z.string().min(1).max(120);
/** One header, or alternatives of which exactly one is present (e.g. "Amount spent (MXN)" / "(USD)"). */
const headers = z.union([header, z.array(header).min(1).max(6)]);
export const accountColumnsSchema = z.strictObject({
  version: z.literal(1),
  columns: z.strictObject({
    /** Null only with single-account exports and an explicit account per file. */
    accountId: header.nullable(),
    currency: header.nullable(),
    date: header.nullable(),
    spend: headers,
    impressions: headers,
    clicks: headers,
  }),
}).superRefine((value, ctx) => {
  const names = Object.values(value.columns).flatMap(v => (v === null ? [] : Array.isArray(v) ? v : [v]));
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "A header can map one field only." });
});
const candidates = (v: string | string[] | null) => (v === null ? [] : Array.isArray(v) ? v : [v]);
/** Excel stores a date cell as days since 1899-12-30; exports written as text keep the ISO date. */
const cellDate = (raw: string) => (/^\d{5}$/.test(raw) ? new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000).toISOString().slice(0, 10) : raw);

export interface AccountImportOptions {
  platform: ReferenceRow["platform"];
  mapping: UnifiedMapping;
  date: string;
  timezone: string;
  decimal: "." | ",";
  thousands: "," | "." | " " | "";
  delimiter: "," | ";" | "\t";
  /** Required when no account column is mapped (for example a single-account Spotify export). */
  accountId?: string;
}

/** Interfaces wrap IDs as text ("[138689064]") or format them ("877-953-6058"); the mapping keeps digits. */
export function normalizeAccountId(platform: string, raw: string): string {
  const value = raw.trim().replace(/^\[(.*)\]$/, "$1").trim();
  return platform === "google" ? value.replace(/-/g, "") : value;
}

export interface AccountImportResult { rows: ReferenceRow[]; sourceRows: number; skippedRows: number; skippedAccounts: number }

export function importAccountReferenceRows(text: string, columnsValue: unknown, options: AccountImportOptions): AccountImportResult {
  return importAccountReferenceRecords(parseDelimited(text, options.delimiter), columnsValue, options);
}

/** Same as importAccountReferenceRows for rows already read (CSV or the single sheet of an .xlsx). */
export function importAccountReferenceRecords(records: string[][], columnsValue: unknown, options: AccountImportOptions): AccountImportResult {
  const columns = accountColumnsSchema.safeParse(columnsValue);
  if (!columns.success) throw new ReconciliationError("INVALID_ACCOUNT_COLUMNS");
  if (!z.iso.date().safeParse(options.date).success || !isValidTimeZone(options.timezone)) throw new ReconciliationError("INVALID_ACCOUNT_OPTIONS");
  const c = columns.data.columns;
  if ((c.accountId === null) === !options.accountId) throw new ReconciliationError("INVALID_ACCOUNT_OPTIONS");
  const izzi = new Map(options.mapping.accounts.filter(a => a.brand === "izzi" && a.platform === options.platform).map(a => [a.accountId, a]));
  if (options.accountId && !izzi.has(normalizeAccountId(options.platform, options.accountId))) throw new ReconciliationError("ACCOUNT_NOT_IN_IZZI_MAPPING");
  const fields = Object.values(c).filter(v => v !== null).map(candidates);
  const present = (r: string[], name: string) => r.filter(cell => cell.trim() === name).length;
  const headerIndex = records.findIndex(r => fields.every(alternatives => alternatives.filter(name => present(r, name) > 0).length === 1 && alternatives.every(name => present(r, name) <= 1)));
  if (headerIndex < 0) throw new ReconciliationError("ACCOUNT_EXPORT_HEADERS_NOT_FOUND");
  const head = records[headerIndex].map(cell => cell.trim());
  const resolve = (v: string | string[] | null) => candidates(v).find(name => head.includes(name)) ?? null;
  const at = (name: string | null) => (name === null ? -1 : head.indexOf(name));
  const metricHeader = { spend: resolve(c.spend)!, impressions: resolve(c.impressions)!, clicks: resolve(c.clicks)! };
  // A currency written in the spend header ("Amount spent (USD)") must be the account's currency.
  const headerCurrency = /\(([A-Z]{3})\)\s*$/.exec(metricHeader.spend)?.[1] ?? null;
  const format = { decimal: options.decimal, thousands: options.thousands };
  const totals = new Map<string, Record<Metric, number | null>>();
  const skipped = new Set<string>();
  let sourceRows = 0, skippedRows = 0;
  for (let n = headerIndex + 1; n < records.length; n++) {
    const record = records[n];
    if (record.every(cell => !cell.trim())) continue;
    // Interfaces append "Total…" summary rows and copyright footers below the data.
    const first = record.find(cell => cell.trim())?.trim() ?? "";
    if (/^total/i.test(first) || /^©/.test(first)) continue;
    const rawAccount = c.accountId === null ? options.accountId! : (record[at(c.accountId)] ?? "");
    const accountId = normalizeAccountId(options.platform, rawAccount);
    if (!accountId || accountId === "--") throw new ReconciliationError(`ACCOUNT_EXPORT_ROW_WITHOUT_ACCOUNT_${n + 1}`);
    const scope = izzi.get(accountId);
    if (!scope) { skipped.add(accountId); skippedRows++; continue; }
    if (c.date !== null && cellDate((record[at(c.date)] ?? "").trim()) !== options.date) throw new ReconciliationError(`ACCOUNT_EXPORT_DATE_MISMATCH_${n + 1}`);
    if ((c.currency !== null && (record[at(c.currency)] ?? "").trim() !== scope.currency) || (headerCurrency !== null && headerCurrency !== scope.currency)) throw new ReconciliationError(`ACCOUNT_EXPORT_CURRENCY_MISMATCH_${n + 1}`);
    const sum = totals.get(accountId) ?? { spend: 0, impressions: 0, clicks: 0 };
    for (const metric of METRICS) {
      let value: number | null;
      try { value = parseCell(metric, (record[at(metricHeader[metric])] ?? "").trim(), format).value; }
      catch { throw new ReconciliationError(`ACCOUNT_EXPORT_INVALID_CELL_${n + 1}`); }
      // One unknown cell makes the account total unknown; it is never read as zero.
      sum[metric] = value === null || sum[metric] === null ? null : sum[metric]! + value;
    }
    totals.set(accountId, sum);
    sourceRows++;
  }
  const rows: ReferenceRow[] = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([accountId, sum]) => ({
    brand: "izzi", platform: options.platform, accountId, date: options.date, granularity: "daily", currency: izzi.get(accountId)!.currency,
    timezone: options.timezone, metricDefinitions: { ...METRIC_DEFINITIONS },
    spend: sum.spend === null ? null : Math.round(sum.spend * 1e6) / 1e6, impressions: sum.impressions, clicks: sum.clicks,
  }));
  return { rows, sourceRows, skippedRows, skippedAccounts: skipped.size };
}

/** New reference, or the previous one plus this platform's rows; a repeated account/day is refused. */
export function buildAccountReference(rows: ReferenceRow[], meta: { date: string; exportedAt: string }, previous?: unknown): ReferenceDocument {
  if (!z.iso.datetime({ offset: true }).safeParse(meta.exportedAt).success) throw new ReconciliationError("INVALID_ACCOUNT_OPTIONS");
  const base = previous === undefined ? null : parseReference(previous);
  if (base && (base.from !== meta.date || base.to !== meta.date)) throw new ReconciliationError("REFERENCE_RANGE_MISMATCH");
  // The earliest export time is the conservative one for the closed-day and maturity checks.
  const exportedAt = base && Date.parse(base.exportedAt) < Date.parse(meta.exportedAt) ? base.exportedAt : meta.exportedAt;
  const document = { version: 1, origin: "ADS_MANAGER", exportedAt, scope: "ALL_CAMPAIGNS", from: meta.date, to: meta.date, rows: [...(base?.rows ?? []), ...rows] };
  try { return parseReference(document); }
  catch { throw new ReconciliationError("DUPLICATE_OR_INVALID_ACCOUNT_REFERENCE"); }
}
