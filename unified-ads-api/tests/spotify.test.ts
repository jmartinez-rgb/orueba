import { describe, expect, it } from "vitest";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { SpotifyClient, spotifyJson } from "../src/providers/spotify/client.js";
import { readSpotifyConfig, spotifyId } from "../src/providers/spotify/config.js";
import { spotifyError } from "../src/providers/spotify/errors.js";
import { campaignStatus, reportBucket, reportMetrics } from "../src/providers/spotify/normalize.js";
import { reportRanges } from "../src/providers/spotify/queries.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import type { ApiError } from "../src/utils/errors.js";
import { KEY, makeApp } from "./helpers.js";
import { SpotifySimulator as Sim, ACCOUNT, SECOND, BUSINESS, CAMPAIGN, json } from "./spotify-simulator.js";

const query = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const, account_id: ACCOUNT };
function setup(extra: Record<string, string | undefined> = {}) {
  const sim = new Sim(),
    env = { ...sim.env, ...extra };
  const provider = new SpotifyProvider(env, { fetch: sim.fetch, retry: { sleep: async () => undefined } });
  return { sim, env, provider };
}
const dataCalls = (sim: Sim) => sim.calls.filter((c) => c.path.startsWith("/ads/"));
const reportCalls = (sim: Sim) => sim.calls.filter((c) => c.path.endsWith("aggregate_reports"));

describe("Spotify configuration and actual authorization", () => {
  it("missing credentials never calls the network and remains not_configured", async () => {
    const provider = new SpotifyProvider({});
    expect(await provider.status()).toMatchObject({
      state: "not_configured",
      implemented: true,
      missing_config: ["SPOTIFY_ADS_CLIENT_ID", "SPOTIFY_ADS_CLIENT_SECRET", "SPOTIFY_ADS_REFRESH_TOKEN"],
    });
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it.each([
    { SPOTIFY_ADS_CLIENT_ID: "bad/header" },
    { SPOTIFY_ADS_CLIENT_SECRET: "bad\nheader" },
    { SPOTIFY_ADS_REFRESH_TOKEN: "bad\rheader" },
    { SPOTIFY_ADS_API_VERSION: "v4" },
    { SPOTIFY_ADS_ACCOUNT_IDS: "12" },
    { SPOTIFY_ADS_BUSINESS_IDS: ACCOUNT + "/campaigns" },
    { SPOTIFY_ADS_TIMEOUT_MS: "0" },
    { SPOTIFY_ADS_RETRIES: "6" },
    { SPOTIFY_ADS_CLIENT_MAPPING: "[]" },
    { SPOTIFY_ADS_CONVERSION_MAPPING: '{"UNKNOWN":"purchase"}' },
    { SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "REVENUE" },
    { SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING: JSON.stringify({ [ACCOUNT]: "CONVERSION_RATE" }) },
  ])("rejects invalid config without displaying its value %j", (extra) => {
    const { provider } = setup(extra);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.missingConfig()).toContain(Object.keys(extra)[0]);
  });
  it("validates the user token and business access before claiming connected", async () => {
    const { provider, sim } = setup();
    expect(await provider.status()).toMatchObject({
      state: "connected",
      implemented: true,
      last_successful_sync: null,
    });
    expect(sim.calls.map((c) => c.path)).toEqual([
      "/api/token",
      "/ads/v3/businesses",
      `/ads/v3/businesses/${BUSINESS}/ad_accounts`,
    ]);
    await provider.listAccounts({});
    expect((await provider.status()).last_successful_sync).toEqual(expect.any(String));
  });
  it("bad discovery data cannot report connected", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) => (u.pathname.endsWith("/businesses") ? json({}) : undefined);
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "PROVIDER_ERROR" } });
  });
  it("Ads terms / allowlisting has its own access_required state", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/businesses")
        ? json({ messages: ["Client must accept terms of service", "PRIVATE_SECRET"] }, 403)
        : undefined;
    const state = await provider.status();
    expect(state).toMatchObject({ state: "access_required", last_error: { code: "ACCESS_REQUIRED" } });
    expect(JSON.stringify(state)).not.toContain("PRIVATE_SECRET");
  });
  it("OAuth errors remain safe and are not retried as transport failures", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "3" });
    sim.handler = () => json({ error: "invalid_grant", error_description: "PRIVATE_REFRESH" }, 400);
    const state = await provider.status();
    expect(state).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
    expect(JSON.stringify(state)).not.toContain("PRIVATE_REFRESH");
    expect(sim.calls).toHaveLength(1);
  });
});

