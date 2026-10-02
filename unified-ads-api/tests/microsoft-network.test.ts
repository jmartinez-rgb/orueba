import { describe, it, expect, vi } from "vitest";
import { checkMicrosoftReportNetwork, microsoftNetworkReason } from "../src/providers/microsoft/network.js";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { MICROSOFT_REPORT_HOST } from "../src/providers/microsoft/reports.js";
import { microsoftFixture, MICROSOFT_ENV } from "./microsoft-simulator.js";

const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
describe("Microsoft report network diagnostics", () => {
  it("a completed root 403 establishes reachability without claiming valid report access", async () => {
    const request = vi.fn(async () => new Response(null, { status: 403 }));
    expect(await checkMicrosoftReportNetwork(request, resolve)).toEqual({
      host: MICROSOFT_REPORT_HOST,
      reachable: true,
      http_status: 403,
      reason: null,
    });
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.search).toBe("");
    expect(init).toMatchObject({ method: "HEAD", redirect: "error" });
    expect(init.headers).toBeUndefined();
  });
  it("classifies a proxy rejection without exporting its private diagnostic message", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("private-token fetch failed", {
        cause: new Error("Proxy response (403) !== 200 private-signed-url"),
      });
    });
    const result = await checkMicrosoftReportNetwork(request, resolve);
    expect(result).toMatchObject({ reachable: false, reason: "proxy_denied", http_status: null });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("rejects non-public DNS before using the transport", async () => {
    const request = vi.fn();
    expect(await checkMicrosoftReportNetwork(request, async () => [{ address: "127.0.0.1", family: 4 }])).toMatchObject(
      { reachable: false },
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("resolver failures remain distinguishable after signed URL validation redacts the original error", async () => {
    const request = vi.fn();
    const result = await checkMicrosoftReportNetwork(request, async () => {
      throw Object.assign(new Error("private-resolver-details"), { code: "ENOTFOUND" });
    });
    expect(result).toMatchObject({ reachable: false, reason: "dns_failed" });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-resolver-details");
  });
  it.each([
    ["ENOTFOUND", "dns_failed"],
    ["CERT_HAS_EXPIRED", "tls_failed"],
    ["ETIMEDOUT", "timeout"],
    ["ECONNRESET", "connection_failed"],
  ] as const)("classifies %s as %s", (code, reason) => {
    expect(microsoftNetworkReason({ cause: { code, message: "private diagnostics" } })).toBe(reason);
  });
  it("canceled probes do not initiate requests", async () => {
    const request = vi.fn();
    expect(await checkMicrosoftReportNetwork(request, resolve, AbortSignal.abort())).toMatchObject({
      reachable: false,
      reason: "timeout",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("signed report failures preserve a safe host/reason, never the URL or underlying error", async () => {
    const fixture = microsoftFixture();
    const request: typeof fetch = async (input, init) => {
      if (new URL(String(input)).hostname === MICROSOFT_REPORT_HOST)
        throw new Error("Proxy response (403) !== 200 private-signature");
      return fixture.request(input, init);
    };
    const provider = new MicrosoftProvider(MICROSOFT_ENV, {
      fetch: request,
      resolve,
      retry: { sleep: async () => {} },
    });
    const error = await provider
      .getPerformance({ account_id: "1001", date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" })
      .catch((error) => error);
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      details: {
        limitation: "report_download_network",
        report_host: MICROSOFT_REPORT_HOST,
        network_reason: "proxy_denied",
      },
    });
    expect(JSON.stringify(error)).not.toContain("private-signature");
  });
});
