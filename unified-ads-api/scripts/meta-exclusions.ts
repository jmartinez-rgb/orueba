import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareEnv } from "../src/config/load-env.js";
import { MetaClient } from "../src/providers/meta/client.js";
import { metaAccountId, readMetaConfig } from "../src/providers/meta/config.js";
import {
  ADSET_FIELDS,
  ADSET_FIELDS_FULL_TARGETING,
  ADSET_STATUSES,
  DEFAULT_ACTIVE_CUSTOMER_PATTERN,
  audiencePattern,
  auditExclusions,
  exclusionWorkbook,
  parseAdSet,
  type MetaAccountRead,
  type MetaAdSetTargeting,
} from "../src/providers/meta/exclusions.js";
import { buildXlsx } from "../src/utils/xlsx.js";
import { ApiError } from "../src/utils/errors.js";

/**
 * Genera un Excel con las cuentas, campañas y grupos de anuncios de Meta que excluyen la audiencia
 * de clientes activos y los que no. Solo lectura: no cambia nada en Meta. Usa META_ACCESS_TOKEN
 * del .env local y nunca lo muestra. Uso:
 *   npm run meta:exclusiones -- 902854812517704 801573051220234
 *   npm run meta:exclusiones -- --solo-activos --patron "clientes activos|base activa" <IDs>
 * Sin IDs usa META_AD_ACCOUNT_IDS. El archivo queda en reportes/ (fuera de git).
 */

function args(argv: string[]) {
  const ids: string[] = [];
  let pattern = DEFAULT_ACTIVE_CUSTOMER_PATTERN;
  let onlyActive = false;
  let output: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--patron") pattern = argv[++i] ?? "";
    else if (arg === "--solo-activos") onlyActive = true;
    else if (arg === "--salida") output = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Opción desconocida: ${arg}`);
    else ids.push(...arg.split(/[\s,]+/).filter(Boolean));
  }
  if (!pattern.trim()) throw new Error("--patron necesita un texto.");
  return { ids, pattern, onlyActive, output };
}

function safeMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : "Error inesperado al leer la cuenta.";
}

async function main() {
  prepareEnv();
  const options = args(process.argv.slice(2));
  const { config, missing } = readMetaConfig(process.env);
  if (!config)
    throw new Error(`Configura Meta en .env antes de continuar (faltan o son inválidas: ${missing.join(", ")}).`);
  let pattern: RegExp;
  try {
    pattern = audiencePattern(options.pattern);
  } catch {
    throw new Error("--patron no es una expresión válida.");
  }
  const ids = [...new Set((options.ids.length ? options.ids : config.accountIds).map((id) => metaAccountId(id)))];
  if (!ids.length) throw new Error("Indica los IDs de cuenta o configura META_AD_ACCOUNT_IDS.");

  const client = new MetaClient(config);
  const statuses = options.onlyActive ? ["ACTIVE"] : ADSET_STATUSES;
  const rows: MetaAdSetTargeting[] = [];
  const accounts: MetaAccountRead[] = [];
  for (const id of ids) {
    // Tiempo amplio por cuenta: una cuenta grande puede tener muchas páginas de grupos.
    const signal = AbortSignal.timeout(Math.max(config.timeoutMs * 20, 300000));
    let name = id;
    try {
      const info = await client.get<{ name?: unknown }>(`act_${id}`, { fields: "name" }, signal);
      if (typeof info.name === "string" && info.name.trim()) name = info.name.trim();
      const params = { effective_status: JSON.stringify(statuses) };
      let raw: Record<string, unknown>[];
      try {
        raw = await client.list<Record<string, unknown>>(
          `act_${id}/adsets`,
          { ...params, fields: ADSET_FIELDS },
          signal,
        );
      } catch (e) {
        if (!(e instanceof ApiError) || !["INVALID_REQUEST", "PROVIDER_ERROR"].includes(e.code)) throw e;
        raw = await client.list<Record<string, unknown>>(
          `act_${id}/adsets`,
          { ...params, fields: ADSET_FIELDS_FULL_TARGETING },
          signal,
          25,
        );
      }
      const parsed = raw.map((r) => parseAdSet(r, { id, name }));
      rows.push(...parsed);
      accounts.push({ accountId: id, accountName: name, error: null });
      process.stdout.write(`  ${id} ${name}: ${parsed.length} grupos de anuncios\n`);
    } catch (e) {
      accounts.push({ accountId: id, accountName: name, error: safeMessage(e) });
      process.stdout.write(`  ${id}: sin lectura (${safeMessage(e)})\n`);
    }
  }

  const audit = auditExclusions(rows, accounts, pattern);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const file = options.output ?? join("reportes", `exclusiones-clientes-activos-meta-${stamp}.xlsx`);
  const book = buildXlsx(
    exclusionWorkbook(audit, {
      generatedAt: now.toLocaleString("es-MX", { timeZone: "America/Mexico_City" }),
      pattern: options.pattern,
      statuses,
      apiVersion: config.version,
    }),
  );
  if (!options.output) await mkdir("reportes", { recursive: true, mode: 0o700 });
  await writeFile(file, book, { mode: 0o600 });
  await chmod(file, 0o600);

  const active = audit.adSets.filter((s) => s.adSetStatus === "ACTIVE");
  const matched = audit.audiences.filter((a) => a.activeCustomers);
  process.stdout.write(
    `\nGrupos activos: ${active.length}. Con exclusión de clientes activos: ${active.filter((s) => s.excludesActiveCustomers).length}. Sin ella: ${active.filter((s) => !s.excludesActiveCustomers).length}.\n` +
      `Audiencias reconocidas como clientes activos: ${matched.length ? matched.map((a) => a.name).join(" | ") : "ninguna"}.\n`,
  );
  if (!matched.length && audit.audiences.length)
    process.stdout.write(
      "Ninguna audiencia excluida coincide con el patrón. Revisa la hoja Audiencias excluidas y vuelve a correr con --patron.\n",
    );
  const failed = accounts.filter((a) => a.error).length;
  if (failed) process.stdout.write(`Cuentas sin lectura: ${failed} (detalle en la hoja Resumen por cuenta).\n`);
  process.stdout.write(`Excel: ${file}\n`);
}

void main().catch((e: unknown) => {
  process.stderr.write(
    (e instanceof Error && !(e instanceof TypeError) ? e.message : "No se pudo generar el reporte de exclusiones.") +
      "\n",
  );
  process.exitCode = 1;
});
