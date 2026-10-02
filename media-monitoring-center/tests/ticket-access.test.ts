import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/tickets/[id]/route";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { createTicket, getTicket, type NewTicket, type Ticket } from "@/lib/records/tickets";
import { permissionsOf, type Permission, type Role } from "@/lib/auth/roles";
import type { Session } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({ session: null as Session | null, selected: "izzi", activity: vi.fn(), cookieRead: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieRead }) }));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (permission: Permission) => mocks.session?.authenticated && mocks.session.permissions.includes(permission) ? mocks.session : null,
  hasPermission: (session: Session, permission: Permission) => session.authenticated && session.permissions.includes(permission),
}));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const input: NewTicket = { title: "Falla de entrega", description: "Detalle privado de la marca", severity: "ALERT", category: "DELIVERY", platform: "meta", accountName: "Cuenta privada", incidentIds: [], reportedTo: "", channel: "WHATSAPP", externalRef: null, owner: null };
function session(role: Role, permissions = permissionsOf(role)): Session {
  return { authenticated: true, user: { id: "fixture-user", name: "Operadora", email: null, kind: "named" }, role, permissions, brands: ["izzi"], mode: "password", sid: "fixture", expiresAt: null };
}
const patch = (id: string, body: unknown) => PATCH(new Request("http://monitor.test/api/tickets/" + id, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
let own: Ticket;
let foreign: Ticket;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("RECORDS_BACKEND", "memory");
  vi.stubEnv("LOG_LEVEL", "error");
  resetRecordStore();
  mocks.session = session("manager");
  mocks.selected = "izzi";
  mocks.cookieRead.mockImplementation(() => ({ value: mocks.selected }));
  own = await createTicket(input, "Fixture", "izzi");
  foreign = await createTicket({ ...input, title: "SKY-PRIVATE", description: "SKY-PRIVATE-DESCRIPTION" }, "Fixture", "sky");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tests must not use network"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); resetRecordStore(); });

describe("acceso directo a tickets por marca y permisos", () => {
  it.each(["izzi", "sky"])("no filtra ni modifica un ticket de Sky con cuenta solo izzi y cookie %s", async cookie => {
    mocks.selected = cookie;
    const before = await getTicket(foreign.id);
    const response = await patch(foreign.id, { text: "Cambio no autorizado", status: "CERRADO" });
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toMatch(/SKY-PRIVATE|Cuenta privada|Detalle privado/);
    expect(await getTicket(foreign.id)).toEqual(before);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("una cuenta con ambas marcas tampoco edita la otra marca sin cambiar el contexto", async () => {
    mocks.session!.brands = [];
    expect((await patch(foreign.id, { text: "Comentario en marca equivocada" })).status).toBe(404);
    expect((await getTicket(foreign.id))!.updates).toHaveLength(1);
    mocks.selected = "sky";
    expect((await patch(foreign.id, { text: "Comentario autorizado en Sky" })).status).toBe(200);
    expect((await getTicket(foreign.id))!.updates.at(-1)?.text).toBe("Comentario autorizado en Sky");
  });

  it("mantiene tickets heredados sin marca en izzi", async () => {
    const legacy = { ...own }; delete legacy.brand;
    await getRecordStore().set(`tickets/${own.id}`, legacy);
    expect((await patch(own.id, { text: "Seguimiento de ticket heredado" })).status).toBe(200);
    mocks.session!.brands = ["sky"];
    mocks.selected = "sky";
    expect((await patch(own.id, { text: "No corresponde a Sky" })).status).toBe(404);
  });

  it.each(["client", "auditor"] satisfies Role[])("%s no modifica tickets aunque conozca el ID", async role => {
    mocks.session = session(role);
    expect((await patch(own.id, { text: "Intento de edición" })).status).toBe(403);
    expect((await getTicket(own.id))!.updates).toHaveLength(1);
    expect(mocks.cookieRead).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("una sesión sin tickets:manage solo comenta y no cambia seguimiento", async () => {
    mocks.session = session("viewer", ["internal:view", "client:view", "tickets:write"]);
    for (const body of [{ status: "CERRADO" }, { owner: "Otra persona" }, { channel: "EMAIL" }, { externalRef: "CASE" }, { reportedTo: "Cliente" }]) {
      expect((await patch(own.id, body)).status).toBe(403);
    }
    expect((await getTicket(own.id))!.updates).toHaveLength(1);
    expect((await patch(own.id, { text: "Comentario permitido" })).status).toBe(200);
  });

  it("rechaza sesión ausente y payload inválido antes de tocar un ticket", async () => {
    mocks.session = null;
    expect((await patch(own.id, { text: "No autenticado" })).status).toBe(403);
    mocks.session = session("manager");
    for (const [id, body] of [["../tickets/TKT-0001", { text: "Inválido" }], [own.id, { status: "ADMIN" }], [own.id, { text: "x".repeat(2001) }]] as const) {
      expect((await patch(id, body)).status).toBe(400);
    }
    expect((await getTicket(own.id))!.updates).toHaveLength(1);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
});
