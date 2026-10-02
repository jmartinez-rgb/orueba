import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRecordStore, getRecordStore, resetRecordStore } from "@/lib/records/store";

const blobs = vi.hoisted(() => ({ get: vi.fn(), setJSON: vi.fn(), delete: vi.fn(), list: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => blobs }));
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "durable-records-")); resetRecordStore(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); resetRecordStore(); });

describe("persistent operational records", () => {
  it("writes private complete JSON and survives a new store instance", async () => {
    const store = new FileRecordStore(directory);
    await store.set("audit/2026-09-30/event", { note: "Guardado" });
    expect(await new FileRecordStore(directory).get("audit/2026-09-30/event")).toEqual({ note: "Guardado" });
    expect((await stat(join(directory, "audit/2026-09-30/event.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, "audit/2026-09-30"))).toEqual(["event.json"]);
  });
  it("keeps previous data if JSON serialization fails before rename", async () => {
    const store = new FileRecordStore(directory); await store.set("auth/users", ["old"]);
    const circular: { self?: unknown } = {}; circular.self = circular;
    await expect(store.set("auth/users", circular)).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(await store.get("auth/users")).toEqual(["old"]);
    expect(await readdir(join(directory, "auth"))).toEqual(["users.json"]);
  });
  it("distinguishes a missing file from corrupt existing records", async () => {
    const store = new FileRecordStore(directory); expect(await store.get("missing")).toBeNull();
    await writeFile(join(directory, "broken.json"), "private broken fixture");
    await expect(store.get("broken")).rejects.toThrow("almacenamiento persistente");
    await expect(store.get("broken")).rejects.not.toThrow("private broken fixture");
  });
  it("dot segments stay inside the configured root and list round-trips keys", async () => {
    const store = new FileRecordStore(directory); await store.set("../outside", 42);
    expect(await store.get("../outside")).toBe(42);
    expect(await store.list("../")).toEqual(["../outside"]);
    expect(await store.list("")).toEqual(["../outside"]);
    expect(await stat(join(directory, "%2E%2E/outside.json"))).toBeDefined();
  });
  it.each(["get", "setJSON", "delete", "list"] as const)("propagates Blobs %s failures without volatile success or leaking the original error", async action => {
    vi.stubEnv("RECORDS_BACKEND", "blobs"); const secret = "private-signed-url-fixture";
    blobs[action].mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = getRecordStore();
    const operation = action === "get" ? store.get("key") : action === "setJSON" ? store.set("key", 1) : action === "delete" ? store.delete("key") : store.list("key");
    await expect(operation).rejects.toMatchObject({ code: "RECORDS_UNAVAILABLE" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
});
