import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedback } from "@/lib/records/feedback";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";

const backend = vi.hoisted(() => ({ get: vi.fn(), getWithMetadata: vi.fn(), setJSON: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => backend }));

const create = (title: string) => createFeedback({ kind: "BUG", title, description: "Fixture", page: null, impact: "MEDIO" }, { id: "fixture", name: "Fixture", role: "operativo" }, null);
let values: Map<string, { data: unknown; etag: string }>;
let revision: number;

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("RECORDS_BACKEND", "blobs"); resetRecordStore();
  values = new Map(); revision = 0;
  backend.get.mockImplementation(async (key: string) => values.has(key) ? structuredClone(values.get(key)!.data) : null);
  backend.getWithMetadata.mockImplementation(async (key: string) => values.has(key) ? structuredClone(values.get(key)) : null);
  backend.setJSON.mockImplementation(async (key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }) => {
    const current = values.get(key);
    if ((options?.onlyIfNew && current) || (options?.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
    const etag = `fixture-version-${++revision}`;
    values.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetRecordStore(); });

describe("counter reservations with a conditional Blobs fixture", () => {
  it("keeps distinct confirmed IDs when independent creations conflict", async () => {
    const created = await Promise.all([create("First"), create("Second"), create("Third")]);
    expect(new Set(created.map(record => record.id)).size).toBe(3);
    for (const record of created) expect(await getRecordStore().get(`feedback/${record.id}`)).toEqual(record);
    expect(await getRecordStore().get("counters/feedback")).toEqual({ n: 3 });
  });

  it("allows a gap after an applied reservation loses its receipt without reusing an ID", async () => {
    const original = backend.setJSON.getMockImplementation()!;
    backend.setJSON.mockImplementationOnce(async (...args: unknown[]) => { await original(...args); return { modified: false }; });
    const first = await create("Lost receipt"), second = await create("Following record");
    expect([first.id, second.id]).toEqual(["FB-0002", "FB-0003"]);
    expect(await getRecordStore().get("counters/feedback")).toEqual({ n: 3 });
    expect(await getRecordStore().get("feedback/FB-0001")).toBeNull();
  });

  it("skips a contiguous historical sequence when the counter has been restored behind it", async () => {
    for (let n = 1; n <= 20; n++) values.set(`feedback/FB-${String(n).padStart(4, "0")}`, { data: { historical: n }, etag: `historical-${n}` });
    values.set("counters/feedback", { data: { n: 2 }, etag: "restored-counter" });
    const created = await create("Recovered counter");
    expect(created.id).toBe("FB-0021");
    for (let n = 1; n <= 20; n++) expect(values.get(`feedback/FB-${String(n).padStart(4, "0")}`)?.data).toEqual({ historical: n });
  });

  it("does not create a record when the conditional reservation never wins", async () => {
    backend.setJSON.mockResolvedValue({ modified: false });
    await expect(create("No confirmed reservation")).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(backend.setJSON).toHaveBeenCalledTimes(5);
    expect([...values.keys()]).toEqual([]);
  });

  it("does not claim a write confirmed when an applied reservation returns no receipt ETag", async () => {
    const original = backend.setJSON.getMockImplementation()!;
    backend.setJSON.mockImplementationOnce(async (...args: unknown[]) => { await original(...args); return { modified: true, etag: "" }; });
    await expect(create("Ambiguous receipt")).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await getRecordStore().get("counters/feedback")).toEqual({ n: 1 });
    expect([...values.keys()].filter(key => key.startsWith("feedback/"))).toEqual([]);
    expect((await create("Following confirmed write")).id).toBe("FB-0002");
  });
});
