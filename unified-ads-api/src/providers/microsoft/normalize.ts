import type {
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
  CampaignStatus,
} from "../../types/normalized.js";
import { derivedMetrics } from "../../normalization/metrics.js";
import { ApiError } from "../../utils/errors.js";
import type { MicrosoftConfig } from "./config.js";
import { vendorId } from "./accounts.js";
import type { ReportRow } from "./reports.js";

export function campaignStatus(status: unknown): CampaignStatus {
  if (status === "Active") return "active";
  if (["Paused", "BudgetPaused", "BudgetAndManualPaused", "Suspended"].includes(String(status))) return "paused";
  if (status === "Deleted") return "removed";
  return "unknown";
}
export function normalizeCampaign(row: Record<string, unknown>, account: NormalizedAccount): NormalizedCampaign {
  if (typeof row.Name !== "string" || !row.Name)
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una campaña sin nombre.");
  return {
    platform: "microsoft",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: vendorId(row.Id),
    campaign_name: row.Name,
    campaign_status: campaignStatus(row.Status),
    source_status: typeof row.Status === "string" ? row.Status : null,
    objective: typeof row.MarketingObjective === "string" ? row.MarketingObjective : null,
  };
}
function metric(value: string | undefined): number | null {
  if (value === undefined || ["", "--", "N/A"].includes(value.trim())) return null;
  const s = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una métrica numérica inválida.");
  const n = Number(s.replaceAll(",", ""));
  if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER)
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una métrica fuera de rango.");
  return n;
}
export function reportBucket(row: ReportRow, account: NormalizedAccount, query: PerformanceQuery) {
  if (vendorId(row.AccountId) !== account.account_id)
    throw new ApiError("PROVIDER_ERROR", "El informe de Microsoft contiene otra cuenta.");
  const campaignId = vendorId(row.CampaignId);
  if (query.campaign_id && campaignId !== query.campaign_id)
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió otra campaña.");
  const match = /^(\d{4}-\d{2}-\d{2})(?:\|(\d{1,2}))?$/.exec(row.TimePeriod ?? "");
  if (!match) throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió un periodo incompatible con formato 2.0.");
  const date = match[1]!,
    hour = match[2] === undefined ? null : Number(match[2]);
  if (
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date < query.date_from ||
    date > query.date_to ||
    (hour !== null && hour > 23) ||
    (query.granularity === "hourly" ? hour === null : hour !== null)
  )
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió fechas u horas fuera del periodo solicitado.");
  return { campaignId, date, hour };
}
export function normalizePerformance(
  row: ReportRow,
  account: NormalizedAccount,
  query: PerformanceQuery,
  at: string,
): NormalizedPerformance {
  const { campaignId, date, hour } = reportBucket(row, account, query);
  const spend = metric(row.Spend),
    impressions = metric(row.Impressions),
    clicks = metric(row.Clicks),
    conversions = metric(row.ConversionsQualified);
  const currency = row.CurrencyCode?.trim() || account.currency;
  if (account.currency && currency !== account.currency)
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una moneda distinta a la cuenta.");
  return {
    platform: "microsoft",
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    campaign_id: campaignId,
    campaign_name: row.CampaignName || null,
    campaign_status: row.CampaignStatus ? campaignStatus(row.CampaignStatus) : null,
    objective: null,
    date,
    hour,
    currency,
    spend,
    impressions,
    clicks,
    conversions,
    conversion_value: metric(row.Revenue),
    ...derivedMetrics({ spend, impressions, clicks, conversions }),
    reach: null,
    frequency: null,
    link_clicks: null,
    video_views: null,
    video_25: null,
    video_50: null,
    video_75: null,
    video_100: null,
    source_timezone: "UTC",
    extracted_at: at,
    raw_metrics: { ...row },
  };
}
export function normalizeConversion(
  row: ReportRow,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: MicrosoftConfig,
  at: string,
): NormalizedConversion {
  const { campaignId, date, hour } = reportBucket(row, account, query),
    id = vendorId(row.GoalId);
  if (!row.Goal?.trim())
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una conversión sin nombre de objetivo.");
  return {
    platform: "microsoft",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: campaignId,
    date,
    hour,
    source_conversion: row.Goal,
    normalized_conversion: config.conversionMapping[id] ?? config.conversionMapping[row.Goal] ?? null,
    conversions: metric(row.ConversionsQualified),
    conversion_value: metric(row.Revenue),
    extracted_at: at,
    raw_metrics: {
      ...row,
      AllConversionsQualified: metric(row.AllConversionsQualified),
      AllRevenue: metric(row.AllRevenue),
      source_timezone: "UTC",
      currency: account.currency,
    },
  };
}
