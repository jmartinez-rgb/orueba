import "server-only";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { cached } from "@/lib/data/cache";

/**
 * Lectura del estado de conexión de cada plataforma desde la API unificada (unified-ads-api).
 * Solo lectura: GET /api/v1/providers con la llave interna (X-API-Key), que vive en el servidor y
 * nunca llega al navegador ni a los logs. Si la API no responde, el monitoreo sigue igual.
 */

export const UNIFIED_STATES = ["connected", "degraded", "not_configured", "not_implemented", "access_required", "permission_denied", "error"] as const;
export type UnifiedState = (typeof UNIFIED_STATES)[number];

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  implemented: z.boolean(),
  status: z.object({
    state: z.enum(UNIFIED_STATES),
    configured: z.boolean(),
    missing_config: z.array(z.string()),
    last_successful_sync: z.string().nullable(),
    last_error: z.object({ code: z.string(), message: z.string(), at: z.string() }).nullable(),
    latency_ms: z.number().nullable(),
    checked_at: z.string(),
  }),
});
const responseSchema = z.object({ data: z.array(providerSchema) });

export type UnifiedProvider = z.infer<typeof providerSchema>;
export type UnifiedStatus =
  | { ok: true; providers: UnifiedProvider[]; checkedAt: string }
  | { ok: false; configured: boolean; reason: string; checkedAt: string };

/** Solo HTTPS, salvo la API en la misma máquina (desarrollo local). */
export function validUnifiedUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url;
    return null;
  } catch {
    return null;
  }
}

export async function fetchUnifiedStatus(request: typeof fetch = fetch): Promise<UnifiedStatus> {
  const env = getEnv().unifiedApi;
  const checkedAt = new Date().toISOString();
  if (!env.configured) return { ok: false, configured: false, reason: "Configura UNIFIED_ADS_API_URL y UNIFIED_ADS_API_KEY.", checkedAt };
  const base = validUnifiedUrl(env.url);
  if (!base) return { ok: false, configured: true, reason: "UNIFIED_ADS_API_URL debe usar HTTPS (o ser local en desarrollo).", checkedAt };
  let res: Response;
  try {
    res = await request(new URL("/api/v1/providers", base), {
      headers: { "X-API-Key": env.apiKey!, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(env.timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, configured: true, reason: timeout ? "La API unificada no respondió a tiempo." : "No se pudo conectar con la API unificada.", checkedAt };
  }
  if (res.status === 401) return { ok: false, configured: true, reason: "La API unificada rechazó la llave (UNIFIED_ADS_API_KEY).", checkedAt };
  if (!res.ok) return { ok: false, configured: true, reason: `La API unificada respondió HTTP ${res.status}.`, checkedAt };
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, configured: true, reason: "La API unificada devolvió una respuesta inesperada.", checkedAt };
  return { ok: true, providers: parsed.data.data, checkedAt };
}

/** Estado con caché de un minuto (la página de Integrations y el resto de la app lo comparten). */
export function unifiedStatus(): Promise<UnifiedStatus> {
  return cached("unified-api:providers", 60_000, () => fetchUnifiedStatus());
}

/* ---------- Presupuestos vigentes (Meta, Google, TikTok y Microsoft) ---------- */

const budgetSchema = z.object({
  platform: z.string(),
  account_id: z.string(),
  account_name: z.string(),
  currency: z.string().nullable(),
  campaign_id: z.string(),
  campaign_name: z.string(),
  objective: z.string().nullable(),
  budget_level: z.enum(["campaign", "ad_set"]),
  ad_set_id: z.string().nullable(),
  ad_set_name: z.string().nullable(),
  budget_type: z.enum(["daily", "lifetime"]),
  daily_budget: z.number().nullable(),
  lifetime_budget: z.number().nullable(),
  budget_remaining: z.number().nullable(),
  daily_estimate: z.number().nullable(),
  shared_budget_id: z.string().nullable(),
  limited_by_budget: z.boolean().nullable(),
  recommended_daily_budget: z.number().nullable(),
  end_time: z.string().nullable(),
  extracted_at: z.string(),
});
const budgetsResponseSchema = z.object({
  data: z.array(budgetSchema),
  errors: z.array(z.object({ provider: z.string(), error: z.object({ code: z.string(), message: z.string() }).passthrough() })),
});

export type UnifiedBudget = z.infer<typeof budgetSchema>;
export type UnifiedBudgets =
  | { ok: true; budgets: UnifiedBudget[]; warnings: string[]; checkedAt: string }
  | { ok: false; configured: boolean; reason: string; checkedAt: string };

/** Presupuestos vigentes de campañas y conjuntos activos de las plataformas que los exponen (solo lectura). */
export async function fetchUnifiedBudgets(request: typeof fetch = fetch): Promise<UnifiedBudgets> {
  const env = getEnv().unifiedApi;
  const checkedAt = new Date().toISOString();
  if (!env.configured) return { ok: false, configured: false, reason: "Configura UNIFIED_ADS_API_URL y UNIFIED_ADS_API_KEY.", checkedAt };
  const base = validUnifiedUrl(env.url);
  if (!base) return { ok: false, configured: true, reason: "UNIFIED_ADS_API_URL debe usar HTTPS (o ser local en desarrollo).", checkedAt };
  let res: Response;
  try {
    res = await request(new URL("/api/v1/budgets", base), {
      headers: { "X-API-Key": env.apiKey!, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      // Una cuenta grande pagina varias veces: más margen que el estado de conexión.
      signal: AbortSignal.timeout(Math.max(env.timeoutMs, 20_000)),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, configured: true, reason: timeout ? "La API unificada no respondió a tiempo." : "No se pudo conectar con la API unificada.", checkedAt };
  }
  if (res.status === 401) return { ok: false, configured: true, reason: "La API unificada rechazó la llave (UNIFIED_ADS_API_KEY).", checkedAt };
  if (!res.ok) return { ok: false, configured: true, reason: `La API unificada respondió HTTP ${res.status}.`, checkedAt };
  const parsed = budgetsResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, configured: true, reason: "La API unificada devolvió una respuesta inesperada.", checkedAt };
  return { ok: true, budgets: parsed.data.data, warnings: parsed.data.errors.map((e) => `${e.provider}: ${e.error.message}`), checkedAt };
}

/** Presupuestos con caché de cinco minutos: cambian poco y cada lectura recorre todas las cuentas. */
export function unifiedBudgets(): Promise<UnifiedBudgets> {
  return cached("unified-api:budgets", 300_000, () => fetchUnifiedBudgets());
}
