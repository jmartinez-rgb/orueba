import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareEnv } from "../src/config/load-env.js";
import { MetaClient } from "../src/providers/meta/client.js";
import { metaAccountId, readMetaConfig } from "../src/providers/meta/config.js";
import {
  ACTIONS_INSIGHT_FIELDS,
  CUSTOM_CONVERSION_FIELDS,
  actionsWorkbook,
  aggregateActions,
  type ActionRow,
} from "../src/providers/meta/actions-report.js";
import { buildXlsx } from "../src/utils/xlsx.js";
import { ApiError } from "../src/utils/errors.js";
import { askHidden } from "./lib/hidden-input.js";

/**
 * Acciones que reporta cada cuenta de Meta en un periodo, por universo (CAPI WhatsApp y el resto),
 * para decidir la acción principal. Solo lectura. Uso:
 *   npm run meta:acciones -- 902854812517704 801573051220234
 *   npm run meta:acciones -- --desde 2026-09-01 --hasta 2026-09-30 <IDs>
 * Sin fechas usa los 7 días completos anteriores; sin IDs, META_AD_ACCOUNT_IDS.
 */

function args(argv: string[]) {
  const ids: string[] = [];
  let since: string | undefined, until: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--desde") since = argv[++i];
    else if (arg === "--hasta") until = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Opción desconocida: ${arg}`);
    else ids.push(...arg.split(/[\s,]+/).filter(Boolean));
  }
  for (const d of [since, until])
    if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Las fechas van como AAAA-MM-DD.");
  return { ids, since, until };
}

async function main() {
  prepareEnv();
  const options = args(process.argv.slice(2));
  if (!process.env.META_ACCESS_TOKEN?.trim()) {
    const token = await askHidden("Pega tu token de Meta con ads_read (no se muestra ni se guarda) y presiona Enter: ");
    if (token) process.env.META_ACCESS_TOKEN = token;
  }
  const { config, missing } = readMetaConfig(process.env);
  if (!config)
    throw new Error(`Configura Meta en .env antes de continuar (faltan o son inválidas: ${missing.join(", ")}).`);
  const ids = [...new Set((options.ids.length ? options.ids : config.accountIds).map((id) => metaAccountId(id)))];
  if (!ids.length) throw new Error("Indica los IDs de cuenta o configura META_AD_ACCOUNT_IDS.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const until = options.until ?? new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const since = options.since ?? new Date(Date.parse(until) - 6 * 86_400_000).toISOString().slice(0, 10);
  const client = new MetaClient(config);
  const rows: ActionRow[] = [];
  const accounts: Array<{ id: string; name: string; error: string | null }> = [];
  for (const id of ids) {
    const signal = AbortSignal.timeout(Math.max(config.timeoutMs * 20, 300000));
    let name = id;
    try {
      const info = await client.get<{ name?: unknown }>(`act_${id}`, { fields: "name" }, signal);
      if (typeof info.name === "string" && info.name.trim()) name = info.name.trim();
      const [insights, customs] = await Promise.all([
        client.list<Record<string, unknown>>(
          `act_${id}/insights`,
          {
            level: "campaign",
            fields: ACTIONS_INSIGHT_FIELDS,
            time_range: JSON.stringify({ since, until }),
            action_report_time: "impression",
            use_unified_attribution_setting: "true",
          },
          signal,
        ),
        client
          .list<Record<string, unknown>>(`act_${id}/customconversions`, { fields: CUSTOM_CONVERSION_FIELDS }, signal)
          .catch(() => []),
      ]);
      const names = new Map(
        customs.flatMap((c) =>
          typeof c.id === "string" && typeof c.name === "string" ? [[c.id, c.name] as const] : [],
        ),
      );
      const found = aggregateActions({ id, name }, insights, names);
      rows.push(...found);
      accounts.push({ id, name, error: null });
      process.stdout.write(
        `  ${id} ${name}: ${found.length} acciones (${found.filter((r) => r.matchesRule).length} coinciden con la regla)\n`,
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Error inesperado al leer la cuenta.";
      accounts.push({ id, name, error: message });
      process.stdout.write(`  ${id}: sin lectura (${message})\n`);
    }
  }
  const now = new Date();
  await mkdir("reportes", { recursive: true, mode: 0o700 });
  const file = join("reportes", `acciones-meta-${since}_${until}.xlsx`);
  await writeFile(
    file,
    buildXlsx(
      actionsWorkbook(rows, accounts, {
        since,
        until,
        generatedAt: now.toLocaleString("es-MX", { timeZone: "America/Mexico_City" }),
      }),
    ),
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  process.stdout.write(
    `\nPeriodo ${since} a ${until}. Excel: ${file}\nRevisa la hoja "Configuración por confirmar" antes de cambiar .env.\n`,
  );
}

void main().catch((e: unknown) => {
  process.stderr.write(
    (e instanceof Error && !(e instanceof TypeError) ? e.message : "No se pudo generar el reporte de acciones.") + "\n",
  );
  process.exitCode = 1;
});
