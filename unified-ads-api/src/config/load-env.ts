import { config as loadDotenv } from "dotenv";
import { applyTokenStore, type RotatingToken } from "./token-store.js";

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
