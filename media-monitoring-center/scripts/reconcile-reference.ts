import { decodeExport, parseDelimited } from "../src/lib/reconciliation/absolute-top-import";
import { applyAccountTimezones, buildAccountReference, importAccountReferenceRecords } from "../src/lib/reconciliation/account-reference-import";
import { outputPath, readPrivateInputFile, readReferenceFile, writeExclusivePrivateFiles } from "../src/lib/reconciliation/output";
import { ReconciliationError, type ReferenceRow } from "../src/lib/reconciliation/reconcile";
import { readXlsxRecords } from "../src/lib/reconciliation/xlsx";
import { mappingSchema } from "../src/lib/unified/schema";

const HELP = `npm run conciliar:referencia -- --plataforma google|meta|tiktok|microsoft|spotify|x --columnas columnas.json --fecha YYYY-MM-DD --zona America/Mexico_City --exportado 2026-10-04T23:00:00Z (--archivo export.csv|.xlsx [--cuenta ID] | --entrada CUENTA=export.csv|.xlsx [--entrada …]) [--decimal . --miles , --separador coma|punto-y-coma|tab] [--zona-cuenta ID=Zona …] [--anexar referencia-previa.json] --output reportes/referencia-cuentas.json
Convierte exports de la interfaz (un solo día) en filas cuenta/día para npm run conciliar -- --reference. --archivo lee un export con columna de cuenta (o de una cuenta con --cuenta); --entrada, repetible, lee un export por cuenta. Acepta CSV o .xlsx de una sola hoja. Suma por cuenta, omite y cuenta las cuentas fuera del mapeo izzi (UNIFIED_ADS_MAPPING_FILE o config/unified.mapping.json), nunca convierte moneda ni reloj. --zona-cuenta, repetible, declara la zona de una cuenta que reporta en otro reloj (Google exporta cada cuenta en su propia zona). --anexar agrega otra plataforma a una referencia previa en un archivo nuevo. Solo exports de la interfaz: Dataslayer u otras extracciones por API no son ADS_MANAGER.`;

const SEPARATORS = { coma: ",", "punto-y-coma": ";", tab: "\t" } as const;
const PLATFORMS = ["google", "meta", "tiktok", "microsoft", "spotify", "x"] as const;

async function records(path: string, delimiter: "," | ";" | "\t"): Promise<string[][]> {
  if (path.toLowerCase().endsWith(".xlsx")) return readXlsxRecords(await readPrivateInputFile(path, ".xlsx", "INVALID_ACCOUNT_EXPORT_FILE"));
  return parseDelimited(decodeExport(await readPrivateInputFile(path, ".csv", "INVALID_ACCOUNT_EXPORT_FILE")), delimiter);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || ["--help", "--ayuda"].includes(args[0])) { console.log(HELP); return; }
  const allowed = ["--plataforma", "--archivo", "--csv", "--entrada", "--columnas", "--fecha", "--zona", "--exportado", "--decimal", "--miles", "--separador", "--cuenta", "--zona-cuenta", "--anexar", "--output"];
  const o: Record<string, string> = {}, inputs: { accountId?: string; path: string }[] = [], zones: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!allowed.includes(name) || !value || value.startsWith("--") || (!["--entrada", "--zona-cuenta"].includes(name) && o[name])) throw new ReconciliationError("INVALID_OPTIONS");
    if (name === "--zona-cuenta") {
      const split = value.indexOf("=");
      if (split < 1 || split === value.length - 1 || zones[value.slice(0, split)]) throw new ReconciliationError("INVALID_OPTIONS");
      zones[value.slice(0, split)] = value.slice(split + 1);
    } else if (name === "--entrada") {
      const split = value.indexOf("=");
      if (split < 1 || split === value.length - 1) throw new ReconciliationError("INVALID_OPTIONS");
      inputs.push({ accountId: value.slice(0, split), path: value.slice(split + 1) });
    } else o[name] = value;
  }
  const file = o["--archivo"] ?? o["--csv"];
  if ((o["--archivo"] && o["--csv"]) || (file ? inputs.length > 0 : !inputs.length) || (o["--cuenta"] && !file)) throw new ReconciliationError("INVALID_OPTIONS");
  if (file) inputs.push({ accountId: o["--cuenta"], path: file });
  if (["--plataforma", "--columnas", "--fecha", "--zona", "--exportado", "--output"].some(name => !o[name])) throw new ReconciliationError("INVALID_OPTIONS");
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
  const columns = await readReferenceFile(o["--columnas"]).catch(() => { throw new ReconciliationError("INVALID_ACCOUNT_COLUMNS"); });
  const rows: ReferenceRow[] = [];
  let sourceRows = 0, skippedRows = 0, skippedAccounts = 0;
  for (const [index, input] of inputs.entries()) {
    try {
      const result = importAccountReferenceRecords(await records(input.path, delimiter), columns, { platform, mapping: mapping.data, date: o["--fecha"], timezone: o["--zona"], decimal, thousands: thousands as "," | "." | " " | "", delimiter, accountId: input.accountId });
      rows.push(...result.rows); sourceRows += result.sourceRows; skippedRows += result.skippedRows; skippedAccounts += result.skippedAccounts;
    } catch (error) {
      // Name which input failed by position, never by path or content.
      if (inputs.length > 1 && error instanceof ReconciliationError) throw new ReconciliationError(`${error.code}_ENTRADA_${index + 1}`);
      throw error;
    }
  }
  if (!rows.length) throw new ReconciliationError("NO_IZZI_ACCOUNTS_IN_EXPORT");
  rows.splice(0, rows.length, ...applyAccountTimezones(rows, zones));
  const previous = o["--anexar"] ? await readReferenceFile(o["--anexar"]) : undefined;
  const reference = buildAccountReference(rows, { date: o["--fecha"], exportedAt: o["--exportado"] }, previous);
  const path = outputPath(o["--output"]);
  await writeExclusivePrivateFiles([path], [JSON.stringify(reference, null, 2) + "\n"]);
  console.log(JSON.stringify({ module: "account_reference", platform, date: o["--fecha"], inputs: inputs.length, accounts: rows.map(r => r.accountId), sourceRows, skippedRows, skippedAccounts, referenceRows: reference.rows.length, file: path }));
}
void main().catch(error => {
  console.error(JSON.stringify({ module: "account_reference", code: error instanceof ReconciliationError ? error.code : "ACCOUNT_REFERENCE_FAILED" }));
  process.exitCode = 1;
});
