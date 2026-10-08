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


  describe("histórico faltante (carga inicial en una base nueva)", () => {
    const store = () => new UnifiedSnapshotStore(root);
    const save = async (date: string, granularity: "daily" | "hourly", account: UnifiedScope = scope) => store().savePartition({ version: 1, scope: account, date, granularity, extractedAt: now.toISOString(), rows: [] });
    /** Stands in for the API: every requested day is stored (empty days included), as syncUnified does. */
    const storing = (fail?: (options: { from: string; granularities: string[] }) => string | null) => async (options: { from: string; to: string; granularities: Array<"daily" | "hourly">; mapping: { accounts: UnifiedScope[] } }) => {
      const code = fail?.(options) ?? null;
      if (code) return options.granularities.map(granularity => ({ granularity, status: "FAILED", rows: 0, code }));
      for (const granularity of options.granularities) for (let date = options.from; date <= options.to; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) await save(date, granularity, options.mapping.accounts[0]);
      return options.granularities.map(granularity => ({ granularity, status: "SUCCESS", rows: 2, code: null }));
    };
    const window = (call: unknown[]) => { const o = call[0] as { from: string; to: string; granularities: string[] }; return [o.from, o.to, o.granularities.join("+")]; };

    it("completa una sola vez los días que faltan, del más reciente al más antiguo, sin repetir días guardados", async () => {
      await save("2026-09-20", "daily"); await save("2026-09-20", "hourly");
      mock.sync.mockImplementation(storing());
      const [first] = await run({ historyDays: 35 });
      expect(first).toMatchObject({ status: "SUCCESS", code: null, nextDueAt: "2026-10-02T07:30:00.000Z", history: { rows: 8, missingDays: 0 } });
      expect(mock.sync.mock.calls.map(window)).toEqual([
        ["2026-09-29", "2026-10-01", "daily+hourly"],
        ["2026-09-21", "2026-09-28", "daily"], ["2026-08-27", "2026-09-19", "daily"],
        ["2026-09-21", "2026-09-28", "hourly"], ["2026-08-27", "2026-09-19", "hourly"],
      ]);
      now = new Date("2026-10-02T07:30:00Z");
      const [second] = await run({ historyDays: 35 });
      expect(second.history).toEqual({ rows: 0, missingDays: 0 });
      expect(mock.sync).toHaveBeenCalledTimes(6);
    });

    it("primero lee hoy en todas las cuentas y después completa el histórico", async () => {
      mock.sync.mockImplementation(storing());
      const other: UnifiedScope = { ...scope, accountId: "100002" };
      const result = await run({ historyDays: 35, mapping: { version: 1, accounts: [scope, other] } });
      const calls = mock.sync.mock.calls.map(call => [(call[0] as { mapping: { accounts: UnifiedScope[] } }).mapping.accounts[0].accountId, ...window(call)]);
      expect(calls.slice(0, 2)).toEqual([["100001", "2026-09-29", "2026-10-01", "daily+hourly"], ["100002", "2026-09-29", "2026-10-01", "daily+hourly"]]);
      expect(calls.slice(2).map(call => call[0])).toEqual(["100001", "100001", "100002", "100002"]);
      expect(result.map(entry => entry.history)).toEqual([{ rows: 4, missingDays: 0 }, { rows: 4, missingDays: 0 }]);
    });

    it("no completa una granularidad que falló en la ronda normal", async () => {
      mock.sync.mockImplementation(storing());
      mock.sync.mockImplementationOnce(async options => [{ granularity: "daily", status: "SUCCESS", rows: 3, code: null }, { granularity: "hourly", status: "FAILED", rows: 0, code: "API_RESPONSE_ERROR" }].filter(o => options.granularities.includes(o.granularity as "daily")));
      const [result] = await run({ historyDays: 35 });
      expect(result).toMatchObject({ status: "PARTIAL", code: "API_RESPONSE_ERROR", history: { missingDays: 33 } });
      expect(mock.sync.mock.calls.slice(1).map(window)).toEqual([["2026-08-27", "2026-09-28", "daily"]]);
    });

    it("un fallo del histórico lo pausa 12 horas sin cambiar el estado ni la espera de la ronda normal", async () => {
      mock.sync.mockImplementation(storing(options => options.from !== "2026-09-29" ? "API_RATE_LIMITED" : null));
      const [result] = await run({ historyDays: 35 });
      expect(result).toMatchObject({ status: "SUCCESS", code: null, nextDueAt: "2026-10-02T07:30:00.000Z", history: { rows: 0, missingDays: 33 } });
      expect(mock.sync).toHaveBeenCalledTimes(2);
      // Next Mexico day: the window moves one day and the regular round already stored 2026-09-29.
      now = new Date("2026-10-02T07:30:00Z");
      expect((await run({ historyDays: 35 }))[0].history).toEqual({ rows: 0, missingDays: 32 });
      expect(mock.sync).toHaveBeenCalledTimes(3);
      now = new Date("2026-10-02T17:31:00Z");
      mock.sync.mockImplementation(storing());
      expect((await run({ historyDays: 35 }))[0].history).toMatchObject({ missingDays: 0 });
    });

    it("rechaza una ventana de histórico fuera de rango sin tocar la red", async () => {
      for (const historyDays of [-1, 45, 3.5]) await expect(run({ historyDays })).rejects.toMatchObject({ code: "INVALID_REFRESH_OPTIONS" });
      expect(mock.sync).not.toHaveBeenCalled();
    });
  });

});
