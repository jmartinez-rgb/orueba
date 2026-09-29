import { requirePermission } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { pingBigQuery } from "@/lib/bigquery/client";
import { recordIntegrationEvent } from "@/lib/logging/logger";
import { badRequest, forbidden, json, readJson } from "@/lib/services/http";
import { FixtureSheetsReader, GoogleSheetsReader } from "@/lib/sheets/reader";
import { getAppContext } from "@/lib/services/context";
import { explainGoogleError } from "@/lib/google/errors";

export const dynamic = "force-dynamic";

/** Prueba de conexión segura: BigQuery con SELECT 1, Google Sheets (solo metadatos) y n8n con /healthz (no dispara workflows). */
export async function POST(req: Request) {
  const session = await requirePermission("technical:view");
  if (!session) return forbidden();
  const body = await readJson<{ target?: string }>(req);
  const env = getEnv();
  if (body?.target === "bigquery") {
    if (!env.bigquery.configured) return json({ ok: false, message: "BigQuery no está configurado (GOOGLE_CLOUD_PROJECT y BIGQUERY_DATASET)." });
    const r = await pingBigQuery();
    return json({ ok: r.ok, message: r.ok ? `Conexión correcta (${r.durationMs} ms).` : "No pudimos consultar BigQuery.", technical: r.ok ? undefined : r.message });
  }
  if (body?.target === "sheets") {
    if (!env.sheets.spreadsheetId) return json({ ok: false, message: "Falta SHEETS_SPREADSHEET_ID (el ID de la hoja, entre /d/ y /edit en la URL)." });
    if (!env.sheets.credentials && !env.sheets.fixtureFile) return json({ ok: false, message: "Falta la cuenta de servicio (GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY)." });
    const started = Date.now();
    try {
      const reader = env.sheets.fixtureFile ? new FixtureSheetsReader(env.sheets.fixtureFile) : new GoogleSheetsReader();
      const info = await reader.info(env.sheets.spreadsheetId);
      const ctx = await getAppContext();
      const wanted = ctx.sheetsMapping?.sources.filter((s) => !s.optional).map((s) => s.sheet) ?? [];
      const titles = new Set(info.sheets.map((t) => t.trim().toLowerCase()));
      const missing = wanted.filter((w) => !titles.has(w.trim().toLowerCase()));
      return json({
        ok: missing.length === 0,
        message: missing.length
          ? `La hoja "${info.title}" responde, pero faltan pestañas: ${missing.join(", ")}.`
          : `Conexión correcta con "${info.title}" (${info.sheets.length} pestañas, ${Date.now() - started} ms). Zona horaria de la hoja: ${info.timeZone ?? "—"}.`,
      });
    } catch (err) {
      const technical = err instanceof Error ? err.message : String(err);
      const hint = explainGoogleError(technical);
      return json({ ok: false, message: hint ? `No pudimos leer la hoja. ${hint}` : "No pudimos leer la hoja.", technical });
    }
  }
  if (body?.target === "n8n") {
    if (!env.n8n.baseUrl) return json({ ok: false, message: env.useMockData ? "MOCK MODE: n8n simulado. Define N8N_BASE_URL para probar." : "N8N_BASE_URL no está configurado." });
    const started = Date.now();
    try {
      const res = await fetch(`${env.n8n.baseUrl.replace(/\/+$/, "")}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const ok = res.ok;
      recordIntegrationEvent({ target: "n8n", action: "healthz", ok, durationMs: Date.now() - started, detail: `HTTP ${res.status}` });
      return json({ ok, message: ok ? `n8n responde (${Date.now() - started} ms).` : `n8n respondió HTTP ${res.status}.` });
    } catch (err) {
      recordIntegrationEvent({ target: "n8n", action: "healthz", ok: false, durationMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) });
      return json({ ok: false, message: "No pudimos comunicarnos con n8n.", technical: err instanceof Error ? err.message : String(err) });
    }
  }
  return badRequest("Destino de prueba inválido.");
}
