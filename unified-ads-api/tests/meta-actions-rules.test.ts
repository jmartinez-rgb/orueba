import { describe, expect, it } from "vitest";
import { readMetaConfig } from "../src/providers/meta/config.js";
import { primaryForCampaign } from "../src/providers/meta/primary-action.js";
import { normalizePerformance, normalizeConversions, normalizeAccount } from "../src/providers/meta/normalize.js";
import { MetaClient } from "../src/providers/meta/client.js";
import { readMetaActions, actionTotals, metaActionSheets } from "../src/providers/meta/actions-report.js";
import { MetaSimulator as Sim } from "./meta-simulator.js";

const rules = [
  { account_id: "111", campaign_name_contains: "CAPI WhatsApp", action: "onsite_conversion.purchase" },
  { account_id: "111", campaign_name_not_contains: "CAPI WhatsApp", action: "offsite_conversion.custom.555" },
];
const config = () =>
  readMetaConfig({
    ...new Sim().env,
    META_PRIMARY_CONVERSION_RULES: JSON.stringify(rules),
    META_CONVERSION_MAPPING: '{"offsite_conversion.custom.555":"PURCHASE"}',
  }).config!;
const query = { account_id: "111", date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const };
const at = "2026-10-01T00:00:00Z";

describe("Meta: acciones principales explícitas por campaña", () => {
  it("separa CAPI WhatsApp y compras offline dentro de la misma cuenta sin sumar alias", () => {
    const sim = new Sim(),
      cfg = config(),
      account = normalizeAccount(sim.account, cfg);
    const actions = [
      { action_type: "onsite_conversion.purchase", value: "2" },
      { action_type: "offsite_conversion.custom.555", value: "5" },
      { action_type: "omni_purchase", value: "100" },
      { action_type: "purchase", value: "100" },
    ];
    const base = { ...sim.insight, spend: "200", actions };
    const capi = normalizePerformance({ ...base, campaign_name: "izzi CAPI WhatsApp" }, account, query, cfg, at);
    const other = normalizePerformance({ ...base, campaign_name: "izzi Compras Web" }, account, query, cfg, at);
    expect(capi).toMatchObject({
      conversions: 2,
      cpa: 100,
      raw_metrics: {
        primary_conversion_action: "onsite_conversion.purchase",
        primary_conversion_scope: "campaign_rule",
      },
    });
    expect(other).toMatchObject({
      conversions: 5,
      cpa: 40,
      raw_metrics: { primary_conversion_action: "offsite_conversion.custom.555" },
    });
    const converted = normalizeConversions({ ...base, campaign_name: "izzi Compras Web" }, account, query, cfg, at);
    expect(converted.filter((r) => r.raw_metrics?.is_primary).map((r) => r.source_conversion)).toEqual([
      "offsite_conversion.custom.555",
    ]);
    expect(converted.filter((r) => r.normalized_conversion === "PURCHASE").map((r) => r.source_conversion)).toEqual([
      "offsite_conversion.custom.555",
    ]);
  });
  it("las reglas son literales e insensibles a mayúsculas, no expresiones regulares", () => {
    expect(primaryForCampaign(config(), "111", "333", "IZZI capi whatsapp").action).toBe("onsite_conversion.purchase");
    const cfg = config();
    cfg.primaryRules = [{ account_id: "111", campaign_name_contains: "CAPI.*", action: "lead" }];
    expect(primaryForCampaign(cfg, "111", "333", "CAPI WhatsApp")).toMatchObject({
      scope: "unmatched_rule",
      action: undefined,
    });
  });
  it("reglas no cubiertas o nombre ausente no heredan la acción global", () => {
    const cfg = config();
    cfg.primaryRules = [rules[0]!];
    expect(primaryForCampaign(cfg, "111", "333", "Otro nombre").action).toBeUndefined();
    expect(primaryForCampaign(cfg, "111", "333", null).action).toBeUndefined();
    expect(primaryForCampaign(cfg, "222", "333", "Otro nombre").scope).toBe("global");
  });
  it("una campaña fuera de reglas tampoco recibe una categoría de compra inferida", () => {
    const sim = new Sim(),
      cfg = config();
    cfg.primaryRules = [rules[0]!];
    const account = normalizeAccount(sim.account, cfg);
    const rows = normalizeConversions({ ...sim.insight, campaign_name: "Otro nombre" }, account, query, cfg, at);
    expect(rows.every((row) => row.normalized_conversion === null)).toBe(true);
    expect(rows.every((row) => row.raw_metrics?.primary_conversion_scope === "unmatched_rule")).toBe(true);
  });
  it("permite una regla por ID y falla cerrada si dos reglas asignan acciones diferentes", () => {
    const cfg = config();
    cfg.primaryRules = [{ account_id: "111", campaign_id: "333", action: "lead" }];
    expect(primaryForCampaign(cfg, "111", "333", null).action).toBe("lead");
    cfg.primaryRules.push(rules[0]!);
    expect(() => primaryForCampaign(cfg, "111", "333", "CAPI WhatsApp")).toThrow(/contradicen/);
  });
  it("conserva la precedencia cuenta/global cuando no existen reglas", () => {
    const cfg = config();
    cfg.primaryRules = [];
    cfg.primaryActions = { "111": "lead" };
    expect(primaryForCampaign(cfg, "111", "333", "CAPI WhatsApp")).toMatchObject({ action: "lead", scope: "account" });
  });
  it("las acciones externas siguen sin inventarse en la granularidad horaria", () => {
    const sim = new Sim(),
      cfg = config(),
      account = normalizeAccount(sim.account, cfg);
    const row = {
      ...sim.insight,
      campaign_name: "Compras web",
      hourly_stats_aggregated_by_advertiser_time_zone: "00:00:00 - 00:59:59",
    };
    expect(normalizePerformance(row, account, { ...query, granularity: "hourly" }, cfg, at)).toMatchObject({
      hour: 0,
      conversions: null,
      cpa: null,
    });
  });
  it.each([
    [{ account_id: 111, campaign_id: "333", action: "lead" }],
    [{ account_id: "111", campaign_name_contains: "", action: "lead" }],
    [{ account_id: "111", campaign_name_contains: "CAPI", campaign_name_not_contains: "Otro", action: "lead" }],
    [{ account_id: "111", campaign_id: "333", action: "lead", unknown: "private-synthetic" }],
    [{ account_id: "111", campaign_id: "333", action: "invalid/action" }],
  ])("configuración inválida solo expone el nombre de la variable", (raw) => {
    const value = readMetaConfig({
      META_ACCESS_TOKEN: "synthetic",
      META_PRIMARY_CONVERSION_RULES: JSON.stringify(raw),
    });
    expect(value).toEqual({ config: null, missing: ["META_PRIMARY_CONVERSION_RULES"] });
  });
});

