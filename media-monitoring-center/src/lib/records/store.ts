import "server-only";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { logger, recordIntegrationEvent } from "@/lib/logging/logger";
import { withRecordWrite } from "./write-lock";
import { withFileLock } from "./file-lock";
import { checkedBlobsFetch } from "./blobs-fetch";
import { PostgresRecordStore } from "./postgres";

/**
 * Registros operativos de la app que no son métricas: bitácora de accesos y actividad,
 * tickets, acuses de alertas críticas, mensajes de monitoreo y configuración compartida.
 *
 * Backend (automático):
 * - Netlify Blobs cuando corre en Netlify (persistente entre despliegues, sin configurar nada).
 * - PostgreSQL con RECORDS_BACKEND=postgres y DATABASE_URL (Replit u otro host sin disco persistente).
 * - Archivos en `.data/records` en desarrollo local (ignorado por git).
 * - Memoria como último recurso (se pierde al reiniciar).
 * Las métricas de las APIs directas usan un directorio separado de los registros operativos.
 */

export type RecordBackend = "netlify-blobs" | "postgres" | "file" | "memory";

export class RecordStoreError extends Error {
  readonly code = "RECORDS_UNAVAILABLE";
  constructor() {
    super("No se pudo leer o guardar el almacenamiento persistente. El cambio no está confirmado.");
    this.name = "RecordStoreError";
  }
}

