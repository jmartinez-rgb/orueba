import { createHash } from "node:crypto";
import { z } from "zod";
import { addDays, businessDate, isValidTimeZone, zonedTimeToUtc } from "@/lib/time/tz";
import { normalizeGoogleCustomerId } from "@/lib/domains/config";
import type { AbsoluteTopAudit, AbsoluteTopLevel, AbsoluteTopRow } from "@/lib/absolute-top/types";
import { ReconciliationError } from "./reconcile";

/**
 * Absolute Top reconciliation: native per-entity Google values against an independent
 * Google Ads UI export of the same closed day, account, clock, currency, network and level.
 * The approximate domain aggregate is never compared: Google uses another denominator.
 */
export const AT_METRICS = ["absolute_top_rate", "top_of_page_rate", "search_impression_share", "search_lost_is_rank", "search_lost_is_budget", "impressions", "clicks", "spend"] as const;
export type AtMetric = typeof AT_METRICS[number];
const PERCENT: readonly AtMetric[] = ["absolute_top_rate", "top_of_page_rate", "search_impression_share", "search_lost_is_rank", "search_lost_is_budget"];
const CENSORED: readonly AtMetric[] = ["search_impression_share", "search_lost_is_rank", "search_lost_is_budget"];
export const AT_CODES = ["MATCH", "BOUND_MATCH", "DIFFERENCE", "UNKNOWN_METRIC", "NOT_EXPORTED", "MISSING_REFERENCE", "MISSING_SOURCE", "INCOMPATIBLE_CLOCK", "INCOMPATIBLE_CURRENCY"] as const;
export type AtCode = typeof AT_CODES[number];
/** Google documents that impression-share data can update for one to two days after the day closes. */
export const MATURITY_HOURS = 48;

const digits = z.string().regex(/^\d{1,20}$/);
const cell = z.string().max(40);
const numberFormat = z.strictObject({ decimal: z.enum([".", ","]), thousands: z.enum([",", ".", " ", ""]) }).refine(f => f.decimal !== f.thousands);
/** Metrics a third-party extraction without network segmentation can be compared on: top rates are Search-only. */
export const NAME_JOIN_METRICS: readonly AtMetric[] = ["absolute_top_rate", "top_of_page_rate"];
export const normalizeName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
const atReferenceSchema = z.strictObject({
  version: z.literal(1),
  /** GOOGLE_ADS_UI_EXPORT: Google Ads interface. DATASLAYER: independent third-party extraction, not the UI. */
  origin: z.enum(["GOOGLE_ADS_UI_EXPORT", "DATASLAYER"]),
  exportedAt: z.iso.datetime({ offset: true }),
  customerId: z.string().refine(v => normalizeGoogleCustomerId(v) !== null),
  level: z.enum(["campaign", "ad_group"]),
  date: z.iso.date(),
  timezone: z.string().max(80).refine(isValidTimeZone),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** ID (default) or exact campaign name within the customer, for sources that carry no IDs. */
  joinBy: z.enum(["ID", "CAMPAIGN_NAME"]).default("ID"),
  /** Operator declaration: the export kept only the Google Search network (no Search partners). */
  network: z.literal("GOOGLE_SEARCH_ONLY"),
  networkEvidence: z.enum(["SEGMENT_COLUMN", "FILTERED_IN_UI", "TOP_METRICS_SEARCH_ONLY"]),
  numberFormat,
  rows: z.array(z.strictObject({
    campaignId: digits.nullable(),
    campaignName: z.string().min(1).max(500).nullable().optional(),
    adGroupId: digits.nullable(),
    cells: z.strictObject(Object.fromEntries(AT_METRICS.map(m => [m, cell.optional()])) as Record<AtMetric, z.ZodOptional<typeof cell>>),
  })).max(100000),
}).superRefine((ref, ctx) => {
  const byName = ref.joinBy === "CAMPAIGN_NAME";
  // A name join is only for campaign-level third-party data, and only on the Search-only top rates.
  if (byName && (ref.origin !== "DATASLAYER" || ref.level !== "campaign")) ctx.addIssue({ code: "custom", message: "Name join requires DATASLAYER campaign rows." });
  if ((ref.networkEvidence === "TOP_METRICS_SEARCH_ONLY") !== byName) ctx.addIssue({ code: "custom", message: "Network evidence does not match the join." });
  const keys = new Set<string>();
  for (const row of ref.rows) {
    const key = byName ? normalizeName(row.campaignName ?? "") : `${row.campaignId}/${row.adGroupId}`;
    if (byName ? row.campaignId !== null || !row.campaignName || Object.keys(row.cells).some(m => !NAME_JOIN_METRICS.includes(m as AtMetric)) : row.campaignId === null || (row.campaignName ?? null) !== null) ctx.addIssue({ code: "custom", message: "Row does not match the join." });
    if ((ref.level === "campaign") !== (row.adGroupId === null) || keys.has(key)) ctx.addIssue({ code: "custom", message: "Inconsistent or duplicate entity." });
    // Google Help limits Search lost IS (budget) to campaigns; never accept it as an ad group value.
    if (ref.level === "ad_group" && row.cells.search_lost_is_budget !== undefined) ctx.addIssue({ code: "custom", message: "Budget lost IS is campaign-only." });
    keys.add(key);
  }
});
export type AtReference = z.infer<typeof atReferenceSchema>;

