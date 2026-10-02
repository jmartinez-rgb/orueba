import { createHash } from "node:crypto";
import { z } from "zod";
import { addDays, businessDate, isValidTimeZone, zonedTimeToUtc } from "@/lib/time/tz";
import { mappingSchema, scopeSchema, type ApiCatalog, type ApiPartition, type UnifiedMapping } from "@/lib/unified/schema";
import type { UnifiedSnapshotStore } from "@/lib/unified/store";

export const METRICS = ["spend", "impressions", "clicks"] as const;
export type Metric = typeof METRICS[number];
export type Metrics = Record<Metric, number | null>;
export const FINDING_CODES = ["MATCH", "DIFFERENCE", "MISSING_REFERENCE", "MISSING_SOURCE", "INCOMPATIBLE_CLOCK", "INCOMPATIBLE_CURRENCY", "UNKNOWN_METRIC"] as const;
export type FindingCode = typeof FINDING_CODES[number];
const nullMetrics = (): Metrics => ({ spend: null, impressions: null, clicks: null });
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const amount = z.number().finite().nonnegative().nullable();
const count = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const METRIC_DEFINITIONS = { spend: "ACCOUNT_CURRENCY", impressions: "IMPRESSIONS", clicks: "PLATFORM_CLICKS" } as const;
const referenceRowSchema = z.strictObject({
  brand: z.literal("izzi"), platform: scopeSchema.shape.platform, accountId: scopeSchema.shape.accountId,
  date, granularity: z.literal("daily"), currency: scopeSchema.shape.currency,
  timezone: z.string().max(80).refine(isValidTimeZone),
  metricDefinitions: z.strictObject({ spend: z.literal("ACCOUNT_CURRENCY"), impressions: z.literal("IMPRESSIONS"), clicks: z.literal("PLATFORM_CLICKS") }),
  spend: amount, impressions: count, clicks: count,
});
export const referenceSchema = z.strictObject({
  version: z.literal(1), origin: z.literal("ADS_MANAGER"), exportedAt: instant,
  scope: z.literal("ALL_CAMPAIGNS"), from: date, to: date,
  rows: z.array(referenceRowSchema).max(4500),
});
export type ReferenceDocument = z.infer<typeof referenceSchema>;
export type ReferenceRow = ReferenceDocument["rows"][number];

export class ReconciliationError extends Error {
  constructor(readonly code: string) { super(`Conciliación no disponible (${code}).`); this.name = "ReconciliationError"; }
}

/** Inclusive real calendar dates, bounded before touching saved records or a reference. */
export function dateRange(from: string, to: string): string[] {
  if (!date.safeParse(from).success || !date.safeParse(to).success) throw new ReconciliationError("INVALID_RANGE");
  const first = Date.parse(`${from}T00:00:00Z`), last = Date.parse(`${to}T00:00:00Z`);
  const days = (last - first) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 45) throw new ReconciliationError("INVALID_RANGE");
  return Array.from({ length: days }, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
}

const key = (row: { brand: string; platform: string; accountId: string; date: string; granularity: string }) => JSON.stringify([row.brand, row.platform, row.accountId, row.date, row.granularity]);
export function parseReference(value: unknown): ReferenceDocument {
  const result = referenceSchema.safeParse(value);
  if (!result.success) throw new ReconciliationError("INVALID_REFERENCE");
  const reference = result.data;
  try { dateRange(reference.from, reference.to); } catch { throw new ReconciliationError("INVALID_REFERENCE"); }
  const keys = reference.rows.map(key);
  if (new Set(keys).size !== keys.length || reference.rows.some(r => r.date < reference.from || r.date > reference.to)) throw new ReconciliationError("INVALID_REFERENCE");
  return reference;
}

export interface Comparison {
  code: FindingCode;
  source: number | null;
  reference: number | null;
  delta: number | null;
  relativeDelta: number | null;
}
export interface ReconciliationRow {
  brand: "izzi";
  platform: ReferenceRow["platform"];
  accountId: string;
  date: string;
  granularity: "daily";
  currency: "MXN" | "USD";
  timezone: string | null;
  sourceExtractedAt: string | null;
  metricExtractedAtFrom: string | null;
  metricExtractedAtTo: string | null;
  catalogExtractedAt: string | null;
  coverage: "COMPLETE_CATALOG" | "INCOMPLETE" | "MISSING";
  expectedCampaigns: number | null;
  observedCampaigns: number;
  sourceMetrics: Metrics;
  /** Observed rows only: never used as a complete account total when coverage is incomplete. */
  observedSubtotal: Metrics;
  reasons: string[];
  codes: FindingCode[];
  comparisons: Record<Metric, Comparison>;
}
export interface ReconciliationReport {
  version: 1;
  origin: "RECONCILIATION";
  brand: "izzi";
  from: string;
  to: string;
  generatedAt: string;
  reference: { origin: "ADS_MANAGER"; exportedAt: string; digestSha256: string } | null;
  policy: { spendAbsoluteTolerance: 0.01; countAbsoluteTolerance: 0; campaignScope: "ALL_CAMPAIGNS"; coverageBasis: "CURRENT_CATALOG"; currencyConversion: false; timezoneConversion: false };
  rows: ReconciliationRow[];
  counts: Record<FindingCode, number>;
  exitCode: 0 | 2;
  /** Matching declared exports is evidence, not production/v1 acceptance. */
  certifiesV1: false;
}

