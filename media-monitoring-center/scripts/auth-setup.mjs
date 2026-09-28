#!/usr/bin/env node
/**
 * Genera la configuración de acceso: AUTH_SECRET, contraseñas nuevas y sus hashes.
 *   npm run auth:setup                 → imprime las variables (no escribe nada)
 *   npm run auth:setup -- --write      → además las guarda en .env.local (ignorado por git)
 * Las contraseñas solo se muestran en esta terminal: compártelas por un canal seguro.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePassword, generateSecret, hashPassword } from "./auth-lib.mjs";

const accounts = [
  { u: "jmartinez", n: "J. Martínez", r: "admin" },
  { u: "operaciones", n: "Operaciones", r: "coadmin" },
];

const passwords = {};
const users = accounts.map((a) => {
  const pwd = generatePassword();
  passwords[a.u] = pwd;
  return { ...a, h: hashPassword(pwd) };
});
const universal = generatePassword("Equipo");
const env = {
  AUTH_SECRET: generateSecret(),
  AUTH_USERS: JSON.stringify(users),
  AUTH_UNIVERSAL_PASSWORD_HASH: hashPassword(universal),
  AUTH_UNIVERSAL_ROLE: "viewer",
  AUTH_SESSION_HOURS: "12",
};

console.log("\n== Contraseñas (guárdalas en un lugar seguro; no se vuelven a mostrar) ==");
for (const a of accounts) console.log(`  ${a.u.padEnd(12)} (${a.r})  ${passwords[a.u]}`);
console.log(`  ${"universal".padEnd(12)} (viewer)  ${universal}   ← cualquier persona entra con su nombre y apellido`);
console.log("\n== Variables de entorno (Netlify → Site configuration → Environment variables) ==");
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);

if (process.argv.includes("--write")) {
  const file = ".env.local";
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  // Un .env.local copiado de la primera versión trae AUTH_MODE=dev: se fija en "password".
  for (const [k, v] of Object.entries({ AUTH_MODE: "password", ...env })) {
    const line = `${k}=${k === "AUTH_USERS" ? `'${v}'` : v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(file, content);
  console.log(`\nGuardado en ${file} (reinicia npm run dev).`);
}
