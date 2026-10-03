import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { PERMISSIONS, permissionsOf } from "@/lib/auth/roles";
import { resetAuthConfig } from "@/lib/auth/config";
import { resetUsersCache } from "@/lib/auth/users";
import { SESSION_COOKIE, signSessionToken } from "@/lib/auth/token";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { resetEnvCache } from "@/lib/config/env";
import * as absoluteTop from "@/app/api/absolute-top/route";
import * as accountPassword from "@/app/api/account/password/route";
import * as alerts from "@/app/api/alerts/route";
import * as alert from "@/app/api/alerts/[id]/route";
import * as audit from "@/app/api/audit/incidents/route";
import * as auditReview from "@/app/api/audit/incidents/[id]/route";
import * as brand from "@/app/api/brand/route";
import * as budgets from "@/app/api/budgets/route";
import * as compare from "@/app/api/compare/route";
import * as critical from "@/app/api/critical/route";
import * as dataHealth from "@/app/api/data-health/route";
import * as feedback from "@/app/api/feedback/route";
import * as feedbackItem from "@/app/api/feedback/[id]/route";
import * as historical from "@/app/api/historical/route";
import * as incidents from "@/app/api/incidents/route";
import * as incident from "@/app/api/incidents/[id]/route";
import * as assignees from "@/app/api/incidents/assignees/route";
import * as integrations from "@/app/api/integrations/route";
import * as integrationTest from "@/app/api/integrations/test/route";
import * as kickoff from "@/app/api/kickoff/route";
import * as evaluate from "@/app/api/monitoring/evaluate/route";
import * as run from "@/app/api/monitoring/run/route";
import * as snapshot from "@/app/api/monitoring/snapshot/route";
import * as nexus from "@/app/api/nexus/route";
import * as novedades from "@/app/api/novedades/route";
import * as novedad from "@/app/api/novedades/[id]/route";
import * as reports from "@/app/api/reports/route";
import * as sessionRole from "@/app/api/session/role/route";
import * as settings from "@/app/api/settings/route";
import * as tickets from "@/app/api/tickets/route";
import * as ticket from "@/app/api/tickets/[id]/route";
import * as users from "@/app/api/users/route";
import * as user from "@/app/api/users/[username]/route";
import * as universal from "@/app/api/users/universal/route";

