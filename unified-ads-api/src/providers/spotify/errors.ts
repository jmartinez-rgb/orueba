import { ApiError, isApiError } from "../../utils/errors.js";
import { object } from "./config.js";

export function spotifyError(status: number, body: unknown, headers: Headers): ApiError {
  const details = { provider: "spotify", http_status: status };
  if (status === 401)
    return new ApiError("AUTH_ERROR", "Spotify requiere renovar el token o volver a autorizar la app.", { details });
  if (status === 403) {
    // Only classify known onboarding conditions; arbitrary vendor messages never enter API output or logs.
    const messages =
      object(body) && Array.isArray(body.messages)
        ? body.messages.filter((v): v is string => typeof v === "string")
        : [];
    const onboarding = messages.some((m) =>
      /terms (?:and conditions|of service)|accept.*terms|client.*(?:allowlist|whitelist)|(?:allowlist|whitelist).*client|app.*not.*(?:approved|authorized)/i.test(
        m,
      ),
    );
    return onboarding
      ? new ApiError(
          "ACCESS_REQUIRED",
          "Spotify requiere aceptar los términos de Ads API y habilitar el cliente; puede tardar hasta una hora.",
          { details },
        )
      : new ApiError("ACCESS_DENIED", "Spotify Ads no permite consultar la cuenta o el negocio solicitado.", {
          details,
        });
  }
  if (status === 429) {
    const raw = headers.get("retry-after");
    const parsed = raw
      ? /^\d+(?:\.\d+)?$/.test(raw)
        ? Number(raw)
        : (Date.parse(raw) - Date.now()) / 1000
      : Number(headers.get("x-ratelimit-reset") ?? NaN);
    return new ApiError("RATE_LIMITED", "Spotify Ads limitó las solicitudes. Intenta más tarde.", {
      details,
      retryAfter: Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : null,
    });
  }
  if ([400, 404, 409, 422].includes(status))
    return new ApiError("INVALID_REQUEST", "Spotify Ads rechazó la cuenta o los parámetros de consulta.", { details });
  return new ApiError("PROVIDER_ERROR", "Spotify Ads no pudo completar la consulta.", {
    details: { ...details, transient: status >= 500 },
  });
}
export function isSpotifyRetryable(err: unknown) {
  return (
    isApiError(err) &&
    (err.code === "RATE_LIMITED" ||
      (err.code === "PROVIDER_ERROR" && object(err.details) && err.details.transient === true))
  );
}
export function spotifyAccountWarning(err: unknown, id: string): ApiError | null {
  if (!isApiError(err) || !object(err.details)) return null;
  if (err.code !== "ACCESS_DENIED" && !(err.code === "INVALID_REQUEST" && err.details.http_status === 404)) return null;
  return new ApiError(err.code, err.message, { details: { provider: "spotify", account_id: id } });
}
