import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { resetAuthConfig } from "@/lib/auth/config";
import { PERMISSIONS, permissionsOf, type Permission } from "@/lib/auth/roles";
import { createAccount, updateAccount, updateUniversal, type Actor } from "@/lib/auth/user-admin";
import { effectiveUniversal, findEffectiveAccount, resetUsersCache } from "@/lib/auth/users";
import { SESSION_COOKIE, signSessionToken } from "@/lib/auth/token";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { POST as createUserRoute } from "@/app/api/users/route";
import { PATCH as updateUserRoute } from "@/app/api/users/[username]/route";
import { PUT as universalRoute } from "@/app/api/users/universal/route";

/**
 * Gestión de cuentas: nadie concede marcas o permisos que no tiene (tampoco a sí mismo) y el ID
 * del administrador principal no se puede fabricar desde la app. Identidades sintéticas.
 */

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), cookieSet: vi.fn(), activity: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => (mocks.cookies.has(key) ? { value: mocks.cookies.get(key) } : undefined), set: mocks.cookieSet }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const SECRET = "fixture-user-admin-signing-key-0123456789";
const PASSWORD = "Sintetica-Prueba-2026";
let hash: string;

/** Administración con una sola marca (izzi). */
const izziAdmin: Actor = { id: "admin.izzi", name: "Admin izzi", permissions: PERMISSIONS, brands: ["izzi"] };
const bothAdmin: Actor = { id: "admin.ambas", name: "Admin ambas", permissions: PERMISSIONS, brands: [] };

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  vi.stubEnv("AUTH_MODE", "password");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("RECORDS_BACKEND", "memory");
  vi.stubEnv("AUTH_UNIVERSAL_PASSWORD_HASH", "");
  vi.stubEnv("AUTH_PRIMARY_ADMIN_ID", "principal");
  vi.stubEnv("ALERT_RESPONDER_USER_IDS", "principal,operador.izzi");
  vi.stubEnv("AUTH_USERS", JSON.stringify([
    { u: "admin.izzi", n: "Admin izzi", r: "admin", h: hash, brands: ["izzi"] },
    { u: "admin.ambas", n: "Admin ambas", r: "admin", h: hash },
    { u: "operador.izzi", n: "Operador izzi", r: "manager", h: hash, brands: ["izzi"] },
    { u: "consulta.ambas", n: "Consulta ambas", r: "viewer", h: hash },
    { u: "consulta.sky", n: "Consulta Sky", r: "viewer", h: hash, brands: ["sky"] },
  ]));
  resetAuthConfig();
  resetRecordStore();
  resetUsersCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthConfig();
  resetRecordStore();
  resetUsersCache();
});

const account = (username: string, brands: string[]) => ({ username, name: `Cuenta ${username}`, role: "viewer", permissions: null, brands, password: PASSWORD });

describe("marcas: nadie concede una marca que no tiene", () => {
  it("una administración de una marca no amplía sus propias marcas", async () => {
    for (const brands of [[], ["izzi", "sky"], ["sky"]]) {
      expect(await updateAccount(izziAdmin, "admin.izzi", { name: "Admin izzi", brands })).toMatchObject({ ok: false, status: 403 });
    }
    resetUsersCache();
    expect((await findEffectiveAccount("admin.izzi"))?.brands).toEqual(["izzi"]);
  });

  it("puede reenviar sus marcas sin cambios y reducir las de una cuenta de ambas marcas", async () => {
    expect(await updateAccount(izziAdmin, "admin.izzi", { name: "Admin izzi editado", brands: ["izzi"] })).toMatchObject({ ok: true });
    expect(await updateAccount(izziAdmin, "consulta.ambas", { name: "Consulta ambas", brands: [] })).toMatchObject({ ok: true });
    expect(await updateAccount(izziAdmin, "consulta.ambas", { brands: ["izzi"] })).toMatchObject({ ok: true });
    resetUsersCache();
    expect((await findEffectiveAccount("consulta.ambas"))?.brands).toEqual(["izzi"]);
  });

  it("no crea cuentas con la otra marca ni con ambas", async () => {
    expect(await createAccount(izziAdmin, account("nueva.sky", ["sky"]))).toMatchObject({ ok: false, status: 403 });
    expect(await createAccount(izziAdmin, account("nueva.ambas", []))).toMatchObject({ ok: false, status: 403 });
    expect(await createAccount(izziAdmin, account("nueva.izzi", ["izzi"]))).toMatchObject({ ok: true });
    expect(await createAccount(bothAdmin, account("nueva.ambas", []))).toMatchObject({ ok: true });
  });

  it("no amplía a ambas marcas una cuenta de una sola marca", async () => {
    expect(await updateAccount(izziAdmin, "operador.izzi", { brands: [] })).toMatchObject({ ok: false, status: 403 });
    expect(await updateAccount(izziAdmin, "consulta.sky", { brands: ["izzi", "sky"] })).toMatchObject({ ok: false, status: 403 });
    expect(await updateAccount(bothAdmin, "operador.izzi", { brands: [] })).toMatchObject({ ok: true });
  });

  it("la contraseña universal no se activa ni se amplía hacia una marca ajena", async () => {
    expect(await updateUniversal(izziAdmin, { enabled: true, role: "viewer", brands: [], password: "Universal-Sintetica-2026" })).toMatchObject({ ok: false, status: 403 });
    expect(await updateUniversal(izziAdmin, { enabled: true, role: "viewer", brands: ["izzi"], password: "Universal-Sintetica-2026" })).toMatchObject({ ok: true });
    expect(await updateUniversal(izziAdmin, { brands: ["sky"] })).toMatchObject({ ok: false, status: 403 });
    expect(await updateUniversal(izziAdmin, { enabled: true, role: "viewer", brands: ["izzi"] })).toMatchObject({ ok: true });
    expect(await updateUniversal(izziAdmin, { enabled: false })).toMatchObject({ ok: true });
    expect((await effectiveUniversal()).brands).toEqual(["izzi"]);
  });
});

