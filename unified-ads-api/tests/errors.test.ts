import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ApiError, ERROR_CODES, ERROR_STATUS, errorBody } from "../src/utils/errors.js";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config/env.js";
import { KEY, makeApp } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

describe("errores estándar", () => {
  it("define los nueve códigos con su estado HTTP", () => {
    expect([...ERROR_CODES]).toEqual([
      "AUTH_ERROR",
      "ACCESS_DENIED",
      "RATE_LIMITED",
      "NOT_CONFIGURED",
      "ACCESS_REQUIRED",
      "PROVIDER_ERROR",
      "PROVIDER_TIMEOUT",
      "INVALID_REQUEST",
      "UNKNOWN",
    ]);
    expect(ERROR_STATUS.AUTH_ERROR).toBe(401);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.PROVIDER_TIMEOUT).toBe(504);
  });

  it("forma del cuerpo: code, message, details (si hay) y request_id", () => {
    expect(errorBody(new ApiError("NOT_CONFIGURED", "x", { details: { provider: "meta" } }), "r-1")).toEqual({
      error: { code: "NOT_CONFIGURED", message: "x", details: { provider: "meta" }, request_id: "r-1" },
    });
    expect(errorBody(new ApiError("UNKNOWN"), "r-2").error).not.toHaveProperty("details");
  });

  it("ruta inexistente: 404 con el formato estándar", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nada", headers: { "x-api-key": KEY } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("un error inesperado no filtra detalles internos", async () => {
    const boom = await buildApp(testConfig());
    boom.get("/api/v1/boom", async () => {
      throw new Error("detalle interno con contraseña=123");
    });
    await boom.ready();
    const res = await boom.inject({ method: "GET", url: "/api/v1/boom", headers: { "x-api-key": KEY } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("UNKNOWN");
    expect(res.body).not.toContain("contraseña");
    await boom.close();
  });
});

describe("límite de solicitudes", () => {
  it("al pasarse responde 429 RATE_LIMITED con Retry-After", async () => {
    const limited = await makeApp({ rateLimit: { max: 2, timeWindow: "1 minute" } });
    const hit = () => limited.inject({ method: "GET", url: "/api/v1/health" });
    await hit();
    await hit();
    const res = await hit();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    await limited.close();
  });
});

describe("documentación", () => {
  it("/docs sirve Swagger UI y /docs/json la especificación OpenAPI con X-API-Key", async () => {
    const ui = await app.inject({ method: "GET", url: "/docs/" });
    expect([200, 302]).toContain(ui.statusCode);
    const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/api/v1/health", "/api/v1/providers", "/api/v1/providers/{provider}/status"]),
    );
    expect(spec.components.securitySchemes.ApiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "X-API-Key",
    });
  });

  it("se puede apagar en producción", async () => {
    const noDocs = await makeApp({ docsEnabled: false });
    expect((await noDocs.inject({ method: "GET", url: "/docs/json" })).statusCode).toBe(404);
    await noDocs.close();
  });
});
