import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { GoogleProvider } from "../src/providers/google/index.js";
import { GoogleAdsClient } from "../src/providers/google/client.js";
import { readGoogleConfig, customerId, GOOGLE_ADS_SCOPE, GOOGLE_TOKEN_URL } from "../src/providers/google/config.js";
import { googleError } from "../src/providers/google/errors.js";
import { googleNumber } from "../src/providers/google/types.js";
import { performanceQuery } from "../src/providers/google/queries.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import {
  createOAuthRequest,
  exchangeAuthorizationCode,
  updateEnvVariable,
  validOAuthState,
} from "../src/providers/google/oauth.js";
import { KEY, makeApp } from "./helpers.js";
import { GOOGLE_ENV, GoogleSimulator, failure } from "./google-simulator.js";

const q = { account_id: "2222222222", date_from: "2026-09-01", date_to: "2026-09-02", granularity: "daily" as const };
function setup(env: Record<string, string | undefined> = {}, simulator = new GoogleSimulator()) {
  const provider = new GoogleProvider({ ...GOOGLE_ENV, ...env }, { fetch: simulator.fetch, retry: { retries: 0 } });
  return { provider, simulator };
}

function disabledRootSimulator() {
  const simulator = new GoogleSimulator();
  simulator.intercept = (call) => {
    if (call.url.pathname.endsWith("customers:listAccessibleCustomers"))
      return Response.json({ resourceNames: ["customers/9999999999", "customers/1111111111"] });
    if (call.url.pathname.includes("/9999999999/"))
      return Response.json(failure("authorizationError", "CUSTOMER_NOT_ENABLED", "test-client-secret"), {
        status: 403,
      });
    return undefined;
  };
  return simulator;
}

describe("Google configuration and OAuth", () => {
  it("v25 no exige developer token; v24 exige el acceso legacy", () => {
    expect(readGoogleConfig(GOOGLE_ENV).config?.version).toBe("v25");
    expect(readGoogleConfig({ ...GOOGLE_ENV, GOOGLE_ADS_API_VERSION: "v24" }).missing).toContain(
      "GOOGLE_ADS_DEVELOPER_TOKEN",
    );
  });
  it("normaliza IDs y rechaza entradas capaces de alterar GAQL o encabezados", () => {
    expect(customerId("123-456-7890")).toBe("1234567890");
    for (const id of ["12", "1234567890\r\nX: value", "1234567890 OR 1=1", "123--4567890"])
      expect(() => customerId(id)).toThrow();
  });
  it("configuración inválida no expone sus valores ni inicia peticiones", async () => {
    const { provider, simulator } = setup({ GOOGLE_ADS_CONVERSION_MAPPING: '{"private-secret":' });
    const status = await provider.status();
    expect(status).toMatchObject({
      state: "not_configured",
      implemented: true,
      missing_config: ["GOOGLE_ADS_CONVERSION_MAPPING"],
    });
    expect(JSON.stringify(status)).not.toContain("private-secret");
    expect(simulator.calls).toHaveLength(0);
  });
  it("cachea el token y deduplica renovaciones concurrentes", async () => {
    const { provider, simulator } = setup();
    await Promise.all([provider.status(), provider.status()]);
    await provider.getPerformance(q);
    expect(simulator.tokens).toBe(1);
    const oauth = simulator.calls[0]!;
    expect(oauth.body).toMatchObject({ grant_type: "refresh_token", client_id: GOOGLE_ENV.GOOGLE_ADS_CLIENT_ID });
    expect(oauth.headers.has("developer-token")).toBe(false);
  });
  it("renueva el token al vencer; la renovación no queda cacheada indefinidamente", async () => {
    const { provider, simulator } = setup();
    await provider.status();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600001);
    try {
      await provider.status();
      expect(simulator.tokens).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });
  it("invalid_grant devuelve AUTH_ERROR sin copiar la descripción del servidor", async () => {
    const { provider, simulator } = setup();
    simulator.faults.push({
      match: "/token",
      status: 400,
      body: { error: "invalid_grant", error_description: "test-client-secret test-refresh-token" },
    });
    const status = await provider.status();
    expect(status).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
    expect(JSON.stringify(status)).not.toContain("test-client-secret");
    expect(simulator.calls).toHaveLength(1);
  });
  it("firma correctamente el JWT de cuenta de servicio y el sub delegado opcional", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { provider, simulator } = setup({
      GOOGLE_ADS_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "test@project.iam.gserviceaccount.com",
        private_key: privatePem,
      }),
      GOOGLE_ADS_IMPERSONATED_USER: "delegated@example.com",
    });
    expect((await provider.status()).state).toBe("connected");
    const assertion = simulator.calls.find((c) => c.url.hostname === "oauth2.googleapis.com")!.body.assertion as string;
    const [header, payload, signature] = assertion.split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({
      iss: "test@project.iam.gserviceaccount.com",
      sub: "delegated@example.com",
      scope: GOOGLE_ADS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
    });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(
      createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });
});

