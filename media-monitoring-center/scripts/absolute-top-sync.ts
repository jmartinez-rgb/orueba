import { loadEnvConfig } from "@next/env";
import { DEFAULT_SETTINGS } from "../src/lib/config/settings";
import { getEnv } from "../src/lib/config/env";
import { AbsoluteTopError } from "../src/lib/absolute-top/types";
import { syncAbsoluteTop } from "../src/lib/absolute-top/ingest";
import { openUnifiedStore } from "../src/lib/unified/store";
import { addDays, businessDate } from "../src/lib/time/tz";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("--ayuda")) { console.log("npm run absolute-top:sync -- [--from YYYY-MM-DD --to YYYY-MM-DD] [--granularity daily|hourly] [--dry-run]\nLectura de Search activo y sus grupos, hasta siete días y cuentas del master central. Sin opciones: tres días hasta ayer, diaria. --dry-run valida sin persistir. No imprime métricas privadas o llaves, no modifica Google ni envía alertas."); return; }
  const options: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < args.length; i++) { const arg = args[i]; if (arg === "--dry-run") { if (dryRun) throw new AbsoluteTopError("INVALID_OPTIONS"); dryRun = true; continue; } if (!["--from", "--to", "--granularity"].includes(arg) || options[arg] || !args[i + 1] || args[i + 1].startsWith("--")) throw new AbsoluteTopError("INVALID_OPTIONS"); options[arg] = args[++i]; }
  if ((options["--from"] === undefined) !== (options["--to"] === undefined) || (options["--granularity"] && !["daily", "hourly"].includes(options["--granularity"]))) throw new AbsoluteTopError("INVALID_OPTIONS");
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const env = getEnv();
  const cache = openUnifiedStore(env.unifiedData);
  if (!env.unifiedApi.url || !env.unifiedApi.apiKey || !cache) throw new AbsoluteTopError("API_CONFIGURATION_MISSING");
  const yesterday = addDays(businessDate(new Date(), env.timezone ?? DEFAULT_SETTINGS.timezone), -1);
  const result = await syncAbsoluteTop({ url: env.unifiedApi.url, apiKey: env.unifiedApi.apiKey, from: options["--from"] ?? addDays(yesterday, -2), to: options["--to"] ?? yesterday, granularity: options["--granularity"] === "hourly" ? "hourly" : "daily", dryRun, cache });
  console.log(JSON.stringify({ module: "absolute_top", dryRun, operations: result }));
  process.exitCode = result.every(row => row.status === "SUCCESS") ? 0 : 2;
}
void main().catch(error => { console.error(JSON.stringify({ module: "absolute_top", code: error instanceof AbsoluteTopError ? error.code : "SYNC_FAILED" })); process.exitCode = 1; });
