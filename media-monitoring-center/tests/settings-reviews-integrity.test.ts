import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeSettings } from "@/lib/config/settings";
import { SettingsConflictError } from "@/lib/config/settings-revision";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { listReviews, reviewHistory, saveReview } from "@/lib/records/incident-reviews";
import { baseSettings, saveStoredSettings, SETTINGS_RECORD_KEY } from "@/lib/services/context";
import { MemoryStateStore } from "@/lib/state/store";

const ctx = { mode: "unified" as const, store: new MemoryStateStore("izzi") };
beforeEach(() => { vi.stubEnv("RECORDS_BACKEND", "memory"); resetRecordStore(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetRecordStore(); });

describe("settings and review persistence integrity", () => {
  it("confirms at most one incompatible edit from a shared stale settings base", async () => {
    const original = baseSettings();
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => saveStoredSettings(ctx, { ...original, history: { ...original.history, weeks: 8 + index % 5 } }, `Actor ${index}`, original)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected").every(result => result.status === "rejected" && result.reason instanceof SettingsConflictError)).toBe(true);
    const saved = mergeSettings(baseSettings(), await getRecordStore().get(SETTINGS_RECORD_KEY));
    expect(saved.history.weeks).toBe(8);
  });

  it("reports an ambiguous settings replay as a conflict while retaining the applied change", async () => {
    const original = baseSettings(), updated = { ...original, history: { ...original.history, weeks: 8 } };
    const store = getRecordStore(), apply = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (key, transform) => { await apply(key, transform); return apply(key, transform); });
    await expect(saveStoredSettings(ctx, updated, "Actor", original)).rejects.toBeInstanceOf(SettingsConflictError);
    expect(mergeSettings(baseSettings(), await store.get(SETTINGS_RECORD_KEY)).history.weeks).toBe(8);
    // This is deliberately not an exactly-once success guarantee: reload the state.
  });

  it("keeps concurrent audit histories bounded and separate for both brands", async () => {
    await Promise.all(["izzi", "sky"].flatMap(brand => Array.from({ length: 60 }, (_, index) => saveReview(brand as "izzi" | "sky", { incidentId: "INC-FIXTURE", verdict: "CUMPLE", comment: `${brand} ${index}`, by: `${brand} actor ${index}` }))));
    for (const brand of ["izzi", "sky"] as const) {
      const history = await reviewHistory(brand, "INC-FIXTURE");
      expect(history).toHaveLength(50);
      expect(history.every(review => review.by.startsWith(`${brand} actor `))).toBe(true);
      expect(history[0].by).toBe(`${brand} actor 10`);
      expect(history[49].by).toBe(`${brand} actor 59`);
      const current = await listReviews(brand);
      expect(current["INC-FIXTURE"]).toEqual(history[49]);
      expect(JSON.stringify(current)).not.toContain("appliedOperations");
    }
  });
});