function reportZone(catalog: ApiCatalog | null, partition: ApiPartition | null, platform: string): string | null {
  const zones = [...new Set(partition?.rows.map(r => r.source_timezone) ?? [])];
  if (zones.length > 1) return null;
  if (zones.length === 1) return zones[0];
  if (platform === "microsoft" || platform === "spotify") return "UTC";
  const zone = catalog?.account.timezone;
  return zone && isValidTimeZone(zone) ? zone : null;
}

/** X can report historical days using today's fixed offset instead of their IANA boundaries. */
function incompatibleReportOffset(partition: ApiPartition | null): boolean {
  return partition?.rows.some(row => {
    const offset = row.raw_metrics.report_utc_offset_minutes;
    if (offset === undefined) return false;
    return [row.date, addDays(row.date, 1)].some(date =>
      Date.parse(`${date}T00:00:00Z`) - offset * 60000 !== zonedTimeToUtc(date, 0, 0, row.source_timezone).getTime(),
    );
  }) ?? false;
}

function sum(partition: ApiPartition | null, metric: Metric): number | null {
  if (!partition?.rows.length) return null;
  let total = 0;
  for (const row of partition.rows) {
    const n = row[metric];
    if (n === null || !Number.isFinite(n) || (metric !== "spend" && !Number.isSafeInteger(n))) return null;
    total += n;
    if (!Number.isFinite(total) || (metric !== "spend" && !Number.isSafeInteger(total))) return null;
  }
  return total;
}

function comparison(metric: Metric, source: number | null, reference: number | null, blocking?: FindingCode): Comparison {
  if (blocking) return { code: blocking, source, reference, delta: null, relativeDelta: null };
  if (source === null || reference === null) return { code: "UNKNOWN_METRIC", source, reference, delta: null, relativeDelta: null };
  const delta = source - reference;
  const epsilon = metric === "spend" ? Math.min(1e-6, Number.EPSILON * Math.max(1, source, reference) * 8) : 0;
  const match = Math.abs(delta) <= (metric === "spend" ? 0.01 + epsilon : 0);
  const relativeDelta = reference === 0 ? null : delta / reference;
  return { code: match ? "MATCH" : "DIFFERENCE", source, reference, delta, relativeDelta: relativeDelta !== null && Number.isFinite(relativeDelta) ? relativeDelta : null };
}

