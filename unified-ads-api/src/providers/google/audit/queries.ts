import type { DateWindow, WindowKey } from "./types.js";

/**
 * Consultas GAQL de la auditoría (Google Ads API v25). Todas son de lectura (googleAds:search); los
 * campos se verificaron contra el documento de descubrimiento v25. Las fechas son del huso de la cuenta.
 */

/** Actualización de Google a las estrategias con objetivo (tCPA/tROAS), vigente desde esta fecha. */
export const TARGET_BIDDING_UPDATE = "2026-08-17";

const DAY = 86_400_000;
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Ventanas de análisis que terminan en `end` (último día completo). */
export function auditWindows(end: string): DateWindow[] {
  const w = (key: WindowKey, label: string, from: string, to: string): DateWindow => ({ key, label, from, to });
  const year = Number(end.slice(0, 4)),
    month = Number(end.slice(5, 7)) - 1,
    day = Number(end.slice(8, 10));
  const prevYear = month === 0 ? year - 1 : year,
    prevMonth = month === 0 ? 11 : month - 1;
  const prevLast = lastDayOfMonth(prevYear, prevMonth);
  const pm = (d: number) => `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const windows = [
    w("L7", "Últimos 7 días", shiftDate(end, -6), end),
    w("P7", "7 días anteriores", shiftDate(end, -13), shiftDate(end, -7)),
    w("L14", "Últimos 14 días", shiftDate(end, -13), end),
    w("P14", "14 días anteriores", shiftDate(end, -27), shiftDate(end, -14)),
    w("L30", "Últimos 30 días", shiftDate(end, -29), end),
    w("P30", "30 días anteriores", shiftDate(end, -59), shiftDate(end, -30)),
    w("MTD", "Mes actual", end.slice(0, 8) + "01", end),
    w("PMTD", "Mismos días del mes anterior", pm(1), pm(Math.min(day, prevLast))),
    w("PM", "Mes anterior completo", pm(1), pm(prevLast)),
    w("L90", "Últimos 90 días", shiftDate(end, -89), end),
  ];
  // 30 días previos a la actualización de pujas, si siguen dentro de un rango razonable.
  const preFrom = shiftDate(TARGET_BIDDING_UPDATE, -30),
    preTo = shiftDate(TARGET_BIDDING_UPDATE, -1);
  if (end >= TARGET_BIDDING_UPDATE && daysBetween(preFrom, end) <= 120)
    windows.push(w("PRE_BID", "30 días antes del 17 ago (cambio de pujas de Google)", preFrom, preTo));
  return windows;
}

export function windowOf(windows: DateWindow[], key: WindowKey): DateWindow | undefined {
  return windows.find((x) => x.key === key);
}

/** Primer día que necesitan las series diarias. */
export function dailyStart(windows: DateWindow[]): string {
  return windows.reduce((min, x) => (x.from < min ? x.from : min), windows[0]!.from);
}

const between = (from: string, to: string) => `segments.date BETWEEN '${from}' AND '${to}'`;

export const Q = {
  customer: () =>
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status, customer.optimization_score, customer.auto_tagging_enabled, customer.conversion_tracking_setting.conversion_tracking_status, customer.conversion_tracking_setting.accepted_customer_data_terms, customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled FROM customer",
  customerBasic: () =>
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer",
  campaigns: () =>
    [
      "SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status,",
      "campaign.primary_status_reasons, campaign.advertising_channel_type, campaign.advertising_channel_sub_type,",
      "campaign.bidding_strategy_type, campaign.bidding_strategy_system_status, campaign.bidding_strategy,",
      "campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros,",
      "campaign.target_roas.target_roas, campaign.maximize_conversion_value.target_roas, campaign.optimization_score,",
      "campaign.start_date_time, campaign.end_date_time, campaign.network_settings.target_search_network,",
      "campaign.network_settings.target_partner_search_network, campaign.network_settings.target_content_network,",
      "campaign.shopping_setting.merchant_id, campaign.asset_automation_settings,",
      "campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.total_amount_micros,",
      "campaign_budget.period, campaign_budget.explicitly_shared, campaign_budget.has_recommended_budget,",
      "campaign_budget.recommended_budget_amount_micros",
      "FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id",
    ].join(" "),
  /** Respaldo sin campos de automatización ni redes, por si la combinación no es seleccionable. */
  campaignsBasic: () =>
    [
      "SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status,",
      "campaign.primary_status_reasons, campaign.advertising_channel_type, campaign.bidding_strategy_type,",
      "campaign.bidding_strategy_system_status, campaign.target_cpa.target_cpa_micros,",
      "campaign.maximize_conversions.target_cpa_micros, campaign.target_roas.target_roas,",
      "campaign.maximize_conversion_value.target_roas, campaign.start_date_time, campaign.end_date_time,",
      "campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.total_amount_micros,",
      "campaign_budget.period, campaign_budget.explicitly_shared",
      "FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id",
    ].join(" "),
  portfolios: () =>
    "SELECT bidding_strategy.resource_name, bidding_strategy.name, bidding_strategy.type, bidding_strategy.target_cpa.target_cpa_micros, bidding_strategy.target_roas.target_roas, bidding_strategy.maximize_conversions.target_cpa_micros, bidding_strategy.maximize_conversion_value.target_roas FROM bidding_strategy",
  adGroups: () =>
    "SELECT campaign.id, ad_group.id FROM ad_group WHERE ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'",
  daily: (from: string, to: string) =>
    `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.interactions, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.phone_calls FROM campaign WHERE ${between(from, to)}`,
  dailyBasic: (from: string, to: string) =>
    `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.all_conversions FROM campaign WHERE ${between(from, to)}`,
  actionsDaily: (from: string, to: string) =>
    `SELECT campaign.id, segments.date, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.all_conversions FROM campaign WHERE ${between(from, to)}`,
  shares: (w: DateWindow) =>
    `SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, metrics.search_top_impression_share, metrics.search_absolute_top_impression_share FROM campaign WHERE ${between(w.from, w.to)} AND campaign.advertising_channel_type = 'SEARCH'`,
  conversionActions: () =>
    "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.origin, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, conversion_action.counting_type, conversion_action.click_through_lookback_window_days, conversion_action.attribution_model_settings.attribution_model, conversion_action.owner_customer FROM conversion_action WHERE conversion_action.status != 'REMOVED'",
  customerGoals: () =>
    "SELECT customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal",
  campaignGoals: () =>
    "SELECT campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal",
  goalConfigs: () =>
    "SELECT conversion_goal_campaign_config.campaign, conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config",
  searchTerms: (w: DateWindow, limit: number) =>
    `SELECT campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status, segments.search_term_match_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${between(w.from, w.to)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT ${limit}`,
  searchTermsBasic: (w: DateWindow, limit: number) =>
    `SELECT campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${between(w.from, w.to)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT ${limit}`,
  pmaxTerms: (w: DateWindow, limit: number) =>
    `SELECT campaign.id, campaign_search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros FROM campaign_search_term_view WHERE ${between(w.from, w.to)} AND metrics.impressions > 0 ORDER BY metrics.impressions DESC LIMIT ${limit}`,
  pmaxTermsBasic: (w: DateWindow, limit: number) =>
    `SELECT campaign.id, campaign_search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign_search_term_view WHERE ${between(w.from, w.to)} AND metrics.impressions > 0 ORDER BY metrics.impressions DESC LIMIT ${limit}`,
  keywords: (limit: number) =>
    [
      "SELECT campaign.id, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,",
      "ad_group_criterion.keyword.match_type, ad_group_criterion.system_serving_status, ad_group_criterion.approval_status,",
      "ad_group_criterion.quality_info.quality_score, ad_group_criterion.quality_info.creative_quality_score,",
      "ad_group_criterion.quality_info.post_click_quality_score, ad_group_criterion.quality_info.search_predicted_ctr",
      "FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE",
      "AND ad_group_criterion.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'",
      `LIMIT ${limit}`,
    ].join(" "),
  keywordMetrics: (w: DateWindow) =>
    `SELECT ad_group.id, ad_group_criterion.criterion_id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM keyword_view WHERE ${between(w.from, w.to)} AND metrics.impressions > 0`,
  ads: (limit: number) =>
    [
      "SELECT campaign.id, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad_strength,",
      "ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,",
      "ad_group_ad.policy_summary.policy_topic_entries, ad_group_ad.ad.final_urls,",
      "ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions",
      "FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'",
      `LIMIT ${limit}`,
    ].join(" "),
  adMetrics: (w: DateWindow) =>
    `SELECT ad_group.id, ad_group_ad.ad.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${between(w.from, w.to)} AND metrics.impressions > 0`,
  customerAssets: () =>
    "SELECT customer_asset.field_type, customer_asset.primary_status, asset.id, asset.type, asset.policy_summary.approval_status, asset.sitelink_asset.link_text, asset.sitelink_asset.end_date, asset.callout_asset.callout_text, asset.callout_asset.end_date, asset.promotion_asset.end_date FROM customer_asset WHERE customer_asset.status = 'ENABLED'",
  campaignAssets: () =>
    "SELECT campaign.id, campaign_asset.field_type, campaign_asset.primary_status, asset.id, asset.type, asset.policy_summary.approval_status, asset.sitelink_asset.link_text, asset.sitelink_asset.end_date, asset.callout_asset.callout_text, asset.callout_asset.end_date, asset.promotion_asset.end_date FROM campaign_asset WHERE campaign_asset.status = 'ENABLED' AND campaign.status = 'ENABLED'",
  adGroupAssets: () =>
    "SELECT campaign.id, ad_group.id, ad_group_asset.field_type, ad_group_asset.primary_status, asset.id, asset.type, asset.policy_summary.approval_status FROM ad_group_asset WHERE ad_group_asset.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED'",
  assetGroups: () =>
    "SELECT asset_group.id, asset_group.campaign, asset_group.name, asset_group.status, asset_group.primary_status, asset_group.primary_status_reasons, asset_group.ad_strength, asset_group.final_urls FROM asset_group WHERE asset_group.status != 'REMOVED' AND campaign.status = 'ENABLED'",
  assetGroupMetrics: (w: DateWindow) =>
    `SELECT asset_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM asset_group WHERE ${between(w.from, w.to)}`,
  assetGroupAssets: () =>
    "SELECT asset_group.id, asset_group_asset.field_type, asset_group_asset.source, asset_group_asset.primary_status, asset.policy_summary.approval_status FROM asset_group_asset WHERE asset_group_asset.status = 'ENABLED' AND asset_group.status != 'REMOVED'",
  signals: () =>
    "SELECT asset_group.id, asset_group_signal.search_theme.text, asset_group_signal.audience.audience FROM asset_group_signal",
  geo: (w: DateWindow) =>
    `SELECT campaign.id, segments.geo_target_region, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM user_location_view WHERE ${between(w.from, w.to)}`,
  geoNames: (names: string[]) =>
    `SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${names.map((n) => `'${n}'`).join(", ")})`,
  devices: (w: DateWindow) =>
    `SELECT campaign.id, segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${between(w.from, w.to)}`,
  networks: (w: DateWindow) =>
    `SELECT campaign.id, segments.ad_network_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${between(w.from, w.to)} AND campaign.advertising_channel_type = 'SEARCH'`,
  schedule: (w: DateWindow) =>
    `SELECT campaign.id, segments.day_of_week, segments.hour, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE ${between(w.from, w.to)}`,
  landing: (w: DateWindow) =>
    `SELECT landing_page_view.unexpanded_final_url, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.speed_score, metrics.mobile_friendly_clicks_percentage FROM landing_page_view WHERE ${between(w.from, w.to)} AND metrics.clicks > 0 ORDER BY metrics.cost_micros DESC LIMIT 300`,
  landingBasic: (w: DateWindow) =>
    `SELECT landing_page_view.unexpanded_final_url, metrics.cost_micros, metrics.clicks, metrics.conversions FROM landing_page_view WHERE ${between(w.from, w.to)} AND metrics.clicks > 0 ORDER BY metrics.cost_micros DESC LIMIT 300`,
  placements: (w: DateWindow) =>
    `SELECT campaign.id, detail_placement_view.display_name, detail_placement_view.placement, detail_placement_view.placement_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM detail_placement_view WHERE ${between(w.from, w.to)} AND metrics.cost_micros > 0 ORDER BY metrics.cost_micros DESC LIMIT 1000`,
  frequency: (w: DateWindow) =>
    `SELECT campaign.id, metrics.unique_users, metrics.average_impression_frequency_per_user FROM campaign WHERE ${between(w.from, w.to)} AND campaign.advertising_channel_type IN ('VIDEO', 'DISPLAY', 'DEMAND_GEN')`,
  /** El historial solo admite los últimos 30 días y exige LIMIT (máximo 10,000). */
  changes: (from: string, to: string, limit: number) =>
    `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.change_resource_name, change_event.resource_change_operation, change_event.changed_fields, change_event.client_type, change_event.campaign, change_event.old_resource, change_event.new_resource FROM change_event WHERE change_event.change_date_time >= '${from} 00:00:00' AND change_event.change_date_time <= '${to} 23:59:59' ORDER BY change_event.change_date_time DESC LIMIT ${limit}`,
  recommendations: () =>
    "SELECT recommendation.type, recommendation.campaign, recommendation.dismissed FROM recommendation",
};
