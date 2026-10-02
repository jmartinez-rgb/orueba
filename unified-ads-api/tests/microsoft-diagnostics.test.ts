import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../src/providers/registry.js";
import { safeDownloadUrl } from "../src/providers/microsoft/reports.js";
import { verificationSheets, verifyProviders } from "../src/verification/run.js";
import { safeDiagnostic } from "../src/utils/diagnostics.js";
import { ApiError } from "../src/utils/errors.js";
import { makeApp, KEY } from "./helpers.js";
import { fault, json, microsoftFixture } from "./microsoft-simulator.js";

const QUERY = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const };
const BLOB = "bingadsappsstorageprod.blob.core.windows.net";
const poll = (status: Record<string, unknown>) => json({ ReportRequestStatus: status });
async function failure(handler: Parameters<typeof microsoftFixture>[0]) {
  const { provider } = microsoftFixture(handler);
  const error = await provider.getPerformance({ ...QUERY, account_id: "101" }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  // Every stage still surfaces as the unified PROVIDER_ERROR -> HTTP 502: the stage is the diagnosis.
  expect(error).toMatchObject({ code: "PROVIDER_ERROR", statusCode: 502 });
  const serialized = JSON.stringify((error as ApiError).details);
  for (const secret of ["private-signature", "private-job-id", "fake-access-token", "fake-client-secret", "report.zip"])
    expect(serialized).not.toContain(secret);
  return error as ApiError;
}

describe("Microsoft report stage diagnostics (502 investigation, offline)", () => {
  it("names the submit stage and the vendor HTTP status of a gateway failure", async () => {
    const error = await failure((c) =>
      c.url.pathname.endsWith("/GenerateReport/Submit")
        ? new Response("<html>Bad gateway</html>", { status: 502 })
        : undefined,
    );
    expect(error.details).toMatchObject({
      provider: "microsoft",
      stage: "report_submit",
      http_status: 502,
      transient: true,
    });
    expect(safeDiagnostic(error)).toBe("stage=report_submit;http_status=502");
  });
  it("names the poll stage and Microsoft fault codes", async () => {
    const error = await failure((c) =>
      c.url.pathname.endsWith("/GenerateReport/Poll") ? fault(0, "InternalError", 500) : undefined,
    );
    expect(error.details).toMatchObject({ stage: "report_poll", microsoft_codes: [0] });
  });
  it("keeps the generated report status as a sanitized token", async () => {
    const error = await failure((c) =>
      c.url.pathname.endsWith("/GenerateReport/Poll") ? poll({ Status: "Error" }) : undefined,
    );
    expect(error.details).toMatchObject({ stage: "report_status", report_status: "Error" });
    const odd = await failure((c) =>
      c.url.pathname.endsWith("/GenerateReport/Poll") ? poll({ Status: "<b>https://x/?sig=1</b>" }) : undefined,
    );
    expect(odd.details).toMatchObject({ report_status: "UNRECOGNIZED" });
  });
  it("reports a moved storage host with its hostname only, never the signed path or query", async () => {
    const error = await failure((c) =>
      c.url.pathname.endsWith("/GenerateReport/Poll")
        ? poll({
            Status: "Success",
            ReportDownloadUrl: "https://newreports.blob.core.windows.net/a/report.zip?sig=private-signature",
          })
        : undefined,
    );
    expect(error.details).toMatchObject({
      stage: "report_download_url",
      limitation: "report_download_host_unexpected",
      observed_host: "newreports.blob.core.windows.net",
    });
  });
  it("records Azure's rejection code and status for a refused signed download", async () => {
    const error = await failure((c) =>
      c.url.hostname === BLOB
        ? new Response("<Error><Message>Signature fake-access-token</Message></Error>", {
            status: 403,
            headers: { "x-ms-error-code": "AuthenticationFailed" },
          })
        : undefined,
    );
    expect(error.details).toMatchObject({
      stage: "report_download",
      limitation: "report_download_rejected",
      http_status: 403,
      blob_error_code: "AuthenticationFailed",
      transient: false,
    });
    const gateway = await failure((c) => (c.url.hostname === BLOB ? new Response("", { status: 502 }) : undefined));
    expect(gateway.details).toMatchObject({ stage: "report_download", http_status: 502, transient: true });
    expect(gateway.details).not.toHaveProperty("blob_error_code");
  });
  it("separates network egress failures and unreadable archives", async () => {
    const network = await failure((c) => {
      if (c.url.hostname === BLOB)
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      return undefined;
    });
    expect(network.details).toMatchObject({ stage: "report_download", limitation: "report_download_network" });
    const parse = await failure((c) => (c.url.hostname === BLOB ? new Response("not a zip") : undefined));
    expect(parse.details).toMatchObject({ stage: "report_parse" });
  });
  it("labels unsafe and private download targets without a host for literal addresses", async () => {
    const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(
      safeDownloadUrl("http://bingadsappsstorageprod.blob.core.windows.net/f", resolve),
    ).rejects.toMatchObject({
      details: { limitation: "report_download_url_unsafe" },
    });
    await expect(safeDownloadUrl("https://127.0.0.1/f", resolve)).rejects.toMatchObject({
      details: { provider: "microsoft", limitation: "report_download_host_unexpected" },
    });
    await expect(safeDownloadUrl("https://127.0.0.1/f", resolve)).rejects.not.toHaveProperty("details.observed_host");
    await expect(
      safeDownloadUrl(`https://${BLOB}/f`, async () => [{ address: "10.0.0.1", family: 4 }]),
    ).rejects.toMatchObject({
      details: { limitation: "report_download_address_not_public" },
    });
    await expect(safeDownloadUrl("no es url", resolve)).rejects.toMatchObject({
      details: { limitation: "report_download_url_invalid" },
    });
  });
  it("returns the stage through the unified HTTP route as PROVIDER_ERROR/502", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.hostname === BLOB ? new Response("", { status: 503 }) : undefined,
    );
    const app = await makeApp({}, { registry: new ProviderRegistry([provider]) });
    try {
      const response = await app.inject({
        url: "/api/v1/performance?provider=microsoft&account_id=101&date_from=2026-09-29&date_to=2026-09-29",
        headers: { "x-api-key": KEY },
      });
      // With an explicit provider the route throws: the 502 is the unified status for PROVIDER_ERROR.
      expect(response.statusCode).toBe(502);
      expect(response.json().error).toMatchObject({
        code: "PROVIDER_ERROR",
        details: { stage: "report_download", http_status: 503 },
      });
      expect(response.body).not.toContain("private-signature");
    } finally {
      await app.close();
    }
  });
});

