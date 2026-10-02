import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidate } from "@/lib/data/cache";
import { getKickoff, linkKickoffCampaigns, markKickoffStarted, saveKickoff, type KickoffItem, type MonthKickoff } from "@/lib/records/novedades";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";

const blobs = vi.hoisted(() => ({ get: vi.fn(), getWithMetadata: vi.fn(), setJSON: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => blobs }));

const MONTH = "2026-10";
const FIRST_START = "2026-10-02T15:00:00.000Z";
const SECOND_START = "2026-10-02T15:01:00.000Z";
const RECORD_KEY = `kickoff/izzi/${MONTH}`;
let directory: string;

function item(key: string): KickoffItem {
  return { key, platform: "meta", accountName: "Fixture account", campaignId: key, name: `Fixture ${key}`, state: "PENDING", expectedStart: "2026-10-02", note: null, startedAt: null };
}

function unlinkedIdentity(key: string) {
  const { name, platform, accountName } = item(key);
  return { name, platform, accountName, campaignId: null };
}

function kickoff(): MonthKickoff {
  return { month: MONTH, brand: "izzi", confirmedAt: "2026-10-01T15:00:00.000Z", confirmedBy: "Fixture admin", budgets: [{ platform: "meta", accountId: null, accountName: null, amount: 1000 }], items: [item("campaign-a"), item("campaign-b")], updatedAt: "2026-10-01T15:00:00.000Z", updatedBy: "Fixture admin" };
}

async function storedKickoff() {
  const result = await getRecordStore().get<MonthKickoff>(RECORD_KEY);
  expect(result).not.toBeNull();
  return result!;
}

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), "kickoff-concurrency-"));
  resetRecordStore(); invalidate();
});

afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); resetRecordStore(); invalidate();
  await rm(directory, { recursive: true, force: true });
});

