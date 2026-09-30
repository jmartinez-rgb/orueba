/**
 * Errores estándar de la API. Cada respuesta de error tiene la misma forma:
 * { error: { code, message, details?, request_id } }.
 */
export const ERROR_CODES = [
  "AUTH_ERROR",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "NOT_CONFIGURED",
  "ACCESS_REQUIRED",
  "PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "INVALID_REQUEST",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_ERROR: 401,
  ACCESS_DENIED: 403,
  RATE_LIMITED: 429,
  NOT_CONFIGURED: 503,
  ACCESS_REQUIRED: 403,
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
  INVALID_REQUEST: 400,
  UNKNOWN: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  AUTH_ERROR: "Falta la llave de acceso o no es válida (encabezado X-API-Key).",
  ACCESS_DENIED: "No tienes permiso para esta operación.",
  RATE_LIMITED: "Demasiadas solicitudes. Intenta de nuevo en un momento.",
  NOT_CONFIGURED: "El proveedor no está configurado.",
  ACCESS_REQUIRED: "El proveedor requiere aprobación o un nivel de acceso adicional.",
  PROVIDER_ERROR: "La plataforma respondió con un error.",
  PROVIDER_TIMEOUT: "La plataforma no respondió a tiempo.",
  INVALID_REQUEST: "La solicitud no es válida.",
  UNKNOWN: "Error inesperado.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;
  /** Segundos sugeridos antes de reintentar (RATE_LIMITED). */
  readonly retryAfter: number | null;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: { details?: unknown; statusCode?: number; retryAfter?: number | null; cause?: unknown } = {},
  ) {
    super(message ?? DEFAULT_MESSAGE[code], opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = opts.statusCode ?? ERROR_STATUS[code];
    this.details = opts.details ?? null;
    this.retryAfter = opts.retryAfter ?? null;
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; request_id: string };
}

export function errorBody(err: ApiError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== null && err.details !== undefined ? { details: err.details } : {}),
      request_id: requestId,
    },
  };
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
