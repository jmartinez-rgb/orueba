import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as BlobsSdk from "@netlify/blobs";
import { FileRecordStore, getRecordStore, resetRecordStore, type RecordStore } from "@/lib/records/store";
import { reviewHistory, saveReview } from "@/lib/records/incident-reviews";
import { checkedBlobsFetch } from "@/lib/records/blobs-fetch";

const blobs = vi.hoisted(() => ({ getWithMetadata: vi.fn(), setJSON: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => blobs }));
let directory: string;

beforeEach(async () => {
  vi.resetAllMocks(); resetRecordStore();
  directory = await mkdtemp(join(tmpdir(), "record-concurrency-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks(); resetRecordStore();
});

const increment = (current: { total: number } | null) => ({ total: (current?.total ?? 0) + 1 });

describe("record updates inside one process", () => {
  it("serializes independent file-store objects pointing to the same root and key", async () => {
    const a = new FileRecordStore(directory), b = new FileRecordStore(join(directory, "."));
    await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? a : b).update("counter", increment)));
    expect(await a.get("counter")).toEqual({ total: 24 });
  });

  it("serializes memory-store updates without sharing mutable object references", async () => {
    const store = getRecordStore();
    await Promise.all(Array.from({ length: 24 }, () => store.update("counter", increment)));
    const value = await store.get<{ total: number }>("counter"); value!.total = 999;
    expect(await store.get("counter")).toEqual({ total: 24 });
  });

  it("a blocked key does not block a different key", async () => {
    const store = new FileRecordStore(directory);
    const original = store.get.bind(store);
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(store, "get").mockImplementation((async (key: string) => {
      if (key === "slow") { entered(); await blocked; }
      return original(key);
    }) as RecordStore["get"]);
    const slow = store.update("slow", increment);
    await started;
    try { expect(await store.update("fast", increment)).toEqual({ total: 1 }); }
    finally { release(); }
    await slow;
  });

  it.each(["set", "delete"] as const)("a direct %s waits for a pending update on the same file", async operation => {
    const first = new FileRecordStore(directory), second = new FileRecordStore(directory);
    await first.set("counter", { total: 0 });
    const original = first.get.bind(first);
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(first, "get").mockImplementation((async (key: string) => { entered(); await blocked; return original(key); }) as RecordStore["get"]);
    const update = first.update("counter", increment);
    await started;
    let completed = false;
    const direct = (operation === "set" ? second.set("counter", { total: 100 }) : second.delete("counter")).then(() => { completed = true; });
    try { await new Promise(resolve => setImmediate(resolve)); expect(completed).toBe(false); }
    finally { release(); }
    await Promise.all([update, direct]);
    expect(await second.get("counter")).toEqual(operation === "set" ? { total: 100 } : null);
  });

  it("releases its queue and preserves previous data after a transform or write failure", async () => {
    const store = new FileRecordStore(directory); await store.set("counter", { total: 7 });
    const failure = new Error("domain fixture");
    await expect(store.update("counter", () => { throw failure; })).rejects.toBe(failure);
    const circular: { self?: unknown } = {}; circular.self = circular;
    await expect(store.update("counter", () => circular)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.get("counter")).toEqual({ total: 7 });
    expect(await store.update("counter", increment)).toEqual({ total: 8 });
  });

  it("rejects an asynchronous transform before changing stored data", async () => {
    const store = getRecordStore(); await store.set("counter", { total: 4 });
    const invalid = (async () => ({ total: 5 })) as unknown as (current: { total: number } | null) => { total: number };
    await expect(store.update("counter", invalid)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.get("counter")).toEqual({ total: 4 });
  });

  it("keeps concurrent incident-review appends and their actor without crossing brands", async () => {
    vi.stubEnv("RECORDS_BACKEND", "file"); vi.stubEnv("RECORDS_DIR", directory); resetRecordStore();
    await Promise.all(Array.from({ length: 12 }, (_, index) => saveReview("izzi", { incidentId: "INC-0001", verdict: "CUMPLE", comment: `note ${index}`, by: `actor ${index}` })));
    const history = await reviewHistory("izzi", "INC-0001");
    expect(history).toHaveLength(12);
    expect(new Set(history.map(review => review.by)).size).toBe(12);
    expect(await reviewHistory("sky", "INC-0001")).toEqual([]);
  });
});

