#!/usr/bin/env node
/**
 * Configura la lectura de la hoja de Dataslayer en .env.local (ignorado por git).
 *   npm run sheets:setup -- ~/Downloads/llave-cuenta-servicio.json "https://docs.google.com/spreadsheets/d/ID/edit"
 * Lee client_email y private_key del JSON de la cuenta de servicio y escribe:
 *   DATA_SOURCE=sheets, SHEETS_SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.
 * Nunca imprime la llave privada.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const [, , keyArg, sheetArg] = process.argv;
if (!keyArg || !sheetArg) {
  console.error('Uso: npm run sheets:setup -- <archivo JSON de la cuenta de servicio> "<URL o ID de la hoja>"');
  process.exit(1);
}
const keyPath = path.resolve(keyArg.replace(/^~(?=$|\/)/, homedir()));
if (!existsSync(keyPath)) {
  console.error(`No existe el archivo ${keyPath}`);
  process.exit(1);
}
let key;
try {
  key = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  console.error("El archivo no es un JSON válido de cuenta de servicio.");
  process.exit(1);
}
if (!key.client_email || !key.private_key || !String(key.private_key).includes("PRIVATE KEY")) {
  console.error("El JSON no trae client_email y private_key. Descarga la llave en formato JSON (Cuentas de servicio → Claves → Agregar clave).");
  process.exit(1);
}
const id = (sheetArg.match(/\/d\/([A-Za-z0-9_-]{20,})/) ?? [null, sheetArg.trim()])[1];
if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
  console.error("No reconozco el ID de la hoja. Pega la URL completa de Google Sheets o lo que va entre /d/ y /edit.");
  process.exit(1);
}

// La llave se guarda en una sola línea con \n escapados (la app los convierte al leerla).
const privateKey = String(key.private_key).replace(/\r?\n/g, "\\n");
const values = {
  DATA_SOURCE: "sheets",
  SHEETS_SPREADSHEET_ID: id,
  GOOGLE_CLIENT_EMAIL: key.client_email,
  GOOGLE_PRIVATE_KEY: `"${privateKey}"`,
};
const file = ".env.local";
let content = existsSync(file) ? readFileSync(file, "utf8") : "";
for (const [k, v] of Object.entries(values)) {
  const line = `${k}=${v}`;
  const re = new RegExp(`^${k}=.*$`, "m");
  content = re.test(content) ? content.replace(re, () => line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
}
writeFileSync(file, content);

console.log("\nListo: .env.local actualizado (DATA_SOURCE, SHEETS_SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY).");
console.log("\nFalta un paso en Google Sheets:");
console.log(`  Comparte la hoja con ${key.client_email} como "Lector" (sin notificar).`);
console.log("\nPara Netlify (Site configuration → Environment variables):");
console.log("  DATA_SOURCE=sheets");
console.log(`  SHEETS_SPREADSHEET_ID=${id}`);
console.log(`  GOOGLE_CLIENT_EMAIL=${key.client_email}`);
console.log('  GOOGLE_PRIVATE_KEY = el valor de "private_key" del archivo JSON (márcala como secreta).');
console.log("\nDespués: npm run dev → Integrations → Google Sheets (Dataslayer) → Probar conexión.");
