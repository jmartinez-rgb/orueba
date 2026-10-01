import { ApiError, isApiError, type ErrorCode } from "../../utils/errors.js";

const ACCESS_REQUIRED = new Set([
  "DEVELOPER_TOKEN_NOT_APPROVED",
  "DEVELOPER_TOKEN_NOT_ON_ALLOWLIST",
  "DEVELOPER_TOKEN_PROHIBITED",
  "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
  "CLOUD_PROJECT_NOT_UNDER_ORGANIZATION",
  "MISSING_TOS",
]);

/** Una cuenta inhabilitada no debe bloquear las demás; otros fallos siguen siendo fatales. */
export function unavailableAccountWarning(error: unknown, accountId: string): ApiError | null {
  if (!isApiError(error) || error.code !== "ACCESS_DENIED" || !error.details || typeof error.details !== "object")
    return null;
  const details = error.details as Record<string, unknown>;
  if (
    !Array.isArray(details.google_error_codes) ||
    !details.google_error_codes.length ||
    details.google_error_codes.some((code) => code !== "CUSTOMER_NOT_ENABLED")
  )
    return null;
  return new ApiError("ACCESS_DENIED", "Google Ads no permite consultar esta cuenta porque está inhabilitada.", {
    details: { ...details, account_id: accountId },
  });
}

/**
 * En una consulta de varias cuentas, una cuenta sin permiso (o inhabilitada) se reporta como
 * advertencia y no detiene a las demás. Si se pidió esa cuenta en específico, el error se devuelve.
 */
export function accountWarning(error: unknown, accountId: string): ApiError | null {
  if (!isApiError(error) || error.code !== "ACCESS_DENIED") return null;
  const details = error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : {};
  return new ApiError("ACCESS_DENIED", error.message, {
    details: { ...details, account_id: accountId, partial_data: true },
  });
}

/** Traduce el google.rpc.Status y GoogleAdsFailure sin exponer el cuerpo ni los tokens. */
export function googleError(status: number, body: unknown, headers = new Headers()): ApiError {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error = root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : {};
  const details = Array.isArray(error.details) ? (error.details as Record<string, unknown>[]) : [];
  const codes: Array<{ family: string; code: string }> = [];
  let requestId: string | undefined = headers.get("request-id") ?? undefined;
  let quotaDelay: number | null = null;
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    if (typeof detail.requestId === "string" && /^[\w-]{1,200}$/.test(detail.requestId)) requestId = detail.requestId;
    if (!Array.isArray(detail.errors)) continue;
    for (const item of detail.errors as Array<{ errorCode?: Record<string, unknown>; details?: unknown }>) {
      // QuotaErrorDetails.retryDelay ("7s") es el tiempo de espera que Google pide en errores de cuota.
      const delay = (item?.details as { quotaErrorDetails?: { retryDelay?: unknown } } | undefined)?.quotaErrorDetails
        ?.retryDelay;
      const seconds = typeof delay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(delay)?.[1] : undefined;
      if (seconds !== undefined) quotaDelay = Math.max(quotaDelay ?? 0, Math.ceil(Number(seconds)));
      if (!item?.errorCode || typeof item.errorCode !== "object") continue;
      for (const [family, code] of Object.entries(item.errorCode))
        if (/^[a-zA-Z]+Error$/.test(family) && typeof code === "string" && /^[A-Z_0-9]{1,120}$/.test(code))
          codes.push({ family, code });
    }
  }
  const oauthCode = typeof root.error === "string" ? root.error : null;
  const rpc = typeof error.status === "string" ? error.status : "";
  let code: ErrorCode = status >= 500 ? "PROVIDER_ERROR" : "INVALID_REQUEST";
  if (
    status === 401 ||
    rpc === "UNAUTHENTICATED" ||
    (oauthCode && ["invalid_grant", "invalid_client", "unauthorized_client"].includes(oauthCode))
  )
    code = "AUTH_ERROR";
  else if (status === 429 || rpc === "RESOURCE_EXHAUSTED") code = "RATE_LIMITED";
  else if (status === 403 || rpc === "PERMISSION_DENIED" || oauthCode === "access_denied") code = "ACCESS_DENIED";
  else if (status === 404) code = "INVALID_REQUEST";
  for (const item of codes) {
    if (ACCESS_REQUIRED.has(item.code)) {
      code = "ACCESS_REQUIRED";
      break;
    }
    if (item.family === "quotaError") code = "RATE_LIMITED";
    else if (item.code === "CUSTOMER_NOT_FOUND" || item.family === "queryError" || item.family === "requestError")
      code = "INVALID_REQUEST";
    else if (item.code === "NOT_ADS_USER" || item.code === "GOOGLE_ACCOUNT_USER_AND_ADS_USER_MISMATCH")
      code = "ACCESS_DENIED";
    else if (item.family === "authenticationError") code = "AUTH_ERROR";
    else if (item.family === "authorizationError") code = "ACCESS_DENIED";
    else if (item.family === "internalError") code = "PROVIDER_ERROR";
  }
  const messages: Partial<Record<ErrorCode, string>> = {
    AUTH_ERROR: "Google rechazó la autenticación OAuth. Reautoriza el acceso o revisa la cuenta de servicio.",
    ACCESS_DENIED: "La identidad de Google no tiene permiso para esta cuenta o proyecto. Revisa el acceso y el MCC.",
    ACCESS_REQUIRED: "Google Ads requiere aprobación del proyecto Cloud o del acceso legacy para esta operación.",
    RATE_LIMITED: "Google Ads alcanzó su cuota. Reintenta después del tiempo indicado.",
    PROVIDER_ERROR: "Google Ads no pudo completar la operación.",
    INVALID_REQUEST: "Google Ads rechazó la cuenta o los parámetros de la consulta.",
  };
  const retry = headers.get("retry-after");
  const retryAfter =
    retry && /^\d+(?:\.\d+)?$/.test(retry)
      ? Math.ceil(Number(retry))
      : retry && Number.isFinite(Date.parse(retry))
        ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
        : quotaDelay;
  return new ApiError(code, messages[code], {
    details: {
      provider: "google",
      google_error_codes: codes.map((item) => item.code),
      ...(requestId ? { google_request_id: requestId } : {}),
    },
    retryAfter,
  });
}