describe("administrador principal y permisos de la contraseña universal", () => {
  it("el ID protegido no se puede crear desde la app aunque no exista todavía", async () => {
    const result = await createAccount(bothAdmin, { ...account("principal", []), permissions: ["internal:view"] });
    expect(result).toMatchObject({ ok: false, status: 403 });
    resetUsersCache();
    expect(await findEffectiveAccount("principal")).toBeNull();
    expect(await getRecordStore().get("auth/users")).toBeNull();
  });

  it("sin lista nominal, quien no tiene permisos operativos no activa una universal de operativo", async () => {
    vi.stubEnv("ALERT_RESPONDER_USER_IDS", undefined as unknown as string);
    resetAuthConfig();
    const limited: Actor = { id: "admin.limitado", name: "Admin limitado", permissions: PERMISSIONS.filter((p) => !(["alerts:write", "incidents:write", "tickets:write", "tickets:manage", "novedades:write", "reports:write", "monitoring:trigger"] as Permission[]).includes(p)) };
    expect(await updateUniversal(limited, { enabled: true, role: "manager", password: "Universal-Sintetica-2026" })).toMatchObject({ ok: false, status: 403 });
    expect(await updateUniversal(bothAdmin, { enabled: true, role: "manager", password: "Universal-Sintetica-2026" })).toMatchObject({ ok: true });
    expect(await updateUniversal(limited, { enabled: false })).toMatchObject({ ok: true });
  });

  it("con lista nominal la universal de operativo no responde alertas y se puede configurar sin ampliar permisos", async () => {
    const notResponder: Actor = { ...bothAdmin, permissions: permissionsOf("admin").filter((p) => !["alerts:write", "incidents:write", "incidents:assign", "tickets:write", "tickets:manage", "novedades:write", "reports:write", "monitoring:trigger", "audit:write"].includes(p)) };
    expect(await updateUniversal(notResponder, { enabled: true, role: "manager", password: "Universal-Sintetica-2026" })).toMatchObject({ ok: true });
  });
});

describe("las rutas pasan las marcas de la sesión", () => {
  async function login(sub: string) {
    const now = Math.floor(Date.now() / 1000);
    mocks.cookies.set(SESSION_COOKIE, await signSessionToken({ sub, name: sub, role: "admin", kind: "named", sid: "fixture", iat: now, exp: now + 600, v: 0 }, SECRET));
  }
  const body = (value: unknown) => new NextRequest("http://monitor.test/api/users", { method: "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" } });

  it("POST /api/users, PATCH /api/users/[id] y PUT /api/users/universal rechazan marcas ajenas", async () => {
    await login("admin.izzi");
    expect((await createUserRoute(body(account("ruta.sky", ["sky"])))).status).toBe(403);
    expect((await updateUserRoute(body({ brands: [] }), { params: Promise.resolve({ username: "admin.izzi" }) })).status).toBe(403);
    expect((await updateUserRoute(body({ brands: [] }), { params: Promise.resolve({ username: "operador.izzi" }) })).status).toBe(403);
    expect((await universalRoute(body({ enabled: true, role: "viewer", brands: [], password: "Universal-Sintetica-2026" }))).status).toBe(403);
    expect(mocks.activity).not.toHaveBeenCalled();
    // Fuera de la lista nominal no tiene permisos operativos: crea la cuenta con permisos que sí tiene.
    expect((await createUserRoute(body({ ...account("ruta.izzi", ["izzi"]), permissions: ["internal:view", "client:view"] }))).status).toBe(200);
  });
});
