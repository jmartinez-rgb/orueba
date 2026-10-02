import { describe, expect, it } from "vitest";
import {
  absoluteTopCatalogQuery,
  absoluteTopMetricsQuery,
  joinAbsoluteTopRows,
  validateAbsoluteTopQuery,
} from "../src/providers/google/absolute-top.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import type { GoogleRow } from "../src/providers/google/types.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { GoogleAbsoluteTopQuery } from "../src/types/google-absolute-top.js";
import type { NormalizedAccount } from "../src/types/normalized.js";
import { KEY, makeApp } from "./helpers.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";

const ACCOUNT_ID = "8779536058";
const AT = "2026-10-02T12:00:00.000Z";
const query: GoogleAbsoluteTopQuery = {
  account_id: ACCOUNT_ID,
  date_from: "2026-09-30",
  date_to: "2026-09-30",
  granularity: "daily",
};
const account: NormalizedAccount = {
  platform: "google",
  client_id: "izzi",
  account_id: ACCOUNT_ID,
  account_name: "Cuenta de prueba izzi",
  currency: "USD",
  timezone: "America/New_York",
  status: "ENABLED",
  manager_account_id: "1111111111",
  is_manager: false,
};

function campaign(id = "123456789012", patch: Partial<NonNullable<GoogleRow["campaign"]>> = {}): GoogleRow {
  return {
    campaign: {
      id,
      name: `Campaña Search ${id}`,
      status: "ENABLED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "TARGET_CPA",
      ...patch,
    },
    campaignBudget: { amountMicros: "50000000", period: "DAILY" },
  };
}

function group(campaignId = "123456789012", groupId = "9007199254740993"): GoogleRow {
  return {
    ...campaign(campaignId),
    adGroup: { id: groupId, name: `Grupo ${groupId}`, status: "ENABLED" },
  };
}

function report(entity = campaign(), patch: GoogleRow = {}): GoogleRow {
  return {
    ...structuredClone(entity),
    customer: { id: ACCOUNT_ID },
    segments: { date: query.date_from, adNetworkType: "SEARCH" },
    metrics: {
      absoluteTopImpressionPercentage: 0.8,
      topImpressionPercentage: 0.95,
      searchImpressionShare: 0.75,
      searchRankLostImpressionShare: 0.15,
      searchBudgetLostImpressionShare: 0.1,
      impressions: "1000",
      clicks: "20",
      costMicros: "25000000",
      conversions: 2.5,
    },
    ...patch,
  };
}

function join(rows: GoogleRow[], metrics: GoogleRow[], level: "campaign" | "ad_group" = "campaign", q = query) {
  return joinAbsoluteTopRows(rows, metrics, account, q, level, AT);
}

/** Extends the existing local simulator; never falls back to global fetch. */
function setup() {
  const simulator = new GoogleSimulator();
  const first = campaign();
  const second = campaign("123456789013");
  const firstGroup = group();
  const secondGroup = group("123456789012", "9007199254740994");
  const thirdGroup = group("123456789013", "9007199254740995");
  const fixture = {
    account: { ...account },
    campaigns: [first, second, campaign("123456789014", { status: "PAUSED" })],
    groups: [firstGroup, secondGroup, thirdGroup],
    campaignMetrics: [report(first)],
    groupMetrics: [report(firstGroup, { metrics: { ...report().metrics, absoluteTopImpressionPercentage: 0.4 } })],
  };
  simulator.intercept = (call) => {
    if (call.url.hostname !== "googleads.googleapis.com") return undefined;
    const requestedId = /\/customers\/(\d{10})\//.exec(call.url.pathname)?.[1];
    if (requestedId !== ACCOUNT_ID) throw new Error("Absolute Top must remain scoped to the fixture account.");
    if (call.method !== "POST") throw new Error("Unexpected Google method.");
    const gaql = String(call.body.query);
    if (gaql.endsWith(" FROM customer")) {
      return Response.json({
        results: [
          {
            customer: {
              id: requestedId,
              descriptiveName: fixture.account.account_name,
              currencyCode: fixture.account.currency,
              timeZone: fixture.account.timezone,
              manager: fixture.account.is_manager,
              status: fixture.account.status,
            },
          },
        ],
      });
    }
    const level = / FROM (campaign|ad_group) WHERE /.exec(gaql)?.[1];
    if (!level || !gaql.includes("campaign.advertising_channel_type = 'SEARCH'"))
      throw new Error("Unexpected Absolute Top query.");
    if (gaql.includes("metrics.")) {
      const rows = level === "campaign" ? fixture.campaignMetrics : fixture.groupMetrics;
      return Response.json({ results: rows });
    }
    return Response.json({ results: level === "campaign" ? fixture.campaigns : fixture.groups });
  };
  const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
  return { provider, simulator, fixture };
}