export function parseAtReference(value: unknown): AtReference {
  const parsed = atReferenceSchema.safeParse(value);
  if (!parsed.success) throw new ReconciliationError("INVALID_AT_REFERENCE");
  return { ...parsed.data, customerId: normalizeGoogleCustomerId(parsed.data.customerId)! };
}

export interface ParsedCell { value: number | null; decimals: number; bound: "lt_10_percent" | "gt_90_percent" | null }
const UNKNOWN_CELLS = new Set(["", "--", "—", "-", "n/a", "N/A"]);
/** Parses one UI cell under the declared locale. Never guesses separators; rejects symbols and text. */
export function parseCell(metric: AtMetric, text: string, format: AtReference["numberFormat"]): ParsedCell {
  const raw = text.trim();
  if (UNKNOWN_CELLS.has(raw)) return { value: null, decimals: 0, bound: null };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\ ]/g, m => (m === " " ? "[ \\u00a0\\u202f]" : `\\${m}`));
  const groups = format.thousands ? `\\d{1,3}(?:${esc(format.thousands)}\\d{3})+|\\d+` : "\\d+";
  const percent = PERCENT.includes(metric);
  const pattern = new RegExp(`^(?:([<>])\\s*)?(${groups})(?:${esc(format.decimal)}(\\d+))?${percent ? "\\s*%" : ""}$`);
  const match = pattern.exec(raw);
  if (!match) throw new ReconciliationError("INVALID_AT_CELL");
  const integer = format.thousands ? match[2].split(format.thousands).join("").replace(/[   ]/g, "") : match[2];
  const decimals = match[3]?.length ?? 0;
  const value = Number(`${integer}${decimals ? `.${match[3]}` : ""}`);
  if (!Number.isFinite(value)) throw new ReconciliationError("INVALID_AT_CELL");
  if (match[1]) {
    // Only Google's published censoring is a bound: impression share "< 10%" and lost IS "> 90%".
    const bound = match[1] === "<" && value === 10 && metric === "search_impression_share" ? "lt_10_percent"
      : match[1] === ">" && value === 90 && (metric === "search_lost_is_rank" || metric === "search_lost_is_budget") ? "gt_90_percent" : null;
    if (!bound || !CENSORED.includes(metric)) throw new ReconciliationError("INVALID_AT_CELL");
    return { value: null, decimals, bound };
  }
  if ((metric === "impressions" || metric === "clicks") && decimals) throw new ReconciliationError("INVALID_AT_CELL");
  if (percent && value > 100) throw new ReconciliationError("INVALID_AT_CELL");
  return { value, decimals, bound: null };
}

