import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignedTo, canAssignIncident, eligibleAssignees } from "@/lib/alerts/assignment";
import { permissionsOf, type Role } from "@/lib/auth/roles";
import type { EffectiveAccount } from "@/lib/auth/users";
import type { Incident } from "@/lib/alerts/types";
import { PATCH } from "@/app/api/incidents/[id]/route";
import { GET } from "@/app/api/incidents/assignees/route";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), accounts: vi.fn(), snapshot: vi.fn(), context: vi.fn(), update: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/auth/users", () => ({ listAccounts: mocks.accounts }));
vi.mock("@/lib/services/snapshot", () => ({ getFullSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const account = (username: string, role: Role, extra: Partial<EffectiveAccount> = {}): EffectiveAccount => ({ username, name: "Nombre compartido", role, hash: "synthetic-private-hash", permissions: permissionsOf(role), customPermissions: false, brands: ["izzi"], active: true, version: 1, source: "app", managed: null, ...extra });
const session = (role: Role) => ({ authenticated: true, role, user: { id: "admin", name: "Administradora", kind: "named" }, permissions: permissionsOf(role) });
function patch(body: unknown, id = "INC-0001") { return PATCH(new Request("https://monitor.test/api/incidents/INC-0001", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(session("admin"));
  mocks.accounts.mockResolvedValue([account("ana", "manager"), account("bea", "manager", { brands: ["sky"] }), account("cliente", "client"), account("inactivo", "manager", { active: false })]);
  mocks.snapshot.mockResolvedValue({ state: { incidents: [{ id: "INC-0001", resolvedAt: null }] } });
  mocks.context.mockResolvedValue({ brand: "izzi", store: { updateIncident: mocks.update } });
});

describe("delegación nominal y límites de acceso", () => {
  it("ofrece solo cuentas activas y operativas de la misma marca, sin hashes", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ ok: true, assignees: [{ id: "ana", name: "Nombre compartido" }] });
    expect(eligibleAssignees([account("audit", "auditor", { permissions: permissionsOf("admin") })], "izzi")).toEqual([]);
  });
  it("admin y coadmin delegan; el operativo atiende sin reasignar", async () => {
    expect(canAssignIncident(session("admin"))).toBe(true);
    expect(canAssignIncident(session("coadmin"))).toBe(true);
    mocks.permission.mockResolvedValue(session("manager"));
    expect((await patch({ ownerId: "ana" })).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await patch({ status: "INVESTIGATING", note: "Revisando entrega" })).status).toBe(200);
  });
  it("valida identidad en el servidor, no acepta nombres libres ni usuarios de otra marca", async () => {
    for (const body of [{ ownerId: "bea" }, { ownerId: "inactivo" }, { ownerId: "cliente" }, { ownerId: "desconocido" }, { owner: "Nombre inventado" }]) expect((await patch(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("conserva identidad, nombre y actor al delegar o quitar al responsable", async () => {
    expect((await patch({ ownerId: "ana" })).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("INC-0001", { ownerId: "ana", owner: "Nombre compartido" }, "Administradora");
    expect((await patch({ ownerId: null })).status).toBe(200);
    expect(mocks.update).toHaveBeenLastCalledWith("INC-0001", { ownerId: null, owner: null }, "Administradora");
    expect(assignedTo({ ownerId: "ana" }, "bea")).toBe(false);
    expect(assignedTo({ ownerId: "ana" }, "ana")).toBe(true);
    expect(assignedTo({ owner: "Nombre compartido" } as Incident, "ana")).toBe(false);
  });
  it("rechaza cambios en incidentes fuera de la marca y exige documentar el cierre", async () => {
    expect((await patch({ ownerId: "ana" }, "SKY-INC-0001")).status).toBe(404);
    expect((await patch({ status: "RESOLVED" })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await patch({ status: "RESOLVED", note: "Validamos recuperación y el informe" })).status).toBe(200);
  });
  it("una sesión sin permiso no lee usuarios ni cambia incidencias", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect((await patch({ ownerId: "ana" })).status).toBe(403);
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
