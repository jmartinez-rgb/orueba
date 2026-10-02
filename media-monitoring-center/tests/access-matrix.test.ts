import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getSession, requireAuth, requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, type Role } from "@/lib/auth/roles";
import { hashPassword } from "@/lib/auth/password";
import { resetAuthConfig } from "@/lib/auth/config";
import { resetUsersCache } from "@/lib/auth/users";
import { SESSION_COOKIE, signSessionToken, type SessionClaims } from "@/lib/auth/token";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { resetEnvCache } from "@/lib/config/env";
import { GET as alerts } from "@/app/api/alerts/route";
import { GET as incidents } from "@/app/api/incidents/route";
import { GET as snapshot } from "@/app/api/monitoring/snapshot/route";
import { GET as integrations } from "@/app/api/integrations/route";
import { GET as dataHealth } from "@/app/api/data-health/route";
import { GET as budgets, PUT as writeBudget } from "@/app/api/budgets/route";
import { GET as settings, PATCH as writeSettings } from "@/app/api/settings/route";
import { GET as compare } from "@/app/api/compare/route";
import { GET as historical } from "@/app/api/historical/route";
import { GET as tickets, POST as createTicket } from "@/app/api/tickets/route";
import { GET as novedades, POST as createNovedad } from "@/app/api/novedades/route";
import { GET as reports, POST as createReport } from "@/app/api/reports/route";
import { GET as users, POST as createUser } from "@/app/api/users/route";
import { PATCH as writeAlert } from "@/app/api/alerts/[id]/route";
import { PATCH as writeIncident } from "@/app/api/incidents/[id]/route";
import { PATCH as writeFeedback } from "@/app/api/feedback/[id]/route";
import { GET as pendingCritical, POST as acknowledgeCritical } from "@/app/api/critical/route";
import { POST as switchBrand } from "@/app/api/brand/route";
import { POST as switchRole } from "@/app/api/session/role/route";
import { POST as evaluate } from "@/app/api/monitoring/evaluate/route";

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(), cookieSet: vi.fn(), snapshot: vi.fn(), context: vi.fn(), activity: vi.fn(),
  critical: vi.fn(), acknowledge: vi.fn(), evaluate: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => mocks.cookies.has(key) ? { value: mocks.cookies.get(key) } : undefined, set: mocks.cookieSet }),
  headers: async () => new Headers({ "user-agent": "Fixture Browser" }),
}));
vi.mock("@/lib/services/snapshot", () => ({ getSnapshot: mocks.snapshot, getFullSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));
vi.mock("@/lib/services/critical", () => ({ pendingCritical: mocks.critical, acknowledgeCritical: mocks.acknowledge }));
vi.mock("@/lib/services/evaluate", () => ({ evaluateAllBrands: mocks.evaluate }));

const secret = "fixture-auth-signing-key-0123456789abcdefgh";
const responders = ["jmartinez", "dracines", "jvargas", "stamayo", "vcardenas"];
const accounts: Array<{ u: string; r: Role; permissions?: typeof PERMISSIONS; brands?: string[] }> = [
  { u: "jmartinez", r: "admin", permissions: [] }, { u: "dracines", r: "coadmin" },
  { u: "jvargas", r: "manager" }, { u: "stamayo", r: "manager" }, { u: "vcardenas", r: "manager" },
  { u: "hernan", r: "admin" }, { u: "gmarin", r: "manager" }, { u: "operations", r: "manager" },
  { u: "viewer", r: "viewer" }, { u: "auditor", r: "auditor" },
  { u: "client", r: "client", permissions: PERMISSIONS, brands: ["izzi"] },
];
let hash: string;
beforeAll(async () => { hash = await hashPassword("Ficticia-Matriz-2026"); });
beforeEach(() => {
  vi.clearAllMocks(); mocks.cookies.clear();
  vi.stubEnv("AUTH_MODE", "password"); vi.stubEnv("AUTH_SECRET", secret);
  vi.stubEnv("AUTH_USERS", JSON.stringify(accounts.map(account => ({ ...account, h: hash, n: account.u }))));
  vi.stubEnv("AUTH_PRIMARY_ADMIN_ID", "jmartinez");
  vi.stubEnv("ALERT_RESPONDER_USER_IDS", responders.join(","));
  vi.stubEnv("AUTH_UNIVERSAL_PASSWORD_HASH", ""); vi.stubEnv("RECORDS_BACKEND", "memory");
  vi.stubEnv("DATA_SOURCE", "unified"); vi.stubEnv("MONITORING_API_KEY", "fixture-scheduler-key");
  vi.stubEnv("LOG_LEVEL", "error");
  resetAuthConfig(); resetUsersCache(); resetRecordStore(); resetEnvCache();
  mocks.snapshot.mockRejectedValue(new Error("Unexpected data access"));
  mocks.context.mockRejectedValue(new Error("Unexpected context access"));
  mocks.critical.mockResolvedValue([{ id: "INC-0001" }]);
  mocks.acknowledge.mockResolvedValue({ acknowledged: ["INC-0001"], ticketId: null });
  mocks.evaluate.mockResolvedValue([{ ok: true, brand: "izzi" }]);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tests must not use network"); }));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  resetAuthConfig(); resetUsersCache(); resetRecordStore(); resetEnvCache();
});

async function login(username: string, overrides: Partial<SessionClaims> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const account = accounts.find(account => account.u === username);
  mocks.cookies.set(SESSION_COOKIE, await signSessionToken({ sub: username, name: username, role: account?.r ?? "admin", kind: "named", sid: "fixture-session", iat: now, exp: now + 3600, v: 0, ...overrides }, secret));
}
const request = (body: unknown = {}) => new NextRequest("http://monitor.test/api/fixture", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const criticalBody = { incidentIds: ["INC-0001"], text: "Revisé el corte y la entrega de campañas.", reportTo: "Equipo Paid Media", confirmed: true };
const reads: Array<[string, () => Promise<Response>]> = [
  ["alerts", () => alerts(request())], ["incidents", () => incidents(request())], ["snapshot", snapshot],
  ["integrations", integrations], ["data-health", dataHealth], ["budgets", budgets], ["settings", settings],
  ["compare", () => compare(request())], ["historical", () => historical(request())],
  ["tickets", tickets], ["novedades", novedades], ["reports", reports],
];
const writes: Array<[string, () => Promise<Response>]> = [
  ["settings", () => writeSettings(request({ path: "thresholds.attention", value: 0.2 }))],
  ["budgets", () => writeBudget(request())], ["tickets", () => createTicket(request())],
  ["novedades", () => createNovedad(request())], ["reports", () => createReport(request())],
  ["users", () => createUser(request())],
  ["alerts", () => writeAlert(request({ status: "RESOLVED" }), { params: Promise.resolve({ id: "ALT-ABC" }) })],
  ["incidents", () => writeIncident(request({ note: "Nota no autorizada" }), { params: Promise.resolve({ id: "INC-0001" }) })],
  ["feedback", () => writeFeedback(request({ adminNote: "Intento de editar" }), { params: Promise.resolve({ id: "FB-0001" }) })],
];
const invalidSchedulerHeaders: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { "x-api-key": "wrong" }, { authorization: "fixture-scheduler-key" }];
const validSchedulerHeaders: Record<string, string>[] = [{ authorization: "Bearer fixture-scheduler-key" }, { "x-api-key": "fixture-scheduler-key" }];

describe("sesiones firmadas y acceso directo a API", () => {
  it.each(reads)("%s rechaza lectura sin sesión y de cliente antes de consultar datos", async (_name, invoke) => {
    const storeRead = vi.spyOn(getRecordStore(), "list");
    for (const username of [null, "client"]) {
      if (username) await login(username, { role: "admin" });
      const response = await invoke();
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
    expect(storeRead).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(writes)("%s rechaza al cliente y consulta interna fuera de responsables antes de escribir", async (_name, invoke) => {
    const storeWrite = vi.spyOn(getRecordStore(), "set");
    for (const username of ["client", "viewer"]) {
      await login(username, { role: "admin" });
      expect((await invoke()).status).toBe(403);
    }
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(storeWrite).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("el administrador principal conserva todos los permisos aunque su lista personalizada esté vacía", async () => {
    await login("jmartinez");
    const session = await getSession();
    expect(session.permissions).toEqual(PERMISSIONS);
    expect(await requirePermission("users:manage")).not.toBeNull();
    const body = await (await users()).json();
    expect(body.accounts).toHaveLength(accounts.length);
    expect(JSON.stringify(body)).not.toContain(hash);
    expect(JSON.stringify(body)).not.toContain("Ficticia-Matriz-2026");
  });

  it.each(responders)("%s puede leer y acusar críticos con su identidad nominal", async username => {
    await login(username);
    expect(await requirePermission("incidents:write")).not.toBeNull();
    expect(await (await pendingCritical()).json()).toMatchObject({ ok: true, pending: [{ id: "INC-0001" }] });
    expect((await acknowledgeCritical(request(criticalBody))).status).toBe(200);
    expect(mocks.acknowledge.mock.calls[0][0].user.id).toBe(username);
  });

  it.each(["hernan", "gmarin", "operations", "viewer", "auditor"])("%s conserva consulta y no responde críticos fuera de la lista", async username => {
    await login(username);
    expect(await requireAuth()).not.toBeNull();
    expect(await (await pendingCritical()).json()).toEqual({ ok: true, pending: [] });
    expect((await acknowledgeCritical(request(criticalBody))).status).toBe(403);
    expect(mocks.critical).not.toHaveBeenCalled(); expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(await requirePermission("alerts:write")).toBeNull(); expect(await requirePermission("incidents:write")).toBeNull();
  });

  it.each(["dracines", "jvargas", "stamayo", "vcardenas", "gmarin", "auditor", "client"])("%s no recibe cuentas ni hashes por /api/users", async username => {
    await login(username);
    expect((await users()).status).toBe(403);
  });

  it("la cookie de rol y el rol del token no elevan la cuenta nominal", async () => {
    mocks.cookies.set("immc_role", "admin");
    await login("client", { role: "admin" });
    expect(await getSession()).toMatchObject({ role: "client", permissions: ["client:view"] });
    expect((await switchRole(request({ role: "admin" }))).status).toBe(403);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("un cambio de rol o permisos almacenado aplica a una sesión abierta", async () => {
    await login("jvargas");
    expect(await requirePermission("incidents:write")).not.toBeNull();
    await getRecordStore().set("auth/users", [{ username: "jvargas", role: "viewer", hash, permissions: [], brands: ["izzi"], active: true, version: 0 }]);
    resetUsersCache();
    expect(await getSession()).toMatchObject({ authenticated: true, role: "viewer", permissions: ["internal:view", "client:view"], brands: ["izzi"] });
    expect(await requirePermission("incidents:write")).toBeNull();
  });

  it.each([{ active: false, version: 0 }, { active: true, version: 1 }])("desactivar o rotar versión revoca la sesión existente: %j", async patch => {
    await login("jvargas");
    await getRecordStore().set("auth/users", [{ username: "jvargas", role: "manager", hash, brands: ["izzi"], ...patch }]);
    resetUsersCache();
    expect((await getSession()).authenticated).toBe(false);
    expect((await incidents(request())).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it.each([{ brands: "izzi" }, { brands: ["other"] }, { permissions: ["root"] }, { active: "false" }, { version: -1 }, { version: 0.5 }])("datos de acceso corruptos fallan cerrados y no restauran el administrador del entorno: %j", async patch => {
    await login("jmartinez");
    await getRecordStore().set("auth/users", [{ username: "jmartinez", role: "admin", hash, version: 0, ...patch }]);
    resetUsersCache();
    expect((await getSession()).authenticated).toBe(false);
    expect((await users()).status).toBe(403);
    expect((await incidents(request())).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("un fallo del almacén revoca el acceso y no usa permisos previos de AUTH_USERS", async () => {
    await login("jmartinez");
    vi.spyOn(getRecordStore(), "get").mockRejectedValue(new Error("Fixture storage unavailable"));
    resetUsersCache();
    expect((await getSession()).authenticated).toBe(false);
    expect((await users()).status).toBe(403);
  });

  it("tokens vencidos, firma alterada y cuenta inexistente no leen datos", async () => {
    for (const kind of ["expired", "tampered", "missing"]) {
      await login(kind === "missing" ? "nonexistent" : "jmartinez", kind === "expired" ? { exp: 1 } : {});
      if (kind === "tampered") mocks.cookies.set(SESSION_COOKIE, mocks.cookies.get(SESSION_COOKIE)! + "altered");
      expect((await incidents(request())).status).toBe(401);
    }
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});

describe("marca y autenticación del scheduler", () => {
  it("el cliente cambia solo a una marca asignada y no fija cookies para marcas ajenas o inválidas", async () => {
    await login("client");
    expect((await switchBrand(request({ brand: "sky" }))).status).toBe(403);
    expect((await switchBrand(request({ brand: "other" }))).status).toBe(400);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect((await switchBrand(request({ brand: "izzi" }))).status).toBe(200);
    expect(mocks.cookieSet).toHaveBeenCalledWith("immc_brand", "izzi", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it.each(invalidSchedulerHeaders)("el endpoint programado no acepta cookies ni llaves incorrectas: %j", async headers => {
    await login("jmartinez");
    const response = await evaluate(new Request("http://monitor.test/api/monitoring/evaluate", { method: "POST", headers }));
    expect(response.status).toBe(401);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it.each(validSchedulerHeaders)("acepta únicamente la llave de servidor configurada: %j", async headers => {
    const response = await evaluate(new Request("http://monitor.test/api/monitoring/evaluate", { method: "POST", headers, body: JSON.stringify({ dryRun: true }) }));
    expect(response.status).toBe(200);
    expect(mocks.evaluate).toHaveBeenCalledWith({ dryRun: true, trigger: "schedule" });
  });

  it("sin llave de servidor la fuente real deshabilita el endpoint aunque haya administrador firmado", async () => {
    await login("jmartinez");
    vi.stubEnv("MONITORING_API_KEY", ""); resetEnvCache();
    expect((await evaluate(request())).status).toBe(503);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});