describe("Google account hierarchy, campaigns and normalization", () => {
  it("una raíz inhabilitada no bloquea cuentas disponibles y conserva el aviso al usar la caché", async () => {
    const simulator = disabledRootSimulator();
    const { provider } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, simulator);
    const onWarning = vi.fn();
    const accounts = await provider.listAccounts({}, { onWarning });
    expect(accounts.map((a) => a.account_id)).toEqual(["1111111111", "2222222222", "3333333333"]);
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0]![0]).toMatchObject({
      code: "ACCESS_DENIED",
      details: { account_id: "9999999999", google_error_codes: ["CUSTOMER_NOT_ENABLED"] },
    });
    const count = simulator.calls.length;
    await provider.listAccounts({}, { onWarning });
    expect(simulator.calls).toHaveLength(count);
    expect(onWarning).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain("test-client-secret");
  });
  it("si todas las raíces están inhabilitadas devuelve el error en vez de aparentar una lista vacía válida", async () => {
    const simulator = disabledRootSimulator();
    const original = simulator.intercept!;
    simulator.intercept = (call) =>
      call.url.pathname.endsWith("customers:listAccessibleCustomers")
        ? Response.json({ resourceNames: ["customers/9999999999"] })
        : original(call);
    const { provider } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, simulator);
    await expect(provider.listAccounts({})).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      details: { account_id: "9999999999" },
    });
  });
  it("descubre muchas raíces con concurrencia limitada y mantiene su orden", async () => {
    const simulator = new GoogleSimulator();
    const ids = Array.from({ length: 6 }, (_, i) => String(4000000000 + i));
    let active = 0;
    let maximum = 0;
    simulator.intercept = (call) => {
      if (call.url.pathname.endsWith("customers:listAccessibleCustomers"))
        return Response.json({ resourceNames: ids.map((id) => `customers/${id}`) });
      if (String(call.body.query).endsWith(" FROM customer"))
        return (async () => {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          return Response.json({
            results: [{ customer: { id: call.url.pathname.split("/")[3], manager: false, status: "ENABLED" } }],
          });
        })();
      return undefined;
    };
    const { provider } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, simulator);
    expect((await provider.listAccounts({})).map((a) => a.account_id)).toEqual(ids);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
  });
  it("reutiliza cuentas ya descubiertas mediante MCC cuando aparecen también entre las raíces", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) => {
      if (call.url.pathname.endsWith("customers:listAccessibleCustomers"))
        return Response.json({
          resourceNames: ["1111111111", "9999999999", "8888888888", "7777777777", "2222222222"].map(
            (id) => `customers/${id}`,
          ),
        });
      if (String(call.body.query).endsWith(" FROM customer")) {
        if (/\/(?:9999999999|8888888888|7777777777)\//.test(call.url.pathname))
          return Response.json(failure("authorizationError", "CUSTOMER_NOT_ENABLED"), { status: 403 });
        if (call.url.pathname.includes("/2222222222/"))
          return Response.json(failure("authorizationError", "USER_PERMISSION_DENIED"), { status: 403 });
      }
      return undefined;
    };
    const { provider } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, simulator);
    const accounts = await provider.listAccounts({});
    expect(accounts.find((a) => a.account_id === "2222222222")).toMatchObject({
      manager_account_id: "1111111111",
      currency: "USD",
    });
    expect(accounts).toHaveLength(3);
  });
  it.each(["campaigns", "performance", "conversions"] as const)(
    "%s conserva las otras cuentas; solicitar explícitamente una inhabilitada sigue fallando",
    async (resource) => {
      const simulator = new GoogleSimulator();
      simulator.intercept = (call) =>
        call.url.pathname.includes("/2222222222/") && String(call.body.query).includes(" FROM campaign")
          ? Response.json(failure("authorizationError", "CUSTOMER_NOT_ENABLED"), { status: 403 })
          : undefined;
      const { provider } = setup({}, simulator);
      const onWarning = vi.fn();
      const request = (accountId?: string) => {
        const options = { onWarning };
        if (resource === "campaigns") return provider.listCampaigns({ account_id: accountId }, options);
        const query = { ...q, account_id: accountId };
        return resource === "performance"
          ? provider.getPerformance(query, options)
          : provider.getConversions(query, options);
      };
      const rows = await request();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.account_id === "3333333333")).toBe(true);
      expect(onWarning).toHaveBeenCalledOnce();
      expect(onWarning.mock.calls[0]![0]).toMatchObject({ details: { account_id: "2222222222" } });
      onWarning.mockClear();
      await expect(request("2222222222")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      expect(onWarning).not.toHaveBeenCalled();
    },
  );
  it("mantiene fatales los errores de permisos que no identifican una cuenta inhabilitada", async () => {
    const { provider, simulator } = setup();
    simulator.faults.push({
      match: "googleAds:search",
      status: 403,
      body: failure("authorizationError", "USER_PERMISSION_DENIED"),
    });
    const onWarning = vi.fn();
    await expect(provider.listAccounts({}, { onWarning })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(onWarning).not.toHaveBeenCalled();
  });
  it("no oculta una aprobación pendiente cuando Google devuelve varios códigos junto a una cuenta inhabilitada", async () => {
    const { provider, simulator } = setup();
    const body = failure("authorizationError", "CUSTOMER_NOT_ENABLED");
    body.error.details[0]!.errors.push({
      errorCode: { authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" },
      message: "upstream message",
    });
    simulator.faults.push({ match: "googleAds:search", status: 403, body });
    const onWarning = vi.fn();
    await expect(provider.listAccounts({}, { onWarning })).rejects.toMatchObject({ code: "ACCESS_REQUIRED" });
    expect(onWarning).not.toHaveBeenCalled();
  });
  it("si todas las cuentas publicitarias están inhabilitadas falla la lectura agregada", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) =>
      String(call.body.query).includes(" FROM campaign")
        ? Response.json(failure("authorizationError", "CUSTOMER_NOT_ENABLED"), { status: 403 })
        : undefined;
    const { provider } = setup({}, simulator);
    await expect(provider.listCampaigns({})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("descubre MCC y cuentas indirectas, con contexto de login y client_id", async () => {
    const { provider, simulator } = setup();
    const accounts = await provider.listAccounts({});
    expect(accounts.map((a) => a.account_id)).toEqual(["1111111111", "2222222222", "3333333333"]);
    expect(accounts[0]!.is_manager).toBe(true);
    expect(accounts[1]).toMatchObject({ client_id: "client-a", currency: "USD", manager_account_id: "1111111111" });
    expect((await provider.listAccounts({ client_id: "client-b" })).map((a) => a.account_id)).toEqual(["3333333333"]);
    expect(simulator.calls.filter((c) => String(c.body.query).includes("FROM customer_client"))).toHaveLength(1);
  });
  it("descubre raíces accesibles sin MCC configurado; ListAccessibleCustomers no envía login", async () => {
    const { provider, simulator } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined });
    expect(await provider.listAccounts({})).toHaveLength(3);
    const accessible = simulator.calls.find((c) => c.url.pathname.includes("listAccessibleCustomers"))!;
    expect(accessible.method).toBe("GET");
    expect(accessible.headers.has("login-customer-id")).toBe(false);
  });
  it("incluye todas las páginas y traduce los estados de campañas", async () => {
    const { provider, simulator } = setup({
      GOOGLE_ADS_DEVELOPER_TOKEN: "legacy-test",
      GOOGLE_ADS_CLOUD_PROJECT: "test-project",
    });
    const campaigns = await provider.listCampaigns({ account_id: "222-222-2222" });
    expect(campaigns.map((c) => c.campaign_status)).toEqual(["active", "paused", "removed"]);
    expect(campaigns.every((c) => c.objective === null)).toBe(true);
    const calls = simulator.calls.filter((c) => String(c.body.query).includes("FROM campaign"));
    expect(calls[1]!.body.pageToken).toBe("second-page");
    expect(calls[0]!.headers.get("developer-token")).toBe("legacy-test");
    expect(calls[0]!.headers.get("x-goog-user-project")).toBe("test-project");
  });
  it("no consulta rendimiento sobre el MCC al pedir todas las cuentas", async () => {
    const { provider, simulator } = setup();
    expect(await provider.getPerformance({ ...q, account_id: undefined })).toHaveLength(2);
    expect(
      simulator.calls
        .filter((c) => String(c.body.query).includes("metrics."))
        .every((c) => !c.url.pathname.includes("/1111111111/")),
    ).toBe(true);
  });
  it("convierte micros, preserva moneda, decimales y tasas originales sin inventar métricas", async () => {
    const { provider } = setup();
    const [row] = await provider.getPerformance(q);
    expect(row).toMatchObject({
      platform: "google",
      client_id: "client-a",
      spend: 25,
      impressions: 1000,
      clicks: 10,
      conversions: 2.5,
      conversion_value: 49.9,
      ctr: 1,
      cpc: 2.5,
      cpm: 25,
      cpa: 10,
      currency: "USD",
      hour: null,
      reach: null,
      frequency: null,
      link_clicks: null,
      video_views: 40,
      video_25: null,
      objective: null,
      source_timezone: "America/Mexico_City",
      raw_metrics: { costMicros: "25000000", videoQuartileP25Rate: 0.4 },
    });
    const synced = (await provider.status()).last_successful_sync;
    expect(synced).not.toBeNull();
    expect(Date.parse(synced!)).toBeGreaterThanOrEqual(Date.parse(row!.extracted_at));
  });
  it("la hora cero es válida y se selecciona únicamente en consultas horarias", async () => {
    const { provider, simulator } = setup();
    const [row] = await provider.getPerformance({ ...q, granularity: "hourly", campaign_id: "123456789012" });
    expect(row!.hour).toBe(0);
    expect(simulator.calls.at(-1)!.body.query).toContain("AND campaign.id = 123456789012");
    expect(simulator.calls.at(-1)!.body.query).toContain("segments.hour");
  });
  it("cero es cero; ausentes, int64 imprecisos y valores inválidos son null", async () => {
    const { provider, simulator } = setup();
    simulator.metricOverrides = {
      clicks: "0",
      conversions: 0,
      impressions: "0",
      costMicros: "0",
      videoTrueviewViews: null,
    };
    expect((await provider.getPerformance(q))[0]).toMatchObject({
      spend: 0,
      clicks: 0,
      conversions: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      video_views: null,
    });
    for (const value of [undefined, null, "", "NaN", "Infinity", " ", "9007199254740993", {}, true])
      expect(googleNumber(value)).toBeNull();
    expect(googleNumber("0")).toBe(0);
    expect(googleNumber("2.5")).toBe(2.5);
  });
  it("convierte acciones sin mezclar secundarias con principales, con mapeo configurable", async () => {
    const { provider } = setup({ GOOGLE_ADS_CONVERSION_MAPPING: '{"987":"OFFLINE_PURCHASE"}' });
    const [row] = await provider.getConversions(q);
    expect(row).toMatchObject({
      source_conversion: "Offline purchase",
      normalized_conversion: "OFFLINE_PURCHASE",
      conversions: 1.5,
      conversion_value: 49.9,
      raw_metrics: { allConversions: 2.5, allConversionsValue: 79.9, conversion_action_category: "PURCHASE" },
    });
  });
  it("categorías oficiales conocidas se normalizan sin requerir mapeo", async () => {
    const { provider } = setup();
    expect((await provider.getConversions(q))[0]!.normalized_conversion).toBe("PURCHASE");
  });
  it("acciones con nombres de propiedades de Object y categorías desconocidas conservan null", async () => {
    const { provider, simulator } = setup();
    simulator.intercept = (call) =>
      String(call.body.query).includes("segments.conversion_action")
        ? Response.json({
            results: [
              {
                campaign: { id: "123" },
                segments: {
                  date: q.date_from,
                  conversionAction: "customers/2222222222/conversionActions/444",
                  conversionActionName: "toString",
                  conversionActionCategory: "UNKNOWN",
                },
                metrics: { conversions: 1, conversionsValue: 0 },
              },
            ],
          })
        : undefined;
    expect((await provider.getConversions(q))[0]!.normalized_conversion).toBeNull();
  });
  it("rechaza paginación repetida sin continuar en un bucle", async () => {
    const { provider, simulator } = setup();
    simulator.repeatPage = true;
    await expect(provider.listCampaigns({ account_id: q.account_id })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(simulator.calls.filter((c) => String(c.body.query).includes("FROM campaign"))).toHaveLength(2);
  });
  it.each(["2026-02-30", "2026-09-01' OR 1=1", "invalid"])("rechaza fecha %s antes de consultar", async (date) => {
    const { provider, simulator } = setup();
    expect(() => provider.getPerformance({ ...q, date_from: date })).toThrow();
    expect(simulator.calls).toHaveLength(0);
  });
  it("rechaza campañas no numéricas, rangos invertidos y demasiado largos", () => {
    expect(() => performanceQuery({ ...q, campaign_id: "123 OR 1=1" })).toThrow();
    expect(() => performanceQuery({ ...q, date_to: "2026-08-01" })).toThrow();
    expect(() => performanceQuery({ ...q, date_to: "2028-08-01" })).toThrow();
  });
});

