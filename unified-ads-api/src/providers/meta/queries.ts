import { z } from "zod";
import type { PerformanceQuery } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { metaId, type MetaConfig } from "./config.js";

export const ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status";
/** El campo business exige business_management incluso con ads_read válido. */
export function accountFields(config: MetaConfig): string {
  return ACCOUNT_FIELDS + (config.includeBusinessMetadata ? ",business" : "");
}
export const CAMPAIGN_FIELDS = "id,name,status,effective_status,objective";
export const HOUR_FIELD = "hourly_stats_aggregated_by_advertiser_time_zone";
export function insightsWindows(q: PerformanceQuery): PerformanceQuery[] {
  insightsParams(q); // Validate the entire user range before splitting it.
  const size = q.granularity === "hourly" ? 1 : 30,
    day = 86400000;
  const windows: PerformanceQuery[] = [];
  for (let start = Date.parse(q.date_from), end = Date.parse(q.date_to); start <= end;) {
    const last = Math.min(end, start + (size - 1) * day);
    windows.push({
      ...q,
      date_from: new Date(start).toISOString().slice(0, 10),
      date_to: new Date(last).toISOString().slice(0, 10),
    });
    start = last + day;
  }
  return windows;
}
const baseFields = "account_id,account_name,account_currency,campaign_id,campaign_name,date_start,date_stop";
export function insightsParams(q: PerformanceQuery, conversions = false): Record<string, string> {
  if (
    !z.iso.date().safeParse(q.date_from).success ||
    !z.iso.date().safeParse(q.date_to).success ||
    q.date_from > q.date_to ||
    (Date.parse(q.date_to) - Date.parse(q.date_from)) / 86400000 > 365 ||
    !["daily", "hourly"].includes(q.granularity)
  )
    throw new ApiError("INVALID_REQUEST", "Fechas o granularidad de Meta inválidas (máximo 366 días).");
  const metrics = conversions
    ? "actions,action_values"
    : "spend,impressions,clicks,inline_link_clicks,actions,action_values,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions";
  return {
    fields: `${baseFields},${metrics}${!conversions && q.granularity === "daily" ? ",reach,frequency" : ""}`,
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: q.date_from, until: q.date_to }),
    action_report_time: "impression",
    use_unified_attribution_setting: "true",
    ...(q.granularity === "hourly" ? { breakdowns: HOUR_FIELD } : {}),
    ...(q.campaign_id
      ? { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: [metaId(q.campaign_id)] }]) }
      : {}),
  };
}
