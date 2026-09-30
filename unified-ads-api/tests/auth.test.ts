import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashApiKey } from "../src/utils/api-keys.js";
import { KEY, makeApp } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

describe("autenticación X-API-Key", () => {
  it("sin llave: 401 AUTH_ERROR con request_id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/providers" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("AUTH_ERROR");
    expect(body.error.request_id).toBe(res.headers["x-request-id"]);
  });

  it("llave incorrecta: 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/providers",
      headers: { "x-api-key": "otra-llave-0123456789abcdefgh" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("llave válida: 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/providers", headers: { "x-api-key": KEY } });
    expect(res.statusCode).toBe(200);
  });

  it("acepta llaves guardadas como huella sha256", async () => {
    const hashed = await makeApp({ apiKeyHashes: [hashApiKey("llave-de-produccion-abcdefghijklmnop")] });
    const ok = await hashed.inject({
      method: "GET",
      url: "/api/v1/providers",
      headers: { "x-api-key": "llave-de-produccion-abcdefghijklmnop" },
    });
    expect(ok.statusCode).toBe(200);
    await hashed.close();
  });

  it("la documentación y la salud no piden llave", async () => {
    expect((await app.inject({ method: "GET", url: "/docs/json" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/health" })).statusCode).toBe(200);
  });
});
