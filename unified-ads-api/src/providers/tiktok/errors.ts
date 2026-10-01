import { ApiError, isApiError } from "../../utils/errors.js";
import { tiktokObject } from "./types.js";

const RATE_CODES = new Set([40016, 40100, 40132, 40133]);
const AUTH_CODES = new Set([40101, 40102, 40103, 40104, 40105, 40106, 40107, 40108, 40110, 40131]);
const INVALID_CODES = new Set([40000, 40002, 40006, 40007, 40008, 40009, 40010, 40011, 40013, 40014, 40051]);
export function tiktokError(status: number, body: unknown, headers: Headers): ApiError {
  const code = tiktokObject(body) && typeof body.code === "number" ? body.code : null;
  const raw = headers.get("retry-after");
  const after = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - Date.now()) / 1000 : NaN;
  const retryAfter = Number.isFinite(after) ? Math.max(0, Math.ceil(after)) : null;
  // No devolvemos message/subcode/request_id ni URL: pueden repetir secretos o parámetros privados.
  const details = { provider: "tiktok", tiktok_code: code, http_status: status };
  // Los códigos del cuerpo tienen prioridad sobre HTTP según el contrato de TikTok.
  const http = code === null || code === 0 ? status : null;
  if ((code !== null && AUTH_CODES.has(code)) || http === 401)
    return new ApiError("AUTH_ERROR", "El token o las credenciales de TikTok no son válidos. Revisa la autorización.", {
      details,
    });
  if (code === 40001 || http === 403)
    return new ApiError("ACCESS_DENIED", "TikTok no permite leer esta cuenta o falta un permiso de la app.", {
      details,
    });
  if ((code !== null && RATE_CODES.has(code)) || http === 429)
    return new ApiError("RATE_LIMITED", "TikTok limitó las solicitudes. Intenta de nuevo más tarde.", {
      details,
      retryAfter,
    });
  if ((code !== null && INVALID_CODES.has(code)) || http === 400 || http === 404)
    return new ApiError("INVALID_REQUEST", "TikTok rechazó los parámetros o la ruta de consulta.", { details });
  const transient = (code !== null && code >= 50000 && code < 60000) || (http !== null && http >= 500);
  return new ApiError(
    "PROVIDER_ERROR",
    code === 20001
      ? "TikTok devolvió un resultado parcialmente exitoso que no permite confirmar la lectura completa."
      : "TikTok no pudo completar la consulta.",
    { details: { ...details, transient } },
  );
}
export function isTikTokRetryable(err: unknown): boolean {
  return (
    isApiError(err) &&
    (err.code === "RATE_LIMITED" ||
      (err.code === "PROVIDER_ERROR" && tiktokObject(err.details) && err.details.transient === true))
  );
}
export function tiktokAccountWarning(err: unknown, id: string): ApiError | null {
  if (!isApiError(err) || !["ACCESS_DENIED", "INVALID_REQUEST"].includes(err.code)) return null;
  // Errores de parámetros generales son globales, no una cuenta sin permisos.
  if (err.code === "INVALID_REQUEST" && !(tiktokObject(err.details) && err.details.tiktok_code === 40007)) return null;
  return new ApiError(err.code, err.message, {
    details: { provider: "tiktok", account_id: id },
    retryAfter: err.retryAfter,
  });
}
