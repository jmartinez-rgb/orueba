#!/usr/bin/env node
// Uso: npm run auth:hash -- "MiContraseñaLarga"   → imprime el hash scrypt para AUTH_USERS o AUTH_UNIVERSAL_PASSWORD_HASH.
import { hashPassword } from "./auth-lib.mjs";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Uso: npm run auth:hash -- "contraseña de al menos 10 caracteres"');
  process.exit(1);
}
console.log(hashPassword(password));