describe("Netlify conditional record updates", () => {
  beforeEach(() => { vi.stubEnv("RECORDS_BACKEND", "blobs"); resetRecordStore(); });

  it("creates a missing record only if it is still absent", async () => {
    blobs.getWithMetadata.mockResolvedValue(null);
    blobs.setJSON.mockResolvedValue({ modified: true, etag: "new-version" });
    expect(await getRecordStore().update("counter", increment)).toEqual({ total: 1 });
    expect(blobs.getWithMetadata).toHaveBeenCalledWith("counter", { type: "json", consistency: "strong" });
    expect(blobs.setJSON).toHaveBeenCalledWith("counter", { total: 1 }, { onlyIfNew: true });
  });

  it("replays a pure update against the new version after another instance wins a conflict", async () => {
    blobs.getWithMetadata.mockResolvedValueOnce({ data: { notes: ["old"] }, etag: "v1" })
      .mockResolvedValueOnce({ data: { notes: ["old", "other actor"] }, etag: "v2" });
    blobs.setJSON.mockResolvedValueOnce({ modified: false }).mockResolvedValueOnce({ modified: true, etag: "v3" });
    const transform = vi.fn((current: { notes: string[] } | null) => ({ notes: [...(current?.notes ?? []), "my actor"] }));
    expect(await getRecordStore().update("review", transform)).toEqual({ notes: ["old", "other actor", "my actor"] });
    expect(transform).toHaveBeenCalledTimes(2);
    expect(blobs.setJSON.mock.calls[0][2]).toEqual({ onlyIfMatch: "v1" });
    expect(blobs.setJSON.mock.calls[1][2]).toEqual({ onlyIfMatch: "v2" });
  });

  it("changes from create-only to ETag matching after another instance creates the key", async () => {
    blobs.getWithMetadata.mockResolvedValueOnce(null).mockResolvedValueOnce({ data: { total: 7 }, etag: "other-creation" });
    blobs.setJSON.mockResolvedValueOnce({ modified: false }).mockResolvedValueOnce({ modified: true, etag: "updated" });
    expect(await getRecordStore().update("counter", increment)).toEqual({ total: 8 });
    expect(blobs.setJSON.mock.calls.map(call => call[2])).toEqual([{ onlyIfNew: true }, { onlyIfMatch: "other-creation" }]);
  });

  it("an existing JSON null still requires its ETag when restoring settings", async () => {
    blobs.getWithMetadata.mockResolvedValue({ data: null, etag: "reset-version" });
    blobs.setJSON.mockResolvedValue({ modified: true, etag: "restored-version" });
    await getRecordStore().update("settings", () => ({ limit: 10 }));
    expect(blobs.setJSON).toHaveBeenCalledWith("settings", { limit: 10 }, { onlyIfMatch: "reset-version" });
    await getRecordStore().update("settings", () => null);
    expect(blobs.setJSON).toHaveBeenLastCalledWith("settings", null, { onlyIfMatch: "reset-version" });
  });

  it("stops after five conflicts and never reports a committed result", async () => {
    blobs.getWithMetadata.mockResolvedValue({ data: { total: 1 }, etag: "unchanged" });
    blobs.setJSON.mockResolvedValue({ modified: false });
    await expect(getRecordStore().update("counter", increment)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(blobs.setJSON).toHaveBeenCalledTimes(5);
  });

  it("keeps domain conflict errors intact without writing or logging their private text", async () => {
    blobs.getWithMetadata.mockResolvedValue({ data: { total: 1 }, etag: "v1" });
    const domainError = new Error("private domain conflict fixture");
    await expect(getRecordStore().update("counter", () => { throw domainError; })).rejects.toBe(domainError);
    expect(blobs.setJSON).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
  });

  it("rejects non-JSON transform output before sending a conditional write", async () => {
    blobs.getWithMetadata.mockResolvedValue(null);
    const circular: { self?: unknown } = {}; circular.self = circular;
    await expect(getRecordStore().update("counter", () => circular)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(blobs.setJSON).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   "])("rejects an existing entry with missing or empty ETag %j", async etag => {
    blobs.getWithMetadata.mockResolvedValue({ data: { total: 1 }, etag });
    const transform = vi.fn(increment);
    await expect(getRecordStore().update("counter", transform)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(transform).not.toHaveBeenCalled(); expect(blobs.setJSON).not.toHaveBeenCalled();
  });

  it("rejects SDK 11.1.1's false modified:true receipt for an HTTP 401 fixture, without network", async () => {
    const sdk = await vi.importActual<typeof BlobsSdk>("@netlify/blobs");
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    const fixture = sdk.getStore({ name: "concurrency-fixture", siteID: "fixture-site", token: "fixture-token", edgeURL: "https://fixture.invalid", fetch });
    const receipt = await fixture.setJSON("counter", { total: 1 }, { onlyIfNew: true });
    expect(receipt).toEqual({ modified: true, etag: "" });
    expect(fetch).toHaveBeenCalledTimes(1);
    blobs.getWithMetadata.mockResolvedValue(null); blobs.setJSON.mockResolvedValue(receipt);
    await expect(getRecordStore().update("counter", increment)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fixture-token");
  });

  it("a backend read or write failure never includes the original error text", async () => {
    const privateMessage = "private signed report fixture";
    blobs.getWithMetadata.mockRejectedValueOnce(new Error(privateMessage));
    await expect(getRecordStore().update("counter", increment)).rejects.not.toThrow(privateMessage);
    blobs.getWithMetadata.mockResolvedValue(null); blobs.setJSON.mockRejectedValueOnce(new Error(privateMessage));
    await expect(getRecordStore().update("counter", increment)).rejects.not.toThrow(privateMessage);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateMessage);
  });

  it.each([401, 403, 429, 500])("rejects conditional HTTP %i even if its error response has an ETag", async status => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private error fixture", { status, headers: { etag: "error-page-etag" } }));
    await expect(checkedBlobsFetch("https://fixture.invalid/private-signed-fixture", { method: "put", headers: { "if-match": "v1" } })).rejects.toThrow("RECORDS_UNAVAILABLE");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private");
  });

  it.each([200, 201, 204, 412])("passes conditional HTTP %i to the SDK for success or conflict handling", async status => {
    const response = new Response(null, { status });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    expect(await checkedBlobsFetch("https://fixture.invalid", { method: "PUT", headers: { "if-none-match": "*" } })).toBe(response);
  });

  it("rejects an HTTP 500 GET with JSON and ETag instead of interpreting it as stored data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ total: 999 }, { status: 500, headers: { etag: "error-response" } }));
    await expect(checkedBlobsFetch("https://fixture.invalid", { method: "get" })).rejects.toThrow("RECORDS_UNAVAILABLE");
  });

  it.each(["GET", "DELETE"])("passes %s 404 for absence handling", async method => {
    const response = new Response(null, { status: 404 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    expect(await checkedBlobsFetch("https://fixture.invalid", { method })).toBe(response);
  });

  it("does not duplicate a review whose write applied before an ambiguous 412 response", async () => {
    let stored: { history: unknown[]; appliedOperations: string[] } | null = null;
    blobs.getWithMetadata.mockImplementation(async () => stored === null ? null : { data: structuredClone(stored), etag: "applied-version" });
    blobs.setJSON.mockImplementation(async (_key, value) => {
      const first = stored === null; stored = structuredClone(value);
      return first ? { modified: false } : { modified: true, etag: "confirmed-version" };
    });
    const review = await saveReview("izzi", { incidentId: "INC-0001", verdict: "CUMPLE", comment: "saved once", by: "actor" });
    expect(blobs.setJSON).toHaveBeenCalledTimes(2);
    const value = blobs.setJSON.mock.calls[1][1] as { history: unknown[]; appliedOperations: string[] };
    expect(value.history).toEqual([review]); expect(value.appliedOperations).toHaveLength(1);
  });

  it("appends to legacy reviews and keeps operation receipts bounded with the history", async () => {
    const history = Array.from({ length: 50 }, (_, index) => ({ incidentId: "INC-0001", verdict: "CUMPLE", comment: `legacy ${index}`, by: "legacy", at: "2026-10-01T00:00:00.000Z" }));
    blobs.getWithMetadata.mockResolvedValue({ data: { incidentId: "INC-0001", brand: "izzi", current: history[49], history }, etag: "legacy" });
    blobs.setJSON.mockResolvedValue({ modified: true, etag: "updated" });
    const review = await saveReview("izzi", { incidentId: "INC-0001", verdict: "CUMPLE", comment: "new", by: "actor" });
    const value = blobs.setJSON.mock.calls[0][1] as { history: unknown[]; appliedOperations: string[] };
    expect(value.history).toHaveLength(50); expect(value.history[49]).toEqual(review); expect(value.appliedOperations).toHaveLength(1);
    blobs.getWithMetadata.mockResolvedValue({ data: { ...value, appliedOperations: Array.from({ length: 50 }, (_, index) => `operation-${index}`) }, etag: "full-receipts" });
    await saveReview("izzi", { incidentId: "INC-0001", verdict: "CUMPLE", comment: "next", by: "actor" });
    expect(blobs.setJSON.mock.calls[1][1].appliedOperations).toHaveLength(50);
  });
});
