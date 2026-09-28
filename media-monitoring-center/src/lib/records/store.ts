import "server-only";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { logger, recordIntegrationEvent } from "@/lib/logging/logger";

/**
 * Registros operativos de la app que no son métricas: bitácora de accesos y actividad,
 * tickets, acuses de alertas críticas, mensajes de monitoreo y configuración compartida.
 *
 * Backend (automático):
 * - Netlify Blobs cuando corre en Netlify (persistente entre despliegues, sin configurar nada).
 * - Archivos en `.data/records` en desarrollo local (ignorado por git).
 * - Memoria como último recurso (se pierde al reiniciar).
 * Las métricas NUNCA se guardan aquí: su única fuente es BigQuery.
 */

export type RecordBackend = "netlify-blobs" | "file" | "memory";

export interface RecordStore {
  readonly backend: RecordBackend;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
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
    this.map.set(key, JSON.stringify(value));
  }
  async delete(key: string) {
    this.map.delete(key);
  }
  async list(prefix: string) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── Archivos (desarrollo local) ─────────────────────────────────────────────
class FileRecordStore implements RecordStore {
  readonly backend = "file" as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    const parts = key.split("/").map((p) => encodeURIComponent(p));
    return path.join(this.root, ...parts) + ".json";
  }
  async get<T>(key: string) {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8")) as T;
    } catch {
      return null;
    }
  }
  async set(key: string, value: unknown) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify(value), "utf8");
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string, rel: string[]) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(dir, e.name), [...rel, decodeURIComponent(e.name)]);
        else if (e.name.endsWith(".json")) out.push([...rel, decodeURIComponent(e.name.slice(0, -5))].join("/"));
      }
    };
    // Solo se recorre el directorio del primer segmento del prefijo.
    const first = prefix.split("/")[0];
    await walk(path.join(this.root, encodeURIComponent(first)), [first]);
    return out.filter((k) => k.startsWith(prefix));
  }
}

// ── Netlify Blobs ───────────────────────────────────────────────────────────
class BlobsRecordStore implements RecordStore {
  readonly backend = "netlify-blobs" as const;
  private readonly fallback = new MemoryRecordStore();
  private store() {
    return getStore({ name: "immc-records", consistency: "strong" });
  }
  private fail(action: string, err: unknown) {
    logger.error("records.blobs_failed", { action, error: err });
    recordIntegrationEvent({ target: "api", action: `records.${action}`, ok: false, durationMs: null, detail: err instanceof Error ? err.message : String(err) });
  }
  async get<T>(key: string) {
    try {
      const v = (await this.store().get(key, { type: "json" })) as T | null;
      return v ?? (await this.fallback.get<T>(key));
    } catch (err) {
      this.fail("get", err);
      return this.fallback.get<T>(key);
    }
  }
  async set(key: string, value: unknown) {
    try {
      await this.store().setJSON(key, value);
    } catch (err) {
      this.fail("set", err);
      await this.fallback.set(key, value);
    }
  }
  async delete(key: string) {
    try {
      await this.store().delete(key);
    } catch (err) {
      this.fail("delete", err);
    }
    await this.fallback.delete(key);
  }
  async list(prefix: string) {
    try {
      const { blobs } = await this.store().list({ prefix });
      const keys = new Set(blobs.map((b) => b.key));
      for (const k of await this.fallback.list(prefix)) keys.add(k);
      return [...keys];
    } catch (err) {
      this.fail("list", err);
      return this.fallback.list(prefix);
    }
  }
}

let instance: RecordStore | null = null;

function hasBlobsContext() {
  return Boolean(g.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT);
}

export function getRecordStore(): RecordStore {
  if (instance) return instance;
  const forced = (process.env.RECORDS_BACKEND ?? "").toLowerCase();
  if (forced === "memory") instance = new MemoryRecordStore();
  else if (forced === "blobs" || (forced === "" && hasBlobsContext())) instance = new BlobsRecordStore();
  else if (forced === "file" || process.env.RECORDS_DIR || process.env.NODE_ENV !== "production") {
    instance = new FileRecordStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.RECORDS_DIR ?? ".data/records"));
  } else instance = new MemoryRecordStore();
  return instance;
}

export const RECORD_BACKEND_LABEL: Record<RecordBackend, string> = {
  "netlify-blobs": "Netlify Blobs (persistente)",
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
