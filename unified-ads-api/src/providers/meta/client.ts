import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../utils/errors.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { META_GRAPH_URL, type MetaConfig } from "./config.js";
import { metaError, isMetaRetryable } from "./errors.js";
import { metaObject, type MetaFetch } from "./types.js";

export class MetaClient {
  private readonly breaker = new CircuitBreaker("Meta", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    isFailure: isMetaRetryable,
  });
  private readonly proof?: string;
  constructor(
    readonly config: MetaConfig,
    private readonly request: MetaFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
  ) {
    this.proof = config.appSecret
      ? createHmac("sha256", config.appSecret).update(config.accessToken).digest("hex")
      : undefined;
  }

  async get<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
    if (
      !/^(?:me|act_\d+|\d+)(?:\/(?:adaccounts|owned_ad_accounts|client_ad_accounts|campaigns|adsets|insights|customconversions))?$/.test(
        path,
      )
    )
      throw new ApiError("INVALID_REQUEST", "Ruta de Meta inválida.");
    const url = new URL(`${META_GRAPH_URL}/${this.config.version}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (key === "access_token" || key === "appsecret_proof")
        throw new ApiError("INVALID_REQUEST", "Parámetro reservado de Meta.");
      url.searchParams.set(key, value);
    }
    if (this.proof) url.searchParams.set("appsecret_proof", this.proof);
    try {
      return await this.breaker.exec(
        () =>
          withRetry(
            async () => {
              signal.throwIfAborted();
              let response: Response;
              try {
                response = await this.request(url, {
                  method: "GET",
                  headers: { authorization: `Bearer ${this.config.accessToken}` },
                  signal,
                  redirect: "error",
                });
              } catch {
                throw new ApiError(
                  signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
                  signal.aborted ? "Meta agotó su tiempo máximo." : "No se pudo conectar con Meta.",
                  { details: { provider: "meta", transient: !signal.aborted } },
                );
              }
              let data: unknown;
              try {
                data = await response.json();
              } catch {
                if (signal.aborted) throw new ApiError("PROVIDER_TIMEOUT", "Meta agotó su tiempo máximo.");
                if (!response.ok) throw metaError(response.status, null, response.headers);
                throw new ApiError("PROVIDER_ERROR", "Meta devolvió una respuesta inválida.");
              }
              if (!response.ok || (metaObject(data) && data.error))
                throw metaError(response.status, data, response.headers);
              if (!metaObject(data)) throw new ApiError("PROVIDER_ERROR", "Meta devolvió una respuesta inválida.");
              return data as T;
            },
            {
              retries: this.config.retries,
              maxMs: Math.max(16000, this.config.timeoutMs),
              sleep: (ms) => delay(ms, undefined, { signal }),
              ...this.retry,
              shouldRetry: (err) =>
                isMetaRetryable(err) &&
                !(err instanceof ApiError && err.retryAfter !== null && err.retryAfter * 1000 >= this.config.timeoutMs),
            },
          ),
        signal,
      );
    } catch (err) {
      if (signal.aborted) throw new ApiError("PROVIDER_TIMEOUT", "La consulta a Meta agotó su tiempo máximo.");
      throw err;
    }
  }

  async list<T>(path: string, params: Record<string, string>, signal: AbortSignal, pageSize = 100): Promise<T[]> {
    const output: T[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const result = await this.get<Record<string, unknown>>(
        path,
        { ...params, limit: String(pageSize), ...(after ? { after } : {}) },
        signal,
      );
      if (!Array.isArray(result.data) || !result.data.every(metaObject))
        throw new ApiError("PROVIDER_ERROR", "Meta devolvió una lista inválida.");
      output.push(...(result.data as T[]));
      if (result.paging === undefined) return output;
      if (!metaObject(result.paging)) throw new ApiError("PROVIDER_ERROR", "Meta devolvió paginación inválida.");
      if (!result.paging.next) return output;
      if (typeof result.paging.next !== "string")
        throw new ApiError("PROVIDER_ERROR", "Meta devolvió paginación inválida.");
      // Nunca seguimos paging.next: suele incluir tokens. Reconstruimos la misma ruta con after.
      const cursors = result.paging.cursors;
      after = metaObject(cursors) && typeof cursors.after === "string" ? cursors.after : undefined;
      if (!after || after.length > 8192 || seen.has(after))
        throw new ApiError("PROVIDER_ERROR", "Meta devolvió un cursor inválido o repetido.");
      seen.add(after);
    }
    throw new ApiError("PROVIDER_ERROR", "Meta superó el límite seguro de paginación.");
  }
}
