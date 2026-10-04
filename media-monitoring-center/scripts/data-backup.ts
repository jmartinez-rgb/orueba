import { BackupError, createBackup, restoreBackup, verifyBackup } from "../src/lib/release/data-backup";

const HELP = `npm run datos:respaldo -- respaldar --destino /ruta/respaldo-AAAAMMDD
npm run datos:respaldo -- verificar --respaldo /ruta/respaldo-AAAAMMDD
npm run datos:respaldo -- restaurar --respaldo /ruta/respaldo-AAAAMMDD --registros /ruta/vacia/records --unified /ruta/vacia/unified
Copia RECORDS_DIR (predeterminado .data/records) y UNIFIED_ADS_DATA_DIR (.data/unified) con manifiesto SHA-256.
Ejecutar con el servidor y el extractor detenidos (un único escritor). No carga .env, no sigue enlaces simbólicos,
no sobrescribe, crea archivos 0600 y directorios 0700, y solo imprime conteos. La restauración verifica todo el
manifiesto antes de copiar y exige destinos vacíos. Guardar el respaldo cifrado y fuera de Git.`;

function options(args: string[], allowed: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values[args[i]]) throw new BackupError("INVALID_OPTIONS");
    values[args[i]] = args[i + 1];
  }
  return values;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["--help", "--ayuda"].includes(command)) { console.log(HELP); return; }
  if (command === "respaldar") {
    const o = options(args, ["--destino"]);
    if (!o["--destino"]) throw new BackupError("INVALID_OPTIONS");
    const summary = await createBackup([
      { label: "records", directory: process.env.RECORDS_DIR?.trim() || ".data/records" },
      { label: "unified", directory: process.env.UNIFIED_ADS_DATA_DIR?.trim() || ".data/unified" },
    ], o["--destino"]);
    console.log(JSON.stringify({ step: "backup", files: summary.files, bytes: summary.bytes, skippedSymlinks: summary.skippedSymlinks, manifest: summary.manifest }));
    return;
  }
  if (command === "verificar") {
    const o = options(args, ["--respaldo"]);
    if (!o["--respaldo"]) throw new BackupError("INVALID_OPTIONS");
    const manifest = await verifyBackup(o["--respaldo"]);
    console.log(JSON.stringify({ step: "verify", ok: true, createdAt: manifest.createdAt, files: manifest.sources.reduce((n, s) => n + s.files.length, 0) }));
    return;
  }
  if (command === "restaurar") {
    const o = options(args, ["--respaldo", "--registros", "--unified"]);
    if (!o["--respaldo"] || !o["--registros"] || !o["--unified"]) throw new BackupError("INVALID_OPTIONS");
    const result = await restoreBackup(o["--respaldo"], { records: o["--registros"], unified: o["--unified"] });
    console.log(JSON.stringify({ step: "restore", ...result }));
    return;
  }
  throw new BackupError("INVALID_OPTIONS");
}
void main().catch(error => {
  console.error(JSON.stringify({ step: "data_backup", code: error instanceof BackupError ? error.code : "BACKUP_FAILED" }));
  process.exitCode = 1;
});
