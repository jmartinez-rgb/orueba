import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedback } from "@/lib/records/feedback";
import { createTicket } from "@/lib/records/tickets";
import { createNovedad } from "@/lib/records/novedades";
import { nextRecordId } from "@/lib/records/counter";
import { getRecordStore, RecordStoreError, resetRecordStore } from "@/lib/records/store";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "record-counters-"));
  resetRecordStore();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetRecordStore();
  await rm(directory, { recursive: true, force: true });
});

const records = [
  {
    collection: "feedback", prefix: "FB",
    create: (title: string) => createFeedback({ kind: "BUG", title, description: "Fixture", page: null, impact: "MEDIO" }, { id: "fixture", name: "Fixture", role: "operativo" }, null),
  },
  {
    collection: "tickets", prefix: "TKT",
    create: (title: string) => createTicket({ title, description: "Fixture", severity: "ATTENTION", category: "DATOS", platform: null, accountName: null, incidentIds: [], reportedTo: "", channel: "OTRO", externalRef: null, owner: null }, "Fixture"),
  },
  {
    collection: "novedades", prefix: "NOV",
    create: (title: string) => createNovedad({ kind: "OTRO", title, detail: "Fixture", platform: null, accountId: null, accountName: null, campaignId: null, campaignName: null, approvedBy: "Fixture", approvalChannel: "OTRO", approvalRef: null, effectiveFrom: "2026-10-01", effectiveUntil: null, budget: null, expectedChange: null, includesFullStop: false, silenceAlerts: false, incidentId: null, alertFingerprint: null }, "Fixture"),
  },
];

describe.each(["memory", "file"] as const)("record creation with %s storage", (backend) => {
  beforeEach(() => {
    vi.stubEnv("RECORDS_BACKEND", backend);
    vi.stubEnv("RECORDS_DIR", directory);
    resetRecordStore();
  });

  it.each(records)("preserves every concurrent $collection creation with a distinct ID", async ({ collection, create }) => {
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => create(`Fixture ${index}`)));
    expect(new Set(created.map(record => record.id)).size).toBe(12);
    const store = getRecordStore();
    expect(await store.list(`${collection}/`)).toHaveLength(12);
    for (const record of created) expect(await store.get(`${collection}/${record.id}`)).toEqual(record);
  });

  it.each(records)("never overwrites existing $collection when its counter is missing", async ({ collection, prefix, create }) => {
    const store = getRecordStore();
    await store.set(`${collection}/${prefix}-0001`, { title: "Historical fixture" });
    const created = await create("New fixture");
    expect(created.id).toBe(`${prefix}-0002`);
    expect(await store.get(`${collection}/${prefix}-0001`)).toEqual({ title: "Historical fixture" });
  });

  it.each(records)("rejects a malformed $collection counter before creating a record", async ({ collection, create }) => {
    const store = getRecordStore();
    await store.set(`counters/${collection}`, { n: "1" });
    await expect(create("Rejected fixture")).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.list(`${collection}/`)).toEqual([]);
    expect(await store.get(`counters/${collection}`)).toEqual({ n: "1" });
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, {}, []])("rejects an invalid or exhausted sequence %j without changing it", async (n) => {
    const store = getRecordStore();
    await store.set("counters/fixture", { n });
    await expect(nextRecordId(store, "fixture", "FIX")).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.get("counters/fixture")).toEqual({ n });
  });

  it("allows identifiers with more than four digits", async () => {
    const store = getRecordStore();
    await store.set("counters/feedback", { n: 9999 });
    expect((await records[0].create("Five digits")).id).toBe("FB-10000");
  });

  it("does not reuse a reserved ID if record creation fails", async () => {
    const store = getRecordStore();
    const write = vi.spyOn(store, "set").mockRejectedValueOnce(new RecordStoreError());
    await expect(records[0].create("Failed fixture")).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.get("counters/feedback")).toEqual({ n: 1 });
    expect(await store.list("feedback/")).toEqual([]);
    write.mockRestore();
    expect((await records[0].create("Next fixture")).id).toBe("FB-0002");
  });

  it("allows a sequence gap when a committed reservation is replayed after an ambiguous receipt", async () => {
    const store = getRecordStore();
    const original = store.update.bind(store);
    // Model a backend that committed the first transform, lost its receipt, and
    // replays the transform against the now-current value before returning.
    vi.spyOn(store, "update").mockImplementationOnce(async (key, transform) => {
      await original(key, transform);
      return original(key, transform);
    });
    const first = await records[0].create("Replayed fixture");
    const second = await records[0].create("Following fixture");
    expect([first.id, second.id]).toEqual(["FB-0002", "FB-0003"]);
    expect(await store.get("counters/feedback")).toEqual({ n: 3 });
    expect(await store.list("feedback/")).toHaveLength(2);
    expect(await store.get(`feedback/${first.id}`)).toEqual(first);
    expect(await store.get(`feedback/${second.id}`)).toEqual(second);
  });
});
