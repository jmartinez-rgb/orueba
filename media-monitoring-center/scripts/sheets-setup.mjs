#!/usr/bin/env node
/**
 * Configura la lectura de la hoja de Dataslayer en .env.local (ignorado por git).
 *   npm run sheets:setup -- "https://docs.google.com/spreadsheets/d/ID/edit"
 *   npm run sheets:setup -- ~/Downloads/llave-cuenta-servicio.json "https://docs.google.com/spreadsheets/d/ID/edit"
 * Si no se indica la llave (o la ruta no existe), busca en Descargas, Escritorio y la carpeta
 * actual el JSON de la cuenta de servicio. Lee client_email y private_key y escribe:
 *   DATA_SOURCE=sheets, SHEETS_SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.
 * Nunca imprime la llave privada.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const looksLikeSheet = (a) => /\/d\/[A-Za-z0-9_-]{20,}/.test(a) || (/^[A-Za-z0-9_-]{20,}$/.test(a) && !a.toLowerCase().endsWith(".json"));
const sheetArg = args.find(looksLikeSheet);
const keyArg = args.find((a) => a !== sheetArg);
if (!sheetArg) {
  console.error('Uso: npm run sheets:setup -- "<URL o ID de la hoja>"');
  console.error("     (opcional, antes de la URL: la ruta del JSON de la cuenta de servicio)");
  process.exit(1);
}

/** La llave de una cuenta de servicio de Google (o null si el archivo no lo es). */
function readKey(file) {
  try {
    const k = JSON.parse(readFileSync(file, "utf8"));
    return k && k.type === "service_account" && k.client_email && String(k.private_key ?? "").includes("PRIVATE KEY") ? k : null;
  } catch {
    return null;
  }
}

/** Llaves de cuenta de servicio en Descargas, Escritorio y la carpeta actual (la más reciente primero). */
function findKeys() {
  const home = homedir();
  const dirs = [...new Set([path.join(home, "Downloads"), path.join(home, "Descargas"), path.join(home, "Desktop"), path.join(home, "Escritorio"), process.cwd()])];
  const found = [];
  for (const d of dirs) {
    let names = [];
    try {
      names = readdirSync(d).filter((n) => n.toLowerCase().endsWith(".json"));
    } catch {
      continue;
    }
    for (const n of names) {
      const f = path.join(d, n);
      try {
        const st = statSync(f);
        if (!st.isFile() || st.size > 20000) continue;
        if (readKey(f)) found.push({ file: f, mtime: st.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((x) => x.file);
}

let keyPath = keyArg ? path.resolve(keyArg.replace(/^~(?=$|\/)/, homedir())) : null;
if (!keyPath || !existsSync(keyPath)) {
  if (keyPath) console.log(`No existe ${keyPath}; busco la llave de la cuenta de servicio en Descargas, Escritorio y esta carpeta…`);
  const keys = findKeys();
  if (keys.length === 1) {
    keyPath = keys[0];
    console.log(`Uso la llave encontrada: ${keyPath}`);
  } else if (keys.length > 1) {
    console.error("Encontré varias llaves de cuenta de servicio. Indica cuál usar con uno de estos comandos:");
    for (const k of keys) console.error(`  npm run sheets:setup -- "${k}" "${sheetArg}"`);
    process.exit(1);
  } else {
    console.error("\nNo encontré la llave JSON de la cuenta de servicio.");
    console.error("Es un archivo distinto a la hoja: es la llave que le da permiso a la app para leerla.");
    console.error("Se descarga en Google Cloud → IAM y administración → Cuentas de servicio → (la cuenta) → Claves → Agregar clave → JSON.");
    console.error("Guárdala en Descargas y vuelve a correr este comando.");
    process.exit(1);
  }
}
const key = readKey(keyPath);
if (!key) {
  console.error(`${keyPath} no es la llave JSON de una cuenta de servicio (debe traer "type": "service_account", client_email y private_key).`);
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
console.log("\nConfirma en Google Sheets:");
console.log(`  La hoja debe estar compartida con ${key.client_email} como "Lector".`);
console.log("\nPara Netlify (Site configuration → Environment variables):");
console.log("  DATA_SOURCE=sheets");
console.log(`  SHEETS_SPREADSHEET_ID=${id}`);
console.log(`  GOOGLE_CLIENT_EMAIL=${key.client_email}`);
console.log('  GOOGLE_PRIVATE_KEY = el valor de "private_key" del archivo JSON (márcala como secreta).');
console.log("\nDespués: npm run dev → Integrations → Google Sheets (Dataslayer) → Probar conexión.");
