import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "@/lib/data/cache";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { getKickoff, listNovedades, markKickoffStarted, saveKickoff, type KickoffItem, type MonthKickoff } from "@/lib/records/novedades";
import { getRecordStore, resetRecordStore, type RecordStore } from "@/lib/records/store";
import { confirmKickoff, kickoffStatus } from "@/lib/services/kickoff";
import type { AppContext } from "@/lib/services/context";
import type { Snapshot } from "@/lib/services/snapshot";

const MONTH = "2026-10";
const RECORD_KEY = `kickoff/izzi/${MONTH}`;
const DETECTED_AT = "2026-10-02T15:00:00.000Z";
const CAMPAIGN_ID = "detected-campaign";

function plan(campaignId: string | null = null): MonthKickoff {
  return {
    month: MONTH, brand: "izzi", confirmedAt: "2026-10-01T15:00:00.000Z", confirmedBy: "Original approving admin",
    budgets: [{ platform: "meta", accountId: null, accountName: null, amount: 1000 }],
    items: [{ key: "pend:fixture", platform: "meta", accountName: "Fixture account", campaignId, name: "Lanzamiento", state: "PENDING", expectedStart: "2026-10-02", note: null, startedAt: null }],
    updatedAt: "2026-10-01T15:00:00.000Z", updatedBy: "Original approving admin",
  };
}

function freezePlan(value: MonthKickoff) {
  for (const item of value.items) Object.freeze(item);
  for (const budget of value.budgets) Object.freeze(budget);
  Object.freeze(value.items); Object.freeze(value.budgets); Object.freeze(value);
  return value;
}

function context(kickoff: MonthKickoff): AppContext {
  return {
    brand: "izzi", brandPlatforms: ["meta", "google"], kickoff,
    settings: { ...DEFAULT_SETTINGS, timezone: "America/Mexico_City", monitoredPlatforms: ["meta"] },
    source: { now: () => new Date(DETECTED_AT), getBudgets: async () => [] },
    store: { getOverrides: async () => ({ budgets: [] }) },
  } as unknown as AppContext;
}

function snapshot(): Snapshot {
  return {
    catalog: { campaigns: [{ id: CAMPAIGN_ID, name: "Campaña LANZAMIENTO", platform: "meta" }] },
    run: { businessDate: "2026-10-02", entities: [{ level: "campaign", campaignId: CAMPAIGN_ID, cumulative: { spend: { current: 100 } } }] },
  } as unknown as Snapshot;
}

/** Inject a real edit immediately before the first conditional transform reads its document. */
function beforeFirstPlanUpdate(intervene: () => Promise<unknown>) {
  const store = getRecordStore(), original = store.update.bind(store);
  let entered = false;
  vi.spyOn(store, "update").mockImplementation((async (key, transform) => {
    if (key === RECORD_KEY && !entered) { entered = true; await intervene(); }
    return original(key, transform);
  }) as RecordStore["update"]);
  return () => entered;
}

beforeEach(() => {
  vi.stubEnv("RECORDS_BACKEND", "memory"); resetRecordStore(); invalidate();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetRecordStore(); invalidate(); });

