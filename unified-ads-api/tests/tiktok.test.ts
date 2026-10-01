import { describe, expect, it } from "vitest";
import { TikTokProvider } from "../src/providers/tiktok/index.js";
import { TikTokClient } from "../src/providers/tiktok/client.js";
import { readTikTokConfig, tiktokId } from "../src/providers/tiktok/config.js";
import { normalizeCampaign, normalizePerformance, normalizeConversions } from "../src/providers/tiktok/normalize.js";
import { tiktokNumber } from "../src/providers/tiktok/types.js";
import { reportWindows } from "../src/providers/tiktok/queries.js";
import { tiktokError, isTikTokRetryable } from "../src/providers/tiktok/errors.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import type { ApiError } from "../src/utils/errors.js";
import { KEY, makeApp } from "./helpers.js";
import { TikTokSimulator as Sim } from "./tiktok-simulator.js";

const ID = "7000000000000000011",
  OTHER = "7000000000000000022",
  CAMPAIGN = "7000000000000000033";
const query = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const, account_id: ID };
const auth = { "x-api-key": KEY };
function setup(extra: Record<string, string | undefined> = {}, retries = 0) {
  const sim = new Sim(),
    env = { ...sim.env, ...extra };
  const waits: number[] = [];
  const provider = new TikTokProvider(
    { ...env, TIKTOK_RETRIES: String(retries) },
    {
      fetch: sim.fetch,
      retry: {
        sleep: async (ms) => {
          waits.push(ms);
        },
        random: () => 0,
      },
    },
  );
  return { sim, env, provider, waits };
}

