import "server-only";
import { getEnv } from "@/lib/config/env";
import { recordIntegrationEvent } from "@/lib/logging/logger";

/**
 * Lectura de Google Sheets con la misma service account de BigQuery (solo lectura).
 * Comparte la hoja con el correo de la service account como "Lector". Nunca se escribe.
 */

let clientPromise: Promise<{ getAccessToken(): Promise<{ token?: string | null }> }> | null = null;

async function authClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const env = getEnv();
    const { GoogleAuth } = await import("google-auth-library");
    let credentials: Record<string, unknown> | undefined;
    const raw = env.bigquery.serviceAccountJson;
    if (raw) {
      const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      credentials = JSON.parse(text) as Record<string, unknown>;
    } else if (env.bigquery.clientEmail && env.bigquery.privateKey) {
      credentials = { client_email: env.bigquery.clientEmail, private_key: env.bigquery.privateKey };
    }
    if (credentials && typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const auth = new GoogleAuth({ credentials: credentials as never, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    return auth.getClient();
  })();
  return clientPromise;
}

/** GET autenticado a la API de Google Sheets (solo lectura). */
export async function sheetsGet<T>(path: string, action: string): Promise<T> {
  const started = Date.now();
  try {
    const client = await authClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("No se obtuvo token de acceso para Google Sheets.");
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const hint = res.status === 403 || res.status === 404 ? " ¿La hoja está compartida con la cuenta de servicio como Lector y la API de Google Sheets está habilitada?" : "";
      throw new Error(`Google Sheets respondió ${res.status}.${hint} ${detail.slice(0, 200)}`.trim());
    }
    const data = (await res.json()) as T;
    recordIntegrationEvent({ target: "sheets", action, ok: true, durationMs: Date.now() - started, detail: null });
    return data;
  } catch (err) {
    recordIntegrationEvent({ target: "sheets", action, ok: false, durationMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Devuelve las filas del rango como objetos {encabezado: valor}. Valores sin formato: las fechas llegan
 * como número de serie (sin depender del idioma de la hoja) y se convierten con parseDateTimeLoose.
 */
export async function readSheetRows(spreadsheetId: string, range: string): Promise<Array<Record<string, string>>> {
  const started = Date.now();
  try {
    const client = await authClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("No se obtuvo token de acceso para Google Sheets.");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok) throw new Error(`Google Sheets respondió ${res.status}. ¿La hoja está compartida con la service account?`);
    const data = (await res.json()) as { values?: Array<Array<string | number | boolean>> };
    const [header, ...rows] = data.values ?? [];
    const out = (rows ?? []).map((r) => Object.fromEntries((header ?? []).map((h, i) => [String(h).trim(), String(r[i] ?? "").trim()])));
    recordIntegrationEvent({ target: "api", action: "sheets.read", ok: true, durationMs: Date.now() - started, detail: `${out.length} filas de ${range}` });
    return out;
  } catch (err) {
    recordIntegrationEvent({ target: "api", action: "sheets.read", ok: false, durationMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
