import "server-only";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { logger, recordIntegrationEvent } from "@/lib/logging/logger";
import { RecordStoreError, assertSyncValue, serialize, type RecordStore } from "./store";

/**
 * PostgreSQL backend for hosts without a persistent disk (Replit deployments). One key/value table
 * holds every namespace: "records" (operational records and Absolute Top) and "unified" (direct-API
 * history). Values are stored as the exact JSON text, not jsonb, so key order and numbers round-trip
 * like the file backend (Absolute Top compares stored audits textually). TLS follows the connection
 * string (`sslmode`); it is never disabled here.
 */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS immc_kv (namespace text NOT NULL, key text NOT NULL, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (namespace, key))",
  "CREATE TABLE IF NOT EXISTS immc_locks (name text PRIMARY KEY, holder text NOT NULL, expires_at timestamptz NOT NULL)",
];

const g = globalThis as unknown as { __immcPostgres?: Map<string, { pool: Pool; ready: Promise<void> }> };

export function postgresUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

/** One pool per connection string and process; the schema is created once, idempotently. */
export function postgresPool(url = postgresUrl()): { pool: Pool; ready: Promise<void> } {
  if (!url) throw new RecordStoreError();
  g.__immcPostgres ??= new Map();
  let entry = g.__immcPostgres.get(url);
  if (!entry) {
    // allowExitOnIdle: one-shot commands (sync, reconciliation) end as soon as their queries finish.
    const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, allowExitOnIdle: true });
    // An idle client error must not crash the process; the next query reports it as unavailable.
    pool.on("error", () => logger.error("records.postgres_idle_error", { code: "RECORDS_UNAVAILABLE" }));
    const ready = (async () => { for (const statement of SCHEMA) await pool.query(statement); })();
    // A failed first connection is not cached: the next operation retries with a new pool.
    ready.catch(() => {
      if (g.__immcPostgres?.get(url)?.pool === pool) g.__immcPostgres.delete(url);
      void pool.end().catch(() => undefined);
    });
    entry = { pool, ready };
    g.__immcPostgres.set(url, entry);
  }
  return entry;
}

/** Only for tests: closes every pool of this process. */
export async function closePostgresPools() {
  const entries = [...(g.__immcPostgres?.values() ?? [])];
  g.__immcPostgres?.clear();
  await Promise.allSettled(entries.map(entry => entry.pool.end()));
}

export class PostgresRecordStore implements RecordStore {
  readonly backend = "postgres" as const;
  constructor(private readonly namespace: string, private readonly url = postgresUrl()) {
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(namespace)) throw new RecordStoreError();
  }
  private fail(action: string): never {
    logger.error("records.postgres_failed", { action, code: "RECORDS_UNAVAILABLE" });
    recordIntegrationEvent({ target: "api", action: `records.${action}`, ok: false, durationMs: null, detail: "RECORDS_UNAVAILABLE" });
    throw new RecordStoreError();
  }
  private async connection() {
    try {
      const { pool, ready } = postgresPool(this.url);
      await ready;
      return pool;
    } catch { return this.fail("connect"); }
  }
  async get<T>(key: string): Promise<T | null> {
    const pool = await this.connection();
    let rows: Array<{ value: string }>;
    try { rows = (await pool.query<{ value: string }>("SELECT value FROM immc_kv WHERE namespace = $1 AND key = $2", [this.namespace, key])).rows; }
    catch { return this.fail("get"); }
    if (!rows.length) return null;
    try { return JSON.parse(rows[0].value) as T; } catch { return this.fail("get_parse"); }
  }
  /** Takes the same per-key lock as update, so a plain write never lands inside a read-modify-write. */
  async set(key: string, value: unknown) {
    const text = serialize(value);
    const pool = await this.connection();
    let client;
    try { client = await pool.connect(); } catch { return this.fail("set_connect"); }
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.namespace}:${key}`]);
      await client.query("INSERT INTO immc_kv (namespace, key, value) VALUES ($1, $2, $3) ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [this.namespace, key, text]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      this.fail("set");
    } finally { client.release(); }
  }
  /**
   * Serialized per key with a transaction-scoped advisory lock (valid for absent keys and behind
   * transaction-mode poolers). The transform runs once per call; its own errors propagate unchanged.
   */
  async update<T>(key: string, transform: (current: T | null) => T | null): Promise<T | null> {
    const pool = await this.connection();
    let client;
    try { client = await pool.connect(); } catch { return this.fail("update_connect"); }
    let open = false;
    try {
      let current: T | null;
      try {
        await client.query("BEGIN");
        open = true;
        // Namespaces cannot contain ":", so namespace:key is unambiguous (text values cannot hold NUL).
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.namespace}:${key}`]);
        const rows = (await client.query<{ value: string }>("SELECT value FROM immc_kv WHERE namespace = $1 AND key = $2", [this.namespace, key])).rows;
        current = rows.length ? (JSON.parse(rows[0].value) as T) : null;
      } catch { return this.fail("update_read"); }
      // Domain errors from the transform propagate unchanged and roll the transaction back.
      const next = transform(current);
      assertSyncValue(next);
      try {
        await client.query("INSERT INTO immc_kv (namespace, key, value) VALUES ($1, $2, $3) ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [this.namespace, key, serialize(next)]);
        await client.query("COMMIT");
        open = false;
      } catch { return this.fail("update_write"); }
      return next;
    } finally {
      if (open) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }
  async delete(key: string) {
    const pool = await this.connection();
    try { await pool.query("DELETE FROM immc_kv WHERE namespace = $1 AND key = $2", [this.namespace, key]); }
    catch { this.fail("delete"); }
  }
  async list(prefix: string) {
    const pool = await this.connection();
    try {
      const { rows } = await pool.query<{ key: string }>("SELECT key FROM immc_kv WHERE namespace = $1 AND left(key, length($2)) = $2 ORDER BY key", [this.namespace, prefix]);
      return rows.map(row => row.key);
    } catch { return this.fail("list"); }
  }
  /**
   * Cross-process lease lock (one extractor at a time). A lease row survives poolers; it is renewed
   * while held and expires on its own if the holder dies, so a crash never blocks extraction forever.
   * Returns null when another live holder has it.
   */
  async lease(name: string, ttlMs = 15 * 60_000): Promise<(() => Promise<void>) | null> {
    const pool = await this.connection();
    const holder = randomUUID(), lockName = `${this.namespace}:${name}`;
    const claim = async () => (await pool.query<{ holder: string }>(
      "INSERT INTO immc_locks (name, holder, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at WHERE immc_locks.expires_at < now() OR immc_locks.holder = EXCLUDED.holder RETURNING holder",
      [lockName, holder, ttlMs / 1000],
    )).rows[0]?.holder === holder;
    let acquired: boolean;
    try { acquired = await claim(); } catch { return this.fail("lease"); }
    if (!acquired) return null;
    // Renewal only extends a row this holder still owns: it can never recreate a released or taken-over lock.
    let released = false, renewing: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => {
      if (released) return;
      renewing = pool.query("UPDATE immc_locks SET expires_at = now() + make_interval(secs => $3) WHERE name = $1 AND holder = $2", [lockName, holder, ttlMs / 1000]).catch(() => undefined);
    }, Math.max(1000, Math.floor(ttlMs / 3)));
    timer.unref();
    return async () => {
      released = true;
      clearInterval(timer);
      await renewing;
      try { await pool.query("DELETE FROM immc_locks WHERE name = $1 AND holder = $2", [lockName, holder]); }
      catch { this.fail("lease_release"); }
    };
  }
}
