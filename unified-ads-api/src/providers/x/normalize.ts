import type {
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
} from "../../types/normalized.js";
import { derivedMetrics, microsToCurrency } from "../../normalization/metrics.js";
import type { ConversionCategory } from "../../normalization/conversions.js";
import { ApiError } from "../../utils/errors.js";
import { xId, X_CONVERSIONS, X_PLACEMENTS, type XConfig } from "./config.js";
import type { XBucket } from "./reports.js";
export function normalizeCampaign(row: Record<string, unknown>, account: NormalizedAccount): NormalizedCampaign {
  const status = row.deleted === true ? "DELETED" : row.entity_status;
  return {
    platform: "x",
    account_id: account.account_id,
    client_id: account.client_id,
    campaign_id: xId(row.id),
    campaign_name: typeof row.name === "string" ? row.name : xId(row.id),
    campaign_status:
      status === "DELETED" ? "removed" : status === "ACTIVE" ? "active" : status === "PAUSED" ? "paused" : "unknown",
    source_status: typeof status === "string" ? status : null,
    objective: null,
  };
}
function raw(row: XBucket, config: XConfig, timezone: string | null) {
  return {
    placements: row.raw,
    attribution: config.attribution,
    source_timezone: timezone,
    report_utc_offset_minutes: row.offset,
    requested_placements: [...X_PLACEMENTS],
    spend_provisional_days: 3,
  };
}
export function normalizePerformance(
  row: XBucket,
  account: NormalizedAccount,
  campaign: Record<string, unknown>,
  config: XConfig,
  at: string,
): NormalizedPerformance {
  const normalized = normalizeCampaign(campaign, account),
    primary = config.primaryMapping[account.account_id] ?? config.primary;
  const spend = microsToCurrency(row.metrics.billed_charge_local_micro ?? null),
    impressions = row.metrics.impressions ?? null,
    clicks = row.metrics.clicks ?? null,
    conversions = primary ? (row.metrics[primary] ?? null) : null;
  if (typeof campaign.currency !== "string" || !/^[A-Z]{3}$/.test(campaign.currency))
    throw new ApiError("PROVIDER_ERROR", "X Ads no devolvió la moneda de la campaña.");
  return {
    ...normalized,
    account_name: account.account_name,
    date: row.date,
    hour: row.hour,
    currency: campaign.currency,
    spend,
    impressions,
    clicks,
    conversions,
    conversion_value: null,
    ...derivedMetrics({ spend, impressions, clicks, conversions }),
    reach: null,
    frequency: null,
    link_clicks: row.metrics.url_clicks ?? null,
    video_views: row.metrics.video_total_views ?? null,
    video_25: row.metrics.video_views_25 ?? null,
    video_50: row.metrics.video_views_50 ?? null,
    video_75: row.metrics.video_views_75 ?? null,
    video_100: row.metrics.video_views_100 ?? null,
    source_timezone: account.timezone,
    extracted_at: at,
    raw_metrics: { ...raw(row, config, account.timezone), primary_conversion_metric: primary },
  };
}
const CATEGORIES: Partial<Record<(typeof X_CONVERSIONS)[number], ConversionCategory>> = {
  conversion_purchases: "PURCHASE",
  conversion_sign_ups: "REGISTRATION",
  conversion_site_visits: "PAGE_VIEW",
  conversion_add_to_carts: "ADD_TO_CART",
  conversion_checkouts_initiated: "BEGIN_CHECKOUT",
  conversion_content_views: "VIEW_CONTENT",
  conversion_landing_page_views: "PAGE_VIEW",
};
export function normalizeConversions(
  row: XBucket,
  account: NormalizedAccount,
  config: XConfig,
  at: string,
): NormalizedConversion[] {
  return X_CONVERSIONS.filter((key) => Object.hasOwn(row.metrics, key)).map((key) => ({
    platform: "x",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: row.campaignId,
    date: row.date,
    hour: row.hour,
    source_conversion: key,
    normalized_conversion: config.conversionMapping[key] ?? CATEGORIES[key] ?? null,
    conversions: row.metrics[key] ?? null,
    conversion_value: null,
    extracted_at: at,
    raw_metrics: {
      ...raw(row, config, account.timezone),
      currency: account.currency,
      count_metric: key,
      overlapping_action_types: true,
    },
  }));
}