describe("safe diagnostics allowlist", () => {
  it("keeps only allowlisted tokens and statuses, never messages, URLs or arbitrary fields", () => {
    const error = new ApiError("PROVIDER_ERROR", "Mensaje con https://example.test/?sig=secret", {
      details: {
        stage: "report_download",
        limitation: "con espacio",
        observed_host: "host/with/path",
        url: "https://example.test/?sig=secret",
        http_status: 99999,
        microsoft_codes: [117, "x", 2004],
        token: "fake",
      },
    });
    expect(safeDiagnostic(error)).toBe("stage=report_download;microsoft_codes=117|2004");
    expect(safeDiagnostic(new Error("x"))).toBeNull();
    expect(safeDiagnostic(new ApiError("PROVIDER_ERROR"))).toBeNull();
  });
  it("adds the diagnosis to the verifier coverage sheet for a bounded read", async () => {
    const { provider } = microsoftFixture((c) =>
      c.url.hostname === BLOB
        ? new Response("", { status: 403, headers: { "x-ms-error-code": "AuthorizationPermissionMismatch" } })
        : undefined,
    );
    const read = await verifyProviders([provider], {
      date: "2026-09-29",
      accounts: { microsoft: ["101"] },
      now: new Date("2026-10-02T12:00:00Z"),
    });
    const performance = read.operations.find((r) => r.section === "performance");
    expect(performance).toMatchObject({ state: "error", codes: ["PROVIDER_ERROR"] });
    expect(performance?.diagnostics).toEqual([
      "stage=report_download;limitation=report_download_rejected;blob_error_code=AuthorizationPermissionMismatch;http_status=403",
    ]);
    const coverage = verificationSheets(read).find((s) => s.name === "Cobertura")!;
    expect(coverage.columns.map((c) => c.header)).toContain("Diagnóstico");
    expect(JSON.stringify(coverage.rows)).not.toContain("private-signature");
  });
});
