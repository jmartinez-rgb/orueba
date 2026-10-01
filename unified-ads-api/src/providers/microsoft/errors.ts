import { ApiError, isApiError } from "../../utils/errors.js";
import { object } from "./config.js";

interface VendorError {
  code: number;
  symbol: string | null;
}
export function microsoftErrors(body: unknown, depth = 0): VendorError[] {
  if (depth > 5) return [];
  if (Array.isArray(body)) return body.flatMap((v) => microsoftErrors(v, depth + 1));
  if (!object(body)) return [];
  if (typeof body.Code === "number" && Number.isInteger(body.Code))
    return [{ code: body.Code, symbol: typeof body.ErrorCode === "string" ? body.ErrorCode : null }];
  return [
    "Errors",
    "OperationErrors",
    "AdApiErrors",
    "BatchErrors",
    "Detail",
    "ApiFaultDetail",
    "AdApiFaultDetail",
    "Error",
  ].flatMap((key) => microsoftErrors(body[key], depth + 1));
}
export function microsoftError(status: number, body: unknown, headers: Headers): ApiError {
  const errors = microsoftErrors(body),
    codes = errors.map((e) => e.code);
  const details = { provider: "microsoft", microsoft_codes: codes, http_status: status };
  // Body codes take precedence over HTTP (legacy faults can also arrive with HTTP 500).
  const http = codes.length ? null : status;
  if (codes.some((c) => [105, 108, 109, 120].includes(c)) || http === 401)
    return new ApiError(
      "AUTH_ERROR",
      "Las credenciales de Microsoft Advertising no son válidas o requieren autorización.",
      { details },
    );
  if (codes.some((c) => [106, 2003].includes(c)) || http === 403)
    return new ApiError("ACCESS_DENIED", "Microsoft Advertising no permite consultar esta cuenta.", { details });
  if (codes.includes(117) || errors.some((e) => e.symbol === "ConcurrentRequestOverLimit") || http === 429) {
    const raw = headers.get("retry-after");
    const after = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000) : NaN;
    return new ApiError("RATE_LIMITED", "Microsoft Advertising limitó las solicitudes. Intenta más tarde.", {
      details,
      retryAfter: Number.isFinite(after) ? Math.max(0, Math.ceil(after)) : null,
    });
  }
  if (codes.includes(2004))
    return new ApiError(
      "PROVIDER_ERROR",
      "Microsoft aún no dispone de datos completos para ese periodo. Consulta más tarde.",
      { details },
    );
  if (codes.includes(208) || (codes.length && !codes.includes(0)) || http === 400 || http === 404)
    return new ApiError("INVALID_REQUEST", "Microsoft Advertising rechazó la cuenta o los parámetros de consulta.", {
      details,
    });
  return new ApiError("PROVIDER_ERROR", "Microsoft Advertising no pudo completar la consulta.", {
    details: { ...details, transient: codes.includes(0) || (http !== null && http >= 500) },
  });
}
export function isMicrosoftRetryable(err: unknown): boolean {
  return (
    isApiError(err) &&
    (err.code === "RATE_LIMITED" ||
      (err.code === "PROVIDER_ERROR" && object(err.details) && err.details.transient === true))
  );
}
export function expiredAccessToken(err: unknown): boolean {
  return (
    isApiError(err) &&
    err.code === "AUTH_ERROR" &&
    object(err.details) &&
    (err.details.http_status === 401 ||
      (Array.isArray(err.details.microsoft_codes) && err.details.microsoft_codes.includes(109)))
  );
}
export function microsoftAccountWarning(err: unknown, id: string): ApiError | null {
  if (!isApiError(err) || !object(err.details)) return null;
  const codes = err.details.microsoft_codes;
  if (err.code !== "ACCESS_DENIED" && !(Array.isArray(codes) && codes.includes(208))) return null;
  return new ApiError(err.code, err.message, { details: { provider: "microsoft", account_id: id } });
}
