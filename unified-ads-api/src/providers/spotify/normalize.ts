import { ApiError } from "../../utils/errors.js";
import { derivedMetrics } from "../../normalization/metrics.js";
import type { ConversionCategory } from "../../normalization/conversions.js";
import type {
  CampaignStatus,
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedPerformance,
  NormalizedConversion,
  PerformanceQuery,
} from "../../types/normalized.js";
import { object, CONVERSION_FIELDS, type SpotifyConfig } from "./config.js";
import { vendorId } from "./accounts.js";

export function campaignStatus(value: unknown): CampaignStatus {
  if (["ACTIVE", "ACTIVE_RESTRICTED"].includes(String(value))) return "active";
  if (value === "PAUSED") return "paused";
  if (value === "ARCHIVED") return "removed";
  return "unknown";
}
export function normalizeCampaign(row: Record<string, unknown>, account: NormalizedAccount): NormalizedCampaign {
  if (typeof row.name !== "string" || !row.name.trim())
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una campaña sin nombre.");
  const goal = [row.delivery_goal_group, row.objective].find(
    (v) => typeof v === "string" && v !== "UNSET" && v !== "UNRECOGNIZED",
  );
  return {
    platform: "spotify",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: vendorId(row.id),
    campaign_name: row.name,
    campaign_status: campaignStatus(row.status),
    source_status: typeof row.status === "string" ? row.status : null,
    objective: typeof goal === "string" ? goal : null,
  };
}
export function reportBucket(row: Record<string, unknown>, query: PerformanceQuery) {
  if (row.entity_type !== "CAMPAIGN")
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió otra dimensión de informe.");
  const campaignId = vendorId(row.entity_id);
  if (query.campaign_id && campaignId !== query.campaign_id.toLowerCase())
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió otra campaña.");
  const parseTime = (s: unknown) => {
    if (
      typeof s !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0{1,3})?Z$/.test(s) ||
      !Number.isFinite(Date.parse(s)) ||
      new Date(s).toISOString().slice(0, 19) !== s.slice(0, 19)
    )
      throw new ApiError("PROVIDER_ERROR", "Spotify devolvió un periodo UTC inválido.");
    return Date.parse(s);
  };
  const start = parseTime(row.start_time),
    end = parseTime(row.end_time),
    duration = query.granularity === "hourly" ? 3600000 : 86400000;
  const date = new Date(start).toISOString().slice(0, 10);
  if (start % duration !== 0 || end < start || end > start + duration || date < query.date_from || date > query.date_to)
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió un periodo distinto al día u hora solicitado.");
  return { campaignId, date, hour: query.granularity === "hourly" ? new Date(start).getUTCHours() : null };
}
export function reportMetrics(row: Record<string, unknown>) {
  if (!Array.isArray(row.stats) || row.stats.length > 1000)
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió estadísticas incompatibles.");
  const out = Object.create(null) as Record<string, number | null>;
  for (const stat of row.stats) {
    if (
      !object(stat) ||
      typeof stat.field_type !== "string" ||
      !/^[A-Z][A-Z\d_]{0,63}$/.test(stat.field_type) ||
      Object.hasOwn(out, stat.field_type)
    )
      throw new ApiError("PROVIDER_ERROR", "Spotify devolvió métricas inválidas o repetidas.");
    const value = stat.field_value;
    // Ads v3 documents -5 for suppressed conversion counts (actual count 1–4).
    // A real response also returned REVENUE=-5: preserve it as unavailable, never negative revenue
    // or a guessed conversion count. Other negative metrics remain invalid.
    if (
      value === -5 &&
      ((CONVERSION_FIELDS as readonly string[]).includes(stat.field_type) || stat.field_type === "REVENUE")
    ) {
      out[stat.field_type] = null;
      continue;
    }
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    )
      throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una métrica numérica inválida.");
    out[stat.field_type] = value as number | null;
  }
  return out;
}
export function censoredConversionFields(row: Record<string, unknown>): string[] {
  return Array.isArray(row.stats)
    ? row.stats.flatMap((stat) =>
        object(stat) &&
        stat.field_value === -5 &&
        typeof stat.field_type === "string" &&
        (CONVERSION_FIELDS as readonly string[]).includes(stat.field_type)
          ? [stat.field_type]
          : [],
      )
    : [];
}
export function unavailableRevenue(row: Record<string, unknown>): boolean {
  return (
    Array.isArray(row.stats) &&
    row.stats.some((stat) => object(stat) && stat.field_type === "REVENUE" && stat.field_value === -5)
  );
}
export function normalizePerformance(
  row: Record<string, unknown>,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: SpotifyConfig,
  at: string,
): NormalizedPerformance {
  const { campaignId, date, hour } = reportBucket(row, query),
    metrics = reportMetrics(row);
  const primary = config.primaryMapping[account.account_id] ?? config.primaryMetric;
  const spend = metrics.SPEND ?? null,
    impressions = metrics.IMPRESSIONS ?? null,
    clicks = metrics.CLICKS ?? null;
  const conversions = primary ? (metrics[primary] ?? null) : null;
  const censored = censoredConversionFields(row);
  return {
    platform: "spotify",
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    campaign_id: campaignId,
    campaign_name: typeof row.entity_name === "string" ? row.entity_name : null,
    campaign_status: typeof row.entity_status === "string" ? campaignStatus(row.entity_status) : null,
    objective: null,
    date,
    hour,
    currency: account.currency,
    spend,
    impressions,
    clicks,
    conversions,
    // REVENUE combines attributed purchase and lead values. It cannot be assigned to one chosen event.
    conversion_value: null,
    ...derivedMetrics({ spend, impressions, clicks, conversions }),
    reach: metrics.REACH ?? null,
    frequency: metrics.FREQUENCY ?? null,
    link_clicks: null,
    video_views: metrics.VIDEO_VIEWS ?? null,
    // These quartiles include audio AND video, so they are not video-only completion counts.
    video_25: null,
    video_50: null,
    video_75: null,
    video_100: null,
    source_timezone: "UTC",
    extracted_at: at,
    raw_metrics: {
      ...metrics,
      primary_conversion_metric: primary,
      source_timezone: "UTC",
      censored_conversion_fields: censored,
      privacy_suppression_source_value: censored.length ? -5 : null,
      unavailable_revenue_source_value: unavailableRevenue(row) ? -5 : null,
    },
  };
}
// Mismo vocabulario en mayúsculas que las demás plataformas (normalization/conversions.ts).
const CATEGORIES: Record<string, ConversionCategory> = {
  PAGE_VIEWS: "PAGE_VIEW",
  LEADS: "LEAD",
  ADD_TO_CART: "ADD_TO_CART",
  PURCHASES: "PURCHASE",
  START_CHECKOUT: "BEGIN_CHECKOUT",
  PRODUCTS: "VIEW_CONTENT",
  SIGN_UPS: "REGISTRATION",
};
export function normalizeConversions(
  row: Record<string, unknown>,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: SpotifyConfig,
  at: string,
): NormalizedConversion[] {
  const { campaignId, date, hour } = reportBucket(row, query),
    metrics = reportMetrics(row);
  return CONVERSION_FIELDS.filter((field) => Object.hasOwn(metrics, field)).map((field) => ({
    platform: "spotify",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: campaignId,
    date,
    hour,
    source_conversion: field,
    normalized_conversion: config.conversionMapping[field] ?? CATEGORIES[field] ?? null,
    conversions: metrics[field] ?? null,
    conversion_value: null,
    extracted_at: at,
    raw_metrics: {
      ...metrics,
      source_timezone: "UTC",
      currency: account.currency,
      count_metric: field,
      censored_conversion_fields: censoredConversionFields(row),
      privacy_suppression_source_value: censoredConversionFields(row).includes(field) ? -5 : null,
      unavailable_revenue_source_value: unavailableRevenue(row) ? -5 : null,
    },
  }));
}
