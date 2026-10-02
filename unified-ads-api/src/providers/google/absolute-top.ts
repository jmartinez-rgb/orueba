import { withGoogleDomain } from "../../config/google-domains.js";
import { ctr, cpc } from "../../normalization/metrics.js";
import type { NormalizedAccount } from "../../types/normalized.js";
import type {
  GoogleAbsoluteTopQuery,
  GoogleAbsoluteTopRow,
  GoogleShareMetric,
} from "../../types/google-absolute-top.js";
import { ApiError } from "../../utils/errors.js";
import type { GoogleAdsClient } from "./client.js";
import { customerId } from "./config.js";
import { validateRange } from "./queries.js";
import { googleNumber, type GoogleRow } from "./types.js";

type Level = GoogleAbsoluteTopRow["level"];
const ACTIVE_SEARCH = "campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'";
const CAMPAIGN_FIELDS =
  "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type";
const GROUP_FIELDS = ", ad_group.id, ad_group.name, ad_group.status";
const METRICS = [
  "metrics.absolute_top_impression_percentage",
  "metrics.top_impression_percentage",
  "metrics.search_impression_share",
  "metrics.search_rank_lost_impression_share",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
];

/** Validate before configuration or network access; no arbitrary account-wide read. */
export function validateAbsoluteTopQuery(query: GoogleAbsoluteTopQuery): GoogleAbsoluteTopQuery {
  validateRange(query);
  if ((Date.parse(query.date_to) - Date.parse(query.date_from)) / 86400000 > 6)
    throw new ApiError("INVALID_REQUEST", "Absolute Top admite un máximo de 7 días por cuenta.");
  return { ...query, account_id: customerId(query.account_id) };
}

export function absoluteTopCatalogQuery(level: Level): string {
  return `SELECT ${CAMPAIGN_FIELDS}${level === "ad_group" ? GROUP_FIELDS : ", campaign_budget.amount_micros, campaign_budget.period"} FROM ${level} WHERE ${ACTIVE_SEARCH}${level === "ad_group" ? " AND ad_group.status = 'ENABLED'" : ""} ORDER BY campaign.id${level === "ad_group" ? ", ad_group.id" : ""}`;
}

export function absoluteTopMetricsQuery(query: GoogleAbsoluteTopQuery, level: Level): string {
  validateAbsoluteTopQuery(query);
  const fields = [
    "customer.id",
    CAMPAIGN_FIELDS,
    ...(level === "ad_group" ? [GROUP_FIELDS.slice(2)] : []),
    "segments.date",
    ...(query.granularity === "hourly" ? ["segments.hour"] : []),
    "segments.ad_network_type",
    ...METRICS,
    ...(level === "campaign" ? ["metrics.search_budget_lost_impression_share"] : []),
  ];
  return `SELECT ${fields.join(", ")} FROM ${level} WHERE ${ACTIVE_SEARCH}${level === "ad_group" ? " AND ad_group.status = 'ENABLED'" : ""} AND segments.ad_network_type = 'SEARCH' AND segments.date BETWEEN '${query.date_from}' AND '${query.date_to}' ORDER BY segments.date, campaign.id${level === "ad_group" ? ", ad_group.id" : ""}${query.granularity === "hourly" ? ", segments.hour" : ""}`;
}

const fail = () => new ApiError("PROVIDER_ERROR", "Google Ads devolvió una observación Absolute Top inválida.");
const validId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);

function entityKey(row: GoogleRow, level: Level): string {
  if (!validId(row.campaign?.id) || (level === "ad_group" && !validId(row.adGroup?.id))) throw fail();
  return `${row.campaign.id}:${level === "ad_group" ? row.adGroup!.id : ""}`;
}

