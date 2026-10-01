import { resolve } from "node:path";
import { saveRotatedToken, type RotatingToken } from "../config/token-store.js";
import { ApiError } from "../utils/errors.js";

/** Drain all rotations before leaving the command; update both .env and a configured token store. */
export function rotationWriter(envFile = ".env", tokenStoreFile?: string) {
  let pending: Promise<boolean>[] = [];
  return {
    record(name: RotatingToken, token: string) {
      const paths = [...new Set([resolve(envFile), ...(tokenStoreFile ? [resolve(tokenStoreFile)] : [])])];
      for (const path of paths)
        pending.push(
          saveRotatedToken(path, name, token).then(
            () => true,
            () => false,
          ),
        );
    },
    async flush() {
      const current = pending;
      pending = [];
      if ((await Promise.all(current)).some((ok) => !ok))
        throw new ApiError("PROVIDER_ERROR", "No se pudo conservar un token rotado en el archivo privado.");
    },
  };
}
