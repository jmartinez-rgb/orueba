import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { ApiError } from "../../utils/errors.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { X_BASE, object, type XConfig } from "./config.js";
import { oauthHeader } from "./auth.js";
import { xError, xRetryable } from "./errors.js";
export type XFetch = typeof fetch;
async function boundedBytes(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get("content-length")) > limit || !response.body) {
    await response.body?.cancel();
    throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una respuesta vacía o demasiado grande.");
  }
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error();
      parts.push(value);
    }
    return Buffer.concat(parts);
  } catch {
    throw new ApiError(
      signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
      "No se pudo leer la respuesta acotada de X Ads.",
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export class XClient {
  private readonly breaker = new CircuitBreaker("X Ads", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    isFailure: xRetryable,
  });
  constructor(
    readonly config: XConfig,
    private readonly request: XFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
  ) {}
  async call(
    path: string,
    params: Record<string, string>,
    signal: AbortSignal,
    method: "GET" | "POST" = "GET",
  ): Promise<Record<string, unknown>> {
    if (
      !/^\/(?:accounts(?:\/[A-Za-z0-9]{1,80}(?:\/(?:campaigns|funding_instruments))?)?|stats\/accounts\/[A-Za-z0-9]{1,80}(?:\/active_entities)?|stats\/jobs\/accounts\/[A-Za-z0-9]{1,80})$/.test(
        path,
      )
    )
      throw new ApiError("INVALID_REQUEST", "Ruta de X Ads inválida.");
    if (method === "POST" && !path.startsWith("/stats/jobs/accounts/"))
      throw new ApiError("INVALID_REQUEST", "Operación de X Ads inválida.");
    if (Object.keys(params).some((k) => k.startsWith("oauth_")))
      throw new ApiError("INVALID_REQUEST", "Parámetro OAuth reservado.");
    const url = new URL(X_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.breaker.exec(
      () =>
        withRetry(
          async () => {
            signal.throwIfAborted();
            let response: Response;
            try {
              response = await this.request(url, {
                method,
                headers: { Authorization: oauthHeader(method, url, this.config) },
                redirect: "error",
                signal,
              });
            } catch {
              throw new ApiError(
                signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
                "No se pudo completar la conexión con X Ads.",
                { details: { provider: "x", transient: !signal.aborted } },
              );
            }
            let body: unknown;
            try {
              body = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  await boundedBytes(response, 10 * 1024 * 1024, signal),
                ),
              );
            } catch {
              if (!response.ok) throw xError(response.status, null, response.headers);
              throw new ApiError("PROVIDER_ERROR", "X Ads devolvió JSON inválido.");
            }
            if (!response.ok || (object(body) && Array.isArray(body.errors) && body.errors.length))
              throw xError(response.status, body, response.headers);
            if (!object(body)) throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una respuesta incompatible.");
            return body;
          },
          {
            retries: this.config.retries,
            sleep: (ms) => delay(ms, undefined, { signal }),
            ...this.retry,
            // No clamp below the provider's reset time. Stop when the reset exceeds the whole deadline.
            maxMs: this.config.timeoutMs,
            shouldRetry: (e) =>
              xRetryable(e) &&
              (method === "GET" || (e instanceof ApiError && e.code === "RATE_LIMITED")) &&
              !(e instanceof ApiError && e.retryAfter !== null && e.retryAfter * 1000 >= this.config.timeoutMs),
          },
        ),
      signal,
    );
  }
  async list(path: string, params: Record<string, string>, signal: AbortSignal) {
    const out: Record<string, unknown>[] = [],
      cursors = new Set<string>(),
      ids = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 2000; page++) {
      const body = await this.call(path, { ...params, count: "200", ...(cursor ? { cursor } : {}) }, signal);
      if (!Array.isArray(body.data) || !body.data.every(object))
        throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una lista inválida.");
      for (const row of body.data) {
        if (typeof row.id !== "string" || ids.has(row.id))
          throw new ApiError("PROVIDER_ERROR", "X Ads devolvió identificadores inválidos o repetidos.");
        ids.add(row.id);
        out.push(row);
      }
      const next = body.next_cursor;
      if (next === null || next === undefined || next === "" || next === "0") return out;
      if (
        typeof next !== "string" ||
        next.length > 4096 ||
        /[\r\n]/.test(next) ||
        cursors.has(next) ||
        !body.data.length
      )
        throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una paginación incompatible.");
      cursors.add(next);
      cursor = next;
    }
    throw new ApiError("PROVIDER_ERROR", "X Ads superó el límite seguro de paginación.");
  }
  async download(value: unknown, signal: AbortSignal, expectedJobId?: string): Promise<Record<string, unknown>> {
    let url: URL;
    try {
      if (typeof value !== "string") throw new Error();
      url = new URL(value);
    } catch {
      throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una descarga inválida.");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "ton.twimg.com" ||
      (url.port && url.port !== "443") ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/advertiser-api-async-analytics\/stats_job_\d+\.json\.gz$/.test(url.pathname)
    )
      throw new ApiError("PROVIDER_ERROR", "X Ads devolvió un destino de descarga no permitido.");
    if (expectedJobId && url.pathname !== `/advertiser-api-async-analytics/stats_job_${expectedJobId}.json.gz`)
      throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una descarga de un trabajo distinto al solicitado.");
    try {
      // Fixed official host, no redirects and no OAuth credentials on the CDN request.
      const response = await this.request(url, { signal, redirect: "error" });
      if (!response.ok || !response.body) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value: bytes } = await reader.read();
          if (done) break;
          size += bytes.length;
          if (size > 10 * 1024 * 1024) throw new Error();
          chunks.push(bytes);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = Buffer.concat(chunks);
      const expanded =
        bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 25 * 1024 * 1024 }) : bytes;
      const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(expanded));
      if (!object(body)) throw new Error();
      return body;
    } catch {
      throw new ApiError(
        signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        "No se pudo descargar o validar el informe de X Ads.",
      );
    }
  }
}