function catalog(rows: GoogleRow[], level: Level): Map<string, GoogleRow> {
  const result = new Map<string, GoogleRow>();
  for (const row of rows) {
    if (
      !row.campaign ||
      typeof row.campaign.status !== "string" ||
      typeof row.campaign.advertisingChannelType !== "string" ||
      (row.campaign.name !== undefined && typeof row.campaign.name !== "string") ||
      (row.campaign.biddingStrategyType !== undefined && typeof row.campaign.biddingStrategyType !== "string") ||
      (row.adGroup?.name !== undefined && typeof row.adGroup.name !== "string") ||
      (level === "ad_group" && (!row.adGroup || typeof row.adGroup.status !== "string"))
    )
      throw fail();
    if (
      row.campaign?.status !== "ENABLED" ||
      row.campaign.advertisingChannelType !== "SEARCH" ||
      (level === "ad_group" && row.adGroup?.status !== "ENABLED")
    )
      continue;
    const key = entityKey(row, level);
    if (result.has(key)) throw fail();
    result.set(key, row);
  }
  return result;
}

function nonnegative(metrics: Record<string, unknown>, name: string, count = false): number | null {
  const n = googleNumber(metrics[name]);
  return n === null || n < 0 || (count && !Number.isSafeInteger(n)) ? null : n;
}

function normalizeObservation(
  entity: GoogleRow,
  report: GoogleRow | undefined,
  account: NormalizedAccount,
  level: Level,
  date: string,
  hour: number | null,
  at: string,
): GoogleAbsoluteTopRow {
  const warnings = ["CONVERSIONS_ARE_GOOGLE_PLATFORM_TOTAL", "IMPRESSION_SHARES_MAY_UPDATE_WITHIN_1_2_DAYS"];
  const metrics = report?.metrics ?? {};
  const shareBounds: NonNullable<GoogleAbsoluteTopRow["share_bounds"]> = {};
  const ratio = (name: string): number | null => {
    const n = googleNumber(metrics[name]);
    if (n === null || n < 0 || n > 1) {
      if (Object.hasOwn(metrics, name)) warnings.push("INVALID_OR_NULL_RATIO");
      return null;
    }
    return n;
  };
  const share = (
    field: GoogleShareMetric,
    name: string,
    sentinel: number,
    bound: "lt_10_percent" | "gt_90_percent",
  ) => {
    const value = ratio(name);
    if (value === sentinel) {
      shareBounds[field] = bound;
      return null;
    }
    return value;
  };
  if (!report) warnings.push("NO_METRICS_ROW");
  if (level === "ad_group") warnings.push("AD_GROUP_LOST_IS_BUDGET_NOT_AVAILABLE");
  const impressions = nonnegative(metrics, "impressions", true);
  const clicks = nonnegative(metrics, "clicks", true);
  const micros = nonnegative(metrics, "costMicros", true);
  const spend = micros === null ? null : micros / 1000000;
  const dailyMicros =
    entity.campaignBudget?.period === "DAILY" ? googleNumber(entity.campaignBudget.amountMicros) : null;
  const row = withGoogleDomain({
    platform: "google" as const,
    account_id: account.account_id,
    account_name: account.account_name,
    level,
    campaign_id: entity.campaign!.id!,
    campaign_name: entity.campaign!.name ?? entity.campaign!.id!,
    campaign_status: "active" as const,
    ad_group_id: level === "ad_group" ? entity.adGroup!.id! : null,
    ad_group_name: level === "ad_group" ? (entity.adGroup!.name ?? entity.adGroup!.id!) : null,
    ad_group_status: level === "ad_group" ? ("active" as const) : null,
    date,
    hour,
    currency: account.currency,
    source_timezone: account.timezone,
    extracted_at: at,
    absolute_top_rate: ratio("absoluteTopImpressionPercentage"),
    top_of_page_rate: ratio("topImpressionPercentage"),
    search_impression_share: share("search_impression_share", "searchImpressionShare", 0.0999, "lt_10_percent"),
    search_lost_is_rank: share("search_lost_is_rank", "searchRankLostImpressionShare", 0.9001, "gt_90_percent"),
    search_lost_is_budget:
      level === "campaign"
        ? share("search_lost_is_budget", "searchBudgetLostImpressionShare", 0.9001, "gt_90_percent")
        : null,
    impressions,
    clicks,
    ctr: ctr(clicks, impressions),
    cpc: cpc(spend, clicks),
    spend,
    conversions: nonnegative(metrics, "conversions"),
    bidding_strategy: entity.campaign?.biddingStrategyType ?? null,
    daily_budget: level === "campaign" && dailyMicros !== null && dailyMicros >= 0 ? dailyMicros / 1000000 : null,
    ...(Object.keys(shareBounds).length ? { share_bounds: shareBounds } : {}),
    warnings,
  });
  if (row.domain_warning) row.warnings.push(row.domain_warning);
  if (row.absolute_top_rate === null) row.warnings.push("ABSOLUTE_TOP_RATE_NOT_AVAILABLE");
  row.warnings = [...new Set(row.warnings)];
  return row;
}

