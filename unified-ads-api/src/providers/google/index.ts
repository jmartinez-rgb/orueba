import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import { stateFromError } from "../status.js";
import type { AccountQuery, CampaignQuery, PerformanceQuery, NormalizedAccount } from "../../types/normalized.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import { readGoogleConfig, customerId } from "./config.js";
import { GoogleAdsClient } from "./client.js";
import { discoverAccounts, readAccount } from "./accounts.js";
import { campaignsQuery, performanceQuery, conversionsQuery } from "./queries.js";
import { normalizeCampaign, normalizePerformance, normalizeConversion } from "./normalize.js";
import type { GoogleFetch, GoogleRow } from "./types.js";
import { accountWarning } from "./errors.js";
import type { RetryOptions } from "../../utils/retry.js";
import type { ProviderRequestOptions } from "../provider.js";

/** Google Ads REST de solo lectura: OAuth, MCC, GAQL y respuestas normalizadas. */
export class GoogleProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readGoogleConfig>;
  private readonly client: GoogleAdsClient | null;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  private accounts: { value: NormalizedAccount[]; until: number; warnings: ApiError[] } | null = null;

  constructor(
    env: Readonly<Record<string, string | undefined>>,
    opts: { fetch?: GoogleFetch; timeoutMs?: number; retry?: Partial<RetryOptions> } = {},
  ) {
    super(Provider.GOOGLE, ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"], env);
    this.setup = readGoogleConfig(env, opts.timeoutMs);
    this.client = this.setup.config ? new GoogleAdsClient(this.setup.config, opts.fetch, opts.retry) : null;
  }

  /** Tiempo máximo propio de la integración; la ruta de datos lo respeta. */
  get timeoutMs(): number | undefined {
    return this.setup.config?.timeoutMs;
  }

  override missingConfig(): string[] {
    return [...this.setup.missing];
  }
  override isConfigured(): boolean {
    return this.client !== null;
  }

  private async run<T>(
    work: (client: GoogleAdsClient, signal: AbortSignal) => Promise<T>,
    record = true,
    outer?: AbortSignal,
  ): Promise<T> {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "Google Ads no está configurado o tiene variables inválidas.", {
        details: { provider: "google", missing_config: this.missingConfig() },
      });
    try {
      const timeout = AbortSignal.timeout(this.client.config.timeoutMs);
      const result = await work(this.client, outer ? AbortSignal.any([outer, timeout]) : timeout);
      if (record) this.lastSync = new Date().toISOString();
      this.lastError = null;
      return result;
    } catch (err) {
      this.lastError = {
        code: isApiError(err) ? err.code : "UNKNOWN",
        message: err instanceof Error ? err.message : "Google Ads falló.",
        at: new Date().toISOString(),
      };
      throw err;
    }
  }

  override async status() {
    const base = await super.status();
    if (!this.client) return { ...base, last_successful_sync: this.lastSync, last_error: this.lastError };
    const started = Date.now();
    try {
      await this.run(async (client, signal) => {
        await client.accessibleCustomers(signal);
        if (client.config.loginCustomerId || client.config.customerIds[0])
          await readAccount(client, client.config.loginCustomerId ?? client.config.customerIds[0]!, signal);
      }, false);
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
        last_error: this.lastError,
        last_successful_sync: this.lastSync,
        latency_ms: Date.now() - started,
      };
    }
  }

  private async hierarchy(client: GoogleAdsClient, signal: AbortSignal) {
    if (!this.accounts || this.accounts.until <= Date.now()) {
      const warnings: ApiError[] = [];
      const value = await discoverAccounts(client, signal, (warning) => warnings.push(warning));
      this.accounts = { value, until: Date.now() + 300000, warnings };
    }
    return this.accounts;
  }

  private async select(
    client: GoogleAdsClient,
    signal: AbortSignal,
    q: CampaignQuery,
    options?: ProviderRequestOptions,
  ): Promise<NormalizedAccount[]> {
    let accounts: NormalizedAccount[];
    if (q.account_id) {
      const id = customerId(q.account_id);
      let known = this.accounts?.value.find((a) => a.account_id === id);
      // Sin MCC configurada, una cuenta cliente solo se opera con el login-customer-id de la MCC
      // accesible que la contiene: se toma de la jerarquía (en caché) antes de consultarla.
      if (!known && !client.config.loginCustomerId)
        known = (await this.hierarchy(client, signal)).value.find((a) => a.account_id === id);
      accounts = [await readAccount(client, id, signal, known?.manager_account_id ?? client.config.loginCustomerId)];
    } else {
      const found = await this.hierarchy(client, signal);
      accounts = found.value;
      found.warnings.forEach((warning) => options?.onWarning?.(warning));
    }
    return accounts.filter((a) => q.client_id === undefined || a.client_id === q.client_id);
  }

  override listAccounts(query: AccountQuery, options?: ProviderRequestOptions) {
    return this.run(
      async (client, signal) => (await this.select(client, signal, query, options)).map((a) => ({ ...a })),
      true,
      options?.signal,
    );
  }

  private async rows(
    client: GoogleAdsClient,
    signal: AbortSignal,
    query: CampaignQuery,
    gaql: string,
    options?: ProviderRequestOptions,
  ): Promise<Array<{ row: GoogleRow; account: NormalizedAccount }>> {
    const accounts = (await this.select(client, signal, query, options)).filter(
      (account) => !account.is_manager && (query.account_id || account.status === null || account.status === "ENABLED"),
    );
    const results: Array<Array<{ row: GoogleRow; account: NormalizedAccount }>> = accounts.map(() => []);
    const cancel = new AbortController(),
      scoped = AbortSignal.any([signal, cancel.signal]);
    let next = 0,
      successfulAccounts = 0,
      failed = false;
    let fatal: unknown,
      firstUnavailable: ApiError | null = null;
    const worker = async () => {
      while (next < accounts.length && !failed) {
        const index = next++,
          account = accounts[index]!;
        try {
          const rows = await client.search(account.account_id, gaql, scoped, account.manager_account_id ?? undefined);
          successfulAccounts++;
          results[index] = rows.map((row) => ({ row, account }));
        } catch (error) {
          if (failed) return;
          const warning = accountWarning(error, account.account_id);
          if (query.account_id || !warning) {
            failed = true;
            fatal = error;
            cancel.abort();
            return;
          }
          firstUnavailable ??= warning;
          options?.onWarning?.(warning);
        }
      }
    };
    // Bound API pressure, preserve account ordering and drain cancelled requests on a fatal failure.
    await Promise.all(Array.from({ length: Math.min(4, accounts.length) }, worker));
    if (failed) throw fatal;
    if (!successfulAccounts && firstUnavailable) throw firstUnavailable;
    return results.flat();
  }

  override listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions) {
    return this.run(
      async (client, signal) => {
        const rows = await this.rows(client, signal, query, campaignsQuery(), options);
        return rows.map(({ row, account }) => normalizeCampaign(row, account));
      },
      true,
      options?.signal,
    );
  }

  override getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    const gaql = performanceQuery(query);
    return this.run(
      async (client, signal) => {
        const at = new Date().toISOString();
        const rows = await this.rows(client, signal, query, gaql, options);
        return rows.map(({ row, account }) => normalizePerformance(row, account, query, at));
      },
      true,
      options?.signal,
    );
  }

  override getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    const gaql = conversionsQuery(query);
    return this.run(
      async (client, signal) => {
        const at = new Date().toISOString();
        const rows = await this.rows(client, signal, query, gaql, options);
        return rows.map(({ row, account }) => normalizeConversion(row, account, query, client.config, at));
      },
      true,
      options?.signal,
    );
  }
}
