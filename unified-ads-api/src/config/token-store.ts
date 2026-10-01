import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { ConfigError } from "./env.js";
import { updateEnvFile } from "./env-file.js";

/**
 * Refresh tokens que las plataformas rotan en cada renovación (Microsoft siempre; Spotify a veces).
 * Si no se guarda el nuevo, al reiniciar el servicio vuelve a usar el original, que vence aunque la
 * integración se use a diario (Microsoft: 90 días desde que se emitió). Con TOKEN_STORE_FILE el
 * token nuevo se escribe en un archivo privado (0600, escritura atómica) y gana al arrancar.
 * Nunca se registra ni se devuelve el valor.
 */
export const ROTATING_TOKENS = ["MICROSOFT_ADS_REFRESH_TOKEN", "SPOTIFY_ADS_REFRESH_TOKEN"] as const;
export type RotatingToken = (typeof ROTATING_TOKENS)[number];

/**
 * Valores guardados (solo los tokens rotativos admitidos); vacío si el archivo aún no existe.
 * Si existe pero no se puede leer, se detiene: seguir con el token de .env usaría uno ya rotado y,
 * en la siguiente rotación, el archivo se reescribiría sin los demás tokens.
 */
export function readTokenStore(path: string): Partial<Record<RotatingToken, string>> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw new ConfigError([`No se pudo leer TOKEN_STORE_FILE (${code ?? "error de lectura"}).`]);
  }
  const values = parse(content);
  const out: Partial<Record<RotatingToken, string>> = {};
  for (const name of ROTATING_TOKENS) {
    const value = values[name]?.trim();
    if (value && !/[\r\n]/.test(value)) out[name] = value;
  }
  return out;
}

/** Los tokens guardados son más recientes que los de .env o el panel: los reemplazan al arrancar. */
export function applyTokenStore(env: NodeJS.ProcessEnv, path: string | undefined): RotatingToken[] {
  if (!path) return [];
  const stored = readTokenStore(path);
  for (const [name, value] of Object.entries(stored)) env[name] = value;
  return Object.keys(stored) as RotatingToken[];
}

let queue: Promise<void> = Promise.resolve();

/** Guarda un token rotado sin tocar las demás líneas del archivo. Las escrituras se serializan. */
export function saveRotatedToken(path: string, name: RotatingToken, value: string): Promise<void> {
  if (!value || /[\r\n]/.test(value)) return Promise.reject(new Error("Token inválido."));
  // Un fallo de lectura distinto de "no existe" rechaza la escritura en vez de borrar los demás tokens.
  const write = () => updateEnvFile(path, { [name]: value });
  const next = queue.then(write, write);
  queue = next.catch(() => undefined);
  return next;
}