/** No API, FX, hourly/day conversion, or source mutations. Only explicit izzi mappings. */
export async function buildReconciliation(opts: {
  mapping: UnifiedMapping; store: Pick<UnifiedSnapshotStore, "catalog" | "partition">;
  from: string; to: string; reference?: unknown; now?: Date;
}): Promise<ReconciliationReport> {
  const dates = dateRange(opts.from, opts.to), now = opts.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ReconciliationError("INVALID_CLOCK");
  const mapping = mappingSchema.safeParse(opts.mapping);
  if (!mapping.success) throw new ReconciliationError("INVALID_MAPPING");
  const accounts = mapping.data.accounts.filter(a => a.brand === "izzi").sort((a, b) => `${a.platform}/${a.accountId}`.localeCompare(`${b.platform}/${b.accountId}`));
  if (!accounts.length) throw new ReconciliationError("NO_IZZI_ACCOUNTS");
  const reference = opts.reference === undefined ? null : parseReference(opts.reference);
  if (reference && (reference.from !== opts.from || reference.to !== opts.to || reference.rows.some(r => !accounts.some(a => a.platform === r.platform && a.accountId === r.accountId)))) throw new ReconciliationError("INVALID_REFERENCE_SCOPE");
  if (reference && (Date.parse(reference.exportedAt) > now.getTime() || reference.rows.some(r => r.date >= businessDate(new Date(reference.exportedAt), r.timezone)))) throw new ReconciliationError("INVALID_REFERENCE_TIME");
  const expected = new Map(reference?.rows.map(row => [key(row), row]) ?? []);
  const rows: ReconciliationRow[] = [];
  for (const scope of accounts) {
    const catalog = await opts.store.catalog(scope);
    for (const date of dates) {
      const partition = await opts.store.partition(scope, date, "daily");
      const zone = reportZone(catalog, partition, scope.platform);
      const reasons: string[] = [];
      const multipleClocks = new Set(partition?.rows.map(r => r.source_timezone) ?? []).size > 1;
      const incompatibleOffset = incompatibleReportOffset(partition);
      const incompatibleClocks = multipleClocks || incompatibleOffset;
      const expectedIds = new Set(catalog?.campaigns.map(c => c.campaign_id) ?? []);
      const observedIds = new Set(partition?.rows.map(r => r.campaign_id) ?? []);
      if (!catalog) reasons.push("MISSING_CATALOG");
      if (!partition?.rows.length) reasons.push("MISSING_DAILY_ROWS");
      if (!zone) reasons.push(multipleClocks ? "MULTIPLE_REPORT_CLOCKS" : "UNKNOWN_REPORT_CLOCK");
      if (incompatibleOffset) reasons.push("INCOMPATIBLE_REPORT_OFFSET");
      if (catalog && (!expectedIds.size || [...expectedIds].some(id => !observedIds.has(id)) || [...observedIds].some(id => !expectedIds.has(id)))) reasons.push("INCOMPLETE_CATALOG_COVERAGE");
      if (zone && date >= businessDate(now, zone)) reasons.push("OPEN_REPORT_DAY");
      if ((catalog && Date.parse(catalog.extractedAt) > now.getTime()) || (partition && (Date.parse(partition.extractedAt) > now.getTime() || partition.rows.some(r => Date.parse(r.extracted_at) > now.getTime())))) reasons.push("FUTURE_EXTRACTION");
      if (partition && zone && (businessDate(new Date(partition.extractedAt), zone) <= date || partition.rows.some(r => businessDate(new Date(r.extracted_at), zone) <= date))) reasons.push("EXTRACTED_BEFORE_DAY_CLOSED");
      const coverage = !partition?.rows.length || !catalog ? "MISSING" : reasons.length ? "INCOMPLETE" : "COMPLETE_CATALOG";
      const observedSubtotal: Metrics = incompatibleClocks ? nullMetrics() : { spend: sum(partition, "spend"), impressions: sum(partition, "impressions"), clicks: sum(partition, "clicks") };
      const sourceMetrics = coverage === "COMPLETE_CATALOG" ? { ...observedSubtotal } : nullMetrics();
      const base = { ...scope, brand: "izzi" as const, date, granularity: "daily" as const };
      const ref = expected.get(key(base));
      const blocking: FindingCode | undefined = incompatibleClocks || (ref && zone && ref.timezone !== zone) ? "INCOMPATIBLE_CLOCK" : ref && ref.currency !== scope.currency ? "INCOMPATIBLE_CURRENCY" : coverage !== "COMPLETE_CATALOG" ? "MISSING_SOURCE" : !ref ? "MISSING_REFERENCE" : undefined;
      const comparisons = Object.fromEntries(METRICS.map(metric => [metric, comparison(metric, sourceMetrics[metric], ref?.[metric] ?? null, blocking)])) as Record<Metric, Comparison>;
      const codes = [...new Set(METRICS.map(metric => comparisons[metric].code))];
      if (!ref && !codes.includes("MISSING_REFERENCE")) codes.push("MISSING_REFERENCE");
      const extractedTimes = partition?.rows.map(r => r.extracted_at).sort((a, b) => Date.parse(a) - Date.parse(b)) ?? [];
      rows.push({ ...base, timezone: zone, sourceExtractedAt: partition?.extractedAt ?? null, metricExtractedAtFrom: extractedTimes[0] ?? null, metricExtractedAtTo: extractedTimes.at(-1) ?? null, catalogExtractedAt: catalog?.extractedAt ?? null, coverage, expectedCampaigns: catalog?.campaigns.length ?? null, observedCampaigns: observedIds.size, sourceMetrics, observedSubtotal, reasons, codes, comparisons });
    }
  }
  const counts = Object.fromEntries(FINDING_CODES.map(code => [code, rows.filter(row => row.codes.includes(code)).length])) as Record<FindingCode, number>;
  return {
    version: 1, origin: "RECONCILIATION", brand: "izzi", from: opts.from, to: opts.to, generatedAt: now.toISOString(),
    reference: reference ? { origin: "ADS_MANAGER", exportedAt: reference.exportedAt, digestSha256: createHash("sha256").update(JSON.stringify(reference)).digest("hex") } : null,
    policy: { spendAbsoluteTolerance: 0.01, countAbsoluteTolerance: 0, campaignScope: "ALL_CAMPAIGNS", coverageBasis: "CURRENT_CATALOG", currencyConversion: false, timezoneConversion: false },
    rows, counts, exitCode: reference && rows.length > 0 && rows.every(row => row.codes.length === 1 && row.codes[0] === "MATCH") ? 0 : 2, certifiesV1: false,
  };
}
