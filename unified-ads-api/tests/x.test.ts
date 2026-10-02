import { describe, expect, it } from "vitest";
import { XProvider } from "../src/providers/x/index.js";
import { XClient } from "../src/providers/x/client.js";
import { oauthHeader } from "../src/providers/x/auth.js";
import { readXConfig, X_PLACEMENTS } from "../src/providers/x/config.js";
import { xError } from "../src/providers/x/errors.js";
import { pollDelay, reportWindows, timezoneOffset } from "../src/providers/x/reports.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { ApiError } from "../src/utils/errors.js";
import { makeApp, KEY } from "./helpers.js";
import { ACCOUNT, SECOND, CAMPAIGN, XSimulator as Sim, json } from "./x-simulator.js";
const query = { account_id: ACCOUNT, date_from: "2026-09-28", date_to: "2026-09-29", granularity: "daily" as const };
function setup(extra: Record<string, string | undefined> = {}) {
  const sim = new Sim(),
    env = { ...sim.env, ...extra };
  const provider = new XProvider(env, {
    fetch: sim.fetch,
    retry: { sleep: async () => undefined },
    wait: async () => undefined,
  });
  return { sim, provider, env };
}
describe("X OAuth and configuration", () => {
  it("matches the published RFC 5849 signature with duplicate and encoded parameters", () => {
    const header = oauthHeader(
      "POST",
      new URL("http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b"),
      {
        consumerKey: "9djdj82h48djs9d2",
        consumerSecret: "j49sk3j29djd",
        accessToken: "kkk9d7dh3k39sjv7",
        accessTokenSecret: "dh893hdasih9",
      },
      { nonce: "7d8f3e4a", timestamp: 137131201, includeVersion: false, form: new URLSearchParams("c2&a3=2+q") },
    );
    expect(header).toContain('oauth_signature="r6%2FTJjbCOr97%2F%2BUU0NsvSne7s5g%3D"');
  });
  it("does not call a configured client when credentials are missing", async () => {
    const p = new XProvider({});
    expect(await p.status()).toMatchObject({ state: "not_configured", implemented: true });
    await expect(p.listAccounts({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it.each([
    { X_ADS_API_VERSION: "11" },
    { X_ADS_CONSUMER_SECRET: "bad\nvalue" },
    { X_ADS_ACCOUNT_IDS: "../x" },
    { X_ADS_TIMEOUT_MS: "0" },
    { X_ADS_RETRIES: "6" },
    { X_ADS_PRIMARY_CONVERSION_METRIC: "conversion_total" },
    { X_ADS_CONVERSION_ATTRIBUTION: "total" },
    { X_ADS_REPORT_MODE: "invalid" },
    { X_ADS_CONVERSION_MAPPING: '{"conversion_purchases":"purchase"}' },
    { X_ADS_PRIMARY_CONVERSION_MAPPING: '{"abc":"unknown"}' },
  ])("rejects invalid configuration %j", (extra) => {
    const { provider } = setup(extra);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.missingConfig()).toContain(Object.keys(extra)[0]);
  });
  it("inherits the route timeout and exposes its own configured override", () => {
    expect(setup({ X_ADS_TIMEOUT_MS: "120000" }).provider.timeoutMs).toBe(120000);
    expect(ProviderRegistry.fromEnv(setup().env, 25000).bySlug("x")?.timeoutMs).toBe(25000);
  });
  it("only reports connected after an actual transport response", async () => {
    const { provider, sim } = setup();
    expect((await provider.status()).state).toBe("connected");
    expect(sim.calls).toHaveLength(1);
    sim.handler = () => json({ errors: [{ code: "UNAUTHORIZED", message: "PRIVATE_TOKEN" }] }, 401);
    const s = await provider.status();
    expect(s).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
    expect(JSON.stringify(s)).not.toContain("PRIVATE_TOKEN");
  });
  it.each([
    [403, "READONLY_CLIENT_APPLICATION", "access_required"],
    [403, "NO_ACCESS", "permission_denied"],
    [429, "TOO_MANY_REQUESTS", "degraded"],
  ])("uses shared states for %s / %s", async (status, code, state) => {
    const { sim, provider } = setup();
    sim.handler = () => json({ errors: [{ code }] }, Number(status));
    expect((await provider.status()).state).toBe(state);
  });
});
describe("X safe HTTP and rate limits", () => {
  it("explains the post-approval user token renewal without exposing vendor messages", () => {
    const error = xError(403, {
      errors: [{ code: "INSUFFICIENT_USER_AUTHORIZED_PERMISSION", message: "PRIVATE_VENDOR_MESSAGE" }],
    });
    expect(error).toMatchObject({ code: "ACCESS_DENIED", details: { limitation: "user_authorization" } });
    expect(error.message).toContain("permisos");
    expect(error.message).toContain("Read and Write");
    expect(JSON.stringify(error)).not.toContain("PRIVATE_VENDOR_MESSAGE");
  });
  it("interprets reset headers as epoch seconds with account precedence", () => {
    expect(
      xError(429, {}, new Headers({ "x-rate-limit-reset": "110", "x-account-rate-limit-reset": "115" }), 100000)
        .retryAfter,
    ).toBe(15);
    expect(xError(429, {}, new Headers({ "retry-after": "7", "x-rate-limit-reset": "115" }), 100000).retryAfter).toBe(
      7,
    );
  });
  it("waits until the reset and signs a fresh nonce on retry", async () => {
    const { sim, env } = setup({ X_ADS_RETRIES: "1" });
    let attempts = 0;
    const waits: number[] = [];
    sim.handler = () => (attempts++ === 0 ? json({}, 429, { "retry-after": "12" }) : undefined);
    const c = new XClient(readXConfig(env).config!, sim.fetch, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await c.call("/accounts", {}, AbortSignal.timeout(1000));
    expect(waits).toEqual([12000]);
    expect(sim.calls[0]!.init.headers).not.toEqual(sim.calls[1]!.init.headers);
  });
  it("does not retry before a reset beyond the timeout", async () => {
    const { sim, provider } = setup({ X_ADS_RETRIES: "3" });
    sim.handler = () => json({}, 429, { "retry-after": "600" });
    expect((await provider.status()).state).toBe("degraded");
    expect(sim.calls).toHaveLength(1);
  });
  it.each([400, 401, 403])("does not retry HTTP %i", async (status) => {
    const { sim, provider } = setup({ X_ADS_RETRIES: "3" });
    sim.handler = () => json({}, status);
    await provider.status();
    expect(sim.calls).toHaveLength(1);
  });
  it("does not retry ambiguous job creation after a network failure", async () => {
    const { sim, env } = setup({ X_ADS_RETRIES: "3" });
    sim.handler = () => {
      throw new Error("PRIVATE_URL");
    };
    const c = new XClient(readXConfig(env).config!, sim.fetch, { sleep: async () => undefined });
    await expect(
      c.call(`/stats/jobs/accounts/${ACCOUNT}`, {}, AbortSignal.timeout(1000), "POST"),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(1);
  });
  it("rejects redirects and arbitrary paths before sending OAuth credentials", async () => {
    const { sim, env } = setup();
    const c = new XClient(readXConfig(env).config!, sim.fetch);
    for (const path of ["https://evil.test", "/accounts/../token", "/accounts/a/campaigns/../../token"])
      await expect(c.call(path, {}, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(sim.calls).toHaveLength(0);
  });
  it("rejects malformed JSON without retries or leaking content", async () => {
    const { sim, provider } = setup({ X_ADS_RETRIES: "3" });
    sim.handler = () => new Response("PRIVATE_JSON");
    const state = await provider.status();
    expect(state.state).toBe("error");
    expect(JSON.stringify(state)).not.toContain("PRIVATE_JSON");
    expect(sim.calls).toHaveLength(1);
  });
  it("honors cancellation before any request", async () => {
    const { sim, provider } = setup();
    await expect(provider.listAccounts({}, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(sim.calls).toHaveLength(0);
  });
});
describe("X accounts, campaigns and pagination", () => {
  it("derives account currency from funding instruments without inventing a campaign objective", async () => {
    const { provider } = setup({ X_ADS_CLIENT_MAPPING: JSON.stringify({ [ACCOUNT]: "izzi" }) });
    expect(await provider.listAccounts({ client_id: "izzi" })).toMatchObject([
      { account_id: ACCOUNT, currency: "MXN", timezone: "America/Mexico_City" },
    ]);
    expect(await provider.listCampaigns({ account_id: ACCOUNT })).toMatchObject([
      { campaign_id: CAMPAIGN, campaign_status: "active", objective: null },
    ]);
  });
  it("lists deleted campaigns so historical reports are not lost", async () => {
    const { sim, provider } = setup();
    sim.campaigns[0]!.deleted = true;
    expect(await provider.listCampaigns({})).toMatchObject([{ campaign_status: "removed" }]);
    expect(sim.calls.find((c) => c.url.pathname.endsWith("/campaigns"))?.url.searchParams.get("with_deleted")).toBe(
      "true",
    );
  });
  it("keeps authorized accounts and emits warnings for denied configured accounts", async () => {
    const { sim, provider } = setup({ X_ADS_ACCOUNT_IDS: `${ACCOUNT},${SECOND}` });
    const warnings: ApiError[] = [];
    sim.handler = (u) => (u.pathname.endsWith(SECOND) ? json({}, 403) : undefined);
    expect(await provider.listCampaigns({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings).toMatchObject([{ code: "ACCESS_DENIED", details: { account_id: SECOND } }]);
    await expect(provider.listCampaigns({ account_id: SECOND })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("rejects duplicate entity IDs across pages", async () => {
    const { sim, provider } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/campaigns") ? json({ data: sim.campaigns, next_cursor: "next" }) : undefined;
    await expect(provider.listCampaigns({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("does not claim an empty success when every account is denied", async () => {
    const { sim, provider } = setup();
    sim.handler = () => json({}, 403);
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
describe("X reporting contract", () => {
  it("rejects a correct-length report echoing a different date range", async () => {
    const { sim, provider } = setup();
    sim.handler = (u) => {
      if (!u.pathname.includes("/stats/accounts/")) return undefined;
      const body = sim.stats(u);
      body.request.params.start_time = "2025-09-28T06:00:00Z";
      return json(body);
    };
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("rejects a download pointing at another job on the official CDN", async () => {
    const { sim, env } = setup();
    await expect(
      new XClient(readXConfig(env).config!, sim.fetch).download(
        "https://ton.twimg.com/advertiser-api-async-analytics/stats_job_2.json.gz",
        AbortSignal.timeout(1000),
        "1",
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(0);
  });
  it("preserves authorized accounts when another funding lookup is denied", async () => {
    const { sim, provider } = setup({ X_ADS_ACCOUNT_IDS: `${ACCOUNT},${SECOND}` });
    sim.handler = (u) =>
      u.pathname === `/12/accounts/${SECOND}`
        ? json({ data: { ...sim.account, id: SECOND } })
        : u.pathname === `/12/accounts/${SECOND}/funding_instruments`
          ? json({}, 403)
          : undefined;
    const warnings: ApiError[] = [];
    expect(await provider.listAccounts({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings[0]?.details).toMatchObject({ account_id: SECOND });
  });
  it("cancels oversized JSON before attempting another request", async () => {
    const { sim, provider } = setup({ X_ADS_RETRIES: "3" });
    sim.handler = () => new Response("{}", { headers: { "content-length": "10485761" } });
    expect((await provider.status()).last_error?.code).toBe("PROVIDER_ERROR");
    expect(sim.calls).toHaveLength(1);
  });
  it("treats an explicit null as documented zero activity, but an omitted metric as unknown", async () => {
    const { sim, provider } = setup();
    let omitted = false;
    sim.handler = (u) => {
      if (!u.pathname.includes("/stats/accounts/")) return undefined;
      const body = sim.stats(u);
      if (u.searchParams.get("placement") === "TREND") {
        const metrics = body.data[0]!.id_data[0]!.metrics as Record<string, unknown>;
        if (omitted) delete metrics.impressions;
        else metrics.impressions = null;
      }
      return json(body);
    };
    const first = (await provider.getPerformance(query))[0]!;
    expect(first.impressions).toBe(200);
    expect(first.raw_metrics.placements).toMatchObject({ TREND: { impressions: null } });
    omitted = true;
    expect((await provider.getPerformance(query))[0]!.impressions).toBeNull();
  });
  it("preserves unselected attribution and sale amounts for reconciliation", async () => {
    const row = (await setup().provider.getConversions(query))[0]!;
    expect(row.raw_metrics?.placements).toMatchObject({
      ALL_ON_TWITTER: { conversion_purchases: { post_engagement: 2, post_view: 5, sale_amount: 100 } },
    });
    expect(row.conversion_value).toBeNull();
  });
  it("batches at most twenty campaign IDs without losing campaigns", async () => {
    const { sim, provider } = setup();
    sim.campaigns = Array.from({ length: 21 }, (_, i) => ({
      id: `c${i}`,
      name: `Campaign ${i}`,
      entity_status: "ACTIVE",
      currency: "MXN",
    }));
    const rows = await provider.getPerformance({ ...query, date_to: query.date_from });
    expect(rows).toHaveLength(21);
    const calls = sim.calls.filter((c) => c.url.pathname.includes("/stats/accounts/"));
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.url.searchParams.get("entity_ids")!.split(",").length <= 20)).toBe(true);
  });
  it("does not retry or turn a failed job into empty data", async () => {
    const { sim, provider } = setup({ X_ADS_REPORT_MODE: "async" });
    sim.handler = (u) =>
      u.pathname.includes("/stats/jobs/")
        ? json({ data: { id_str: "1120829647711653888", status: "FAILED", url: null } })
        : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls.filter((c) => c.url.pathname.includes("/stats/jobs/"))).toHaveLength(1);
  });
  it("uses inclusive user dates and an exclusive vendor end at account midnight", async () => {
    const { sim, provider } = setup();
    const warnings: ApiError[] = [];
    const rows = await provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      spend: 7,
      impressions: 300,
      clicks: 30,
      link_clicks: 9,
      conversions: null,
      cpa: null,
      source_timezone: "America/Mexico_City",
      date: "2026-09-28",
      currency: "MXN",
    });
    const calls = sim.calls.filter((c) => c.url.pathname.includes("/stats/accounts/"));
    expect(calls.map((c) => c.url.searchParams.get("placement"))).toEqual([...X_PLACEMENTS]);
    expect(calls[0]!.url.searchParams.get("start_time")).toBe("2026-09-28T06:00:00Z");
    expect(calls[0]!.url.searchParams.get("end_time")).toBe("2026-09-30T06:00:00Z");
    expect(warnings[0]?.details).toMatchObject({ limitation: "primary_conversion_not_selected" });
  });
  it("sums spend and selected conversion counts before calculating CPA", async () => {
    const { provider } = setup({ X_ADS_PRIMARY_CONVERSION_METRIC: "conversion_purchases" });
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      spend: 7,
      conversions: 4,
      cpa: 1.75,
      conversion_value: null,
    });
  });
  it("keeps shared categories and post-view counts separate from post-engagement", async () => {
    const { provider } = setup();
    const rows = await provider.getConversions(query);
    expect(rows[0]).toMatchObject({
      source_conversion: "conversion_purchases",
      normalized_conversion: "PURCHASE",
      conversions: 4,
    });
    expect(rows[1]).toMatchObject({ normalized_conversion: "REGISTRATION", conversions: 3 });
    expect(
      (await setup({ X_ADS_CONVERSION_ATTRIBUTION: "post_view" }).provider.getConversions(query))[0]?.conversions,
    ).toBe(15);
  });
  it("uses the official current-day offset for historical DST dates", () => {
    expect(timezoneOffset("America/Los_Angeles", new Date("2026-10-01T12:00:00Z"))).toBe(-420);
    expect(timezoneOffset("Asia/Tokyo")).toBe(540);
    expect(() => timezoneOffset("invalid")).toThrow();
  });
  it("keeps hourly labels in the reporting timezone", async () => {
    const rows = await setup().provider.getPerformance({ ...query, date_to: query.date_from, granularity: "hourly" });
    expect(rows).toHaveLength(24);
    expect(rows[0]).toMatchObject({ date: query.date_from, hour: 0 });
    expect(rows[23]).toMatchObject({ date: query.date_from, hour: 23 });
  });
  it("chunks long ranges into 30-day windows without overlap", () => {
    expect(reportWindows({ ...query, date_from: "2026-01-01", date_to: "2026-02-01" })).toEqual([
      { from: "2026-01-01", to: "2026-01-30" },
      { from: "2026-01-31", to: "2026-02-01" },
    ]);
    expect(() => reportWindows({ ...query, date_from: "2026-02-30" })).toThrow();
  });
  it("uses asynchronous jobs for backfills, retaining 64-bit job IDs and omitting CDN auth", async () => {
    const { sim, provider } = setup();
    expect(await provider.getPerformance({ ...query, date_from: "2026-09-01", date_to: "2026-09-10" })).toHaveLength(
      10,
    );
    const polls = sim.calls.filter((c) => c.url.searchParams.has("job_ids"));
    expect(polls[0]!.url.searchParams.get("job_ids")).toBe("1120829647711653888");
    const downloads = sim.calls.filter((c) => c.url.hostname === "ton.twimg.com");
    expect(downloads).toHaveLength(3);
    expect(downloads[0]!.init.headers).toBeUndefined();
    expect(downloads[0]!.init.redirect).toBe("error");
  });
  it("bounds polling and does not report pending jobs as empty activity", async () => {
    const { sim, provider } = setup({ X_ADS_REPORT_MODE: "async" });
    sim.handler = (u, init) =>
      u.pathname.includes("/stats/jobs/") && init.method === "GET"
        ? json({ data: [{ id_str: u.searchParams.get("job_ids"), status: "PROCESSING" }] })
        : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
  it.each([
    "https://evil.test/report.gz",
    "https://ton.twimg.com.evil.test/advertiser-api-async-analytics/stats_job_1.json.gz",
    "http://ton.twimg.com/advertiser-api-async-analytics/stats_job_1.json.gz",
    "https://ton.twimg.com/other/1.json.gz",
  ])("rejects an untrusted download %s", async (url) => {
    const { sim, env } = setup();
    await expect(
      new XClient(readXConfig(env).config!, sim.fetch).download(url, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(sim.calls).toHaveLength(0);
  });
  it("rejects mismatched series length and never turns omitted entities into zero", async () => {
    const { sim, provider } = setup();
    sim.handler = (u) =>
      u.pathname.includes("/stats/accounts/") ? json({ time_series_length: 2, data: [] }) : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("rejects ranges before a timezone switch", async () => {
    await expect(
      setup().provider.getPerformance({ ...query, date_from: "2016-01-01", date_to: "2016-01-02" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("exposes X through the same authenticated API routes", async () => {
    const { provider } = setup();
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/performance?provider=x&account_id=${ACCOUNT}&date_from=2026-09-28&date_to=2026-09-29`,
        headers: { "x-api-key": KEY },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
      expect(res.body).not.toContain("synthetic-token");
    } finally {
      await app.close();
    }
  });
});

describe("X: ubicaciones configurables y espera de trabajos (auditoría de Claude)", () => {
  it("acepta PUBLISHER_NETWORK u otras ubicaciones admitidas y rechaza valores desconocidos", () => {
    const sim = new Sim();
    expect(readXConfig(sim.env).config?.placements).toEqual([...X_PLACEMENTS]);
    expect(
      readXConfig({ ...sim.env, X_ADS_PLACEMENTS: "all_on_twitter, PUBLISHER_NETWORK" }).config?.placements,
    ).toEqual(["ALL_ON_TWITTER", "PUBLISHER_NETWORK"]);
    expect(readXConfig({ ...sim.env, X_ADS_PLACEMENTS: "ALL_ON_TWITTER,SEARCH" }).missing).toContain(
      "X_ADS_PLACEMENTS",
    );
  });

  it("solo pide las ubicaciones configuradas", async () => {
    const { sim, provider } = setup({ X_ADS_PLACEMENTS: "ALL_ON_TWITTER" });
    await provider.getPerformance(query);
    const calls = sim.calls.filter((c) => c.url.pathname.includes("/stats/accounts/"));
    expect(calls.map((c) => c.url.searchParams.get("placement"))).toEqual(["ALL_ON_TWITTER"]);
  });

  it("espacia las consultas de estado: 1, 2, 4, 8 y después 10 segundos", () => {
    expect([0, 1, 2, 3, 4, 5, 30].map(pollDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });
});
