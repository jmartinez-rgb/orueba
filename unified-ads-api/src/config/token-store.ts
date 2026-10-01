import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { updateEnvVariable } from "../providers/google/oauth.js";

/**
 * Refresh tokens que las plataformas rotan en cada renovación (Microsoft siempre; Spotify a veces).
 * Si no se guarda el nuevo, al reiniciar el servicio vuelve a usar el original, que vence aunque la
 * integración se use a diario (Microsoft: 90 días desde que se emitió). Con TOKEN_STORE_FILE el
 * token nuevo se escribe en un archivo privado (0600, escritura atómica) y gana al arrancar.
 * Nunca se registra ni se devuelve el valor.
 */
export const ROTATING_TOKENS = ["MICROSOFT_ADS_REFRESH_TOKEN", "SPOTIFY_ADS_REFRESH_TOKEN"] as const;
export type RotatingToken = (typeof ROTATING_TOKENS)[number];

/** Valores guardados (solo los tokens rotativos admitidos); vacío si el archivo no existe. */
export function readTokenStore(path: string): Partial<Record<RotatingToken, string>> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return {};
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
  const write = async () => {
    const content = await readFile(path, "utf8").catch(() => "");
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, updateEnvVariable(content, name, value), { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  };
  const next = queue.then(write, write);
  queue = next.catch(() => undefined);
  return next;
}
