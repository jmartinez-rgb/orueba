import { zipSync, strToU8 } from "fflate";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import type { MicrosoftFetch } from "../src/providers/microsoft/client.js";
import type { ReportRow } from "../src/providers/microsoft/reports.js";

export const MICROSOFT_ENV = {
  MICROSOFT_ADS_DEVELOPER_TOKEN: "fake-developer-token",
  MICROSOFT_ADS_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
  MICROSOFT_ADS_CLIENT_SECRET: "fake-client-secret",
  MICROSOFT_ADS_REFRESH_TOKEN: "fake-refresh-token",
  MICROSOFT_ADS_CLIENT_MAPPING: '{"101":"client-a"}',
  MICROSOFT_ADS_CONVERSION_MAPPING: '{"500":"PURCHASE"}',
};
export const ACCOUNT = {
  Id: "101",
  Name: "Microsoft Account",
  CurrencyCode: "MXN",
  ParentCustomerId: "201",
  TimeZone: "CentralTimeUSCanada",
  AccountLifeCycleStatus: "Active",
};
export const CAMPAIGN_ID = "9007199254740993";
export const PERF_ROW: ReportRow = {
  TimePeriod: "2026-09-29",
  AccountId: "101",
  CampaignId: CAMPAIGN_ID,
  CampaignName: 'Search, "brand"',
  CampaignStatus: "Active",
  CurrencyCode: "MXN",
  Spend: "100.00",
  Impressions: "1000",
  Clicks: "20",
  ConversionsQualified: "2.5",
  Revenue: "350.00",
};
export const CONV_ROW: ReportRow = {
  TimePeriod: "2026-09-29",
  AccountId: "101",
  CampaignId: CAMPAIGN_ID,
  GoalId: "500",
  Goal: "Purchase",
  GoalType: "Event",
  ConversionsQualified: "2.5",
  Revenue: "350.00",
  AllConversionsQualified: "4.5",
  AllRevenue: "550.00",
};
export function reportZip(columns: string[], data: ReportRow[]) {
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const csv =
    "\ufeff" +
    columns.map(quote).join(",") +
    "\r\n" +
    data.map((row) => columns.map((c) => quote(row[c] ?? "")).join(",")).join("\r\n") +
    "\r\n";
  return zipSync({ "report.csv": strToU8(csv) });
}
export interface MicrosoftCall {
  url: URL;
  headers: Headers;
  body: Record<string, unknown>;
  init?: RequestInit;
}
export type MicrosoftHandler = (call: MicrosoftCall) => Response | undefined | Promise<Response | undefined>;
export const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
export const fault = (code: number, symbol: string, status = 400, headers?: Record<string, string>) =>
  json(
    { Errors: [{ Code: code, ErrorCode: symbol, Message: "PRIVATE fake-client-secret fake-refresh-token" }] },
    status,
    headers,
  );
export function microsoftSimulator(handler?: MicrosoftHandler) {
  const calls: MicrosoftCall[] = [];
  let columns: string[] = [],
    conversions = false,
    hourly = false,
    polls = 0;
  const request: MicrosoftFetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers);
    const body: Record<string, unknown> =
      url.hostname === "login.microsoftonline.com"
        ? Object.fromEntries(new URLSearchParams(String(init?.body)))
        : init?.body
          ? JSON.parse(String(init.body))
          : {};
    const call = { url, headers, body, init };
    calls.push(call);
    const intercepted = await handler?.(call);
    if (intercepted) return intercepted;
    if (url.hostname === "login.microsoftonline.com")
      return json({
        access_token: "fake-access-token",
        refresh_token: "fake-rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (url.pathname.endsWith("/User/Query")) return json({ User: { Id: "301", Email: "private@example.test" } });
    if (url.pathname.endsWith("/Accounts/Search")) return json({ Accounts: [ACCOUNT] });
    if (url.pathname.endsWith("/Account/Query")) return json({ Account: { ...ACCOUNT, Id: body.AccountId } });
    if (url.pathname.endsWith("/Campaigns/QueryByAccountId"))
      return json({
        Campaigns: [{ Id: CAMPAIGN_ID, Name: PERF_ROW.CampaignName, Status: "Active", CampaignType: "Search" }],
      });
    if (url.pathname.endsWith("/GenerateReport/Submit")) {
      const report = body.ReportRequest as Record<string, unknown>;
      columns = report.Columns as string[];
      conversions = report.Type === "ConversionPerformanceReportRequest";
      hourly = report.Aggregation === "Hourly";
      polls = 0;
      return json({ ReportRequestId: "private-job-id" });
    }
    if (url.pathname.endsWith("/GenerateReport/Poll"))
      return json({
        ReportRequestStatus:
          ++polls === 1
            ? { Status: "Pending" }
            : {
                Status: "Success",
                ReportDownloadUrl: "https://report.example.com/report.zip?signature=private-signature",
              },
      });
    if (url.hostname === "report.example.com") {
      const row = conversions ? CONV_ROW : PERF_ROW;
      return new Response(reportZip(columns, [{ ...row, TimePeriod: hourly ? "2026-09-29|7" : row.TimePeriod! }]));
    }
    throw new Error("Unexpected Microsoft simulator route");
  };
  return { calls, request };
}
export function microsoftFixture(handler?: MicrosoftHandler, env: Record<string, string | undefined> = {}) {
  const sim = microsoftSimulator(handler);
  const provider = new MicrosoftProvider(
    { ...MICROSOFT_ENV, ...env },
    {
      fetch: sim.request,
      retry: { sleep: async () => undefined, random: () => 0 },
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    },
  );
  return { ...sim, provider };
}
