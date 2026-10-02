import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileRecordStore } from "@/lib/records/store";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { refreshUnified } from "@/lib/unified/refresh";
import { UnifiedDataError, type UnifiedScope } from "@/lib/unified/schema";

const mock = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/unified/sync", () => ({ syncUnified: mock.sync }));
const scope: UnifiedScope = { platform: "tiktok", accountId: "100001", brand: "izzi", currency: "MXN" };
const success = [{ granularity: "daily", status: "SUCCESS", rows: 3, code: null }, { granularity: "hourly", status: "SUCCESS", rows: 20, code: null }];
let root: string;
let now: Date;
const run = (extra = {}) => refreshUnified({ mapping: { version: 1, accounts: [scope] }, store: new UnifiedSnapshotStore(root), url: "https://private-api.example.test", apiKey: "synthetic-not-a-real-secret", timezone: "America/Mexico_City", clock: () => now, ...extra });
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "monitor-refresh-")); now = new Date("2026-10-02T05:30:00Z"); mock.sync.mockReset().mockResolvedValue(success); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("actualización acotada y espera persistida", () => {
  it("respeta el día mexicano, las cuentas explícitas y el intervalo tras reiniciar", async () => {
    const first = await run();
    expect(first[0]).toMatchObject({ status: "SUCCESS", rows: 23, nextDueAt: "2026-10-02T07:30:00.000Z" });
    expect(mock.sync.mock.calls[0][0]).toMatchObject({ mapping: { accounts: [scope] }, from: "2026-09-29", to: "2026-10-01", granularities: ["daily", "hourly"] });
    expect((await run())[0].status).toBe("WAITING");
    expect(mock.sync).toHaveBeenCalledTimes(1);
    const path = join(root, ".scheduler/tiktok/100001/izzi/MXN.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const stored = await new FileRecordStore(join(root, ".scheduler")).get("tiktok/100001/izzi/MXN");
    expect(JSON.stringify(stored)).not.toMatch(/secret|private-api|apiKey|synthetic/);
  });
  it("un límite horario conserva el éxito diario pero espera cuatro horas para la cuenta", async () => {
    mock.sync.mockResolvedValue([success[0], { granularity: "hourly", status: "FAILED", rows: 0, code: "API_RATE_LIMITED" }]);
    expect((await run())[0]).toMatchObject({ status: "PARTIAL", rows: 3, code: "API_RATE_LIMITED", nextDueAt: "2026-10-02T09:30:00.000Z" });
    now = new Date("2026-10-02T08:00:00Z");
    expect((await run())[0].status).toBe("WAITING");
    expect(mock.sync).toHaveBeenCalledTimes(1);
    now = new Date("2026-10-02T09:30:00Z"); mock.sync.mockResolvedValue(success);
    expect((await run())[0]).toMatchObject({ status: "SUCCESS", code: null, nextDueAt: "2026-10-02T11:30:00.000Z" });
  });
  it("rechaza ejecución concurrente sin romper la primera ni su bloqueo", async () => {
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    mock.sync.mockImplementation(async () => { entered(); await gate; return success; });
    const first = run(); await ready;
    await expect(run()).rejects.toMatchObject({ code: "REFRESH_LOCKED" });
    finish(); await first;
    expect((await run())[0].status).toBe("WAITING");
  });
  it("guarda solo códigos fijos de errores y no presenta una respuesta vacía válida como fallo", async () => {
    mock.sync.mockRejectedValue(new Error("OAuth-private-token-and-body"));
    expect((await run())[0]).toMatchObject({ status: "FAILED", code: "REFRESH_FAILED" });
    now = new Date("2026-10-02T10:00:00Z");
    mock.sync.mockResolvedValue(success.map(operation => ({ ...operation, rows: 0 })));
    expect((await run())[0]).toMatchObject({ status: "EMPTY", code: null });
  });
  it("no ignora un estado corrupto ni toca la red ante intervalos inválidos", async () => {
    await new FileRecordStore(join(root, ".scheduler")).set("tiktok/100001/izzi/MXN", { nextDueAt: "yesterday" });
    await expect(run()).rejects.toMatchObject({ code: "INVALID_REFRESH_STATE" });
    await expect(run({ intervalMs: 1 })).rejects.toMatchObject({ code: "INVALID_REFRESH_OPTIONS" });
    expect(mock.sync).not.toHaveBeenCalled();
  });
  it("limita la espera a 24 horas y continúa con otras cuentas ante fallos", async () => {
    await new FileRecordStore(join(root, ".scheduler")).set("tiktok/100001/izzi/MXN", { version: 1, startedAt: now.toISOString(), completedAt: now.toISOString(), nextDueAt: now.toISOString(), failures: 10, code: "API_RATE_LIMITED" });
    mock.sync.mockRejectedValueOnce(new UnifiedDataError("API_TRANSPORT_ERROR")).mockResolvedValueOnce(success);
    const result = await run({ mapping: { version: 1, accounts: [scope, { ...scope, accountId: "100002", brand: "sky" }] } });
    expect(result.map(operation => operation.status)).toEqual(["FAILED", "SUCCESS"]);
    expect(Date.parse(result[0].nextDueAt) - now.getTime()).toBe(24 * 60 * 60_000);
  });
  it("se detiene antes de solicitar otra cuenta cuando llega la señal de cierre", async () => {
    const stop = new AbortController();
    mock.sync.mockImplementation(async () => { stop.abort(); return success; });
    const result = await run({ signal: stop.signal, mapping: { version: 1, accounts: [scope, { ...scope, accountId: "100002" }] } });
    expect(result).toHaveLength(1);
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });
  it("cancela el transporte en vuelo sin empezar la siguiente cuenta", async () => {
    const stop = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const request: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      entered(); init?.signal?.addEventListener("abort", () => reject(new Error("private transport detail")), { once: true });
    });
    mock.sync.mockImplementation(async options => {
      await options.request("https://private-api.example.test", { signal: AbortSignal.timeout(5000) });
      return success;
    });
    const running = run({ request, signal: stop.signal, mapping: { version: 1, accounts: [scope, { ...scope, accountId: "100002" }] } });
    await ready; stop.abort();
    expect(await running).toEqual([expect.objectContaining({ status: "FAILED", code: "REFRESH_FAILED" })]);
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });

});
