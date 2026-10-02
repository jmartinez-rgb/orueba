import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listUsers, touchUser, type AuditUser, type UserDirectoryEntry } from "@/lib/records/audit";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";

const user: AuditUser = { id: "fixture-operador", name: "Operador fixture", role: "manager", kind: "named" };
const key = `users/${encodeURIComponent(user.id)}`;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "user-directory-"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  resetRecordStore();
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  resetRecordStore();
  await rm(directory, { recursive: true, force: true });
});

describe.each(["memory", "file"] as const)("directory updates with %s storage", backend => {
  beforeEach(() => {
    vi.stubEnv("RECORDS_BACKEND", backend);
    vi.stubEnv("RECORDS_DIR", directory);
    resetRecordStore();
  });

  it("keeps all successful simultaneous logins", async () => {
    await Promise.all(Array.from({ length: 12 }, () => touchUser(user, { login: true })));
    expect(await getRecordStore().get<UserDirectoryEntry>(key)).toMatchObject({ logins: 12, lastLoginAt: "2026-10-02T12:00:00.000Z" });
  });

  it("presence cannot erase a concurrent login", async () => {
    await Promise.all([touchUser(user, { login: true, agent: "Login fixture" }), touchUser(user)]);
    expect(await getRecordStore().get<UserDirectoryEntry>(key)).toMatchObject({ logins: 1, lastLoginAt: "2026-10-02T12:00:00.000Z", lastAgent: "Login fixture" });
  });

  it("deduplicates a login when its confirmed write transform is replayed", async () => {
    const store = getRecordStore(), original = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (recordKey, transform) => {
      await original(recordKey, transform);
      return original(recordKey, transform);
    });
    await touchUser(user, { login: true });
    expect((await store.get<UserDirectoryEntry>(key))?.logins).toBe(1);
  });

  it("replaying an earlier login preserves the newer login metadata and count", async () => {
    const store = getRecordStore(), original = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (recordKey, transform) => {
      await original(recordKey, transform);
      vi.setSystemTime(new Date("2026-10-02T12:01:00Z"));
      await touchUser({ ...user, name: "Operador actualizado" }, { login: true, agent: "Newer fixture" });
      return original(recordKey, transform);
    });
    await touchUser(user, { login: true, agent: "Earlier fixture" });
    expect(await store.get<UserDirectoryEntry>(key)).toMatchObject({ logins: 2, name: "Operador actualizado", firstSeenAt: "2026-10-02T12:00:00.000Z", lastLoginAt: "2026-10-02T12:01:00.000Z", lastAgent: "Newer fixture" });
  });

  it("a delayed older login increments the count without moving presence backwards", async () => {
    const store = getRecordStore(), original = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (recordKey, transform) => {
      vi.setSystemTime(new Date("2026-10-02T12:01:00Z"));
      await touchUser({ ...user, name: "Operador actualizado" }, { login: true, agent: "Newer fixture" });
      return original(recordKey, transform);
    });
    await touchUser(user, { login: true, agent: "Earlier fixture" });
    expect(await store.get<UserDirectoryEntry>(key)).toMatchObject({ logins: 2, name: "Operador actualizado", firstSeenAt: "2026-10-02T12:00:00.000Z", lastLoginAt: "2026-10-02T12:01:00.000Z", lastSeenAt: "2026-10-02T12:01:00.000Z", lastAgent: "Newer fixture" });
  });

  it("updates legacy directory entries without replay metadata", async () => {
    await getRecordStore().set(key, { ...user, firstSeenAt: "2026-10-01T12:00:00.000Z", lastLoginAt: "2026-10-01T12:00:00.000Z", lastSeenAt: "2026-10-01T12:00:00.000Z", logins: 7, lastAgent: "Earlier fixture" } satisfies UserDirectoryEntry);
    await touchUser(user, { login: true });
    expect(await getRecordStore().get<UserDirectoryEntry>(key)).toMatchObject({ logins: 8, firstSeenAt: "2026-10-01T12:00:00.000Z", lastAgent: "Earlier fixture" });
  });

  it("propagates an unconfirmed write and allows the next confirmed login", async () => {
    const store = getRecordStore();
    vi.spyOn(store, "update").mockRejectedValueOnce(new Error("Fixture unconfirmed write"));
    await expect(touchUser(user, { login: true })).rejects.toThrow("Fixture unconfirmed write");
    expect(await store.get(key)).toBeNull();
    await touchUser(user, { login: true });
    expect((await store.get<UserDirectoryEntry>(key))?.logins).toBe(1);
  });

  it("keeps the five-minute presence throttle", async () => {
    await touchUser(user, { login: true });
    const store = getRecordStore(), update = vi.spyOn(store, "update"), set = vi.spyOn(store, "set");
    vi.setSystemTime(new Date("2026-10-02T12:04:59Z"));
    await touchUser(user);
    expect(update).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-02T12:05:00Z"));
    await touchUser(user);
    expect((await store.get<UserDirectoryEntry>(key))?.lastSeenAt).toBe("2026-10-02T12:05:00.000Z");
  });

  it("keeps recent replay receipts private and bounded without limiting login totals", async () => {
    for (let index = 0; index < 55; index++) await touchUser(user, { login: true });
    const stored = await getRecordStore().get<UserDirectoryEntry & { appliedOperations?: string[] }>(key);
    expect(stored?.logins).toBe(55);
    expect(stored?.appliedOperations).toHaveLength(50);
    expect(JSON.stringify(await listUsers())).not.toContain("appliedOperations");
  });

  it("does not create a directory entry for anonymous requests", async () => {
    await touchUser({ ...user, kind: "anon" }, { login: true });
    expect(await listUsers()).toEqual([]);
  });
});