describe("Spotify safe HTTP and retries", () => {
  it("refreshes only once for concurrent requests", async () => {
    const { sim, env } = setup(),
      client = new SpotifyClient(readSpotifyConfig(env).config!, sim.fetch);
    await Promise.all([
      client.get("/businesses", new URLSearchParams(), AbortSignal.timeout(1000)),
      client.get("/businesses", new URLSearchParams(), AbortSignal.timeout(1000)),
    ]);
    expect(sim.calls.filter((c) => c.path === "/api/token")).toHaveLength(1);
  });
  it("401 renews once, using a rotated refresh token without an infinite loop", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) => (u.pathname.endsWith("/businesses") ? json({ messages: ["expired"] }, 401) : undefined);
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
    const tokens = sim.calls.filter((c) => c.path === "/api/token");
    expect(tokens).toHaveLength(2);
    expect(tokens[1]!.form.get("refresh_token")).toBe("synthetic-rotated-refresh");
    expect(dataCalls(sim)).toHaveLength(2);
  });
  it.each([400, 403, 404, 422])("never retries nontransient HTTP %i", async (status) => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "3" });
    sim.handler = (u) =>
      u.pathname.endsWith("/businesses") ? json({ messages: ["PRIVATE_SECRET"] }, status) : undefined;
    await provider.status();
    expect(dataCalls(sim)).toHaveLength(1);
  });
  it.each([429, 500, 503])("retries HTTP %i and recovers", async (status) => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "1" });
    let attempts = 0;
    sim.handler = (u) =>
      u.pathname.endsWith("/businesses") && attempts++ === 0
        ? json({ messages: [] }, status, { "X-RateLimit-Reset": "2" })
        : undefined;
    expect((await provider.status()).state).toBe("connected");
    expect(dataCalls(sim).filter((c) => c.path.endsWith("/businesses"))).toHaveLength(2);
  });
  it("X-RateLimit-Reset is seconds remaining, with Retry-After taking priority", () => {
    expect(spotifyError(429, {}, new Headers({ "X-RateLimit-Reset": "2.1" })).retryAfter).toBe(3);
    expect(spotifyError(429, {}, new Headers({ "X-RateLimit-Reset": "2", "Retry-After": "7" })).retryAfter).toBe(7);
  });
  it("respects the provider-specific retry hint", async () => {
    const { sim, env } = setup({ SPOTIFY_ADS_RETRIES: "1" });
    let attempts = 0;
    const waits: number[] = [];
    sim.handler = (u) =>
      u.pathname.endsWith("/businesses") && attempts++ === 0 ? json({}, 429, { "X-RateLimit-Reset": "3" }) : undefined;
    const client = new SpotifyClient(readSpotifyConfig(env).config!, sim.fetch, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await client.get("/businesses", new URLSearchParams(), AbortSignal.timeout(1000));
    expect(waits).toEqual([3000]);
  });
  it("malformed JSON is not retried and its contents are never exposed", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "3" });
    sim.handler = (u) => (u.pathname.endsWith("/businesses") ? new Response("PRIVATE_INVALID_JSON") : undefined);
    const state = await provider.status();
    expect(JSON.stringify(state)).not.toContain("PRIVATE_INVALID_JSON");
    expect(dataCalls(sim)).toHaveLength(1);
  });
  it("circuit breaker stops repeated transient outages", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) => (u.pathname.endsWith("/businesses") ? json({}, 503) : undefined);
    for (let n = 0; n < 6; n++) await provider.status();
    expect(dataCalls(sim)).toHaveLength(5);
  });
  it("cancels oversized response bodies before parsing", async () => {
    await expect(
      spotifyJson(new Response("{}", { headers: { "content-length": "8388609" } }), AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("rejects paths that might leak an authorization header", async () => {
    const { sim, env } = setup(),
      client = new SpotifyClient(readSpotifyConfig(env).config!, sim.fetch);
    for (const path of ["https://attacker.test", "/../token", `/ad_accounts/${ACCOUNT}/campaigns/../../token`])
      await expect(client.get(path, new URLSearchParams(), AbortSignal.timeout(1000))).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    expect(sim.calls).toHaveLength(0);
  });
  it("an already-cancelled caller causes no request", async () => {
    const { provider, sim } = setup(),
      controller = new AbortController();
    controller.abort();
    await expect(provider.listAccounts({}, { signal: controller.signal })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(sim.calls).toHaveLength(0);
  });
});

describe("Spotify accounts and campaigns", () => {
  it("retains currency and business, filters client, and excludes billing / tax data", async () => {
    const { provider } = setup();
    const accounts = await provider.listAccounts({ client_id: "cliente-a" });
    expect(accounts).toEqual([
      {
        platform: "spotify",
        client_id: "cliente-a",
        account_id: ACCOUNT,
        account_name: "Cuenta Spotify",
        currency: "MXN",
        timezone: null,
        status: "ACTIVE",
        manager_account_id: BUSINESS,
      },
    ]);
    expect(JSON.stringify(accounts)).not.toContain("PRIVATE_");
    expect(await provider.listAccounts({ client_id: "another" })).toEqual([]);
  });
  it("explicit account IDs avoid business discovery and UUIDs are canonicalized", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_ACCOUNT_IDS: `${ACCOUNT},${ACCOUNT}` });
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(dataCalls(sim).map((c) => c.path)).toEqual([`/ads/v3/ad_accounts/${ACCOUNT}`]);
    expect(spotifyId("AB000000-0000-4000-8000-000000000002")).toBe("ab000000-0000-4000-8000-000000000002");
  });
  it("partial account permissions warn while successful accounts survive", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_ACCOUNT_IDS: `${ACCOUNT},${SECOND}` });
    const warnings: ApiError[] = [];
    sim.handler = (u) => (u.pathname.endsWith(SECOND) ? json({}, 403) : undefined);
    expect(await provider.listAccounts({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "ACCESS_DENIED", details: { account_id: SECOND } });
  });
  it("an explicitly requested denied account is fatal", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) => (u.pathname.endsWith(SECOND) ? json({}, 403) : undefined);
    await expect(provider.listCampaigns({ account_id: SECOND })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("all requested accounts failing cannot produce a false empty success", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_ACCOUNT_IDS: ACCOUNT });
    sim.handler = (u) => (u.pathname.endsWith(ACCOUNT) ? json({}, 404) : undefined);
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("duplicate accounts are rejected instead of double-counted", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/ad_accounts") ? json({ ad_accounts: [sim.account, sim.account] }) : undefined;
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("uses current delivery goal before deprecated objective", async () => {
    const { provider } = setup();
    expect(await provider.listCampaigns({ account_id: ACCOUNT })).toEqual([
      expect.objectContaining({ campaign_id: CAMPAIGN, campaign_status: "active", objective: "WEBSITE_VISITS" }),
    ]);
  });
  it.each([
    ["ACTIVE_RESTRICTED", "active"],
    ["PAUSED", "paused"],
    ["ARCHIVED", "removed"],
    ["UNKNOWN_NEW_STATE", "unknown"],
  ])("preserves conservative status %s", (source, expected) => {
    expect(campaignStatus(source)).toBe(expected);
  });
  it("fetches every campaign page with stable ID sorting and offset 50", async () => {
    const { provider, sim } = setup();
    const campaigns = Array.from({ length: 51 }, (_, n) => ({
      ...sim.campaign,
      id: `00000000-0000-4000-8000-${String(n + 100).padStart(12, "0")}`,
    }));
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/campaigns")) return;
      const offset = Number(u.searchParams.get("offset"));
      expect(u.searchParams.get("sort_field")).toBe("ID");
      return json({ campaigns: campaigns.slice(offset, offset + 50), paging: { offset, total_results: 51 } });
    };
    expect(await provider.listCampaigns({ account_id: ACCOUNT })).toHaveLength(51);
    expect(
      dataCalls(sim)
        .filter((c) => c.path.endsWith("/campaigns"))
        .map((c) => c.params.get("offset")),
    ).toEqual(["0", "50"]);
  });
  it("a short page before declared total is rejected as incomplete", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/campaigns")
        ? json({ campaigns: [sim.campaign], paging: { offset: 0, total_results: 51 } })
        : undefined;
    await expect(provider.listCampaigns({ account_id: ACCOUNT })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("campaign rows cannot exceed the declared total", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/campaigns")
        ? json({ campaigns: [sim.campaign], paging: { offset: 0, total_results: 0 } })
        : undefined;
    await expect(provider.listCampaigns({ account_id: ACCOUNT })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

describe("Spotify aggregate reports and conversion semantics", () => {
  it("requests explicit campaign IDs in batches of at most 50 for DAY reports", async () => {
    const { provider, sim } = setup();
    const ids = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`);
    sim.handler = (url) => {
      if (url.pathname.endsWith("/campaigns")) {
        const offset = Number(url.searchParams.get("offset"));
        return json({
          campaigns: ids.slice(offset, offset + 50).map((id) => ({ ...sim.campaign, id })),
          paging: { offset, total_results: ids.length },
        });
      }
      if (url.pathname.endsWith("/aggregate_reports")) {
        const body = sim.report();
        body.rows[0]!.entity_id = url.searchParams.getAll("entity_ids")[0]!;
        return json(body);
      }
      return undefined;
    };
    expect(await provider.getPerformance(query)).toHaveLength(2);
    expect(reportCalls(sim).map((c) => c.params.getAll("entity_ids").length)).toEqual([50, 1]);
    expect(reportCalls(sim).every((c) => c.params.get("entity_ids_type") === "CAMPAIGN")).toBe(true);
    expect(reportCalls(sim).flatMap((c) => c.params.getAll("entity_ids"))).toEqual(ids);
  });
  it("an empty campaign catalog remains empty and does not request an unscoped report", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/campaigns") ? json({ campaigns: [], paging: { offset: 0, total_results: 0 } }) : undefined;
    expect(await provider.getPerformance(query)).toEqual([]);
    expect(reportCalls(sim)).toHaveLength(0);
  });
  it("rejects an entity outside the requested batch even if its ID is a valid UUID", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/aggregate_reports")) return undefined;
      const body = sim.report();
      body.rows[0]!.entity_id = SECOND;
      return json(body);
    };
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("privacy-suppressed -5 conversion counts remain unknown, preserve the marker and do not produce CPA", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES" });
    const warnings: ApiError[] = [];
    sim.handler = (u) =>
      u.pathname.endsWith("/aggregate_reports") ? json(sim.report("DAY", "2026-09-29", { PURCHASES: -5 })) : undefined;
    const rows = await provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
    expect(rows[0]).toMatchObject({
      conversions: null,
      cpa: null,
      raw_metrics: { PURCHASES: null, censored_conversion_fields: ["PURCHASES"], privacy_suppression_source_value: -5 },
    });
    expect(warnings.map((e) => e.details)).toContainEqual(
      expect.objectContaining({ limitation: "privacy_suppressed_conversions" }),
    );
    const conversions = await provider.getConversions(query);
    expect(conversions.find((r) => r.source_conversion === "PURCHASES")).toMatchObject({
      conversions: null,
      raw_metrics: { privacy_suppression_source_value: -5 },
    });
  });
  it("negative non-conversion metrics are still rejected", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("/aggregate_reports") ? json(sim.report("DAY", "2026-09-29", { SPEND: -5 })) : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("real unavailable REVENUE=-5 preserves usable spend without inventing income or a primary event", async () => {
    const { provider, sim } = setup();
    const warnings: ApiError[] = [];
    sim.handler = (u) =>
      u.pathname.endsWith("/aggregate_reports") ? json(sim.report("DAY", "2026-09-29", { REVENUE: -5 })) : undefined;
    const rows = await provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
    expect(rows[0]?.spend).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      conversion_value: null,
      conversions: null,
      cpa: null,
      raw_metrics: { REVENUE: null, unavailable_revenue_source_value: -5, censored_conversion_fields: [] },
    });
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ details: expect.objectContaining({ limitation: "revenue_unavailable" }) }),
      ]),
    );
  });
  it("recovers the observed hourly REVENUE 502 with a complete scoped report and explicit unknown income", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "0" });
    const warnings: ApiError[] = [];
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/aggregate_reports")) return undefined;
      if (u.searchParams.getAll("fields").includes("REVENUE")) return json({ messages: ["synthetic failure"] }, 502);
      const body = sim.report("HOUR");
      body.rows[0]!.stats = body.rows[0]!.stats.filter((s) => s.field_type !== "REVENUE");
      return json(body);
    };
    const rows = await provider.getPerformance(
      { ...query, granularity: "hourly" },
      { onWarning: (e) => warnings.push(e) },
    );
    expect(rows[0]).toMatchObject({
      spend: 100.5,
      impressions: 1000,
      clicks: 20,
      conversion_value: null,
      conversions: null,
      cpa: null,
    });
    const calls = reportCalls(sim);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params.getAll("fields")).toEqual(calls[0]!.params.getAll("fields").filter((f) => f !== "REVENUE"));
    for (const key of ["entity_ids", "report_start", "report_end", "granularity"])
      expect(calls[1]!.params.getAll(key)).toEqual(calls[0]!.params.getAll(key));
    expect(warnings.map((w) => w.details)).toContainEqual(
      expect.objectContaining({
        provider: "spotify",
        account_id: ACCOUNT,
        limitation: "revenue_unavailable",
        retry_without_revenue: true,
      }),
    );
  });
  it("discards partial pages before restarting without revenue rather than doubling their metrics", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "0" });
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/aggregate_reports")) return undefined;
      if (u.searchParams.has("continuation_token")) return json({}, 502);
      const body = sim.report("HOUR");
      if (u.searchParams.getAll("fields").includes("REVENUE"))
        return json({ ...body, continuation_token: "synthetic-page" });
      body.rows[0]!.stats = body.rows[0]!.stats.filter((s) => s.field_type !== "REVENUE");
      return json(body);
    };
    const rows = await provider.getPerformance({ ...query, granularity: "hourly" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spend).toBe(100.5);
    expect(reportCalls(sim)).toHaveLength(3);
    expect(reportCalls(sim)[2]!.params.has("continuation_token")).toBe(false);
  });
  it.each([401, 403, 429, 500])("does not hide HTTP %i as an hourly revenue limitation", async (status) => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "0" });
    sim.handler = (u) => (u.pathname.endsWith("/aggregate_reports") ? json({}, status) : undefined);
    await expect(provider.getPerformance({ ...query, granularity: "hourly" })).rejects.toMatchObject({
      details: { http_status: status },
    });
    expect(reportCalls(sim).every((c) => c.params.getAll("fields").includes("REVENUE"))).toBe(true);
  });
  it("keeps daily 502 failures and failed hourly fallbacks as errors instead of returning partial data", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_RETRIES: "0" });
    sim.handler = (u) => (u.pathname.endsWith("/aggregate_reports") ? json({}, 502) : undefined);
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(reportCalls(sim)).toHaveLength(1);
    const warnings: ApiError[] = [];
    await expect(
      provider.getPerformance({ ...query, granularity: "hourly" }, { onWarning: (e) => warnings.push(e) }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(reportCalls(sim)).toHaveLength(3);
    expect(warnings.some((w) => (w.details as { retry_without_revenue?: boolean }).retry_without_revenue)).toBe(false);
  });
  it("uses native currency units, UTC, current campaign dimension and source metrics", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES" });
    const rows = await provider.getPerformance(query);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: "spotify",
      campaign_id: CAMPAIGN,
      date: "2026-09-29",
      hour: null,
      source_timezone: "UTC",
      currency: "MXN",
      spend: 100.5,
      impressions: 1000,
      clicks: 20,
      conversions: 2,
      cpa: 50.25,
      ctr: 2,
      cpc: 5.025,
      cpm: 100.5,
      conversion_value: null,
      video_views: 100,
      video_25: null,
      video_50: null,
      video_75: null,
      video_100: null,
      raw_metrics: { FIRST_QUARTILES: 80, REVENUE: 800 },
    });
    const params = reportCalls(sim)[0]!.params;
    expect(params.getAll("fields")).toContain("PURCHASES");
    expect(params.get("report_end")).toBe("2026-09-29T00:00:00Z");
    expect(params.get("entity_type")).toBe("CAMPAIGN");
  });
  it("CPA stays null without an explicit primary conversion, with a safe warning", async () => {
    const { provider } = setup();
    const warnings: ApiError[] = [];
    const rows = await provider.getPerformance(query, { onWarning: (e) => warnings.push(e) });
    expect(rows[0]).toMatchObject({ conversions: null, cpa: null });
    expect(warnings.map((e) => e.details)).toContainEqual(
      expect.objectContaining({ limitation: "primary_conversion_not_configured" }),
    );
  });
  it("per-account primary mapping takes priority over the global action", async () => {
    const { provider } = setup({
      SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES",
      SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING: JSON.stringify({ [ACCOUNT]: "LEADS" }),
    });
    expect((await provider.getPerformance(query))[0]).toMatchObject({ conversions: 3, cpa: 33.5 });
  });
  it("does not sum distinct conversions, duplicate revenue, or invent absent events", async () => {
    const { provider } = setup({ SPOTIFY_ADS_CONVERSION_MAPPING: '{"CUSTOM_EVENT_1":"CONTACT"}' });
    const warnings: ApiError[] = [];
    const rows = await provider.getConversions(query, { onWarning: (e) => warnings.push(e) });
    expect(rows.map((r) => [r.source_conversion, r.conversions])).toEqual([
      ["LEADS", 3],
      ["PURCHASES", 2],
      ["CUSTOM_EVENT_1", 0],
      ["CUSTOM_EVENT_2", null],
    ]);
    expect(rows.find((r) => r.source_conversion === "CUSTOM_EVENT_1")?.normalized_conversion).toBe("CONTACT");
    expect(rows.find((r) => r.source_conversion === "CUSTOM_EVENT_2")?.normalized_conversion).toBeNull();
    expect(rows.every((r) => r.conversion_value === null)).toBe(true);
    expect(warnings.map((e) => e.details)).toContainEqual(
      expect.objectContaining({ limitation: "revenue_not_split_by_event" }),
    );
  });
  it("real zeros and missing values remain distinct", async () => {
    const { provider, sim } = setup({ SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES" });
    sim.handler = (u) =>
      u.pathname.endsWith("aggregate_reports")
        ? json(sim.report("DAY", "2026-09-29", { SPEND: 0, CLICKS: 0, IMPRESSIONS: null, PURCHASES: null }))
        : undefined;
    expect((await provider.getPerformance(query))[0]).toMatchObject({
      spend: 0,
      clicks: 0,
      impressions: null,
      conversions: null,
      cpa: null,
      cpc: null,
    });
  });
  it("next report page sends the opaque token alone", async () => {
    const { provider, sim } = setup();
    let page = 0;
    sim.handler = (u) => {
      if (u.pathname.endsWith("/campaigns"))
        return json({
          campaigns: [sim.campaign, { ...sim.campaign, id: SECOND }],
          paging: { offset: 0, total_results: 2 },
        });
      if (!u.pathname.endsWith("aggregate_reports")) return;
      const body = sim.report();
      if (page++ === 0) return json({ ...body, continuation_token: "opaque/+=token" });
      expect([...u.searchParams.keys()]).toEqual(["continuation_token"]);
      expect(u.searchParams.get("continuation_token")).toBe("opaque/+=token");
      body.rows[0]!.entity_id = SECOND;
      return json(body);
    };
    expect(await provider.getPerformance(query)).toHaveLength(2);
    expect(reportCalls(sim)).toHaveLength(2);
  });
  it("repeated continuation tokens fail instead of looping", async () => {
    const { provider, sim } = setup();
    sim.handler = (u) =>
      u.pathname.endsWith("aggregate_reports") ? json({ ...sim.report(), continuation_token: "repeat" }) : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(reportCalls(sim)).toHaveLength(2);
  });
  it("repeated campaign periods fail instead of inflating metrics", async () => {
    const { provider, sim } = setup();
    const body = sim.report();
    sim.handler = (u) =>
      u.pathname.endsWith("aggregate_reports") ? json({ ...body, rows: [body.rows[0], body.rows[0]] }) : undefined;
    await expect(provider.getPerformance(query)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("supports hour reports with inclusive hour 23 as the final bound", async () => {
    const { provider, sim } = setup();
    expect((await provider.getPerformance({ ...query, granularity: "hourly" }))[0]).toMatchObject({
      date: "2026-09-29",
      hour: 0,
      source_timezone: "UTC",
    });
    expect(reportCalls(sim)[0]!.params.get("report_end")).toBe("2026-09-29T23:00:00Z");
  });
  it("splits long daily ranges into nonoverlapping 90-day requests", async () => {
    const { provider, sim } = setup();
    await provider.getPerformance({ ...query, date_from: "2026-01-01", date_to: "2026-07-01" });
    const ranges = reportCalls(sim).map((c) => [
      c.params.get("report_start")?.slice(0, 10),
      c.params.get("report_end")?.slice(0, 10),
    ]);
    expect(ranges).toEqual([
      ["2026-01-01", "2026-03-31"],
      ["2026-04-01", "2026-06-29"],
      ["2026-06-30", "2026-07-01"],
    ]);
  });
  it.each([
    { date_from: "2026-02-30" },
    { date_from: "2026-10-01", date_to: "2026-09-29" },
    { date_to: "2099-01-01" },
    { date_from: "2025-01-01" },
    { date_from: "2026-01-01", granularity: "hourly" as const },
    { campaign_id: "not-uuid" },
  ])("invalid dates / retention / IDs cause no network call %j", async (extra) => {
    const { provider, sim } = setup();
    await expect(provider.getPerformance({ ...query, ...extra })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(sim.calls).toHaveLength(0);
  });
  it("hourly retention enforces the official last two weeks", () => {
    expect(() =>
      reportRanges({ ...query, granularity: "hourly", date_from: "2026-09-15" }, Date.parse("2026-10-01T00:00:00Z")),
    ).toThrow();
  });
  it("filters campaigns via entity_ids and rejects another campaign in the response", async () => {
    const { provider, sim } = setup();
    await provider.getPerformance({ ...query, campaign_id: CAMPAIGN });
    const params = reportCalls(sim)[0]!.params;
    expect(params.get("entity_ids")).toBe(CAMPAIGN);
    expect(params.get("entity_ids_type")).toBe("CAMPAIGN");
    await expect(provider.getPerformance({ ...query, campaign_id: SECOND })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
  it.each(["string-value", "negative", "duplicate", "bad-date", "different-dimension"])(
    "rejects incompatible vendor data %s",
    (failure) => {
      const body = new Sim().report(),
        row = body.rows[0]!;
      if (failure === "string-value") row.stats[0]!.field_value = "100" as never;
      if (failure === "negative") row.stats[0]!.field_value = -1;
      if (failure === "duplicate") row.stats.push(row.stats[0]!);
      if (failure === "bad-date") row.start_time = "2026-09-29T01:00:00Z";
      if (failure === "different-dimension") row.entity_type = "AD_SET";
      expect(() => {
        reportBucket(row, query);
        reportMetrics(row);
      }).toThrow();
    },
  );
});

describe("Spotify public routes", () => {
  it("serves account / campaign / performance / conversions in the existing envelope", async () => {
    const { provider } = setup({ SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES" });
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      for (const route of ["accounts", "campaigns", "performance", "conversions"]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/${route}?provider=spotify&account_id=${ACCOUNT}&date_from=2026-09-29&date_to=2026-09-29&granularity=daily`,
          headers: { "x-api-key": KEY },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.length).toBeGreaterThan(0);
        expect(res.json().request_id).toBe(res.headers["x-request-id"]);
        expect(res.body).not.toContain("synthetic-spotify-secret");
      }
    } finally {
      await app.close();
    }
  });
  it("an unconfigured Spotify integration doesn't prevent other provider status", async () => {
    const app = await makeApp(
      {},
      { registry: new ProviderRegistry([new GoogleProvider({}), new SpotifyProvider({})]) },
    );
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/providers", headers: { "x-api-key": KEY } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((p: { status: { state: string } }) => p.status.state)).toEqual([
        "not_configured",
        "not_configured",
      ]);
    } finally {
      await app.close();
    }
  });
});
