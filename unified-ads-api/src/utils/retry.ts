import { ApiError } from "./errors.js";

/**
 * Reintentos con espera exponencial y variación aleatoria (1 s, 2 s, 4 s, 8 s…). Respeta
 * Retry-After. Solo reintenta lo transitorio: 429, 5xx y errores de red; nunca 400, 401 o 403.
 */
export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxMs: number;
  /** Para pruebas: reemplaza setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 4, baseMs: 1000, maxMs: 16000 };

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
]);

export interface HttpLikeError {
  status?: number;
  response?: { status?: number; headers?: Record<string, unknown> };
  code?: string;
  retryAfter?: number | null;
}

function statusOf(err: unknown): number | null {
  const e = err as HttpLikeError | null;
  return e?.status ?? e?.response?.status ?? null;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError)
    return (
      err.code === "RATE_LIMITED" ||
      err.code === "PROVIDER_TIMEOUT" ||
      (err.code === "PROVIDER_ERROR" && err.statusCode >= 500)
    );
  const status = statusOf(err);
  if (status !== null) return status === 429 || status >= 500;
  const code = (err as HttpLikeError | null)?.code;
  return typeof code === "string" && NETWORK_CODES.has(code);
}

/** Retry-After en segundos o como fecha HTTP. */
export function retryAfterMs(err: unknown, now = Date.now()): number | null {
  if (err instanceof ApiError && err.retryAfter !== null) return err.retryAfter * 1000;
  const raw = (err as HttpLikeError | null)?.response?.headers?.["retry-after"];
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function backoffDelay(
  attempt: number,
  opts: Pick<RetryOptions, "baseMs" | "maxMs">,
  random = Math.random,
): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
  // Variación completa ("full jitter") entre la mitad y el total, para no sincronizar reintentos.
  return Math.round(exp / 2 + random() * (exp / 2));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !isRetryable(err)) throw err;
      const hinted = retryAfterMs(err);
      const delayMs = hinted !== null ? Math.min(hinted, opts.maxMs * 4) : backoffDelay(attempt, opts, opts.random);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
      attempt++;
    }
  }
}