describe("TikTok configuración y conexión", () => {
  it("sin credenciales no realiza consultas", async () => {
    const p = new TikTokProvider({});
    expect(await p.status()).toMatchObject({ state: "not_configured", implemented: true });
    await expect(p.listAccounts({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it.each([
    { TIKTOK_APP_ID: "abc" },
    { TIKTOK_ACCESS_TOKEN: "bad\nheader" },
    { TIKTOK_API_VERSION: "v2.0" },
    { TIKTOK_ADVERTISER_IDS: "111/path" },
    { TIKTOK_CLIENT_MAPPING: "[]" },
    { TIKTOK_CONVERSION_MAPPING: '{"invalid_metric":"LEAD"}' },
    { TIKTOK_PRIMARY_CONVERSION_METRIC: "likes" },
    { TIKTOK_PRIMARY_CONVERSION_MAPPING: '{"111":"fake"}' },
    { TIKTOK_CONVERSION_METRICS: "spend,conversion" },
    { TIKTOK_RETRIES: "6" },
    { TIKTOK_TIMEOUT_MS: "0" },
  ])("rechaza variables inválidas sin exponer sus valores: %j", (extra) => {
    const { sim } = setup();
    const config = readTikTokConfig({ ...sim.env, ...extra });
    expect(config.config).toBeNull();
    expect(config.missing).toContain(Object.keys(extra)[0]);
    expect(JSON.stringify(config)).not.toContain(sim.env.TIKTOK_ACCESS_TOKEN);
  });
  it("permite token con cuentas explícitas sin secret de discovery", async () => {
    const { provider, sim } = setup({
      TIKTOK_APP_ID: undefined,
      TIKTOK_APP_SECRET: undefined,
      TIKTOK_ADVERTISER_IDS: `${ID},${ID}`,
    });
    expect(provider.isConfigured()).toBe(true);
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(sim.calls.every((c) => c.path === "advertiser/info/")).toBe(true);
    expect(await provider.status()).toMatchObject({ state: "connected" });
  });
  it("valida conexión real del transporte y nunca expone secretos", async () => {
    const { provider, sim } = setup();
    const status = await provider.status();
    expect(status).toMatchObject({ state: "connected", configured: true, last_successful_sync: null });
    expect(sim.calls.map((c) => c.path)).toEqual(["oauth2/advertiser/get/", "advertiser/info/"]);
    expect(JSON.stringify(status)).not.toContain(sim.env.TIKTOK_ACCESS_TOKEN);
    sim.handler = () => Sim.json({ code: 0 });
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "PROVIDER_ERROR" } });
  });
  it("un token denegado sigue comprobándose aunque haya caché de cuentas", async () => {
    const { provider, sim } = setup();
    await provider.listAccounts({});
    sim.handler = () => Sim.error(40105);
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
  });
});

describe("TikTok cuentas y campañas", () => {
  it("mantiene IDs de 64 bits, moneda y zona del reporte; filtra clientes", async () => {
    const { provider, sim } = setup();
    const accounts = await provider.listAccounts({ client_id: "cliente-a" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      account_id: ID,
      currency: "MXN",
      timezone: "Etc/GMT+6",
      client_id: "cliente-a",
      manager_account_id: "7000000000000000099",
    });
    accounts[0]!.account_name = "mutated";
    expect((await provider.listAccounts({}))[0]!.account_name).toBe("Cuenta TikTok");
    expect(await provider.listAccounts({ client_id: "missing" })).toEqual([]);
    expect(sim.calls.filter((c) => c.path === "oauth2/advertiser/get/")).toHaveLength(1);
    expect(await provider.listCampaigns({ account_id: ID, client_id: "cliente-b" })).toEqual([]);
  });
  it("pagina campañas e incluye pausadas y eliminadas", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) => {
      if (!url.pathname.endsWith("/campaign/get/")) return;
      const page = Number(url.searchParams.get("page"));
      expect(JSON.parse(url.searchParams.get("filtering")!)).toEqual({ primary_status: "STATUS_ALL" });
      return Sim.list(
        [
          {
            ...sim.campaign,
            campaign_id: page === 1 ? CAMPAIGN : "7000000000000000044",
            secondary_status: page === 1 ? "CAMPAIGN_STATUS_ENABLE" : "CAMPAIGN_STATUS_DELETE",
          },
        ],
        page,
        2,
      );
    };
    const campaigns = await provider.listCampaigns({ account_id: ID });
    expect(campaigns.map((c) => c.campaign_status)).toEqual(["active", "removed"]);
  });
  it("no declara activas campañas con problemas de entrega", async () => {
    const { provider, sim } = setup();
    const a = (await provider.listAccounts({}))[0]!;
    expect(
      normalizeCampaign({ ...sim.campaign, secondary_status: "CAMPAIGN_STATUS_BUDGET_EXCEED" }, a).campaign_status,
    ).toBe("unknown");
    expect(normalizeCampaign({ ...sim.campaign, secondary_status: "CAMPAIGN_STATUS_DISABLE" }, a).campaign_status).toBe(
      "paused",
    );
  });
  it("preserva cuentas accesibles y avisa sobre permisos de otra cuenta", async () => {
    const { provider, sim } = setup({ TIKTOK_ADVERTISER_IDS: `${ID},${OTHER}` });
    sim.handler = (url) =>
      url.pathname.endsWith("/advertiser/info/") && url.searchParams.get("advertiser_ids")!.includes(OTHER)
        ? Sim.error(40001)
        : undefined;
    const warnings: ApiError[] = [];
    expect(await provider.listAccounts({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "ACCESS_DENIED", details: { account_id: OTHER } });
    await expect(provider.listCampaigns({ account_id: OTHER })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("una consulta global conserva campañas de otras cuentas si una falla", async () => {
    const { provider, sim } = setup({ TIKTOK_ADVERTISER_IDS: `${ID},${OTHER}` });
    sim.handler = (url) =>
      url.pathname.endsWith("/campaign/get/") && url.searchParams.get("advertiser_id") === OTHER
        ? Sim.error(40001)
        : undefined;
    const warnings: ApiError[] = [];
    expect(await provider.listCampaigns({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ACCESS_DENIED");
  });
  it("si ninguna cuenta tiene permiso devuelve error", async () => {
    const { provider, sim } = setup({ TIKTOK_ADVERTISER_IDS: ID });
    sim.handler = () => Sim.error(40001);
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("no oculta errores de parámetros como si fueran permisos parciales", async () => {
    const { provider, sim } = setup({ TIKTOK_ADVERTISER_IDS: `${ID},${OTHER}` });
    sim.handler = (url) =>
      url.pathname.endsWith("/advertiser/info/") && url.searchParams.get("advertiser_ids")!.includes(OTHER)
        ? Sim.error(40002)
        : undefined;
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("rechaza cuentas inesperadas y campañas repetidas", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/advertiser/info/")
        ? Sim.ok({ list: [{ ...sim.account, advertiser_id: OTHER }] })
        : undefined;
    await expect(provider.listCampaigns({ account_id: ID })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    sim.handler = (url) =>
      url.pathname.endsWith("/campaign/get/") ? Sim.list([sim.campaign, sim.campaign]) : undefined;
    await expect(provider.listCampaigns({ account_id: ID })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("TikTok métricas y conversiones", () => {
  it("normaliza métricas y deriva el CPA de optimization conversion", async () => {
    const { provider, sim } = setup();
    const row = (await provider.getPerformance(query))[0]!;
    expect(row).toMatchObject({
      campaign_id: CAMPAIGN,
      date: query.date_from,
      hour: null,
      spend: 100.5,
      impressions: 1000,
      clicks: 20,
      link_clicks: 20,
      conversions: 5,
      cpa: 20.1,
      ctr: 2,
      cpc: 5.025,
      cpm: 100.5,
      conversion_value: null,
      video_100: 10,
    });
    const params = sim.calls.find((c) => c.path === "report/integrated/get/")!.params;
    expect(JSON.parse(params.get("dimensions")!)).toEqual(["campaign_id", "stat_time_day"]);
    const filters = JSON.parse(params.get("filtering")!);
    expect(filters[0].filter_value).toBe('["STATUS_ALL"]');
  });
  it("usa una conversión elegida por cuenta y el valor correcto de compras", async () => {
    const { provider, sim } = setup({
      TIKTOK_PRIMARY_CONVERSION_MAPPING: `{"${ID}":"complete_payment"}`,
      TIKTOK_PRIMARY_CONVERSION_METRIC: "form",
    });
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      conversions: 2,
      conversion_value: 800,
      cpa: 50.25,
    });
    const requested = JSON.parse(sim.calls.find((c) => c.path === "report/integrated/get/")!.params.get("metrics")!);
    expect(requested).toContain("total_complete_payment_rate");
    expect(requested).not.toContain("form");
  });
  it("devuelve acciones individuales sin sumar optimization y compras", async () => {
    const { provider } = setup();
    const conversions = await provider.getConversions(query);
    expect(conversions.find((c) => c.source_conversion === "conversion")).toMatchObject({
      normalized_conversion: null,
      conversions: 5,
      conversion_value: null,
      raw_metrics: { is_primary: true, overlapping_action_types: true },
    });
    expect(conversions.find((c) => c.source_conversion === "complete_payment")).toMatchObject({
      normalized_conversion: "PURCHASE",
      conversions: 2,
      conversion_value: 800,
    });
    expect(conversions.find((c) => c.source_conversion === "form")!.normalized_conversion).toBe("LEAD");
  });
  it("permite limitar métricas y mapear categorías sin inferir WhatsApp", async () => {
    const { provider } = setup({
      TIKTOK_CONVERSION_METRICS: "form",
      TIKTOK_CONVERSION_MAPPING: '{"conversion":"CUSTOM_GOAL"}',
    });
    const rows = await provider.getConversions(query);
    expect(rows.map((c) => c.source_conversion)).toEqual(["form", "conversion"]);
    expect(rows[1]!.normalized_conversion).toBe("CUSTOM_GOAL");
  });
  it("divide 31 días en bloques inclusivos de 30 y 1 sin superposición", async () => {
    const { provider, sim } = setup();
    const rows = await provider.getPerformance({ ...query, date_from: "2026-08-30", date_to: "2026-09-29" });
    expect(rows).toHaveLength(2);
    const ranges = sim.calls
      .filter((c) => c.path === "report/integrated/get/")
      .map((c) => [c.params.get("start_date"), c.params.get("end_date")]);
    expect(ranges).toEqual([
      ["2026-08-30", "2026-09-28"],
      ["2026-09-29", "2026-09-29"],
    ]);
  });
  it("divide horas por día y preserva medianoche y la zona de la cuenta", async () => {
    const { provider, sim } = setup();
    const rows = await provider.getPerformance({ ...query, date_from: "2026-09-28", granularity: "hourly" });
    expect(rows.map((r) => [r.date, r.hour])).toEqual([
      ["2026-09-28", 0],
      ["2026-09-29", 0],
    ]);
    expect(rows[0]).toMatchObject({ reach: null, frequency: null, source_timezone: "Etc/GMT+6" });
    for (const c of sim.calls.filter((c) => c.path === "report/integrated/get/")) {
      expect(c.params.get("start_date")).toBe(c.params.get("end_date"));
      expect(JSON.parse(c.params.get("metrics")!)).not.toContain("reach");
    }
    expect((await provider.getConversions({ ...query, granularity: "hourly" }))[0]!.hour).toBe(0);
  });
  it("pagina reportes sin repetir filas", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) => {
      if (!url.pathname.endsWith("/report/integrated/get/")) return;
      const page = Number(url.searchParams.get("page"));
      return Sim.list(
        [
          {
            ...sim.report,
            dimensions: { campaign_id: page === 1 ? CAMPAIGN : "7000000000000000044", stat_time_day: query.date_from },
          },
        ],
        page,
        2,
      );
    };
    expect(await provider.getPerformance(query)).toHaveLength(2);
  });
  it("los marcadores de métricas faltantes quedan null y cero no produce Infinity", async () => {
    const { provider, sim, env } = setup();
    const a = (await provider.listAccounts({}))[0]!;
    const config = readTikTokConfig(env).config!;
    const row = normalizePerformance(
      {
        ...sim.report,
        metrics: { spend: "0", impressions: "0", clicks: "0", conversion: "0", reach: "-", video_play_actions: "<5" },
      },
      a,
      query,
      config,
      "now",
    );
    expect(row).toMatchObject({
      conversions: 0,
      cpa: null,
      ctr: null,
      cpc: null,
      cpm: null,
      reach: null,
      video_views: null,
    });
    expect(
      normalizeConversions({ ...sim.report, metrics: { form: "-", complete_payment: "0" } }, a, query, config, "now"),
    ).toMatchObject([{ conversions: null }, { conversions: 0 }].reverse());
  });
  it.each([null, undefined, "", "-", "<5", "NaN", "Infinity", "-1", true, "9007199254740993"])(
    "métrica no fiable no se convierte a cero: %s",
    (v) => expect(tiktokNumber(v)).toBeNull(),
  );
  it.each(["2026-09-29 24:00:00", "2026-09-29 00:30:00", "2026-02-30 00:00:00", "2026-09-30 00:00:00"])(
    "rechaza hora/fecha incompatible %s",
    async (raw) => {
      const { provider, sim } = setup();
      sim.handler = (url) =>
        url.pathname.endsWith("/report/integrated/get/")
          ? Sim.list([{ ...sim.report, dimensions: { campaign_id: CAMPAIGN, stat_time_hour: raw } }])
          : undefined;
      await expect(provider.getPerformance({ ...query, granularity: "hourly" })).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
      });
    },
  );
  it("filtra campaña en el contrato y verifica que la respuesta la respete", async () => {
    const { provider, sim } = setup();
    await provider.getPerformance({ ...query, campaign_id: CAMPAIGN });
    const filters = JSON.parse(sim.calls.find((c) => c.path === "report/integrated/get/")!.params.get("filtering")!);
    expect(filters[1]).toEqual({
      field_name: "campaign_ids",
      filter_type: "IN",
      filter_value: JSON.stringify([CAMPAIGN]),
    });
    await expect(provider.getPerformance({ ...query, campaign_id: "7000000000000000044" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
  it("rechaza respuesta fuera del bloque solicitado y duplicados de reporte", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/report/integrated/get/") ? Sim.list([sim.report, sim.report]) : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    sim.handler = (url) =>
      url.pathname.endsWith("/report/integrated/get/")
        ? Sim.list([{ ...sim.report, dimensions: { campaign_id: CAMPAIGN, stat_time_day: "2026-09-29" } }])
        : undefined;
    await expect(provider.getPerformance({ ...query, date_from: "2026-08-30" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
  it("informa truncamiento y métricas UV ausentes conservando datos", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/report/integrated/get/")
        ? Sim.list([sim.report], 1, 1, {
            extra_info: { search_ads_throttle: "tiktok-test-token-private", uv_invalid: "private vendor message" },
          })
        : undefined;
    const warnings: ApiError[] = [];
    expect(await provider.getPerformance(query, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings.map((w) => w.details)).toEqual([
      { provider: "tiktok", limitation: "search_ads_throttle", partial: true },
      { provider: "tiktok", limitation: "uv_invalid", partial: true },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(sim.env.TIKTOK_ACCESS_TOKEN);
  });
  it("valida fechas e IDs antes de la red", async () => {
    const { provider, sim } = setup();
    await expect(provider.getPerformance({ ...query, date_from: "2026-02-30" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(provider.getPerformance({ ...query, account_id: "1/../../" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(() => reportWindows({ ...query, date_from: "2025-01-01" })).toThrow();
    expect(() => tiktokId("01")).toThrow();
    expect(sim.calls).toHaveLength(0);
  });
});

describe("TikTok errores, reintentos y límites", () => {
  it("el código de TikTok tiene prioridad sobre HTTP al clasificar y reintentar", () => {
    expect(tiktokError(403, { code: 40133 }, new Headers()).code).toBe("RATE_LIMITED");
    const service = tiktokError(400, { code: 50000 }, new Headers());
    expect(service.code).toBe("PROVIDER_ERROR");
    expect(isTikTokRetryable(service)).toBe(true);
    expect(isTikTokRetryable(tiktokError(500, { code: 20001 }, new Headers()))).toBe(false);
  });
  it.each([
    [40102, "AUTH_ERROR"],
    [40105, "AUTH_ERROR"],
    [40001, "ACCESS_DENIED"],
    [40002, "INVALID_REQUEST"],
    [40016, "RATE_LIMITED"],
    [40133, "RATE_LIMITED"],
    [50000, "PROVIDER_ERROR"],
    [20001, "PROVIDER_ERROR"],
  ])("HTTP 200 con código %s no es éxito", async (code, expected) => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.error(Number(code));
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: expected });
    expect(JSON.stringify(await provider.status())).not.toContain(sim.env.TIKTOK_ACCESS_TOKEN);
  });
  it("reintenta errores transitorios y respeta Retry-After", async () => {
    const { provider, sim, waits } = setup({}, 2);
    let n = 0;
    sim.handler = () => (n++ === 0 ? Sim.error(40133, 200, { "Retry-After": "2" }) : undefined);
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(waits).toEqual([2000]);
  });
  it("no reintenta token revocado, permisos ni respuesta parcial", async () => {
    for (const code of [40105, 40001, 40002, 20001]) {
      const { provider, sim, waits } = setup({}, 2);
      sim.handler = () => Sim.error(code);
      await expect(provider.listAccounts({})).rejects.toMatchObject({ code: expect.any(String) });
      expect(waits).toEqual([]);
      expect(sim.calls).toHaveLength(1);
    }
  });
  it("no espera ni reintenta cuando Retry-After excede el tiempo disponible", async () => {
    const { provider, sim, waits } = setup({}, 2);
    sim.handler = () => Sim.error(40016, 200, { "Retry-After": "60" });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfter: 60 });
    expect(waits).toEqual([]);
  });
  it("tiene timeout y permite cancelación del caller", async () => {
    const { sim } = setup();
    sim.handler = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
      );
    const provider = new TikTokProvider(sim.env, { fetch: sim.fetch, timeoutMs: 1000 });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    const controller = new AbortController();
    controller.abort();
    const count = sim.calls.length;
    await expect(provider.listAccounts({}, { signal: controller.signal })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(sim.calls.length).toBe(count);
  });
  it("rechaza redirecciones, rutas externas y parámetros de token", async () => {
    const { env, sim } = setup();
    const client = new TikTokClient(readTikTokConfig(env).config!, sim.fetch);
    const signal = AbortSignal.timeout(1000);
    await expect(client.get("https://evil.example/", {}, signal)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(client.get("campaign/get/", { access_token: "private" }, signal)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(sim.calls).toHaveLength(0);
    sim.handler = () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    await expect(client.get("campaign/get/", {}, signal)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it.each([
    { page: 2, total_page: 2, page_size: 1000 },
    { page: 1, total_page: -1, page_size: 1000 },
    { page: 1, total_page: 1001, page_size: 1000 },
    { page: 1, total_page: 1, page_size: 0 },
  ])("rechaza paginación incompatible %j", async (page_info) => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/campaign/get/") ? Sim.ok({ list: [sim.campaign], page_info }) : undefined;
    await expect(provider.listCampaigns({ account_id: ID })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("abre el circuito tras fallos de servicio consecutivos", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.error(50000);
    for (let i = 0; i < 6; i++)
      await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(5);
  });
});

describe("TikTok rutas de la API", () => {
  it("sirve datos autenticados y conserva errores de otros proveedores", async () => {
    const { provider } = setup();
    const app = await makeApp({}, { registry: new ProviderRegistry([new GoogleProvider({}), provider]) });
    try {
      const url = `/api/v1/performance?provider=tiktok&account_id=${ID}&date_from=2026-09-29&date_to=2026-09-29`;
      expect((await app.inject({ url })).statusCode).toBe(401);
      const performance = await app.inject({ url, headers: auth });
      expect(performance.statusCode).toBe(200);
      expect(performance.json().data[0]).toMatchObject({ platform: "tiktok", conversions: 5, cpa: 20.1 });
      const aggregate = await app.inject({ url: "/api/v1/accounts", headers: auth });
      expect(aggregate.json().data).toHaveLength(1);
      expect(aggregate.json().errors[0]).toMatchObject({ provider: "google", error: { code: "NOT_CONFIGURED" } });
      const conversions = await app.inject({ url: url.replace("performance", "conversions"), headers: auth });
      expect(conversions.statusCode).toBe(200);
      expect(conversions.json().data.length).toBeGreaterThan(1);
      expect(
        (await app.inject({ url: `/api/v1/campaigns?provider=tiktok&account_id=${ID}`, headers: auth })).json().data[0]
          .campaign_id,
      ).toBe(CAMPAIGN);
    } finally {
      await app.close();
    }
  });
  it("los errores usan HTTP estándar y ocultan credenciales del proveedor", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.error(40105);
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      const res = await app.inject({ url: "/api/v1/accounts?provider=tiktok", headers: auth });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("AUTH_ERROR");
      expect(res.body).not.toContain(sim.env.TIKTOK_ACCESS_TOKEN);
      expect(res.body).not.toContain(sim.env.TIKTOK_APP_SECRET);
    } finally {
      await app.close();
    }
  });
});
