import type {
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
} from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { derivedMetrics } from "../../normalization/metrics.js";
import { metaAccountId, metaId, type MetaConfig } from "./config.js";
import { HOUR_FIELD } from "./queries.js";
import {
  metaNumber,
  metaObject,
  type MetaAccount,
  type MetaAction,
  type MetaCampaign,
  type MetaInsight,
} from "./types.js";
import { primaryForCampaign } from "./primary-action.js";

export function normalizeAccount(row: MetaAccount, config: MetaConfig): NormalizedAccount {
  const id = metaAccountId(row.account_id ?? row.id ?? "");
  return {
    platform: "meta",
    client_id: config.clientMapping[id] ?? null,
    account_id: id,
    account_name: row.name ?? id,
    currency: row.currency ?? null,
    timezone: row.timezone_name ?? null,
    status: row.account_status === undefined ? null : String(row.account_status),
    manager_account_id: row.business?.id ?? null,
    is_manager: false,
  };
}
export function normalizeCampaign(row: MetaCampaign, account: NormalizedAccount): NormalizedCampaign {
  const source = row.effective_status ?? row.status ?? null;
  return {
    platform: "meta",
    client_id: account.client_id,
    account_id: account.account_id,
    campaign_id: metaId(row.id ?? ""),
    campaign_name: row.name ?? row.id!,
    campaign_status:
      source === "ACTIVE"
        ? "active"
        : source === "PAUSED" || source === "CAMPAIGN_PAUSED"
          ? "paused"
          : source === "DELETED" || source === "ARCHIVED"
            ? "removed"
            : "unknown",
    source_status: source,
    objective: row.objective ?? null,
  };
}

function bucket(row: MetaInsight, account: NormalizedAccount, query: PerformanceQuery) {
  const date = row.date_start;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    date < query.date_from ||
    date > query.date_to ||
    row.date_stop !== date
  )
    throw new ApiError("PROVIDER_ERROR", "Meta devolvió un periodo incompatible con el desglose diario.");
  if (row.account_id !== undefined && metaAccountId(row.account_id) !== account.account_id)
    throw new ApiError("PROVIDER_ERROR", "Meta devolvió datos de otra cuenta.");
  let hour: number | null = null;
  if (query.granularity === "hourly") {
    const raw = row[HOUR_FIELD];
    const match = typeof raw === "string" ? /^(\d{2}):00:00 - \1:59:59$/.exec(raw) : null;
    if (!match || Number(match[1]) > 23)
      throw new ApiError("PROVIDER_ERROR", "Meta no devolvió una hora válida en la zona de la cuenta.");
    hour = Number(match[1]);
  }
  const campaignId = typeof row.campaign_id === "string" ? metaId(row.campaign_id) : null;
  if (!campaignId || (query.campaign_id && campaignId !== query.campaign_id))
    throw new ApiError("PROVIDER_ERROR", "Meta devolvió una campaña incompatible con la consulta.");
  return { date, hour, campaignId };
}
function actions(value: unknown): MetaAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => metaObject(v) && typeof v.action_type === "string"))
    throw new ApiError("PROVIDER_ERROR", "Meta devolvió acciones inválidas.");
  const seen = new Set<string>();
  for (const action of value as MetaAction[]) {
    if (seen.has(action.action_type!))
      throw new ApiError("PROVIDER_ERROR", "Meta repitió un tipo de acción en el mismo periodo.");
    seen.add(action.action_type!);
  }
  return value as MetaAction[];
}
function actionValue(value: unknown, type: string | undefined): number | null {
  if (!type) return null;
  return metaNumber(actions(value).find((action) => action.action_type === type)?.value);
}
const DEFAULT_CONVERSIONS: Readonly<Record<string, string>> = {
  purchase: "PURCHASE",
  omni_purchase: "PURCHASE",
  "offsite_conversion.fb_pixel_purchase": "PURCHASE",
  "onsite_conversion.purchase": "PURCHASE",
  lead: "LEAD",
  "offsite_conversion.fb_pixel_lead": "LEAD",
  "onsite_conversion.lead_grouped": "LEAD",
};
/**
 * Meta reporta la misma compra o el mismo lead bajo varios tipos que se solapan (total omnicanal,
 * alias, pixel, on-Facebook). Por omisión solo un tipo por categoría lleva la categoría: la acción
 * principal de la cuenta o, si no coincide, el total agregado. Así sumar por categoría no duplica.
 */
const AGGREGATE_ACTIONS: Readonly<Record<string, string>> = { PURCHASE: "omni_purchase", LEAD: "lead" };
function defaultCategory(type: string, config: MetaConfig, primary: string | undefined): string | null {
  if (Object.hasOwn(config.conversionMapping, type)) return config.conversionMapping[type]!;
  const category = Object.hasOwn(DEFAULT_CONVERSIONS, type) ? DEFAULT_CONVERSIONS[type]! : null;
  if (!category) return null;
  if (type === primary) return category;
  const primaryCategory = primary
    ? Object.hasOwn(config.conversionMapping, primary)
      ? config.conversionMapping[primary]
      : DEFAULT_CONVERSIONS[primary]
    : undefined;
  return AGGREGATE_ACTIONS[category] === type && primaryCategory !== category ? category : null;
}
function isConversionAction(type: string, config: MetaConfig, primary: string | undefined): boolean {
  if (Object.hasOwn(config.conversionMapping, type) || type === primary) return true;
  // Meta etiqueta reacciones, guardados y bloqueos como onsite_conversion: no son resultados de negocio.
  if (type.startsWith("onsite_conversion.post_") || type === "onsite_conversion.messaging_block") return false;
  return (
    Object.hasOwn(DEFAULT_CONVERSIONS, type) || type.includes("conversion.") || type.startsWith("app_custom_event.")
  );
}
export function isHourlyActionSupported(type: string): boolean {
  // Los alias purchase/lead pueden mezclar eventos internos y externos: no representan una hora fiable.
  return (
    type.startsWith("onsite_conversion.") ||
    [
      "link_click",
      "post_engagement",
      "page_engagement",
      "video_view",
      "comment",
      "like",
      "post_reaction",
      "post",
    ].includes(type)
  );
}

