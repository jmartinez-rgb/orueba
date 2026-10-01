import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareEnv } from "../src/config/load-env.js";
import { updateEnvFile } from "../src/config/env-file.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { runChecks, verificationWorkbook } from "../src/verification/real-check.js";
import { buildXlsx } from "../src/utils/xlsx.js";
import { askHidden } from "./lib/hidden-input.js";

/**
 * Primera lectura real de las plataformas configuradas en .env: estado, cuentas, campañas,
 * presupuestos, salud de entrega y rendimiento de un día. Solo lectura. Deja un Excel en reportes/
 * (fuera de git) con conteos, códigos de error y totales para conciliar; nunca tokens ni respuestas
 * crudas. Si una plataforma rota su refresh token durante la lectura, se guarda en .env (0600).
 * Uso:
 *   npm run verificar
 *   npm run verificar -- --fecha 2026-09-30 --plataformas meta,google
 */

function args(argv: string[]) {
  let date: string | undefined;
  let only: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--fecha") date = argv[++i];
    else if (arg === "--plataformas")
      only = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else throw new Error(`Opción desconocida: ${arg}`);
  }
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("--fecha debe tener formato AAAA-MM-DD.");
  return { date, only };
}

function yesterdayInMexico(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
  return new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  prepareEnv();
  const options = args(process.argv.slice(2));
  if (!process.env.META_ACCESS_TOKEN?.trim() && process.stdin.isTTY) {
    const token = await askHidden("Token de Meta con ads_read (Enter para omitir Meta; no se muestra ni se guarda): ");
    if (token) process.env.META_ACCESS_TOKEN = token;
  }
  const rotated: string[] = [];
  const registry = ProviderRegistry.fromEnv(
    process.env,
    Number(process.env.PROVIDER_TIMEOUT_MS) || 15000,
    (name, token) => {
      rotated.push(name);
      void updateEnvFile(".env", { [name]: token }).catch(() =>
        process.stderr.write(`No se pudo guardar ${name} rotado en .env; vuelve a autorizar si deja de funcionar.\n`),
      );
    },
  );
  const providers = registry.list().filter((p) => !options.only || options.only.includes(p.slug));
  const date = options.date ?? yesterdayInMexico();
  process.stdout.write(`Lectura real del ${date} (${providers.map((p) => p.slug).join(", ")}). Solo lectura.\n`);
  const result = await runChecks(providers, date, (row) =>
    process.stdout.write(
      `  ${row.platform.padEnd(10)} ${row.check.padEnd(13)} ${row.result.padEnd(8)}${row.count !== null ? ` ${row.count} filas` : ""}${row.code ? ` · ${row.code}` : ""}${row.message ? ` · ${row.message}` : ""}\n`,
    ),
  );
  const now = new Date();
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "")
    .replace(/^(\d{8})/, "$1-");
  await mkdir("reportes", { recursive: true, mode: 0o700 });
  const file = join("reportes", `verificacion-${stamp}.xlsx`);
  await writeFile(
    file,
    buildXlsx(verificationWorkbook(result, now.toLocaleString("es-MX", { timeZone: "America/Mexico_City" }))),
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  const errors = result.checks.filter((c) => c.result === "ERROR").length;
  process.stdout.write(
    `\n${result.checks.filter((c) => c.result === "OK").length} consultas correctas, ${errors} con error, ${result.warnings.length} avisos.\n` +
      (rotated.length ? `Tokens rotados guardados en .env: ${[...new Set(rotated)].join(", ")}.\n` : "") +
      `Excel: ${file}\n`,
  );
}

void main().catch((e: unknown) => {
  process.stderr.write(
    (e instanceof Error && !(e instanceof TypeError) ? e.message : "No se pudo completar la verificación.") + "\n",
  );
  process.exitCode = 1;
});
