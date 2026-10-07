#!/usr/bin/env node
/**
 * Production start on a Replit Reserved VM (no persistent disk; records, history and rotated tokens live in
 * PostgreSQL). One machine runs:
 *   1. the unified API on 127.0.0.1 only (never exposed),
 *   2. the monitor on 0.0.0.0:$PORT (the single public port),
 *   3. only with UNIFIED_REFRESH_ENABLED=true, the izzi extractor (`unified:refresh --brand izzi --watch`),
 *   4. only with ABSOLUTE_TOP_SYNC_ENABLED=true, one Absolute Top read a day of the day closed 3 days earlier
 *      (≥ 48 h matured), at 07:00 America/Mexico_City.
 * If the API or the monitor stops, everything stops so Replit restarts the deployment. The optional jobs are
 * retried after a pause without taking the site down. No secret, body or URL is printed.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "unified-ads-api");
const webDir = join(root, "media-monitoring-center");
// Fixed ports matching .replit ([[ports]] localPort 3000 → 80). A PORT injected by the platform is ignored
// on purpose so the web server and the internal API can never collide on it.
const apiPort = process.env.UNIFIED_API_INTERNAL_PORT?.trim() || "8787";
const webPort = process.env.MONITOR_PORT?.trim() || "3000";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const truthy = (value) => ["1", "true", "yes", "si", "sí", "on"].includes((value ?? "").trim().toLowerCase());
const log = (event, extra = {}) => console.log(JSON.stringify({ supervisor: true, event, ...extra }));

const shared = { ...process.env, NODE_ENV: "production" };
// One internal key for both sides: the API always accepts the key the monitor sends.
const monitorKey = shared.UNIFIED_ADS_API_KEY?.trim();
const apiKeys = (shared.API_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
if (monitorKey && !apiKeys.includes(monitorKey)) shared.API_KEYS = [...apiKeys, monitorKey].join(",");
const apiEnv = { ...shared, HOST: "127.0.0.1", PORT: apiPort };
const webEnv = { ...shared, PORT: webPort, HOSTNAME: "0.0.0.0", UNIFIED_ADS_API_URL: apiUrl };

const children = new Set();
let stopping = false;

function run(name, args, cwd, env, onExit) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    log("exit", { process: name, code, signal });
    onExit(code);
  });
  return child;
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  log("stopping", { code });
  for (const child of children) child.kill("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (children.size && Date.now() < deadline) await sleep(200);
  for (const child of children) child.kill("SIGKILL");
  process.exit(code);
}

async function healthy(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && !stopping) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  return false;
}

/** Optional jobs: restarted after a pause, never allowed to stop the site. */
function job(name, args) {
  const loop = () => run(name, args, webDir, webEnv, () => {
    if (!stopping) setTimeout(loop, 10 * 60_000).unref();
  });
  loop();
}

function mexicoDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function mexicoHour(date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "2-digit", hourCycle: "h23" }).format(date));
}
function minusDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function absoluteTopDaily() {
  let lastRun = null, running = false;
  const tick = () => {
    const now = new Date(), today = mexicoDate(now);
    if (stopping || running || lastRun === today || mexicoHour(now) < 7) return;
    lastRun = today;
    running = true;
    const day = minusDays(today, 3);
    log("absolute_top_daily", { day });
    run("absolute-top", ["--conditions=react-server", "--import", "tsx", "scripts/absolute-top-sync.ts", "--from", day, "--to", day, "--granularity", "daily"], webDir, webEnv, () => { running = false; });
  };
  setInterval(tick, 60_000).unref();
  tick();
}

process.once("SIGTERM", () => void stop(0));
process.once("SIGINT", () => void stop(0));

run("api", ["dist/index.js"], apiDir, apiEnv, () => void stop(1));
if (!(await healthy(`${apiUrl}/api/v1/health`, 60_000))) {
  log("api_not_ready");
  await stop(1);
}
run("web", ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", webPort], webDir, webEnv, () => void stop(1));
log("started", { web_port: webPort, refresh: truthy(process.env.UNIFIED_REFRESH_ENABLED), absolute_top: truthy(process.env.ABSOLUTE_TOP_SYNC_ENABLED) });
if (truthy(process.env.UNIFIED_REFRESH_ENABLED))
  job("refresh", ["--conditions=react-server", "--import", "tsx", "scripts/unified-refresh.ts", "--brand", "izzi", "--watch"]);
if (truthy(process.env.ABSOLUTE_TOP_SYNC_ENABLED)) absoluteTopDaily();