export function normalizePerformance(
  row: MetaInsight,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: MetaConfig,
  at: string,
  campaign?: NormalizedCampaign,
): NormalizedPerformance {
  const { date, hour, campaignId } = bucket(row, account, query);
  const selection = primaryForCampaign(
    config,
    account.account_id,
    campaignId,
    row.campaign_name ?? campaign?.campaign_name,
  );
  const primary = selection.action;
  // Las conversiones externas no están soportadas con el breakdown horario.
  const supported = primary && (hour === null || isHourlyActionSupported(primary));
  // Meta solo lista las acciones que ocurrieron: si se pidió y no aparece, ese día fueron 0.
  const present = supported ? actions(row.actions).some((a) => a.action_type === primary) : false;
  const conversions = supported ? (actionValue(row.actions, primary) ?? (present ? null : 0)) : null;
  const conversionValue = supported ? (actionValue(row.action_values, primary) ?? (present ? null : 0)) : null;
  const spend = metaNumber(row.spend),
    impressions = metaNumber(row.impressions),
    clicks = metaNumber(row.clicks);
  return {
    platform: "meta",
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: row.account_name ?? account.account_name,
    campaign_id: campaignId,
    campaign_name: row.campaign_name ?? campaign?.campaign_name ?? null,
    campaign_status: campaign?.campaign_status ?? null,
    objective: campaign?.objective ?? null,
    date,
    hour,
    currency: row.account_currency ?? account.currency,
    spend,
    impressions,
    clicks,
    link_clicks: metaNumber(row.inline_link_clicks),
    reach: hour === null ? metaNumber(row.reach) : null,
    frequency: hour === null ? metaNumber(row.frequency) : null,
    conversions,
    conversion_value: conversionValue,
    ...derivedMetrics({ spend, impressions, clicks, conversions }),
    video_views: actionValue(row.video_play_actions, "video_view"),
    video_25: actionValue(row.video_p25_watched_actions, "video_view"),
    video_50: actionValue(row.video_p50_watched_actions, "video_view"),
    video_75: actionValue(row.video_p75_watched_actions, "video_view"),
    video_100: actionValue(row.video_p100_watched_actions, "video_view"),
    source_timezone: account.timezone,
    extracted_at: at,
    raw_metrics: {
      ...row,
      primary_conversion_action: primary ?? null,
      primary_conversion_scope: selection.scope,
      // false con una acción principal configurada: 0 real del día o una acción mal elegida para la cuenta.
      ...(supported ? { primary_action_present: present } : {}),
      action_report_time: "impression",
      use_unified_attribution_setting: true,
      ...(hour === null ? {} : { unsupported_metrics: ["reach", "frequency", "offsite_conversions"] }),
    },
  };
}
export function normalizeConversions(
  row: MetaInsight,
  account: NormalizedAccount,
  query: PerformanceQuery,
  config: MetaConfig,
  at: string,
): NormalizedConversion[] {
  const { date, hour, campaignId } = bucket(row, account, query);
  const counts = actions(row.actions),
    values = actions(row.action_values);
  const all = new Map([...counts, ...values].map((a) => [a.action_type!, a]));
  const selection = primaryForCampaign(config, account.account_id, campaignId, row.campaign_name);
  const primary = selection.action;
  return [...all.keys()]
    .filter((type) => isConversionAction(type, config, primary) && (hour === null || isHourlyActionSupported(type)))
    .map((type) => ({
      platform: "meta",
      client_id: account.client_id,
      account_id: account.account_id,
      campaign_id: campaignId,
      date,
      hour,
      source_conversion: type,
      normalized_conversion: selection.scope === "unmatched_rule" ? null : defaultCategory(type, config, primary),
      conversions: metaNumber(counts.find((a) => a.action_type === type)?.value),
      conversion_value: metaNumber(values.find((a) => a.action_type === type)?.value),
      extracted_at: at,
      raw_metrics: {
        action: counts.find((a) => a.action_type === type) ?? null,
        action_value: values.find((a) => a.action_type === type) ?? null,
        currency: row.account_currency ?? account.currency,
        source_timezone: account.timezone,
        action_report_time: "impression",
        use_unified_attribution_setting: true,
        is_primary: type === primary,
        primary_conversion_action: primary ?? null,
        primary_conversion_scope: selection.scope,
        overlapping_action_types: true,
        // Categoría de referencia aunque no se asigne para no duplicar la suma por categoría.
        category_hint: Object.hasOwn(DEFAULT_CONVERSIONS, type) ? DEFAULT_CONVERSIONS[type] : null,
      },
    }));
}
