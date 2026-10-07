import pg from "pg";
import { ConfigError } from "./env.js";
import { ROTATING_TOKENS, type RotatingToken } from "./token-store.js";

/**
 * Same contract as TOKEN_STORE_FILE for hosts without a persistent disk (Replit): the refresh tokens that
 * Microsoft and Spotify rotate live in PostgreSQL (DATABASE_URL, TLS per its sslmode) and win at startup.
 * Values are never logged or returned; errors carry no cause.
 */
const TABLE =
  "CREATE TABLE IF NOT EXISTS api_rotated_tokens (name text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())";

const pools = new Map<string, { pool: pg.Pool; ready: Promise<unknown> }>();

function connect(url: string) {
  let entry = pools.get(url);
  if (!entry) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    pool.on("error", () => undefined);
    const ready = pool.query(TABLE);
    // A failed first connection is not cached: the next read or write retries with a new pool.
    ready.catch(() => {
      if (pools.get(url)?.pool === pool) pools.delete(url);
      void pool.end().catch(() => undefined);
    });
    entry = { pool, ready };
    pools.set(url, entry);
  }
  return entry;
}

export async function readPostgresTokenStore(url: string): Promise<Partial<Record<RotatingToken, string>>> {
  try {
    const { pool, ready } = connect(url);
    await ready;
    const { rows } = await pool.query<{ name: string; value: string }>(
      "SELECT name, value FROM api_rotated_tokens WHERE name = ANY($1::text[])",
      [[...ROTATING_TOKENS]],
    );
    const out: Partial<Record<RotatingToken, string>> = {};
    for (const row of rows) {
      const value = row.value.trim();
      if ((ROTATING_TOKENS as readonly string[]).includes(row.name) && value && !/[\r\n]/.test(value))
        out[row.name as RotatingToken] = value;
    }
    return out;
  } catch {
    // Continuing with the panel token could reuse one that was already rotated: stop instead.
    throw new ConfigError(["No se pudo leer el almacén de tokens en PostgreSQL (DATABASE_URL)."]);
  }
}

let queue: Promise<void> = Promise.resolve();

/** Upserts one rotated token; writes are serialized like the file store. */
export function savePostgresRotatedToken(url: string, name: RotatingToken, value: string): Promise<void> {
  if (!value || /[\r\n]/.test(value)) return Promise.reject(new Error("Token inválido."));
  const write = async () => {
    const { pool, ready } = connect(url);
    await ready;
    await pool.query(
      "INSERT INTO api_rotated_tokens (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [name, value],
    );
  };
  const next = queue.then(write, write);
  queue = next.catch(() => undefined);
  return next;
}

/** Only for tests and orderly shutdown. */
export async function closeTokenStorePools(): Promise<void> {
  const entries = [...pools.values()];
  pools.clear();
  await Promise.allSettled(entries.map((entry) => entry.pool.end()));
}