describe("Google failures and resilience", () => {
  it("fallos temporales de OAuth mantienen el código transitorio", () => {
    expect(googleError(503, { error: "temporarily_unavailable" }).code).toBe("PROVIDER_ERROR");
  });
  it("un 403 con HTML no se convierte en un error transitorio ni se reintenta", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) =>
      call.url.hostname === "googleads.googleapis.com" ? new Response("Blocked", { status: 403 }) : undefined;
    const provider = new GoogleProvider(GOOGLE_ENV, {
      fetch: simulator.fetch,
      retry: { retries: 2, sleep: async () => {} },
    });
    await expect(provider.getPerformance(q)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(simulator.calls.filter((c) => c.url.hostname === "googleads.googleapis.com")).toHaveLength(1);
  });
  it.each([
    ["authorizationError", "USER_PERMISSION_DENIED", "ACCESS_DENIED"],
    ["authorizationError", "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION", "ACCESS_REQUIRED"],
    ["authorizationError", "DEVELOPER_TOKEN_NOT_APPROVED", "ACCESS_REQUIRED"],
    ["authenticationError", "CUSTOMER_NOT_FOUND", "INVALID_REQUEST"],
    ["authenticationError", "OAUTH_TOKEN_REVOKED", "AUTH_ERROR"],
    ["quotaError", "RESOURCE_EXHAUSTED", "RATE_LIMITED"],
    ["queryError", "PROHIBITED_FIELD_COMBINATION_IN_SELECT_CLAUSE", "INVALID_REQUEST"],
  ])("normaliza %s/%s a %s", (family, code, expected) => {
    const err = googleError(403, failure(family, code, "private credential"));
    expect(err.code).toBe(expected);
    expect(err.details).toMatchObject({ google_request_id: "google-request-123", google_error_codes: [code] });
    expect(JSON.stringify(err)).not.toContain("private credential");
  });
  it("respeta Retry-After y reintenta únicamente errores transitorios", async () => {
    const simulator = new GoogleSimulator();
    const sleeps: number[] = [];
    simulator.faults.push({
      match: "googleAds:search",
      status: 429,
      body: failure("quotaError", "RESOURCE_EXHAUSTED"),
      headers: { "retry-after": "2" },
    });
    const provider = new GoogleProvider(GOOGLE_ENV, {
      fetch: simulator.fetch,
      retry: {
        retries: 2,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });
    expect(await provider.getPerformance(q)).toHaveLength(1);
    expect(sleeps).toEqual([2000]);
    simulator.faults.push({
      match: "googleAds:search",
      status: 403,
      body: failure("authorizationError", "USER_PERMISSION_DENIED"),
    });
    await expect(provider.getPerformance(q)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(sleeps).toHaveLength(1);
  });
  it("no adelanta Retry-After largos cuando la operación tiene un deadline mayor", async () => {
    const simulator = new GoogleSimulator();
    const sleeps: number[] = [];
    simulator.faults.push({
      match: "googleAds:search",
      status: 429,
      body: failure("quotaError", "RESOURCE_EXHAUSTED"),
      headers: { "retry-after": "120" },
    });
    const provider = new GoogleProvider(
      { ...GOOGLE_ENV, GOOGLE_ADS_TIMEOUT_MS: "300000" },
      {
        fetch: simulator.fetch,
        retry: {
          retries: 1,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      },
    );
    expect(await provider.getPerformance(q)).toHaveLength(1);
    expect(sleeps).toEqual([120000]);
  });
  it("renueva una vez después de HTTP 401 y no entra en un bucle", async () => {
    const { provider, simulator } = setup();
    simulator.faults.push({
      match: "googleAds:search",
      status: 401,
      body: failure("authenticationError", "OAUTH_TOKEN_EXPIRED"),
    });
    expect(await provider.getPerformance(q)).toHaveLength(1);
    expect(simulator.tokens).toBe(2);
    simulator.faults.push(
      ...[1, 2].map(() => ({
        match: "googleAds:search",
        status: 401,
        body: failure("authenticationError", "OAUTH_TOKEN_EXPIRED"),
      })),
    );
    await expect(provider.getPerformance(q)).rejects.toMatchObject({ code: "AUTH_ERROR" });
    expect(simulator.tokens).toBe(3);
  });
  it("cancela una petición lenta en lugar de dejarla corriendo", async () => {
    const simulator = new GoogleSimulator();
    let aborted = false;
    simulator.intercept = (call) =>
      call.url.hostname === "googleads.googleapis.com"
        ? new Promise((_resolve, reject) => {
            call.signal!.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new DOMException("Stopped", "AbortError"));
              },
              { once: true },
            );
          })
        : undefined;
    const client = new GoogleAdsClient(readGoogleConfig(GOOGLE_ENV).config!, simulator.fetch, { retries: 0 });
    await expect(
      client.search(q.account_id, "SELECT customer.id FROM customer", AbortSignal.timeout(20)),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(aborted).toBe(true);
  });
  it("un circuito abierto evita nuevas peticiones al proveedor caído", async () => {
    const { provider, simulator } = setup();
    simulator.faults.push(
      ...Array.from({ length: 5 }, () => ({
        match: "googleAds:search",
        status: 503,
        body: { error: { status: "UNAVAILABLE" } },
      })),
    );
    for (let i = 0; i < 5; i++)
      await expect(provider.getPerformance(q)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const count = simulator.calls.length;
    await expect(provider.getPerformance(q)).rejects.toMatchObject({ details: { circuit: "OPEN" } });
    expect(simulator.calls).toHaveLength(count);
  });
});

describe("Google API routes and OpenAPI", () => {
  async function withApp(work: (app: Awaited<ReturnType<typeof makeApp>>) => Promise<void>) {
    const { provider } = setup();
    const app = await makeApp({}, { registry: new ProviderRegistry([provider, new MetaProvider({})]) });
    try {
      await work(app);
    } finally {
      await app.close();
    }
  }
  const headers = { "x-api-key": KEY, "x-request-id": "google-test-request" };
  it("devuelve datos y avisos de cuentas inhabilitadas tanto con Google explícito como en el agregado", async () => {
    const { provider } = setup({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, disabledRootSimulator());
    const app = await makeApp({}, { registry: new ProviderRegistry([provider, new MetaProvider({})]) });
    try {
      for (const suffix of ["?provider=google", ""]) {
        const response = await app.inject({ url: "/api/v1/accounts" + suffix, headers });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().data).toHaveLength(3);
        expect(response.json().errors).toContainEqual({
          provider: "google",
          error: expect.objectContaining({
            code: "ACCESS_DENIED",
            request_id: "google-test-request",
            details: expect.objectContaining({
              account_id: "9999999999",
              google_error_codes: ["CUSTOMER_NOT_ENABLED"],
            }),
          }),
        });
        expect(response.body).not.toContain("test-client-secret");
        // Meta sin credenciales no se consulta en el agregado: su estado está en /providers.
        if (!suffix)
          expect(response.json().errors.some((item: { provider: string }) => item.provider === "meta")).toBe(false);
      }
    } finally {
      await app.close();
    }
  });
  it("sirve las cuatro rutas y mantiene request_id", () =>
    withApp(async (app) => {
      for (const resource of ["accounts", "campaigns", "performance", "conversions"]) {
        const extra = ["performance", "conversions"].includes(resource)
          ? "&date_from=2026-09-01&date_to=2026-09-02"
          : "";
        const res = await app.inject({ url: `/api/v1/${resource}?provider=google${extra}`, headers });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json().data.length).toBeGreaterThan(0);
        expect(res.json().request_id).toBe("google-test-request");
      }
    }));
  it("el agregado conserva datos de Google y errores de otros proveedores", () =>
    withApp(async (app) => {
      const res = await app.inject({ url: "/api/v1/accounts", headers });
      expect(res.json().data).toHaveLength(3);
      // Proveedores sin configurar no aparecen como error en el agregado.
      expect(res.json().errors).toEqual([]);
    }));
  it("protege las rutas y valida parámetros antes de consultar", () =>
    withApp(async (app) => {
      expect((await app.inject({ url: "/api/v1/accounts?provider=google" })).statusCode).toBe(401);
      for (const query of [
        "provider=unknown",
        "provider=google&date_from=2026-02-30&date_to=2026-09-01",
        "provider=google&date_from=2026-09-02&date_to=2026-09-01",
      ])
        expect((await app.inject({ url: "/api/v1/performance?" + query, headers })).statusCode).toBe(400);
      const badAccount = await app.inject({ url: "/api/v1/campaigns?provider=google&account_id=123", headers });
      expect(badAccount.statusCode).toBe(400);
    }));
  it("Google sin credenciales devuelve 503 y OpenAPI incluye esquemas y seguridad", async () => {
    const app = await makeApp();
    try {
      const res = await app.inject({ url: "/api/v1/accounts?provider=google", headers });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("NOT_CONFIGURED");
      const docs = (await app.inject("/docs/json")).json();
      expect(docs.paths["/api/v1/performance"].get.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(docs.paths["/api/v1/conversions"]).toBeDefined();
    } finally {
      await app.close();
    }
  });
  it("al vencer el límite de Google la API cancela la petición en curso", async () => {
    const simulator = new GoogleSimulator();
    let aborted = false;
    simulator.intercept = (call) =>
      call.url.hostname === "googleads.googleapis.com"
        ? new Promise((_resolve, reject) => {
            call.signal!.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          })
        : undefined;
    // El límite propio del proveedor manda; sin GOOGLE_ADS_TIMEOUT_MS hereda PROVIDER_TIMEOUT_MS.
    const provider = new GoogleProvider(
      { ...GOOGLE_ENV, GOOGLE_ADS_TIMEOUT_MS: "1000" },
      { fetch: simulator.fetch, retry: { retries: 0 } },
    );
    const app = await makeApp({ providerTimeoutMs: 30 }, { registry: new ProviderRegistry([provider]) });
    try {
      const res = await app.inject({ url: "/api/v1/accounts?provider=google", headers });
      expect(res.statusCode).toBe(504);
      expect(res.json().error.code).toBe("PROVIDER_TIMEOUT");
      expect(aborted).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("OAuth helper", () => {
  it("usa offline, consentimiento, PKCE y estado aleatorio verificado", () => {
    const a = createOAuthRequest("client", "http://127.0.0.1:8089/oauth/google/callback");
    const b = createOAuthRequest("client", "http://127.0.0.1:8089/oauth/google/callback");
    const url = new URL(a.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_ADS_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(a.state).not.toBe(b.state);
    expect(validOAuthState(a.state, a.state)).toBe(true);
    expect(validOAuthState("different", a.state)).toBe(false);
    expect(validOAuthState(null, a.state)).toBe(false);
  });
  it("intercambia el código con el verifier y conserva el refresh token fuera de los logs", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ refresh_token: "test-refresh" }));
    expect(
      await exchangeAuthorizationCode(
        {
          clientId: "id",
          clientSecret: "secret",
          code: "code",
          redirectUri: "http://127.0.0.1:8089/cb",
          verifier: "verifier",
        },
        mock,
      ),
    ).toBe("test-refresh");
    const params = mock.mock.calls[0]![1]!.body as URLSearchParams;
    expect(params.get("code_verifier")).toBe("verifier");
    expect(params.get("grant_type")).toBe("authorization_code");
  });
  it("sin refresh token informa que hay que repetir el consentimiento", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "only-access" }));
    await expect(
      exchangeAuthorizationCode(
        {
          clientId: "id",
          clientSecret: "secret",
          code: "code",
          redirectUri: "http://127.0.0.1/cb",
          verifier: "verifier",
        },
        mock,
      ),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });
  it("al guardar conserva las demás variables y comentarios sin duplicar el token", () => {
    const original = '# comment\nAPI_KEYS="keep-me"\nGOOGLE_ADS_REFRESH_TOKEN=old\n';
    const saved = updateEnvVariable(original, "GOOGLE_ADS_REFRESH_TOKEN", "new$token");
    expect(saved).toBe('# comment\nAPI_KEYS="keep-me"\nGOOGLE_ADS_REFRESH_TOKEN="new$token"\n');
    expect(updateEnvVariable(saved, "GOOGLE_ADS_REFRESH_TOKEN", "new$token")).toBe(saved);
  });
});
