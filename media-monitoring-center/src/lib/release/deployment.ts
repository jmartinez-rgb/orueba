import { isAbsolute, relative, resolve, sep } from "node:path";
import { isIP } from "node:net";
import type { RecordBackend } from "@/lib/records/store";

export type DeploymentTarget = "local" | "netlify" | "contenedor" | "replit";

export function parseReadinessOptions(args: string[]) {
  let target: DeploymentTarget = "local";
  let volume: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error("INVALID_OPTIONS");
    seen.add(arg);
    if (["--sin-red", "--registros", "--ayuda", "--help"].includes(arg)) continue;
    if (arg === "--destino") {
      const value = args[++i];
      if (!["local", "netlify", "contenedor", "replit"].includes(value)) throw new Error("INVALID_TARGET");
      target = value as DeploymentTarget;
    } else if (arg === "--volumen") {
      volume = args[++i];
      if (!volume || !isAbsolute(volume) || /[\u0000-\u001f]/.test(volume) || resolve(volume) === sep)
        throw new Error("INVALID_VOLUME");
    } else throw new Error("INVALID_OPTIONS");
  }
  if (volume && target !== "contenedor") throw new Error("INVALID_VOLUME_TARGET");
  return { target, volume, noNetwork: seen.has("--sin-red"), records: seen.has("--registros"), help: seen.has("--ayuda") || seen.has("--help") };
}

/** Configuration only: no DNS, HTTP requests or filesystem writes, and no URL values in diagnostics. */
export function productionApiUrl(value: string | undefined): boolean {
  if (!value || /[\u0000-\u0020]/.test(value)) return false;
  try {
    const url = new URL(value);
    const authority = value.split("//")[1]?.split(/[/?#]/)[0];
    if (url.protocol !== "https:" || authority?.includes("@") || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    if (isIP(host) === 4 && (host.startsWith("127.") || host === "0.0.0.0")) return false;
    if (isIP(host) === 6 && (host === "::" || host === "::1" || /^::ffff:(?:7f[0-9a-f]{2}:|0:0$)/.test(host))) return false;
    return true;
  } catch { return false; }
}

/**
 * The API running beside the monitor in the same machine (Replit): plain HTTP on the loopback interface
 * only, never exposed. Any other host still needs HTTPS.
 */
export function colocatedApiUrl(value: string | undefined): boolean {
  if (!value || /[\u0000-\u0020]/.test(value)) return false;
  try {
    const url = new URL(value);
    const authority = value.split("//")[1]?.split(/[/?#]/)[0];
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port) && !authority?.includes("@") && !url.username && !url.password && !url.search && !url.hash && (url.pathname === "/" || url.pathname === "");
  } catch { return false; }
}

function withinVolume(value: string | undefined, volume: string | undefined): boolean {
  if (!value || !volume || !isAbsolute(volume) || resolve(volume) === sep || /[\u0000-\u001f]/.test(value + volume)) return false;
  const child = relative(resolve(volume), resolve(value));
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

export function deploymentConfiguration(input: {
  target: DeploymentTarget;
  volume?: string;
  dataSource: string;
  recordsBackend: RecordBackend;
  recordsDirectory?: string;
  unifiedDirectory?: string;
  unifiedStore?: "file" | "postgres";
  apiUrl?: string;
}) {
  const checks: Array<{ id: string; status: "configured" | "pending"; code: string }> = [];
  const add = (id: string, ok: boolean, success: string, failure: string) => checks.push({ id, status: ok ? "configured" : "pending", code: ok ? success : failure });
  if (input.target === "replit") {
    // No persistent disk: records and history must live in PostgreSQL; the API may only be reached over loopback or HTTPS.
    add("api_transport", productionApiUrl(input.apiUrl) || colocatedApiUrl(input.apiUrl), productionApiUrl(input.apiUrl) ? "HTTPS_API_URL_CONFIGURED" : "COLOCATED_LOOPBACK_API_CONFIGURED", "PRODUCTION_API_URL_INVALID");
    add("records_topology", input.recordsBackend === "postgres", "POSTGRES_RECORD_BACKEND_CONFIGURED", "REPLIT_REQUIRES_POSTGRES_RECORDS");
    if (input.dataSource === "unified") add("history_topology", input.unifiedStore === "postgres", "POSTGRES_HISTORY_CONFIGURED", "REPLIT_REQUIRES_POSTGRES_HISTORY");
  } else if (input.target !== "local") {
    add("api_transport", productionApiUrl(input.apiUrl), "HTTPS_API_URL_CONFIGURED", "PRODUCTION_API_URL_INVALID");
    if (input.target === "netlify") {
      add("records_topology", input.recordsBackend === "netlify-blobs", "EXTERNAL_RECORD_BACKEND_CONFIGURED", "NETLIFY_RECORD_BACKEND_UNSUPPORTED");
      if (input.dataSource === "unified") add("history_topology", false, "UNUSED", "NETLIFY_UNIFIED_FILE_HISTORY_UNSUPPORTED");
    } else {
      add("records_topology", input.recordsBackend !== "memory", "RECORD_BACKEND_CONFIGURED", "VOLATILE_RECORDS");
      if (input.recordsBackend === "file") add("records_volume", withinVolume(input.recordsDirectory, input.volume), "RECORD_PATH_IN_DECLARED_VOLUME", "RECORD_PATH_OUTSIDE_DECLARED_VOLUME");
      if (input.dataSource === "unified") add("history_volume", withinVolume(input.unifiedDirectory, input.volume), "HISTORY_PATH_IN_DECLARED_VOLUME", "HISTORY_PATH_OUTSIDE_DECLARED_VOLUME");
    }
  }
  return {
    target: input.target,
    configurationReady: checks.every(check => check.status === "configured"),
    checks,
    runtimeVerified: false,
    certifiesV1: false,
    pendingEvidence: input.target === "local" ? ["PRODUCTION_NOT_CHECKED"] : [
      "HTTPS_AND_DNS_NOT_VERIFIED", "API_NETWORK_AUTH_NOT_VERIFIED",
      "DURABLE_STORAGE_RESTART_NOT_VERIFIED", "SHARED_WRITERS_NOT_VERIFIED",
      "TOKEN_ROTATION_DURABILITY_NOT_VERIFIED", "EXTRACTION_WORKER_NOT_VERIFIED",
      "RECONCILIATION_NOT_VERIFIED", "ROLE_ACCEPTANCE_NOT_VERIFIED",
    ],
  };
}