describe("kickoff service persistence and stale context", () => {
  it.each([
    { field: "campaign name", patch: { name: "Admin corrected campaign" } },
    { field: "platform", patch: { platform: "google" } },
    { field: "account", patch: { accountName: "Admin corrected account" } },
  ] satisfies Array<{ field: string; patch: Partial<KickoffItem> }>)("preserves a newer $field and budget instead of linking an old detection", async ({ patch }) => {
    await saveKickoff(plan());
    const cachedPlan = freezePlan((await getKickoff("izzi", MONTH))!);
    const before = structuredClone(cachedPlan), ctx = context(cachedPlan);
    const updatedPlan = structuredClone(before);
    Object.assign(updatedPlan.items[0], patch);
    updatedPlan.budgets[0].amount = 2000;
    updatedPlan.updatedBy = "Editing admin";
    const intervened = beforeFirstPlanUpdate(() => saveKickoff(updatedPlan));

    const result = await kickoffStatus(ctx, snapshot());
    const stored = (await getKickoff("izzi", MONTH))!;
    expect(intervened()).toBe(true);
    expect(stored).toMatchObject(updatedPlan);
    expect(stored.items[0].campaignId).toBeNull();
    expect(stored.items[0].startedAt).toBeNull();
    expect(result.justStarted).toEqual([]);
    expect(result.pending[0]).toMatchObject({ name: updatedPlan.items[0].name, platform: updatedPlan.items[0].platform, accountName: updatedPlan.items[0].accountName });
    expect(await listNovedades("izzi")).toEqual([]);
    expect(ctx.kickoff).toBe(cachedPlan);
    expect(ctx.kickoff).toEqual(before);
    expect(cachedPlan).toEqual(before);
  });

  it("links a spending campaign without reverting a concurrent budget-only edit", async () => {
    await saveKickoff(plan());
    const cachedPlan = freezePlan((await getKickoff("izzi", MONTH))!);
    const before = structuredClone(cachedPlan), ctx = context(cachedPlan);
    const updatedPlan = structuredClone(before);
    updatedPlan.budgets[0].amount = 2000;
    const intervened = beforeFirstPlanUpdate(() => saveKickoff(updatedPlan));
    const result = await kickoffStatus(ctx, snapshot());
    const stored = (await getKickoff("izzi", MONTH))!;
    expect(intervened()).toBe(true);
    expect(stored.budgets[0].amount).toBe(2000);
    expect(stored.items[0]).toMatchObject({ campaignId: CAMPAIGN_ID, name: "Lanzamiento" });
    expect(stored.items[0].startedAt).toEqual(expect.any(String));
    expect(result.justStarted).toEqual(["Lanzamiento"]);
    expect(await listNovedades("izzi")).toHaveLength(1);
    expect(cachedPlan).toEqual(before);
  });

  it("auto-links and records one activation with the original approver without mutating cached input", async () => {
    await saveKickoff(plan());
    const cachedPlan = freezePlan((await getKickoff("izzi", MONTH))!);
    const before = structuredClone(cachedPlan), ctx = context(cachedPlan);
    const result = await kickoffStatus(ctx, snapshot());
    const stored = (await getKickoff("izzi", MONTH))!;
    expect(stored.items[0].campaignId).toBe(CAMPAIGN_ID);
    expect(stored.items[0].startedAt).toEqual(expect.any(String));
    expect(result.justStarted).toEqual(["Lanzamiento"]);
    expect(result.pending).toEqual([]);
    expect(result.confirmedBy).toBe("Original approving admin");
    const novedades = await listNovedades("izzi");
    expect(novedades).toHaveLength(1);
    expect(novedades[0]).toMatchObject({ kind: "ACTIVACION", campaignId: CAMPAIGN_ID, campaignName: "Lanzamiento", approvedBy: "Original approving admin" });
    expect((await kickoffStatus(ctx, snapshot())).justStarted).toEqual([]);
    expect(await listNovedades("izzi")).toHaveLength(1);
    expect(ctx.kickoff).toBe(cachedPlan);
    expect(cachedPlan).toEqual(before);
  });

  it("returns the persisted detection when a detector starts a campaign between confirmation read and save", async () => {
    await saveKickoff(plan(CAMPAIGN_ID));
    const cachedPlan = freezePlan((await getKickoff("izzi", MONTH))!);
    const before = structuredClone(cachedPlan), ctx = context(cachedPlan);
    const input = { month: MONTH, items: structuredClone(cachedPlan.items), budgets: [{ ...cachedPlan.budgets[0], amount: 2000 }] };
    const intervened = beforeFirstPlanUpdate(() => markKickoffStarted("izzi", MONTH, [{ key: "pend:fixture", at: DETECTED_AT, campaignId: CAMPAIGN_ID }], "Automatic detector"));
    const result = await confirmKickoff(ctx, input, "Updating admin");
    const stored = (await getKickoff("izzi", MONTH))!;
    expect(intervened()).toBe(true);
    expect(result).toEqual(stored);
    expect(result.items[0].startedAt).toBe(DETECTED_AT);
    expect(result.confirmedBy).toBe(before.confirmedBy);
    expect(result.confirmedAt).toBe(before.confirmedAt);
    expect(result.updatedBy).toBe("Updating admin");
    expect(result.budgets[0].amount).toBe(2000);
    const novedades = await listNovedades("izzi");
    expect(novedades).toHaveLength(1);
    expect(novedades[0]).toMatchObject({ kind: "ARRANQUE", approvedBy: "Updating admin" });
    expect(cachedPlan).toEqual(before);
    expect(input.items[0].startedAt).toBeNull();
  });
});
