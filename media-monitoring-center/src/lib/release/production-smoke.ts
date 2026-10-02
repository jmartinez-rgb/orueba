import { isIP } from "node:net";
import { z } from "zod";

export type SmokeTarget = "monitor" | "api";
export type SmokeStatus = "pass" | "fail" | "blocked";
export interface ProductionSmokeCheck {
  target: SmokeTarget;
  id: string;
  status: SmokeStatus;
  code: string;
  httpStatus: number | null;
}
export interface ProductionSmokeReport {
  version: 1;
  generatedAt: string;
  status: SmokeStatus;
  checks: ProductionSmokeCheck[];
  counts: Record<SmokeStatus, number>;
  exitCode: 0 | 1 | 2;
  transport: "DEFAULT_FETCH" | "INJECTED_TRANSPORT";
  policy: { method: "GET"; maxRequests: 7; credentials: "omit"; redirects: "manual"; timeoutMs: number; maxBodyBytes: number };
  certifiesV1: false;
  hostingHttpsVerified: false;
  dnsBindingVerified: false;
  pendingEvidence: string[];
}
export interface ProductionSmokeOptions {
  monitorUrl?: string;
  apiUrl?: string;
  request?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  now?: Date;
}

const monitorHealth = z.object({
  ok: z.literal(true), app: z.string().min(1).max(200), version: z.string().min(1).max(80),
  mode: z.enum(["unified", "mock", "sheets", "bigquery"]), time: z.iso.datetime({ offset: true }),
  integrations: z.object({ sheets: z.boolean(), bigquery: z.boolean(), n8n: z.boolean(), whatsapp: z.boolean() }),
});
const apiHealth = z.object({
  status: z.literal("ok"), service: z.literal("unified-ads-api"), version: z.string().min(1).max(80),
  environment: z.enum(["development", "test", "production"]), uptime_s: z.number().finite().nonnegative(),
  timestamp: z.iso.datetime({ offset: true }),
});
const monitorDenied = z.object({ ok: z.literal(false), message: z.string().min(1).max(2_000) });
const apiDenied = z.object({ error: z.object({ code: z.literal("AUTH_ERROR"), message: z.string().min(1).max(2_000), request_id: z.string().min(1).max(200) }) });
const probes = [
  { target: "monitor", id: "monitor_health", path: "/api/health", kind: "health" },
  { target: "monitor", id: "monitor_login", path: "/login", kind: "login" },
  { target: "monitor", id: "monitor_settings_denied", path: "/api/settings", kind: "private" },
  { target: "monitor", id: "monitor_nexus_denied", path: "/api/nexus", kind: "private" },
  { target: "api", id: "api_health", path: "/api/v1/health", kind: "health" },
  { target: "api", id: "api_providers_denied", path: "/api/v1/providers", kind: "private" },
  { target: "api", id: "api_accounts_denied", path: "/api/v1/accounts", kind: "private" },
] as const;
type Probe = typeof probes[number];

/** Reject private/special IPv4 literals, including URL-normalized decimal and hexadecimal forms. */
function publicIpv4(host: string): boolean {
  const [a, b, c] = host.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function publicIpv6(host: string): boolean {
  const [left, right] = host.split("::");
  const first = left ? left.split(":") : [], last = right ? right.split(":") : [];
  const groups = right === undefined ? first : [...first, ...Array(8 - first.length - last.length).fill("0"), ...last];
  const value = groups.reduce((n, group) => (n << 16n) + BigInt(parseInt(group, 16)), 0n);
  // Only global unicast; exclude documentation, special-protocol and 6to4 blocks.
  return value >> 125n === 1n && value >> 96n !== 0x20010db8n &&
    value >> 105n !== 0x100080n && value >> 112n !== 0x2002n;
}

/** Lexical validation only. DNS/proxy resolution is not pinned or certified by this tool. */
export function validateSmokeUrl(value: string | undefined, target: SmokeTarget): { url: URL | null; code: string } {
  if (value === undefined || value === "") return { url: null, code: "URL_MISSING" };
  if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(value) || !/^https:\/\/[^/]/i.test(value)) return { url: null, code: "URL_INVALID" };
  try {
    const url = new URL(value), authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
    if (url.protocol !== "https:" || authority?.includes("@") || url.username || url.password || value.includes("?") || value.includes("#") || url.port === "0") return { url: null, code: "URL_INVALID" };
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
    const ip = isIP(host);
    if ((ip === 4 && !publicIpv4(host)) || (ip === 6 && !publicIpv6(host)) ||
      (!ip && (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host)))) return { url: null, code: "HOST_NOT_PUBLIC" };
    // The current applications have no configurable mount prefix. Accept API route-base notation too.
    if (!(target === "api" ? ["/", "/api/v1", "/api/v1/"] : ["/"]).includes(url.pathname)) return { url: null, code: "URL_PATH_UNSUPPORTED" };
    return { url, code: "URL_VALID" };
  } catch { return { url: null, code: "URL_INVALID" }; }
}

class ProbeFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

function cancelBody(response: Response): void {
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Never disclose transport errors. */ }
}

/** Bound injected transports too: neither fetch nor a body reader may ignore the deadline. */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new ProbeFailure("TIMEOUT")); };
    // Attach both handlers even if the deadline already elapsed, so a late rejection stays handled.
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function bodyText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) throw new ProbeFailure("BODY_LIMIT");
  const reader = response.body?.getReader();
  if (!reader) throw new ProbeFailure("BODY_INVALID");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const chunk = await withDeadline(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new ProbeFailure("BODY_LIMIT");
      try { text += decoder.decode(chunk.value, { stream: true }); } catch { throw new ProbeFailure("BODY_INVALID"); }
    }
    try { return text + decoder.decode(); } catch { throw new ProbeFailure("BODY_INVALID"); }
  } finally {
    void reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* A deadline can interrupt a pending reader. */ }
  }
}

async function probe(check: Probe, base: URL, request: typeof fetch, timeoutMs: number, maxBodyBytes: number, now: Date): Promise<ProductionSmokeCheck> {
  const result = (status: SmokeStatus, code: string, httpStatus: number | null = null): ProductionSmokeCheck => ({ target: check.target, id: check.id, status, code, httpStatus });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  let httpStatus: number | null = null;
  try {
    const pending = Promise.resolve().then(() => request(new URL(check.path, base), {
      method: "GET", headers: { Accept: check.kind === "login" ? "text/html" : "application/json", "Cache-Control": "no-cache" },
      credentials: "omit", redirect: "manual", cache: "no-store", referrer: "", referrerPolicy: "no-referrer", signal: controller.signal,
    }));
    void pending.then(r => { if (controller.signal.aborted) cancelBody(r); }).catch(() => undefined);
    response = await withDeadline(pending, controller.signal);
    const status = response.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) return result("fail", "HTTP_STATUS_INVALID");
    httpStatus = status;
    if (response.redirected || (status >= 300 && status < 400)) return result("fail", "REDIRECT_NOT_ALLOWED", status);
    if (check.kind === "private" && status >= 200 && status < 300) return result("fail", "UNAUTHENTICATED_ACCESS", status);
    if (status === 429 || status === 403 || status >= 500) return result("blocked", "REMOTE_PROBE_BLOCKED", status);
    if (status !== (check.kind === "private" ? 401 : 200)) return result("fail", "HTTP_STATUS_UNEXPECTED", status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!(check.kind === "login" ? /^text\/html(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i).test(contentType)) return result("fail", "CONTENT_TYPE_INVALID", status);
    const text = await bodyText(response, maxBodyBytes, controller.signal);
    if (check.kind === "login") {
      if (!/<html(?:\s|>)/i.test(text) || !/<form(?:\s|>)/i.test(text) || !/<input\b[^>]*\btype\s*=\s*(?:["']password["']|password(?:\s|\/?>))/i.test(text)) return result("fail", "LOGIN_FORM_MISSING", status);
      return result("pass", "PUBLIC_LOGIN_AVAILABLE", status);
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch { return result("fail", "JSON_INVALID", status); }
    if (check.kind === "private") return (check.target === "monitor" ? monitorDenied : apiDenied).safeParse(body).success ? result("pass", "UNAUTHENTICATED_DENIED", status) : result("fail", "AUTH_RESPONSE_INVALID", status);
    if (check.target === "monitor") {
      const parsed = monitorHealth.safeParse(body);
      if (!parsed.success) return result("fail", "HEALTH_RESPONSE_INVALID", status);
      if (parsed.data.mode !== "unified") return result("fail", "DIRECT_API_SOURCE_NOT_ACTIVE", status);
      if (Math.abs(Date.parse(parsed.data.time) - now.getTime()) > 300_000) return result("fail", "HEALTH_CLOCK_OUT_OF_RANGE", status);
    } else {
      const parsed = apiHealth.safeParse(body);
      if (!parsed.success) return result("fail", "HEALTH_RESPONSE_INVALID", status);
      if (parsed.data.environment !== "production") return result("fail", "API_NOT_PRODUCTION", status);
      if (Math.abs(Date.parse(parsed.data.timestamp) - now.getTime()) > 300_000) return result("fail", "HEALTH_CLOCK_OUT_OF_RANGE", status);
    }
    return result("pass", "PUBLIC_HEALTH_AVAILABLE", status);
  } catch (error) {
    return result(error instanceof ProbeFailure && error.code !== "TIMEOUT" ? "fail" : "blocked", error instanceof ProbeFailure ? error.code : controller.signal.aborted ? "TIMEOUT" : "TRANSPORT_FAILED", httpStatus);
  } finally {
    clearTimeout(timer);
    if (response) cancelBody(response);
  }
}

/** Seven unauthenticated GETs only. No environment reads, credentials, cookies, login POST or direct advertising-platform requests. */
export async function runProductionSmoke(options: ProductionSmokeOptions = {}): Promise<ProductionSmokeReport> {
  const timeoutMs = options.timeoutMs ?? 5_000, maxBodyBytes = options.maxBodyBytes ?? 512 * 1024;
  const now = options.now ?? new Date();
  const validOptions = Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 15_000 &&
    Number.isInteger(maxBodyBytes) && maxBodyBytes >= 1_024 && maxBodyBytes <= 1024 * 1024 &&
    now instanceof Date && Number.isFinite(now.getTime()) && (options.request === undefined || typeof options.request === "function");
  const urls = { monitor: validateSmokeUrl(options.monitorUrl, "monitor"), api: validateSmokeUrl(options.apiUrl, "api") };
  const checks: ProductionSmokeCheck[] = [];
  // Sequential, no retries: a complete run issues at most seven bounded requests.
  for (const check of probes) {
    const configured = urls[check.target];
    checks.push(!validOptions || !configured.url ? { target: check.target, id: check.id, status: "blocked", code: validOptions ? configured.code : "OPTIONS_INVALID", httpStatus: null } : await probe(check, configured.url, options.request ?? fetch, timeoutMs, maxBodyBytes, now));
  }
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const check of checks) counts[check.status]++;
  const status = counts.fail ? "fail" : counts.blocked ? "blocked" : "pass";
  return {
    version: 1, generatedAt: validOptions ? now.toISOString() : new Date().toISOString(), status, checks, counts,
    exitCode: status === "fail" ? 1 : status === "blocked" ? 2 : 0,
    transport: options.request ? "INJECTED_TRANSPORT" : "DEFAULT_FETCH",
    policy: { method: "GET", maxRequests: 7, credentials: "omit", redirects: "manual", timeoutMs: validOptions ? timeoutMs : 5_000, maxBodyBytes: validOptions ? maxBodyBytes : 512 * 1024 },
    certifiesV1: false, hostingHttpsVerified: false, dnsBindingVerified: false,
    pendingEvidence: ["TLS_PROXY_DNS_ORIGIN_NOT_CERTIFIED", "NOMINAL_LOGIN_NOT_VERIFIED", "ADVERTISING_PLATFORM_ACCESS_NOT_VERIFIED", "RECONCILIATION_NOT_VERIFIED", "DURABLE_STORAGE_AND_WORKER_NOT_VERIFIED"],
  };
}
