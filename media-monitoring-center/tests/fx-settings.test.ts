import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, setSettingAtPath } from "@/lib/config/settings";
import { fxRateChanges } from "@/lib/config/fx-audit";
import { fxMonths } from "@/lib/data/fx-months";
import { rateLookup } from "@/lib/data/currency";
import { DELETE, PATCH } from "@/app/api/settings/route";
import { settingsRevision } from "@/lib/config/settings-revision";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), load: vi.fn(), save: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission, getSession: vi.fn(), requireAuth: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context, loadStoredSettings: mocks.load, saveStoredSettings: mocks.save }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));
const session = { user: { id: "principal", name: "Administradora" } };
const patch = (path: string, value: unknown, expectedValue: unknown = path === "currency.rates.2026-09" ? 18 : null) => PATCH(new Request("https://monitor.test/api/settings", { method: "PATCH", body: JSON.stringify({ path, value, expectedValue }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(session);
  mocks.context.mockResolvedValue({ mode: "unified", brand: "izzi" });
  mocks.load.mockResolvedValue({ ...structuredClone(DEFAULT_SETTINGS), currency: { rates: { "2026-09": 18 }, accountCurrency: {} } });
});

describe("captura mensual de tipo de cambio", () => {
  it("mantiene meses calendario consecutivos en días 31 y conserva tasas históricas", () => {
    expect(fxMonths("2026-10-31", { "2024-02": 17 })).toEqual(["2024-02", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(fxMonths("2027-01-01")).toContain("2026-09");
  });
  it("muestra la misma tasa exacta o anterior que usa la conversión, nunca una futura", () => {
    const lookup = rateLookup(new Map([["2026-09", 18], ["2026-11", 20]]));
    expect(lookup("2026-10")).toEqual({ rate: 18, usedMonth: "2026-09" });
    expect(lookup("2026-08")).toEqual({ rate: null, usedMonth: null });
    expect(lookup("2026-11")).toEqual({ rate: 20, usedMonth: "2026-11" });
  });
  it("rechaza meses inexistentes, tasas negativas, cero y valores fuera de límite", () => {
    for (const path of ["currency.rates.2026-00", "currency.rates.2026-13"]) expect(setSettingAtPath(DEFAULT_SETTINGS, path, 18)).toBeNull();
    for (const value of [0, -1, 1001, "18", Infinity]) expect(setSettingAtPath(DEFAULT_SETTINGS, "currency.rates.2026-09", value)).toBeNull();
  });
  it("impide escribir sin permiso y no toca el almacén ni la bitácora", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await patch("currency.rates.2026-10", 19)).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("guarda sobre la configuración compartida y registra mes, actor y valor anterior/nuevo", async () => {
    expect((await patch("currency.rates.2026-09", 18.4567)).status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("settings:write");
    expect(mocks.save.mock.calls[0][1].currency.rates).toEqual({ "2026-09": 18.4567 });
    expect(mocks.activity).toHaveBeenCalledWith(session, "SETTINGS_CHANGED", "Tipo de cambio mensual (currency.rates.2026-09): 2026-09: 18 → 18.4567 MXN por USD");
  });
  it("puede quitar una tasa y rechaza valores inválidos sin persistir", async () => {
    expect((await patch("currency.rates.2026-09", null)).status).toBe(200);
    expect(mocks.save.mock.calls[0][1].currency.rates).toEqual({});
    expect(mocks.activity.mock.calls[0][2]).toContain("18 → sin tasa");
    mocks.save.mockClear();
    expect((await patch("currency.rates.2026-13", 18)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("dos administradores guardando meses distintos a la vez no pierden ninguna tasa", async () => {
    let stored = structuredClone(DEFAULT_SETTINGS);
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const firstSave = new Promise<void>(resolve => { entered = resolve; });
    mocks.load.mockImplementation(async () => structuredClone(stored));
    mocks.save.mockImplementation(async (_ctx, next) => {
      if (next.currency.rates["2026-09"] === 19 && next.currency.rates["2026-10"] === undefined) { entered(); await blocked; }
      stored = structuredClone(next);
    });
    const first = patch("currency.rates.2026-09", 19, null);
    await firstSave;
    const second = patch("currency.rates.2026-10", 20);
    await new Promise(resolve => setImmediate(resolve)); release();
    const responses = await Promise.all([first, second]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(stored.currency.rates).toEqual({ "2026-09": 19, "2026-10": 20 });
  });
  it("un fallo al restablecer configuración devuelve error y no bloquea el siguiente guardado", async () => {
    mocks.save.mockRejectedValueOnce(new Error("fixture storage failure"));
    const stored = await mocks.load();
    expect((await DELETE(new Request("https://monitor.test/api/settings", { method: "DELETE", headers: { "If-Match": settingsRevision(stored, { mode: "unified", brand: "izzi" }) } }))).status).toBe(500);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect((await patch("currency.rates.2026-10", 19)).status).toBe(200);
  });
  it("registra altas, cambios y bajas sin inventar cambios cuando el valor es igual", () => {
    expect(fxRateChanges({ "2026-08": 17, "2026-09": 18 }, { "2026-09": 18, "2026-10": 19 })).toBe("2026-08: 17 → sin tasa MXN por USD; 2026-10: sin tasa → 19 MXN por USD");
  });
});
