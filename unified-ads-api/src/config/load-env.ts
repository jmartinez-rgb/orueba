import { config as loadDotenv } from "dotenv";
import { applyTokenStore, type RotatingToken } from "./token-store.js";
import { readPostgresTokenStore } from "./token-store-postgres.js";

/**
 * Prepara el entorno antes de leer la configuración:
 * 1. .env completa lo que el entorno no trae. Una variable definida pero vacía (p. ej. creada vacía
 *    en un panel) ya no oculta el valor de .env, que es lo que pasaba con dotenv por omisión.
 * 2. Los refresh tokens rotados guardados en TOKEN_STORE_FILE son los más recientes y ganan.
 */
export function prepareEnv(
  env: NodeJS.ProcessEnv = process.env,
  fileValues: Record<string, string> = loadDotenv({ quiet: true, processEnv: {} }).parsed ?? {},
): { fromStore: RotatingToken[] } {
  for (const [name, value] of Object.entries(fileValues))
    if ((env[name] === undefined || env[name]!.trim() === "") && value.trim()) env[name] = value;
  return { fromStore: applyTokenStore(env, env.TOKEN_STORE_FILE?.trim() || undefined) };
}

/**
 * Igual que prepareEnv, pero con TOKEN_STORE=postgres lee los tokens rotados de DATABASE_URL (asíncrono).
 * Una base inaccesible detiene el arranque: seguir con el token del panel podría usar uno ya rotado.
 */
export async function prepareEnvAsync(
  env: NodeJS.ProcessEnv = process.env,
  fileValues: Record<string, string> = loadDotenv({ quiet: true, processEnv: {} }).parsed ?? {},
): Promise<{ fromStore: RotatingToken[] }> {
  const usePostgres = (env.TOKEN_STORE?.trim() || fileValues.TOKEN_STORE?.trim() || "").toLowerCase() === "postgres";
  if (!usePostgres) return prepareEnv(env, fileValues);
  for (const [name, value] of Object.entries(fileValues))
    if ((env[name] === undefined || env[name]!.trim() === "") && value.trim()) env[name] = value;
  const url = env.DATABASE_URL?.trim();
  // Sin URL o con TOKEN_STORE_FILE a la vez, loadConfig explica el error de configuración.
  if (!url || env.TOKEN_STORE_FILE?.trim()) return { fromStore: [] };
  const stored = await readPostgresTokenStore(url);
  for (const [name, value] of Object.entries(stored)) env[name] = value;
  return { fromStore: Object.keys(stored) as RotatingToken[] };
}
