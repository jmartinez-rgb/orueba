import { describe, expect, it } from "vitest";
import { MetaProvider } from "../src/providers/meta/index.js";
import { MetaClient } from "../src/providers/meta/client.js";
import { readMetaConfig } from "../src/providers/meta/config.js";
import { metaError } from "../src/providers/meta/errors.js";
import { metaNumber } from "../src/providers/meta/types.js";
import { HOUR_FIELD } from "../src/providers/meta/queries.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import type { ApiError } from "../src/utils/errors.js";
import { KEY, makeApp } from "./helpers.js";
import { MetaSimulator as Sim } from "./meta-simulator.js";

const query = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const, account_id: "111" };
const auth = { "x-api-key": KEY };
function setup(extra: Record<string, string | undefined> = {}) {
  const sim = new Sim();
  const env = { ...sim.env, ...extra };
  return { sim, env, provider: new MetaProvider(env, { fetch: sim.fetch }) };
}

describe("Meta configuración y conexión", () => {
  it("status no declara conexión con una respuesta mal formada", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.json({});
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "PROVIDER_ERROR" } });
  });
  it("sin token no se conecta ni llama a la red", async () => {
    const provider = new MetaProvider({});
    expect(await provider.status()).toMatchObject({
      state: "not_configured",
      implemented: true,
      missing_config: ["META_ACCESS_TOKEN"],
    });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it.each([
    { META_API_VERSION: "v99.0" },
    { META_AD_ACCOUNT_IDS: "111/insights" },
    { META_BUSINESS_IDS: "abc" },
    { META_CLIENT_MAPPING: "[]" },
    { META_PRIMARY_CONVERSION_MAPPING: '{"111":"bad/action"}' },
    { META_TIMEOUT_MS: "-1" },
    { META_RETRIES: "9" },
    { META_ACCESS_TOKEN: "bad\nheader" },
  ])("valida sin revelar una configuración incorrecta: %j", (extra) => {
    const { provider } = setup(extra);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.missingConfig()).toContain(Object.keys(extra)[0]);
  });
  it("v26 por defecto, token comprobado y status no inventa sincronización", async () => {
    const { provider, sim } = setup();
    expect(await provider.status()).toMatchObject({
      state: "connected",
      configured: true,
      implemented: true,
      last_successful_sync: null,
    });
    expect(sim.calls[0]?.path).toBe("/v26.0/me/adaccounts");
    await provider.listAccounts({});
    expect(await provider.status()).toMatchObject({ state: "connected", last_successful_sync: expect.any(String) });
  });
  it("token vencido reporta permiso denegado y no se renueva con el mismo token", async () => {
    const { provider, sim } = setup({ META_RETRIES: "3" });
    sim.handler = () => Sim.error(190);
    const result = await provider.status();
    expect(result).toMatchObject({ state: "permission_denied", last_error: { code: "AUTH_ERROR" } });
    expect(JSON.stringify(result)).not.toContain(sim.env.META_ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(sim.env.META_APP_SECRET);
    expect(sim.calls).toHaveLength(1);
  });
  it("IDs fijados permiten validar un token de usuario del sistema sin /me", async () => {
    const { provider, sim } = setup({ META_AD_ACCOUNT_IDS: "act_111" });
    expect(await provider.status()).toMatchObject({ state: "connected" });
    expect(sim.calls.map((call) => call.path)).toEqual(["/v26.0/act_111"]);
  });
  it("cliente sin APP_SECRET sigue usando Bearer y no agrega un proof ficticio", async () => {
    const config = readMetaConfig({ META_ACCESS_TOKEN: "synthetic-token", META_RETRIES: "0" }).config!;
    const client = new MetaClient(config, async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
      expect(new URL(String(url)).searchParams.has("appsecret_proof")).toBe(false);
      return Sim.json({ data: [] });
    });
    expect(await client.list("me/adaccounts", {}, AbortSignal.timeout(1000))).toEqual([]);
  });
});

