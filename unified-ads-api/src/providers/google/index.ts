import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import type { AccountQuery, CampaignQuery, PerformanceQuery, NormalizedAccount } from "../../types/normalized.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import { readGoogleConfig, customerId } from "./config.js";
import { GoogleAdsClient } from "./client.js";
import { discoverAccounts, readAccount } from "./accounts.js";
import { campaignsQuery, performanceQuery, conversionsQuery } from "./queries.js";
import { normalizeCampaign, normalizePerformance, normalizeConversion } from "./normalize.js";
import type { GoogleFetch, GoogleRow } from "./types.js";
import { unavailableAccountWarning } from "./errors.js";
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
      const state =
        isApiError(err) && err.code === "ACCESS_REQUIRED"
          ? ("access_required" as const)
          : isApiError(err) && (err.code === "ACCESS_DENIED" || err.code === "AUTH_ERROR")
            ? ("permission_denied" as const)
            : ("error" as const);
      return {
        ...base,
        state,
        last_error: this.lastError,
        last_successful_sync: this.lastSync,
        latency_ms: Date.now() - started,
      };
    }
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
      const known = this.accounts?.value.find((a) => a.account_id === id);
      accounts = [await readAccount(client, id, signal, known?.manager_account_id ?? client.config.loginCustomerId)];
    } else {
      if (!this.accounts || this.accounts.until <= Date.now()) {
        const warnings: ApiError[] = [];
        const value = await discoverAccounts(client, signal, (warning) => warnings.push(warning));
        this.accounts = { value, until: Date.now() + 300000, warnings };
      }
      accounts = this.accounts.value;
      this.accounts.warnings.forEach((warning) => options?.onWarning?.(warning));
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
    const output: Array<{ row: GoogleRow; account: NormalizedAccount }> = [];
    let successfulAccounts = 0;
    let firstUnavailable: ApiError | null = null;
    for (const account of await this.select(client, signal, query, options)) {
      if (account.is_manager) continue;
      let rows: GoogleRow[];
      try {
        rows = await client.search(account.account_id, gaql, signal, account.manager_account_id ?? undefined);
      } catch (error) {
        const warning = unavailableAccountWarning(error, account.account_id);
        if (query.account_id || !warning) throw error;
        firstUnavailable ??= warning;
        options?.onWarning?.(warning);
        continue;
      }
      successfulAccounts++;
      for (const row of rows) output.push({ row, account });
    }
    if (!successfulAccounts && firstUnavailable) throw firstUnavailable;
    return output;
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
