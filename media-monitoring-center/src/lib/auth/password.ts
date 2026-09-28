/**
 * Hash de contraseñas con scrypt (node:crypto). Formato:
 *   scrypt:N:r:p:<sal base64url>:<hash base64url>  (sin "$" para que los archivos .env no lo expandan)
 * En el repositorio NO se guardan contraseñas ni hashes: viven en variables de entorno
 * (AUTH_USERS, AUTH_UNIVERSAL_PASSWORD_HASH). Genera nuevos con `npm run auth:hash`.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const DEFAULTS = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const b64u = (b: Buffer) => b.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = DEFAULTS;
  const key = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${N}:${r}:${p}:${b64u(salt)}:${b64u(key)}`;
}

export function isPasswordHash(value: string | undefined | null): boolean {
  return typeof value === "string" && /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value.trim());
}

/** Compara en tiempo constante. Un hash mal formado nunca valida. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, saltText, hashText] = stored.trim().split(":");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  // Parámetros razonables: evita que un hash manipulado consuma memoria excesiva.
  if (!(N >= 1024 && N <= 1 << 20 && R >= 1 && R <= 32 && P >= 1 && P <= 16)) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  if (expected.length < 16) return false;
  try {
    const key = await scrypt(password, salt, expected.length, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
