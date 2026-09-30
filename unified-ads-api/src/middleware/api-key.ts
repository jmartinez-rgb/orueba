import type { FastifyRequest } from "fastify";
import { ApiError } from "../utils/errors.js";
import { isValidApiKey } from "../utils/api-keys.js";

/** Rutas sin llave: salud del servicio y documentación. */
export const PUBLIC_PATHS = ["/api/v1/health", "/docs"];

export function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Autenticación interna por encabezado X-API-Key (comparación en tiempo constante). */
export function apiKeyGuard(hashes: readonly Buffer[]) {
  return async function checkApiKey(req: FastifyRequest): Promise<void> {
    if (req.method === "OPTIONS" || isPublicPath(req.url)) return;
    const header = req.headers["x-api-key"];
    const key = Array.isArray(header) ? header[0] : header;
    if (!isValidApiKey(key, hashes)) throw new ApiError("AUTH_ERROR");
  };
}
