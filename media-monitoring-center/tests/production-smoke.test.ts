import { afterEach, describe, expect, it, vi } from "vitest";
import { runProductionSmoke, validateSmokeUrl } from "@/lib/release/production-smoke";

const now = new Date("2026-10-02T18:00:00Z");
const options = { monitorUrl: "https://monitor.example.com", apiUrl: "https://api.example.com", now };
const monitorHealth = { ok: true, app: "izzi Media Monitoring Center", version: "0.1.0", mode: "unified", time: now.toISOString(), integrations: { sheets: false, bigquery: false, n8n: false, whatsapp: false } };
const apiHealth = { status: "ok", service: "unified-ads-api", version: "0.1.0", environment: "production", uptime_s: 60, timestamp: now.toISOString() };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const login = () => new Response('<!doctype html><html><body><form><input name="password" type="password"></form></body></html>', { headers: { "Content-Type": "text/html; charset=utf-8" } });

function goodResponse(input: Parameters<typeof fetch>[0]): Response {
  const url = new URL(String(input));
  if (url.pathname === "/api/health") return json(monitorHealth);
  if (url.pathname === "/api/v1/health") return json(apiHealth);
  if (url.pathname === "/login") return login();
  return url.pathname.startsWith("/api/v1/") ? json({ error: { code: "AUTH_ERROR", message: "Falta la llave.", request_id: "fixture-request" } }, 401) : json({ ok: false, message: "Sin sesión." }, 401);
}
const transport = () => vi.fn<typeof fetch>(async input => goodResponse(input));
const selected = (path: string, response: () => Response) => vi.fn<typeof fetch>(async input => new URL(String(input)).pathname === path ? response() : goodResponse(input));

afterEach(() => { vi.useRealTimers(); });

describe("public HTTPS URL boundaries without network or DNS claims", () => {
  it.each([
    "http://monitor.example.com", "https:///monitor.example.com", "https://user:PRIVATE@monitor.example.com", "https://@monitor.example.com",
    "https://monitor.example.com?", "https://monitor.example.com?token=PRIVATE", "https://monitor.example.com#", "https://monitor.example.com#PRIVATE",
    "https://monitor.example.com\n", "https://monitor.example.com\t", "https://monitor.example.com\\private", "https://monitor.example.com:0", "not-a-url",
  ])("rejects malformed/credential-bearing URL without echoing it: %s", input => {
    expect(validateSmokeUrl(input, "monitor")).toEqual({ url: null, code: "URL_INVALID" });
  });

  it.each([
    "https://localhost", "https://LOCALHOST.", "https://monitor.localhost", "https://metadata.google.internal", "https://monitor.local", "https://machine",
    "https://127.1", "https://2130706433", "https://0x7f000001", "https://0.0.0.0", "https://10.0.0.1", "https://172.16.0.1", "https://172.31.255.255", "https://192.168.1.1", "https://169.254.169.254", "https://100.64.0.1", "https://100.127.0.1",
    "https://192.0.2.1", "https://198.18.0.1", "https://198.51.100.1", "https://203.0.113.1", "https://224.0.0.1", "https://255.255.255.255",
    "https://[::]", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[::ffff:10.0.0.1]", "https://[fc00::1]", "https://[fdff::1]", "https://[fe80::1]", "https://[ff02::1]", "https://[2001:db8::1]", "https://[2001:0::1]", "https://[2001:20::1]", "https://[2002:a00:1::1]",
  ])("rejects private/special destinations before any fetch: %s", input => {
    expect(validateSmokeUrl(input, "monitor")).toEqual({ url: null, code: "HOST_NOT_PUBLIC" });
  });

  it.each(["https://monitor.example.com", "https://monitor.example.com:8443/", "https://8.8.8.8", "https://172.32.0.1", "https://[2606:4700:4700::1111]", "https://[2001:4860:4860::8888]"])("accepts a lexically public HTTPS origin without certifying DNS: %s", input => {
    expect(validateSmokeUrl(input, "monitor")).toMatchObject({ code: "URL_VALID", url: expect.any(URL) });
  });

  it("accepts only implemented mount paths, including explicit API /api/v1 notation", () => {
    expect(validateSmokeUrl("https://api.example.com/api/v1", "api").code).toBe("URL_VALID");
    expect(validateSmokeUrl("https://api.example.com/api/v1/", "api").code).toBe("URL_VALID");
    expect(validateSmokeUrl("https://api.example.com/private-prefix", "api")).toEqual({ url: null, code: "URL_PATH_UNSUPPORTED" });
    expect(validateSmokeUrl("https://monitor.example.com/api/v1", "monitor")).toEqual({ url: null, code: "URL_PATH_UNSUPPORTED" });
  });
});

