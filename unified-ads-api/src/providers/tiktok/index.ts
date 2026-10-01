import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import { stateFromError } from "../status.js";
import type { ProviderRequestOptions } from "../provider.js";
import type { RetryOptions } from "../../utils/retry.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import type { AccountQuery, CampaignQuery, PerformanceQuery, NormalizedAccount } from "../../types/normalized.js";
import { readTikTokConfig, tiktokId } from "./config.js";
import { TikTokClient } from "./client.js";
import { authorizedAdvertisers, readTikTokAccount, discoverTikTokAccounts } from "./accounts.js";
import { CAMPAIGN_FIELDS, reportWindows, reportParams } from "./queries.js";
import { normalizeCampaign, normalizePerformance, normalizeConversions, reportBucket } from "./normalize.js";
import { tiktokAccountWarning } from "./errors.js";
import type { TikTokFetch, TikTokCampaign, TikTokReport } from "./types.js";

/** Integración de lectura TikTok API for Business v1.3. */
export class TikTokProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readTikTokConfig>;
  private readonly client: TikTokClient | null;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  private cache: { value: NormalizedAccount[]; until: number; warnings: ApiError[] } | null = null;
  constructor(
    env: Readonly<Record<string, string | undefined>>,
    opts: { fetch?: TikTokFetch; timeoutMs?: number; retry?: Partial<RetryOptions> } = {},
  ) {
    super(Provider.TIKTOK, ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET", "TIKTOK_ACCESS_TOKEN"], env);
    this.setup = readTikTokConfig(env, opts.timeoutMs);
    this.client = this.setup.config ? new TikTokClient(this.setup.config, opts.fetch, opts.retry) : null;
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
    work: (client: TikTokClient, signal: AbortSignal) => Promise<T>,
    options?: ProviderRequestOptions,
    record = true,
  ): Promise<T> {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "TikTok no está configurado o tiene variables inválidas.", {
        details: { provider: "tiktok", missing_config: this.missingConfig() },
      });
    const timeout = AbortSignal.timeout(this.client.config.timeoutMs);
    const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      signal.throwIfAborted();
      const result = await work(this.client, signal);
      if (record) this.lastSync = new Date().toISOString();
      this.lastError = null;
      return result;
    } catch (err) {
      const safe = signal.aborted
        ? new ApiError("PROVIDER_TIMEOUT", "La consulta a TikTok agotó su tiempo máximo.")
        : isApiError(err)
          ? err
          : new ApiError("PROVIDER_ERROR", "TikTok devolvió datos incompatibles.");
      this.lastError = { code: safe.code, message: safe.message, at: new Date().toISOString() };
      throw safe;
    }
  }
  override async status() {
    const base = await super.status();
    if (!this.client) return { ...base, last_successful_sync: this.lastSync, last_error: this.lastError };
    const started = Date.now();
    try {
      await this.run(
        async (client, signal) => {
          const first = (await authorizedAdvertisers(client, signal))[0];
          if (first) await readTikTokAccount(client, first, signal);
        },
        undefined,
        false,
      );
      return {
        ...base,
        state: "connected" as const,
        last_successful_sync: this.lastSync,
        last_error: null,
        latency_ms: Date.now() - started,
      };
    } catch (err) {
      const state = stateFromError(err);
      return {
        ...base,
        state,
        last_successful_sync: this.lastSync,
        last_error: this.lastError,
        latency_ms: Date.now() - started,
      };
    }
  }
  private async select(
    client: TikTokClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options?: ProviderRequestOptions,
  ): Promise<NormalizedAccount[]> {
    if (query.account_id) {
      const account = await readTikTokAccount(client, tiktokId(query.account_id), signal);
      return query.client_id === undefined || account.client_id === query.client_id ? [account] : [];
    }
    if (!this.cache || this.cache.until <= Date.now()) {
      const warnings: ApiError[] = [];
      const value = await discoverTikTokAccounts(client, signal, (warning) => warnings.push(warning));
      this.cache = { value, warnings, until: Date.now() + 300000 };
    }
    this.cache.warnings.forEach((warning) => options?.onWarning?.(warning));
    return this.cache.value.filter((a) => query.client_id === undefined || query.client_id === a.client_id);
  }
  override listAccounts(query: AccountQuery, options?: ProviderRequestOptions) {
    return this.run(
      async (client, signal) => (await this.select(client, signal, query, options)).map((a) => ({ ...a })),
      options,
    );
  }
  private async eachAccount<T>(
    client: TikTokClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options: ProviderRequestOptions | undefined,
    work: (a: NormalizedAccount) => Promise<T[]>,
  ): Promise<T[]> {
    const output: T[] = [];
    let success = 0,
      first: ApiError | null = null;
    for (const account of await this.select(client, signal, query, options)) {
      try {
        output.push(...(await work(account)));
        success++;
      } catch (err) {
        const warning = tiktokAccountWarning(err, account.account_id);
        if (query.account_id || !warning) throw err;
        first ??= warning;
        options?.onWarning?.(warning);
      }
    }
    if (!success && first) throw first;
    return output;
  }
  override listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions) {
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const rows = await client.list<TikTokCampaign>(
            "campaign/get/",
            {
              advertiser_id: account.account_id,
              fields: JSON.stringify(CAMPAIGN_FIELDS),
              filtering: JSON.stringify({ primary_status: "STATUS_ALL" }),
            },
            signal,
          );
          const seen = new Set<string>();
          return rows.map((row) => {
            const campaign = normalizeCampaign(row, account);
            if (seen.has(campaign.campaign_id))
              throw new ApiError("PROVIDER_ERROR", "TikTok repitió una campaña durante la paginación.");
            seen.add(campaign.campaign_id);
            return campaign;
          });
        }),
      options,
    );
  }
  private async report<T>(
    query: PerformanceQuery,
    conversions: boolean,
    options: ProviderRequestOptions | undefined,
    normalize: (row: TikTokReport, account: NormalizedAccount, client: TikTokClient, at: string) => T[],
  ): Promise<T[]> {
    const windows = reportWindows(query);
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const output: T[] = [],
            seen = new Set<string>(),
            at = new Date().toISOString();
          for (const window of windows) {
            const scoped = { ...query, ...window };
            const rows = await client.list<TikTokReport>(
              "report/integrated/get/",
              reportParams(scoped, account.account_id, client.config, conversions),
              signal,
              options?.onWarning,
            );
            for (const row of rows) {
              // Valida periodos respecto al bloque solicitado antes de deduplicar.
              const verified = reportBucket(row, account, scoped);
              const key = `${verified.campaignId}/${verified.date}/${verified.hour}`;
              if (seen.has(key))
                throw new ApiError("PROVIDER_ERROR", "TikTok repitió un periodo de campaña durante la paginación.");
              seen.add(key);
              output.push(...normalize(row, account, client, at));
            }
          }
          return output;
        }),
      options,
    );
  }
  override getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, false, options, (row, account, client, at) => [
      normalizePerformance(row, account, query, client.config, at),
    ]);
  }
  override getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, true, options, (row, account, client, at) =>
      normalizeConversions(row, account, query, client.config, at),
    );
  }
}
