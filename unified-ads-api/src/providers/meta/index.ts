import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import { stateFromError } from "../status.js";
import type { ProviderRequestOptions } from "../provider.js";
import type { RetryOptions } from "../../utils/retry.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import type {
  AccountQuery,
  CampaignQuery,
  PerformanceQuery,
  NormalizedAccount,
  NormalizedCampaign,
} from "../../types/normalized.js";
import { readMetaConfig, metaAccountId } from "./config.js";
import { MetaClient } from "./client.js";
import { readMetaAccount, discoverMetaAccounts } from "./accounts.js";
import { CAMPAIGN_FIELDS, HOUR_FIELD, insightsParams, insightsWindows } from "./queries.js";
import { normalizeCampaign, normalizePerformance, normalizeConversions } from "./normalize.js";
import { metaAccountWarning } from "./errors.js";
import { metaObject, type MetaFetch, type MetaCampaign, type MetaInsight } from "./types.js";

/** Integración Meta Marketing API de lectura; no modifica anuncios ni campañas. */
export class MetaProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readMetaConfig>;
  private readonly client: MetaClient | null;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  private cache: { value: NormalizedAccount[]; until: number; warnings: ApiError[] } | null = null;
  constructor(
    env: Readonly<Record<string, string | undefined>>,
    opts: { fetch?: MetaFetch; timeoutMs?: number; retry?: Partial<RetryOptions> } = {},
  ) {
    super(Provider.META, ["META_ACCESS_TOKEN"], env);
    this.setup = readMetaConfig(env, opts.timeoutMs);
    this.client = this.setup.config ? new MetaClient(this.setup.config, opts.fetch, opts.retry) : null;
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
    work: (client: MetaClient, signal: AbortSignal) => Promise<T>,
    options?: ProviderRequestOptions,
    record = true,
  ): Promise<T> {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "Meta no está configurado o tiene variables inválidas.", {
        details: { provider: "meta", missing_config: this.missingConfig() },
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
        ? new ApiError("PROVIDER_TIMEOUT", "La consulta a Meta agotó su tiempo máximo.")
        : isApiError(err)
          ? err
          : new ApiError("PROVIDER_ERROR", "Meta devolvió datos incompatibles.");
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
          const first = client.config.accountIds[0];
          if (first) await readMetaAccount(client, first, signal);
          else {
            const path = client.config.businessIds[0]
              ? `${client.config.businessIds[0]}/owned_ad_accounts`
              : "me/adaccounts";
            const response = await client.get<Record<string, unknown>>(path, { fields: "id", limit: "1" }, signal);
            if (!Array.isArray(response.data) || !response.data.every(metaObject))
              throw new ApiError("PROVIDER_ERROR", "Meta no devolvió la lista de cuentas esperada.");
          }
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
    client: MetaClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options?: ProviderRequestOptions,
  ): Promise<NormalizedAccount[]> {
    if (query.account_id) {
      const account = await readMetaAccount(client, metaAccountId(query.account_id), signal);
      return query.client_id === undefined || account.client_id === query.client_id ? [account] : [];
    }
    if (!this.cache || this.cache.until <= Date.now()) {
      const warnings: ApiError[] = [];
      const value = await discoverMetaAccounts(client, signal, (warning) => warnings.push(warning));
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
    client: MetaClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options: ProviderRequestOptions | undefined,
    work: (account: NormalizedAccount) => Promise<T[]>,
  ): Promise<T[]> {
    const output: T[] = [];
    let success = 0;
    let first: ApiError | null = null;
    for (const account of await this.select(client, signal, query, options)) {
      try {
        output.push(...(await work(account)));
        success++;
      } catch (err) {
        const warning = metaAccountWarning(err, account.account_id);
        if (query.account_id || !warning) throw err;
        first ??= warning;
        options?.onWarning?.(warning);
      }
    }
    if (!success && first) throw first;
    return output;
  }
  private async campaigns(
    client: MetaClient,
    account: NormalizedAccount,
    signal: AbortSignal,
  ): Promise<NormalizedCampaign[]> {
    const rows = await client.list<MetaCampaign>(
      `act_${account.account_id}/campaigns`,
      { fields: CAMPAIGN_FIELDS },
      signal,
    );
    return rows.map((row) => normalizeCampaign(row, account));
  }
  override listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions) {
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, (account) => this.campaigns(client, account, signal)),
      options,
    );
  }
  private hourlyWarning(query: PerformanceQuery, options?: ProviderRequestOptions) {
    if (query.granularity === "hourly")
      options?.onWarning?.(
        new ApiError(
          "PROVIDER_ERROR",
          "Meta no ofrece alcance/frecuencia ni todas las conversiones externas por hora. Usa granularidad diaria para esas métricas.",
          {
            details: {
              provider: "meta",
              limitation: "hourly_breakdown",
              partial_data: true,
              unsupported_metrics: ["reach", "frequency", "offsite_conversions"],
            },
          },
        ),
      );
  }
  override async getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    insightsParams(query);
    return this.run(async (client, signal) => {
      this.hourlyWarning(query, options);
      const at = new Date().toISOString();
      return this.eachAccount(client, signal, query, options, async (account) => {
        const [rows, campaigns] = await Promise.all([
          this.insights(client, account, query, false, signal),
          this.campaigns(client, account, signal),
        ]);
        const byId = new Map(campaigns.map((c) => [c.campaign_id, c]));
        return rows.map((row) =>
          normalizePerformance(row, account, query, client.config, at, byId.get(row.campaign_id ?? "")),
        );
      });
    }, options);
  }
  override async getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    insightsParams(query, true);
    return this.run(async (client, signal) => {
      this.hourlyWarning(query, options);
      const at = new Date().toISOString();
      return this.eachAccount(client, signal, query, options, async (account) => {
        const rows = await this.insights(client, account, query, true, signal);
        return rows.flatMap((row) => normalizeConversions(row, account, query, client.config, at));
      });
    }, options);
  }
  private async insights(
    client: MetaClient,
    account: NormalizedAccount,
    query: PerformanceQuery,
    conversions: boolean,
    signal: AbortSignal,
  ) {
    const output: MetaInsight[] = [],
      seen = new Set<string>();
    for (const window of insightsWindows(query)) {
      const rows = await client.list<MetaInsight>(
        `act_${account.account_id}/insights`,
        insightsParams(window, conversions),
        signal,
      );
      for (const row of rows) {
        if (typeof row.date_start !== "string" || row.date_start < window.date_from || row.date_start > window.date_to)
          throw new ApiError("PROVIDER_ERROR", "Meta devolvió un periodo fuera del bloque solicitado.");
        const key = `${row.campaign_id}/${row.date_start}/${row[HOUR_FIELD] ?? "daily"}`;
        if (seen.has(key)) throw new ApiError("PROVIDER_ERROR", "Meta repitió un periodo de campaña en el informe.");
        seen.add(key);
        output.push(row);
        if (output.length > 200000) throw new ApiError("PROVIDER_ERROR", "Meta superó el tamaño admitido del informe.");
      }
    }
    return output;
  }
}
