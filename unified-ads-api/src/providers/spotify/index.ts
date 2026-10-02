import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import { stateFromError } from "../status.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import type { RetryOptions } from "../../utils/retry.js";
import type { AccountQuery, CampaignQuery, NormalizedAccount, PerformanceQuery } from "../../types/normalized.js";
import type { ProviderRequestOptions } from "../provider.js";
import { SPOTIFY_REQUIRED, PERFORMANCE_FIELDS, CONVERSION_FIELDS, readSpotifyConfig, spotifyId } from "./config.js";
import { SpotifyClient, type SpotifyFetch } from "./client.js";
import type { RefreshTokenRotationHandler } from "../token-rotation.js";
import { discoverSpotifyAccounts, readSpotifyAccount } from "./accounts.js";
import { spotifyAccountWarning } from "./errors.js";
import { spotifyCampaigns, spotifyReport, reportRanges } from "./queries.js";
import {
  normalizeCampaign,
  normalizeConversions,
  normalizePerformance,
  reportBucket,
  reportMetrics,
  censoredConversionFields,
  unavailableRevenue,
} from "./normalize.js";

/** Read-only Spotify Ads v3. OAuth user authorization, business discovery, JSON aggregate reporting. */
export class SpotifyProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readSpotifyConfig>;
  private readonly client: SpotifyClient | null;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  private cache: { accounts: NormalizedAccount[]; warnings: ApiError[]; until: number } | null = null;
  constructor(
    env: Readonly<Record<string, string | undefined>>,
    opts: {
      fetch?: SpotifyFetch;
      timeoutMs?: number;
      retry?: Partial<RetryOptions>;
      onRefreshTokenRotated?: RefreshTokenRotationHandler;
    } = {},
  ) {
    super(Provider.SPOTIFY, SPOTIFY_REQUIRED, env);
    this.setup = readSpotifyConfig(env, opts.timeoutMs);
    this.client = this.setup.config
      ? new SpotifyClient(this.setup.config, opts.fetch, opts.retry, opts.onRefreshTokenRotated)
      : null;
  }
  /** Tiempo máximo propio de la integración; la ruta de datos lo respeta. */
  get timeoutMs(): number | undefined {
    return this.setup.config?.timeoutMs;
  }

  override missingConfig() {
    return [...this.setup.missing];
  }
  override isConfigured() {
    return this.client !== null;
  }
  private async run<T>(
    work: (client: SpotifyClient, signal: AbortSignal) => Promise<T>,
    options?: ProviderRequestOptions,
    record = true,
  ) {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "Spotify Ads no está configurado o tiene variables inválidas.", {
        details: { provider: "spotify", missing_config: this.missingConfig() },
      });
    const timeout = AbortSignal.timeout(this.client.config.timeoutMs),
      signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      signal.throwIfAborted();
      const result = await work(this.client, signal);
      if (record) this.lastSync = new Date().toISOString();
      this.lastError = null;
      return result;
    } catch (err) {
      const safe = signal.aborted
        ? new ApiError("PROVIDER_TIMEOUT", "Spotify agotó el tiempo máximo de la consulta.")
        : isApiError(err)
          ? err
          : new ApiError("PROVIDER_ERROR", "Spotify devolvió datos incompatibles.");
      this.lastError = { code: safe.code, message: safe.message, at: new Date().toISOString() };
      throw safe;
    }
  }
  override async status() {
    const base = await super.status();
    if (!this.client) return { ...base, last_successful_sync: this.lastSync, last_error: this.lastError };
    const started = Date.now();
    try {
      await this.run((client, signal) => this.select(client, signal, {}), undefined, false);
      return {
        ...base,
        state: "connected" as const,
        last_error: null,
        last_successful_sync: this.lastSync,
        latency_ms: Date.now() - started,
      };
    } catch (err) {
      return {
        ...base,
        state: stateFromError(err),
        last_error: this.lastError,
        last_successful_sync: this.lastSync,
        latency_ms: Date.now() - started,
      };
    }
  }
  private async select(
    client: SpotifyClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options?: ProviderRequestOptions,
  ) {
    if (query.account_id) {
      const account = await readSpotifyAccount(client, spotifyId(query.account_id), signal);
      return query.client_id === undefined || account.client_id === query.client_id ? [account] : [];
    }
    if (!this.cache || this.cache.until <= Date.now()) {
      const warnings: ApiError[] = [],
        accounts = await discoverSpotifyAccounts(client, signal, (e) => warnings.push(e));
      this.cache = { accounts, warnings, until: Date.now() + 300000 };
    }
    this.cache.warnings.forEach((e) => options?.onWarning?.(e));
    return this.cache.accounts.filter((a) => query.client_id === undefined || a.client_id === query.client_id);
  }
  override listAccounts(query: AccountQuery, options?: ProviderRequestOptions) {
    return this.run((client, signal) => this.select(client, signal, query, options), options);
  }
  private async eachAccount<T>(
    client: SpotifyClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options: ProviderRequestOptions | undefined,
    work: (account: NormalizedAccount) => Promise<T[]>,
  ) {
    const out: T[] = [];
    let success = 0,
      first: ApiError | null = null;
    for (const account of await this.select(client, signal, query, options)) {
      try {
        out.push(...(await work(account)));
        success++;
      } catch (err) {
        const warning = spotifyAccountWarning(err, account.account_id);
        if (query.account_id || !warning) throw err;
        first ??= warning;
        options?.onWarning?.(warning);
      }
    }
    if (!success && first) throw first;
    return out;
  }
  override listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions) {
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) =>
          (await spotifyCampaigns(client, account.account_id, signal)).map((row) => normalizeCampaign(row, account)),
        ),
      options,
    );
  }
  private async report<T>(
    query: PerformanceQuery,
    options: ProviderRequestOptions | undefined,
    conversions: boolean,
    normalize: (row: Record<string, unknown>, account: NormalizedAccount, client: SpotifyClient, at: string) => T[],
  ) {
    reportRanges(query);
    if (query.campaign_id) spotifyId(query.campaign_id);
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const primary = client.config.primaryMapping[account.account_id] ?? client.config.primaryMetric;
          const fields = conversions
            ? [...CONVERSION_FIELDS, "REVENUE"]
            : [...PERFORMANCE_FIELDS, ...(primary ? [primary] : [])];
          const data = await spotifyReport(client, account.account_id, query, fields, signal, (e) =>
            options?.onWarning?.(e),
          );
          const at = new Date().toISOString(),
            seen = new Set<string>();
          if (data.some(unavailableRevenue))
            options?.onWarning?.(
              new ApiError(
                "PROVIDER_ERROR",
                "Spotify no informó un valor de ingresos utilizable; permanece desconocido.",
                {
                  details: { provider: "spotify", account_id: account.account_id, limitation: "revenue_unavailable" },
                },
              ),
            );
          if (data.some((row) => censoredConversionFields(row).length))
            options?.onWarning?.(
              new ApiError(
                "PROVIDER_ERROR",
                "Spotify ocultó conteos pequeños por privacidad; permanecen desconocidos.",
                {
                  details: {
                    provider: "spotify",
                    account_id: account.account_id,
                    limitation: "privacy_suppressed_conversions",
                  },
                },
              ),
            );
          if (data.length && !conversions && !primary)
            options?.onWarning?.(
              new ApiError(
                "PROVIDER_ERROR",
                "El CPA de Spotify requiere elegir una métrica principal de conversión; no se suman eventos diferentes.",
                {
                  details: {
                    provider: "spotify",
                    account_id: account.account_id,
                    limitation: "primary_conversion_not_configured",
                  },
                },
              ),
            );
          if (data.some((row) => reportMetrics(row).REVENUE != null))
            options?.onWarning?.(
              new ApiError(
                "PROVIDER_ERROR",
                "Spotify entrega ingresos agregados de compras y leads; no se atribuyeron a un evento individual.",
                {
                  details: {
                    provider: "spotify",
                    account_id: account.account_id,
                    limitation: "revenue_not_split_by_event",
                  },
                },
              ),
            );
          return data.flatMap((row) => {
            const bucket = reportBucket(row, query),
              key = `${bucket.campaignId}/${bucket.date}/${bucket.hour}`;
            if (seen.has(key)) throw new ApiError("PROVIDER_ERROR", "Spotify repitió un periodo de una campaña.");
            seen.add(key);
            return normalize(row, account, client, at);
          });
        }),
      options,
    );
  }
  override getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, options, false, (row, account, client, at) => [
      normalizePerformance(row, account, query, client.config, at),
    ]);
  }
  override getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, options, true, (row, account, client, at) =>
      normalizeConversions(row, account, query, client.config, at),
    );
  }
}
