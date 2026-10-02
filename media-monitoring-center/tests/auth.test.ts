import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, isPasswordHash, verifyPassword } from "@/lib/auth/password";
import { resolveAuthMode, signSessionToken, verifySessionToken, type SessionClaims } from "@/lib/auth/token";
import { can } from "@/lib/auth/roles";
import { getAuthConfig, resetAuthConfig } from "@/lib/auth/config";
import { isLocked, registerFailure, registerSuccess } from "@/lib/auth/rate-limit";
import { maskIp, summarizeAgent } from "@/lib/records/audit";

const SECRET = "x".repeat(48);
const claims = (over: Partial<SessionClaims> = {}): SessionClaims => ({
  sub: "jmartinez",
  name: "J. Martínez",
  role: "admin",
  kind: "named",
  sid: "abc",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

describe("contraseñas (scrypt)", () => {
  it("genera un hash válido sin '$' y lo verifica", async () => {
    const h = await hashPassword("Izzi-Prueba-1234");
    expect(isPasswordHash(h)).toBe(true);
    expect(h.includes("$")).toBe(false);
    expect(await verifyPassword("Izzi-Prueba-1234", h)).toBe(true);
    expect(await verifyPassword("izzi-prueba-1234", h)).toBe(false);
  });
  it("rechaza hashes mal formados o con parámetros abusivos", async () => {
    expect(await verifyPassword("x", "texto-plano")).toBe(false);
    expect(await verifyPassword("x", "scrypt:99999999:8:1:c2FsdA:aGFzaA")).toBe(false);
  });
});

describe("token de sesión", () => {
  it("firma y verifica; detecta manipulación y vencimiento", async () => {
    const t = await signSessionToken(claims(), SECRET);
    expect((await verifySessionToken(t, SECRET))?.sub).toBe("jmartinez");
    expect(await verifySessionToken(t, "y".repeat(48))).toBeNull();
    const [v, payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims(), role: "admin", sub: "otro" })).toString("base64url");
    expect(await verifySessionToken(`${v}.${forged}.${sig}`, SECRET)).toBeNull();
    expect(payload.length).toBeGreaterThan(10);
    const expired = await signSessionToken(claims({ exp: Math.floor(Date.now() / 1000) - 5 }), SECRET);
    expect(await verifySessionToken(expired, SECRET)).toBeNull();
  });
});

describe("modo de acceso", () => {
  it("contraseña con secreto + credenciales; bloqueado en producción sin configuración", () => {
    expect(resolveAuthMode({ AUTH_SECRET: SECRET, AUTH_USERS: "[]", NODE_ENV: "production" })).toBe("password");
    expect(resolveAuthMode({ NODE_ENV: "production" })).toBe("locked");
    expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("open");
    expect(resolveAuthMode({ AUTH_MODE: "header" })).toBe("header");
    expect(resolveAuthMode({ AUTH_SECRET: "corto", AUTH_USERS: "[]", NODE_ENV: "production" })).toBe("locked");
  });
  it("AUTH_MODE=dev (valor de la primera versión) no apaga contraseñas ni abre producción", () => {
    expect(resolveAuthMode({ AUTH_MODE: "dev", AUTH_SECRET: SECRET, AUTH_USERS: "[]", NODE_ENV: "development" })).toBe("password");
    expect(resolveAuthMode({ AUTH_MODE: "dev", NODE_ENV: "production" })).toBe("locked");
    expect(resolveAuthMode({ AUTH_MODE: "dev", NODE_ENV: "development" })).toBe("open");
    expect(resolveAuthMode({ AUTH_MODE: "open", AUTH_SECRET: SECRET, AUTH_USERS: "[]" })).toBe("open");
  });
});

describe("configuración de cuentas", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
    resetAuthConfig();
  });
  it.each(["[]", "{invalid", '[{"u":"admin","r":"admin","h":"invalid"}]'])("no abre desarrollo cuando las credenciales nominales configuradas son inválidas: %s", raw => {
    process.env = { ...process.env, NODE_ENV: "development" };
    process.env.AUTH_MODE = "password";
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = raw;
    delete process.env.AUTH_UNIVERSAL_PASSWORD_HASH;
    resetAuthConfig();
    expect(getAuthConfig().mode).toBe("locked");
  });
  it("lee AUTH_USERS con formato corto y valida roles/hashes", async () => {
    const h = await hashPassword("Izzi-Prueba-1234");
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = JSON.stringify([
      { u: "jmartinez", n: "J. Martínez", r: "admin", h },
      { u: "operaciones", n: "Operaciones", r: "coadmin", h },
      { u: "malo", r: "superadmin", h },
    ]);
    resetAuthConfig();
    const cfg = getAuthConfig();
    expect(cfg.mode).toBe("password");
    expect(cfg.accounts.map((a) => `${a.username}:${a.role}`)).toEqual(["jmartinez:admin", "operaciones:coadmin"]);
    expect(cfg.issues.some((i) => i.includes("malo"))).toBe(true);
  });
});

describe("permisos", () => {
  it("co-administrador = administrador; consulta solo acusa, tickets y mensaje", () => {
    expect(can("coadmin", "settings:write")).toBe(true);
    expect(can("coadmin", "users:view")).toBe(true);
    expect(can("viewer", "settings:write")).toBe(false);
    expect(can("viewer", "tickets:write")).toBe(true);
    expect(can("viewer", "reports:write")).toBe(true);
    expect(can("manager", "users:view")).toBe(false);
  });
});

describe("freno de fuerza bruta y bitácora", () => {
  it("bloquea tras 5 fallos y se libera con un acceso correcto", () => {
    const key = "1.2.3.x|test";
    for (let i = 0; i < 4; i++) registerFailure(key);
    expect(isLocked(key).locked).toBe(false);
    registerFailure(key);
    expect(isLocked(key).locked).toBe(true);
    registerSuccess(key);
    expect(isLocked(key).locked).toBe(false);
  });
  it("enmascara IP y resume el navegador", () => {
    expect(maskIp("189.203.10.44, 10.0.0.1")).toBe("189.203.10.x");
    expect(maskIp("2806:10a6:1:2:3::1")).toBe("2806:10a6:1::x");
    expect(summarizeAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe("Safari · macOS");
  });
});
