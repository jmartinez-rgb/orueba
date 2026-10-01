import type { ProviderSlug } from "./providers.js";

/**
 * Modelo normalizado: todas las plataformas responden con estas formas. Las métricas que una
 * plataforma no reporta van en null (nunca 0 inventado) y lo original se conserva en raw_metrics.
 */

export type Granularity = "daily" | "hourly";

/** Estado de conexión de un proveedor. */
export type ProviderState =
  "connected" | "degraded" | "not_configured" | "not_implemented" | "access_required" | "permission_denied" | "error";

export interface ProviderStatus {
  provider: ProviderSlug;
  name: string;
  state: ProviderState;
  /** Tiene credenciales configuradas. */
  configured: boolean;
  /** La integración ya está programada (las fases se construyen una por una). */
  implemented: boolean;
  /** Variables de configuración que faltan (solo nombres, nunca valores). */
  missing_config: string[];
  last_successful_sync: string | null;
  last_error: { code: string; message: string; at: string } | null;
  latency_ms: number | null;
  checked_at: string;
}

export type CampaignStatus = "active" | "paused" | "removed" | "unknown";

export interface NormalizedAccount {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  account_name: string;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  manager_account_id: string | null;
  /** Google distingue cuentas MCC de cuentas publicitarias. */
  is_manager?: boolean;
}

export interface NormalizedCampaign {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: CampaignStatus;
  /** Estado tal como lo reporta la plataforma. */
  source_status: string | null;
  objective: string | null;
}

/**
 * Presupuesto vigente de una campaña o de un conjunto de anuncios activo, en la moneda de la cuenta.
 * Es configuración actual de la plataforma (no gasto): sirve para comparar el gasto del día contra
 * lo que la plataforma tiene autorizado gastar.
 */
export interface NormalizedBudget {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  account_name: string;
  currency: string | null;
  campaign_id: string;
  campaign_name: string;
  /** Objetivo de la campaña tal como lo reporta la plataforma (Meta: OUTCOME_LEADS…). */
  objective: string | null;
  /** Dónde vive el presupuesto: en la campaña (Advantage+/CBO) o en cada conjunto (ABO). */
  budget_level: "campaign" | "ad_set";
  ad_set_id: string | null;
  ad_set_name: string | null;
  budget_type: "daily" | "lifetime";
  daily_budget: number | null;
  lifetime_budget: number | null;
  budget_remaining: number | null;
  /**
   * Solo presupuestos totales: diario estimado. Meta: restante ÷ días que faltan (incluido hoy);
   * Google/TikTok: total ÷ días del periodo. El método va en raw_metrics.estimate_method.
   */
  daily_estimate: number | null;
  /** Presupuesto compartido entre campañas (Google, Microsoft): su monto se cuenta una sola vez. */
  shared_budget_id: string | null;
  /** La plataforma reporta la campaña limitada por presupuesto (Google); null si no lo informa. */
  limited_by_budget: boolean | null;
  /** Presupuesto diario que recomienda la plataforma (Google); null si no hay recomendación. */
  recommended_daily_budget: number | null;
  start_time: string | null;
  end_time: string | null;
  extracted_at: string;
  raw_metrics: Record<string, unknown>;
}

/**
 * Señal de salud de entrega leída de la plataforma: cuenta con problemas, campaña o conjunto que no
 * entrega bien, limitado por presupuesto, puja o políticas, o en aprendizaje. Es el estado que la
 * plataforma reporta hoy; no se infiere nada del gasto.
 */
export type DeliveryKind =
  | "account_status"
  | "spend_cap"
  | "delivery_issue"
  | "policy"
  | "budget_limited"
  | "bidding_limited"
  | "paused_by_budget"
  | "learning"
  | "learning_limited"
  | "pending";

export interface NormalizedDeliverySignal {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  account_name: string;
  entity_level: "account" | "campaign" | "ad_set";
  campaign_id: string | null;
  campaign_name: string | null;
  entity_id: string;
  entity_name: string;
  kind: DeliveryKind;
  /** critical: no entrega o está por dejar de entregar; warning: entrega limitada; info: contexto. */
  severity: "critical" | "warning" | "info";
  /** Código tal como lo reporta la plataforma (p. ej. WITH_ISSUES, BUDGET_CONSTRAINED, BudgetPaused). */
  code: string | null;
  /** Resumen de la plataforma, si lo da (Meta issues_info.error_summary). */
  detail: string | null;
  currency: string | null;
  /** Tope de gasto de la cuenta y lo ya gastado contra él, en la moneda de la cuenta (Meta). */
  spend_cap: number | null;
  amount_spent: number | null;
  extracted_at: string;
}

export interface NormalizedPerformance {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  account_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_status: CampaignStatus | null;
  objective: string | null;
  /** Fecha (YYYY-MM-DD) en source_timezone: zona de cuenta o UTC según el contrato del proveedor. */
  date: string;
  /** 0-23 en granularidad por hora; null en diaria. */
  hour: number | null;
  /** Moneda original de la cuenta (no se convierte). */
  currency: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  link_clicks: number | null;
  conversions: number | null;
  conversion_value: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  video_views: number | null;
  video_25: number | null;
  video_50: number | null;
  video_75: number | null;
  video_100: number | null;
  source_timezone: string | null;
  extracted_at: string;
  raw_metrics: Record<string, unknown>;
}

/** Conversión con su acción original y la categoría normalizada (mapeo configurable). */
export interface NormalizedConversion {
  platform: ProviderSlug;
  client_id: string | null;
  account_id: string;
  campaign_id: string | null;
  date: string;
  hour: number | null;
  /** Nombre de la acción en la plataforma (p. ej. onsite_conversion.messaging_conversation_started_7d). */
  source_conversion: string;
  /** Categoría normalizada (PURCHASE, LEAD, WHATSAPP, CALL…) o null si no hay mapeo. */
  normalized_conversion: string | null;
  conversions: number | null;
  conversion_value: number | null;
  extracted_at: string;
  /** Incluye métricas de acciones secundarias cuando la plataforma las reporta. */
  raw_metrics?: Record<string, unknown>;
}

export interface DateRange {
  date_from: string;
  date_to: string;
}

export interface AccountQuery {
  client_id?: string;
}

export interface CampaignQuery extends AccountQuery {
  account_id?: string;
}

export interface PerformanceQuery extends DateRange {
  client_id?: string;
  account_id?: string;
  campaign_id?: string;
  granularity: Granularity;
}
