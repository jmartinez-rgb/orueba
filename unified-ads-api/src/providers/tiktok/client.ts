import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../utils/errors.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { withRetry, type RetryOptions } from "../../utils/retry.js";
import { TIKTOK_BASE_URL, type TikTokConfig } from "./config.js";
import { tiktokError, isTikTokRetryable } from "./errors.js";
import { tiktokObject, type TikTokFetch } from "./types.js";

export type TikTokParams = Record<string, string>;
export class TikTokClient {
  private readonly breaker = new CircuitBreaker("TikTok", {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    isFailure: isTikTokRetryable,
  });
  constructor(
    readonly config: TikTokConfig,
    private readonly request: TikTokFetch = fetch,
    private readonly retry: Partial<RetryOptions> = {},
  ) {}

  async get(path: string, params: TikTokParams, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!["oauth2/advertiser/get/", "advertiser/info/", "campaign/get/", "report/integrated/get/"].includes(path))
      throw new ApiError("INVALID_REQUEST", "Ruta de TikTok inválida.");
    const url = new URL(`${TIKTOK_BASE_URL}/open_api/${this.config.version}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (["access_token", "secret", "app_id"].includes(key))
        throw new ApiError("INVALID_REQUEST", "Parámetro reservado de TikTok.");
      url.searchParams.set(key, value);
    }
    if (path === "oauth2/advertiser/get/") {
      if (!this.config.appId || !this.config.appSecret)
        throw new ApiError("NOT_CONFIGURED", "El descubrimiento de TikTok requiere App ID y App Secret.");
      // El contrato oficial de este endpoint requiere el secret en query. Nunca se registra la URL.
      url.searchParams.set("app_id", this.config.appId);
      url.searchParams.set("secret", this.config.appSecret);
    }
    try {
      return await this.breaker.exec(() =>
        withRetry(
          async () => {
            signal.throwIfAborted();
            let response: Response;
            try {
              response = await this.request(url, {
                method: "GET",
                headers: { "Access-Token": this.config.accessToken },
                signal,
                redirect: "error",
              });
            } catch {
              throw new ApiError(
                signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
                "No se pudo completar la conexión con TikTok.",
                { details: { provider: "tiktok", transient: !signal.aborted } },
              );
            }
            let body: unknown;
            try {
              body = await response.json();
            } catch {
              if (signal.aborted) throw new ApiError("PROVIDER_TIMEOUT", "TikTok agotó su tiempo máximo.");
              if (!response.ok) throw tiktokError(response.status, null, response.headers);
              throw new ApiError("PROVIDER_ERROR", "TikTok devolvió una respuesta inválida.");
            }
            if (!response.ok || (tiktokObject(body) && typeof body.code === "number" && body.code !== 0))
              throw tiktokError(response.status, body, response.headers);
            if (!tiktokObject(body) || body.code !== 0 || !tiktokObject(body.data))
              throw new ApiError("PROVIDER_ERROR", "TikTok no devolvió el código y los datos esperados.");
            return body.data;
          },
          {
            retries: this.config.retries,
            maxMs: Math.max(16000, this.config.timeoutMs),
            sleep: (ms) => delay(ms, undefined, { signal }),
            ...this.retry,
            shouldRetry: (err) =>
              isTikTokRetryable(err) &&
              !(err instanceof ApiError && err.retryAfter !== null && err.retryAfter * 1000 >= this.config.timeoutMs),
          },
        ),
      );
    } catch (err) {
      if (signal.aborted) throw new ApiError("PROVIDER_TIMEOUT", "La consulta a TikTok agotó su tiempo máximo.");
      throw err;
    }
  }
  rows<T>(data: Record<string, unknown>): T[] {
    if (!Array.isArray(data.list) || !data.list.every(tiktokObject))
      throw new ApiError("PROVIDER_ERROR", "TikTok devolvió una lista inválida.");
    return data.list as T[];
  }
  async list<T>(
    path: string,
    params: TikTokParams,
    signal: AbortSignal,
    onWarning?: (err: ApiError) => void,
  ): Promise<T[]> {
    const output: T[] = [];
    let totalPages: number | undefined;
    const warnings = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      const data = await this.get(path, { ...params, page: String(page), page_size: "1000" }, signal);
      const rows = this.rows<T>(data),
        info = data.page_info;
      if (
        !tiktokObject(info) ||
        info.page !== page ||
        typeof info.total_page !== "number" ||
        !Number.isInteger(info.total_page) ||
        info.total_page < 0 ||
        info.total_page > 1000 ||
        typeof info.page_size !== "number" ||
        !Number.isInteger(info.page_size) ||
        info.page_size < 1 ||
        info.page_size > 1000 ||
        (totalPages !== undefined && info.total_page !== totalPages) ||
        (info.total_page === 0 && rows.length > 0) ||
        (rows.length === 0 && page < info.total_page)
      )
        throw new ApiError("PROVIDER_ERROR", "TikTok devolvió paginación incompleta o incompatible.");
      totalPages = info.total_page;
      if (data.extra_info !== undefined && !tiktokObject(data.extra_info))
        throw new ApiError("PROVIDER_ERROR", "TikTok devolvió información de reporte inválida.");
      if (tiktokObject(data.extra_info))
        for (const key of ["search_ads_throttle", "uv_invalid"]) {
          if (data.extra_info[key] && !warnings.has(key)) {
            warnings.add(key);
            onWarning?.(
              new ApiError(
                "PROVIDER_ERROR",
                key === "search_ads_throttle"
                  ? "TikTok truncó el reporte por su límite de IDs. Filtra una campaña para obtener una lectura completa."
                  : "TikTok dejó temporalmente sin datos algunas métricas de usuarios únicos.",
                { details: { provider: "tiktok", limitation: key, partial: true } },
              ),
            );
          }
        }
      output.push(...rows);
      if (page >= totalPages) return output;
    }
    throw new ApiError("PROVIDER_ERROR", "TikTok superó el límite seguro de paginación.");
  }
}
