import { z } from "zod";
import type { DateRange, PerformanceQuery } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { CONVERSION_METRICS, tiktokId, type TikTokConfig } from "./config.js";

export const ACCOUNT_FIELDS = [
  "advertiser_id",
  "name",
  "currency",
  "timezone",
  "display_timezone",
  "status",
  "owner_bc_id",
];
export const CAMPAIGN_FIELDS = [
  "advertiser_id",
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
  "objective_type",
];
/** TikTok limita a 30 días con stat_time_day y a un día con stat_time_hour. */
export function reportWindows(query: PerformanceQuery): DateRange[] {
  if (
    !z.iso.date().safeParse(query.date_from).success ||
    !z.iso.date().safeParse(query.date_to).success ||
    query.date_from > query.date_to ||
    (Date.parse(query.date_to) - Date.parse(query.date_from)) / 86400000 > 365 ||
    !["daily", "hourly"].includes(query.granularity)
  )
    throw new ApiError("INVALID_REQUEST", "Fechas o granularidad de TikTok inválidas (máximo 366 días).");
  if (query.account_id) tiktokId(query.account_id);
  if (query.campaign_id) tiktokId(query.campaign_id);
  const days = query.granularity === "daily" ? 30 : 1;
  const end = Date.parse(query.date_to),
    output: DateRange[] = [];
  for (let start = Date.parse(query.date_from); start <= end; start += days * 86400000)
    output.push({
      date_from: new Date(start).toISOString().slice(0, 10),
      date_to: new Date(Math.min(end, start + (days - 1) * 86400000)).toISOString().slice(0, 10),
    });
  return output;
}
export function primaryMetric(config: TikTokConfig, accountId: string) {
  return config.primaryMetrics[accountId] ?? config.primaryMetric;
}
export function requestedConversionMetrics(config: TikTokConfig, accountId: string, all = false): string[] {
  return [...new Set([...(all ? config.conversionMetrics : []), primaryMetric(config, accountId)])];
}
export function reportParams(
  query: PerformanceQuery,
  accountId: string,
  config: TikTokConfig,
  conversions = false,
): Record<string, string> {
  const counts = requestedConversionMetrics(config, accountId, conversions);
  const metrics = [
    "campaign_name",
    "objective_type",
    ...counts,
    ...counts.flatMap((m) => (CONVERSION_METRICS[m]?.value ? [CONVERSION_METRICS[m]!.value!] : [])),
    ...(!conversions
      ? [
          "spend",
          "impressions",
          "clicks",
          "video_play_actions",
          "video_views_p25",
          "video_views_p50",
          "video_views_p75",
          "video_views_p100",
          ...(query.granularity === "daily" ? ["reach", "frequency"] : []),
        ]
      : []),
  ];
  const filters = [
    { field_name: "campaign_status", filter_type: "IN", filter_value: JSON.stringify(["STATUS_ALL"]) },
    ...(query.campaign_id
      ? [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([tiktokId(query.campaign_id)]) }]
      : []),
  ];
  return {
    advertiser_id: tiktokId(accountId),
    service_type: "AUCTION",
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: JSON.stringify(["campaign_id", query.granularity === "daily" ? "stat_time_day" : "stat_time_hour"]),
    metrics: JSON.stringify([...new Set(metrics)]),
    filtering: JSON.stringify(filters),
    start_date: query.date_from,
    end_date: query.date_to,
    query_lifetime: "false",
    query_mode: "REGULAR",
  };
}
