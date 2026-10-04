import { buildAbsoluteTopReconciliation } from "../src/lib/reconciliation/absolute-top";
import { decodeExport, importAtExportDetailed, importDataslayerAbsoluteTop, type AtImportOptions } from "../src/lib/reconciliation/absolute-top-import";
import { googleDomainsSchema } from "../src/lib/domains/config";
import { join } from "node:path";
import { writeAbsoluteTopReconciliation } from "../src/lib/reconciliation/absolute-top-output";
import { outputPath, readPrivateInputFile, readReferenceFile, writeExclusivePrivateFiles } from "../src/lib/reconciliation/output";
import { ReconciliationError } from "../src/lib/reconciliation/reconcile";
import { AbsoluteTopStore } from "../src/lib/absolute-top/store";

const HELP = `npm run conciliar:absolute-top -- importar --csv export.csv --columnas columnas.json --cuenta 877-953-6058 --nivel campaign|ad_group --fecha YYYY-MM-DD --zona America/Mexico_City --moneda MXN --exportado 2026-10-03T15:00:00Z --decimal . --miles , [--separador coma|punto-y-coma|tab] [--red-etiqueta "Google search" | --red-filtrada-en-ui] --output reportes/referencia.json
npm run conciliar:absolute-top -- importar-dataslayer --csv hoja-absolute-top.csv --fecha YYYY-MM-DD --zona America/Mexico_City --moneda MXN --exportado 2026-10-04T12:03:37-06:00 [--decimal . --miles ninguno --separador coma] [--maestro ../unified-ads-api/src/config/google-ads-domains.json] --directorio reportes/referencias-dataslayer
npm run conciliar:absolute-top -- comparar --referencia ref1.json [--referencia ref2.json ...] [--auditoria AUDIT_ID] [--output reportes/conciliacion-absolute-top.json]
Solo izzi. Compara Impr. (Abs. Top) % nativo por campaña/grupo (metrics.absolute_top_impression_percentage, no Search abs. top IS) contra un export independiente de Google Ads del mismo día cerrado, cuenta, reloj, moneda, red y nivel. No llama APIs ni carga .env; lee las auditorías guardadas mediante RECORDS_BACKEND/RECORDS_DIR inyectados. Sin columna ni filtro de red solo se acepta un informe de campañas sin IDs mapeado por "campaignName" (unión por nombre exacto, solo las dos tasas superiores; las filas con "0" en ambas tasas se omiten y se cuentan). Tolerancia: medio dígito del redondeo mostrado por la interfaz. Maduración: 48 h tras el cierre. Salidas: 0 todo coincide y maduro; 2 diferencias, faltantes, desconocidos o maduración pendiente; 1 fallo. No certifica v1.`;

const SEPARATORS = { coma: ",", "punto-y-coma": ";", tab: "\t" } as const;

function options(args: string[], allowed: string[], flags: string[] = [], repeatable: string[] = []) {
  const values: Record<string, string[]> = {}, set = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.includes(arg)) { if (set.has(arg)) throw new ReconciliationError("INVALID_OPTIONS"); set.add(arg); continue; }
    if (!allowed.includes(arg) || !args[i + 1] || args[i + 1].startsWith("--") || (values[arg] && !repeatable.includes(arg))) throw new ReconciliationError("INVALID_OPTIONS");
    (values[arg] ??= []).push(args[++i]);
  }
  return { one: (name: string) => values[name]?.[0], all: (name: string) => values[name] ?? [], flag: (name: string) => set.has(name) };
}

async function importCommand(args: string[]) {
  const o = options(args, ["--csv", "--columnas", "--cuenta", "--nivel", "--fecha", "--zona", "--moneda", "--exportado", "--decimal", "--miles", "--separador", "--red-etiqueta", "--output"], ["--red-filtrada-en-ui"]);
  const required = ["--csv", "--columnas", "--cuenta", "--nivel", "--fecha", "--zona", "--moneda", "--exportado", "--decimal", "--miles", "--output"];
  if (required.some(name => o.one(name) === undefined)) throw new ReconciliationError("INVALID_OPTIONS");
  const level = o.one("--nivel"), decimal = o.one("--decimal"), thousands = o.one("--miles") === "ninguno" ? "" : o.one("--miles") === "espacio" ? " " : o.one("--miles");
  const separator = SEPARATORS[(o.one("--separador") ?? "coma") as keyof typeof SEPARATORS];
  if ((level !== "campaign" && level !== "ad_group") || (decimal !== "." && decimal !== ",") || ![",", ".", " ", ""].includes(thousands ?? "-") || !separator) throw new ReconciliationError("INVALID_OPTIONS");
  const text = decodeExport(await readPrivateInputFile(o.one("--csv")!, ".csv", "INVALID_AT_EXPORT_FILE"));
  const columns = await readReferenceFile(o.one("--columnas")!).catch(() => { throw new ReconciliationError("INVALID_AT_COLUMNS"); });
  const importOptions: AtImportOptions = {
    customerId: o.one("--cuenta")!, level, date: o.one("--fecha")!, timezone: o.one("--zona")!, currency: o.one("--moneda")!, exportedAt: o.one("--exportado")!,
    decimal, thousands: thousands as AtImportOptions["thousands"], delimiter: separator, networkLabel: o.one("--red-etiqueta"), networkFilteredInUi: o.flag("--red-filtrada-en-ui"),
  };
  const { reference, skippedRows } = importAtExportDetailed(text, columns, importOptions);
  const path = outputPath(o.one("--output"));
  await writeExclusivePrivateFiles([path], [JSON.stringify(reference, null, 2) + "\n"]);
  console.log(JSON.stringify({ module: "absolute_top_reconciliation", step: "import", customerId: reference.customerId, level: reference.level, date: reference.date, joinBy: reference.joinBy, networkEvidence: reference.networkEvidence, rows: reference.rows.length, skippedRows, file: path }));
}

