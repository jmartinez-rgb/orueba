import { loadEnvConfig } from "@next/env";
import { getEnv } from "../src/lib/config/env";
import { businessDate } from "../src/lib/time/tz";
import { loadUnifiedMapping, openUnifiedStore } from "../src/lib/unified/store";
import { syncUnified } from "../src/lib/unified/sync";
import { UnifiedDataError } from "../src/lib/unified/schema";
import { filterUnifiedMapping, parseSyncOptions } from "../src/lib/unified/cli-options";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("--ayuda")) {
    console.log("npm run unified:sync -- [--from YYYY-MM-DD --to YYYY-MM-DD] [--granularity daily|hourly|both] [--provider google|meta|tiktok|microsoft|spotify|x] [--brand izzi|sky]\nExtrae solo las cuentas del mapeo explícito. --brand limita la marca; sin --brand conserva todas las marcas del mapeo. Hasta 45 días, bloques de tres días, sin imprimir llaves o respuestas privadas. Sin opciones: hoy, diaria y horaria. No publica ni activa alertas externas.");
    return;
  }
  const options = parseSyncOptions(args);
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const env = getEnv(), timezone = env.timezone ?? "America/Mexico_City";
  const store = openUnifiedStore(env.unifiedData);
  if (!store || !env.unifiedApi.url || !env.unifiedApi.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  const mapping = filterUnifiedMapping(await loadUnifiedMapping(), options);
  const mode = options.granularity;
  const today = businessDate(new Date(), timezone);
  const results = await syncUnified({ mapping, store, url: env.unifiedApi.url, apiKey: env.unifiedApi.apiKey, from: options.from ?? today, to: options.to ?? today, granularities: mode === "both" ? ["daily", "hourly"] : [mode], timezone });
  console.log(JSON.stringify({ source: "unified", operations: results }));
  process.exitCode = results.every(r => r.status === "SUCCESS" && r.rows > 0) ? 0 : 2;
}
void main().catch(error => {
  console.error(JSON.stringify({ source: "unified", code: error instanceof UnifiedDataError ? error.code : "SYNC_FAILED" }));
  process.exitCode = 1;
});