function actionFixture() {
  const sim = new Sim(),
    cfg = config();
  sim.handler = (url) => {
    if (url.pathname.endsWith("/customconversions"))
      return Sim.json({
        data: [
          {
            id: "555",
            name: "Compras Offline Web (Inbound)",
            event_source_type: "OFFLINE",
            custom_event_type: "PURCHASE",
          },
        ],
      });
    if (url.pathname.endsWith("/insights"))
      return Sim.json({
        data: [
          {
            ...sim.insight,
            campaign_id: "333",
            campaign_name: "CAPI WhatsApp",
            actions: [
              { action_type: "onsite_conversion.purchase", value: "2" },
              { action_type: "omni_purchase", value: "2" },
            ],
            action_values: [],
          },
          {
            ...sim.insight,
            campaign_id: "444",
            campaign_name: "Web Inbound",
            actions: [
              { action_type: "offsite_conversion.custom.555", value: "5" },
              { action_type: "omni_purchase", value: "5" },
            ],
            action_values: [],
          },
        ],
      });
    return undefined;
  };
  return { sim, cfg, account: normalizeAccount(sim.account, cfg), client: new MetaClient(cfg, sim.fetch) };
}
describe("meta:acciones: inventario independiente de la decisión principal", () => {
  it("lista las acciones observadas separadas por grupo y resuelve nombres del SDK sin elegir", async () => {
    const f = actionFixture(),
      read = await readMetaActions(f.client, f.account, query, AbortSignal.timeout(1000));
    expect(read.metadataAvailable).toBe(true);
    expect(read.rows.find((r) => r.source_action === "offsite_conversion.custom.555")).toMatchObject({
      group: "Resto",
      count: 5,
      custom_name: "Compras Offline Web (Inbound)",
      event_source: "OFFLINE",
    });
    expect(actionTotals(read.rows).map((r) => [r.group, r.source_action, r.count])).toEqual([
      ["CAPI WhatsApp", "onsite_conversion.purchase", 2],
      ["CAPI WhatsApp", "omni_purchase", 2],
      ["Resto", "offsite_conversion.custom.555", 5],
      ["Resto", "omni_purchase", 5],
    ]);
    expect(metaActionSheets(read.rows)).toHaveLength(2);
    const request = f.sim.calls.find((c) => c.path.endsWith("/customconversions"));
    expect(request?.params.get("fields")).not.toContain("data_sources");
  });
  it("falta de permiso para nombres conserva acciones y advierte; no muestra el cuerpo de error", async () => {
    const f = actionFixture(),
      prior = f.sim.handler!;
    f.sim.handler = (url, init) =>
      url.pathname.endsWith("/customconversions") ? Sim.error(200, 403) : prior(url, init);
    const warnings: unknown[] = [];
    const read = await readMetaActions(f.client, f.account, query, AbortSignal.timeout(1000), (e) => warnings.push(e));
    expect(read).toMatchObject({ metadataAvailable: false });
    expect(read.rows).toHaveLength(4);
    expect(read.rows.find((r) => r.source_action.endsWith("555"))?.custom_name).toBeNull();
    expect(JSON.stringify(warnings)).not.toContain("meta-test-token-private");
  });
  it("sin nombre no clasifica como Resto y valores no numéricos permanecen desconocidos", async () => {
    const f = actionFixture();
    f.sim.handler = (url) =>
      url.pathname.endsWith("/insights")
        ? Sim.json({
            data: [
              {
                ...f.sim.insight,
                campaign_name: undefined,
                actions: [{ action_type: "lead", value: "-" }],
                action_values: undefined,
              },
            ],
          })
        : Sim.json({ data: [] });
    const read = await readMetaActions(f.client, f.account, query, AbortSignal.timeout(1000));
    expect(read.rows[0]).toMatchObject({ group: "Sin nombre", count: null, value: null });
  });
  it("una acción con valor pero sin volumen conserva el valor sin inventar volumen cero", async () => {
    const f = actionFixture();
    f.sim.handler = (url) =>
      Sim.json({
        data: url.pathname.endsWith("/insights")
          ? [
              {
                ...f.sim.insight,
                actions: [],
                action_values: [{ action_type: "offsite_conversion.custom.555", value: "800" }],
              },
            ]
          : [],
      });
    const read = await readMetaActions(f.client, f.account, query, AbortSignal.timeout(1000));
    expect(read.rows[0]).toMatchObject({ count: null, value: 800 });
  });
  it.each(["account", "date", "duplicate", "invalid-calendar"])(
    "rechaza acciones de ámbito incorrecto: %s",
    async (kind) => {
      const f = actionFixture();
      const row = {
        ...f.sim.insight,
        ...(kind === "account"
          ? { account_id: "222" }
          : kind === "date"
            ? { date_start: "2026-09-28" }
            : kind === "invalid-calendar"
              ? { date_start: "2026-09-31", date_stop: "2026-09-31" }
              : {}),
      };
      f.sim.handler = (url) =>
        Sim.json({ data: url.pathname.endsWith("/insights") ? (kind === "duplicate" ? [row, row] : [row]) : [] });
      const range = kind === "invalid-calendar" ? { ...query, date_to: "2026-10-01" } : query;
      await expect(readMetaActions(f.client, f.account, range, AbortSignal.timeout(1000))).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
      });
    },
  );
});
