import { ApiError } from "../../utils/errors.js";
import { object } from "./config.js";
export function xError(status: number, body: unknown, headers = new Headers(), now = Date.now()) {
  const codes =
    object(body) && Array.isArray(body.errors)
      ? body.errors.flatMap((e) =>
          object(e) && typeof e.code === "string" && /^[A-Z_]{1,80}$/.test(e.code) ? [e.code] : [],
        )
      : [];
  const details = { provider: "x", transient: status === 429 || status >= 500 };
  const retry = headers.get("retry-after");
  const reset = headers.get("x-account-rate-limit-reset") ?? headers.get("x-rate-limit-reset");
  const hinted =
    retry && /^\d+(?:\.\d+)?$/.test(retry)
      ? Number(retry)
      : retry && Number.isFinite(Date.parse(retry))
        ? Math.max(0, (Date.parse(retry) - now) / 1000)
        : reset && /^\d+$/.test(reset)
          ? Math.max(0, Number(reset) - now / 1000)
          : null;
  if (status === 429 || codes.includes("TOO_MANY_REQUESTS"))
    return new ApiError("RATE_LIMITED", "X Ads alcanzó su límite de solicitudes.", { retryAfter: hinted, details });
  if (status === 401) return new ApiError("AUTH_ERROR", "X Ads rechazó la autorización OAuth.", { details });
  if (codes.includes("READONLY_CLIENT_APPLICATION") || codes.includes("UNAUTHORIZED_CLIENT_APPLICATION"))
    return new ApiError("ACCESS_REQUIRED", "X Ads requiere habilitación o permisos adicionales de la aplicación.", {
      details,
    });
  if (status === 403 || status === 404)
    return new ApiError("ACCESS_DENIED", "La identidad de X Ads no puede leer este recurso.", { details });
  if (status === 400)
    return new ApiError("INVALID_REQUEST", "X Ads rechazó los parámetros de la consulta.", { details });
  return new ApiError("PROVIDER_ERROR", "X Ads no pudo completar la consulta.", { retryAfter: hinted, details });
}
export function xRetryable(e: unknown) {
  return (
    e instanceof ApiError &&
    (e.code === "RATE_LIMITED" || (e.code === "PROVIDER_ERROR" && object(e.details) && e.details.transient === true))
  );
}