/** Independent native observations; never derive a campaign from its groups or copy a daily rate to hours. */
export function joinAbsoluteTopRows(
  catalogRows: GoogleRow[],
  metricRows: GoogleRow[],
  account: NormalizedAccount,
  query: GoogleAbsoluteTopQuery,
  level: Level,
  at: string,
): GoogleAbsoluteTopRow[] {
  const scoped = validateAbsoluteTopQuery(query);
  if (
    account.account_id !== scoped.account_id ||
    account.platform !== "google" ||
    typeof account.account_name !== "string"
  )
    throw fail();
  const entities = catalog(catalogRows, level);
  const reports = new Map<string, GoogleRow>();
  for (const row of metricRows) {
    const key = entityKey(row, level);
    const date = row.segments?.date;
    const hour = row.segments?.hour;
    if (
      !entities.has(key) ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date < query.date_from ||
      date > query.date_to ||
      (query.granularity === "hourly" && (!Number.isInteger(hour) || hour! < 0 || hour! > 23)) ||
      (query.granularity === "daily" && hour !== undefined && hour !== null) ||
      row.segments?.adNetworkType !== "SEARCH" ||
      (row.customer?.id !== undefined && row.customer.id !== account.account_id) ||
      !row.metrics ||
      typeof row.metrics !== "object" ||
      Array.isArray(row.metrics)
    )
      throw fail();
    const reportKey = `${key}:${date}:${query.granularity === "hourly" ? hour : ""}`;
    if (reports.has(reportKey)) throw fail();
    reports.set(reportKey, row);
  }
  const days = (Date.parse(query.date_to) - Date.parse(query.date_from)) / 86400000 + 1;
  if (entities.size * days * (query.granularity === "hourly" ? 24 : 1) > 100000)
    throw new ApiError("PROVIDER_ERROR", "Absolute Top excede el límite de observaciones de una lectura.");
  const result: GoogleAbsoluteTopRow[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(Date.parse(query.date_from) + offset * 86400000).toISOString().slice(0, 10);
    for (const [key, entity] of entities) {
      for (let h = 0; h < (query.granularity === "hourly" ? 24 : 1); h++) {
        const hour = query.granularity === "hourly" ? h : null;
        const report = reports.get(`${key}:${date}:${hour ?? ""}`);
        result.push(normalizeObservation(entity, report, account, level, date, hour, at));
      }
    }
  }
  return result;
}

export async function readAbsoluteTop(
  client: GoogleAdsClient,
  account: NormalizedAccount,
  query: GoogleAbsoluteTopQuery,
  signal: AbortSignal,
): Promise<GoogleAbsoluteTopRow[]> {
  const at = new Date().toISOString();
  const result: GoogleAbsoluteTopRow[] = [];
  for (const level of ["campaign", "ad_group"] as const) {
    signal.throwIfAborted();
    const catalogRows = await client.search(
      account.account_id,
      absoluteTopCatalogQuery(level),
      signal,
      account.manager_account_id ?? undefined,
    );
    const metricRows = await client.search(
      account.account_id,
      absoluteTopMetricsQuery(query, level),
      signal,
      account.manager_account_id ?? undefined,
    );
    result.push(...joinAbsoluteTopRows(catalogRows, metricRows, account, query, level, at));
  }
  return result;
}