describe("Google Absolute Top GAQL and account scope", () => {
  it("requires the verified v25 contract before any upstream request while preserving legacy configuration", async () => {
    const simulator = new GoogleSimulator();
    const provider = new GoogleProvider(
      { ...GOOGLE_ENV, GOOGLE_ADS_API_VERSION: "v24", GOOGLE_ADS_DEVELOPER_TOKEN: "test-legacy-developer" },
      { fetch: simulator.fetch },
    );
    expect(provider.isConfigured()).toBe(true);
    await expect(provider.getAbsoluteTop(query)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(simulator.calls).toHaveLength(0);
  });

  it("reuses bounded retries without duplicating observations or refreshing OAuth again", async () => {
    const { simulator } = setup();
    const fixtureRead = simulator.intercept!;
    let campaignAttempts = 0;
    simulator.intercept = (call) => {
      if (String(call.body.query).includes(" FROM campaign WHERE ") && String(call.body.query).includes("metrics.")) {
        campaignAttempts++;
        if (campaignAttempts === 1) return Response.json({}, { status: 503 });
      }
      return fixtureRead(call);
    };
    const provider = new GoogleProvider(GOOGLE_ENV, {
      fetch: simulator.fetch,
      retry: { retries: 1, sleep: async () => {} },
    });
    expect(await provider.getAbsoluteTop(query)).toHaveLength(5);
    expect(campaignAttempts).toBe(2);
    expect(simulator.tokens).toBe(1);
  });

  it("cancels the active catalog request and does not continue into reports or groups", async () => {
    const { provider, simulator } = setup();
    const fixtureRead = simulator.intercept!;
    const controller = new AbortController();
    let entered!: () => void;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let aborted = false;
    simulator.intercept = (call) => {
      if (String(call.body.query).includes(" FROM campaign WHERE ") && !String(call.body.query).includes("metrics.")) {
        entered();
        return new Promise<Response>((_resolve, reject) => {
          call.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      return fixtureRead(call);
    };
    const pending = provider.getAbsoluteTop(query, { signal: controller.signal });
    await active;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(aborted).toBe(true);
    expect(simulator.calls.some((call) => String(call.body.query).includes("metrics."))).toBe(false);
    expect(simulator.calls.some((call) => String(call.body.query).includes(" FROM ad_group "))).toBe(false);
  });
  it("selects the received-impression rate, Search only and independent levels", () => {
    for (const level of ["campaign", "ad_group"] as const) {
      const gaql = absoluteTopMetricsQuery(query, level);
      expect(gaql).toContain(` FROM ${level} WHERE `);
      expect(gaql).toContain("campaign.status = 'ENABLED'");
      expect(gaql).toContain("campaign.advertising_channel_type = 'SEARCH'");
      expect(gaql).toContain("segments.ad_network_type = 'SEARCH'");
      expect(gaql).toContain("metrics.absolute_top_impression_percentage");
      expect(gaql).toContain("metrics.top_impression_percentage");
      expect(gaql).not.toContain("metrics.search_absolute_top_impression_share");
      expect(gaql).not.toContain("segments.hour");
      expect(gaql).toContain("segments.date BETWEEN '2026-09-30' AND '2026-09-30'");
    }
    expect(absoluteTopMetricsQuery(query, "campaign")).toContain("metrics.search_budget_lost_impression_share");
    expect(absoluteTopMetricsQuery(query, "ad_group")).not.toContain("metrics.search_budget_lost_impression_share");
    expect(absoluteTopMetricsQuery(query, "ad_group")).toContain("ad_group.status = 'ENABLED'");
  });

  it("queries active catalogs without metrics so suppressed zero rows cannot erase identities", () => {
    const campaigns = absoluteTopCatalogQuery("campaign");
    const groups = absoluteTopCatalogQuery("ad_group");
    expect(campaigns).not.toContain("metrics.");
    expect(groups).not.toContain("metrics.");
    expect(campaigns).toContain("campaign_budget.amount_micros, campaign_budget.period");
    expect(groups).not.toContain("campaign_budget.");
    expect(groups).toContain("ad_group.id, ad_group.name, ad_group.status");
    expect(groups).toContain("ad_group.status = 'ENABLED'");
    expect(campaigns).toContain("campaign.bidding_strategy_type");
  });

  it("selects source hours only for hourly reads and keeps midnight", () => {
    expect(absoluteTopMetricsQuery({ ...query, granularity: "hourly" }, "ad_group")).toContain("segments.hour");
    const [midnight] = join(
      [campaign()],
      [report(campaign(), { segments: { date: query.date_from, hour: 0, adNetworkType: "SEARCH" } })],
      "campaign",
      { ...query, granularity: "hourly" },
    );
    expect(midnight).toMatchObject({ hour: 0, date: query.date_from, absolute_top_rate: 0.8 });
  });

  it("normalizes Google's exact hyphenated account format and allows seven inclusive days", () => {
    expect(validateAbsoluteTopQuery({ ...query, account_id: "877-953-6058", date_from: "2026-09-24" })).toEqual({
      ...query,
      date_from: "2026-09-24",
    });
  });

  it.each([
    ["eight inclusive days", { date_from: "2026-09-23" }],
    ["inverted range", { date_from: "2026-10-01" }],
    ["nonexistent date", { date_from: "2026-02-30" }],
    ["date injection", { date_from: "2026-09-30' OR 1=1" }],
    ["invalid granularity", { granularity: "weekly" }],
    ["account injection", { account_id: "8779536058 OR 1=1" }],
    ["invalid account punctuation", { account_id: "877--9536058" }],
  ])("rejects %s before configuration or transport", (_label, patch) => {
    const { provider, simulator } = setup();
    expect(() => provider.getAbsoluteTop({ ...query, ...patch } as GoogleAbsoluteTopQuery)).toThrow();
    expect(simulator.calls).toHaveLength(0);
  });
});

describe("Google Absolute Top native observations", () => {
  it("keeps campaign and ad-group rates independent when the group is below its campaign", async () => {
    const { provider } = setup();
    const rows = await provider.getAbsoluteTop(query);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.level === "campaign" && r.campaign_id === "123456789012")?.absolute_top_rate).toBe(0.8);
    expect(rows.find((r) => r.ad_group_id === "9007199254740993")?.absolute_top_rate).toBe(0.4);
    expect(rows.filter((r) => r.level === "ad_group")).toHaveLength(3);
  });

  it("reads only the requested customer, its account metadata and two catalog/report pairs", async () => {
    const { provider, simulator } = setup();
    await provider.getAbsoluteTop(query);
    const calls = simulator.calls.filter((c) => c.url.hostname === "googleads.googleapis.com");
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.url.pathname === `/v25/customers/${ACCOUNT_ID}/googleAds:search`)).toBe(true);
    expect(calls.every((c) => c.headers.get("login-customer-id") === "1111111111")).toBe(true);
    expect(calls.map((c) => String(c.body.query).match(/ FROM (\w+)/)?.[1])).toEqual([
      "customer",
      "campaign",
      "campaign",
      "ad_group",
      "ad_group",
    ]);
    expect(simulator.calls.some((c) => c.url.pathname.endsWith("customers:listAccessibleCustomers"))).toBe(false);
  });

  it("preserves the source date, timezone, currency, micros and noninteger conversion totals", async () => {
    const { provider } = setup();
    const [row] = await provider.getAbsoluteTop(query);
    expect(row).toMatchObject({
      account_id: ACCOUNT_ID,
      customer_id: ACCOUNT_ID,
      account_name: account.account_name,
      currency: "USD",
      source_timezone: "America/New_York",
      date: "2026-09-30",
      hour: null,
      spend: 25,
      daily_budget: 50,
      impressions: 1000,
      clicks: 20,
      ctr: 2,
      cpc: 1.25,
      conversions: 2.5,
      bidding_strategy: "TARGET_CPA",
      domain_id: "first_domain",
      domain_name: "Primer Dominio",
      absolute_top_minimum: 0.7,
      domain_warning: null,
    });
    expect(row!.warnings).toContain("CONVERSIONS_ARE_GOOGLE_PLATFORM_TOTAL");
    expect(row!.warnings).toContain("IMPRESSION_SHARES_MAY_UPDATE_WITHIN_1_2_DAYS");
    expect(Date.parse(row!.extracted_at)).toBeGreaterThan(0);
  });

  it("keeps missing report rows and missing dates unknown through the left join", () => {
    const rows = join([campaign(), campaign("123456789013")], [report()], "campaign", {
      ...query,
      date_to: "2026-10-02",
    });
    expect(rows).toHaveLength(6);
    const unknown = rows.filter((r) => r.warnings.includes("NO_METRICS_ROW"));
    expect(unknown).toHaveLength(5);
    for (const row of unknown) {
      expect(row).toMatchObject({
        absolute_top_rate: null,
        top_of_page_rate: null,
        search_impression_share: null,
        search_lost_is_rank: null,
        search_lost_is_budget: null,
        impressions: null,
        clicks: null,
        spend: null,
        conversions: null,
        ctr: null,
        cpc: null,
      });
      expect(row.warnings).toContain("ABSOLUTE_TOP_RATE_NOT_AVAILABLE");
    }
    expect(rows.every((r) => r.extracted_at === AT)).toBe(true);
  });

  it("does not copy a daily observation across missing hours", () => {
    const rows = join(
      [group()],
      [report(group(), { segments: { date: query.date_from, hour: 0, adNetworkType: "SEARCH" } })],
      "ad_group",
      { ...query, granularity: "hourly" },
    );
    expect(rows).toHaveLength(24);
    expect(rows.map((r) => r.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    expect(rows.filter((r) => r.absolute_top_rate !== null)).toHaveLength(1);
    expect(rows[23]).toMatchObject({ hour: 23, absolute_top_rate: null, impressions: null });
  });

  it("filters inactive campaigns, non-Search campaigns and inactive groups from catalogs", () => {
    expect(
      join(
        [
          campaign(),
          campaign("2", { status: "PAUSED" }),
          campaign("3", { status: "REMOVED" }),
          campaign("4", { advertisingChannelType: "DISPLAY" }),
        ],
        [],
      ),
    ).toHaveLength(1);
    const active = group();
    expect(
      join(
        [
          active,
          { ...group("2", "2"), adGroup: { id: "2", status: "PAUSED" } },
          { ...group("3", "3"), campaign: { ...campaign("3").campaign, status: "PAUSED" } },
          { ...group("4", "4"), campaign: { ...campaign("4").campaign, advertisingChannelType: "DISPLAY" } },
        ],
        [],
        "ad_group",
      ),
    ).toHaveLength(1);
  });

  it("retains explicit zeros without making a ratio or denominator up", () => {
    const [row] = join(
      [campaign()],
      [
        report(campaign(), {
          metrics: {
            absoluteTopImpressionPercentage: 0,
            topImpressionPercentage: "0",
            searchImpressionShare: 0,
            searchRankLostImpressionShare: 0,
            searchBudgetLostImpressionShare: 0,
            impressions: "0",
            clicks: "0",
            costMicros: "0",
            conversions: 0,
          },
        }),
      ],
    );
    expect(row).toMatchObject({
      absolute_top_rate: 0,
      top_of_page_rate: 0,
      search_impression_share: 0,
      search_lost_is_rank: 0,
      search_lost_is_budget: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      ctr: null,
      cpc: null,
    });
    expect(row!.warnings).not.toContain("ABSOLUTE_TOP_RATE_NOT_AVAILABLE");
  });

  it.each([undefined, null, "", " ", "NaN", "Infinity", -0.1, 1.1, {}, true])(
    "keeps unavailable or invalid ratio %j unknown rather than zero",
    (value) => {
      const [row] = join([campaign()], [report(campaign(), { metrics: { absoluteTopImpressionPercentage: value } })]);
      expect(row!.absolute_top_rate).toBeNull();
      expect(row!.top_of_page_rate).toBeNull();
      expect(row!.warnings).toContain("ABSOLUTE_TOP_RATE_NOT_AVAILABLE");
      expect(row!.impressions).toBeNull();
    },
  );

  it("censors official share sentinels with bounds, but retains identical numbers in rates", () => {
    const [row] = join(
      [campaign()],
      [
        report(campaign(), {
          metrics: {
            ...report().metrics,
            absoluteTopImpressionPercentage: 0.0999,
            topImpressionPercentage: 0.9001,
            searchImpressionShare: 0.0999,
            searchRankLostImpressionShare: 0.9001,
            searchBudgetLostImpressionShare: 0.9001,
          },
        }),
      ],
    );
    expect(row).toMatchObject({
      absolute_top_rate: 0.0999,
      top_of_page_rate: 0.9001,
      search_impression_share: null,
      search_lost_is_rank: null,
      search_lost_is_budget: null,
      share_bounds: {
        search_impression_share: "lt_10_percent",
        search_lost_is_rank: "gt_90_percent",
        search_lost_is_budget: "gt_90_percent",
      },
    });
    expect(row!.warnings).not.toContain("ABSOLUTE_TOP_RATE_NOT_AVAILABLE");
  });

  it("does not infer share bounds from ordinary rates or nearby uncensored shares", () => {
    const [row] = join(
      [campaign()],
      [
        report(campaign(), {
          metrics: {
            ...report().metrics,
            searchImpressionShare: 0.1,
            searchRankLostImpressionShare: 0.9,
            searchBudgetLostImpressionShare: 0.9,
          },
        }),
      ],
    );
    expect(row).toMatchObject({ search_impression_share: 0.1, search_lost_is_rank: 0.9, search_lost_is_budget: 0.9 });
    expect(row).not.toHaveProperty("share_bounds");
  });

  it("never assigns a campaign budget or its loss share to an ad group", () => {
    const [row] = join([group()], [report(group())], "ad_group");
    expect(row).toMatchObject({ search_lost_is_budget: null, daily_budget: null, search_lost_is_rank: 0.15 });
    expect(row!.warnings).toContain("AD_GROUP_LOST_IS_BUDGET_NOT_AVAILABLE");
    expect(row).not.toHaveProperty("share_bounds.search_lost_is_budget");
  });

  it("does not convert a lifetime or negative budget into a daily budget", () => {
    for (const budget of [
      { amountMicros: "50000000", period: "CUSTOM_PERIOD" },
      { amountMicros: "-1000000", period: "DAILY" },
      { amountMicros: "not-a-number", period: "DAILY" },
    ]) {
      const entity = { ...campaign(), campaignBudget: budget };
      expect(join([entity], [report(entity)])[0]!.daily_budget).toBeNull();
    }
  });

  it("keeps unsafe or invalid counts, negative money and missing conversions unknown", () => {
    const [row] = join(
      [campaign()],
      [report(campaign(), { metrics: { impressions: "9007199254740993", clicks: "1.5", costMicros: "-1" } })],
    );
    expect(row).toMatchObject({
      impressions: null,
      clicks: null,
      spend: null,
      conversions: null,
      ctr: null,
      cpc: null,
    });
  });

  it("classifies an unknown customer explicitly without assigning a configured domain", () => {
    const unknown = { ...account, account_id: "2222222222" };
    const [row] = joinAbsoluteTopRows(
      [campaign()],
      [],
      unknown,
      { ...query, account_id: unknown.account_id },
      "campaign",
      AT,
    );
    expect(row).toMatchObject({ domain_id: "unclassified", domain_name: "Unclassified", absolute_top_minimum: null });
    expect(row!.warnings).toContain("GOOGLE_DOMAIN_UNCLASSIFIED");
  });
});

describe("Google Absolute Top rejects ambiguous upstream observations", () => {
  it.each([
    ["foreign customer", { customer: { id: "2222222222" } }],
    ["foreign campaign", { campaign: { ...campaign().campaign, id: "999" } }],
    ["date outside the range", { segments: { date: "2026-09-29" } }],
    ["invalid real date", { segments: { date: "2026-02-30" } }],
    ["Search partners", { segments: { date: query.date_from, adNetworkType: "SEARCH_PARTNERS" } }],
    ["missing selected network", { segments: { date: query.date_from } }],
    ["hourly row in a daily report", { segments: { date: query.date_from, adNetworkType: "SEARCH", hour: 0 } }],
    ["missing date", { segments: {} }],
    ["missing metrics object", { metrics: undefined }],
  ])("rejects %s with a sanitized provider error", (_label, patch) => {
    expect(() => join([campaign()], [report(campaign(), patch as GoogleRow)])).toThrow(
      "Google Ads devolvió una observación Absolute Top inválida.",
    );
  });

  it.each([undefined, -1, 24, 1.5, "0"])("rejects invalid hourly segment %j", (hour) => {
    const metrics = report(campaign(), { segments: { date: query.date_from, hour: hour as number } });
    expect(() => join([campaign()], [metrics], "campaign", { ...query, granularity: "hourly" })).toThrow();
  });

  it("rejects duplicate catalog identities and daily observations instead of double counting", () => {
    expect(() => join([campaign(), campaign()], [])).toThrow();
    expect(() => join([campaign()], [report(), report()])).toThrow();
    expect(() => join([group(), group()], [], "ad_group")).toThrow();
  });

  it("rejects duplicate group hours but accepts independent midnight and 23:00 observations", () => {
    const atHour = (hour: number) =>
      report(group(), { segments: { date: query.date_from, hour, adNetworkType: "SEARCH" } });
    const hourly = { ...query, granularity: "hourly" as const };
    expect(() => join([group()], [atHour(0), atHour(0)], "ad_group", hourly)).toThrow();
    const rows = join([group()], [atHour(0), atHour(23)], "ad_group", hourly);
    expect(rows.filter((r) => r.absolute_top_rate === 0.8).map((r) => r.hour)).toEqual([0, 23]);
  });

  it("does not accept a group's data under another parent campaign", () => {
    const wrongParent = report(group("999", "9007199254740993"));
    expect(() => join([group()], [wrongParent], "ad_group")).toThrow();
  });

  it("requires canonical entity IDs without coercing unsafe numeric or leading-zero IDs", () => {
    for (const id of [undefined, "0", "01", "abc", "123 OR 1=1", 9007199254740992]) {
      expect(() => join([{ ...campaign(), campaign: { ...campaign().campaign, id: id as string } }], [])).toThrow();
    }
    const broken = { ...group(), adGroup: { ...group().adGroup, id: "01" } };
    expect(() => join([broken], [], "ad_group")).toThrow();
  });

  it("rejects missing catalog status or channel instead of silently reporting an empty catalog", () => {
    for (const patch of [{ status: undefined }, { advertisingChannelType: undefined }]) {
      expect(() => join([{ ...campaign(), campaign: { ...campaign().campaign, ...patch } }], [])).toThrow();
    }
    expect(() => join([{ ...group(), adGroup: { id: "123", name: "Grupo sin estado" } }], [], "ad_group")).toThrow();
  });

  it("rejects an expansion above the observation limit without allocating rows", () => {
    const entities = Array.from({ length: 596 }, (_, i) => campaign(String(i + 1)));
    expect(() => join(entities, [], "campaign", { ...query, date_from: "2026-09-24", granularity: "hourly" })).toThrow(
      "Absolute Top excede el límite de observaciones de una lectura.",
    );
  });

  it("rejects a manager account before campaign or group reads", async () => {
    const { provider, simulator, fixture } = setup();
    fixture.account.is_manager = true;
    await expect(provider.getAbsoluteTop(query)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(simulator.calls.filter((c) => String(c.body.query).includes(" FROM campaign"))).toHaveLength(0);
  });
});

describe("Google domain metadata across existing public endpoints", () => {
  it.each(["accounts", "campaigns", "performance", "conversions", "budgets", "delivery-health"])(
    "retains the master metadata in serialized /%s responses",
    async (endpoint) => {
      const simulator = new GoogleSimulator();
      simulator.intercept = (call) => {
        const gaql = String(call.body.query);
        if (gaql.endsWith(" FROM customer"))
          return Response.json({
            results: [
              {
                customer: {
                  id: ACCOUNT_ID,
                  descriptiveName: account.account_name,
                  currencyCode: account.currency,
                  timeZone: account.timezone,
                  manager: false,
                  status: "ENABLED",
                },
              },
            ],
          });
        if (gaql.includes("campaign_budget.amount_micros"))
          return Response.json({
            results: [
              {
                ...campaign(),
                campaign: { ...campaign().campaign, servingStatus: "SERVING" },
              },
            ],
          });
        if (gaql.includes("campaign.primary_status,"))
          return Response.json({
            results: [
              {
                campaign: {
                  ...campaign().campaign,
                  primaryStatus: "ELIGIBLE",
                  primaryStatusReasons: ["BUDGET_CONSTRAINED"],
                },
              },
            ],
          });
        return undefined;
      };
      const provider = new GoogleProvider(
        { ...GOOGLE_ENV, GOOGLE_ADS_CUSTOMER_IDS: ACCOUNT_ID },
        { fetch: simulator.fetch, retry: { retries: 0 } },
      );
      const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
      try {
        const suffix = endpoint === "accounts" ? "" : `&account_id=${ACCOUNT_ID}`;
        const range = ["performance", "conversions"].includes(endpoint)
          ? "&date_from=2026-09-30&date_to=2026-09-30"
          : "";
        const response = await app.inject({
          url: `/api/v1/${endpoint}?provider=google${suffix}${range}`,
          headers: { "x-api-key": KEY },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().errors).toEqual([]);
        expect(response.json().data.length).toBeGreaterThan(0);
        for (const row of response.json().data)
          expect(row).toMatchObject({
            account_id: ACCOUNT_ID,
            account_name: expect.any(String),
            customer_id: ACCOUNT_ID,
            domain_id: "first_domain",
            domain_name: "Primer Dominio",
            absolute_top_minimum: 0.7,
            domain_warning: null,
          });
      } finally {
        await app.close();
      }
    },
  );
});

describe("Google Absolute Top API schema and access", () => {
  const headers = { "x-api-key": KEY, "x-request-id": "absolute-top-fixture-request" };
  const path = `/api/v1/google/absolute-top?account_id=${ACCOUNT_ID}&date_from=2026-09-30&date_to=2026-09-30`;

  async function withApp(
    work: (app: Awaited<ReturnType<typeof makeApp>>, state: ReturnType<typeof setup>) => Promise<void>,
  ) {
    const state = setup();
    const app = await makeApp({}, { registry: new ProviderRegistry([state.provider]) });
    try {
      await work(app, state);
    } finally {
      await app.close();
    }
  }

  it("preserves native levels, domain metadata, bounds and nulls through response serialization", () =>
    withApp(async (app, { fixture }) => {
      fixture.campaignMetrics[0]!.metrics!.searchImpressionShare = 0.0999;
      fixture.campaignMetrics[0]!.metrics!.searchRankLostImpressionShare = 0.9001;
      const response = await app.inject({ url: path, headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ errors: [], request_id: "absolute-top-fixture-request" });
      const rows = response.json().data;
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({
        platform: "google",
        customer_id: ACCOUNT_ID,
        domain_id: "first_domain",
        domain_name: "Primer Dominio",
        absolute_top_minimum: 0.7,
        domain_warning: null,
        level: "campaign",
        ad_group_id: null,
        absolute_top_rate: 0.8,
        search_impression_share: null,
        share_bounds: { search_impression_share: "lt_10_percent", search_lost_is_rank: "gt_90_percent" },
        currency: "USD",
        source_timezone: "America/New_York",
      });
      expect(rows.find((r: { ad_group_id: string | null }) => r.ad_group_id === "9007199254740993")).toMatchObject({
        level: "ad_group",
        absolute_top_rate: 0.4,
        search_lost_is_budget: null,
        daily_budget: null,
      });
      expect(rows[1]).toMatchObject({ campaign_id: "123456789013", absolute_top_rate: null, impressions: null });
      for (const secret of ["test-client-secret", "test-refresh-token", "test-access-1"])
        expect(response.body).not.toContain(secret);
    }));

  it("requires the internal API key before reading upstream", () =>
    withApp(async (app, { simulator }) => {
      expect((await app.inject({ url: path })).statusCode).toBe(401);
      expect(simulator.calls).toHaveLength(0);
    }));

  it.each([
    "date_from=2026-09-30&date_to=2026-09-30",
    `account_id=${ACCOUNT_ID}&date_from=2026-09-23&date_to=2026-09-30`,
    `account_id=${ACCOUNT_ID}&date_from=2026-10-01&date_to=2026-09-30`,
    `account_id=${ACCOUNT_ID}&date_from=2026-02-30&date_to=2026-09-30`,
    `account_id=${ACCOUNT_ID}&date_from=2026-09-30&date_to=2026-09-30&granularity=weekly`,
    `account_id=${ACCOUNT_ID}&date_from=2026-09-30&date_to=2026-09-30&provider=meta`,
    `account_id=${ACCOUNT_ID}&date_from=2026-09-30&date_to=2026-09-30&access_token=not-accepted`,
  ])("rejects invalid or extra query parameters before transport: %s", (suffix) =>
    withApp(async (app, { simulator }) => {
      const response = await app.inject({ url: `/api/v1/google/absolute-top?${suffix}`, headers });
      expect(response.statusCode).toBe(400);
      expect(simulator.calls).toHaveLength(0);
    }),
  );

  it("serializes a foreign-customer observation as an error without returning contaminated data", () =>
    withApp(async (app, { fixture }) => {
      fixture.groupMetrics[0]!.customer = { id: "2222222222" };
      const response = await app.inject({ url: path, headers });
      expect(response.statusCode, response.body).toBe(502);
      expect(response.json().error.code).toBe("PROVIDER_ERROR");
      expect(response.json()).not.toHaveProperty("data");
    }));

  it("documents the bounded read and API-key security in OpenAPI", () =>
    withApp(async (app) => {
      const docs = (await app.inject("/docs/json")).json();
      const route = docs.paths["/api/v1/google/absolute-top"].get;
      expect(route.security).toEqual([{ ApiKeyAuth: [] }]);
      const required = route.parameters
        .filter((p: { required: boolean }) => p.required)
        .map((p: { name: string }) => p.name);
      expect(required).toEqual(expect.arrayContaining(["account_id", "date_from", "date_to"]));
      expect(route.responses["200"]).toBeDefined();
    }));
});
