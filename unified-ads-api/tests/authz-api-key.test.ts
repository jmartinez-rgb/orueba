import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { Writable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import pino from "pino";
import { loggerOptions } from "../src/utils/logger.js";
import { KEY, makeApp } from "./helpers.js";

/**
 * Auditoría de autorización: X-API-Key protege todas las rutas privadas (incluidas
 * /api/v1/google/absolute-top y /api/v1/google-domains) frente a otras formas de enviar la llave
 * y variantes de ruta; los rechazos y los logs no exponen la llave. Solo loopback y simuladores.
 */

const PRIVATE_ROUTES = [
  "/api/v1/providers",
  "/api/v1/providers/google/status",
  "/api/v1/google/absolute-top",
  "/api/v1/google-domains",
  "/api/v1/accounts",
  "/api/v1/campaigns",
  "/api/v1/budgets",
  "/api/v1/delivery-health",
  "/api/v1/performance",
  "/api/v1/conversions",
];

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  app = await makeApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
});
afterAll(() => app.close());

function raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("X-API-Key en todas las rutas privadas", () => {
  it("la lista auditada corresponde a rutas registradas", () => {
    for (const url of PRIVATE_ROUTES)
      expect(app.hasRoute({ method: "GET", url: url.replace("/google/status", "/:provider/status") }), url).toBe(true);
  });

  it.each(PRIVATE_ROUTES)("%s rechaza sin llave, con llave incorrecta o enviada por otro canal", async (url) => {
    const attempts: Array<{ headers?: Record<string, string>; query?: string }> = [
      {},
      { headers: { "x-api-key": "llave-incorrecta-0123456789abcdef" } },
      { headers: { "x-api-key": "" } },
      { headers: { authorization: `Bearer ${KEY}` } },
      { headers: { "x-api-key ": KEY } },
      { query: `api_key=${encodeURIComponent(KEY)}` },
      { query: `x-api-key=${encodeURIComponent(KEY)}` },
    ];
    for (const attempt of attempts) {
      const res = await app.inject({
        method: "GET",
        url: attempt.query ? `${url}?${attempt.query}` : url,
        headers: attempt.headers,
      });
      expect(res.statusCode, JSON.stringify(attempt)).toBe(401);
      expect(res.json().error.code).toBe("AUTH_ERROR");
      expect(res.body).not.toContain(KEY);
    }
  });

  it.each(["/api/v1/google/absolute-top", "/api/v1/google-domains"])(
    "%s: variantes de ruta sin llave nunca llegan al manejador",
    async (url) => {
      const variants = [
        `/docs/..${url}`,
        `/api/v1/health/..${url.slice(7)}`,
        `/docs/%2e%2e${url}`,
        `${url}/`,
        `/${url}`,
        `${url};/docs`,
        `${url}?/docs`,
        `${url}?x=/api/v1/health`,
      ];
      for (const path of variants) {
        const res = await raw(path);
        expect([401, 403, 404], path).toContain(res.status);
        expect(res.body, path).not.toMatch(/"data"\s*:/);
      }
    },
  );

  it("solo salud y documentación responden sin llave", async () => {
    expect((await raw("/api/v1/health")).status).toBe(200);
    expect((await raw("/docs/json")).status).toBe(200);
    expect((await raw("/api/v1/healthz")).status).toBe(401);
    expect((await raw("/api/v1/inexistente")).status).toBe(401);
  });

  it("los logs censuran la llave y la autorización aunque viajen en la solicitud", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ ...loggerOptions({ env: "production", logLevel: "info" }) }, sink);
    logger.info(
      { req: { headers: { "x-api-key": KEY, authorization: `Bearer ${KEY}`, cookie: `s=${KEY}` } } },
      "solicitud",
    );
    expect(lines.join("")).not.toContain(KEY);
    expect(lines.join("")).toContain("[redacted]");
  });
});
