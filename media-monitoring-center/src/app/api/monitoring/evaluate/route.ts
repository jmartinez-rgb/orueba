import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { evaluateAllBrands } from "@/lib/services/evaluate";
import { json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

function authorized(req: Request, key: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.headers.get("x-api-key") ?? "");
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Endpoint para n8n (WF07 Monitoring Runner). Autenticación servidor-a-servidor con
 * MONITORING_API_KEY (Authorization: Bearer ...). Body opcional: { "dryRun": true }.
 */
export async function POST(req: Request) {
  const env = getEnv();
  if (env.monitoringApiKey) {
    if (!authorized(req, env.monitoringApiKey)) return json({ ok: false, message: "No autorizado." }, 401);
  } else if (!env.useMockData) {
    return json({ ok: false, message: "MONITORING_API_KEY no está configurada: el endpoint está deshabilitado." }, 503);
  }
  const body = (await readJson<{ dryRun?: boolean; trigger?: "schedule" | "manual" }>(req)) ?? {};
  try {
    // Cada marca (izzi, Sky) se evalúa por separado; la respuesta conserva los campos de la
    // primera y agrega "brands" con el resultado de cada una.
    const results = await evaluateAllBrands({ dryRun: Boolean(body.dryRun), trigger: body.trigger === "manual" ? "manual" : "schedule" });
    if (!results.length) return json({ ok: false, message: "La fuente no trae cuentas de ninguna marca." }, 503);
    return json({ ...results[0], brands: results });
  } catch (err) {
    return serverError("bigquery", err, "monitoring/evaluate");
  }
}
