import { describe, expect, it, vi } from "vitest";
import { backoffDelay, isRetryable, retryAfterMs, withRetry } from "../src/utils/retry.js";
import { CircuitBreaker } from "../src/utils/circuit-breaker.js";
import { withTimeout } from "../src/utils/timeout.js";
import { ApiError } from "../src/utils/errors.js";

const http = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });

describe("reintentos", () => {
  it("reintenta 429, 5xx y errores de red; nunca 400, 401 ni 403", () => {
    expect(isRetryable(http(429))).toBe(true);
    expect(isRetryable(http(503))).toBe(true);
    expect(isRetryable(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryable(http(400))).toBe(false);
    expect(isRetryable(http(401))).toBe(false);
    expect(isRetryable(http(403))).toBe(false);
    expect(isRetryable(new ApiError("AUTH_ERROR"))).toBe(false);
    expect(isRetryable(new ApiError("RATE_LIMITED"))).toBe(true);
  });

  it("espera exponencial con variación: 1 s, 2 s, 4 s, 8 s (entre la mitad y el total)", () => {
    const opts = { baseMs: 1000, maxMs: 16000 };
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, opts, () => 1))).toEqual([1000, 2000, 4000, 8000]);
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, opts, () => 0))).toEqual([500, 1000, 2000, 4000]);
    expect(backoffDelay(10, opts, () => 1)).toBe(16000);
  });

  it("respeta Retry-After (segundos o fecha)", () => {
    expect(retryAfterMs(http(429, { "retry-after": "7" }))).toBe(7000);
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(retryAfterMs(http(429, { "retry-after": "Wed, 30 Sep 2026 12:00:05 GMT" }), now)).toBe(5000);
    expect(retryAfterMs(new ApiError("RATE_LIMITED", undefined, { retryAfter: 3 }))).toBe(3000);
  });

  it("reintenta hasta tener éxito, esperando lo indicado", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw http(429, { "retry-after": "2" });
        if (calls === 2) throw http(502);
        return "ok";
      },
      { sleep, random: () => 1 },
    );
    expect(result).toBe("ok");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 2000]);
  });

  it("no reintenta errores definitivos y se rinde al llegar al máximo", async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(withRetry(async () => Promise.reject(http(401)), { sleep })).rejects.toThrow("HTTP 401");
    expect(sleep).not.toHaveBeenCalled();
    const fn = vi.fn(async () => Promise.reject(http(500)));
    await expect(withRetry(fn, { sleep, retries: 3 })).rejects.toThrow("HTTP 500");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe("circuit breaker", () => {
  it("CLOSED → OPEN tras fallas seguidas → HALF_OPEN → CLOSED al recuperarse", async () => {
    let now = 0;
    const cb = new CircuitBreaker("Meta", { failureThreshold: 3, resetTimeoutMs: 30_000, now: () => now });
    const fail = () => cb.exec(async () => Promise.reject(http(503)));
    for (let i = 0; i < 3; i++) await expect(fail()).rejects.toThrow();
    expect(cb.current).toBe("OPEN");
    const called = vi.fn(async () => "x");
    await expect(cb.exec(called)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(called).not.toHaveBeenCalled();
    now = 30_000;
    expect(cb.current).toBe("HALF_OPEN");
    await expect(cb.exec(async () => "ok")).resolves.toBe("ok");
    expect(cb.current).toBe("CLOSED");
  });

  it("una prueba fallida en HALF_OPEN lo vuelve a abrir", async () => {
    let now = 0;
    const cb = new CircuitBreaker("TikTok", { failureThreshold: 1, resetTimeoutMs: 1000, now: () => now });
    await expect(cb.exec(async () => Promise.reject(http(500)))).rejects.toThrow();
    now = 1000;
    await expect(cb.exec(async () => Promise.reject(http(500)))).rejects.toThrow();
    expect(cb.current).toBe("OPEN");
  });

  it("errores de la solicitud (401, 400) no abren el circuito", async () => {
    const cb = new CircuitBreaker("Google", { failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(cb.exec(async () => Promise.reject(http(401)))).rejects.toThrow();
    expect(cb.current).toBe("CLOSED");
  });
});

describe("timeout", () => {
  it("corta con PROVIDER_TIMEOUT", async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, "Spotify")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    await expect(withTimeout(Promise.resolve(1), 20, "Spotify")).resolves.toBe(1);
  });
});
