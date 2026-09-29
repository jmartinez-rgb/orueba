#!/usr/bin/env node
/**
 * Conecta y revisa la hoja de Dataslayer. Las credenciales solo se guardan en .env.local (ignorado por git).
 *
 *   npm run sheets:setup -- "https://docs.google.com/spreadsheets/d/ID/edit"
 *       Busca la llave JSON de la cuenta de servicio en Descargas, Escritorio y esta carpeta, prueba
 *       cada una contra Google (se salta las que ya se borraron en Google Cloud), guarda la que
 *       funciona en .env.local y revisa la hoja completa.
 *   npm run sheets:setup -- ~/ruta/llave.json "URL"
 *       Igual, con esa llave.
 *   npm run sheets:check
 *       Revisa la conexión y la hoja con lo que ya está en .env.local (no cambia nada).
 *
 * Nunca imprime la llave privada ni lee la pestaña "Ventas Detalle".
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
// Solo para pruebas locales del comando (servidor simulado); en uso normal no se definen.
const API = process.env.SHEETS_API_BASE ?? "https://sheets.googleapis.com/v4/spreadsheets";
const TEST_TOKEN = process.env.SHEETS_TEST_TOKEN;
const ENV_FILE = ".env.local";
const MAPPING_FILE = path.join("config", "sheets.mapping.json");
const NEVER_READ = "ventas detalle";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const rest = args.filter((a) => a !== "--check");
const looksLikeSheet = (a) => /\/d\/[A-Za-z0-9_-]{20,}/.test(a) || (/^[A-Za-z0-9_-]{20,}$/.test(a) && !a.toLowerCase().endsWith(".json"));
const sheetArg = rest.find(looksLikeSheet);
const keyArg = rest.find((a) => a !== sheetArg);

const problems = [];
const warn = (msg) => problems.push(msg);

// ── .env.local ────────────────────────────────────────────────────────────────
function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function writeEnv(values) {
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  // GOOGLE_SERVICE_ACCOUNT manda sobre GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY: si quedó de antes, la llave nueva se ignoraría.
  let disabled = false;
  content = content.replace(/^GOOGLE_SERVICE_ACCOUNT=.*$/gm, (line) => {
    disabled = true;
    return `# desactivada por sheets:setup (la app usa GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY): ${line.slice(0, 40)}…`;
  });
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    content = re.test(content) ? content.replace(re, () => line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(ENV_FILE, content);
  return disabled;
}

// ── Llaves ────────────────────────────────────────────────────────────────────
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
        if (st.isFile() && st.size <= 20000 && readKey(f)) found.push({ file: f, mtime: st.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((x) => x.file);
}

function keyFromEnv(env) {
  if (env.GOOGLE_SERVICE_ACCOUNT) {
    const raw = env.GOOGLE_SERVICE_ACCOUNT.trim();
    try {
      const k = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
      return { key: { client_email: k.client_email, private_key: String(k.private_key ?? "").replace(/\\n/g, "\n") }, source: "GOOGLE_SERVICE_ACCOUNT" };
    } catch {
      return { key: null, source: "GOOGLE_SERVICE_ACCOUNT" };
    }
  }
  if (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    return { key: { client_email: env.GOOGLE_CLIENT_EMAIL, private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n") }, source: "GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY" };
  }
  return { key: null, source: null };
}

// ── Google ────────────────────────────────────────────────────────────────────
/** Qué significa un error de Google, en español y con el paso para arreglarlo. */
function explain(kind, email) {
  switch (kind) {
    case "deleted":
      return "Esta llave ya no es válida: se borró o se reemplazó en Google Cloud. Usa la llave nueva (el archivo .json más reciente).";
    case "badkey":
      return "La llave privada está incompleta o mal copiada. Vuelve a descargar el JSON en Google Cloud (Cuentas de servicio → Claves → Agregar clave → JSON).";
    case "clock":
      return "La hora de esta computadora está desfasada y Google rechaza la llave. Activa 'Ajustar la hora automáticamente' en la configuración del sistema.";
    case "network":
      return "No hubo conexión con Google. Revisa internet (o la VPN) y vuelve a intentar.";
    case "api":
      return "La API de Google Sheets no está habilitada en el proyecto de esta cuenta de servicio. En Google Cloud: APIs y servicios → Biblioteca → Google Sheets API → Habilitar.";
    case "share":
      return `La hoja no está compartida con la cuenta de servicio. En la hoja: Compartir → ${email} → Lector.`;
    case "notfound":
      return "No existe una hoja con ese ID. Pega la URL completa de la hoja (lo que va entre /d/ y /edit).";
    case "excel":
      return "Ese archivo es un Excel abierto en Drive, no una hoja de Google. Ábrelo y usa Archivo → Guardar como Hojas de cálculo de Google; usa la URL de la copia.";
    default:
      return "Google respondió con un error inesperado.";
  }
}

