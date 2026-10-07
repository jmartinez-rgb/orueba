import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { FileRecordStore, RecordStoreError } from "../src/lib/records/store";
import { closePostgresPools, PostgresRecordStore } from "../src/lib/records/postgres";

const HELP = `npm run datos:migrar-postgres -- [--registros .data/records] [--unified .data/unified]
Copia los registros (usuarios, bitácora, tickets, tasas, Absolute Top…) y el histórico de APIs directas desde
los directorios locales a PostgreSQL (DATABASE_URL), para publicar en un alojamiento sin disco persistente
(Replit). No borra el origen. Se niega si el destino ya tiene datos. Verifica cada llave por SHA-256 y solo
imprime conteos y códigos: nunca contenidos, llaves ni la conexión. Las esperas del extractor no se copian.`;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function copy(label: string, directory: string, namespace: string) {
  const source = new FileRecordStore(resolve(directory));
  const target = new PostgresRecordStore(namespace);
  // Scheduler cooldowns are host state, not data: the new host starts its own.
  const keys = (await source.list("")).filter(key => !key.startsWith(".scheduler/"));
  if ((await target.list("")).length) throw new Error(`DESTINATION_NOT_EMPTY_${label.toUpperCase()}`);
  for (const key of keys) {
    const value = await source.get(key);
    if (value === null) throw new Error(`SOURCE_CHANGED_${label.toUpperCase()}`);
    await target.set(key, value);
  }
  let verified = 0;
  for (const key of keys) {
    if (digest(await source.get(key)) !== digest(await target.get(key))) throw new Error(`VERIFICATION_FAILED_${label.toUpperCase()}`);
    verified++;
  }
  return { label, keys: keys.length, verified };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("--ayuda")) { console.log(HELP); return; }
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--registros", "--unified"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options[args[i]]) throw new Error("INVALID_OPTIONS");
    options[args[i]] = args[i + 1];
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_MISSING");
  const results = [
    await copy("registros", options["--registros"] ?? process.env.RECORDS_DIR?.trim() ?? ".data/records", "records"),
    await copy("unified", options["--unified"] ?? process.env.UNIFIED_ADS_DATA_DIR?.trim() ?? ".data/unified", "unified"),
  ];
  console.log(JSON.stringify({ module: "data_migration", destination: "postgres", results }));
}

void main()
  .catch(error => {
    const code = error instanceof RecordStoreError ? "RECORDS_UNAVAILABLE" : error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED";
    console.error(JSON.stringify({ module: "data_migration", code }));
    process.exitCode = 1;
  })
  .finally(() => closePostgresPools());