describe.each(["memory", "file"] as const)("kickoff detection with %s records", (backend) => {
  beforeEach(() => { vi.stubEnv("RECORDS_BACKEND", backend); vi.stubEnv("RECORDS_DIR", directory); resetRecordStore(); });

  it("preserves both pending campaigns when concurrent readers detect different starts", async () => {
    await saveKickoff(kickoff());
    const detections = await Promise.all([
      markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "First detector"),
      markKickoffStarted("izzi", MONTH, [{ key: "campaign-b", at: SECOND_START }], "Second detector"),
    ]);
    expect(detections.flat().map(value => value.key).sort()).toEqual(["campaign-a", "campaign-b"]);
    expect((await storedKickoff()).items.map(value => value.startedAt)).toEqual([FIRST_START, SECOND_START]);
  });

  it("returns a pending campaign to only one concurrent detector for its activation record", async () => {
    await saveKickoff(kickoff());
    const detections = await Promise.all([
      markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "First detector"),
      markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: SECOND_START }], "Second detector"),
    ]);
    expect(detections.flat().map(value => value.key)).toEqual(["campaign-a"]);
    expect((await storedKickoff()).items[0].startedAt).toBe(detections.flat()[0].startedAt);
  });

  it("retains a detected start when an administrator saves an older confirmation snapshot", async () => {
    await saveKickoff(kickoff());
    const confirmation = structuredClone((await getKickoff("izzi", MONTH))!);
    await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "Automatic detector");
    confirmation.budgets[0].amount = 2000;
    confirmation.updatedBy = "Confirming admin";
    const saved = await saveKickoff(confirmation);
    const stored = await storedKickoff();
    expect(stored.items[0].startedAt).toBe(FIRST_START);
    expect(stored.budgets[0].amount).toBe(2000);
    expect(stored.updatedBy).toBe("Confirming admin");
    expect(saved.items[0].startedAt).toBe(FIRST_START);
  });

  it("automatic linking patches only still-pending unlinked IDs, preserving the latest plan", async () => {
    const original = kickoff();
    original.items[0].campaignId = null;
    original.items[1].campaignId = null;
    await saveKickoff(original);
    const latest = structuredClone(original);
    latest.budgets[0].amount = 2000;
    latest.items[1].state = "ENDED";
    latest.items[1].note = "Latest admin note";
    await saveKickoff(latest);
    const linked = await linkKickoffCampaigns("izzi", MONTH, [{ key: "campaign-a", campaignId: "resolved-a", expected: unlinkedIdentity("campaign-a") }, { key: "campaign-b", campaignId: "stale-b", expected: unlinkedIdentity("campaign-b") }], "Automatic detector");
    expect(linked?.items[0].campaignId).toBe("resolved-a");
    expect(linked?.items[1]).toMatchObject({ campaignId: null, state: "ENDED", note: "Latest admin note" });
    expect(linked?.budgets[0].amount).toBe(2000);
    expect(linked?.confirmedBy).toBe("Fixture admin");
  });

  it("does not mutate an earlier cached plan while linking campaign IDs", async () => {
    const original = kickoff();
    original.items[0].campaignId = null;
    await saveKickoff(original);
    const earlier = await getKickoff("izzi", MONTH);
    await linkKickoffCampaigns("izzi", MONTH, [{ key: "campaign-a", campaignId: "resolved-a", expected: unlinkedIdentity("campaign-a") }], "Automatic detector");
    expect(earlier?.items[0].campaignId).toBeNull();
    expect((await getKickoff("izzi", MONTH))?.items[0].campaignId).toBe("resolved-a");
  });

  it("a stale linker cannot replace a campaign ID selected by the administrator", async () => {
    const original = kickoff();
    original.items[0].campaignId = null;
    await saveKickoff(original);
    const store = getRecordStore(), update = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (key, transform) => {
      const current = await storedKickoff();
      current.items[0].campaignId = "admin-selected-a";
      await saveKickoff(current);
      return update(key, transform);
    });
    await linkKickoffCampaigns("izzi", MONTH, [{ key: "campaign-a", campaignId: "stale-a", expected: unlinkedIdentity("campaign-a") }], "Automatic detector");
    expect((await storedKickoff()).items[0].campaignId).toBe("admin-selected-a");
  });

  it("does not mark another campaign that now occupies the same pending key", async () => {
    await saveKickoff(kickoff());
    const latest = await storedKickoff();
    latest.items[0].campaignId = "replacement-campaign";
    await saveKickoff(latest);
    expect(await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START, campaignId: "campaign-a" }], "Stale detector")).toEqual([]);
    expect((await storedKickoff()).items[0].startedAt).toBeNull();
  });

  it("keeps the first confirmation under simultaneous initial saves", async () => {
    const second = kickoff();
    second.confirmedAt = SECOND_START;
    second.confirmedBy = "Second admin";
    second.budgets[0].amount = 2000;
    const saved = await Promise.all([saveKickoff(kickoff()), saveKickoff(second)]);
    expect(new Set(saved.map(value => value.confirmedAt)).size).toBe(1);
    expect(new Set(saved.map(value => value.confirmedBy)).size).toBe(1);
    expect((await storedKickoff()).budgets[0].amount).toBe(2000);
  });

  it("does not expose private detection receipts through reads or confirmations", async () => {
    await saveKickoff(kickoff());
    await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "Automatic detector");
    const updated = await saveKickoff(kickoff());
    expect(JSON.stringify(updated)).not.toContain("startedOperations");
    expect(JSON.stringify(await getKickoff("izzi", MONTH))).not.toContain("startedOperations");
    expect((await getRecordStore().get<{ startedOperations: unknown[] }>(RECORD_KEY))?.startedOperations).toHaveLength(1);
  });

  it("never copies an izzi kickoff or starts into Sky when no Sky confirmation exists", async () => {
    await saveKickoff(kickoff());
    expect(await linkKickoffCampaigns("sky", MONTH, [{ key: "campaign-a", campaignId: "resolved-a", expected: unlinkedIdentity("campaign-a") }], "Automatic detector")).toBeNull();
    expect(await markKickoffStarted("sky", MONTH, [{ key: "campaign-a", at: FIRST_START }], "Automatic detector")).toEqual([]);
    expect((await storedKickoff()).items[0].startedAt).toBeNull();
  });

  it.each(["name", "platform", "accountName"] as const)("does not link a reused pending key whose %s has changed", async field => {
    const original = kickoff();
    original.items[0].campaignId = null;
    await saveKickoff(original);
    const expected = unlinkedIdentity("campaign-a");
    const latest = await storedKickoff();
    if (field === "platform") latest.items[0].platform = "google";
    else latest.items[0][field] = "Replacement fixture";
    await saveKickoff(latest);
    await linkKickoffCampaigns("izzi", MONTH, [{ key: "campaign-a", campaignId: "stale-a", expected }], "Stale detector");
    expect((await storedKickoff()).items[0].campaignId).toBeNull();
  });

  it.each(["name", "platform", "accountName"] as const)("does not start a reused pending key whose %s has changed", async field => {
    await saveKickoff(kickoff());
    const { name, platform, accountName, campaignId } = item("campaign-a");
    const expected = { name, platform, accountName, campaignId };
    const latest = await storedKickoff();
    if (field === "platform") latest.items[0].platform = "google";
    else latest.items[0][field] = "Replacement fixture";
    await saveKickoff(latest);
    expect(await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START, expected }], "Stale detector")).toEqual([]);
    expect((await storedKickoff()).items[0].startedAt).toBeNull();
  });
});

