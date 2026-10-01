import { ApiError, isApiError } from "../../utils/errors.js";
import { metaObject } from "./types.js";

const rateCodes = new Set([4, 17, 32, 341, 613, 80000, 80004]);
function usageWait(headers: Headers): number | null {
  const header = headers.get("x-business-use-case-usage");
  if (!header || header.length > 65536) return null;
  try {
    const usage: unknown = JSON.parse(header);
    if (!metaObject(usage)) return null;
    const waits = Object.values(usage)
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .filter(metaObject)
      .map((value) => value.estimated_time_to_regain_access)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    return waits.length ? Math.ceil(Math.max(...waits) * 60) : null;
  } catch {
    return null;
  }
}
export function isMetaRetryable(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === "RATE_LIMITED" ||
      error.code === "PROVIDER_TIMEOUT" ||
      (error.code === "PROVIDER_ERROR" && metaObject(error.details) && error.details.transient === true))
  );
}
export function metaError(status: number, body: unknown, headers: Headers): ApiError {
  const raw = metaObject(body) && metaObject(body.error) ? body.error : {};
  const code = typeof raw.code === "number" ? raw.code : null;
  const subcode = typeof raw.error_subcode === "number" ? raw.error_subcode : null;
  // No propagamos message/error_user_msg: Meta puede incluir el token o la URL de la llamada.
  const details = {
    provider: "meta",
    meta_code: code,
    meta_subcode: subcode,
    ...(typeof raw.fbtrace_id === "string" && /^[\w-]{1,100}$/.test(raw.fbtrace_id)
      ? { trace_id: raw.fbtrace_id }
      : {}),
  };
  const opts = {
    details: { ...details, transient: code === 1 || code === 2 || raw.is_transient === true || status >= 500 },
  };
  if (code === 190 || code === 102 || status === 401)
    return new ApiError("AUTH_ERROR", "El token de Meta no es válido, venció o fue revocado. Genera uno nuevo.", opts);
  if (
    code === 100 &&
    typeof raw.message === "string" &&
    /\bbusiness_management\b/.test(raw.message) &&
    /permission/i.test(raw.message)
  )
    return new ApiError(
      "ACCESS_DENIED",
      "Meta requiere business_management para consultar metadatos del negocio. Puedes omitirlos y mantener la lectura publicitaria con ads_read.",
      { details: { ...opts.details, required_permission: "business_management" } },
    );
  if ((code !== null && rateCodes.has(code)) || status === 429) {
    const rawWait = headers.get("retry-after");
    const seconds =
      rawWait === null
        ? null
        : /^\d+(?:\.\d+)?$/.test(rawWait)
          ? Number(rawWait)
          : Math.max(0, (Date.parse(rawWait) - Date.now()) / 1000);
    return new ApiError(
      "RATE_LIMITED",
      "Meta alcanzó su límite de solicitudes. Reintenta después de la espera indicada.",
      {
        ...opts,
        retryAfter:
          Math.max(seconds !== null && Number.isFinite(seconds) ? Math.ceil(seconds) : 0, usageWait(headers) ?? 0) ||
          null,
      },
    );
  }
  if (code === 3 || code === 10 || (code !== null && code >= 200 && code <= 299) || status === 403)
    return new ApiError(
      "ACCESS_DENIED",
      "Meta requiere permiso ads_read, acceso a la cuenta o revisión de la app para este uso.",
      opts,
    );
  if (code === 1 || code === 2 || raw.is_transient === true || status >= 500)
    return new ApiError("PROVIDER_ERROR", "Meta respondió con un fallo transitorio.", opts);
  if (code === 100 || status === 400 || status === 404)
    return new ApiError("INVALID_REQUEST", "Meta rechazó la cuenta, los campos o los parámetros solicitados.", opts);
  return new ApiError("PROVIDER_ERROR", "Meta devolvió un error de la plataforma.", opts);
}

/** Solo fallos de permisos de una cuenta permiten conservar datos de las demás. */
export function metaAccountWarning(error: unknown, accountId: string): ApiError | null {
  if (!isApiError(error) || error.code !== "ACCESS_DENIED") return null;
  return new ApiError(error.code, error.message, {
    details: {
      ...(metaObject(error.details) ? error.details : {}),
      account_id: accountId,
      partial_data: true,
    },
  });
}