export interface AtComparison {
  code: AtCode;
  /** Percent metrics in percentage points; money in account currency; counts as integers. */
  source: number | null;
  sourceBound: string | null;
  referenceText: string | null;
  reference: number | null;
  referenceBound: string | null;
  delta: number | null;
  tolerance: number | null;
  reason: string | null;
}
export interface AtEntityResult {
  customerId: string;
  level: AbsoluteTopLevel;
  /** Null only for a name-joined reference row that matched no single source campaign. */
  campaignId: string | null;
  /** 1-based row of the private reference file, so an unresolved name can be found without exporting it. */
  referenceRow: number | null;
  joinReason: "NAME_NOT_FOUND" | "NAME_AMBIGUOUS" | null;
  adGroupId: string | null;
  date: string;
  codes: AtCode[];
  comparisons: Record<AtMetric, AtComparison>;
}
export interface AtPartitionResult {
  customerId: string;
  level: AbsoluteTopLevel;
  date: string;
  timezone: string;
  currency: string;
  origin: AtReference["origin"];
  joinBy: AtReference["joinBy"];
  network: "GOOGLE_SEARCH_ONLY";
  networkEvidence: AtReference["networkEvidence"];
  referenceExportedAt: string;
  referenceDigestSha256: string;
  sourceAuditId: string | null;
  sourceObservedAt: string | null;
  sourceExtractedAtFrom: string | null;
  sourceExtractedAtTo: string | null;
  sourceTimezone: string | null;
  sourceCurrency: string | null;
  dayClosesAt: string;
  matureAt: string;
  sourceMature: boolean;
  referenceMature: boolean;
  reasons: string[];
  entities: AtEntityResult[];
  counts: Record<AtCode, number>;
}
export interface AtReconciliationReport {
  version: 1;
  origin: "ABSOLUTE_TOP_RECONCILIATION";
  brand: "izzi";
  generatedAt: string;
  policy: {
    primaryMetric: "metrics.absolute_top_impression_percentage";
    notSearchAbsoluteTopImpressionShare: true;
    percentTolerance: "HALF_UNIT_OF_REFERENCE_DECIMALS_PP";
    moneyTolerance: "HALF_UNIT_OF_REFERENCE_DECIMALS";
    countTolerance: 0;
    maturityHours: typeof MATURITY_HOURS;
    domainAggregateCompared: false;
    currencyConversion: false;
    timezoneConversion: false;
  };
  partitions: AtPartitionResult[];
  counts: Record<AtCode, number>;
  primary: { compared: number; matched: number; differences: number; unknown: number; maxAbsDeltaPp: number | null };
  exitCode: 0 | 2;
  certifiesV1: false;
}

const emptyCounts = () => Object.fromEntries(AT_CODES.map(c => [c, 0])) as Record<AtCode, number>;
const entityKey = (level: string, campaignId: string, adGroupId: string | null) => `${level}/${campaignId}/${adGroupId ?? ""}`;

function sourceValue(row: AbsoluteTopRow | undefined, metric: AtMetric): { value: number | null; bound: string | null } {
  if (!row) return { value: null, bound: null };
  const bound = (CENSORED.includes(metric) ? row.share_bounds[metric as keyof AbsoluteTopRow["share_bounds"]] : undefined) ?? null;
  const v = row[metric];
  if (v === null || v === undefined || !Number.isFinite(v)) return { value: null, bound };
  return { value: PERCENT.includes(metric) ? v * 100 : v, bound };
}