const missing = (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";

export interface RecordStore {
  readonly backend: RecordBackend;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /**
   * Read-modify-write on one key. Transform must be synchronous and pure: Blobs
   * may replay it after a conflict or a lost response. Append operations must
   * deduplicate an operation ID; this does not guarantee exactly-once execution.
   * Returning null stores JSON null (no delete).
   * Memory serializes inside this process. File adds a lock file between processes of the
   * same host (not between hosts sharing a network volume). Blobs uses conditional writes.
   */
  update<T>(key: string, transform: (current: T | null) => T | null): Promise<T | null>;
  delete(key: string): Promise<void>;
  /** Llaves que empiezan con el prefijo. */
  list(prefix: string): Promise<string[]>;
}

// ── Memoria ──────────────────────────────────────────────────────────────────
const g = globalThis as unknown as { __immcRecords?: Map<string, string>; netlifyBlobsContext?: unknown };

class MemoryRecordStore implements RecordStore {
  readonly backend = "memory" as const;
  private get map() {
    if (!g.__immcRecords) g.__immcRecords = new Map();
    return g.__immcRecords;
  }
  async get<T>(key: string) {
    const v = this.map.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown) {
    await withRecordWrite(`memory:${key}`, async () => { this.map.set(key, serialize(value)); });
  }
  async update<T>(key: string, transform: (current: T | null) => T | null): Promise<T | null> {
    return withRecordWrite(`memory:${key}`, async () => {
      const next = transform(await this.get<T>(key));
      assertSyncValue(next);
      this.map.set(key, serialize(next));
      return next;
    });
  }
  async delete(key: string) {
    await withRecordWrite(`memory:${key}`, async () => { this.map.delete(key); });
  }
  async list(prefix: string) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── Archivos (desarrollo local) ─────────────────────────────────────────────
export class FileRecordStore implements RecordStore {
  readonly backend = "file" as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    const parts = key.split("/").map((p) => p === "." || p === ".." ? p.replaceAll(".", "%2E") : encodeURIComponent(p));
    return path.join(this.root, ...parts) + ".json";
  }
  async get<T>(key: string) {
    let handle;
    try {
      // O_NOFOLLOW: a symlink planted in the data directory is never followed.
      handle = await open(this.file(key), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (missing(error)) return null;
      throw new RecordStoreError();
    }
    try {
      return JSON.parse(await handle.readFile("utf8")) as T;
    } catch {
      throw new RecordStoreError();
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  private scope(key: string) { return `file:${path.resolve(this.file(key))}`; }
  /**
   * In-process queue first, then a lock file next to the record: the server and the scripts
   * (separate Node processes on the same disk) cannot lose each other's updates.
   */
  private async locked<T>(key: string, write: (stillHeld: () => Promise<boolean>) => Promise<T>): Promise<T> {
    const f = this.file(key);
    return withRecordWrite(this.scope(key), async () => {
      try { await mkdir(path.dirname(f), { recursive: true, mode: 0o700 }); }
      catch { throw new RecordStoreError(); }
      let acquired = false;
      try {
        return await withFileLock(`${f}.lock`, (stillHeld) => { acquired = true; return write(stillHeld); });
      } catch (error) {
        // Domain errors from a transform propagate unchanged; lock failures are not confirmed writes.
        if (acquired) throw error;
        throw new RecordStoreError();
      }
    });
  }
  async set(key: string, value: unknown) {
    await this.locked(key, (stillHeld) => this.write(key, value, stillHeld));
  }
  async update<T>(key: string, transform: (current: T | null) => T | null): Promise<T | null> {
    return this.locked(key, async (stillHeld) => {
      const next = transform(await this.get<T>(key));
      assertSyncValue(next);
      await this.write(key, next, stillHeld);
      return next;
    });
  }
  private async write(key: string, value: unknown, stillHeld: () => Promise<boolean>) {
    const f = this.file(key);
    const temp = `${f}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(value), "utf8"); await file.sync(); }
      finally { await file.close(); }
      // Fencing: never publish if the lock was taken over as abandoned meanwhile.
      if (!(await stillHeld())) throw new RecordStoreError();
      await rename(temp, f);
      await syncDirectory(path.dirname(f));
    } catch {
      throw new RecordStoreError();
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
  async delete(key: string) {
    const f = this.file(key);
    await this.locked(key, async () => {
      try { await rm(f, { force: true }); await syncDirectory(path.dirname(f)); }
      catch { throw new RecordStoreError(); }
    });
  }
  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string, rel: string[]) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (missing(error)) return;
        throw new RecordStoreError();
      }
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(dir, e.name), [...rel, decodeURIComponent(e.name)]);
        else if (e.isFile() && e.name.endsWith(".json")) out.push([...rel, decodeURIComponent(e.name.slice(0, -5))].join("/"));
      }
    };
    // Solo se recorre el directorio del primer segmento del prefijo.
    const first = prefix.split("/")[0];
    const encoded = first === "." || first === ".." ? first.replaceAll(".", "%2E") : encodeURIComponent(first);
    const start = path.join(this.root, encoded);
    // A symlinked collection directory inside the root is never traversed.
    if (first) {
      try { if ((await lstat(start)).isSymbolicLink()) return []; }
      catch (error) { if (missing(error)) return []; throw new RecordStoreError(); }
    }
    await walk(start, first ? [first] : []);
    return out.filter((k) => k.startsWith(prefix));
  }
}

/** fsync of the directory makes the rename durable after a power loss. */
async function syncDirectory(dir: string) {
  const handle = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); }
  catch (error) {
    // Some filesystems cannot fsync a directory; the rename itself is still atomic.
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : "";
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally { await handle.close(); }
}

// ── Netlify Blobs ───────────────────────────────────────────────────────────
class BlobsRecordStore implements RecordStore {
  readonly backend = "netlify-blobs" as const;
  private store() {
    return getStore({ name: "immc-records", consistency: "strong", fetch: checkedBlobsFetch });
  }
  private fail(action: string): never {
    logger.error("records.blobs_failed", { action, code: "RECORDS_UNAVAILABLE" });
    recordIntegrationEvent({ target: "api", action: `records.${action}`, ok: false, durationMs: null, detail: "RECORDS_UNAVAILABLE" });
    throw new RecordStoreError();
  }
  async get<T>(key: string) {
    try {
      const v = (await this.store().get(key, { type: "json" })) as T | null;
      return v;
    } catch {
      return this.fail("get");
    }
  }
  async set(key: string, value: unknown) {
    try {
      await this.store().setJSON(key, value);
    } catch {
      this.fail("set");
    }
  }
  async update<T>(key: string, transform: (current: T | null) => T | null): Promise<T | null> {
    let store: ReturnType<typeof getStore>;
    try { store = this.store(); }
    catch { return this.fail("update_read"); }
    for (let attempt = 0; attempt < 5; attempt++) {
      let previous: { data: T | null; etag?: string } | null;
      try { previous = await store.getWithMetadata(key, { type: "json", consistency: "strong" }); }
      catch { return this.fail("update_read"); }
      if (previous !== null && (typeof previous !== "object" || !("data" in previous) || !validEtag(previous.etag))) return this.fail("update_read");
      // Domain errors must propagate unchanged; never include a transform in the
      // backend catch blocks, and never run side effects in a replayable transform.
      const next = transform(previous === null ? null : previous.data);
      assertSyncValue(next);
      let result: Awaited<ReturnType<typeof store.setJSON>>;
      try {
        result = await store.setJSON(key, next, previous === null ? { onlyIfNew: true } : { onlyIfMatch: previous.etag! });
      } catch { return this.fail("update_write"); }
      if (result?.modified === false) continue;
      // SDK 11.1.1 can return modified:true on non-412 HTTP failures. A missing
      // receipt ETag is not a confirmed write, even when modified is true.
      if (result?.modified !== true || !validEtag(result.etag)) return this.fail("update_write");
      return next;
    }
    return this.fail("update_conflict");
  }
  async delete(key: string) {
    try {
      await this.store().delete(key);
    } catch {
      this.fail("delete");
    }
  }
  async list(prefix: string) {
    try {
      const { blobs } = await this.store().list({ prefix });
      const keys = new Set(blobs.map((b) => b.key));
      return [...keys];
    } catch {
      return this.fail("list");
    }
  }
}

const validEtag = (etag: unknown): etag is string => typeof etag === "string" && etag.trim().length > 0;

export function assertSyncValue(value: unknown): void {
  if (value === undefined || (value !== null && typeof value === "object" && "then" in value && typeof value.then === "function")) throw new RecordStoreError();
  serialize(value);
}

export function serialize(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new RecordStoreError();
    return serialized;
  } catch { throw new RecordStoreError(); }
}

let instance: RecordStore | null = null;

function hasBlobsContext() {
  return Boolean(g.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT);
}

export function getRecordStore(): RecordStore {
  if (instance) return instance;
  const forced = (process.env.RECORDS_BACKEND ?? "").toLowerCase();
  if (forced === "memory") instance = new MemoryRecordStore();
  else if (forced === "postgres") instance = new PostgresRecordStore("records");
  else if (forced === "blobs" || (forced === "" && hasBlobsContext())) instance = new BlobsRecordStore();
  else if (forced === "file" || process.env.RECORDS_DIR || process.env.NODE_ENV !== "production") {
    instance = new FileRecordStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.RECORDS_DIR ?? ".data/records"));
  } else instance = new MemoryRecordStore();
  return instance;
}

export const RECORD_BACKEND_LABEL: Record<RecordBackend, string> = {
  "netlify-blobs": "Netlify Blobs (persistente)",
  postgres: "PostgreSQL (persistente)",
  file: "Archivos locales (.data/records)",
  memory: "Memoria del servidor (se reinicia)",
};

/** Solo para pruebas. */
export function resetRecordStore() {
  instance = null;
  g.__immcRecords = new Map();
}

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Marca de tiempo compacta y ordenable para llaves: 20260928T143012123Z. */
export function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:.]/g, "");
}

/** Ejecuta tareas con concurrencia limitada. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const immutableCache = new Map<string, unknown>();

/**
 * Lee registros inmutables (eventos) con caché en memoria: un evento nunca cambia,
 * así que solo se descargan las llaves nuevas.
 */
export async function readImmutable<T>(store: RecordStore, keys: string[]): Promise<T[]> {
  const missing = keys.filter((k) => !immutableCache.has(k));
  await mapLimit(missing, 16, async (k) => {
    const v = await store.get<T>(k);
    if (v !== null) immutableCache.set(k, v);
  });
  if (immutableCache.size > 5000) {
    const drop = [...immutableCache.keys()].slice(0, immutableCache.size - 4000);
    drop.forEach((k) => immutableCache.delete(k));
  }
  return keys.map((k) => immutableCache.get(k) as T | undefined).filter((v): v is T => v !== undefined);
}
