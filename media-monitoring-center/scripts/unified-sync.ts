import { loadEnvConfig } from "@next/env";
import { getEnv } from "../src/lib/config/env";
import { businessDate } from "../src/lib/time/tz";
import { loadUnifiedMapping, UnifiedSnapshotStore } from "../src/lib/unified/store";
import { syncUnified } from "../src/lib/unified/sync";
import { UnifiedDataError } from "../src/lib/unified/schema";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("--ayuda")) {
    console.log("npm run unified:sync -- [--from YYYY-MM-DD --to YYYY-MM-DD] [--granularity daily|hourly|both] [--provider google|meta|tiktok|microsoft|spotify|x]\nExtrae solo las cuentas del mapeo explícito. Hasta 45 días, bloques de tres días, sin imprimir llaves o respuestas privadas. Sin opciones: hoy, diaria y horaria. No publica ni activa alertas externas.");
    return;
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--from", "--to", "--granularity", "--provider"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values[args[i]]) throw new UnifiedDataError("INVALID_OPTIONS");
    values[args[i]] = args[i + 1];
  }
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const env = getEnv(), timezone = env.timezone ?? "America/Mexico_City";
  if (!env.unifiedData.directory || !env.unifiedApi.url || !env.unifiedApi.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  let mapping = await loadUnifiedMapping();
  if (values["--provider"]) mapping = { ...mapping, accounts: mapping.accounts.filter(a => a.platform === values["--provider"]) };
  if (!mapping.accounts.length) throw new UnifiedDataError("NO_MAPPED_ACCOUNTS");
  const mode = values["--granularity"] ?? "both";
  if (!["daily", "hourly", "both"].includes(mode)) throw new UnifiedDataError("INVALID_OPTIONS");
  const today = businessDate(new Date(), timezone);
  const results = await syncUnified({ mapping, store: new UnifiedSnapshotStore(env.unifiedData.directory), url: env.unifiedApi.url, apiKey: env.unifiedApi.apiKey, from: values["--from"] ?? today, to: values["--to"] ?? today, granularities: mode === "both" ? ["daily", "hourly"] : [mode as "daily" | "hourly"], timezone });
  console.log(JSON.stringify({ source: "unified", operations: results }));
  process.exitCode = results.every(r => r.status === "SUCCESS" && r.rows > 0) ? 0 : 2;
}
void main().catch(error => {
  console.error(JSON.stringify({ source: "unified", code: error instanceof UnifiedDataError ? error.code : "SYNC_FAILED" }));
  process.exitCode = 1;
});
