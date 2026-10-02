import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { getEnv } from "../src/lib/config/env";
import { PLATFORM_IDS } from "../src/lib/types";
import { UnifiedDataError } from "../src/lib/unified/schema";
import { loadUnifiedMapping, UnifiedSnapshotStore } from "../src/lib/unified/store";
import { refreshUnified } from "../src/lib/unified/refresh";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--ayuda") || args.includes("--help")) {
    console.log("npm run unified:refresh -- [--provider google|meta|tiktok|microsoft|spotify|x] [--interval-minutes 30..1440] [--watch]\nSin --watch: una ronda acotada (hoy y los dos días anteriores, diaria/horaria). Con --watch: proceso local detenido por SIGINT/SIGTERM. Intervalo 120 minutos por cuenta, espera persistida y backoff de fallos hasta 24 horas. No fuerza cuotas, imprime secretos, envía notificaciones ni publica."); return;
  }
  let watch = false, provider: string | undefined, intervalMinutes = 120;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
    seen.add(flag);
    if (flag === "--watch") watch = true;
    else if (flag === "--provider" && PLATFORM_IDS.includes(args[i + 1] as typeof PLATFORM_IDS[number])) provider = args[++i];
    else if (flag === "--interval-minutes" && /^\d+$/.test(args[i + 1] ?? "")) intervalMinutes = Number(args[++i]);
    else throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  }
  if (intervalMinutes < 30 || intervalMinutes > 1440) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  process.env.LOG_LEVEL = "error";
  const env = getEnv();
  if (env.dataSource !== "unified" || !env.unifiedData.directory || !env.unifiedApi.url || !env.unifiedApi.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  const configured = await loadUnifiedMapping();
  const mapping = { ...configured, accounts: configured.accounts.filter(account => !provider || account.platform === provider) };
  if (!mapping.accounts.length) throw new UnifiedDataError("NO_MAPPED_ACCOUNTS");
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    do {
      const results = await refreshUnified({ mapping, store: new UnifiedSnapshotStore(env.unifiedData.directory), url: env.unifiedApi.url, apiKey: env.unifiedApi.apiKey, timezone: env.timezone ?? "America/Mexico_City", intervalMs: intervalMinutes * 60_000, signal: shutdown.signal });
      console.log(JSON.stringify({ source: "unified", refresh: results }));
      if (!watch) { process.exitCode = results.some(result => result.status === "FAILED" || result.status === "PARTIAL") ? 2 : 0; break; }
      if (shutdown.signal.aborted) break;
      const due = Math.min(...results.map(result => Date.parse(result.nextDueAt)));
      await setTimeout(Math.max(60_000, due - Date.now()), undefined, { signal: shutdown.signal }).catch(error => { if (!shutdown.signal.aborted) throw error; });
    } while (!shutdown.signal.aborted);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
void main().catch(error => {
  console.error(JSON.stringify({ source: "unified", code: error instanceof UnifiedDataError ? error.code : "REFRESH_FAILED" })); process.exitCode = 1;
});