describe("kickoff detection with conditional Blobs replay fixtures", () => {
  let values: Map<string, { data: unknown; etag: string }>;
  let revision: number;

  beforeEach(() => {
    vi.stubEnv("RECORDS_BACKEND", "blobs"); resetRecordStore();
    values = new Map(); revision = 0;
    blobs.get.mockImplementation(async (key: string) => values.has(key) ? structuredClone(values.get(key)!.data) : null);
    blobs.getWithMetadata.mockImplementation(async (key: string) => values.has(key) ? structuredClone(values.get(key)) : null);
    blobs.setJSON.mockImplementation(async (key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }) => {
      const current = values.get(key);
      if ((options?.onlyIfNew && current) || (options?.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
      const etag = `fixture-version-${++revision}`;
      values.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    });
  });

  it("keeps its start result when an applied conditional write is replayed after a lost receipt", async () => {
    await saveKickoff(kickoff());
    const original = blobs.setJSON.getMockImplementation()!;
    let replayed = false;
    blobs.setJSON.mockImplementation(async (...args: unknown[]) => {
      const receipt = await original(...args);
      if (!replayed && args[2]) { replayed = true; return { modified: false }; }
      return receipt;
    });
    const detected = await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "Fixture detector");
    expect(detected.map(value => value.key)).toEqual(["campaign-a"]);
    expect((await storedKickoff()).items[0].startedAt).toBe(FIRST_START);
    expect(await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: SECOND_START }], "Later detector")).toEqual([]);
  });

  it("does not return an uncommitted detection when another detector wins the same campaign", async () => {
    await saveKickoff(kickoff());
    const original = blobs.setJSON.getMockImplementation()!;
    let competed = false;
    blobs.setJSON.mockImplementation(async (...args: unknown[]) => {
      if (!competed) {
        competed = true;
        const winner = structuredClone(values.get(RECORD_KEY)!.data) as MonthKickoff;
        winner.items[0].startedAt = SECOND_START;
        values.set(RECORD_KEY, { data: winner, etag: "winning-detector" });
        if (args[2]) return { modified: false };
      }
      return original(...args);
    });
    const detected = await markKickoffStarted("izzi", MONTH, [{ key: "campaign-a", at: FIRST_START }], "Losing detector");
    expect(detected).toEqual([]);
    expect((await storedKickoff()).items[0].startedAt).toBe(SECOND_START);
  });
});