/**
 * Matriz rol x ruta x método con identidades sintéticas que reproducen la política nominal:
 * principal protegido, Hernán administra sin responder alertas, Daniel configura y delega sin
 * gestionar cuentas, operativos atienden sin reasignar, lectores y cliente no escriben.
 * "Permitido" = la ruta pasa la autorización (2xx, 400, 404, 409, 500 o 503 de datos simulados).
 * "Denegado" = 401/403 sin tocar datos, almacén ni bitácora.
 */

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(), cookieSet: vi.fn(), snapshot: vi.fn(), context: vi.fn(), view: vi.fn(), activity: vi.fn(),
  pending: vi.fn(), acknowledge: vi.fn(), evaluate: vi.fn(), kickoffStatus: vi.fn(), confirmKickoff: vi.fn(),
  setAlertStatus: vi.fn(), updateIncident: vi.fn(), setBudget: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => (mocks.cookies.has(key) ? { value: mocks.cookies.get(key) } : undefined), set: mocks.cookieSet, delete: vi.fn() }),
  headers: async () => new Headers({ "user-agent": "Fixture Browser" }),
}));
vi.mock("@/lib/services/snapshot", () => ({ getSnapshot: mocks.snapshot, getFullSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", async (importOriginal) => ({ ...(await importOriginal<object>()), getAppContext: mocks.context, getViewContext: mocks.view }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));
vi.mock("@/lib/services/critical", () => ({ pendingCritical: mocks.pending, acknowledgeCritical: mocks.acknowledge }));
vi.mock("@/lib/services/evaluate", () => ({ evaluateAllBrands: mocks.evaluate }));
vi.mock("@/lib/services/kickoff", () => ({ kickoffStatus: mocks.kickoffStatus, confirmKickoff: mocks.confirmKickoff }));

const SECRET = "fixture-matrix-signing-key-0123456789abcdef";
const RESPONDER_IDS = ["jp.principal", "daniel.coadmin", "sebastian.op", "santiago.op", "victoria.op", "operador.izzi"];
const OPERATIONS_PERMISSIONS = [...permissionsOf("manager"), "users:view", "audit:view"];
const IDENTITIES = [
  { u: "jp.principal", r: "admin", permissions: [] as string[] },
  { u: "hernan.admin", r: "admin" },
  { u: "daniel.coadmin", r: "coadmin" },
  { u: "sebastian.op", r: "manager" },
  { u: "santiago.op", r: "manager" },
  { u: "victoria.op", r: "manager" },
  { u: "guillermo.op", r: "manager" },
  { u: "operations", r: "manager", permissions: OPERATIONS_PERMISSIONS },
  { u: "consulta", r: "viewer" },
  { u: "auditor", r: "auditor" },
  { u: "operador.izzi", r: "manager", brands: ["izzi"] },
  { u: "consulta.sky", r: "viewer", brands: ["sky"] },
  { u: "cliente.izzi", r: "client", permissions: PERMISSIONS as string[], brands: ["izzi"] },
] as const;
type Id = (typeof IDENTITIES)[number]["u"];
const ALL = IDENTITIES.map((i) => i.u) as Id[];
const INTERNAL = ALL.filter((u) => u !== "cliente.izzi");
const RESPONDERS = RESPONDER_IDS as Id[];
const CONFIGURATORS: Id[] = ["jp.principal", "hernan.admin", "daniel.coadmin"];
const ACCOUNT_ADMINS: Id[] = ["jp.principal", "hernan.admin"];
const ASSIGNERS: Id[] = ["jp.principal", "daniel.coadmin"];
const AUDIT_VIEW: Id[] = ["jp.principal", "hernan.admin", "daniel.coadmin", "operations", "auditor"];
const TECHNICAL = INTERNAL.filter((u) => !["consulta", "consulta.sky"].includes(u));
const IZZI_INTERNAL = INTERNAL.filter((u) => u !== "consulta.sky");

let hash: string;
beforeAll(async () => {
  hash = await hashPassword("Matriz-Sintetica-2026");
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  vi.stubEnv("AUTH_MODE", "password");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_USERS", JSON.stringify(IDENTITIES.map((i) => ({ ...i, h: hash, n: i.u }))));
  vi.stubEnv("AUTH_PRIMARY_ADMIN_ID", "jp.principal");
  vi.stubEnv("ALERT_RESPONDER_USER_IDS", RESPONDER_IDS.join(","));
  vi.stubEnv("AUTH_UNIVERSAL_PASSWORD_HASH", "");
  vi.stubEnv("RECORDS_BACKEND", "memory");
  vi.stubEnv("DATA_SOURCE", "unified");
  vi.stubEnv("MONITORING_API_KEY", "fixture-scheduler-key-0123456789");
  vi.stubEnv("LOG_LEVEL", "silent");
  resetAuthConfig(); resetUsersCache(); resetRecordStore(); resetEnvCache();
  const store = { setAlertStatus: mocks.setAlertStatus, updateIncident: mocks.updateIncident, setBudget: mocks.setBudget };
  mocks.context.mockResolvedValue({ brand: "izzi", store, domain: { id: "all" }, mode: "unified", settings: { recipients: [{ address: "+520000000000" }] }, settingsRevision: "r1" });
  mocks.view.mockResolvedValue({ brand: "izzi", store, domain: { id: "all" } });
  mocks.snapshot.mockResolvedValue({ meta: { brand: { id: "izzi" } }, state: { alerts: [{ id: "ALT-ABC" }], incidents: [{ id: "INC-0001", resolvedAt: null }] } });
  mocks.pending.mockResolvedValue([{ id: "INC-0001" }]);
  mocks.acknowledge.mockResolvedValue({ acknowledged: ["INC-0001"], ticketId: null });
  mocks.evaluate.mockResolvedValue([{ ok: true, brand: "izzi" }]);
  mocks.kickoffStatus.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Las pruebas no usan red"); }));
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  resetAuthConfig(); resetUsersCache(); resetRecordStore(); resetEnvCache();
});

async function login(u: Id) {
  const now = Math.floor(Date.now() / 1000);
  const identity = IDENTITIES.find((i) => i.u === u)!;
  mocks.cookies.set(SESSION_COOKIE, await signSessionToken({ sub: u, name: u, role: identity.r, kind: "named", sid: "fixture", iat: now, exp: now + 600, v: 0 }, SECRET));
}
const req = (method: string, body?: unknown, path = "/api/fixture") =>
  new NextRequest(`http://monitor.test${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const criticalBody = { incidentIds: ["INC-0001"], text: "Revisé el corte y la entrega de las campañas.", reportTo: "Equipo Paid Media", confirmed: true };
const ticketBody = { title: "Ticket sintético", description: "Descripción sintética del problema.", severity: "ALERT", category: "OTRO", platform: null };

type Row = [string, string, () => Promise<Response>, Id[]];
const ROWS: Row[] = [
  // Lecturas internas: todo el equipo; cliente nunca.
  ["/api/alerts", "GET", () => alerts.GET(req("GET")), INTERNAL],
  ["/api/incidents", "GET", () => incidents.GET(req("GET")), INTERNAL],
  ["/api/monitoring/snapshot", "GET", () => snapshot.GET(), INTERNAL],
  ["/api/data-health", "GET", () => dataHealth.GET(), INTERNAL],
  ["/api/budgets", "GET", () => budgets.GET(), INTERNAL],
  ["/api/settings", "GET", () => settings.GET(), INTERNAL],
  ["/api/compare", "GET", () => compare.GET(req("GET")), INTERNAL],
  ["/api/historical", "GET", () => historical.GET(req("GET")), INTERNAL],
  ["/api/tickets", "GET", () => tickets.GET(), INTERNAL],
  ["/api/novedades", "GET", () => novedades.GET(), INTERNAL],
  ["/api/reports", "GET", () => reports.GET(), INTERNAL],
  ["/api/kickoff", "GET", () => kickoff.GET(), INTERNAL],
  ["/api/integrations", "GET", () => integrations.GET(), INTERNAL],
  ["/api/feedback", "GET", () => feedback.GET(), INTERNAL],
  ["/api/feedback", "POST", () => feedback.POST(req("POST", {})), INTERNAL],
  ["/api/nexus", "POST", () => nexus.POST(req("POST", { question: "¿Cómo va?", brand: "izzi" })), IZZI_INTERNAL],
  ["/api/absolute-top", "GET", () => absoluteTop.GET(req("GET")), IZZI_INTERNAL],
  // Escrituras de atención: solo la lista nominal (por ID), nunca por título.
  ["/api/alerts/[id]", "PATCH", () => alert.PATCH(req("PATCH", { status: "RESOLVED" }), params({ id: "ALT-ABC" })), RESPONDERS],
  ["/api/incidents/[id]", "PATCH", () => incident.PATCH(req("PATCH", { note: "Nota sintética" }), params({ id: "INC-0001" })), RESPONDERS],
  ["/api/critical", "POST", () => critical.POST(req("POST", criticalBody)), RESPONDERS],
  ["/api/tickets", "POST", () => tickets.POST(req("POST", ticketBody)), RESPONDERS],
  ["/api/tickets/[id]", "PATCH", () => ticket.PATCH(req("PATCH", { text: "Comentario" }), params({ id: "TKT-0001" })), RESPONDERS],
  ["/api/novedades", "POST", () => novedades.POST(req("POST", {})), RESPONDERS],
  ["/api/novedades/[id]", "PATCH", () => novedad.PATCH(req("PATCH", { text: "Seguimiento" }), params({ id: "NOV-0001" })), RESPONDERS],
  ["/api/reports", "POST", () => reports.POST(req("POST", {})), RESPONDERS],
  ["/api/monitoring/run", "POST", () => run.POST(), RESPONDERS],
  // Delegación: principal y subadministrador; operativos atienden sin reasignar.
  ["/api/incidents/[id] (ownerId)", "PATCH", () => incident.PATCH(req("PATCH", { ownerId: "sebastian.op" }), params({ id: "INC-0001" })), ASSIGNERS],
  ["/api/incidents/assignees", "GET", () => assignees.GET(), ASSIGNERS],
  // Configuración: administración y subadministración (no depende de la lista nominal).
  ["/api/settings", "PATCH", () => settings.PATCH(req("PATCH", { path: "thresholds.attention", value: 0.2 })), CONFIGURATORS],
  ["/api/settings", "PUT", () => settings.PUT(req("PUT", {})), CONFIGURATORS],
  ["/api/settings", "DELETE", () => settings.DELETE(req("DELETE")), CONFIGURATORS],
  ["/api/budgets", "PUT", () => budgets.PUT(req("PUT", {})), CONFIGURATORS],
  ["/api/kickoff", "PUT", () => kickoff.PUT(req("PUT", {})), CONFIGURATORS],
  // Cuentas y contraseñas: principal y Hernán; Daniel y Operations no.
  ["/api/users", "GET", () => users.GET(), ACCOUNT_ADMINS],
  ["/api/users", "POST", () => users.POST(req("POST", {})), ACCOUNT_ADMINS],
  ["/api/users/[username]", "PATCH", () => user.PATCH(req("PATCH", {}), params({ username: "consulta" })), ACCOUNT_ADMINS],
  ["/api/users/[username]", "DELETE", () => user.DELETE(req("DELETE"), params({ username: "consulta" })), ACCOUNT_ADMINS],
  ["/api/users/universal", "PUT", () => universal.PUT(req("PUT", {})), ACCOUNT_ADMINS],
  ["/api/feedback/[id]", "PATCH", () => feedbackItem.PATCH(req("PATCH", { adminNote: "Nota" }), params({ id: "FB-0001" })), ACCOUNT_ADMINS],
  // Auditoría y detalle técnico.
  ["/api/audit/incidents", "GET", () => audit.GET(req("GET")), AUDIT_VIEW],
  ["/api/audit/incidents/[id]", "POST", () => auditReview.POST(req("POST", { verdict: "CUMPLE", comment: "" }), params({ id: "INC-0001" })), ["jp.principal"]],
  ["/api/integrations/test", "POST", () => integrationTest.POST(req("POST", {})), TECHNICAL],
  // Preferencias de vista y cuenta propia: cualquiera con sesión (incluido cliente).
  ["/api/brand", "POST", () => brand.POST(req("POST", { brand: "izzi" })), ALL.filter((u) => u !== "consulta.sky")],
  ["/api/account/password", "POST", () => accountPassword.POST(req("POST", {})), ALL],
  // Selector de rol de demo y endpoint programado: nunca con una sesión nominal.
  ["/api/session/role", "POST", () => sessionRole.POST(req("POST", { role: "admin" })), []],
  ["/api/monitoring/evaluate", "POST", () => evaluate.POST(req("POST", {})), []],
];

const SIDE_EFFECTS = () => [mocks.setAlertStatus, mocks.updateIncident, mocks.setBudget, mocks.acknowledge, mocks.evaluate, mocks.confirmKickoff, mocks.activity];

describe("matriz rol x ruta x método", () => {
  it.each(ROWS)("%s %s", async (path, method, invoke, allowed) => {
    const observed: Record<string, number> = {};
    for (const u of ALL) {
      vi.clearAllMocks();
      await login(u);
      const write = vi.spyOn(getRecordStore(), "set");
      const update = vi.spyOn(getRecordStore(), "update");
      const status = (await invoke()).status;
      observed[u] = status;
      const denied = status === 401 || status === 403;
      if (allowed.includes(u)) expect(denied, `${u} debería pasar ${method} ${path} (HTTP ${status})`).toBe(false);
      else {
        expect(denied, `${u} no debería pasar ${method} ${path} (HTTP ${status})`).toBe(true);
        for (const effect of SIDE_EFFECTS()) expect(effect, `${u} ${method} ${path}`).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      }
      write.mockRestore(); update.mockRestore();
    }
    expect(Object.keys(observed)).toHaveLength(ALL.length);
    // Evidencia opcional para el informe: AUTHZ_MATRIX_OUT=/ruta/archivo.jsonl (sin datos privados).
    if (process.env.AUTHZ_MATRIX_OUT) (await import("node:fs")).appendFileSync(process.env.AUTHZ_MATRIX_OUT, `${JSON.stringify({ path, method, observed })}\n`);
  });

  it("la configuración se lee con destinatarios enmascarados salvo para quien la edita", async () => {
    for (const u of INTERNAL) {
      await login(u);
      const body = await (await settings.GET()).json();
      const address = body.settings.recipients[0].address;
      if (CONFIGURATORS.includes(u)) expect(address, u).toBe("+520000000000");
      else expect(address, u).not.toBe("+520000000000");
    }
  });

  it("acuses críticos: solo la lista nominal recibe pendientes; los demás leen una lista vacía", async () => {
    for (const u of ALL) {
      vi.clearAllMocks();
      await login(u);
      const response = await critical.GET();
      if (u === "cliente.izzi") { expect(response.status).toBe(401); continue; }
      const body = await response.json();
      expect(body.pending, u).toEqual(RESPONDERS.includes(u) ? [{ id: "INC-0001" }] : []);
      expect(mocks.pending).toHaveBeenCalledTimes(RESPONDERS.includes(u) ? 1 : 0);
    }
  });
});

describe("administrador principal, delegación y revocación de sesiones", () => {
  it("nadie más edita ni elimina al principal; él no cambia su rol/estado ni se elimina", async () => {
    await login("hernan.admin");
    expect((await user.PATCH(req("PATCH", { password: "Nueva-Sintetica-2026" }), params({ username: "jp.principal" }))).status).toBe(403);
    expect((await user.PATCH(req("PATCH", { active: false }), params({ username: "jp.principal" }))).status).toBe(403);
    expect((await user.DELETE(req("DELETE"), params({ username: "jp.principal" }))).status).toBe(403);
    await login("jp.principal");
    expect((await user.PATCH(req("PATCH", { role: "viewer" }), params({ username: "jp.principal" }))).status).toBe(403);
    expect((await user.PATCH(req("PATCH", { active: false }), params({ username: "jp.principal" }))).status).toBe(403);
    expect((await user.DELETE(req("DELETE"), params({ username: "jp.principal" }))).status).toBe(403);
    expect(await getRecordStore().get("auth/users")).toBeNull();
  });

  it("la delegación solo acepta responsables nominales activos de la marca", async () => {
    await login("daniel.coadmin");
    for (const ownerId of ["hernan.admin", "guillermo.op", "consulta", "auditor", "cliente.izzi", "consulta.sky", "no.existe"]) {
      expect((await incident.PATCH(req("PATCH", { ownerId }), params({ id: "INC-0001" }))).status, ownerId).toBe(400);
    }
    expect((await incident.PATCH(req("PATCH", { ownerId: "operador.izzi" }), params({ id: "INC-0001" }))).status).toBe(200);
    expect(mocks.updateIncident).toHaveBeenCalledWith("INC-0001", expect.objectContaining({ ownerId: "operador.izzi", owner: "operador.izzi" }), "daniel.coadmin");
    const body = await (await assignees.GET()).json();
    expect(body.assignees.map((a: { id: string }) => a.id).sort()).toEqual([...RESPONDERS].sort());
  });

  it("desactivar, rotar contraseña o cambiar rol desde Usuarios aplica de inmediato a la sesión abierta", async () => {
    await login("jp.principal");
    expect((await user.PATCH(req("PATCH", { active: false }), params({ username: "guillermo.op" }))).status).toBe(200);
    expect((await user.PATCH(req("PATCH", { password: "Rotada-Sintetica-2026" }), params({ username: "sebastian.op" }))).status).toBe(200);
    expect((await user.PATCH(req("PATCH", { role: "viewer" }), params({ username: "santiago.op" }))).status).toBe(200);
    for (const u of ["guillermo.op", "sebastian.op"] as Id[]) {
      await login(u); // token emitido con la versión anterior
      expect((await incidents.GET(req("GET"))).status, u).toBe(401);
    }
    await login("santiago.op");
    expect((await incidents.GET(req("GET"))).status).not.toBe(401);
    expect((await alert.PATCH(req("PATCH", { status: "RESOLVED" }), params({ id: "ALT-ABC" }))).status).toBe(403);
    expect(mocks.setAlertStatus).not.toHaveBeenCalled();
  });

  it("una sola marca no lee ni escribe la otra aunque fije la cookie de marca", async () => {
    mocks.cookies.set("immc_brand", "sky");
    await login("operador.izzi");
    expect((await brand.POST(req("POST", { brand: "sky" }))).status).toBe(403);
    expect((await nexus.POST(req("POST", { question: "¿Cómo va?", brand: "sky" }))).status).toBe(403);
    await login("consulta.sky");
    expect((await absoluteTop.GET(req("GET"))).status).toBe(403);
  });
});

describe("escrituras ligadas a recursos de la marca vigente", () => {
  it("un estado de alerta con ID de otra marca o inexistente no se guarda", async () => {
    await login("operador.izzi");
    for (const id of ["SKY-ALT-ABC", "ALT-ZZZ"]) {
      expect((await alert.PATCH(req("PATCH", { status: "RESOLVED" }), params({ id }))).status, id).toBe(404);
    }
    expect(mocks.setAlertStatus).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect((await alert.PATCH(req("PATCH", { status: "RESOLVED" }), params({ id: "ALT-ABC" }))).status).toBe(200);
    expect(mocks.setAlertStatus).toHaveBeenCalledWith("ALT-ABC", "RESOLVED", "operador.izzi");
  });

  it("un dictamen de auditoría sobre un incidente ajeno a la marca no se guarda", async () => {
    await login("jp.principal");
    const write = vi.spyOn(getRecordStore(), "update");
    for (const id of ["SKY-INC-0001", "INC-9999"]) {
      expect((await auditReview.POST(req("POST", { verdict: "CUMPLE", comment: "" }), params({ id }))).status, id).toBe(404);
    }
    expect(write).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect((await auditReview.POST(req("POST", { verdict: "CUMPLE", comment: "" }), params({ id: "INC-0001" }))).status).toBe(200);
  });
});
