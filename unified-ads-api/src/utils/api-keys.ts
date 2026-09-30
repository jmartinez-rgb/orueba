import { createHash, timingSafeEqual } from "node:crypto";

const MIN_PLAIN_LENGTH = 24;

export function hashApiKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

/**
 * Lee API_KEYS: cada llave en texto (mín. 24 caracteres) o ya como huella "sha256:<hex>" para no
 * guardar la llave en claro en la configuración del servidor.
 */
export function parseApiKeys(raw: string): { hashes: Buffer[]; errors: string[] } {
  const hashes: Buffer[] = [];
  const errors: string[] = [];
  raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .forEach((k, i) => {
      if (k.startsWith("sha256:")) {
        const hex = k.slice(7);
        if (!/^[a-f0-9]{64}$/i.test(hex))
          errors.push(`API_KEYS[${i}]: la huella sha256 debe tener 64 caracteres hexadecimales.`);
        else hashes.push(Buffer.from(hex, "hex"));
      } else if (k.length < MIN_PLAIN_LENGTH) {
        errors.push(`API_KEYS[${i}]: la llave debe tener al menos ${MIN_PLAIN_LENGTH} caracteres.`);
      } else {
        hashes.push(hashApiKey(k));
      }
    });
  return { hashes, errors };
}

/** Comparación en tiempo constante contra todas las llaves válidas. */
export function isValidApiKey(candidate: string | undefined, hashes: readonly Buffer[]): boolean {
  if (!candidate) return false;
  const h = hashApiKey(candidate);
  let ok = false;
  for (const valid of hashes) if (valid.length === h.length && timingSafeEqual(valid, h)) ok = true;
  return ok;
}
