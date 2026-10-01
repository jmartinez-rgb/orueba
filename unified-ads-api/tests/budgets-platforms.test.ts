import { describe, expect, it } from "vitest";
import { GoogleProvider } from "../src/providers/google/index.js";
import { budgetsQuery, normalizeGoogleBudget } from "../src/providers/google/budgets.js";
import { TikTokProvider } from "../src/providers/tiktok/index.js";
import { normalizeTikTokBudgets } from "../src/providers/tiktok/budgets.js";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { normalizeMicrosoftBudgets } from "../src/providers/microsoft/budgets.js";
import { averageDaily, inclusiveDays, todayIn } from "../src/normalization/budgets.js";
import type { NormalizedAccount } from "../src/types/normalized.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";
import { TikTokSimulator } from "./tiktok-simulator.js";
import { MICROSOFT_ENV, json, microsoftSimulator } from "./microsoft-simulator.js";

const at = "2026-10-01T18:00:00.000Z";
const account = (
  platform: NormalizedAccount["platform"],
  extra: Partial<NormalizedAccount> = {},
): NormalizedAccount => ({
  platform,
  client_id: null,
  account_id: "1",
  account_name: "MXN - izzi 1",
  currency: "MXN",
  timezone: "America/Mexico_City",
  status: null,
  manager_account_id: null,
  ...extra,
});

describe("presupuestos: utilidades", () => {
  it("cuenta días incluidos, promedia totales y calcula hoy en la zona de la cuenta", () => {
    expect(inclusiveDays("2026-10-01", "2026-10-10")).toBe(10);
    expect(inclusiveDays("2026-10-10", "2026-10-01")).toBeNull();
    expect(averageDaily(1000, "2026-10-01", "2026-10-10")).toBe(100);
    expect(todayIn("Etc/GMT+6", new Date("2026-10-02T03:00:00Z"))).toBe("2026-10-01");
    expect(todayIn("Zona/Invalida", new Date(at))).toBe("2026-10-01");
  });
});

describe("Google: presupuestos de campaña", () => {
  const row = (budget: Record<string, unknown>, campaign: Record<string, unknown> = {}) => ({
    customer: { currencyCode: "MXN" },
    campaign: {
      id: "10",
      name: "Search Genéricas",
      status: "ENABLED",
      servingStatus: "SERVING",
      advertisingChannelType: "SEARCH",
      ...campaign,
    },
    campaignBudget: { resourceName: "customers/1/campaignBudgets/77", period: "DAILY", ...budget },
  });

  it("convierte micros, detecta compartidos, límite por presupuesto y recomendación", () => {
    const b = normalizeGoogleBudget(
      row(
        {
          amountMicros: "1500000000",
          explicitlyShared: true,
          hasRecommendedBudget: true,
          recommendedBudgetAmountMicros: "2100000000",
        },
        { primaryStatusReasons: ["BUDGET_CONSTRAINED"] },
      ),
      account("google"),
      at,
    );
    expect(b).toMatchObject({
      daily_budget: 1500,
      budget_type: "daily",
      shared_budget_id: "77",
      limited_by_budget: true,
      recommended_daily_budget: 2100,
      objective: "SEARCH",
    });
  });

  it("un periodo personalizado usa el total y su promedio diario; lo que no entrega queda fuera", () => {
    const custom = normalizeGoogleBudget(
      row(
        { period: "CUSTOM_PERIOD", totalAmountMicros: "31000000000" },
        { startDateTime: "2026-10-01 00:00:00", endDateTime: "2026-10-31 23:59:59" },
      ),
      account("google"),
      at,
    );
    expect(custom).toMatchObject({
      budget_type: "lifetime",
      lifetime_budget: 31000,
      daily_estimate: 1000,
      daily_budget: null,
      limited_by_budget: null,
    });
    expect(
      normalizeGoogleBudget(row({ amountMicros: "100" }, { servingStatus: "ENDED" }), account("google"), at),
    ).toBeNull();
    expect(normalizeGoogleBudget(row({ amountMicros: "0" }), account("google"), at)).toBeNull();
  });

  it("consulta solo campañas habilitadas que entregan, con los campos de presupuesto v25", async () => {
    const q = budgetsQuery();
    expect(q).toContain("campaign_budget.amount_micros");
    expect(q).toContain("campaign.serving_status = 'SERVING'");
    const sim = new GoogleSimulator();
    sim.intercept = (call) =>
      String(call.body.query ?? "").includes("campaign_budget.")
        ? Response.json({ results: [row({ amountMicros: "250000000" })] })
        : undefined;
    const p = new GoogleProvider(GOOGLE_ENV, { fetch: sim.fetch, retry: { retries: 0 } });
    const rows = await p.listBudgets({ account_id: "2222222222" });
    expect(rows).toMatchObject([{ platform: "google", campaign_id: "10", daily_budget: 250 }]);
  });
});