describe("Meta cuentas y campañas", () => {
  it("normaliza cuenta, moneda, zona, Business y filtro interno", async () => {
    const { provider } = setup({ META_INCLUDE_BUSINESS_METADATA: "true" });
    expect(await provider.listAccounts({ client_id: "cliente-a" })).toEqual([
      expect.objectContaining({
        account_id: "111",
        manager_account_id: "999",
        currency: "MXN",
        timezone: "America/Mexico_City",
        is_manager: false,
        client_id: "cliente-a",
        status: "1",
      }),
    ]);
    expect(await provider.listAccounts({ client_id: "otro" })).toEqual([]);
  });
  it("ads_read permite cuentas sin pedir metadatos que exigen business_management", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.searchParams.get("fields")?.split(",").includes("business") ? Sim.error(100) : undefined;
    const accounts = await provider.listAccounts({});
    expect(accounts[0]).toMatchObject({ account_id: "111", manager_account_id: null });
    expect((await provider.listCampaigns({ account_id: "111" }))[0]).toMatchObject({ campaign_id: "333" });
  });
  it("metadatos opcionales denegados indican business_management, sin filtrar credenciales", async () => {
    const { provider, sim } = setup({ META_INCLUDE_BUSINESS_METADATA: "true" });
    sim.handler = () =>
      Sim.json(
        {
          error: {
            code: 100,
            message: `This field requires business_management permission ${sim.env.META_ACCESS_TOKEN}`,
          },
        },
        400,
      );
    await expect(provider.listAccounts({})).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      details: { required_permission: "business_management" },
    });
    expect((await provider.status()).last_error?.message).not.toContain(sim.env.META_ACCESS_TOKEN);
  });
  it("descubre cuentas propias/compartidas de Business sin duplicarlas", async () => {
    const { provider, sim } = setup({ META_BUSINESS_IDS: "999" });
    const accounts = await provider.listAccounts({});
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.manager_account_id).toBe("999");
    expect(sim.calls.map((call) => call.path)).toEqual([
      "/v26.0/999/owned_ad_accounts",
      "/v26.0/999/client_ad_accounts",
    ]);
  });
  it("un negocio con cuentas compartidas no se presume propietario", async () => {
    const { provider, sim } = setup({ META_BUSINESS_IDS: "999" });
    sim.handler = (url) => (url.pathname.endsWith("/owned_ad_accounts") ? Sim.json({ data: [] }) : undefined);
    expect((await provider.listAccounts({}))[0]?.manager_account_id).toBeNull();
  });
  it("paginación reconstruye la misma ruta sin seguir next ni filtrar token", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.searchParams.get("after")
        ? Sim.json({ data: [{ ...sim.account, id: "act_222", account_id: "222" }] })
        : Sim.json({
            data: [sim.account],
            paging: { next: "https://evil.example/steal?access_token=secret", cursors: { after: "cursor-page2" } },
          });
    expect((await provider.listAccounts({})).map((a) => a.account_id)).toEqual(["111", "222"]);
    expect(sim.calls[1]?.params.get("after")).toBe("cursor-page2");
    expect(sim.calls.every((c) => c.path === "/v26.0/me/adaccounts")).toBe(true);
  });
  it("rechaza un cursor repetido", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.json({ data: [sim.account], paging: { next: "next", cursors: { after: "repeat" } } });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(2);
  });
  it("paginación mal formada no puede producir datos completos silenciosamente", async () => {
    const { provider, sim } = setup();
    sim.handler = () =>
      Sim.json({ data: [sim.account], paging: { next: { invalid: true }, cursors: { after: "cursor" } } });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(1);
  });
  it("acepta act_ al consultar y respeta el estado efectivo de campañas", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/campaigns")
        ? Sim.json({
            data: [
              { ...sim.campaign, effective_status: "PAUSED" },
              { ...sim.campaign, id: "444", effective_status: "ARCHIVED" },
            ],
          })
        : undefined;
    const campaigns = await provider.listCampaigns({ account_id: "act_111" });
    expect(campaigns.map((c) => c.campaign_status)).toEqual(["paused", "removed"]);
    expect(campaigns[0]).toMatchObject({ objective: "OUTCOME_SALES", source_status: "PAUSED", platform: "meta" });
  });
  it("cache de cuentas no elude validación de token en status", async () => {
    const { provider, sim } = setup();
    await provider.listAccounts({});
    await provider.listAccounts({});
    expect(sim.calls).toHaveLength(1);
    sim.handler = () => Sim.error(190);
    expect(await provider.status()).toMatchObject({ state: "permission_denied" });
  });
});