function compare(metric: AtMetric, row: AbsoluteTopRow, text: string | undefined, format: AtReference["numberFormat"], blocking: AtCode | null): AtComparison {
  const src = sourceValue(row, metric);
  const base = { source: src.value, sourceBound: src.bound, referenceText: text ?? null, reference: null, referenceBound: null, delta: null, tolerance: null, reason: null };
  if (blocking) return { ...base, code: blocking };
  if (text === undefined) return { ...base, code: "NOT_EXPORTED" };
  const ref = parseCell(metric, text, format);
  const withRef = { ...base, reference: ref.value, referenceBound: ref.bound };
  if (ref.bound || src.bound) {
    if (ref.bound && ref.bound === src.bound) return { ...withRef, code: "BOUND_MATCH" };
    if (ref.value === null && !ref.bound) return { ...withRef, code: "UNKNOWN_METRIC", reason: "REFERENCE_UNKNOWN" };
    return { ...withRef, code: "DIFFERENCE", reason: ref.bound ? "SOURCE_NOT_CENSORED" : "REFERENCE_NOT_CENSORED" };
  }
  if (src.value === null || ref.value === null) return { ...withRef, code: "UNKNOWN_METRIC", reason: src.value === null ? "SOURCE_UNKNOWN" : "REFERENCE_UNKNOWN" };
  const counts = metric === "impressions" || metric === "clicks";
  if (counts && !Number.isSafeInteger(src.value)) return { ...withRef, code: "UNKNOWN_METRIC", reason: "SOURCE_NOT_INTEGER" };
  // The UI rounds what it displays: half a unit of the exported decimals is the only tolerance.
  const tolerance = counts ? 0 : 0.5 * 10 ** -ref.decimals + Math.max(1e-9, Number.EPSILON * Math.max(1, Math.abs(src.value)) * 8);
  const delta = src.value - ref.value;
  return { ...withRef, delta, tolerance, code: Math.abs(delta) <= tolerance ? "MATCH" : "DIFFERENCE" };
}

/** Latest complete daily audit covering the date, or the explicitly requested audit. */
export function selectAudit(history: AbsoluteTopAudit[], date: string, auditId?: string): { audit: AbsoluteTopAudit | null; reasons: string[] } {
  const reasons: string[] = [];
  if (auditId) {
    const audit = history.find(a => a.auditId === auditId) ?? null;
    if (!audit) return { audit: null, reasons: ["AUDIT_NOT_FOUND"] };
    if (audit.granularity !== "daily" || audit.coverage !== "complete" || date < audit.from || date > audit.to) return { audit: null, reasons: ["AUDIT_NOT_COMPARABLE"] };
    return { audit, reasons };
  }
  const covering = history.filter(a => a.granularity === "daily" && date >= a.from && date <= a.to).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || b.auditId.localeCompare(a.auditId));
  const audit = covering.find(a => a.coverage === "complete") ?? null;
  if (!audit) return { audit: null, reasons: ["NO_COMPLETE_DAILY_AUDIT"] };
  if (covering[0] !== audit) reasons.push("NEWER_AUDIT_NOT_COMPLETE");
  return { audit, reasons };
}

