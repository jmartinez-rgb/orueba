import { describe, expect, it } from "vitest";
import { XProvider } from "../src/providers/x/index.js";
import { XClient } from "../src/providers/x/client.js";
import { readXConfig } from "../src/providers/x/config.js";
import { ACCOUNT, CAMPAIGN, XSimulator as Sim, json } from "./x-simulator.js";
import type { ApiError } from "../src/utils/errors.js";
const query = { account_id: ACCOUNT, date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const };
const window = { X_ADS_ACTIVITY_START_TIME: "2026-09-30T00:00:00Z", X_ADS_ACTIVITY_END_TIME: "2026-10-01T00:00:00Z" };
function fixture(extra: Record<string, string> = {}) {
  const sim = new Sim();
  sim.campaigns.push({ ...sim.campaigns[0], id: "second" });
  const body = {
    data_type: "active_entities",
    request: {
      params: {
        entity: "CAMPAIGN",
        account_id: ACCOUNT,
        start_time: window.X_ADS_ACTIVITY_START_TIME,
        end_time: window.X_ADS_ACTIVITY_END_TIME,
      },
    },
    data: [
      {
        entity_id: CAMPAIGN,
        activity_start_time: "2026-09-29T07:00:00Z",
        activity_end_time: "2026-09-29T20:00:00Z",
        placements: ["ALL_ON_TWITTER"],
      },
    ],
    next_cursor: null,
  };
  sim.handler = (url) => (url.pathname.endsWith("/active_entities") ? json(body) : undefined);
  const env = { ...sim.env, ...window, ...extra };
  return { sim, body, env, provider: new XProvider(env, { fetch: sim.fetch, wait: async () => undefined }) };
}
describe("X: optimización incremental de cambios, con cobertura explícita", () => {
  it("sin ventana incremental conserva el informe completo y no llama active_entities", async () => {
    const f = fixture({ X_ADS_ACTIVITY_START_TIME: "", X_ADS_ACTIVITY_END_TIME: "" });
    const rows = await f.provider.getPerformance(query);
    expect(new Set(rows.map((r) => r.campaign_id))).toEqual(new Set([CAMPAIGN, "second"]));
    expect(f.sim.calls.some((c) => c.url.pathname.endsWith("/active_entities"))).toBe(false);
  });
  it("consulta la ventana de cambios separada y filtra solo rangos aplicables, avisando cobertura incremental", async () => {
    const f = fixture(),
      warnings: ApiError[] = [];
    const rows = await f.provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
    expect(rows.map((r) => r.campaign_id)).toEqual([CAMPAIGN]);
    const active = f.sim.calls.find((c) => c.url.pathname.endsWith("/active_entities"))!;
    expect(active.url.searchParams.get("start_time")).toBe(window.X_ADS_ACTIVITY_START_TIME);
    expect(active.url.searchParams.get("entity")).toBe("CAMPAIGN");
    expect(warnings.some((e) => (e.details as { limitation: string }).limitation === "incremental_coverage")).toBe(
      true,
    );
    expect(
      f.sim.calls
        .filter((c) => c.url.pathname.endsWith(`/accounts/${ACCOUNT}`) && c.url.pathname.includes("stats"))
        .every((c) => c.url.searchParams.get("entity_ids") === CAMPAIGN),
    ).toBe(true);
  });
  it("una campaña explícita nunca se pierde por el filtro de actividad", async () => {
    const f = fixture();
    expect((await f.provider.getPerformance({ ...query, campaign_id: "second" })).map((r) => r.campaign_id)).toEqual([
      "second",
    ]);
    expect(f.sim.calls.some((c) => c.url.pathname.endsWith("/active_entities"))).toBe(false);
  });
  it.each(["empty", "foreign", "echo", "cursor", "placement", "invalid-time"])(
    "respuesta inesperada usa el respaldo completo: %s",
    async (kind) => {
      const f = fixture();
      if (kind === "empty") f.body.data = [];
      if (kind === "foreign") f.body.data[0]!.entity_id = "unknown";
      if (kind === "echo") f.body.request.params.account_id = "wrong";
      if (kind === "cursor") Object.assign(f.body, { next_cursor: "another-page" });
      if (kind === "placement") f.body.data[0]!.placements = ["PUBLISHER_NETWORK"];
      if (kind === "invalid-time") f.body.data[0]!.activity_start_time = "2026-02-30T00:00:00Z";
      const warnings: ApiError[] = [];
      const rows = await f.provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
      expect(new Set(rows.map((r) => r.campaign_id))).toEqual(new Set([CAMPAIGN, "second"]));
      expect(
        warnings.some((e) => (e.details as { limitation: string }).limitation === "active_entities_fallback"),
      ).toBe(true);
    },
  );
  it("rangos de actividad fuera del reporte no demuestran actividad cero", async () => {
    const f = fixture();
    f.body.data[0]!.activity_start_time = "2026-09-01T00:00:00Z";
    f.body.data[0]!.activity_end_time = "2026-09-02T00:00:00Z";
    expect((await f.provider.getPerformance(query)).map((r) => r.campaign_id)).toEqual([CAMPAIGN, "second"]);
  });
  it("error de permiso del endpoint opcional conserva la consulta de métricas", async () => {
    const f = fixture();
    f.sim.handler = (url) =>
      url.pathname.endsWith("/active_entities")
        ? json({ errors: [{ code: "FORBIDDEN", message: "private-synthetic" }] }, 403)
        : undefined;
    expect((await f.provider.getPerformance(query)).map((r) => r.campaign_id)).toEqual([CAMPAIGN, "second"]);
  });
  it("429 detiene la consulta; el respaldo no evade cuotas", async () => {
    const f = fixture();
    f.sim.handler = (url) =>
      url.pathname.endsWith("/active_entities")
        ? json({ errors: [{ code: "TOO_MANY_REQUESTS" }] }, 429, { "retry-after": "30" })
        : undefined;
    await expect(f.provider.getPerformance(query)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(f.sim.calls.some((c) => c.url.pathname === `/12/stats/accounts/${ACCOUNT}`)).toBe(false);
  });
  it.each([
    { ...window, X_ADS_ACTIVITY_END_TIME: "" },
    { ...window, X_ADS_ACTIVITY_START_TIME: "2026-09-30T00:30:00Z" },
    { ...window, X_ADS_ACTIVITY_START_TIME: "2026-02-30T00:00:00Z" },
    { ...window, X_ADS_ACTIVITY_END_TIME: "2026-09-29T00:00:00Z" },
  ])("configuración exige ambas horas UTC válidas y en orden", (extra) => {
    expect(readXConfig({ ...new Sim().env, ...extra }).missing).toContain("X_ADS_ACTIVITY_START_TIME");
  });
  it("active_entities solo admite GET, sin abrir otras rutas", async () => {
    const f = fixture();
    const client = new XClient(readXConfig(f.env).config!, f.sim.fetch);
    await expect(
      client.call(`/stats/accounts/${ACCOUNT}/active_entities`, {}, AbortSignal.timeout(1000), "POST"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.sim.calls).toEqual([]);
  });
});
