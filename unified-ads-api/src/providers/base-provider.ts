import { ApiError } from "../utils/errors.js";
import { PROVIDER_NAME, PROVIDER_SLUG, type Provider, type ProviderSlug } from "../types/providers.js";
import type {
  AccountQuery,
  CampaignQuery,
  NormalizedAccount,
  NormalizedCampaign,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
  ProviderStatus,
} from "../types/normalized.js";
import type { AdsProvider } from "./provider.js";

/**
 * Base de los proveedores. Mientras una integración no esté programada (las fases se construyen
 * una por una), responde con su estado real: sin configurar o pendiente de implementar, y las
 * consultas de datos contestan NOT_CONFIGURED sin tumbar el resto de la API.
 */
export abstract class BaseProvider implements AdsProvider {
  readonly slug: ProviderSlug;
  readonly name: string;
  readonly implemented: boolean = false;

  constructor(
    readonly id: Provider,
    readonly requiredConfig: readonly string[],
    protected readonly env: Readonly<Record<string, string | undefined>>,
  ) {
    this.slug = PROVIDER_SLUG[id];
    this.name = PROVIDER_NAME[id];
  }

  missingConfig(): string[] {
    return this.requiredConfig.filter((k) => !this.env[k]?.trim());
  }

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  async status(): Promise<ProviderStatus> {
    const missing = this.missingConfig();
    return {
      provider: this.slug,
      name: this.name,
      state: missing.length ? "not_configured" : this.implemented ? "connected" : "not_implemented",
      configured: missing.length === 0,
      implemented: this.implemented,
      missing_config: missing,
      last_successful_sync: null,
      last_error: null,
      latency_ms: null,
      checked_at: new Date().toISOString(),
    };
  }

  protected unavailable(): never {
    const missing = this.missingConfig();
    if (missing.length)
      throw new ApiError("NOT_CONFIGURED", `${this.name} no está configurado.`, {
        details: { provider: this.slug, missing_config: missing },
      });
    throw new ApiError("NOT_CONFIGURED", `La integración de ${this.name} todavía no está disponible.`, {
      details: { provider: this.slug, state: "not_implemented" },
    });
  }

  async listAccounts(_query: AccountQuery): Promise<NormalizedAccount[]> {
    return this.unavailable();
  }

  async listCampaigns(_query: CampaignQuery): Promise<NormalizedCampaign[]> {
    return this.unavailable();
  }

  async getPerformance(_query: PerformanceQuery): Promise<NormalizedPerformance[]> {
    return this.unavailable();
  }

  async getConversions(_query: PerformanceQuery): Promise<NormalizedConversion[]> {
    return this.unavailable();
  }
}
