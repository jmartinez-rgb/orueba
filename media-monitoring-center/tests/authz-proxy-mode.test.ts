import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { resolveAuthMode, SESSION_COOKIE, signSessionToken } from "@/lib/auth/token";
import { isCrossOriginMutation } from "@/lib/auth/origin";
import { getAuthConfig, resetAuthConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { POST as switchRole } from "@/app/api/session/role/route";

/**
 * Autorización en el proxy: AUTH_MODE=open nunca abre un despliegue de producción y las API que
 * mutan rechazan peticiones de otro origen (CSRF). Identidades y llaves sintéticas.
 */

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), cookieSet: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => (mocks.cookies.has(key) ? { value: mocks.cookies.get(key) } : undefined), set: mocks.cookieSet }),
  headers: async () => new Headers(),
}));

const SECRET = "fixture-proxy-signing-key-0123456789abcdef";
const DEMO = { NODE_ENV: "production", AUTH_MODE: "open", DATA_SOURCE: "mock", USE_MOCK_DATA: "true", RECORDS_BACKEND: "memory" };

beforeEach(() => {
  mocks.cookies.clear();
  mocks.cookieSet.mockReset();
  resetAuthConfig();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthConfig();
});

function stub(env: Record<string, string>) {
  for (const key of ["AUTH_MODE", "AUTH_SECRET", "AUTH_USERS", "AUTH_UNIVERSAL_PASSWORD_HASH", "DATA_SOURCE", "USE_MOCK_DATA", "RECORDS_BACKEND", "NETLIFY"]) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetAuthConfig();
}

describe("AUTH_MODE=open nunca se habilita en un despliegue de producción", () => {
  it.each([
    ["datos reales unificados", { ...DEMO, DATA_SOURCE: "unified", RECORDS_BACKEND: "blobs" }],
    ["registros durables", { ...DEMO, RECORDS_BACKEND: "file" }],
    ["registros por omisión", { ...DEMO, RECORDS_BACKEND: "" }],
    ["fuente sin declarar", { ...DEMO, DATA_SOURCE: "", USE_MOCK_DATA: "" }],
    ["cuentas configuradas", { ...DEMO, AUTH_SECRET: SECRET, AUTH_USERS: "[]" }],
    ["contraseña universal configurada", { ...DEMO, AUTH_UNIVERSAL_PASSWORD_HASH: "scrypt:16384:8:1:c2FsdA:aGFzaA" }],
    ["sitio publicado en Netlify", { ...DEMO, NETLIFY: "true" }],
  ])("%s → bloqueado", (_name, env) => {
    expect(resolveAuthMode(env)).toBe("locked");
  });

  it("la demo local compilada (mock + memoria, sin credenciales) conserva el acceso abierto", () => {
    expect(resolveAuthMode(DEMO)).toBe("open");
    expect(resolveAuthMode({ ...DEMO, DATA_SOURCE: "", USE_MOCK_DATA: "true" })).toBe("open");
  });

  it("desarrollo local conserva el modo abierto declarado", () => {
    expect(resolveAuthMode({ AUTH_MODE: "open", NODE_ENV: "development", DATA_SOURCE: "unified" })).toBe("open");
  });

  it("producción con AUTH_MODE=open y datos reales no entrega sesión, no fija rol y el proxy responde 401", async () => {
    stub({ ...DEMO, DATA_SOURCE: "unified", RECORDS_BACKEND: "blobs" });
    vi.stubEnv("NODE_ENV", "production");
    resetAuthConfig();
    expect(getAuthConfig().mode).toBe("locked");
    mocks.cookies.set("immc_role", "admin");
    expect((await getSession()).authenticated).toBe(false);
    const role = await switchRole(new Request("http://monitor.test/api/session/role", { method: "POST", body: JSON.stringify({ role: "admin" }) }));
    expect(role.status).toBe(403);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    const api = await proxy(new NextRequest("http://monitor.test/api/incidents"));
    expect(api.status).toBe(401);
    const page = await proxy(new NextRequest("http://monitor.test/usuarios"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
  });
});

describe("CSRF: las API que mutan solo aceptan el mismo origen", () => {
  async function session() {
    const now = Math.floor(Date.now() / 1000);
    return signSessionToken({ sub: "sintetico", name: "Sintético", role: "admin", kind: "named", sid: "fixture", iat: now, exp: now + 600, v: 0 }, SECRET);
  }
  beforeEach(() => stub({ NODE_ENV: "production", AUTH_MODE: "password", AUTH_SECRET: SECRET, AUTH_USERS: "[]" }));

  async function call(path: string, method: string, headers: Record<string, string>) {
    const token = await session();
    return proxy(new NextRequest(`https://monitor.test${path}`, { method, headers: { host: "monitor.test", cookie: `${SESSION_COOKIE}=${token}`, ...headers }, ...(method === "GET" ? {} : { body: "{}" }) }));
  }

  it.each([
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
    ["Sec-Fetch-Site same-site (subdominio hermano)", { "sec-fetch-site": "same-site", origin: "https://otro.monitor.test" }],
    ["Origin ajeno sin Sec-Fetch-Site", { origin: "https://evil.example" }],
    ["Origin null", { origin: "null" }],
    ["Origin con otro puerto", { origin: "https://monitor.test:8443" }],
  ])("%s → 403 aun con sesión válida", async (_name, headers) => {
    for (const [path, method] of [["/api/tickets", "POST"], ["/api/incidents/INC-0001", "PATCH"], ["/api/users/sintetico", "DELETE"], ["/api/settings", "PUT"], ["/api/auth/login", "POST"], ["/api/auth/logout", "POST"]] as const) {
      const response = await call(path, method, headers);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it.each([
    ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin", origin: "https://monitor.test" }],
    ["Origin propio sin Sec-Fetch-Site", { origin: "https://monitor.test" }],
    ["cliente sin navegador (sin Origin)", {}],
  ])("%s → continúa a la ruta", async (_name, headers) => {
    const response = await call("/api/tickets", "POST", headers);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("las lecturas y el endpoint programado con llave de servidor no dependen del origen", async () => {
    expect((await call("/api/alerts", "GET", { "sec-fetch-site": "cross-site" })).headers.get("x-middleware-next")).toBe("1");
    expect(isCrossOriginMutation({ method: "POST", pathname: "/api/monitoring/evaluate", headers: new Headers({ origin: "https://n8n.example" }), host: "monitor.test" })).toBe(false);
    expect(isCrossOriginMutation({ method: "POST", pathname: "/login", headers: new Headers({ "sec-fetch-site": "cross-site" }), host: "monitor.test" })).toBe(false);
  });

  it("respeta el host público reenviado por el proxy de la plataforma", () => {
    const headers = new Headers({ origin: "https://monitor.example", host: "interno:3000", "x-forwarded-host": "monitor.example" });
    expect(isCrossOriginMutation({ method: "POST", pathname: "/api/tickets", headers, host: "interno:3000" })).toBe(false);
  });
});
