import { z } from "zod";
import type {
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
} from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { derivedMetrics } from "../../normalization/metrics.js";
import { CONVERSION_METRICS, tiktokId, type TikTokConfig } from "./config.js";
import { primaryMetric, requestedConversionMetrics } from "./queries.js";
import { tiktokNumber, tiktokObject, type TikTokAccount, type TikTokCampaign, type TikTokReport } from "./types.js";

function upstreamId(value: unknown): string {
  try {
    return tiktokId(value as string);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió un ID inválido; se requieren IDs en texto.");
  }
}
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value !== "-" ? value : null;
}
export function normalizeAccount(row: TikTokAccount, config: TikTokConfig): NormalizedAccount {
  const id = upstreamId(row.advertiser_id);
  return {
    platform: "tiktok",
    client_id: config.clientMapping[id] ?? null,
    account_id: id,
    account_name: text(row.name) ?? id,
    currency: text(row.currency),
    // timezone es la zona del reporte; display_timezone puede ser solo la etiqueta visible.
    timezone: text(row.timezone) ?? text(row.display_timezone),
    status: text(row.status),
    manager_account_id: row.owner_bc_id ? upstreamId(row.owner_bc_id) : null,
    is_manager: false,
  };
}
export function normalizeCampaign(row: TikTokCampaign, account: NormalizedAccount): NormalizedCampaign {
  if (row.advertiser_id !== undefined && upstreamId(row.advertiser_id) !== account.account_id)
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió una campaña de otra cuenta.");
  const id = upstreamId(row.campaign_id),
    source = text(row.secondary_status) ?? text(row.operation_status);
  return {
    platform: "tiktok",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: id,
    campaign_name: text(row.campaign_name) ?? id,
    source_status: source,
    objective: text(row.objective_type),
    campaign_status:
      source === "CAMPAIGN_STATUS_DELETE"
        ? "removed"
        : source === "CAMPAIGN_STATUS_ENABLE" || source === "ENABLE"
          ? "active"
          : source === "CAMPAIGN_STATUS_DISABLE" || source === "DISABLE"
            ? "paused"
            : "unknown",
  };
}
export function reportBucket(row: TikTokReport, account: NormalizedAccount, query: PerformanceQuery) {
  if (!tiktokObject(row.dimensions) || !tiktokObject(row.metrics))
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió dimensiones o métricas inválidas.");
  const { dimensions, metrics } = row;
  const raw = dimensions[query.granularity === "daily" ? "stat_time_day" : "stat_time_hour"];
  const match =
    typeof raw === "string"
      ? query.granularity === "daily"
        ? /^(\d{4}-\d{2}-\d{2})(?:[ T]00:00:00)?$/.exec(raw)
        : /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):00:00$/.exec(raw)
      : null;
  if (
    !match ||
    !z.iso.date().safeParse(match[1]).success ||
    match[1]! < query.date_from ||
    match[1]! > query.date_to ||
    (query.granularity === "hourly" && Number(match[2]) > 23)
  )
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió un periodo incompatible con la consulta.");
  const campaignId = upstreamId(dimensions.campaign_id);
  if (
    (query.campaign_id && campaignId !== query.campaign_id) ||
    (metrics.advertiser_id !== undefined && upstreamId(metrics.advertiser_id) !== account.account_id)
  )
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió datos de otra campaña o cuenta.");
  return { date: match[1]!, hour: query.granularity === "hourly" ? Number(match[2]) : null, campaignId, metrics };
}
export function normalizePerformance(
  row: TikTokReport,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: TikTokConfig,
  at: string,
): NormalizedPerformance {
  const { date, hour, campaignId, metrics } = reportBucket(row, account, query);
  const primary = primaryMetric(config, account.account_id),
    valueMetric = CONVERSION_METRICS[primary]?.value;
  const spend = tiktokNumber(metrics.spend),
    impressions = tiktokNumber(metrics.impressions),
    clicks = tiktokNumber(metrics.clicks),
    conversions = tiktokNumber(metrics[primary]);
  return {
    platform: "tiktok",
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    campaign_id: campaignId,
    campaign_name: text(metrics.campaign_name),
    campaign_status: null,
    objective: text(metrics.objective_type),
    date,
    hour,
    currency: account.currency,
    spend,
    impressions,
    clicks,
    // TikTok reporta clicks (destination), no clics sociales de cualquier tipo.
    link_clicks: clicks,
    reach: hour === null ? tiktokNumber(metrics.reach) : null,
    frequency: hour === null ? tiktokNumber(metrics.frequency) : null,
    conversions,
    conversion_value: valueMetric ? tiktokNumber(metrics[valueMetric]) : null,
    ...derivedMetrics({ spend, impressions, clicks, conversions }),
    video_views: tiktokNumber(metrics.video_play_actions),
    video_25: tiktokNumber(metrics.video_views_p25),
    video_50: tiktokNumber(metrics.video_views_p50),
    video_75: tiktokNumber(metrics.video_views_p75),
    video_100: tiktokNumber(metrics.video_views_p100),
    source_timezone: account.timezone,
    extracted_at: at,
    raw_metrics: {
      ...metrics,
      dimensions: row.dimensions,
      primary_conversion_metric: primary,
      attribution: "ad_interaction_time",
      clicks_definition: "destination",
      ...(hour === null ? {} : { omitted_metrics: ["reach", "frequency"] }),
    },
  };
}
export function normalizeConversions(
  row: TikTokReport,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: TikTokConfig,
  at: string,
): NormalizedConversion[] {
  const { date, hour, campaignId, metrics } = reportBucket(row, account, query);
  return requestedConversionMetrics(config, account.account_id, true)
    .filter(
      (name) =>
        Object.hasOwn(metrics, name) ||
        (CONVERSION_METRICS[name]?.value && Object.hasOwn(metrics, CONVERSION_METRICS[name]!.value!)),
    )
    .map((name) => {
      const definition = CONVERSION_METRICS[name]!;
      return {
        platform: "tiktok",
        client_id: account.client_id,
        account_id: account.account_id,
        campaign_id: campaignId,
        date,
        hour,
        source_conversion: name,
        normalized_conversion: config.conversionMapping[name] ?? definition.category,
        conversions: tiktokNumber(metrics[name]),
        conversion_value: definition.value ? tiktokNumber(metrics[definition.value]) : null,
        extracted_at: at,
        raw_metrics: {
          count: metrics[name] ?? null,
          value: definition.value ? (metrics[definition.value] ?? null) : null,
          value_metric: definition.value ?? null,
          currency: account.currency,
          source_timezone: account.timezone,
          attribution: "ad_interaction_time",
          is_primary: name === primaryMetric(config, account.account_id),
          overlapping_action_types: true,
        },
      };
    });
}
