import { describe, expect, it } from "vitest";
import { GoogleProvider } from "../src/providers/google/index.js";
import { CircuitBreaker } from "../src/utils/circuit-breaker.js";
import { ApiError } from "../src/utils/errors.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";

const day = { date_from: "2026-09-28", date_to: "2026-09-29", granularity: "daily" as const };
const ids = Array.from({ length: 4 }, (_, i) => String(2222222222 + i));

/** La primera cuenta falla con un error de consulta; las demás quedan esperando hasta que se cancelan. */
function hierarchy(sim: GoogleSimulator, mode: { fail: boolean }) {
  sim.intercept = (call) => {
    const query = String(call.body.query ?? "");
    if (query.includes(" FROM customer_client "))
      return Response.json({
        results: ids.map((id) => ({ customerClient: { id, level: "1", status: "ENABLED", manager: false } })),
      });
    if (!query.includes("metrics.")) return undefined;
    if (!mode.fail)
      return Response.json({
        results: [{ campaign: { id: "123" }, segments: { date: day.date_from }, metrics: { impressions: "1" } }],
      });
    if (call.url.pathname.includes(ids[0]!))
      return Response.json(
        {
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            details: [{ errors: [{ errorCode: { queryError: "BAD" } }] }],
          },
        },
        { status: 400 },
      );
    return new Promise<Response>((_, reject) =>
      call.signal?.addEventListener("abort", () => reject(call.signal!.reason), { once: true }),
    );
  };
}

describe("auditoría: cancelaciones propias no son fallas del proveedor", () => {
  it("Google: drenar consultas paralelas tras un error no abre el circuito para las siguientes", async () => {
    const sim = new GoogleSimulator(),
      mode = { fail: true };
    hierarchy(sim, mode);
    const p = new GoogleProvider(GOOGLE_ENV, { fetch: sim.fetch, retry: { retries: 0 } });
    for (let i = 0; i < 2; i++) await expect(p.getPerformance(day)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    mode.fail = false;
    // Google está sano: la consulta debe responder, no "falla de forma repetida".
    await expect(p.getPerformance(day)).resolves.toHaveLength(ids.length);
  });

  it("el circuito ignora una cancelación de quien llama pero cuenta un plazo vencido", async () => {
    const breaker = new CircuitBreaker("Prueba", { failureThreshold: 1, resetTimeoutMs: 60000 });
    const timeoutError = new ApiError("PROVIDER_TIMEOUT", "plazo");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(breaker.exec(() => Promise.reject(timeoutError), cancelled.signal)).rejects.toBe(timeoutError);
    expect(breaker.current).toBe("CLOSED");
    const expired = AbortSignal.timeout(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(breaker.exec(() => Promise.reject(timeoutError), expired)).rejects.toBe(timeoutError);
    expect(breaker.current).toBe("OPEN");
  });
});