describe("Meta Insights y conversiones", () => {
  it("reacciones y bloqueos de onsite_conversion no se confunden con conversiones", async () => {
    const { provider, sim } = setup();
    sim.insight.actions!.push(
      { action_type: "onsite_conversion.post_net_like", value: "-3" },
      { action_type: "onsite_conversion.messaging_block", value: "1" },
    );
    const rows = await provider.getConversions(query);
    expect(
      rows.some(
        (r) => r.source_conversion.includes("post_net_like") || r.source_conversion.includes("messaging_block"),
      ),
    ).toBe(false);
    const [performance] = await provider.getPerformance(query);
    expect(performance?.raw_metrics.actions).toEqual(sim.insight.actions);
  });
  it("un mapeo explícito puede seleccionar una acción de engagement para otro caso de uso", async () => {
    const { provider, sim } = setup({ META_CONVERSION_MAPPING: '{"onsite_conversion.post_save":"SAVE"}' });
    sim.insight.actions!.push({ action_type: "onsite_conversion.post_save", value: "3" });
    expect(
      (await provider.getConversions(query)).find((r) => r.source_conversion === "onsite_conversion.post_save"),
    ).toMatchObject({ normalized_conversion: "SAVE", conversions: 3 });
  });
  it("moneda original, métricas derivadas, acción primaria y vídeos", async () => {
    const { provider, sim } = setup();
    const [row] = await provider.getPerformance(query);
    expect(row).toMatchObject({
      spend: 100.5,
      impressions: 1000,
      reach: 500,
      frequency: 2,
      clicks: 20,
      link_clicks: 15,
      conversions: 2,
      conversion_value: 800,
      ctr: 2,
      cpc: 5.025,
      cpm: 100.5,
      cpa: 50.25,
      currency: "MXN",
      hour: null,
      campaign_status: "active",
      objective: "OUTCOME_SALES",
      video_views: 100,
      video_25: 80,
      video_50: 50,
      video_75: 30,
      video_100: 10,
    });
    expect(row?.raw_metrics.actions).toEqual(sim.insight.actions);
    const params = sim.calls.find((c) => c.path.endsWith("/insights"))!.params;
    expect(params.get("time_range")).toBe('{"since":"2026-09-29","until":"2026-09-29"}');
    expect(params.get("time_increment")).toBe("1");
    expect(params.get("use_unified_attribution_setting")).toBe("true");
    expect(params.get("action_report_time")).toBe("impression");
  });
  it("sin acción principal mantiene conversiones y CPA en null", async () => {
    const { provider } = setup({ META_PRIMARY_CONVERSION_ACTION: "" });
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      conversions: null,
      conversion_value: null,
      cpa: null,
    });
  });
  it("acción principal por cuenta y conversión ausente no se inventa", async () => {
    const { provider } = setup({ META_PRIMARY_CONVERSION_MAPPING: '{"act_111":"lead"}' });
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      conversions: null,
      conversion_value: null,
      cpa: null,
    });
  });
  it("hora cero conservada, únicos y conversiones externas no disponibles", async () => {
    const { provider, sim } = setup();
    const warnings: ApiError[] = [];
    const [row] = await provider.getPerformance(
      { ...query, granularity: "hourly" },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(row).toMatchObject({
      hour: 0,
      reach: null,
      frequency: null,
      conversions: null,
      conversion_value: null,
      cpa: null,
    });
    expect(warnings[0]?.details).toMatchObject({ limitation: "hourly_breakdown" });
    const params = sim.calls.find((c) => c.path.endsWith("/insights"))!.params;
    expect(params.get("breakdowns")).toBe(HOUR_FIELD);
    expect(params.get("fields")).not.toContain(",reach");
    expect(params.get("fields")).not.toContain("frequency");
  });
  it("mantiene fuentes solapadas en filas separadas y no equipara mensajería a WhatsApp", async () => {
    const { provider } = setup({ META_CONVERSION_MAPPING: "" });
    const rows = await provider.getConversions(query);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.source_conversion.includes("messaging"))).toMatchObject({ normalized_conversion: null });
    expect(rows.find((r) => r.source_conversion.includes("fb_pixel_purchase"))).toMatchObject({
      normalized_conversion: "PURCHASE",
      conversions: 2,
      conversion_value: 800,
      raw_metrics: { is_primary: true, overlapping_action_types: true },
    });
    expect(rows.some((r) => r.source_conversion === "link_click")).toBe(false);
  });
  it("mapping explícito de contacto y filtros de campaña", async () => {
    const { provider, sim } = setup();
    const rows = await provider.getConversions({ ...query, campaign_id: "333" });
    expect(rows.find((r) => r.source_conversion.includes("messaging"))).toMatchObject({
      normalized_conversion: "CONTACT",
      conversions: 4,
    });
    const params = sim.calls.find((c) => c.path.endsWith("/insights"))!.params;
    expect(JSON.parse(params.get("filtering")!)).toEqual([{ field: "campaign.id", operator: "IN", value: ["333"] }]);
  });
  it("conversiones externas por hora omitidas, las internas conservan su hora", async () => {
    const { provider } = setup();
    const rows = await provider.getConversions({ ...query, granularity: "hourly" });
    expect(rows.every((r) => r.hour === 0)).toBe(true);
    expect(
      rows.some((r) => r.source_conversion.startsWith("offsite_conversion") || r.source_conversion.startsWith("omni_")),
    ).toBe(false);
  });
  it("maneja respuestas sin métricas y denominadores cero", async () => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/insights")
        ? Sim.json({
            data: [
              {
                account_id: "111",
                campaign_id: "333",
                date_start: query.date_from,
                date_stop: query.date_to,
                impressions: "0",
                spend: "0",
                clicks: "0",
              },
            ],
          })
        : undefined;
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      reach: null,
      conversions: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      video_views: null,
    });
  });
  it.each([{ date_from: "2026-02-30" }, { date_to: "2026-09-01" }, { campaign_id: "1?token=x" }])(
    "rechaza parámetros inválidos antes de enviar: %j",
    async (bad) => {
      const { provider, sim } = setup();
      await expect(provider.getPerformance({ ...query, ...bad })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(sim.calls).toHaveLength(0);
    },
  );
  it.each([
    { [HOUR_FIELD]: "24:00:00 - 24:59:59" },
    { [HOUR_FIELD]: undefined },
    { account_id: "222" },
    { date_stop: "2026-09-30" },
  ])("rechaza datos incompatibles: %j", async (bad) => {
    const { provider, sim } = setup();
    sim.handler = (url) =>
      url.pathname.endsWith("/insights")
        ? Sim.json({ data: [{ ...sim.insight, [HOUR_FIELD]: "00:00:00 - 00:59:59", ...bad }] })
        : undefined;
    await expect(provider.getPerformance({ ...query, granularity: "hourly" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
  it("números inválidos, vacíos, infinito o enteros inseguros se vuelven null", () => {
    for (const value of ["", " ", "NaN", "Infinity", true, "9007199254740993"]) expect(metaNumber(value)).toBeNull();
    expect(metaNumber("0")).toBe(0);
    expect(metaNumber("2.5")).toBe(2.5);
  });
});

describe("Meta errores y resiliencia", () => {
  it.each([
    [190, "AUTH_ERROR"],
    [102, "AUTH_ERROR"],
    [10, "ACCESS_DENIED"],
    [200, "ACCESS_DENIED"],
    [299, "ACCESS_DENIED"],
    [100, "INVALID_REQUEST"],
    [1, "PROVIDER_ERROR"],
    [2, "PROVIDER_ERROR"],
    [4, "RATE_LIMITED"],
    [17, "RATE_LIMITED"],
    [613, "RATE_LIMITED"],
    [80000, "RATE_LIMITED"],
    [80004, "RATE_LIMITED"],
  ])("traduce código Graph %i a %s", (code, expected) => {
    const error = metaError(400, { error: { code, message: "secret-token" } }, new Headers());
    expect(error.code).toBe(expected);
    expect(JSON.stringify(error.details)).not.toContain("secret-token");
  });
  it("respeta Retry-After antes de reintentar fallos temporales", async () => {
    const sim = new Sim(),
      waits: number[] = [];
    sim.handler = () => (sim.calls.length === 1 ? Sim.error(80000, 400, { "retry-after": "3" }) : undefined);
    const provider = new MetaProvider(
      { ...sim.env, META_RETRIES: "2" },
      {
        fetch: sim.fetch,
        retry: {
          sleep: async (ms) => {
            waits.push(ms);
          },
        },
      },
    );
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(waits).toEqual([3000]);
    expect(sim.calls).toHaveLength(2);
  });
  it("respeta la espera BUC en minutos y no reintenta antes cuando excede timeout", async () => {
    const { sim, env } = setup({ META_RETRIES: "3" });
    sim.handler = () =>
      Sim.error(80000, 400, {
        "x-business-use-case-usage": JSON.stringify({ "999": [{ estimated_time_to_regain_access: 19 }] }),
      });
    const provider = new MetaProvider(env, { fetch: sim.fetch });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfter: 1140 });
    expect(sim.calls).toHaveLength(1);
  });
  it("no reintenta errores de permisos", async () => {
    const { sim, provider } = setup({ META_RETRIES: "3" });
    sim.handler = () => Sim.error(10);
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(sim.calls).toHaveLength(1);
  });
  it("reintenta red sin copiar secretos del error", async () => {
    const sim = new Sim();
    sim.handler = () => {
      if (sim.calls.length === 1) throw new Error(sim.env.META_ACCESS_TOKEN);
      return undefined;
    };
    const provider = new MetaProvider(
      { ...sim.env, META_RETRIES: "1" },
      { fetch: sim.fetch, retry: { sleep: async () => undefined } },
    );
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(sim.calls).toHaveLength(2);
  });
  it("circuit breaker pausa después de fallos consecutivos", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.error(2, 503);
    for (let i = 0; i < 6; i++)
      await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(5);
  });
  it("cancela la espera Retry-After y no sigue enviando", async () => {
    const { provider, sim } = setup({ META_RETRIES: "2" });
    sim.handler = () => Sim.error(4, 429, { "retry-after": "3" });
    await expect(provider.listAccounts({}, { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(sim.calls).toHaveLength(1);
  });
  it("conserva cuentas accesibles y avisa, pero una cuenta explícita falla", async () => {
    const { provider, sim } = setup({ META_AD_ACCOUNT_IDS: "111,222" });
    sim.handler = (url) =>
      url.pathname.endsWith("act_222") || url.pathname.includes("act_222/") ? Sim.error(200) : undefined;
    const warnings: ApiError[] = [];
    expect(await provider.listCampaigns({}, { onWarning: (w) => warnings.push(w) })).toHaveLength(1);
    expect(warnings[0]?.details).toMatchObject({ account_id: "222", partial_data: true });
    await expect(provider.listCampaigns({ account_id: "222" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});

describe("Meta API HTTP existente", () => {
  it("datos Meta, autenticación, errores parciales y OpenAPI", async () => {
    const { provider } = setup();
    const app = await makeApp({}, { registry: new ProviderRegistry([new GoogleProvider({}), provider]) });
    try {
      const url = `/api/v1/performance?provider=meta&account_id=act_111&date_from=${query.date_from}&date_to=${query.date_to}`;
      expect((await app.inject({ url })).statusCode).toBe(401);
      const res = await app.inject({ url, headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0]).toMatchObject({ platform: "meta", spend: 100.5, conversions: 2 });
      const hourly = await app.inject({ url: `${url}&granularity=hourly`, headers: auth });
      expect(hourly.statusCode).toBe(200);
      expect(hourly.json().data[0].hour).toBe(0);
      expect(hourly.json().errors[0]).toMatchObject({
        provider: "meta",
        error: { details: { limitation: "hourly_breakdown" } },
      });
      const aggregate = await app.inject({ url: "/api/v1/accounts", headers: auth });
      expect(aggregate.statusCode).toBe(200);
      expect(aggregate.json().data[0].platform).toBe("meta");
      expect(aggregate.json().errors[0]).toMatchObject({ provider: "google", error: { code: "NOT_CONFIGURED" } });
      const conversions = await app.inject({
        url: `/api/v1/conversions?provider=meta&account_id=111&date_from=${query.date_from}&date_to=${query.date_to}`,
        headers: auth,
      });
      expect(conversions.statusCode).toBe(200);
      expect(conversions.json().data.length).toBeGreaterThan(0);
      const docs = await app.inject({ url: "/docs/json" });
      expect(docs.statusCode).toBe(200);
      expect(docs.json().paths).toHaveProperty("/api/v1/performance");
    } finally {
      await app.close();
    }
  });
  it("permiso denegado retorna HTTP real sin filtrar credenciales", async () => {
    const { provider, sim } = setup();
    sim.handler = () => Sim.error(200);
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      const res = await app.inject({ url: "/api/v1/accounts?provider=meta", headers: auth });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ACCESS_DENIED");
      expect(res.body).not.toContain(sim.env.META_ACCESS_TOKEN);
      expect(res.body).not.toContain(sim.env.META_APP_SECRET);
    } finally {
      await app.close();
    }
  });
});
