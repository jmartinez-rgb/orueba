import { describe, expect, it, vi } from "vitest";
import { checkRecordStorage } from "@/lib/release/records-check";
import type { RecordStore } from "@/lib/records/store";

describe("validación reversible de almacenamiento", () => {
  it("no certifica memoria y no escribe en ella", async () => {
    const store = { backend: "memory", set: vi.fn() } as unknown as RecordStore;
    expect(await checkRecordStorage(store)).toMatchObject({ available: false, code: "VOLATILE_RECORDS" });
    expect(store.set).not.toHaveBeenCalled();
  });
  it("usa una llave aislada, verifica lectura efectiva y la elimina", async () => {
    let value: unknown;
    const store: RecordStore = { backend: "file", update: vi.fn(), set: vi.fn(async (_key, data) => { value = data; }), get: vi.fn(async () => value) as RecordStore["get"], delete: vi.fn(async () => {}), list: vi.fn() };
    expect(await checkRecordStorage(store)).toMatchObject({ available: true, code: "RECORD_IO_VERIFIED" });
    const key = vi.mocked(store.set).mock.calls[0][0];
    expect(key).toMatch(/^validation\/storage\//);
    expect(store.delete).toHaveBeenCalledWith(key);
  });
  it("un fallo de lectura o limpieza sigue pendiente sin filtrar mensajes privados", async () => {
    const store = { backend: "file", set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockRejectedValue(new Error("secret-original-error")), delete: vi.fn().mockResolvedValue(undefined) } as unknown as RecordStore;
    expect(await checkRecordStorage(store)).toEqual({ checked: true, available: false, code: "RECORD_IO_FAILED" });
    expect(store.delete).toHaveBeenCalled();
    store.get = vi.fn().mockResolvedValue(null);
    expect((await checkRecordStorage(store)).available).toBe(false);
  });
});
