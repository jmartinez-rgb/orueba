import { describe, expect, it } from "vitest";
import { MetaProvider } from "../src/providers/meta/index.js";
import { currencyOffset, normalizeBudgets } from "../src/providers/meta/budgets.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { NormalizedAccount } from "../src/types/normalized.js";
import { MetaSimulator } from "./meta-simulator.js";
import { KEY, makeApp } from "./helpers.js";

const at = "2026-10-01T18:00:00.000Z";
const account: NormalizedAccount = {
  platform: "meta",
  client_id: null,
  account_id: "111",
  account_name: "MXN - izzi 1",
  currency: "MXN",
  timezone: "America/Mexico_City",
  status: "1",
  manager_account_id: null,
};
const campaign = (id: string, extra: Record<string, unknown>) => ({
  id,
  name: `Campaña ${id}`,
  objective: "OUTCOME_LEADS",
  effective_status: "ACTIVE",
  ...extra,
});

describe("Meta: presupuestos vigentes", () => {
  it("convierte centavos, separa presupuesto de campaña y de conjunto y estima el diario de un total", () => {
    const rows = normalizeBudgets(
      account,
      [
        campaign("1", { daily_budget: "150000", bid_strategy: "LOWEST_COST_WITHOUT_CAP" }),
        campaign("2", {
          lifetime_budget: "3000000",
          budget_remaining: "1000000",
          stop_time: "2026-10-05T23:59:00-0600",
        }),
        campaign("3", {}), // ABO: el presupuesto está en sus conjuntos
        campaign("4", { daily_budget: "50000", stop_time: "2026-09-30T23:59:00-0600" }), // ya terminó
        campaign("5", { daily_budget: "50000", effective_status: "PAUSED" }),
      ],
      [
        { id: "31", name: "Conjunto A", campaign_id: "3", effective_status: "ACTIVE", daily_budget: "20000" },
        { id: "32", name: "Conjunto B", campaign_id: "3", effective_status: "ACTIVE", daily_budget: "30050" },
        { id: "33", name: "Conjunto C", campaign_id: "3", effective_status: "PAUSED", daily_budget: "99900" },
        {
          id: "34",
          name: "Conjunto D",
          campaign_id: "3",
          effective_status: "ACTIVE",
          end_time: "2026-09-01T00:00:00-0600",
          daily_budget: "10000",
        },
        {
          id: "11",
          name: "De campaña con presupuesto",
          campaign_id: "1",
          effective_status: "ACTIVE",
          daily_budget: "77700",
        },
      ],
      at,
    );
    expect(
      rows.map((r) => [r.campaign_id, r.budget_level, r.ad_set_id, r.budget_type, r.daily_budget, r.lifetime_budget]),
    ).toEqual([
      ["1", "campaign", null, "daily", 1500, null],
      ["2", "campaign", null, "lifetime", null, 30000],
      ["3", "ad_set", "31", "daily", 200, null],
      ["3", "ad_set", "32", "daily", 300.5, null],
    ]);
    // Restante 10,000 entre los 5 días que faltan (1 al 5 de octubre, incluido hoy).
    expect(rows[1]!.daily_estimate).toBe(2000);
    expect(rows[0]).toMatchObject({
      objective: "OUTCOME_LEADS",
      daily_estimate: null,
      raw_metrics: { currency_offset: 100, bid_strategy: "LOWEST_COST_WITHOUT_CAP" },
    });
  });

  it("respeta monedas sin decimales y deja nulos los montos si falta la moneda", () => {
    expect([currencyOffset("MXN"), currencyOffset("USD"), currencyOffset("CLP"), currencyOffset(null)]).toEqual([
      100,
      100,
      1,
      null,
    ]);
    const [clp] = normalizeBudgets({ ...account, currency: "CLP" }, [campaign("1", { daily_budget: "50000" })], [], at);
    expect(clp!.daily_budget).toBe(50000);
    const [unknown] = normalizeBudgets(
      { ...account, currency: null },
      [campaign("1", { daily_budget: "50000" })],
      [],
      at,
    );
    expect(unknown!.daily_budget).toBeNull();
  });

  it("solo consulta conjuntos cuando alguna campaña no tiene presupuesto propio y filtra activos en Meta", async () => {
    const sim = new MetaSimulator();
    sim.handler = (url) => {
      const path = url.pathname.replace(/^\/v26\.0\//, "");
      if (path === "act_111/campaigns" && url.searchParams.get("fields")?.includes("daily_budget")) {
        expect(url.searchParams.get("effective_status")).toBe('["ACTIVE"]');
        return MetaSimulator.json({ data: [campaign("1", { daily_budget: "100000" }), campaign("3", {})] });
      }
      if (path === "act_111/adsets") {
        expect(url.searchParams.get("effective_status")).toBe('["ACTIVE"]');
        return MetaSimulator.json({
          data: [{ id: "31", name: "A", campaign_id: "3", effective_status: "ACTIVE", daily_budget: "25000" }],
        });
      }
      return undefined;
    };
    const p = new MetaProvider({ ...sim.env, META_AD_ACCOUNT_IDS: "111" }, { fetch: sim.fetch });
    const rows = await p.listBudgets({});
    expect(rows.map((r) => [r.campaign_id, r.daily_budget])).toEqual([
      ["1", 1000],
      ["3", 250],
    ]);
    expect(sim.calls.filter((c) => c.path.endsWith("/adsets"))).toHaveLength(1);
  });
});

describe("ruta /api/v1/budgets", () => {
  it("devuelve presupuestos de Meta y rechaza proveedores que aún no los ofrecen", async () => {
    const sim = new MetaSimulator();
    sim.handler = (url) =>
      url.pathname.endsWith("act_111/campaigns") && url.searchParams.get("fields")?.includes("daily_budget")
        ? MetaSimulator.json({ data: [campaign("1", { daily_budget: "100000" })] })
        : undefined;
    const registry = new ProviderRegistry([
      new MetaProvider({ ...sim.env, META_AD_ACCOUNT_IDS: "111" }, { fetch: sim.fetch }),
    ]);
    const app = await makeApp({}, { registry });
    const ok = await app.inject({ method: "GET", url: "/api/v1/budgets?provider=meta", headers: { "x-api-key": KEY } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      data: [{ platform: "meta", campaign_id: "1", daily_budget: 1000, currency: "MXN" }],
      errors: [],
    });
    const all = await app.inject({ method: "GET", url: "/api/v1/budgets", headers: { "x-api-key": KEY } });
    expect(all.json().data).toHaveLength(1);
    const noKey = await app.inject({ method: "GET", url: "/api/v1/budgets?provider=meta" });
    expect(noKey.statusCode).toBe(401);
    const google = await app.inject({
      method: "GET",
      url: "/api/v1/budgets?provider=google",
      headers: { "x-api-key": KEY },
    });
    expect(google.statusCode).toBe(400);
  });
});
