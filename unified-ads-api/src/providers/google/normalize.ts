import type {
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
} from "../../types/normalized.js";
import { derivedMetrics, microsToCurrency } from "../../normalization/metrics.js";
import type { ConversionCategory } from "../../normalization/conversions.js";
import { ApiError } from "../../utils/errors.js";
import type { GoogleConfig } from "./config.js";
import { campaignStatus } from "./queries.js";
import { googleNumber, type GoogleRow } from "./types.js";

/** Only scalars selected by our fixed GAQL queries may receive their protobuf zero default. */
function selectedMetrics(row: GoogleRow) {
  if (!row.metrics || typeof row.metrics !== "object" || Array.isArray(row.metrics))
    throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una fila sin el objeto de métricas solicitado.");
  return row.metrics;
}
const selectedNumber = (metrics: Record<string, unknown>, field: string) =>
  Object.hasOwn(metrics, field) ? googleNumber(metrics[field]) : 0;

export function normalizeCampaign(row: GoogleRow, account: NormalizedAccount): NormalizedCampaign {
  if (!row.campaign?.id) throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una campaña sin identificador.");
  return {
    platform: "google",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: row.campaign.id,
    campaign_name: row.campaign.name ?? row.campaign.id,
    campaign_status: campaignStatus(row.campaign.status),
    source_status: row.campaign.status ?? null,
    // El canal (SEARCH, DISPLAY, etc.) no equivale al objetivo comercial de la campaña.
    objective: null,
  };
}

function dateAndHour(row: GoogleRow, query: PerformanceQuery): { date: string; hour: number | null } {
  const date = row.segments?.date;
  const hour = row.segments?.hour;
  if (!date || date < query.date_from || date > query.date_to || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una fecha inválida o fuera del rango.");
  if (query.granularity === "hourly" && (!Number.isInteger(hour) || hour! < 0 || hour! > 23))
    throw new ApiError("PROVIDER_ERROR", "Google Ads no devolvió una hora válida.");
  return { date, hour: query.granularity === "hourly" ? hour! : null };
}

export function normalizePerformance(
  row: GoogleRow,
  account: NormalizedAccount,
  query: PerformanceQuery,
  at: string,
): NormalizedPerformance {
  const campaign = normalizeCampaign(row, account);
  const m = selectedMetrics(row);
  const base = {
    spend: microsToCurrency(selectedNumber(m, "costMicros")),
    impressions: selectedNumber(m, "impressions"),
    clicks: selectedNumber(m, "clicks"),
    conversions: selectedNumber(m, "conversions"),
  };
  return {
    ...campaign,
    ...dateAndHour(row, query),
    account_name: row.customer?.descriptiveName ?? account.account_name,
    currency: row.customer?.currencyCode ?? account.currency,
    ...base,
    ...derivedMetrics(base),
    conversion_value: selectedNumber(m, "conversionsValue"),
    reach: null,
    frequency: null,
    link_clicks: null,
    video_views: selectedNumber(m, "videoTrueviewViews"),
    // Google reporta tasas por cuartil, no sus conteos: conserva las tasas sin inventar conteos.
    video_25: null,
    video_50: null,
    video_75: null,
    video_100: null,
    source_timezone: row.customer?.timeZone ?? account.timezone,
    extracted_at: at,
    raw_metrics: { ...m, advertising_channel_type: row.campaign?.advertisingChannelType ?? null },
  };
}

const CATEGORIES: Record<string, ConversionCategory> = {
  PURCHASE: "PURCHASE",
  SUBMIT_LEAD_FORM: "LEAD",
  QUALIFIED_LEAD: "LEAD",
  CONVERTED_LEAD: "LEAD",
  // Un registro no es un lead: misma etiqueta que TikTok (total_registration) y Spotify (SIGN_UPS).
  SIGNUP: "REGISTRATION",
  PHONE_CALL_LEAD: "CALL",
  CONTACT: "CONTACT",
  ADD_TO_CART: "ADD_TO_CART",
  BEGIN_CHECKOUT: "BEGIN_CHECKOUT",
  PAGE_VIEW: "PAGE_VIEW",
};

export function normalizeConversion(
  row: GoogleRow,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: GoogleConfig,
  at: string,
): NormalizedConversion {
  const s = row.segments;
  if (!s?.conversionAction) throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una conversión sin acción.");
  const m = selectedMetrics(row);
  const mapping = config.conversionMapping;
  const lookup = (key: string) => (Object.hasOwn(mapping, key) ? mapping[key] : undefined);
  const id = s.conversionAction.split("/").pop()!;
  return {
    platform: "google",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: row.campaign?.id ?? null,
    ...dateAndHour(row, query),
    source_conversion: s.conversionActionName ?? s.conversionAction,
    normalized_conversion:
      lookup(s.conversionAction) ??
      lookup(id) ??
      lookup(s.conversionActionName ?? "") ??
      lookup(s.conversionActionCategory ?? "") ??
      (Object.hasOwn(CATEGORIES, s.conversionActionCategory ?? "") ? CATEGORIES[s.conversionActionCategory!] : null) ??
      null,
    conversions: selectedNumber(m, "conversions"),
    conversion_value: selectedNumber(m, "conversionsValue"),
    extracted_at: at,
    raw_metrics: {
      ...m,
      conversion_action: s.conversionAction,
      conversion_action_category: s.conversionActionCategory ?? null,
    },
  };
}
