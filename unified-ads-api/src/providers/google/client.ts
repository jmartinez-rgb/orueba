import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../utils/errors.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { GoogleAuthClient } from "./auth.js";
import { customerId, GOOGLE_ADS_API_URL, type GoogleConfig } from "./config.js";
import { googleError } from "./errors.js";
import type { GoogleFetch, GoogleRow } from "./types.js";

export class GoogleAdsClient {
  private readonly auth: GoogleAuthClient;
  private readonly breaker = new CircuitBreaker("Google Ads", { failureThreshold: 5, resetTimeoutMs: 30000 });

  constructor(
    readonly config: GoogleConfig,
    private readonly request: GoogleFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
  ) {
    this.auth = new GoogleAuthClient(config, request);
  }

  async accessibleCustomers(signal: AbortSignal): Promise<string[]> {
    const data = await this.call<{ resourceNames?: string[] }>(
      "customers:listAccessibleCustomers",
      undefined,
      undefined,
      signal,
    );
    if (!Array.isArray(data.resourceNames))
      throw new ApiError("PROVIDER_ERROR", "Google Ads no devolvió la lista de cuentas esperada.");
    return data.resourceNames.map((name) => customerId(name.replace(/^customers\//, "")));
  }

  async search(
    id: string,
    query: string,
    signal: AbortSignal,
    loginCustomerId = this.config.loginCustomerId,
  ): Promise<GoogleRow[]> {
    const rows: GoogleRow[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const data = await this.call<{ results?: GoogleRow[]; nextPageToken?: string }>(
        `customers/${customerId(id)}/googleAds:search`,
        { query, ...(pageToken ? { pageToken } : {}) },
        loginCustomerId,
        signal,
      );
      if (data.results !== undefined && !Array.isArray(data.results))
        throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió resultados inválidos.");
      rows.push(...(data.results ?? []));
      pageToken = data.nextPageToken || undefined;
      if (pageToken && (typeof pageToken !== "string" || seen.has(pageToken)))
        throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió un token de paginación inválido o repetido.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return rows;
  }

  private async call<T>(path: string, body: unknown, login: string | undefined, signal: AbortSignal): Promise<T> {
    try {
      return await this.breaker.exec(
        () =>
          withRetry(
            async () => {
              signal.throwIfAborted();
              let token = await this.auth.token(signal);
              let refreshed = false;
              for (;;) {
                signal.throwIfAborted();
                const headers: Record<string, string> = { authorization: `Bearer ${token}` };
                if (body !== undefined) headers["content-type"] = "application/json";
                if (this.config.developerToken) headers["developer-token"] = this.config.developerToken;
                if (this.config.cloudProject) headers["x-goog-user-project"] = this.config.cloudProject;
                // ListAccessibleCustomers es independiente del contexto del MCC.
                if (login && path !== "customers:listAccessibleCustomers")
                  headers["login-customer-id"] = customerId(login);
                let response: Response;
                try {
                  response = await this.request(`${GOOGLE_ADS_API_URL}/${this.config.version}/${path}`, {
                    method: body === undefined ? "GET" : "POST",
                    headers,
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                    signal,
                    redirect: "error",
                  });
                } catch (err) {
                  if (signal.aborted || (err instanceof Error && ["AbortError", "TimeoutError"].includes(err.name)))
                    throw new ApiError("PROVIDER_TIMEOUT", "Google Ads no respondió a tiempo.");
                  throw new ApiError("PROVIDER_ERROR", "No se pudo conectar con Google Ads.");
                }
                let data: unknown;
                try {
                  data = await response.json();
                } catch {
                  if (!response.ok) throw googleError(response.status, null, response.headers);
                  throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una respuesta inválida.");
                }
                if (response.status === 401 && !refreshed) {
                  this.auth.invalidate(token);
                  token = await this.auth.token(signal);
                  refreshed = true;
                  continue;
                }
                if (!response.ok) throw googleError(response.status, data, response.headers);
                if (!data || typeof data !== "object" || Array.isArray(data))
                  throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una respuesta inválida.");
                return data as T;
              }
            },
            {
              retries: this.config.retries,
              // El cap compartido de Retry-After no debe adelantar reintentos dentro de nuestro deadline.
              maxMs: Math.max(16000, this.config.timeoutMs),
              sleep: (ms) => delay(ms, undefined, { signal }),
              ...this.retry,
            },
          ),
        signal,
      );
    } catch (err) {
      if (signal.aborted) throw new ApiError("PROVIDER_TIMEOUT", "La consulta a Google Ads agotó su tiempo máximo.");
      throw err;
    }
  }
}
