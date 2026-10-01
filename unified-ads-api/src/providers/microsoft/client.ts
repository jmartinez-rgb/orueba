import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../utils/errors.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { MICROSOFT_SCOPE, object, type MicrosoftConfig } from "./config.js";
import { expiredAccessToken, isMicrosoftRetryable, microsoftError, microsoftErrors } from "./errors.js";

export type MicrosoftFetch = typeof fetch;
const ENDPOINTS = {
  user: "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query",
  accounts: "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/Accounts/Search",
  account: "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/Account/Query",
  campaigns: "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/Campaigns/QueryByAccountId",
  submit: "https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit",
  poll: "https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Poll",
} as const;
export type MicrosoftOperation = keyof typeof ENDPOINTS;

export async function responseBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > limit) {
    await response.body?.cancel();
    throw new ApiError("PROVIDER_ERROR", "La respuesta de Microsoft supera el tamaño admitido.");
  }
  if (!response.body) throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una respuesta vacía.");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ApiError("PROVIDER_ERROR", "La respuesta de Microsoft supera el tamaño admitido.");
      parts.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return data;
}

export class MicrosoftClient {
  private access: { token: string; until: number } | null = null;
  private refreshToken: string;
  private refreshing: Promise<string> | null = null;
  private readonly breaker = new CircuitBreaker("Microsoft Advertising", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    isFailure: isMicrosoftRetryable,
  });
  constructor(
    readonly config: MicrosoftConfig,
    readonly request: MicrosoftFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
  ) {
    this.refreshToken = config.refreshToken;
  }

  private retryOptions(signal: AbortSignal): Partial<RetryOptions> {
    return {
      retries: this.config.retries,
      maxMs: this.config.timeoutMs,
      sleep: (ms) => delay(ms, undefined, { signal }),
      ...this.retry,
      shouldRetry: (err) => !signal.aborted && isMicrosoftRetryable(err),
    };
  }
  async wait(signal: AbortSignal) {
    await (this.retry.sleep ?? ((ms: number) => delay(ms, undefined, { signal })))(this.config.pollMs);
    signal.throwIfAborted();
  }
  private async json(url: string, body: string, headers: Record<string, string>, signal: AbortSignal, oauth = false) {
    let response: Response;
    try {
      response = await this.request(url, { method: "POST", headers, body, signal, redirect: "error" });
    } catch {
      throw new ApiError(
        signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        "No se pudo conectar con Microsoft Advertising.",
        { details: { provider: "microsoft", transient: !signal.aborted } },
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(await responseBytes(response, 8 * 1024 * 1024, signal)));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (!response.ok) throw microsoftError(response.status, null, response.headers);
      throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió JSON inválido.");
    }
    if (oauth && object(data) && typeof data.error === "string") {
      if (data.error === "temporarily_unavailable" || data.error === "server_error")
        throw new ApiError("PROVIDER_ERROR", "Microsoft no pudo renovar el token temporalmente.", {
          details: { provider: "microsoft", transient: true },
        });
      const known = ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_scope", "interaction_required"];
      throw new ApiError("AUTH_ERROR", "Microsoft requiere revisar el cliente OAuth o volver a autorizar la cuenta.", {
        details: { provider: "microsoft", oauth_error: known.includes(data.error) ? data.error : "unknown" },
      });
    }
    if (!response.ok || microsoftErrors(data).length) throw microsoftError(response.status, data, response.headers);
    if (!object(data)) throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una respuesta incompatible.");
    return data;
  }
  private async token(signal: AbortSignal): Promise<string> {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = withRetry(async () => {
      signal.throwIfAborted();
      const form = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
        scope: MICROSOFT_SCOPE,
      });
      const data = await this.json(
        `https://login.microsoftonline.com/${this.config.tenant}/oauth2/v2.0/token`,
        form.toString(),
        { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
        true,
      );
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        /[\r\n]/.test(data.access_token) ||
        typeof data.expires_in !== "number" ||
        !Number.isFinite(data.expires_in) ||
        data.expires_in <= 0 ||
        data.expires_in > 86400 ||
        (data.token_type !== undefined && String(data.token_type).toLowerCase() !== "bearer")
      )
        throw new ApiError("PROVIDER_ERROR", "Microsoft no devolvió un token OAuth válido.");
      if (typeof data.refresh_token === "string" && data.refresh_token) this.refreshToken = data.refresh_token;
      this.access = {
        token: data.access_token,
        until: Date.now() + data.expires_in * 1000 - Math.min(60000, data.expires_in * 100),
      };
      return data.access_token;
    }, this.retryOptions(signal));
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }
  async call(
    operation: MicrosoftOperation,
    payload: Record<string, unknown>,
    signal: AbortSignal,
    account?: { account_id: string; manager_account_id: string | null },
  ): Promise<Record<string, unknown>> {
    if (!Object.hasOwn(ENDPOINTS, operation))
      throw new ApiError("INVALID_REQUEST", "Operación de Microsoft no admitida.");
    return this.breaker.exec(() =>
      withRetry(async () => {
        let token = await this.token(signal);
        for (let renew = 0; renew < 2; renew++) {
          signal.throwIfAborted();
          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            DeveloperToken: this.config.developerToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          };
          if (account) {
            headers.CustomerAccountId = account.account_id;
            if (account.manager_account_id) headers.CustomerId = account.manager_account_id;
          }
          try {
            return await this.json(ENDPOINTS[operation], JSON.stringify(payload), headers, signal);
          } catch (err) {
            if (renew !== 0 || !expiredAccessToken(err)) throw err;
            if (this.access?.token === token) this.access = null;
            token = await this.token(signal);
          }
        }
        throw new ApiError("AUTH_ERROR", "Microsoft requiere una nueva autorización.");
      }, this.retryOptions(signal)),
    );
  }
}
