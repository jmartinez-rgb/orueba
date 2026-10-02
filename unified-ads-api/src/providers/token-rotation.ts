import { ApiError } from "../utils/errors.js";

/** Preserve synchronous observers (including ignored return values), and await async observers. */
export type RefreshTokenRotationHandler = (token: string) => unknown;

/** Storage failures must not expose a filesystem error, its cause, or the rotated token. */
export async function persistTokenRotation(
  provider: "microsoft" | "spotify",
  handler: RefreshTokenRotationHandler | undefined,
  token: string,
): Promise<void> {
  try {
    await handler?.(token);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo conservar el refresh token rotado en el almacén privado.", {
      details: { provider, limitation: "token_persistence_failed", transient: false },
    });
  }
}
