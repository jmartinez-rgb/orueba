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
  NormalizedBudget,
  NormalizedDeliverySignal,
} from "../../types/normalized.js";
import { MICROSOFT_REQUIRED, microsoftId, readMicrosoftConfig } from "./config.js";
import { MicrosoftClient, type MicrosoftFetch } from "./client.js";
import { discoverMicrosoftAccounts, readMicrosoftAccount, readMicrosoftUser, rows } from "./accounts.js";
import { microsoftAccountWarning } from "./errors.js";
import { normalizeMicrosoftBudgets } from "./budgets.js";
import { normalizeMicrosoftHealth } from "./health.js";
import { microsoftReport, reportRequest, type ReportRow, type MicrosoftResolver } from "./reports.js";
import { normalizeCampaign, normalizeConversion, normalizePerformance, reportBucket } from "./normalize.js";

/** Read-only REST v13 integration. Asynchronous ZIP/CSV reports, format 2.0, UTC. */
export class MicrosoftProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readMicrosoftConfig>;
  private readonly client: MicrosoftClient | null;
  private readonly resolve?: MicrosoftResolver;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  private cache: { value: NormalizedAccount[]; warnings: ApiError[]; until: number } | null = null;
  constructor(
    env: Readonly<Record<string, string | undefined>>,
    opts: {
      fetch?: MicrosoftFetch;
      timeoutMs?: number;
      retry?: Partial<RetryOptions>;
      resolve?: MicrosoftResolver;
      onRefreshTokenRotated?: (token: string) => void;
    } = {},
  ) {
    super(Provider.MICROSOFT, MICROSOFT_REQUIRED, env);
    this.setup = readMicrosoftConfig(env, opts.timeoutMs);
    this.client = this.setup.config
      ? new MicrosoftClient(this.setup.config, opts.fetch, opts.retry, opts.onRefreshTokenRotated)
      : null;
    this.resolve = opts.resolve;
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
    work: (client: MicrosoftClient, signal: AbortSignal) => Promise<T>,
    options?: ProviderRequestOptions,
    record = true,
  ) {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "Microsoft Advertising no está configurado o tiene variables inválidas.", {
        details: { provider: "microsoft", missing_config: this.missingConfig() },
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
        ? new ApiError(
            "PROVIDER_TIMEOUT",
            "Microsoft agotó el tiempo máximo. Un informe pendiente aún no equivale a cero actividad.",
          )
        : isApiError(err)
          ? err
          : new ApiError("PROVIDER_ERROR", "Microsoft Advertising devolvió datos incompatibles.");
      this.lastError = { code: safe.code, message: safe.message, at: new Date().toISOString() };
      throw safe;
    }
  }
  override async status() {
    const base = await super.status();
    if (!this.client) return { ...base, last_successful_sync: this.lastSync, last_error: this.lastError };
    const started = Date.now();
    try {
      await this.run(readMicrosoftUser, undefined, false);
      return {
        ...base,
        state: "connected" as const,
        last_successful_sync: this.lastSync,
        last_error: null,
        latency_ms: Date.now() - started,
      };
    } catch (err) {
      return {
        ...base,
        state: stateFromError(err),
        last_successful_sync: this.lastSync,
        last_error: this.lastError,
        latency_ms: Date.now() - started,
      };
    }
  }
  private async select(
    client: MicrosoftClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options?: ProviderRequestOptions,
  ) {
    if (query.account_id) {
      const account = await readMicrosoftAccount(client, microsoftId(query.account_id), signal);
      return query.client_id === undefined || account.client_id === query.client_id ? [account] : [];
    }
    if (!this.cache || this.cache.until <= Date.now()) {
      const warnings: ApiError[] = [];
      const value = await discoverMicrosoftAccounts(client, signal, (e) => warnings.push(e));
      this.cache = { value, warnings, until: Date.now() + 300000 };
    }
    this.cache.warnings.forEach((e) => options?.onWarning?.(e));
    return this.cache.value.filter((a) => query.client_id === undefined || a.client_id === query.client_id);
  }
  override listAccounts(query: AccountQuery, options?: ProviderRequestOptions) {
    return this.run(
      async (client, signal) => (await this.select(client, signal, query, options)).map((a) => ({ ...a })),
      options,
    );
  }
  private async eachAccount<T>(
    client: MicrosoftClient,
    signal: AbortSignal,
    query: CampaignQuery,
    options: ProviderRequestOptions | undefined,
    work: (account: NormalizedAccount) => Promise<T[]>,
  ) {
    const output: T[] = [];
    let success = 0,
      first: ApiError | null = null;
    for (const account of await this.select(client, signal, query, options)) {
      try {
        output.push(...(await work(account)));
        success++;
      } catch (err) {
        const warning = microsoftAccountWarning(err, account.account_id);
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
          const data = await client.call(
            "campaigns",
            {
              AccountId: account.account_id,
              // REST flag enums use commas; the SOAP space-separated representation is rejected.
              CampaignType: "Search, Shopping, Audience, PerformanceMax, Hotel, App, ObjectiveBased",
            },
            signal,
            account,
          );
          const seen = new Set<string>();
          return rows(data.Campaigns).map((row) => {
            const campaign = normalizeCampaign(row, account);
            if (seen.has(campaign.campaign_id)) throw new ApiError("PROVIDER_ERROR", "Microsoft repitió una campaña.");
            seen.add(campaign.campaign_id);
            return campaign;
          });
        }),
      options,
    );
  }
  /** Presupuestos vigentes de campañas activas (diario o total; compartido con su ID). */
  listBudgets(query: CampaignQuery, options?: ProviderRequestOptions): Promise<NormalizedBudget[]> {
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const data = await client.call(
            "campaigns",
            {
              AccountId: account.account_id,
              CampaignType: "Search, Shopping, Audience, PerformanceMax, Hotel, App, ObjectiveBased",
            },
            signal,
            account,
          );
          return normalizeMicrosoftBudgets(account, rows(data.Campaigns), new Date().toISOString());
        }),
      options,
    );
  }
  /** Salud de entrega: campañas pausadas por presupuesto o suspendidas. */
  listDeliverySignals(query: CampaignQuery, options?: ProviderRequestOptions): Promise<NormalizedDeliverySignal[]> {
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const data = await client.call(
            "campaigns",
            {
              AccountId: account.account_id,
              CampaignType: "Search, Shopping, Audience, PerformanceMax, Hotel, App, ObjectiveBased",
            },
            signal,
            account,
          );
          return normalizeMicrosoftHealth(account, rows(data.Campaigns), new Date().toISOString());
        }),
      options,
    );
  }
  private async report<T>(
    query: PerformanceQuery,
    conversions: boolean,
    options: ProviderRequestOptions | undefined,
    normalize: (row: ReportRow, account: NormalizedAccount, client: MicrosoftClient, at: string) => T,
  ) {
    reportRequest(query, query.account_id ?? "1", conversions, false);
    return this.run(
      (client, signal) =>
        this.eachAccount(client, signal, query, options, async (account) => {
          const data = await microsoftReport(
            client,
            query,
            account,
            conversions,
            signal,
            this.resolve,
            options?.onWarning,
          );
          const at = new Date().toISOString(),
            seen = new Set<string>();
          return data.map((row) => {
            const bucket = reportBucket(row, account, query);
            const key = `${bucket.campaignId}/${bucket.date}/${bucket.hour}/${conversions ? row.GoalId : ""}`;
            if (seen.has(key)) throw new ApiError("PROVIDER_ERROR", "Microsoft repitió una fila de informe.");
            seen.add(key);
            return normalize(row, account, client, at);
          });
        }),
      options,
    );
  }
  override getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, false, options, (row, account, _client, at) =>
      normalizePerformance(row, account, query, at),
    );
  }
  override getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.report(query, true, options, (row, account, client, at) =>
      normalizeConversion(row, account, query, client.config, at),
    );
  }
}
