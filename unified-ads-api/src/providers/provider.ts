import type { Provider, ProviderSlug } from "../types/providers.js";
import type { ApiError } from "../utils/errors.js";
import type {
  AccountQuery,
  CampaignQuery,
  NormalizedAccount,
  NormalizedBudget,
  NormalizedCampaign,
  NormalizedDeliverySignal,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
  ProviderStatus,
} from "../types/normalized.js";

/**
 * Contrato común de cada plataforma. Cada integración traduce su API a este modelo; el resto de la
 * API (rutas, monitoreo, BigQuery, n8n) nunca conoce los detalles de cada plataforma.
 */
export interface AdsProvider {
  readonly id: Provider;
  readonly slug: ProviderSlug;
  readonly name: string;
  /** Variables de configuración que la integración necesita (nombres, sin valores). */
  readonly requiredConfig: readonly string[];
  /** La integración ya está programada. */
  readonly implemented: boolean;
  /**
   * Tiempo máximo propio de la integración (ms, variable <PROVEEDOR>_TIMEOUT_MS). La ruta de datos
   * lo respeta aunque sea mayor que PROVIDER_TIMEOUT_MS: Microsoft genera informes asíncronos.
   */
  readonly timeoutMs?: number;
  isConfigured(): boolean;
  status(): Promise<ProviderStatus>;
  listAccounts(query: AccountQuery, options?: ProviderRequestOptions): Promise<NormalizedAccount[]>;
  listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions): Promise<NormalizedCampaign[]>;
  getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions): Promise<NormalizedPerformance[]>;
  getConversions(query: PerformanceQuery, options?: ProviderRequestOptions): Promise<NormalizedConversion[]>;
  /** Presupuestos vigentes de campañas y conjuntos activos. Solo las plataformas que lo exponen. */
  listBudgets?(query: CampaignQuery, options?: ProviderRequestOptions): Promise<NormalizedBudget[]>;
  /** Salud de entrega que reporta la plataforma (cuentas, campañas, conjuntos). */
  listDeliverySignals?(query: CampaignQuery, options?: ProviderRequestOptions): Promise<NormalizedDeliverySignal[]>;
}

export interface ProviderRequestOptions {
  /** Cancelación del caller: evita continuar consultas después del límite de la API. */
  signal?: AbortSignal;
  /** Fallos de cuentas individuales cuando el proveedor conserva los demás datos. */
  onWarning?: (error: ApiError) => void;
}
