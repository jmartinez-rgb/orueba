import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareEnv } from "../src/config/load-env.js";
import { GoogleAdsClient } from "../src/providers/google/client.js";
import { customerId, readGoogleConfig } from "../src/providers/google/config.js";
import { analyzeAccount, type AccountAudit } from "../src/providers/google/audit/analyze.js";
import { collectAccount, failureReason, type Searcher } from "../src/providers/google/audit/collect.js";
import { checkUrls } from "../src/providers/google/audit/url-check.js";
import { auditMarkdown, formatCustomerId } from "../src/providers/google/audit/report.js";
import { auditWorkbook } from "../src/providers/google/audit/workbook.js";
import { AUDIT_TARGETS, type AuditTarget } from "../src/providers/google/audit/types.js";
import { buildXlsx } from "../src/utils/xlsx.js";
import { isApiError } from "../src/utils/errors.js";

/**
 * Auditoría de Google Ads cuenta por cuenta. SOLO LECTURA: únicamente consultas GAQL (googleAds:search)
 * y, opcionalmente, una petición GET sin cookies a cada página de destino para detectar errores 4xx/5xx.
 * No modifica campañas, presupuestos, pujas, conversiones, anuncios ni ninguna otra configuración.
 * Usa las credenciales de Google del .env local y nunca las muestra. Uso:
 *   npm run google:auditoria
 *   npm run google:auditoria -- --cuentas 877-953-6058,621-410-9105 --hasta 2026-09-30 --sin-urls
 * Deja un informe Markdown y un Excel de evidencia en reportes/ (fuera de git).
 */

function args(argv: string[]) {
  let ids: string[] | undefined;
  let end: string | undefined;
  let urls = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--cuentas")
      ids = (argv[++i] ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((id) => customerId(id));
    else if (arg === "--hasta") end = argv[++i];
    else if (arg === "--sin-urls") urls = false;
    else throw new Error(`Opción desconocida: ${arg}`);
  }
  if (end !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("--hasta debe tener formato AAAA-MM-DD.");
  return { ids, end, urls };
}

async function main() {
  prepareEnv();
  const options = args(process.argv.slice(2));
  const { config, missing } = readGoogleConfig(process.env, 120000);
  if (!config)
    throw new Error(`Configura Google Ads en .env antes de continuar (faltan o son inválidas: ${missing.join(", ")}).`);
  const targets: AuditTarget[] = options.ids
    ? options.ids.map(
        (id) => AUDIT_TARGETS.find((t) => t.id === id) ?? { id, name: `Cuenta ${formatCustomerId(id)}`, priority: 2 },
      )
    : AUDIT_TARGETS;
  const client = new GoogleAdsClient(config);
  const searcher: Searcher = {
    search: (id, query, signal) => client.search(id, query, signal) as unknown as Promise<Record<string, unknown>[]>,
  };
  process.stdout.write(`Auditoría de Google Ads (${config.version}), solo lectura, ${targets.length} cuentas.\n`);
  const audits: AccountAudit[] = [];
  for (const target of targets) {
    process.stdout.write(`\n${target.name} (${target.id})\n`);
    try {
      const data = await collectAccount(searcher, target, {
        end: options.end,
        timeoutMs: config.timeoutMs,
        checkUrls: options.urls ? checkUrls : undefined,
        onProgress: (m) => process.stdout.write(`  ${m}\n`),
      });
      const audit = analyzeAccount(data);
      audits.push(audit);
      const count = (p: string) => audit.findings.filter((f) => f.priority === p).length;
      process.stdout.write(
        audit.status === "ok"
          ? `  Hallazgos: P0 ${count("P0")}, P1 ${count("P1")}, P2 ${count("P2")}, P3 ${count("P3")}, P4 ${count("P4")}; quick wins ${audit.quickWins.length}; secciones sin datos ${data.unavailable.length}.\n`
          : `  Sin lectura: ${data.unavailable.map((u) => `${u.section} ${u.reason}`).join("; ")}\n`,
      );
    } catch (e) {
      // Autenticación o acceso del proyecto: ninguna otra cuenta podrá leerse.
      throw new Error(`Google Ads rechazó la lectura (${failureReason(e)}). ${isApiError(e) ? e.message : ""}`.trim(), {
        cause: e,
      });
    }
  }
  const now = new Date();
  const generatedAt = now.toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "")
    .replace(/^(\d{8})/, "$1-");
  await mkdir("reportes", { recursive: true, mode: 0o700 });
  const md = join("reportes", `auditoria-google-ads-${stamp}.md`);
  const xlsx = join("reportes", `auditoria-google-ads-${stamp}.xlsx`);
  await writeFile(md, auditMarkdown(audits, { generatedAt, version: config.version }), { mode: 0o600 });
  await writeFile(xlsx, buildXlsx(auditWorkbook(audits, { generatedAt, version: config.version })), { mode: 0o600 });
  await chmod(md, 0o600);
  await chmod(xlsx, 0o600);
  process.stdout.write(`\nInforme: ${md}\nEvidencia: ${xlsx}\n`);
}

void main().catch((e: unknown) => {
  process.stderr.write(
    (e instanceof Error && !(e instanceof TypeError) ? e.message : "No se pudo completar la auditoría.") + "\n",
  );
  process.exitCode = 1;
});
