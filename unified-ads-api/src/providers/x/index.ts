import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";
import { stateFromError } from "../status.js";
import { incrementalCampaignIds } from "./activity.js";
import type { ProviderRequestOptions } from "../provider.js";
import type {
  AccountQuery,
  CampaignQuery,
  NormalizedAccount,
  NormalizedConversion,
  NormalizedPerformance,
  PerformanceQuery,
} from "../../types/normalized.js";
import { ApiError, isApiError } from "../../utils/errors.js";
import type { RetryOptions } from "../../utils/retry.js";
import { object, readXConfig, X_REQUIRED, xId } from "./config.js";
import { XClient, type XFetch } from "./client.js";
import { reportWindows, xReport } from "./reports.js";
import { normalizeCampaign, normalizeConversions, normalizePerformance } from "./normalize.js";

/** Read-only campaign and web conversion integration, X Ads API 12. */
export class XProvider extends BaseProvider {
  override readonly implemented = true;
  private readonly setup: ReturnType<typeof readXConfig>;
  private readonly client: XClient | null;
  private lastSync: string | null = null;
  private lastError: { code: string; message: string; at: string } | null = null;
  constructor(
    env: Readonly<Record<string, string | undefined>>,
    private readonly opts: {
      fetch?: XFetch;
      timeoutMs?: number;
      retry?: Partial<RetryOptions>;
      wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    } = {},
  ) {
    super(Provider.X, X_REQUIRED, env);
    this.setup = readXConfig(env, opts.timeoutMs);
    this.client = this.setup.config ? new XClient(this.setup.config, opts.fetch, opts.retry) : null;
  }
  get timeoutMs() {
    return this.setup.config?.timeoutMs;
  }
  override missingConfig() {
    return [...this.setup.missing];
  }
  override isConfigured() {
    return this.client !== null;
  }
  private async run<T>(
    work: (client: XClient, signal: AbortSignal) => Promise<T>,
    options?: ProviderRequestOptions,
    record = true,
  ): Promise<T> {
    if (!this.client)
      throw new ApiError("NOT_CONFIGURED", "X Ads no está configurado o tiene variables inválidas.", {
        details: { provider: "x", missing_config: this.missingConfig() },
      });
    const deadline = AbortSignal.timeout(this.client.config.timeoutMs),
      signal = options?.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    try {
      signal.throwIfAborted();
      const value = await work(this.client, signal);
      if (record) this.lastSync = new Date().toISOString();
      this.lastError = null;
      return value;
    } catch (e) {
      const safe = signal.aborted
        ? new ApiError("PROVIDER_TIMEOUT", "X Ads agotó el tiempo máximo de la consulta.")
        : isApiError(e)
          ? e
          : new ApiError("PROVIDER_ERROR", "X Ads devolvió datos incompatibles.");
      this.lastError = { code: safe.code, message: safe.message, at: new Date().toISOString() };
      throw safe;
    }
  }
  override async status() {
    const base = await super.status();
    if (!this.client) return base;
    const start = Date.now();
    try {
      await this.run((client, signal) => this.accounts(client, signal, {}), undefined, false);
      return {
        ...base,
        state: "connected" as const,
        last_successful_sync: this.lastSync,
        last_error: null,
        latency_ms: Date.now() - start,
      };
    } catch (e) {
      return {
        ...base,
        state: stateFromError(e),
        last_successful_sync: this.lastSync,
        last_error: this.lastError,
        latency_ms: Date.now() - start,
      };
    }
  }
  private async accounts(client: XClient, signal: AbortSignal, query: CampaignQuery, options?: ProviderRequestOptions) {
    const ids = query.account_id ? [xId(query.account_id)] : client.config.accountIds;
    const rows: Record<string, unknown>[] = [];
    let firstError: ApiError | null = null;
    if (!ids.length) rows.push(...(await client.list("/accounts", { with_deleted: "true" }, signal)));
    else
      for (const id of ids) {
        try {
          const body = await client.call(`/accounts/${id}`, { with_deleted: "true" }, signal);
          if (!object(body.data) || body.data.id !== id)
            throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una cuenta diferente a la solicitada.");
          rows.push(body.data);
        } catch (e) {
          if (query.account_id || !isApiError(e) || e.code !== "ACCESS_DENIED") throw e;
          firstError ??= e;
          options?.onWarning?.(
            new ApiError("ACCESS_DENIED", "Una cuenta configurada de X Ads no se pudo leer.", {
              details: { provider: "x", account_id: id },
            }),
          );
        }
      }
    if (!rows.length && firstError) throw firstError;
    return rows.flatMap((row) => {
      const id = xId(row.id),
        clientId = client.config.clientMapping[id] ?? null;
      if (query.client_id && query.client_id !== clientId) return [];
      const account: NormalizedAccount = {
        platform: "x",
        account_id: id,
        account_name: typeof row.name === "string" ? row.name : id,
        client_id: clientId,
        currency: null,
        timezone: typeof row.timezone === "string" ? row.timezone : null,
        status: row.deleted === true ? "DELETED" : typeof row.approval_status === "string" ? row.approval_status : null,
        manager_account_id: null,
      };
      return [{ account, source: row }];
    });
  }
  override listAccounts(query: AccountQuery, options?: ProviderRequestOptions) {
    return this.each(query, options, async (client, signal, account) => {
      const funding = await client.list(
        `/accounts/${account.account_id}/funding_instruments`,
        { with_deleted: "true" },
        signal,
      );
      const currencies = [
        ...new Set(
          funding.flatMap((row) =>
            typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? [row.currency] : [],
          ),
        ),
      ];
      account.currency = currencies.length === 1 ? currencies[0]! : null;
      if (currencies.length > 1)
        options?.onWarning?.(
          new ApiError(
            "PROVIDER_ERROR",
            "X Ads reportó varias monedas en los instrumentos de la cuenta; no se agregan importes entre monedas.",
            { details: { provider: "x", account_id: account.account_id, limitation: "multiple_currencies" } },
          ),
        );
      return [account];
    });
  }

