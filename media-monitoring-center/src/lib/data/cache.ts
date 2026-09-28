/**
 * Caché en memoria con TTL y deduplicación de consultas en vuelo.
 * Evita volver a consultar BigQuery (o regenerar el mock) cada vez que el usuario cambia
 * de pantalla. En Netlify vive mientras la función esté caliente; el costo de un "cold start"
 * es una consulta, nunca un error.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 500;

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) {
        // Descarta las entradas más antiguas.
        const oldest = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires).slice(0, Math.ceil(MAX_ENTRIES / 5));
        oldest.forEach(([k]) => store.delete(k));
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Lectura directa (sin ejecutar nada) y escritura manual: útil para cachear por fecha tras una consulta en lote. */
export function peek<T>(key: string): T | undefined {
  const hit = store.get(key) as Entry<T> | undefined;
  return hit && hit.expires > Date.now() ? hit.value : undefined;
}

export function put<T>(key: string, value: T, ttlMs: number) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function invalidate(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export function invalidateMatching(predicate: (key: string) => boolean) {
  for (const k of store.keys()) if (predicate(k)) store.delete(k);
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
