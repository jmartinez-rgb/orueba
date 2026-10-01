import type { ProviderState } from "../types/normalized.js";
import { isApiError } from "../utils/errors.js";

/**
 * Estado de un proveedor a partir del error de su verificación. Credenciales vencidas o revocadas
 * (AUTH_ERROR) quedan en "error" con ese código: hay que reautorizar, no pedir permisos. Solo un
 * acceso negado a la cuenta es "permission_denied", y una aprobación pendiente "access_required".
 */
export function stateFromError(err: unknown): ProviderState {
  if (!isApiError(err)) return "error";
  if (err.code === "ACCESS_REQUIRED") return "access_required";
  if (err.code === "ACCESS_DENIED") return "permission_denied";
  if (err.code === "RATE_LIMITED") return "degraded";
  return "error";
}
