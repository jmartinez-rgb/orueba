// Utilidades compartidas por auth-setup y auth-hash (mismo formato que src/lib/auth/password.ts).
import { randomBytes, randomInt, scryptSync } from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = scryptSync(password.normalize("NFC"), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

// Sin caracteres ambiguos (0/O, 1/l/I) para dictarla o escribirla sin errores.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(prefix = "Izzi") {
  const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${prefix}-${block()}-${block()}-${block()}`;
}

export function generateSecret() {
  return randomBytes(48).toString("base64url");
}