  private async each<T>(
    query: CampaignQuery,
    options: ProviderRequestOptions | undefined,
    work: (
      client: XClient,
      signal: AbortSignal,
      account: NormalizedAccount,
      source: Record<string, unknown>,
    ) => Promise<T[]>,
  ) {
    return this.run(async (client, signal) => {
      const selected = await this.accounts(client, signal, query, options),
        out: T[] = [];
      let first: ApiError | null = null,
        success = 0;
      for (const { account, source } of selected) {
        try {
          out.push(...(await work(client, signal, account, source)));
          success++;
        } catch (e) {
          if (query.account_id || !isApiError(e) || e.code !== "ACCESS_DENIED") throw e;
          first ??= e;
          options?.onWarning?.(
            new ApiError("ACCESS_DENIED", "Una cuenta de X Ads no autorizó la consulta.", {
              details: { provider: "x", account_id: account.account_id },
            }),
          );
        }
      }
      if (!success && first) throw first;
      return out;
    }, options);
  }
  override listCampaigns(query: CampaignQuery, options?: ProviderRequestOptions) {
    return this.each(query, options, async (client, signal, account) =>
      (await client.list(`/accounts/${account.account_id}/campaigns`, { with_deleted: "true" }, signal)).map((row) =>
        normalizeCampaign(row, account),
      ),
    );
  }
  private reports(
    query: PerformanceQuery,
    options: ProviderRequestOptions | undefined,
    conversions: boolean,
  ): Promise<Array<NormalizedPerformance | NormalizedConversion>> {
    reportWindows(query);
    return this.each<NormalizedPerformance | NormalizedConversion>(
      query,
      options,
      async (client, signal, account, source) => {
        const campaigns = await client.list(
          `/accounts/${account.account_id}/campaigns`,
          { with_deleted: "true" },
          signal,
        );
        const selected = query.campaign_id ? campaigns.filter((row) => row.id === xId(query.campaign_id)) : campaigns;
        if (query.campaign_id && !selected.length)
          throw new ApiError("INVALID_REQUEST", "La campaña de X Ads no pertenece a la cuenta solicitada.");
        const primary = client.config.primaryMapping[account.account_id] ?? client.config.primary;
        if (!conversions && !primary)
          options?.onWarning?.(
            new ApiError(
              "INVALID_REQUEST",
              "X Ads no tiene una acción principal configurada; conversiones y CPA quedan nulos.",
              {
                details: {
                  provider: "x",
                  account_id: account.account_id,
                  limitation: "primary_conversion_not_selected",
                },
              },
            ),
          );
        const ids = await incrementalCampaignIds(
            client,
            source,
            selected.map((row) => xId(row.id)),
            query,
            signal,
            options?.onWarning,
          ),
          at = new Date().toISOString();
        const buckets = await xReport(client, source, ids, query, conversions, signal, this.opts.wait);
        if (conversions)
          return buckets.flatMap((row) => {
            const campaign = selected.find((c) => c.id === row.campaignId)!;
            const currency =
              typeof campaign.currency === "string" && /^[A-Z]{3}$/.test(campaign.currency) ? campaign.currency : null;
            return normalizeConversions(row, { ...account, currency }, client.config, at);
          });
        if (primary) {
          const conversionRows = await xReport(client, source, ids, query, true, signal, this.opts.wait);
          const byKey = new Map(conversionRows.map((r) => [`${r.campaignId}/${r.date}/${r.hour}`, r]));
          for (const row of buckets) {
            const counts = byKey.get(`${row.campaignId}/${row.date}/${row.hour}`);
            if (!counts)
              throw new ApiError("PROVIDER_ERROR", "X Ads devolvió periodos distintos en conversiones y rendimiento.");
            row.metrics[primary] = counts.metrics[primary] ?? null;
            row.raw.conversions = counts.raw;
          }
        }
        const byId = new Map(selected.map((c) => [xId(c.id), c]));
        return buckets.map((row) => normalizePerformance(row, account, byId.get(row.campaignId)!, client.config, at));
      },
    );
  }
  override getPerformance(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.reports(query, options, false) as Promise<NormalizedPerformance[]>;
  }
  override getConversions(query: PerformanceQuery, options?: ProviderRequestOptions) {
    return this.reports(query, options, true) as Promise<NormalizedConversion[]>;
  }
}
