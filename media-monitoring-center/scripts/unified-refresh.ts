import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { getEnv } from "../src/lib/config/env";
import { UnifiedDataError } from "../src/lib/unified/schema";
import { loadUnifiedMapping, openUnifiedStore } from "../src/lib/unified/store";
import { refreshUnified } from "../src/lib/unified/refresh";
import { filterUnifiedMapping, parseRefreshOptions } from "../src/lib/unified/cli-options";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--ayuda") || args.includes("--help")) {
    console.log("npm run unified:refresh -- [--provider google|meta|tiktok|microsoft|spotify|x] [--brand izzi|sky] [--interval-minutes 30..1440] [--history-days 0|7..44] [--watch]\n--brand limita la marca; sin --brand conserva todas las marcas del mapeo. Sin --watch: una ronda acotada (hoy y los dos días anteriores, diaria/horaria). Además completa una sola vez los días anteriores que falten en el histórico (35 por omisión; 0 lo apaga), del más reciente al más antiguo; un día ya guardado no se vuelve a pedir y un fallo pausa solo esa carga 12 horas. Al iniciar, la primera ronda reintenta sin esperar las cuentas que fallaron (salvo por límite de cuota), como mucho cada 30 minutos. Con --watch: proceso local detenido por SIGINT/SIGTERM. Intervalo 120 minutos por cuenta, espera persistida y backoff de fallos hasta 24 horas. No fuerza cuotas, imprime secretos, envía notificaciones ni publica."); return;
  }
  const options = parseRefreshOptions(args);
  const { watch, intervalMinutes, historyDays } = options;
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  process.env.LOG_LEVEL = "error";
  const env = getEnv();
  const store = openUnifiedStore(env.unifiedData);
  if (env.dataSource !== "unified" || !store || !env.unifiedApi.url || !env.unifiedApi.apiKey) throw new UnifiedDataError("API_CONFIGURATION_MISSING");
  const mapping = filterUnifiedMapping(await loadUnifiedMapping(), options);
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  // The first round after starting retries failed accounts (credentials fixed and republished) without waiting.
  let firstRound = true;
  try {
    do {
      const results = await refreshUnified({ mapping, store, url: env.unifiedApi.url, apiKey: env.unifiedApi.apiKey, timezone: env.timezone ?? "America/Mexico_City", intervalMs: intervalMinutes * 60_000, historyDays, retryFailures: firstRound, signal: shutdown.signal });
      firstRound = false;
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
