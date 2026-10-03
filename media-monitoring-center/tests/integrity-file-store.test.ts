import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { FileRecordStore, RecordStoreError } from "@/lib/records/store";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const worker = fileURLToPath(new URL("./integrity-fixtures/file-store-worker.ts", import.meta.url));
const directories: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), "integrity-file-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const child = (...args: string[]) => run(process.execPath, ["--conditions=react-server", "--import", "tsx", worker, ...args], { cwd: root }).catch((error: { code?: number }) => error);
const leftovers = async (dir: string) => (await readdir(dir)).filter(name => !name.endsWith(".json"));

describe("Backend File: integridad entre procesos", () => {
  it("dos procesos que actualizan la misma llave no pierden escrituras", async () => {
    const dir = await directory();
    await Promise.all([child(dir, "counter", "150"), child(dir, "counter", "150")]);
    expect(JSON.parse(await readFile(join(dir, "counter.json"), "utf8"))).toEqual({ n: 300 });
    expect(await leftovers(dir)).toEqual([]);
  }, 60_000);

  it("un proceso que muere con el lock tomado no bloquea ni altera el registro", async () => {
    const dir = await directory();
    const store = new FileRecordStore(dir);
    await store.set("counter", { n: 7 });
    const crashed = await child(dir, "counter", "0", "hold-and-die");
    expect((crashed as { code?: number }).code).toBe(9);
    expect((await readdir(dir)).sort()).toEqual(["counter.json", "counter.json.lock"]);
    const started = Date.now();
    await store.update<{ n: number }>("counter", current => ({ n: current!.n + 1 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await store.get("counter")).toEqual({ n: 8 });
    expect(await leftovers(dir)).toEqual([]);
  }, 60_000);

  it("retira el lock de una ejecución anterior con el mismo PID y uno antiguo de otro host", async () => {
    const dir = await directory();
    const store = new FileRecordStore(dir);
    await writeFile(join(dir, "a.json.lock"), JSON.stringify({ pid: process.pid, host: hostname(), nonce: "anterior", at: new Date().toISOString() }));
    await store.set("a", { ok: 1 });
    await writeFile(join(dir, "b.json.lock"), JSON.stringify({ pid: 1, host: "otro-host", nonce: "remoto", at: new Date().toISOString() }));
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, "b.json.lock"), old, old);
    await store.set("b", { ok: 2 });
    expect([await store.get("a"), await store.get("b")]).toEqual([{ ok: 1 }, { ok: 2 }]);
    expect(await leftovers(dir)).toEqual([]);
  });

  it("errores de dominio salen intactos y liberan el lock", async () => {
    const dir = await directory();
    const store = new FileRecordStore(dir);
    class DomainError extends Error {}
    await expect(store.update("x", () => { throw new DomainError("regla"); })).rejects.toBeInstanceOf(DomainError);
    await store.update<{ n: number }>("x", () => ({ n: 1 }));
    expect(await store.get("x")).toEqual({ n: 1 });
    expect(await leftovers(dir)).toEqual([]);
  });

  it("permisos 0600/0700, sin seguir symlinks en lectura, escritura ni listado", async () => {
    const dir = await directory();
    const store = new FileRecordStore(join(dir, "datos"));
    await store.set("col/uno", { ok: true });
    expect((await stat(join(dir, "datos"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, "datos", "col"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, "datos", "col", "uno.json"))).mode & 0o777).toBe(0o600);
    const outside = join(dir, "fuera.json");
    await writeFile(outside, JSON.stringify({ secreto: "no" }));
    await symlink(outside, join(dir, "datos", "col", "dos.json"));
    await expect(store.get("col/dos")).rejects.toBeInstanceOf(RecordStoreError);
    expect(await store.list("col/")).toEqual(["col/uno"]);
    await store.set("col/dos", { ok: 2 });
    expect(JSON.parse(await readFile(outside, "utf8"))).toEqual({ secreto: "no" });
    expect((await lstat(join(dir, "datos", "col", "dos.json"))).isSymbolicLink()).toBe(false);
    await mkdir(join(dir, "otro"));
    await writeFile(join(dir, "otro", "ajeno.json"), "{}");
    await symlink(join(dir, "otro"), join(dir, "datos", "enlace"));
    expect(await store.list("enlace/")).toEqual([]);
  });
});
