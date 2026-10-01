import { ApiError } from "../../utils/errors.js";
import type { PerformanceQuery, CampaignStatus } from "../../types/normalized.js";

export const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer";
export const CLIENTS_QUERY =
  "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level > 0";

export function campaignId(value: string): string {
  if (!/^[1-9]\d{0,19}$/.test(value))
    throw new ApiError("INVALID_REQUEST", "El ID de campaña de Google Ads debe ser numérico.");
  return value;
}

export function campaignStatus(value: string | undefined): CampaignStatus {
  return value === "ENABLED" ? "active" : value === "PAUSED" ? "paused" : value === "REMOVED" ? "removed" : "unknown";
}

export function validateRange(q: PerformanceQuery): void {
  const valid = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (
    !valid(q.date_from) ||
    !valid(q.date_to) ||
    q.date_from > q.date_to ||
    (Date.parse(q.date_to) - Date.parse(q.date_from)) / 86400000 > 365
  )
    throw new ApiError("INVALID_REQUEST", "El rango debe contener fechas válidas, ordenadas y hasta 366 días.");
  if (q.granularity !== "daily" && q.granularity !== "hourly")
    throw new ApiError("INVALID_REQUEST", "La granularidad debe ser daily u hourly.");
  if (q.campaign_id) campaignId(q.campaign_id);
}

export function campaignsQuery(): string {
  return "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id";
}

export function performanceQuery(q: PerformanceQuery): string {
  validateRange(q);
  return `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date${q.granularity === "hourly" ? ", segments.hour" : ""}, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.video_trueview_views, metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate FROM campaign WHERE segments.date BETWEEN '${q.date_from}' AND '${q.date_to}'${q.campaign_id ? ` AND campaign.id = ${campaignId(q.campaign_id)}` : ""} ORDER BY segments.date, campaign.id${q.granularity === "hourly" ? ", segments.hour" : ""}`;
}

export function conversionsQuery(q: PerformanceQuery): string {
  validateRange(q);
  // Las métricas no segmentables por acción (p. ej. cost_micros) van en performance, nunca aquí.
  return `SELECT campaign.id, segments.date${q.granularity === "hourly" ? ", segments.hour" : ""}, segments.conversion_action, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM campaign WHERE segments.date BETWEEN '${q.date_from}' AND '${q.date_to}'${q.campaign_id ? ` AND campaign.id = ${campaignId(q.campaign_id)}` : ""} ORDER BY segments.date, campaign.id${q.granularity === "hourly" ? ", segments.hour" : ""}`;
}
