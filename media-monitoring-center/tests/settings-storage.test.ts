import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/config/settings";
import { settingsRevision, SettingsConflictError } from "@/lib/config/settings-revision";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { baseSettings, saveStoredSettings, SETTINGS_RECORD_KEY } from "@/lib/services/context";
import { MemoryStateStore } from "@/lib/state/store";

const ctx = { mode: "unified" as const, store: new MemoryStateStore("izzi") };
beforeEach(() => { vi.stubEnv("RECORDS_BACKEND", "memory"); resetRecordStore(); });
afterEach(() => { vi.unstubAllEnvs(); resetRecordStore(); });

describe("guardado condicional de configuración", () => {
  it("dos escrituras con la misma base no pueden confirmar cambios incompatibles", async () => {
    const original = baseSettings();
    const one = { ...original, history: { ...original.history, weeks: 8 } };
    const two = { ...original, history: { ...original.history, weeks: 12 } };
    const results = await Promise.allSettled([saveStoredSettings(ctx, one, "A", original), saveStoredSettings(ctx, two, "B", original)]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: expect.any(SettingsConflictError) });
    const stored = mergeSettings(baseSettings(), await getRecordStore().get(SETTINGS_RECORD_KEY));
    expect(stored.history.weeks).toBe(8);
  });
  it("reset antiguo no elimina una tasa posterior; reset vigente permite el siguiente guardado", async () => {
    const original = baseSettings();
    const updated = { ...original, currency: { rates: { "2026-09": 19 }, accountCurrency: {} } };
    await saveStoredSettings(ctx, updated, "A", original);
    await expect(saveStoredSettings(ctx, null, "B", original)).rejects.toBeInstanceOf(SettingsConflictError);
    expect(mergeSettings(baseSettings(), await getRecordStore().get(SETTINGS_RECORD_KEY)).currency.rates).toEqual({ "2026-09": 19 });
    await saveStoredSettings(ctx, null, "A", updated);
    expect(await getRecordStore().get(SETTINGS_RECORD_KEY)).toBeNull();
    await saveStoredSettings(ctx, updated, "A", original);
    expect(mergeSettings(baseSettings(), await getRecordStore().get(SETTINGS_RECORD_KEY)).currency.rates).toEqual({ "2026-09": 19 });
  });
  it("la revisión es estable con distinto orden de propiedades y solo considera marca y modo", () => {
    const forward = { ...DEFAULT_SETTINGS, currency: { rates: { "2026-09": 18, "2026-10": 19 }, accountCurrency: {} } };
    const reverse = { ...DEFAULT_SETTINGS, currency: { accountCurrency: {}, rates: { "2026-10": 19, "2026-09": 18 } } };
    const scope = { brand: "izzi", mode: "unified", privateValue: "fixture-only" };
    const revision = settingsRevision(forward, scope);
    expect(revision).toMatch(/^"settings-[0-9a-f]{64}"$/);
    expect(settingsRevision(reverse, { brand: "izzi", mode: "unified" })).toBe(revision);
    expect(settingsRevision(reverse, { brand: "sky", mode: "unified" })).not.toBe(revision);
  });
});
