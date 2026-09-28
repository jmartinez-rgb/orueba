import "server-only";
import type { BigQuery, Query } from "@google-cloud/bigquery";
import { getEnv } from "@/lib/config/env";
import { logger, recordIntegrationEvent } from "@/lib/logging/logger";

/**
 * Cliente de BigQuery (solo servidor). Las credenciales vienen de GOOGLE_SERVICE_ACCOUNT
 * (JSON o JSON en base64) y nunca salen del servidor. Sin esa variable se usan las
 * credenciales por defecto del entorno (ADC), útil si algún día corre dentro de GCP.
 */

let client: BigQuery | null = null;

function parseServiceAccount(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (typeof json.private_key === "string") json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT no es un JSON válido (ni en texto ni en base64).");
  }
}

export async function getBigQuery(): Promise<BigQuery> {
  if (client) return client;
  const env = getEnv();
  const { BigQuery } = await import("@google-cloud/bigquery");
  // Opción A: JSON completo (GOOGLE_SERVICE_ACCOUNT). Opción B (recomendada en Netlify por el
  // límite de 4 KB de variables en Functions): GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.
  const credentials =
    parseServiceAccount(env.bigquery.serviceAccountJson) ??
    (env.bigquery.clientEmail && env.bigquery.privateKey
      ? { client_email: env.bigquery.clientEmail, private_key: env.bigquery.privateKey.replace(/\\n/g, "\n") }
      : undefined);
  client = new BigQuery({
    projectId: env.bigquery.projectId,
    location: env.bigquery.location,
    ...(credentials ? { credentials: credentials as { client_email: string; private_key: string } } : {}),
  });
  return client;
}

export interface QueryResult<T> {
  rows: T[];
  bytesProcessed: number | null;
  durationMs: number;
}

/** Ejecuta una consulta parametrizada con límite de bytes facturados y registro de duración. */
export async function runQuery<T = Record<string, unknown>>(
  name: string,
  query: string,
  params: Record<string, unknown>,
  types?: Query["types"],
): Promise<QueryResult<T>> {
  const env = getEnv();
  const bq = await getBigQuery();
  const started = Date.now();
  try {
    const [job] = await bq.createQueryJob({
      query,
      params,
      types,
      location: env.bigquery.location,
      maximumBytesBilled: String(env.bigquery.maxBytesBilled),
      labels: { app: "izzi-media-monitoring", query: name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60) },
      jobTimeoutMs: 45000,
      useQueryCache: true,
    });
    const [rows] = await job.getQueryResults({ timeoutMs: 45000 });
    const [meta] = await job.getMetadata();
    const bytes = Number(meta?.statistics?.totalBytesProcessed ?? NaN);
    const durationMs = Date.now() - started;
    recordIntegrationEvent({
      target: "bigquery",
      action: name,
      ok: true,
      durationMs,
      detail: `${rows.length} filas · ${Number.isFinite(bytes) ? (bytes / 1024 ** 2).toFixed(1) : "?"} MB procesados`,
    });
    logger.debug("bigquery.query", { name, durationMs, rows: rows.length, bytes });
    return { rows: rows as T[], bytesProcessed: Number.isFinite(bytes) ? bytes : null, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    recordIntegrationEvent({ target: "bigquery", action: name, ok: false, durationMs, detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Prueba de conexión barata (sin escanear tablas). */
export async function pingBigQuery(): Promise<{ ok: boolean; durationMs: number; message: string }> {
  const started = Date.now();
  try {
    await runQuery("ping", "SELECT 1 AS ok", {});
    return { ok: true, durationMs: Date.now() - started, message: "Conexión correcta" };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Resuelve "tabla" o "dataset.tabla" al nombre completo `proyecto.dataset.tabla`. */
export function fullTableName(ref: string, dataset?: string): string {
  const env = getEnv();
  const parts = ref.split(".");
  const project = env.bigquery.projectId;
  const ds = dataset ?? env.bigquery.dataset;
  const full = parts.length === 3 ? ref : parts.length === 2 ? `${project}.${ref}` : `${project}.${ds}.${ref}`;
  if (!/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(full)) throw new Error(`Nombre de tabla inválido: ${ref}`);
  return `\`${full}\``;
}