async function dataslayerCommand(args: string[]) {
  const o = options(args, ["--csv", "--fecha", "--zona", "--moneda", "--exportado", "--decimal", "--miles", "--separador", "--maestro", "--directorio"]);
  if (["--csv", "--fecha", "--zona", "--moneda", "--exportado", "--directorio"].some(name => o.one(name) === undefined)) throw new ReconciliationError("INVALID_OPTIONS");
  const decimal = o.one("--decimal") ?? ".", miles = o.one("--miles") ?? "ninguno";
  const thousands = miles === "ninguno" ? "" : miles === "espacio" ? " " : miles;
  const separator = SEPARATORS[(o.one("--separador") ?? "coma") as keyof typeof SEPARATORS];
  if ((decimal !== "." && decimal !== ",") || ![",", ".", " ", ""].includes(thousands) || !separator) throw new ReconciliationError("INVALID_OPTIONS");
  // The versioned master is the only account map; Dataslayer account names must match it exactly.
  const master = googleDomainsSchema.safeParse(await readReferenceFile(o.one("--maestro") ?? "../unified-ads-api/src/config/google-ads-domains.json").catch(() => null));
  if (!master.success) throw new ReconciliationError("MASTER_UNAVAILABLE");
  const text = decodeExport(await readPrivateInputFile(o.one("--csv")!, ".csv", "INVALID_AT_EXPORT_FILE"));
  const result = importDataslayerAbsoluteTop(text, { master: master.data, date: o.one("--fecha")!, timezone: o.one("--zona")!, currency: o.one("--moneda")!, exportedAt: o.one("--exportado")!, decimal, thousands: thousands as AtImportOptions["thousands"], delimiter: separator });
  if (!result.references.length) throw new ReconciliationError("NO_MASTER_ACCOUNTS_FOR_DATE");
  const paths = result.references.map(ref => outputPath(join(o.one("--directorio")!, `dataslayer-at-${ref.customerId}-${ref.date}.json`)));
  await writeExclusivePrivateFiles(paths, result.references.map(ref => JSON.stringify(ref, null, 2) + "\n"));
  console.log(JSON.stringify({ module: "absolute_top_reconciliation", step: "import_dataslayer", date: o.one("--fecha"), references: result.references.map(ref => ({ customerId: ref.customerId, rows: ref.rows.length })), skippedAccounts: result.skippedAccounts, skippedRows: result.skippedRows, files: paths }));
}

async function compareCommand(args: string[]) {
  const o = options(args, ["--referencia", "--auditoria", "--output"], [], ["--referencia"]);
  if (!o.all("--referencia").length) throw new ReconciliationError("INVALID_OPTIONS");
  const references = [];
  for (const path of o.all("--referencia")) references.push(await readReferenceFile(path));
  // Saved audits only: RECORDS_BACKEND/RECORDS_DIR come from the injected runtime, never from .env.
  const store = new AbsoluteTopStore();
  const report = await buildAbsoluteTopReconciliation({ references, history: customer => store.history(customer), auditId: o.one("--auditoria") });
  const files = await writeAbsoluteTopReconciliation(report, o.one("--output"));
  console.log(JSON.stringify({ module: "absolute_top_reconciliation", step: "compare", partitions: report.partitions.length, counts: report.counts, primary: { compared: report.primary.compared, matched: report.primary.matched, differences: report.primary.differences, unknown: report.primary.unknown }, files, exitCode: report.exitCode }));
  process.exitCode = report.exitCode;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["--help", "--ayuda"].includes(command)) { console.log(HELP); return; }
  if (command === "importar") return importCommand(args);
  if (command === "importar-dataslayer") return dataslayerCommand(args);
  if (command === "comparar") return compareCommand(args);
  throw new ReconciliationError("INVALID_OPTIONS");
}
void main().catch(error => {
  console.error(JSON.stringify({ module: "absolute_top_reconciliation", code: error instanceof ReconciliationError ? error.code : "RECONCILIATION_FAILED" }));
  process.exitCode = 1;
});
