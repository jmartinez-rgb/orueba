import "server-only";

/**
 * Freno a intentos de acceso por fuerza bruta (por IP enmascarada + usuario).
 * Es en memoria (por instancia del servidor): complementa, no reemplaza, contraseñas largas.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60 * 1000;
/** Tope de memoria por instancia. Llenarlo nunca reinicia los contadores vigentes. */
export const MAX_TRACKED_KEYS = 20_000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

const g = globalThis as unknown as { __immcLoginAttempts?: Map<string, Entry> };
const attempts = (): Map<string, Entry> => (g.__immcLoginAttempts ??= new Map<string, Entry>());

export function loginKey(ip: string | null, username: string) {
  return `${ip ?? "?"}|${username}`;
}

export function isLocked(key: string, now = Date.now()): { locked: boolean; retryInMin: number } {
  const e = attempts().get(key);
  if (!e || e.lockedUntil <= now) return { locked: false, retryInMin: 0 };
  return { locked: true, retryInMin: Math.ceil((e.lockedUntil - now) / 60000) };
}

export function registerFailure(key: string, now = Date.now()): { locked: boolean } {
  const map = attempts();
  const e = map.get(key) ?? { failures: [], lockedUntil: 0 };
  e.failures = e.failures.filter((t) => now - t < WINDOW_MS).concat(now);
  if (e.failures.length >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.failures = [];
  }
  // Reinsertar mantiene el orden por último fallo (el Map conserva el orden de inserción).
  map.delete(key);
  map.set(key, e);
  if (map.size > MAX_TRACKED_KEYS) prune(map, now);
  return { locked: e.lockedUntil > now };
}

/**
 * Antes se vaciaba todo el mapa al superar el tope, lo que permitía reiniciar el contador de una
 * cuenta enviando fallos con usuarios inventados. Ahora se descartan primero las entradas vencidas
 * y, si aún sobra, las de fallo más antiguo sin bloqueo vigente.
 */
function prune(map: Map<string, Entry>, now: number) {
  for (const [key, e] of map) if (e.lockedUntil <= now && e.failures.every((t) => now - t >= WINDOW_MS)) map.delete(key);
  for (const [key, e] of map) {
    if (map.size <= MAX_TRACKED_KEYS) return;
    if (e.lockedUntil <= now) map.delete(key);
  }
  for (const key of map.keys()) {
    if (map.size <= MAX_TRACKED_KEYS) return;
    map.delete(key);
  }
}

export function registerSuccess(key: string) {
  attempts().delete(key);
}
