import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { resetAuthConfig } from "@/lib/auth/config";
import { resetUsersCache } from "@/lib/auth/users";
import { isLocked, MAX_TRACKED_KEYS, registerFailure } from "@/lib/auth/rate-limit";
import { resetRecordStore } from "@/lib/records/store";
import { POST as login } from "@/app/api/auth/login/route";

/**
 * Inicio de sesión: el freno de fuerza bruta no se reinicia inundando usuarios inventados y el
 * tiempo de respuesta no distingue cuentas existentes. Credenciales sintéticas, sin red.
 */

const mocks = vi.hoisted(() => ({ scrypt: 0, cookieSet: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  const scrypt = ((...args: Parameters<typeof original.scrypt>) => {
    mocks.scrypt++;
    return (original.scrypt as (...a: unknown[]) => void)(...args);
  }) as typeof original.scrypt;
  return { ...original, default: { ...original, scrypt }, scrypt };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: mocks.cookieSet, delete: vi.fn() }),
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7", "user-agent": "Fixture Browser" }),
}));

const SECRET = "fixture-login-signing-key-0123456789abcdef";
let hash: string;
const attempts = () => (globalThis as unknown as { __immcLoginAttempts?: Map<string, unknown> }).__immcLoginAttempts;

beforeAll(async () => {
  hash = await hashPassword("Sintetica-Login-2026");
});
beforeEach(() => {
  delete (globalThis as unknown as { __immcLoginAttempts?: unknown }).__immcLoginAttempts;
  mocks.cookieSet.mockReset();
  vi.stubEnv("AUTH_MODE", "password");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("RECORDS_BACKEND", "memory");
  vi.stubEnv("LOG_LEVEL", "error");
  vi.stubEnv("AUTH_UNIVERSAL_PASSWORD_HASH", "");
  vi.stubEnv("AUTH_USERS", JSON.stringify([{ u: "existente", n: "Persona Existente", r: "viewer", h: hash, email: "existente@example.test" }]));
  resetAuthConfig();
  resetUsersCache();
  resetRecordStore();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthConfig();
  resetUsersCache();
  resetRecordStore();
});

describe("freno de fuerza bruta", () => {
  it("inundar con usuarios inventados no reinicia el contador de una cuenta", () => {
    const target = "203.0.113.x|existente";
    for (let i = 0; i < 4; i++) registerFailure(target);
    for (let i = 0; i < 5001; i++) registerFailure(`198.51.100.x|inventado-${i}`);
    expect(registerFailure(target).locked).toBe(true);
    expect(isLocked(target).locked).toBe(true);
  });

  it("un bloqueo vigente sobrevive al tope de memoria", () => {
    const target = "203.0.113.x|bloqueado";
    for (let i = 0; i < 5; i++) registerFailure(target);
    for (let i = 0; i < MAX_TRACKED_KEYS + 50; i++) registerFailure(`198.51.100.x|relleno-${i}`);
    expect(isLocked(target).locked).toBe(true);
    expect(attempts()!.size).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
  });

  it("la memoria queda acotada descartando primero lo vencido", () => {
    const old = Date.now() - 11 * 60 * 1000;
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) registerFailure(`198.51.100.x|viejo-${i}`, old);
    registerFailure("203.0.113.x|reciente");
    expect(attempts()!.size).toBe(1);
  });
});

describe("respuesta de inicio de sesión sin oráculo de usuarios", () => {
  const request = (username: string, password: string) =>
    new Request("http://monitor.test/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }), headers: { "Content-Type": "application/json" } });

  async function scryptCalls(username: string) {
    const before = mocks.scrypt;
    const response = await login(request(username, "Incorrecta-Sintetica-1"));
    return { calls: mocks.scrypt - before, status: response.status, body: await response.json() };
  }

  it("usuario inexistente, correo inexistente y contraseña incorrecta hacen el mismo trabajo y responden igual", async () => {
    await scryptCalls("calentamiento"); // la primera vez prepara la huella señuelo
    const known = await scryptCalls("existente");
    const knownEmail = await scryptCalls("existente@example.test");
    const unknown = await scryptCalls("no-existe");
    const unknownEmail = await scryptCalls("nadie@example.test");
    expect(known.calls).toBe(1);
    for (const result of [knownEmail, unknown, unknownEmail]) {
      expect(result.calls).toBe(known.calls);
      expect(result.status).toBe(401);
      expect(result.body).toEqual(known.body);
    }
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  }, 20_000);

  it("con contraseña universal, un nombre reservado por una cuenta también verifica la contraseña", async () => {
    vi.stubEnv("AUTH_UNIVERSAL_PASSWORD_HASH", hash);
    resetAuthConfig();
    const reserved = await scryptCalls("Persona Existente");
    const free = await scryptCalls("Persona Libre");
    expect(reserved.calls).toBe(1);
    expect(free.calls).toBe(1);
    expect(reserved.body).toEqual(free.body);
  }, 20_000);
});
