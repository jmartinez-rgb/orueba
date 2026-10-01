import { setTimeout as delay } from "node:timers/promises";
import { ApiError, isApiError } from "../../utils/errors.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { object, type SpotifyConfig } from "./config.js";
import { spotifyError, isSpotifyRetryable } from "./errors.js";

export const SPOTIFY_API = "https://api-partner.spotify.com/ads/v3";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export type SpotifyFetch = typeof fetch;
export function spotifyBasic(clientId: string, secret: string) {
  return `Basic ${Buffer.from(`${clientId}:${secret}`, "utf8").toString("base64")}`;
}
export async function spotifyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const max = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new ApiError("PROVIDER_ERROR", "La respuesta de Spotify supera el tamaño admitido.");
  }
  if (!response.body) throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new ApiError("PROVIDER_ERROR", "La respuesta de Spotify supera el tamaño admitido.");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió JSON inválido.");
  }
}
export class SpotifyClient {
  private access: { token: string; until: number } | null = null;
  private refreshToken: string;
  private refreshing: Promise<string> | null = null;
  private readonly breaker = new CircuitBreaker("Spotify Ads", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    isFailure: isSpotifyRetryable,
  });
  constructor(
    readonly config: SpotifyConfig,
    readonly request: SpotifyFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
    /** Spotify puede rotar el refresh token al renovar: quien lo reciba debe conservarlo. */
    private readonly onRefreshTokenRotated?: (token: string) => void,
  ) {
    this.refreshToken = config.refreshToken;
  }
  private retryOptions(signal: AbortSignal): Partial<RetryOptions> {
    return {
      retries: this.config.retries,
      maxMs: this.config.timeoutMs,
      sleep: (ms) => delay(ms, undefined, { signal }),
      ...this.retry,
      shouldRetry: (e) => !signal.aborted && isSpotifyRetryable(e),
    };
  }
  private async json(url: string | URL, init: RequestInit, signal: AbortSignal, oauth = false) {
    let response: Response;
    try {
      response = await this.request(url, { ...init, signal, redirect: "error" });
    } catch {
      throw new ApiError(
        signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        "No se pudo conectar con Spotify Ads.",
        { details: { provider: "spotify", transient: !signal.aborted } },
      );
    }
    let body: unknown;
    try {
      body = await spotifyJson(response, signal);
    } catch (err) {
      if (!response.ok) throw spotifyError(response.status, null, response.headers);
      throw err;
    }
    if (oauth && object(body) && typeof body.error === "string") {
      if (["server_error", "temporarily_unavailable"].includes(body.error))
        throw new ApiError("PROVIDER_ERROR", "Spotify no pudo renovar el token temporalmente.", {
          details: { provider: "spotify", transient: true },
        });
      const known = ["invalid_client", "invalid_grant", "invalid_request", "unsupported_grant_type"];
      throw new ApiError("AUTH_ERROR", "Spotify requiere revisar el cliente OAuth o volver a autorizar la app.", {
        details: { provider: "spotify", oauth_error: known.includes(body.error) ? body.error : "unknown" },
      });
    }
    if (!response.ok) throw spotifyError(response.status, body, response.headers);
    if (!object(body)) throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una respuesta incompatible.");
    return body;
  }
  private async token(signal: AbortSignal): Promise<string> {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = withRetry(async () => {
      signal.throwIfAborted();
      const data = await this.json(
        SPOTIFY_TOKEN_URL,
        {
          method: "POST",
          headers: {
            Authorization: spotifyBasic(this.config.clientId, this.config.clientSecret),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken }).toString(),
        },
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
        String(data.token_type).toLowerCase() !== "bearer"
      )
        throw new ApiError("PROVIDER_ERROR", "Spotify no devolvió un token OAuth válido.");
      if (
        typeof data.refresh_token === "string" &&
        data.refresh_token &&
        !/[\r\n]/.test(data.refresh_token) &&
        data.refresh_token !== this.refreshToken
      ) {
        this.refreshToken = data.refresh_token;
        this.onRefreshTokenRotated?.(data.refresh_token);
      }
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
  async get(path: string, params: URLSearchParams, signal: AbortSignal) {
    // Caller-generated paths only. Never follow vendor URLs or send OAuth headers to another origin.
    if (
      !/^\/(?:businesses(?:\/[a-f\d-]{36}\/ad_accounts)?|ad_accounts\/[a-f\d-]{36}(?:\/(?:campaigns|aggregate_reports))?)$/.test(
        path,
      )
    )
      throw new ApiError("INVALID_REQUEST", "Operación de Spotify Ads no admitida.");
    const url = new URL(SPOTIFY_API + path);
    url.search = params.toString();
    return this.breaker.exec(() =>
      withRetry(async () => {
        let token = await this.token(signal);
        for (let renew = 0; renew < 2; renew++) {
          signal.throwIfAborted();
          try {
            return await this.json(
              url,
              { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
              signal,
            );
          } catch (err) {
            if (
              renew ||
              !isApiError(err) ||
              err.code !== "AUTH_ERROR" ||
              !object(err.details) ||
              err.details.http_status !== 401
            )
              throw err;
            if (this.access?.token === token) this.access = null;
            token = await this.token(signal);
          }
        }
        throw new ApiError("AUTH_ERROR", "Spotify requiere una autorización nueva.");
      }, this.retryOptions(signal)),
    );
  }
}
