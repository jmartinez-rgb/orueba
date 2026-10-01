import { describe, expect, it } from "vitest";
import { normalizeMetaHealth } from "../src/providers/meta/health.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import { healthQuery, normalizeGoogleHealth } from "../src/providers/google/health.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import { normalizeMicrosoftHealth } from "../src/providers/microsoft/health.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { NormalizedAccount } from "../src/types/normalized.js";
import { MetaSimulator } from "./meta-simulator.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";
import { KEY, makeApp } from "./helpers.js";

const at = "2026-10-01T18:00:00.000Z";
const account = (platform: NormalizedAccount["platform"]): NormalizedAccount => ({
  platform,
  client_id: null,
  account_id: "111",
  account_name: "MXN - izzi 1",
  currency: "MXN",
  timezone: null,
  status: null,
  manager_account_id: null,
});

describe("salud de entrega: Meta", () => {
  it("reporta estado de cuenta, tope de gasto, problemas y aprendizaje", () => {
    const rows = normalizeMetaHealth(
      account("meta"),
      { account_status: 3, disable_reason: 0, amount_spent: "4500000", spend_cap: "5000000", currency: "MXN" },
      [
        {
          id: "1",
          name: "Venta",
          effective_status: "WITH_ISSUES",
          issues_info: [{ error_code: 1815694, error_summary: "Método de pago rechazado", level: "CAMPAIGN" }],
        },
        { id: "2", name: "Sana", effective_status: "ACTIVE" },
      ],
      [
        {
          id: "21",
          name: "Conjunto aprendiendo",
          campaign_id: "2",
          effective_status: "ACTIVE",
          learning_stage_info: { status: "LEARNING" },
        },
        {
          id: "22",
          name: "Aprendizaje limitado",
          campaign_id: "2",
          effective_status: "ACTIVE",
          learning_stage_info: { status: "FAIL" },
        },
        {
          id: "23",
          name: "Ya aprendió",
          campaign_id: "2",
          effective_status: "ACTIVE",
          learning_stage_info: { status: "SUCCESS" },
        },
      ],
      at,
    );
    expect(rows.map((r) => [r.entity_level, r.entity_id, r.kind, r.severity, r.code])).toEqual([
      ["account", "111", "account_status", "critical", "UNSETTLED"],
      ["account", "111", "spend_cap", "info", "SPEND_CAP"],
      ["campaign", "1", "delivery_issue", "critical", "1815694"],
      ["ad_set", "21", "learning", "info", "LEARNING"],
      ["ad_set", "22", "learning_limited", "warning", "FAIL"],
    ]);
    expect(rows[1]).toMatchObject({ spend_cap: 50000, amount_spent: 45000 });
    expect(rows[2]!.detail).toBe("Método de pago rechazado");
    expect(rows[4]).toMatchObject({ campaign_name: "Sana" });
  });

  it("un tope alcanzado es crítico; sin tope o cuenta activa no hay señal", () => {
    const capped = normalizeMetaHealth(
      account("meta"),
      { account_status: 1, amount_spent: "100", spend_cap: "100" },
      [],
      [],
      at,
    );
    expect(capped).toMatchObject([{ kind: "spend_cap", severity: "critical", code: "SPEND_CAP_REACHED" }]);
    expect(
      normalizeMetaHealth(account("meta"), { account_status: 1, amount_spent: "100", spend_cap: "0" }, [], [], at),
    ).toEqual([]);
  });

  it("consulta cuenta, campañas y conjuntos activos o con problemas", async () => {
    const sim = new MetaSimulator();
    sim.handler = (url) => {
      const path = url.pathname.replace(/^\/v26\.0\//, "");
      const fields = url.searchParams.get("fields") ?? "";
      if (path === "act_111" && fields.includes("spend_cap"))
        return MetaSimulator.json({ account_status: 1, spend_cap: "0", amount_spent: "5" });
      if (path === "act_111/campaigns" && fields.includes("issues_info")) {
        expect(url.searchParams.get("effective_status")).toBe('["ACTIVE","WITH_ISSUES"]');
        return MetaSimulator.json({ data: [{ id: "1", name: "Venta", effective_status: "WITH_ISSUES" }] });
      }
      if (path === "act_111/adsets") return MetaSimulator.json({ data: [] });
      return undefined;
    };
    const p = new MetaProvider({ ...sim.env, META_AD_ACCOUNT_IDS: "111" }, { fetch: sim.fetch });
    expect(await p.listDeliverySignals({})).toMatchObject([
      { kind: "delivery_issue", entity_id: "1", severity: "critical" },
    ]);
  });
});

describe("salud de entrega: Google", () => {
  const row = (primaryStatus: string, primaryStatusReasons: string[]) => ({
    customer: { currencyCode: "MXN" },
    campaign: { id: "9", name: "Pmax Hogar", status: "ENABLED", primaryStatus, primaryStatusReasons },
  });
  it("traduce estado principal y motivos sin marcar campañas sanas", () => {
    expect(normalizeGoogleHealth(row("ELIGIBLE", []), account("google"), at)).toEqual([]);
    const limited = normalizeGoogleHealth(
      row("LIMITED", ["BUDGET_CONSTRAINED", "HAS_ADS_DISAPPROVED", "BIDDING_STRATEGY_LEARNING"]),
      account("google"),
      at,
    );
    expect(limited.map((r) => [r.kind, r.severity, r.code])).toEqual([
      ["budget_limited", "warning", "BUDGET_CONSTRAINED"],
      ["policy", "critical", "HAS_ADS_DISAPPROVED"],
      ["learning", "info", "BIDDING_STRATEGY_LEARNING"],
    ]);
    expect(
      normalizeGoogleHealth(row("NOT_ELIGIBLE", ["NO_AD_GROUP_ADS"]), account("google"), at).map((r) => r.kind),
    ).toEqual(["delivery_issue", "delivery_issue"]);
  });
  it("consulta solo campañas habilitadas", async () => {
    expect(healthQuery()).toContain("campaign.primary_status_reasons");
    const sim = new GoogleSimulator();
    sim.intercept = (call) =>
      String(call.body.query ?? "").includes("campaign.primary_status")
        ? Response.json({ results: [row("LIMITED", ["BUDGET_CONSTRAINED"])] })
        : undefined;
    const p = new GoogleProvider(GOOGLE_ENV, { fetch: sim.fetch, retry: { retries: 0 } });
    expect(await p.listDeliverySignals({ account_id: "2222222222" })).toMatchObject([
      { platform: "google", kind: "budget_limited" },
    ]);
  });
});

describe("salud de entrega: Microsoft", () => {
  it("marca pausadas por presupuesto y suspendidas; activas y pausadas a mano no", () => {
    const rows = normalizeMicrosoftHealth(
      account("microsoft"),
      [
        { Id: 1, Name: "A", Status: "Active" },
        { Id: 2, Name: "B", Status: "BudgetPaused" },
        { Id: 3, Name: "C", Status: "BudgetAndManualPaused" },
        { Id: 4, Name: "D", Status: "Suspended" },
        { Id: 5, Name: "E", Status: "Paused" },
      ],
      at,
    );
    expect(rows.map((r) => [r.entity_id, r.kind, r.severity])).toEqual([
      ["2", "paused_by_budget", "warning"],
      ["3", "paused_by_budget", "info"],
      ["4", "delivery_issue", "critical"],
    ]);
  });
});

describe("ruta /api/v1/delivery-health", () => {
  it("responde con la llave y rechaza proveedores sin esta consulta", async () => {
    const sim = new MetaSimulator();
    sim.handler = (url) => {
      const fields = url.searchParams.get("fields") ?? "";
      if (url.pathname.endsWith("act_111") && fields.includes("spend_cap"))
        return MetaSimulator.json({ account_status: 2 });
      if (fields.includes("issues_info")) return MetaSimulator.json({ data: [] });
      return undefined;
    };
    const app = await makeApp(
      {},
      {
        registry: new ProviderRegistry([
          new MetaProvider({ ...sim.env, META_AD_ACCOUNT_IDS: "111" }, { fetch: sim.fetch }),
        ]),
      },
    );
    const ok = await app.inject({ method: "GET", url: "/api/v1/delivery-health", headers: { "x-api-key": KEY } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject([{ kind: "account_status", code: "DISABLED", severity: "critical" }]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/delivery-health?provider=tiktok",
          headers: { "x-api-key": KEY },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/v1/delivery-health" })).statusCode).toBe(401);
  });
});
