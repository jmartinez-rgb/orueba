import { resolve } from "node:path";
import { buildReconciliation, dateRange, ReconciliationError } from "../src/lib/reconciliation/reconcile";
import { readReferenceFile, writeReconciliationArtifacts } from "../src/lib/reconciliation/output";
import { openUnifiedStore, UnifiedSnapshotStore } from "../src/lib/unified/store";
import { mappingSchema, UnifiedDataError } from "../src/lib/unified/schema";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "--ayuda"].includes(args[0])) {
    console.log("npm run conciliar -- --from YYYY-MM-DD --to YYYY-MM-DD [--reference reporte-ads-manager.json] [--output reportes/conciliacion.json]\nSolo izzi, 1–45 días cerrados, totales diarios en moneda/reloj originales. Sin API, secretos, FX, conversiones ni publicación. JSON canónico + CSV privado + plantilla TEMPLATE vacía. Salidas: 0 coincidencias sin pendientes; 2 pendientes/diferencias; 1 fallo. Esto no acepta v1 ni certifica producción.");
    return;
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--from", "--to", "--reference", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values[args[i]]) throw new ReconciliationError("INVALID_OPTIONS");
    values[args[i]] = args[i + 1];
  }
  if (!values["--from"] || !values["--to"]) throw new ReconciliationError("INVALID_OPTIONS");
  dateRange(values["--from"], values["--to"]);
  // Read only nonsecret injected configuration. This command never loads a .env file.
  const root = resolve(process.env.UNIFIED_ADS_DATA_DIR?.trim() || ".data/unified");
  let value: unknown;
  try { value = process.env.UNIFIED_ADS_MAPPING?.trim() ? JSON.parse(process.env.UNIFIED_ADS_MAPPING) : await readReferenceFile(process.env.UNIFIED_ADS_MAPPING_FILE?.trim() || "config/unified.mapping.json"); }
  catch { throw new ReconciliationError("INVALID_MAPPING"); }
  const mapping = mappingSchema.safeParse(value);
  if (!mapping.success) throw new ReconciliationError("INVALID_MAPPING");
  const reference = values["--reference"] ? await readReferenceFile(values["--reference"]) : undefined;
  const report = await buildReconciliation({ mapping: mapping.data, store: process.env.UNIFIED_ADS_STORE?.trim().toLowerCase() === "postgres" ? openUnifiedStore({ directory: undefined, store: "postgres" })! : new UnifiedSnapshotStore(root), from: values["--from"], to: values["--to"], reference });
  const files = await writeReconciliationArtifacts(report, values["--output"]);
  console.log(JSON.stringify({ brand: "izzi", rows: report.rows.length, counts: report.counts, files, exitCode: report.exitCode }));
  process.exitCode = report.exitCode;
}
void main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof ReconciliationError || error instanceof UnifiedDataError ? error.code : "RECONCILIATION_FAILED" }));
  process.exitCode = 1;
});
