import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { microsoftId, readMicrosoftConfig } from "../src/providers/microsoft/config.js";
import { microsoftError, expiredAccessToken, isMicrosoftRetryable } from "../src/providers/microsoft/errors.js";
import { PERFORMANCE_COLUMNS, parseReport, safeDownloadUrl } from "../src/providers/microsoft/reports.js";
import { normalizePerformance, normalizeConversion } from "../src/providers/microsoft/normalize.js";
import { normalizeAccount } from "../src/providers/microsoft/accounts.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { makeApp, KEY } from "./helpers.js";
import {
  ACCOUNT,
  CAMPAIGN_ID,
  PERF_ROW,
  CONV_ROW,
  MICROSOFT_ENV,
  microsoftFixture,
  fault,
  json,
  reportZip,
} from "./microsoft-simulator.js";

const QUERY = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const };
const config = readMicrosoftConfig(MICROSOFT_ENV).config!;
const account = normalizeAccount(ACCOUNT, config);
describe("Microsoft configuration", () => {
  it("advertises an implemented provider without pretending to be connected", async () => {
    const p = new MicrosoftProvider({});
    expect(await p.status()).toMatchObject({ state: "not_configured", implemented: true, configured: false });
    await expect(p.listAccounts({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("preserves Int64 IDs above JS precision", () => expect(microsoftId(CAMPAIGN_ID)).toBe(CAMPAIGN_ID));
  it.each([9007199254740992, "0", "-1", "1/../foo", "9223372036854775808", "01"])("rejects invalid ID %s", (id) =>
    expect(() => microsoftId(id)).toThrow(),
  );
  it.each([
    ["MICROSOFT_ADS_CLIENT_ID", "not-a-guid"],
    ["MICROSOFT_ADS_DEVELOPER_TOKEN", "token\r\nInjected"],
    ["MICROSOFT_ADS_TENANT", "common/../../evil"],
    ["MICROSOFT_ADS_RETRIES", "-1"],
    ["MICROSOFT_ADS_TIMEOUT_MS", "0"],
    ["MICROSOFT_ADS_POLL_INTERVAL_MS", "0"],
    ["MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA", "yes"],
    ["MICROSOFT_ADS_ACCOUNT_IDS", "1,../../"],
    ["MICROSOFT_ADS_CLIENT_MAPPING", "[]"],
    ["MICROSOFT_ADS_CONVERSION_MAPPING", '{"Goal":5}'],
  ])("reports invalid %s without exposing its value", (key, value) => {
    const setup = readMicrosoftConfig({ ...MICROSOFT_ENV, [key]: value });
    expect(setup.config).toBeNull();
    expect(setup.missing).toContain(key);
  });
});
describe("Microsoft REST and OAuth", () => {
  it("refreshes once for concurrent calls and uses REST Bearer headers", async () => {
    const { provider, calls } = microsoftFixture();
    await Promise.all([provider.status(), provider.listAccounts({})]);
    const tokens = calls.filter((c) => c.url.hostname === "login.microsoftonline.com");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.body).toMatchObject({
      grant_type: "refresh_token",
      client_secret: MICROSOFT_ENV.MICROSOFT_ADS_CLIENT_SECRET,
      scope: "https://ads.microsoft.com/msads.manage offline_access",
    });
    expect(calls.find((c) => c.url.pathname.endsWith("/User/Query"))!.headers.get("authorization")).toBe(
      "Bearer fake-access-token",
    );
    expect(calls.every((c) => c.init?.redirect === "error")).toBe(true);
  });
  it("renews a vendor-expired token once using the rotated refresh token", async () => {
    let userCalls = 0;
    const { provider, calls } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/User/Query") && ++userCalls === 1
        ? fault(109, "AuthenticationTokenExpired", 500)
        : undefined,
    );
    expect((await provider.status()).state).toBe("connected");
    const tokens = calls.filter((c) => c.url.hostname === "login.microsoftonline.com");
    expect(tokens).toHaveLength(2);
    expect(tokens[1]!.body.refresh_token).toBe("fake-rotated-refresh");
  });
  it("does not keep renewing a revoked token", async () => {
    const { provider, calls } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/User/Query") ? fault(109, "AuthenticationTokenExpired", 500) : undefined,
    );
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "AUTH_ERROR" });
    expect(calls.filter((c) => c.url.hostname === "login.microsoftonline.com")).toHaveLength(2);
  });
  it("does not renew invalid developer credentials as though they were an expired token", async () => {
    const { provider, calls } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/User/Query") ? fault(105, "InvalidCredentials", 500) : undefined,
    );
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
    expect(calls.filter((c) => c.url.hostname === "login.microsoftonline.com")).toHaveLength(1);
  });
  it("sanitizes OAuth errors", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.hostname === "login.microsoftonline.com"
        ? json({ error: "invalid_grant", error_description: "PRIVATE TOKEN" }, 400)
        : undefined,
    );
    await expect(provider.listAccounts({})).rejects.toMatchObject({
      code: "AUTH_ERROR",
      details: { oauth_error: "invalid_grant" },
    });
    expect(JSON.stringify(await provider.status())).not.toContain("PRIVATE TOKEN");
  });
  it("retries throttling, not permission errors", async () => {
    let n = 0;
    const { provider } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/Accounts/Search") && ++n === 1
        ? fault(117, "CallRateExceeded", 500, { "retry-after": "1" })
        : undefined,
    );
    expect(await provider.listAccounts({})).toHaveLength(1);
    expect(n).toBe(2);
  });
  it("aborts before issuing requests", async () => {
    const { provider, calls } = microsoftFixture();
    await expect(provider.listAccounts({}, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(calls).toHaveLength(0);
  });
});
describe("Microsoft accounts and campaigns", () => {
  it("discovers accounts with a UserId predicate and keeps manager/currency metadata", async () => {
    const { provider, calls } = microsoftFixture();
    expect(await provider.listAccounts({ client_id: "client-a" })).toEqual([account]);
    expect(calls.find((c) => c.url.pathname.endsWith("/Accounts/Search"))!.body).toMatchObject({
      Predicates: [{ Field: "UserId", Operator: "Equals", Value: "301" }],
      PageInfo: { Index: 0, Size: 1000 },
    });
    expect(JSON.stringify(await provider.listAccounts({}))).not.toContain("private@example.test");
  });
  it("paginates 1000 accounts, caching discovery", async () => {
    const { provider, calls } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/Accounts/Search")
        ? json({
            Accounts:
              (c.body.PageInfo as { Index: number }).Index === 0
                ? Array.from({ length: 1000 }, (_, i) => ({ ...ACCOUNT, Id: String(i + 1000) }))
                : [ACCOUNT],
          })
        : undefined,
    );
    expect(await provider.listAccounts({})).toHaveLength(1001);
    await provider.listAccounts({});
    expect(calls.filter((c) => c.url.pathname.endsWith("/Accounts/Search"))).toHaveLength(2);
  });
  it("rejects repeated paginated accounts", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/Accounts/Search") ? json({ Accounts: Array(1000).fill(ACCOUNT) }) : undefined,
    );
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("keeps successful selected accounts and reports an inaccessible one", async () => {
    const { provider } = microsoftFixture(
      (c) => (c.body.AccountId === "102" ? fault(106, "UserIsNotAuthorized") : undefined),
      { MICROSOFT_ADS_ACCOUNT_IDS: "101,102" },
    );
    const warnings: unknown[] = [];
    expect(await provider.listAccounts({}, { onWarning: (e) => warnings.push(e) })).toHaveLength(1);
    expect(warnings).toMatchObject([{ code: "ACCESS_DENIED", details: { account_id: "102" } }]);
  });
  it("returns access denied when all configured accounts fail", async () => {
    const { provider } = microsoftFixture(
      (c) => (c.url.pathname.endsWith("/Account/Query") ? fault(106, "UserIsNotAuthorized") : undefined),
      { MICROSOFT_ADS_ACCOUNT_IDS: "101" },
    );
    await expect(provider.listAccounts({})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("uses comma-separated REST campaign flags and scopes Customer headers", async () => {
    const { provider, calls } = microsoftFixture();
    expect(await provider.listCampaigns({ account_id: "101" })).toMatchObject([
      { campaign_id: CAMPAIGN_ID, campaign_status: "active", objective: null },
    ]);
    const c = calls.find((c) => c.url.pathname.includes("QueryByAccountId"))!;
    const types = String(c.body.CampaignType)
      .split(",")
      .map((type) => type.trim());
    expect(types).toEqual(
      expect.arrayContaining(["Search", "Shopping", "Audience", "PerformanceMax", "Hotel", "App", "ObjectiveBased"]),
    );
    expect(c.headers.get("customerid")).toBe("201");
    expect(c.headers.get("customeraccountid")).toBe("101");
  });
});
describe("Microsoft asynchronous reporting", () => {
  it("polls Pending then Success, downloads ZIP/CSV and normalizes fractional conversions", async () => {
    const { provider, calls } = microsoftFixture();
    const warnings: unknown[] = [];
    const result = await provider.getPerformance(
      { ...QUERY, account_id: "101", campaign_id: CAMPAIGN_ID },
      { onWarning: (e) => warnings.push(e) },
    );
    expect(result).toMatchObject([
      {
        campaign_id: CAMPAIGN_ID,
        spend: 100,
        conversions: 2.5,
        conversion_value: 350,
        ctr: 2,
        cpc: 5,
        cpm: 100,
        cpa: 40,
        reach: null,
        link_clicks: null,
        source_timezone: "UTC",
      },
    ]);
    expect(result[0]!.campaign_name).toBe('Search, "brand"');
    const submit = calls.find((c) => c.url.pathname.endsWith("/Submit"))!;
    expect(submit.body.ReportRequest).toMatchObject({
      Format: "Csv",
      FormatVersion: "2.0",
      Aggregation: "Daily",
      Scope: { Campaigns: [{ AccountId: "101", CampaignId: CAMPAIGN_ID }] },
    });
    expect(calls.filter((c) => c.url.pathname.endsWith("/Poll"))).toHaveLength(2);
    const download = calls.find((c) => c.url.hostname === "report.example.com")!;
    expect([...download.headers]).toEqual([]);
    expect(download.init?.redirect).toBe("error");
    expect(warnings).toMatchObject([{ details: { limitation: "provisional_reporting" } }]);
  });
  it("normalizes UTC hourly buckets with hour zero", async () => {
    const { provider } = microsoftFixture();
    expect(await provider.getPerformance({ ...QUERY, granularity: "hourly" })).toMatchObject([
      { hour: 7, source_timezone: "UTC" },
    ]);
    const row = normalizePerformance(
      { ...PERF_ROW, TimePeriod: "2026-09-29|0" },
      account,
      { ...QUERY, granularity: "hourly" },
      "now",
    );
    expect(row.hour).toBe(0);
  });
  it("separates qualified goals from all conversions and maps by GoalId", async () => {
    const { provider } = microsoftFixture();
    expect(await provider.getConversions(QUERY)).toMatchObject([
      {
        source_conversion: "Purchase",
        normalized_conversion: "PURCHASE",
        conversions: 2.5,
        conversion_value: 350,
        raw_metrics: { GoalId: "500", AllConversionsQualified: 4.5, AllRevenue: 550 },
      },
    ]);
  });
  it("leaves an unmapped conversion category null", () => {
    expect(
      normalizeConversion(CONV_ROW, account, QUERY, { ...config, conversionMapping: {} }, "now").normalized_conversion,
    ).toBeNull();
  });
  it("only considers Success + nil download as no data", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/Poll")
        ? json({ ReportRequestStatus: { Status: "Success", ReportDownloadUrl: null } })
        : undefined,
    );
    expect(await provider.getPerformance(QUERY)).toEqual([]);
  });
  it.each(["Error", "Unexpected"])("does not treat %s as no activity", async (status) => {
    const { provider } = microsoftFixture((c) =>
      c.url.pathname.endsWith("/Poll") ? json({ ReportRequestStatus: { Status: status } }) : undefined,
    );
    await expect(provider.getPerformance(QUERY)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("aborts a pending report without returning zero rows", async () => {
    const controller = new AbortController();
    const { provider, calls } = microsoftFixture((c) => {
      if (c.url.pathname.endsWith("/Poll")) {
        controller.abort();
        return json({ ReportRequestStatus: { Status: "Pending" } });
      }
    });
    await expect(provider.getPerformance(QUERY, { signal: controller.signal })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(calls.filter((c) => c.url.pathname.endsWith("/Submit"))).toHaveLength(1);
  });
  it("can require complete data without an unverified completeness claim", async () => {
    const { provider, calls } = microsoftFixture(undefined, { MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA: "true" });
    const warnings: unknown[] = [];
    await provider.getPerformance(QUERY, { onWarning: (e) => warnings.push(e) });
    expect(calls.find((c) => c.url.pathname.endsWith("/Submit"))!.body.ReportRequest).toMatchObject({
      ReturnOnlyCompleteData: true,
    });
    expect(warnings).toEqual([]);
  });
  it("rejects a repeated report bucket instead of double counting", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.hostname === "report.example.com"
        ? new Response(reportZip(PERFORMANCE_COLUMNS, [PERF_ROW, PERF_ROW]))
        : undefined,
    );
    await expect(provider.getPerformance(QUERY)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it.each([
    { ...PERF_ROW, AccountId: "999" },
    { ...PERF_ROW, TimePeriod: "2026-09-30" },
    { ...PERF_ROW, Spend: "NaN" },
    { ...PERF_ROW, Clicks: "-2" },
    { ...PERF_ROW, CurrencyCode: "USD" },
  ])("rejects inconsistent report data %j", (row) => {
    expect(() => normalizePerformance(row, account, QUERY, "now")).toThrow();
  });
  it("keeps unavailable metrics and zero denominators null", () => {
    const row = normalizePerformance(
      { ...PERF_ROW, Spend: "--", Clicks: "0", ConversionsQualified: "0" },
      account,
      QUERY,
      "now",
    );
    expect(row).toMatchObject({ spend: null, clicks: 0, cpc: null, cpa: null, reach: null });
  });
  it("validates invalid dates before making network calls", async () => {
    const { provider, calls } = microsoftFixture();
    await expect(provider.getPerformance({ ...QUERY, date_from: "2026-02-30" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(calls).toHaveLength(0);
  });
});
describe("Microsoft download and error handling", () => {
  const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
  it.each([
    "http://report.example.com/file",
    "https://127.0.0.1/file",
    "https://localhost/file",
    "https://user:secret@report.example.com/file",
    "https://report.example.com:8080/file",
  ])("rejects unsafe download %s", async (url) => {
    await expect(safeDownloadUrl(url, resolve)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("rejects a hostname resolving to private addresses", async () => {
    await expect(
      safeDownloadUrl("https://reports.example.com/file", async () => [{ address: "10.0.0.1", family: 4 }]),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("does not assume a fixed download domain", async () =>
    expect((await safeDownloadUrl("https://cdn.example.com/file?signature=x", resolve)).hostname).toBe(
      "cdn.example.com",
    ));
  it.each([
    strToU8("not zip"),
    zipSync({ "report.csv": strToU8("Wrong,Headers\n1,2") }),
    zipSync({ "a.csv": strToU8("AccountId\n1"), "b.csv": strToU8("AccountId\n1") }),
  ])("rejects malformed or ambiguous archives", (archive) =>
    expect(() => parseReport(archive, PERFORMANCE_COLUMNS)).toThrow(),
  );
  it("accepts a well-formed header-only report", () =>
    expect(parseReport(reportZip(PERFORMANCE_COLUMNS, []), PERFORMANCE_COLUMNS)).toEqual([]));
  it.each([
    [105, "InvalidCredentials", "AUTH_ERROR"],
    [106, "UserIsNotAuthorized", "ACCESS_DENIED"],
    [109, "AuthenticationTokenExpired", "AUTH_ERROR"],
    [117, "CallRateExceeded", "RATE_LIMITED"],
    [207, "ConcurrentRequestOverLimit", "RATE_LIMITED"],
    [208, "InvalidAccount", "INVALID_REQUEST"],
    [2004, "ReportingServiceNoCompleteDataAvaliable", "PROVIDER_ERROR"],
    [0, "InternalError", "PROVIDER_ERROR"],
  ])("maps vendor error %s and sanitizes messages", (code, symbol, expected) => {
    const error = microsoftError(
      500,
      { Errors: [{ Code: code, ErrorCode: symbol, Message: "SECRET" }] },
      new Headers(),
    );
    expect(error.code).toBe(expected);
    expect(JSON.stringify(error)).not.toContain("SECRET");
    expect(expiredAccessToken(error)).toBe(code === 109);
    expect(isMicrosoftRetryable(error)).toBe([0, 117, 207].includes(code));
  });
  it("does not confuse address code 207 with reporting throttle", () => {
    expect(microsoftError(400, { Errors: [{ Code: 207 }] }, new Headers()).code).toBe("INVALID_REQUEST");
  });
});
describe("Microsoft unified HTTP routes", () => {
  it("serves authenticated routes and rejects missing API keys", async () => {
    const { provider } = microsoftFixture();
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      expect((await app.inject({ url: "/api/v1/accounts?provider=microsoft" })).statusCode).toBe(401);
      const response = await app.inject({
        url: "/api/v1/performance?provider=microsoft&date_from=2026-09-29&date_to=2026-09-29",
        headers: { "x-api-key": KEY },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().errors[0].error.details.limitation).toBe("provisional_reporting");
      expect(response.json().request_id).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
