import { decodeExport } from "../src/lib/reconciliation/absolute-top-import";
import { buildAccountReference, importAccountReferenceRows } from "../src/lib/reconciliation/account-reference-import";
import { outputPath, readPrivateInputFile, readReferenceFile, writeExclusivePrivateFiles } from "../src/lib/reconciliation/output";
import { ReconciliationError } from "../src/lib/reconciliation/reconcile";
import { mappingSchema } from "../src/lib/unified/schema";

const HELP = `npm run conciliar:referencia -- --plataforma google|meta|tiktok|microsoft|spotify|x --csv export.csv --columnas columnas.json --fecha YYYY-MM-DD --zona America/Mexico_City --exportado 2026-10-04T23:00:00Z [--decimal . --miles , --separador coma|punto-y-coma|tab] [--cuenta ID] [--anexar referencia-previa.json] --output reportes/referencia-cuentas.json
Convierte un export de la interfaz (un solo día) en filas cuenta/día para npm run conciliar -- --reference. Suma por cuenta, omite y cuenta las cuentas fuera del mapeo izzi (UNIFIED_ADS_MAPPING_FILE o config/unified.mapping.json), nunca convierte moneda ni reloj. --anexar agrega otra plataforma a una referencia previa en un archivo nuevo. Solo exports de la interfaz: Dataslayer u otras extracciones por API no son ADS_MANAGER.`;

const SEPARATORS = { coma: ",", "punto-y-coma": ";", tab: "\t" } as const;
const PLATFORMS = ["google", "meta", "tiktok", "microsoft", "spotify", "x"] as const;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || ["--help", "--ayuda"].includes(args[0])) { console.log(HELP); return; }
  const allowed = ["--plataforma", "--csv", "--columnas", "--fecha", "--zona", "--exportado", "--decimal", "--miles", "--separador", "--cuenta", "--anexar", "--output"];
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || o[args[i]]) throw new ReconciliationError("INVALID_OPTIONS");
    o[args[i]] = args[i + 1];
  }
  if (["--plataforma", "--csv", "--columnas", "--fecha", "--zona", "--exportado", "--output"].some(name => !o[name])) throw new ReconciliationError("INVALID_OPTIONS");
  const platform = o["--plataforma"] as typeof PLATFORMS[number];
  const decimal = o["--decimal"] ?? ".", miles = o["--miles"] ?? ",";
  const thousands = miles === "ninguno" ? "" : miles === "espacio" ? " " : miles;
  const delimiter = SEPARATORS[(o["--separador"] ?? "coma") as keyof typeof SEPARATORS];
  if (!PLATFORMS.includes(platform) || (decimal !== "." && decimal !== ",") || ![",", ".", " ", ""].includes(thousands) || decimal === thousands || !delimiter) throw new ReconciliationError("INVALID_OPTIONS");
  // Same nonsecret mapping source as npm run conciliar; this command never loads .env.
  let mappingValue: unknown;
  try { mappingValue = process.env.UNIFIED_ADS_MAPPING?.trim() ? JSON.parse(process.env.UNIFIED_ADS_MAPPING) : await readReferenceFile(process.env.UNIFIED_ADS_MAPPING_FILE?.trim() || "config/unified.mapping.json"); }
  catch { throw new ReconciliationError("INVALID_MAPPING"); }
  const mapping = mappingSchema.safeParse(mappingValue);
  if (!mapping.success) throw new ReconciliationError("INVALID_MAPPING");
  const text = decodeExport(await readPrivateInputFile(o["--csv"], ".csv", "INVALID_ACCOUNT_EXPORT_FILE"));
  const columns = await readReferenceFile(o["--columnas"]).catch(() => { throw new ReconciliationError("INVALID_ACCOUNT_COLUMNS"); });
  const result = importAccountReferenceRows(text, columns, { platform, mapping: mapping.data, date: o["--fecha"], timezone: o["--zona"], decimal, thousands: thousands as "," | "." | " " | "", delimiter, accountId: o["--cuenta"] });
  if (!result.rows.length) throw new ReconciliationError("NO_IZZI_ACCOUNTS_IN_EXPORT");
  const previous = o["--anexar"] ? await readReferenceFile(o["--anexar"]) : undefined;
  const reference = buildAccountReference(result.rows, { date: o["--fecha"], exportedAt: o["--exportado"] }, previous);
  const path = outputPath(o["--output"]);
  await writeExclusivePrivateFiles([path], [JSON.stringify(reference, null, 2) + "\n"]);
  console.log(JSON.stringify({ module: "account_reference", platform, date: o["--fecha"], accounts: result.rows.map(r => r.accountId), sourceRows: result.sourceRows, skippedRows: result.skippedRows, skippedAccounts: result.skippedAccounts, referenceRows: reference.rows.length, file: path }));
}
void main().catch(error => {
  console.error(JSON.stringify({ module: "account_reference", code: error instanceof ReconciliationError ? error.code : "ACCOUNT_REFERENCE_FAILED" }));
  process.exitCode = 1;
});
