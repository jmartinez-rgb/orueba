import { z } from "zod";
import { prepareEnv } from "../src/config/load-env.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import { MetaClient } from "../src/providers/meta/client.js";
import { metaAccountId, readMetaConfig } from "../src/providers/meta/config.js";
import { readMetaActions, metaActionSheets, type MetaActionRow } from "../src/providers/meta/actions-report.js";
import { yesterdayInZone } from "../src/verification/run.js";
import { writeWorkbook } from "../src/verification/output.js";
import { askHidden } from "../src/utils/cli-secret.js";
import { ApiError } from "../src/utils/errors.js";
import type { XlsxSheet } from "../src/utils/xlsx.js";

function args(argv: string[]) {
  const out = {
    ids: [] as string[],
    from: undefined as string | undefined,
    to: undefined as string | undefined,
    output: undefined as string | undefined,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "--ayuda") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      out.ids.push(...arg.split(",").map(metaAccountId));
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error("Opción sin valor.");
    if (arg === "--desde") out.from = value;
    else if (arg === "--hasta") out.to = value;
    else if (arg === "--cuentas") out.ids.push(...value.split(",").map(metaAccountId));
    else if (arg === "--salida") out.output = value;
    else throw new Error("Opción desconocida.");
  }
  if (
    (out.from !== undefined || out.to !== undefined) &&
    (!out.from ||
      !out.to ||
      !z.iso.date().safeParse(out.from).success ||
      !z.iso.date().safeParse(out.to).success ||
      out.from > out.to ||
      Date.parse(out.to) - Date.parse(out.from) > 30 * 86400000)
  )
    throw new Error("Usa --desde y --hasta con un máximo de 31 días inclusivos.");
  if (out.output && !out.output.toLowerCase().endsWith(".xlsx")) throw new Error("La salida debe ser .xlsx.");
  return out;
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "npm run meta:acciones -- [ID,ID] [--desde YYYY-MM-DD --hasta YYYY-MM-DD] [--salida reportes/acciones.xlsx]\nSin fechas: 7 días hasta ayer en la zona de cada cuenta. Lista acciones reales por CAPI WhatsApp y Resto; no elige la principal.\n",
    );
    return;
  }
  prepareEnv();
  if (!process.env.META_ACCESS_TOKEN?.trim()) {
    const token = await askHidden("Token de Meta con ads_read (entrada oculta, no se guarda): ");
    if (token) process.env.META_ACCESS_TOKEN = token;
  }
  // Inventory works even when a primary-action configuration needs correction; it never selects one.
  const env = {
    ...process.env,
    META_PRIMARY_CONVERSION_RULES: "",
    META_PRIMARY_CONVERSION_MAPPING: "",
    META_PRIMARY_CONVERSION_ACTION: "",
    ...(options.ids.length ? { META_AD_ACCOUNT_IDS: [...new Set(options.ids)].join(",") } : {}),
  };
  const { config } = readMetaConfig(env, 120000);
  if (!config) throw new Error("Configuración de Meta incompleta.");
  const provider = new MetaProvider(env, { timeoutMs: 120000 }),
    client = new MetaClient(config);
  const accounts = await provider.listAccounts({});
  const rows: MetaActionRow[] = [],
    coverage: XlsxSheet = {
      name: "Cobertura",
      columns: ["Cuenta ID", "Desde", "Hasta", "Estado", "Nombres disponibles", "Códigos", "Filas"].map((header) => ({
        header,
        width: 24,
      })),
      rows: [],
    };
  let partial = false;
  const now = new Date();
  for (const account of accounts) {
    let from = options.from,
      to = options.to;
    const warnings: string[] = [];
    try {
      to ??= yesterdayInZone(now, account.timezone);
      from ??= new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10);
      const read = await readMetaActions(
        client,
        account,
        { account_id: account.account_id, date_from: from, date_to: to, granularity: "daily" },
        AbortSignal.timeout(config.timeoutMs),
        (e) => warnings.push(e.code),
      );
      if (rows.length + read.rows.length > 200000) throw new ApiError("PROVIDER_ERROR", "Límite de filas excedido.");
      rows.push(...read.rows);
      coverage.rows.push([
        account.account_id,
        from,
        to,
        warnings.length ? "partial" : read.rows.length ? "ok" : "empty",
        read.metadataAvailable ? "Sí" : "No",
        warnings.join(", "),
        read.rows.length,
      ]);
      partial ||= warnings.length > 0;
    } catch (error) {
      coverage.rows.push([
        account.account_id,
        from,
        to,
        "error",
        "No",
        error instanceof ApiError ? error.code : "UNKNOWN",
        0,
      ]);
      partial = true;
    }
  }
  const notes: XlsxSheet = {
    name: "Criterios",
    columns: [
      { header: "Tema", width: 25 },
      { header: "Criterio", width: 100 },
    ],
    rows: [
      [
        "Separación",
        "CAPI WhatsApp por nombre literal; Resto y Sin nombre se mantienen separados por cuenta, moneda y acción exacta.",
      ],
      [
        "Volumen",
        "Solo acciones observadas; no sumar alias, compras omnicanal ni acciones superpuestas como venta total.",
      ],
      [
        "Decisión",
        "Nombres personalizados ayudan a identificar IDs; la acción principal y los IDs exactos requieren decisión del equipo.",
      ],
      [
        "Atribución",
        "action_report_time=impression y use_unified_attribution_setting=true. Conciliar con el mismo criterio.",
      ],
      [
        "Ausencias",
        "Celdas vacías no significan cero. empty significa sin acciones devueltas, no ausencia demostrada de ventas.",
      ],
    ],
  };
  const output = await writeWorkbook("meta-acciones", [coverage, ...metaActionSheets(rows), notes], options.output);
  process.stdout.write(
    `Excel guardado: ${output}\n${accounts.length} cuentas; ${rows.length} filas de acciones observadas. La acción principal sigue siendo una decisión del equipo.\n`,
  );
  process.exitCode = partial || !accounts.length ? 2 : 0;
}
void main().catch(() => {
  process.stderr.write(
    "No se pudo completar meta:acciones. Revisa opciones, acceso ads_read y configuración privada; no se muestran valores ni cuerpos de error.\n",
  );
  process.exitCode = 1;
});
