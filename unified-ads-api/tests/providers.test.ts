import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ProviderRegistry } from "../src/providers/registry.js";
import { BaseProvider } from "../src/providers/base-provider.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import { Provider, PROVIDER_SLUGS } from "../src/types/providers.js";
import { ApiError } from "../src/utils/errors.js";
import { KEY, makeApp } from "./helpers.js";

const auth = { "x-api-key": KEY };

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

describe("GET /api/v1/providers", () => {
  it("lista los seis proveedores en orden, sin configurar", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/providers", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((p: { id: string }) => p.id)).toEqual([...PROVIDER_SLUGS]);
    expect(body.data.map((p: { enum: string }) => p.enum)).toEqual([
      "GOOGLE",
      "META",
      "TIKTOK",
      "MICROSOFT",
      "SPOTIFY",
      "X",
    ]);
    for (const p of body.data) {
      expect(p.status.state).toBe("not_configured");
      expect(p.status.missing_config.length).toBeGreaterThan(0);
    }
    expect(body.request_id).toBe(res.headers["x-request-id"]);
  });

  it("con credenciales pero sin integración programada: not_implemented (nunca expone valores)", async () => {
    const env = {
      GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-secreto",
      GOOGLE_ADS_CLIENT_ID: "id",
      GOOGLE_ADS_CLIENT_SECRET: "secreto",
      GOOGLE_ADS_REFRESH_TOKEN: "refresh-secreto",
    };
    const configured = await makeApp({ providerEnv: env });
    const res = await configured.inject({ method: "GET", url: "/api/v1/providers/google/status", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      provider: "google",
      state: "not_implemented",
      configured: true,
      implemented: false,
      missing_config: [],
    });
    expect(res.body).not.toContain("secreto");
    await configured.close();
  });

  it("proveedor desconocido: 400 INVALID_REQUEST", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/providers/linkedin/status", headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("un proveedor que falla o tarda no tumba la respuesta de los demás", async () => {
    class Broken extends BaseProvider {
      constructor() {
        super(Provider.META, [], {});
      }
      override async status(): Promise<never> {
        throw new ApiError("PROVIDER_ERROR", "Meta respondió 500");
      }
    }
    class Slow extends BaseProvider {
      constructor() {
        super(Provider.TIKTOK, [], {});
      }
      override status() {
        return new Promise<never>(() => undefined);
      }
    }
    const registry = new ProviderRegistry([new GoogleProvider({}), new Broken(), new Slow()]);
    const partial = await makeApp({ providerTimeoutMs: 1000 }, { registry });
    const res = await partial.inject({ method: "GET", url: "/api/v1/providers", headers: auth });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.json().data.map((p: { id: string; status: unknown }) => [p.id, p.status]));
    expect(byId.google.state).toBe("not_configured");
    expect(byId.meta).toMatchObject({ state: "error", last_error: { code: "PROVIDER_ERROR" } });
    expect(byId.tiktok).toMatchObject({ state: "error", last_error: { code: "PROVIDER_TIMEOUT" } });
    await partial.close();
  });
});

describe("proveedores sin integración", () => {
  it("las consultas de datos responden NOT_CONFIGURED con lo que falta", async () => {
    const google = new GoogleProvider({});
    await expect(google.listAccounts({})).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      details: { provider: "google" },
    });
    const configured = new GoogleProvider({
      GOOGLE_ADS_DEVELOPER_TOKEN: "a",
      GOOGLE_ADS_CLIENT_ID: "b",
      GOOGLE_ADS_CLIENT_SECRET: "c",
      GOOGLE_ADS_REFRESH_TOKEN: "d",
    });
    await expect(
      configured.getPerformance({ date_from: "2026-09-01", date_to: "2026-09-02", granularity: "daily" }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED", details: { state: "not_implemented" } });
  });
});