function classify(message, status) {
  const m = String(message);
  if (/Invalid JWT Signature|account not found|invalid_client|deleted_client|disabled_client/i.test(m)) return "deleted";
  if (/short-lived|reasonable timeframe|iat|exp.*claim/i.test(m)) return "clock";
  if (/DECODER|PEM|no start line|private key|asn1|error:1E08010C/i.test(m)) return "badkey";
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket/i.test(m)) return "network";
  if (/SERVICE_DISABLED|has not been used in project|is disabled|API has not been used/i.test(m)) return "api";
  if (status === 403 || /PERMISSION_DENIED|does not have permission/i.test(m)) return "share";
  if (status === 404 || /NOT_FOUND|Requested entity was not found/i.test(m)) return "notfound";
  if (/not supported for this document/i.test(m)) return "excel";
  return "other";
}

async function accessToken(key) {
  if (TEST_TOKEN) return TEST_TOKEN;
  const auth = new GoogleAuth({ credentials: { client_email: key.client_email, private_key: key.private_key }, scopes: [SCOPE] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google no entregó token de acceso.");
  return token;
}

async function api(token, pathAndQuery) {
  const res = await fetch(`${API}/${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(`${res.status} ${body?.error?.status ?? ""} ${body?.error?.message ?? ""}`.trim());
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Prueba una llave contra la hoja: token de Google y metadatos (títulos, filas, zona horaria). */
async function probe(key, id) {
  let token;
  try {
    token = await accessToken(key);
  } catch (err) {
    return { ok: false, kind: classify(err?.message ?? err), detail: err?.message ?? String(err) };
  }
  try {
    const fields = encodeURIComponent("properties(title,timeZone),sheets(properties(title,gridProperties(rowCount,columnCount)))");
    const meta = await api(token, `${encodeURIComponent(id)}?fields=${fields}`);
    return { ok: true, token, meta };
  } catch (err) {
    return { ok: false, keyValid: true, kind: classify(err?.message, err?.status), detail: err?.message ?? String(err) };
  }
}

// ── Revisión de la hoja contra el mapeo ───────────────────────────────────────
const norm = (v) =>
  String(v ?? "")
    .normalize("NFC")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const refs = (ref) => (ref === undefined ? [] : Array.isArray(ref) ? ref : typeof ref === "object" ? ref.sum : [ref]);
const describe = (ref) => refs(ref).join(" / ");
const findCol = (headers, ref) => {
  for (const n of refs(ref)) {
    const i = headers.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
};
const letter = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const a1 = (title, range) => `'${title.replace(/'/g, "''")}'!${range}`;

/** Fecha y hora de la pestaña de control (texto de la hoja o número de serie). */
function stamp(v) {
  if (typeof v !== "number") return String(v ?? "").trim();
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function toDate(v) {
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** Columnas sin las que la app no puede leer la pestaña (mismas reglas que la app). */
function missingColumns(source, headers) {
  const c = source.columns ?? {};
  const k = source.constants ?? {};
  const out = [];
  if (findCol(headers, c.date) < 0) out.push(describe(c.date));
  if (source.shape === "hourly" && findCol(headers, c.hour) < 0 && findCol(headers, c.date) < 0) out.push(describe(c.hour));
  else if (source.shape === "hourly" && c.hour && findCol(headers, c.hour) < 0 && !refs(c.date).some((n) => /hour/i.test(n) && headers.includes(norm(n)))) out.push(describe(c.hour));
  if (findCol(headers, c.accountId) < 0 && findCol(headers, c.accountName) < 0 && !k.accountId && !k.accountName) out.push(describe(c.accountName ?? c.accountId));
  if ((source.level ?? "campaign") === "campaign" && findCol(headers, c.campaignId) < 0 && findCol(headers, c.campaignName) < 0) out.push(describe(c.campaignName ?? c.campaignId ?? "Campaign"));
  const metrics = ["spend", "impressions", "clicks", "conversions", "leads", "sales", "whatsapp", "calls", "purchases", "revenue"];
  for (const m of metrics) {
    const ref = c[m];
    if (!ref) continue;
    const found = typeof ref === "object" && !Array.isArray(ref) ? ref.sum.some((n) => headers.includes(norm(n))) : findCol(headers, ref) >= 0;
    if (!found) out.push(describe(ref));
  }
  if (source.pivot) {
    if (findCol(headers, source.pivot.column) < 0) out.push(describe(source.pivot.column));
    if (findCol(headers, source.pivot.value) < 0) out.push(describe(source.pivot.value));
  }
  return out;
}

async function report(token, id, meta, email) {
  const tz = readEnv().APP_TIMEZONE || "America/Mexico_City";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const weekAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const mapping = JSON.parse(readFileSync(MAPPING_FILE, "utf8"));
  const tabs = new Map((meta.sheets ?? []).map((s) => [norm(s.properties.title), s.properties]));
  const titleOf = (name) => tabs.get(norm(name))?.title ?? null;

  console.log(`\nHoja: "${meta.properties?.title}" · zona horaria de la hoja: ${meta.properties?.timeZone ?? "—"} · hoy (${tz}): ${today}`);

  const sources = mapping.sources ?? [];
  const extra = [
    mapping.control?.sheet ? { sheet: mapping.control.sheet, kind: "control" } : null,
    mapping.budgets?.sheet ? { sheet: mapping.budgets.sheet, kind: "budgets", optional: true } : null,
    mapping.fxRates?.sheet ? { sheet: mapping.fxRates.sheet, kind: "fx", optional: true } : null,
  ].filter(Boolean);
  const present = [...sources, ...extra].map((s) => titleOf(s.sheet)).filter((t) => t && norm(t) !== NEVER_READ);
  const unique = [...new Set(present)];
  const headerData = unique.length ? await api(token, `${encodeURIComponent(id)}/values:batchGet?${unique.map((t) => `ranges=${encodeURIComponent(a1(t, "1:1"))}`).join("&")}`) : { valueRanges: [] };
  const headersOf = new Map(unique.map((t, i) => [t, (headerData.valueRanges?.[i]?.values?.[0] ?? []).map(norm)]));

  // Fechas: solo la columna de fecha de las últimas ~4,000 filas de cada pestaña.
  const dateRanges = [];
  for (const s of sources) {
    const t = titleOf(s.sheet);
    const h = t ? headersOf.get(t) : null;
    if (!t || !h?.length) continue;
    const di = findCol(h, s.columns?.date);
    if (di < 0) continue;
    const rows = tabs.get(norm(t))?.gridProperties?.rowCount ?? 1000;
    dateRanges.push({ sheet: s.sheet, title: t, range: a1(t, `${letter(di)}${Math.max(2, rows - 4000)}:${letter(di)}${rows}`) });
  }
  const dateData = dateRanges.length
    ? await api(token, `${encodeURIComponent(id)}/values:batchGet?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&${dateRanges.map((r) => `ranges=${encodeURIComponent(r.range)}`).join("&")}`)
    : { valueRanges: [] };
  const datesOf = new Map(dateRanges.map((r, i) => [r.sheet, (dateData.valueRanges?.[i]?.values?.[0] ?? []).map(toDate).filter(Boolean)]));

  // Estado de Dataslayer (pestaña de control).
  const control = new Map();
  const ctlTitle = mapping.control?.sheet ? titleOf(mapping.control.sheet) : null;
  if (ctlTitle) {
    const data = await api(token, `${encodeURIComponent(id)}/values/${encodeURIComponent(a1(ctlTitle, "A1:AZ200"))}`);
    const [head = [], ...rows] = data.values ?? [];
    const h = head.map(norm);
    const cols = mapping.control.columns ?? {};
    const ci = (ref, fallback) => {
      const i = findCol(h, ref ?? fallback);
      return i;
    };
    const iSheet = ci(cols.sheet, "Sheet name");
    const iUpdated = ci(cols.updated, "Updated");
    const iCreated = ci(cols.created, "Created");
    const iStatus = ci(cols.status, "Last status");
    for (const r of rows) {
      if (iSheet < 0) break;
      control.set(norm(r[iSheet]), { updated: stamp((iUpdated >= 0 && r[iUpdated]) || (iCreated >= 0 && r[iCreated]) || ""), status: iStatus >= 0 ? String(r[iStatus] ?? "") : "" });
    }
  }

  console.log("\nPestañas de datos:");
  for (const s of sources) {
    const t = titleOf(s.sheet);
    const label = `${s.sheet}${s.shape === "hourly" ? " (por hora)" : ""}`.padEnd(28);
    if (!t) {
      if (s.optional) console.log(`  --     ${label} no existe (opcional)`);
      else {
        console.log(`  FALTA  ${label} no existe en la hoja`);
        warn(`Crea la pestaña "${s.sheet}" (nombre exacto) o revisa que la consulta de Dataslayer escriba ahí.`);
      }
      continue;
    }
    const headers = headersOf.get(t) ?? [];
    if (!headers.length) {
      console.log(`  ${s.optional ? "--   " : "AVISO"}  ${label} vacía (sin encabezados)`);
      if (!s.optional) warn(`La pestaña "${s.sheet}" está vacía: corre su consulta en Dataslayer.`);
      continue;
    }
    const miss = missingColumns(s, headers);
    const dates = datesOf.get(s.sheet) ?? [];
    const last = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const days7 = new Set(dates.filter((d) => d > weekAgo)).size;
    const hasToday = dates.includes(today);
    const ctl = control.get(norm(s.controlName ?? s.sheet));
    const state = ctl ? ` · Dataslayer: ${ctl.status || "sin estado"} (${ctl.updated || "sin hora"})` : "";
    const dateInfo = last ? `última fecha ${last}${hasToday ? " (hoy)" : ""}${s.shape === "hourly" ? ` · ${days7} de 7 días recientes` : ""}` : "sin fechas legibles";
    if (miss.length) {
      console.log(`  FALTA  ${label} columnas no encontradas: ${miss.join(", ")}`);
      warn(`En "${s.sheet}" faltan columnas: ${miss.join(", ")}. Agrégalas en la consulta de Dataslayer (o avísame el nombre que usa para añadirlo al mapeo).`);
    } else console.log(`  OK     ${label} ${dateInfo}${state}`);
    if (!miss.length && !last) warn(`En "${s.sheet}" no se pudieron leer fechas en la columna de fecha.`);
    if (!miss.length && last && s.intraday !== false && !hasToday && s.shape !== "hourly") warn(`"${s.sheet}" no trae datos de hoy (última fecha ${last}). Revisa que el rango de la consulta incluya hoy y que se haya actualizado.`);
    if (!miss.length && s.shape === "hourly" && days7 < 3) warn(`"${s.sheet}" trae ${days7} días por hora; para aprender la curva conviene el rango "últimos 7 días, incluyendo hoy".`);
    if (ctl && /error|fail/i.test(ctl.status)) warn(`Dataslayer reporta error en "${s.sheet}": ${ctl.status}. Ábrela en Dataslayer y vuelve a correrla.`);
  }
  for (const e of extra) {
    const t = titleOf(e.sheet);
    const name = { control: "estado de Dataslayer", budgets: "presupuestos", fx: "tipo de cambio" }[e.kind];
    if (t) console.log(`  OK     ${e.sheet.padEnd(28)} ${name}`);
    else if (e.optional) console.log(`  --     ${e.sheet.padEnd(28)} no existe (opcional: ${name})`);
    else {
      console.log(`  FALTA  ${e.sheet.padEnd(28)} no existe (${name})`);
      warn(`No existe la pestaña "${e.sheet}": Dataslayer la crea sola al tener consultas; sin ella la app no sabe cuándo se actualizó cada plataforma.`);
    }
  }
  if (tabs.has(NEVER_READ)) console.log(`  --     ${"Ventas Detalle".padEnd(28)} no se lee (contiene teléfonos)`);
  console.log(`\nCuenta de servicio: ${email}`);
}

function finish() {
  if (problems.length) {
    console.log(`\nPendientes (${problems.length}):`);
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  } else console.log("\nTodo en orden: la app puede leer la hoja completa.");
}

// ── Principal ─────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(MAPPING_FILE)) {
    console.error(`Corre este comando dentro de la carpeta media-monitoring-center (no encuentro ${MAPPING_FILE}).`);
    process.exit(1);
  }

  if (checkOnly) {
    const env = readEnv();
    const id = sheetArg ? (sheetArg.match(/\/d\/([A-Za-z0-9_-]{20,})/) ?? [null, sheetArg])[1] : env.SHEETS_SPREADSHEET_ID;
    const { key, source } = keyFromEnv(env);
    if (!id || !key) {
      console.error(`Falta configuración en ${ENV_FILE}: ${[!id && "SHEETS_SPREADSHEET_ID", !key && "la llave (GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY)"].filter(Boolean).join(" y ")}.`);
      console.error('Corre: npm run sheets:setup -- "URL de la hoja"');
      process.exit(1);
    }
    if (env.DATA_SOURCE !== "sheets") warn(`DATA_SOURCE no es "sheets" en ${ENV_FILE} (vale "${env.DATA_SOURCE ?? ""}"): la app usará datos simulados.`);
    if (source === "GOOGLE_SERVICE_ACCOUNT") warn("GOOGLE_SERVICE_ACCOUNT está definida y manda sobre GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY. Si es de una llave vieja, bórrala de .env.local (y de Netlify).");
    console.log(`Revisando con la llave de ${ENV_FILE} (${key.client_email})…`);
    const r = await probe(key, id);
    if (!r.ok) {
      console.log(`\nERROR  ${explain(r.kind, key.client_email)}`);
      if (r.kind === "deleted") console.log('       Deja el JSON nuevo en Descargas y corre: npm run sheets:setup -- "URL de la hoja"');
      console.log(`       Detalle técnico: ${r.detail}`);
      process.exit(1);
    }
    console.log("OK     La llave es válida y la hoja está compartida con la cuenta de servicio.");
    await report(r.token, id, r.meta, key.client_email);
    finish();
    console.log("\nSi cambiaste .env.local, reinicia la app (Ctrl+C y npm run dev).");
    return;
  }

  if (!sheetArg) {
    console.error('Uso: npm run sheets:setup -- "<URL o ID de la hoja>"');
    console.error("     (opcional, antes de la URL: la ruta del JSON de la cuenta de servicio)");
    console.error("     npm run sheets:check   → revisa lo que ya está configurado");
    process.exit(1);
  }
  const id = (sheetArg.match(/\/d\/([A-Za-z0-9_-]{20,})/) ?? [null, sheetArg.trim()])[1];
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    console.error("No reconozco el ID de la hoja. Pega la URL completa de Google Sheets o lo que va entre /d/ y /edit.");
    process.exit(1);
  }

  let candidates = [];
  if (keyArg) {
    const p = path.resolve(keyArg.replace(/^~(?=$|\/)/, homedir()));
    if (existsSync(p)) candidates = [p];
    else console.log(`No existe ${p}; busco la llave en Descargas, Escritorio y esta carpeta…`);
  }
  if (!candidates.length) candidates = findKeys();
  if (!candidates.length) {
    console.error("\nNo encontré la llave JSON de la cuenta de servicio.");
    console.error("Es un archivo distinto a la hoja: la llave que le da permiso a la app para leerla.");
    console.error("Se descarga en Google Cloud → IAM y administración → Cuentas de servicio → (la cuenta) → Claves → Agregar clave → JSON.");
    console.error("Guárdala en Descargas y vuelve a correr este comando.");
    process.exit(1);
  }

  console.log(`Probando ${candidates.length === 1 ? "la llave" : `${candidates.length} llaves (la más reciente primero)`} contra Google…`);
  let chosen = null;
  for (const file of candidates) {
    const key = readKey(file);
    if (!key) {
      console.log(`  ERROR  ${file}: no es la llave JSON de una cuenta de servicio.`);
      continue;
    }
    const r = await probe(key, id);
    if (r.ok) {
      console.log(`  OK     ${file} (${key.client_email})`);
      chosen = { file, key, result: r };
      break;
    }
    if (r.keyValid) {
      console.log(`  OK     ${file} (${key.client_email}): la llave funciona, pero hay un problema con la hoja.`);
      chosen = { file, key, result: r };
      break;
    }
    console.log(`  ERROR  ${file}: ${explain(r.kind, key.client_email)}`);
    if (r.kind === "network" || r.kind === "clock") process.exit(1);
  }
  if (!chosen) {
    console.error("\nNinguna llave funciona. Si borraste la llave en Google Cloud, crea una nueva:");
    console.error("Cuentas de servicio → (la cuenta) → Claves → Agregar clave → Crear clave nueva → JSON. Déjala en Descargas y borra las viejas.");
    process.exit(1);
  }

  const { key, result } = chosen;
  const privateKey = String(key.private_key).replace(/\r?\n/g, "\\n");
  const disabled = writeEnv({ DATA_SOURCE: "sheets", SHEETS_SPREADSHEET_ID: id, GOOGLE_CLIENT_EMAIL: key.client_email, GOOGLE_PRIVATE_KEY: `"${privateKey}"` });
  console.log(`\nListo: ${ENV_FILE} actualizado (DATA_SOURCE, SHEETS_SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY).`);
  if (disabled) console.log("AVISO  Había una GOOGLE_SERVICE_ACCOUNT de antes que mandaba sobre la llave nueva: la dejé comentada. Si también está en Netlify, bórrala ahí.");
  const stale = candidates.filter((f) => f !== chosen.file);
  if (stale.length) warn(`Borra de tu computadora las llaves que ya no sirven: ${stale.join(", ")}`);

  if (result.ok) await report(result.token, id, result.meta, key.client_email);
  else {
    console.log(`\nERROR  ${explain(result.kind, key.client_email)}`);
    console.log(`       Detalle técnico: ${result.detail}`);
    warn(explain(result.kind, key.client_email));
  }
  finish();
  console.log("\nSiguiente:");
  console.log("  1. Reinicia la app: en la terminal donde corre, Ctrl+C y luego npm run dev.");
  console.log("  2. En Netlify (Site configuration → Environment variables), con esta misma llave:");
  console.log("       DATA_SOURCE=sheets");
  console.log(`       SHEETS_SPREADSHEET_ID=${id}`);
  console.log(`       GOOGLE_CLIENT_EMAIL=${key.client_email}`);
  console.log('       GOOGLE_PRIVATE_KEY = el valor de "private_key" del archivo JSON (márcala como secreta).');
  console.log("     y vuelve a desplegar (Deploys → Trigger deploy).");
  console.log("  3. Cuando quieras revisar todo de nuevo: npm run sheets:check");
}

main().catch((err) => {
  console.error(`\nError inesperado: ${err?.message ?? err}`);
  process.exit(1);
});
