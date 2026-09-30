import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

describe("GET /api/v1/health", () => {
  it("responde sin llave con el estado del servicio", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "unified-ads-api",
      version: "0.0.0-test",
      environment: "test",
    });
    expect(typeof body.uptime_s).toBe("number");
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });

  it("devuelve el X-Request-Id recibido o genera uno", async () => {
    const same = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "n8n-run-12345678" },
    });
    expect(same.headers["x-request-id"]).toBe("n8n-run-12345678");
    const generated = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "no valido!" },
    });
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("incluye encabezados de seguridad (Helmet)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});
