import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { DELETE, PATCH, PUT } from "@/app/api/settings/route";
import { settingsRevision, SettingsConflictError } from "@/lib/config/settings-revision";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), load: vi.fn(), save: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission, getSession: vi.fn(), requireAuth: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context, loadStoredSettings: mocks.load, saveStoredSettings: mocks.save }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const request = (method: string, body?: unknown, revision?: string) => new Request("https://monitor.test/api/settings", {
  method, headers: revision ? { "If-Match": revision } : {}, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: "admin", name: "Administradora" } });
  const current = { ...structuredClone(DEFAULT_SETTINGS), currency: { rates: { "2026-09": 19 }, accountCurrency: {} } };
  mocks.context.mockResolvedValue({ mode: "unified", brand: "izzi", settings: current });
  mocks.load.mockResolvedValue(current);
});

describe("formularios de configuración desactualizados", () => {
  it("un formulario antiguo no puede revertir una tasa guardada por otro administrador", async () => {
    const old = { ...structuredClone(DEFAULT_SETTINGS), currency: { rates: { "2026-09": 18 }, accountCurrency: {} } };
    expect((await PUT(request("PUT", old, '"old-revision"'))).status).toBe(412);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("restablecer desde una pantalla antigua no borra cambios posteriores", async () => {
    expect((await DELETE(request("DELETE", undefined, '"old-revision"'))).status).toBe(412);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("dos pantallas de tasas no sobrescriben un mismo mes sin advertirlo", async () => {
    expect((await PATCH(request("PATCH", { path: "currency.rates.2026-09", value: 20, expectedValue: 18 }))).status).toBe(412);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("no permite saltarse la revisión en guardado completo, reset ni tasa mensual", async () => {
    expect((await PUT(request("PUT", DEFAULT_SETTINGS))).status).toBe(428);
    expect((await DELETE(request("DELETE"))).status).toBe(428);
    expect((await PATCH(request("PATCH", { path: "currency.rates.2026-10", value: 20 }))).status).toBe(428);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("acepta la revisión vigente y preserva cambios realizados desde otra sección", async () => {
    const current = await mocks.load();
    const edited = { ...current, history: { ...current.history, weeks: 8 } };
    expect((await PUT(request("PUT", edited, settingsRevision(current, { mode: "unified", brand: "izzi" })))).status).toBe(200);
    expect(mocks.save.mock.calls[0][1].currency.rates).toEqual({ "2026-09": 19 });
    expect(mocks.save.mock.calls[0][3]).toEqual(current);
  });
  it("no acepta una revisión de otra marca aunque lo guardado sea igual", async () => {
    const current = await mocks.load();
    expect((await PUT(request("PUT", current, settingsRevision(current, { mode: "unified", brand: "sky" })))).status).toBe(412);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("un conflicto en el almacén entre lectura y guardado devuelve 412 sin bitácora de éxito", async () => {
    mocks.save.mockRejectedValue(new SettingsConflictError());
    expect((await PATCH(request("PATCH", { path: "currency.rates.2026-10", value: 20, expectedValue: null }))).status).toBe(412);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("meses distintos usan su valor anterior, sin bloquear cambios ajenos a ese mes", async () => {
    expect((await PATCH(request("PATCH", { path: "currency.rates.2026-10", value: 20, expectedValue: null }))).status).toBe(200);
    expect(mocks.save.mock.calls[0][1].currency.rates).toEqual({ "2026-09": 19, "2026-10": 20 });
  });
});