export async function buildAbsoluteTopReconciliation(opts: {
  references: unknown[];
  history: (customerId: string) => Promise<AbsoluteTopAudit[]>;
  auditId?: string;
  now?: Date;
}): Promise<AtReconciliationReport> {
  const now = opts.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ReconciliationError("INVALID_CLOCK");
  if (!opts.references.length || opts.references.length > 64) throw new ReconciliationError("INVALID_AT_REFERENCE");
  const references = opts.references.map(parseAtReference);
  const partitionKeys = references.map(r => `${r.customerId}/${r.level}/${r.date}`);
  if (new Set(partitionKeys).size !== partitionKeys.length) throw new ReconciliationError("DUPLICATE_AT_REFERENCE");
  if (opts.auditId && new Set(references.map(r => r.customerId)).size > 1) throw new ReconciliationError("AUDIT_ID_REQUIRES_ONE_CUSTOMER");
  const partitions: AtPartitionResult[] = [];
  for (const ref of references) {
    const closes = zonedTimeToUtc(addDays(ref.date, 1), 0, 0, ref.timezone);
    const matureAt = new Date(closes.getTime() + MATURITY_HOURS * 3600000);
    if (Date.parse(ref.exportedAt) > now.getTime()) throw new ReconciliationError("INVALID_AT_REFERENCE_TIME");
    // An intraday export is not a closed-day reference: reject it instead of comparing partial data.
    if (businessDate(new Date(ref.exportedAt), ref.timezone) <= ref.date) throw new ReconciliationError("INVALID_AT_REFERENCE_TIME");
    const { audit, reasons } = selectAudit(await opts.history(ref.customerId), ref.date, opts.auditId);
    const rows = audit?.rows.filter(r => r.level === ref.level && r.date === ref.date && r.hour === null) ?? [];
    const zones = [...new Set(rows.map(r => r.source_timezone))], currencies = [...new Set(rows.map(r => r.currency))];
    if (audit && !rows.length) reasons.push("NO_SOURCE_ROWS_FOR_LEVEL");
    if (zones.length > 1) reasons.push("MULTIPLE_SOURCE_CLOCKS");
    const clockMismatch = zones.length > 1 || (zones.length === 1 && zones[0] !== ref.timezone);
    const currencyMismatch = currencies.length > 1 || (currencies.length === 1 && currencies[0] !== ref.currency);
    if (clockMismatch) reasons.push("INCOMPATIBLE_CLOCK");
    if (currencyMismatch) reasons.push("INCOMPATIBLE_CURRENCY");
    const extracted = rows.map(r => r.extracted_at).sort((a, b) => Date.parse(a) - Date.parse(b));
    if (extracted.length && Date.parse(extracted[0]) < closes.getTime()) reasons.push("SOURCE_EXTRACTED_BEFORE_DAY_CLOSED");
    const sourceMature = extracted.length > 0 && Date.parse(extracted[0]) >= matureAt.getTime();
    const referenceMature = Date.parse(ref.exportedAt) >= matureAt.getTime();
    if (!sourceMature) reasons.push("SOURCE_MATURITY_PENDING");
    if (!referenceMature) reasons.push("REFERENCE_MATURITY_PENDING");
    const blocking: AtCode | null = clockMismatch ? "INCOMPATIBLE_CLOCK" : currencyMismatch ? "INCOMPATIBLE_CURRENCY" : reasons.includes("SOURCE_EXTRACTED_BEFORE_DAY_CLOSED") ? "MISSING_SOURCE" : null;
    const sourceByKey = new Map(rows.map(r => [entityKey(r.level, r.campaign_id, r.ad_group_id), r]));
    // Name join: exact normalized campaign name within this customer's source rows; never a fuzzy match.
    const byName = new Map<string, AbsoluteTopRow[]>();
    for (const r of rows) byName.set(normalizeName(r.campaign_name), [...(byName.get(normalizeName(r.campaign_name)) ?? []), r]);
    const refByKey = new Map<string, { row: AtReference["rows"][number]; index: number; reason: AtEntityResult["joinReason"] }>();
    ref.rows.forEach((r, index) => {
      if (ref.joinBy === "ID") { refByKey.set(entityKey(ref.level, r.campaignId!, r.adGroupId), { row: r, index, reason: null }); return; }
      const found = byName.get(normalizeName(r.campaignName!)) ?? [];
      if (found.length === 1) refByKey.set(entityKey("campaign", found[0].campaign_id, null), { row: r, index, reason: null });
      else refByKey.set(`unresolved/${index}`, { row: r, index, reason: found.length ? "NAME_AMBIGUOUS" : "NAME_NOT_FOUND" });
    });
    const keys = [...new Set([...sourceByKey.keys(), ...refByKey.keys()])].sort();
    const entities: AtEntityResult[] = keys.map(key => {
      const srcRow = sourceByKey.get(key), ref_ = refByKey.get(key), refRow = ref_?.row;
      const unresolved = key.startsWith("unresolved/");
      const [, campaignId, adGroup] = unresolved ? [null, null, null] : key.split("/");
      const missing: AtCode | null = !srcRow ? "MISSING_SOURCE" : !refRow ? "MISSING_REFERENCE" : null;
      const comparisons = Object.fromEntries(AT_METRICS.map(metric => {
        if (missing || !srcRow) return [metric, { code: missing ?? "MISSING_SOURCE", source: sourceValue(srcRow, metric).value, sourceBound: sourceValue(srcRow, metric).bound, referenceText: refRow?.cells[metric] ?? null, reference: null, referenceBound: null, delta: null, tolerance: null, reason: ref_?.reason ?? null } satisfies AtComparison];
        return [metric, compare(metric, srcRow, refRow?.cells[metric], ref.numberFormat, blocking)];
      })) as Record<AtMetric, AtComparison>;
      const codes = [...new Set(AT_METRICS.map(m => comparisons[m].code))].filter(c => c !== "NOT_EXPORTED");
      return { customerId: ref.customerId, level: ref.level, campaignId, adGroupId: adGroup || null, referenceRow: ref_ ? ref_.index + 1 : null, joinReason: ref_?.reason ?? null, date: ref.date, codes: codes.length ? codes : ["NOT_EXPORTED"], comparisons };
    });
    const counts = emptyCounts();
    for (const entity of entities) for (const code of entity.codes) counts[code]++;
    partitions.push({
      customerId: ref.customerId, level: ref.level, date: ref.date, timezone: ref.timezone, currency: ref.currency, origin: ref.origin, joinBy: ref.joinBy, network: ref.network, networkEvidence: ref.networkEvidence,
      referenceExportedAt: ref.exportedAt, referenceDigestSha256: createHash("sha256").update(JSON.stringify(ref)).digest("hex"),
      sourceAuditId: audit?.auditId ?? null, sourceObservedAt: audit?.observedAt ?? null, sourceExtractedAtFrom: extracted[0] ?? null, sourceExtractedAtTo: extracted.at(-1) ?? null,
      sourceTimezone: zones.length === 1 ? zones[0] : null, sourceCurrency: currencies.length === 1 ? currencies[0] : null,
      dayClosesAt: closes.toISOString(), matureAt: matureAt.toISOString(), sourceMature, referenceMature, reasons, entities, counts,
    });
  }
  const counts = emptyCounts();
  for (const p of partitions) for (const code of AT_CODES) counts[code] += p.counts[code];
  const primary = partitions.flatMap(p => p.entities.map(e => e.comparisons.absolute_top_rate));
  const deltas = primary.filter(c => c.delta !== null).map(c => Math.abs(c.delta!));
  const accepted = partitions.length > 0 && partitions.every(p => p.sourceMature && p.referenceMature && !p.reasons.length && p.entities.length > 0
    && p.entities.every(e => e.comparisons.absolute_top_rate.code === "MATCH" && e.codes.every(c => c === "MATCH" || c === "BOUND_MATCH")));
  return {
    version: 1, origin: "ABSOLUTE_TOP_RECONCILIATION", brand: "izzi", generatedAt: now.toISOString(),
    policy: { primaryMetric: "metrics.absolute_top_impression_percentage", notSearchAbsoluteTopImpressionShare: true, percentTolerance: "HALF_UNIT_OF_REFERENCE_DECIMALS_PP", moneyTolerance: "HALF_UNIT_OF_REFERENCE_DECIMALS", countTolerance: 0, maturityHours: MATURITY_HOURS, domainAggregateCompared: false, currencyConversion: false, timezoneConversion: false },
    partitions, counts,
    primary: { compared: primary.filter(c => c.code === "MATCH" || c.code === "DIFFERENCE").length, matched: primary.filter(c => c.code === "MATCH").length, differences: primary.filter(c => c.code === "DIFFERENCE").length, unknown: primary.filter(c => c.code === "UNKNOWN_METRIC").length, maxAbsDeltaPp: deltas.length ? Math.max(...deltas) : null },
    exitCode: accepted ? 0 : 2, certifiesV1: false,
  };
}