describe("bounded credential-free production smoke contract", () => {
  it("checks the seven actual routes separately and never certifies hosting or v1", async () => {
    const request = transport();
    const report = await runProductionSmoke({ ...options, apiUrl: `${options.apiUrl}/api/v1`, request });
    expect(report).toMatchObject({ status: "pass", exitCode: 0, counts: { pass: 7, fail: 0, blocked: 0 }, transport: "INJECTED_TRANSPORT", certifiesV1: false, hostingHttpsVerified: false, dnsBindingVerified: false });
    expect(report.checks.filter(check => check.target === "monitor")).toHaveLength(4);
    expect(report.checks.filter(check => check.target === "api")).toHaveLength(3);
    expect(request.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(["/api/health", "/login", "/api/settings", "/api/nexus", "/api/v1/health", "/api/v1/providers", "/api/v1/accounts"]);
    for (const [, init] of request.mock.calls) {
      expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", referrer: "", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal) });
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].sort()).toEqual(["accept", "cache-control"]);
      for (const name of ["authorization", "cookie", "x-api-key"]) expect(headers.has(name)).toBe(false);
      expect(init?.body).toBeUndefined();
    }
    const output = JSON.stringify(report);
    for (const hidden of [options.monitorUrl, options.apiUrl, "example.com", "izzi Media", "fixture-request"]) expect(output).not.toContain(hidden);
  });

  it("missing URLs produce seven blocked checks with no request", async () => {
    const request = transport();
    expect(await runProductionSmoke({ request, now })).toMatchObject({ status: "blocked", exitCode: 2, counts: { pass: 0, fail: 0, blocked: 7 } });
    expect(request).not.toHaveBeenCalled();
  });

  it("one missing service does not prevent the other service's independent probes", async () => {
    const request = transport();
    expect(await runProductionSmoke({ monitorUrl: options.monitorUrl, request, now })).toMatchObject({ status: "blocked", exitCode: 2, counts: { pass: 4, fail: 0, blocked: 3 } });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("private destination rejection precedes every request and never echoes an input secret", async () => {
    const request = transport();
    const report = await runProductionSmoke({ ...options, monitorUrl: "https://PRIVATE_USER:PRIVATE_TOKEN@127.0.0.1", apiUrl: "https://10.0.0.1", request });
    expect(report.counts.blocked).toBe(7);
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|127\.0\.0\.1|10\.0\.0\.1/);
  });

  it.each([
    { timeoutMs: 0 }, { timeoutMs: 999 }, { timeoutMs: 15_001 }, { timeoutMs: NaN }, { timeoutMs: 1_001.5 },
    { maxBodyBytes: 1 }, { maxBodyBytes: 1_048_577 }, { now: new Date("invalid") },
  ])("invalid bounds fail closed without a request: %j", async patch => {
    const request = transport();
    const report = await runProductionSmoke({ ...options, ...patch, request });
    expect(report.exitCode).toBe(2);
    expect(report.checks.every(check => check.code === "OPTIONS_INVALID")).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("the test suite's default fetch guard remains blocked rather than silently reaching a platform", async () => {
    const report = await runProductionSmoke(options);
    expect(report).toMatchObject({ transport: "DEFAULT_FETCH", exitCode: 2, counts: { pass: 0, fail: 0, blocked: 7 } });
    expect(report.checks.every(check => check.code === "TRANSPORT_FAILED")).toBe(true);
  });
});

describe("contract failures and safe unavailable results", () => {
  it.each(["/api/settings", "/api/nexus", "/api/v1/providers", "/api/v1/accounts"])("marks private HTTP200 as a failure without reading its payload: %s", async path => {
    const read = vi.fn(), cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: read, cancel });
    const getReader = vi.spyOn(body, "getReader");
    const report = await runProductionSmoke({ ...options, request: selected(path, () => new Response(body, { headers: { "Content-Type": "application/json" } })) });
    expect(report).toMatchObject({ status: "fail", exitCode: 1, counts: { pass: 6, fail: 1, blocked: 0 } });
    expect(report.checks.find(check => check.code === "UNAUTHENTICATED_ACCESS")).toMatchObject({ status: "fail", httpStatus: 200 });
    expect(cancel).toHaveBeenCalled();
    // Stream construction can schedule pull; the tool must never acquire a private body's reader.
    expect(getReader).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it.each([301, 302, 303, 307, 308])("never follows HTTP%s redirects, including signed/private destinations", async status => {
    const request = selected("/api/health", () => new Response(null, { status, headers: { Location: "http://169.254.169.254/private?token=SIGNED_SECRET", "Set-Cookie": "PRIVATE_COOKIE" } }));
    const report = await runProductionSmoke({ ...options, request });
    expect(report.checks[0]).toMatchObject({ status: "fail", code: "REDIRECT_NOT_ALLOWED", httpStatus: status });
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls.every(([input]) => String(input).startsWith("https://") && !String(input).includes("169.254"))).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/SIGNED_SECRET|PRIVATE_COOKIE|169\.254/);
  });

  it.each([403, 429, 500, 502, 503])("reports HTTP%s upstream blocks without certifying the auth gate", async status => {
    const report = await runProductionSmoke({ ...options, request: selected("/api/settings", () => new Response("PRIVATE_ERROR_BODY", { status })) });
    expect(report).toMatchObject({ status: "blocked", exitCode: 2 });
    expect(report.checks[2]).toMatchObject({ status: "blocked", code: "REMOTE_PROBE_BLOCKED", httpStatus: status });
    expect(JSON.stringify(report)).not.toContain("PRIVATE_ERROR_BODY");
  });

  it.each([404, 405])("does not call a missing/wrong-method private route protected: HTTP%s", async status => {
    const report = await runProductionSmoke({ ...options, request: selected("/api/nexus", () => json({ message: "PRIVATE_ERROR" }, status)) });
    expect(report.checks[3]).toMatchObject({ status: "fail", code: "HTTP_STATUS_UNEXPECTED", httpStatus: status });
  });

  it.each([
    ["/api/health", () => new Response("<html>PRIVATE</html>", { headers: { "Content-Type": "text/html" } }), "CONTENT_TYPE_INVALID"],
    ["/api/health", () => new Response("PRIVATE malformed JSON", { headers: { "Content-Type": "application/json" } }), "JSON_INVALID"],
    ["/api/health", () => json({ ok: true }), "HEALTH_RESPONSE_INVALID"],
    ["/api/health", () => json({ ...monitorHealth, integrations: { sheets: "true" } }), "HEALTH_RESPONSE_INVALID"],
    ["/api/health", () => json({ ...monitorHealth, time: "2026-02-30T18:00:00Z" }), "HEALTH_RESPONSE_INVALID"],
    ["/api/health", () => json({ ...monitorHealth, mode: "mock" }), "DIRECT_API_SOURCE_NOT_ACTIVE"],
    ["/api/health", () => json({ ...monitorHealth, time: "2026-10-02T17:54:59Z" }), "HEALTH_CLOCK_OUT_OF_RANGE"],
    ["/api/v1/health", () => json({ ...apiHealth, environment: "development" }), "API_NOT_PRODUCTION"],
    ["/api/v1/health", () => json({ ...apiHealth, service: "another-service" }), "HEALTH_RESPONSE_INVALID"],
    ["/api/v1/health", () => json({ ...apiHealth, uptime_s: -1 }), "HEALTH_RESPONSE_INVALID"],
    ["/api/v1/health", () => json({ ...apiHealth, timestamp: "2026-10-02T18:05:01Z" }), "HEALTH_CLOCK_OUT_OF_RANGE"],
    ["/api/settings", () => json({ ok: true }, 401), "AUTH_RESPONSE_INVALID"],
    ["/api/v1/providers", () => json({ error: { code: "PROVIDER_ERROR", message: "PRIVATE", request_id: "PRIVATE" } }, 401), "AUTH_RESPONSE_INVALID"],
    ["/api/v1/accounts", () => new Response("<html>PRIVATE hosting login</html>", { status: 401, headers: { "Content-Type": "text/html" } }), "CONTENT_TYPE_INVALID"],
    ["/login", () => new Response("{}", { headers: { "Content-Type": "application/json" } }), "CONTENT_TYPE_INVALID"],
    ["/login", () => new Response("<html>Locked site, no form.</html>", { headers: { "Content-Type": "text/html" } }), "LOGIN_FORM_MISSING"],
  ] as const)("validates %s response with fixed code %s", async (path, response, code) => {
    const report = await runProductionSmoke({ ...options, request: selected(path, response) });
    expect(report.checks.find(check => check.code === code)).toMatchObject({ status: "fail", code });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|another-service|malformed JSON/);
  });

  it("never emits HTTP/network error excerpts, URLs or authentication headers", async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error("PRIVATE_TOKEN https://signed.example.com/?token=SIGNED_SECRET Authorization: PRIVATE_AUTH"); });
    const report = await runProductionSmoke({ ...options, request });
    expect(report.counts.blocked).toBe(7);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|SIGNED_SECRET|signed\.example|Authorization/);
  });

  it("bounds bytes even when content-length underreports or is absent", async () => {
    const cancel = vi.fn();
    const request = selected("/api/health", () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(1_025))); }, cancel }), { headers: { "Content-Type": "application/json", "Content-Length": "1" } }));
    const report = await runProductionSmoke({ ...options, request, maxBodyBytes: 1_024 });
    expect(report.checks[0]).toMatchObject({ status: "fail", code: "BODY_LIMIT" });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects an oversized declared body and cancels without reading it", async () => {
    const cancel = vi.fn();
    const report = await runProductionSmoke({ ...options, request: selected("/api/health", () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json", "Content-Length": "1048577" } })) });
    expect(report.checks[0]).toMatchObject({ status: "fail", code: "BODY_LIMIT" });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 without decoder/parser excerpts", async () => {
    const report = await runProductionSmoke({ ...options, request: selected("/api/health", () => new Response(Uint8Array.from([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } })) });
    expect(report.checks[0]).toMatchObject({ status: "fail", code: "BODY_INVALID" });
  });

  it("bounds a fetch that ignores abort and cancels its late response", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const request = transport().mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; }));
    const pending = runProductionSmoke({ ...options, request, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    const report = await pending;
    expect(report.checks[0]).toMatchObject({ status: "blocked", code: "TIMEOUT", httpStatus: null });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(7);
  });

  it("the deadline covers a stalled response body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const request = selected("/api/health", () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    const pending = runProductionSmoke({ ...options, request, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    expect((await pending).checks[0]).toMatchObject({ status: "blocked", code: "TIMEOUT", httpStatus: 200 });
    expect(cancel).toHaveBeenCalled();
  });

  it("failure takes precedence over an unavailable other service", async () => {
    const report = await runProductionSmoke({ monitorUrl: options.monitorUrl, now, request: selected("/api/settings", () => json({ private: true })) });
    expect(report).toMatchObject({ status: "fail", exitCode: 1, counts: { pass: 3, fail: 1, blocked: 3 } });
  });
});
