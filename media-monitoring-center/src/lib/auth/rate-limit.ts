import "server-only";

/**
 * Freno a intentos de acceso por fuerza bruta (por IP enmascarada + usuario).
 * Es en memoria (por instancia del servidor): complementa, no reemplaza, contraseñas largas.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60 * 1000;

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
  map.set(key, e);
  if (map.size > 5000) map.clear();
  return { locked: e.lockedUntil > now };
}

export function registerSuccess(key: string) {
  attempts().delete(key);
}