describe("TikTok: presupuestos de campaña y de grupo", () => {
  it("usa el presupuesto de la campaña o, si es ilimitado, el de sus grupos encendidos y vigentes", () => {
    const rows = normalizeTikTokBudgets(
      account("tiktok", { timezone: "Etc/GMT+6" }),
      [
        {
          campaign_id: "c1",
          campaign_name: "Sky Conversiones",
          objective_type: "WEB_CONVERSIONS",
          budget: 800,
          budget_mode: "BUDGET_MODE_DAY",
          operation_status: "ENABLE",
        },
        {
          campaign_id: "c2",
          campaign_name: "Sky Alcance",
          budget: 0,
          budget_mode: "BUDGET_MODE_INFINITE",
          operation_status: "ENABLE",
        },
        {
          campaign_id: "c3",
          campaign_name: "Apagada",
          budget: 500,
          budget_mode: "BUDGET_MODE_DAY",
          operation_status: "DISABLE",
        },
      ],
      [
        {
          adgroup_id: "g1",
          adgroup_name: "Grupo 1",
          campaign_id: "c2",
          budget: "300",
          budget_mode: "BUDGET_MODE_DAY",
          operation_status: "ENABLE",
        },
        {
          adgroup_id: "g2",
          adgroup_name: "Total",
          campaign_id: "c2",
          budget: 3000,
          budget_mode: "BUDGET_MODE_TOTAL",
          operation_status: "ENABLE",
          schedule_start_time: "2026-10-01 00:00:00",
          schedule_end_time: "2026-10-10 23:59:59",
        },
        {
          adgroup_id: "g3",
          adgroup_name: "Vencido",
          campaign_id: "c2",
          budget: 999,
          budget_mode: "BUDGET_MODE_DAY",
          operation_status: "ENABLE",
          schedule_end_time: "2026-09-20 23:59:59",
        },
        {
          adgroup_id: "g4",
          adgroup_name: "Apagado",
          campaign_id: "c2",
          budget: 999,
          budget_mode: "BUDGET_MODE_DAY",
          operation_status: "DISABLE",
        },
      ],
      at,
    );
    expect(
      rows.map((r) => [r.campaign_id, r.budget_level, r.ad_set_id, r.budget_type, r.daily_budget, r.daily_estimate]),
    ).toEqual([
      ["c1", "campaign", null, "daily", 800, null],
      ["c2", "ad_set", "g1", "daily", 300, null],
      ["c2", "ad_set", "g2", "lifetime", null, 300],
    ]);
  });

  it("lee campañas y, solo si hace falta, grupos con el SDK oficial v1.3", async () => {
    const sim = new TikTokSimulator();
    sim.handler = (url) => {
      if (url.pathname.endsWith("/campaign/get/") && url.searchParams.get("fields")?.includes("budget_mode"))
        return TikTokSimulator.list([
          { campaign_id: "c2", campaign_name: "Sky", budget_mode: "BUDGET_MODE_INFINITE", operation_status: "ENABLE" },
        ]);
      if (url.pathname.endsWith("/adgroup/get/"))
        return TikTokSimulator.list([
          {
            adgroup_id: "g1",
            campaign_id: "c2",
            budget: 150,
            budget_mode: "BUDGET_MODE_DAY",
            operation_status: "ENABLE",
          },
        ]);
      return undefined;
    };
    const p = new TikTokProvider(
      { ...sim.env, TIKTOK_ADVERTISER_IDS: sim.account.advertiser_id },
      { fetch: sim.fetch },
    );
    expect(await p.listBudgets({})).toMatchObject([
      { platform: "tiktok", campaign_id: "c2", ad_set_id: "g1", daily_budget: 150, currency: "MXN" },
    ]);
  });
});

describe("Microsoft: presupuestos de campaña", () => {
  it("solo campañas activas; compartido con su ID; total sin diario estimado; vencidas fuera", () => {
    const rows = normalizeMicrosoftBudgets(
      account("microsoft"),
      [
        {
          Id: 11,
          Name: "Search Marca",
          Status: "Active",
          CampaignType: "Search",
          DailyBudget: 450.5,
          BudgetType: "DailyBudgetStandard",
          BudgetId: null,
        },
        {
          Id: 12,
          Name: "Compartida",
          Status: "Active",
          DailyBudget: 900,
          BudgetType: "DailyBudgetStandard",
          BudgetId: 5555,
        },
        { Id: 13, Name: "Total", Status: "Active", DailyBudget: 12000, BudgetType: "LifetimeBudgetStandard" },
        { Id: 14, Name: "Pausada", Status: "BudgetPaused", DailyBudget: 300 },
        { Id: 15, Name: "Terminó", Status: "Active", DailyBudget: 300, EndDate: { Year: 2026, Month: 9, Day: 1 } },
      ],
      at,
    );
    expect(
      rows.map((r) => [
        r.campaign_id,
        r.budget_type,
        r.daily_budget,
        r.lifetime_budget,
        r.shared_budget_id,
        r.daily_estimate,
      ]),
    ).toEqual([
      ["11", "daily", 450.5, null, null, null],
      ["12", "daily", 900, null, "5555", null],
      ["13", "lifetime", null, 12000, null, null],
    ]);
  });

  it("reutiliza la consulta de campañas por cuenta", async () => {
    const sim = microsoftSimulator((call) =>
      call.url.pathname.endsWith("/Campaigns/QueryByAccountId")
        ? json({
            Campaigns: [
              { Id: 21, Name: "Search", Status: "Active", DailyBudget: 100, BudgetType: "DailyBudgetStandard" },
            ],
          })
        : undefined,
    );
    const p = new MicrosoftProvider(MICROSOFT_ENV, {
      fetch: sim.request,
      retry: { sleep: async () => undefined, random: () => 0 },
    });
    expect(await p.listBudgets({})).toMatchObject([{ platform: "microsoft", campaign_id: "21", daily_budget: 100 }]);
  });
});
