import { logActivity } from "@/lib/services/activity";
import { requirePermission } from "@/lib/auth/session";
import { invalidate, invalidateMatching } from "@/lib/data/cache";
import { baseSettings, getAppContext } from "@/lib/services/context";
import { evaluateNow } from "@/lib/services/evaluate";
import { businessDate } from "@/lib/time/tz";
import { triggerWebhook } from "@/lib/n8n/client";
import { forbidden, json, serverError } from "@/lib/services/http";
import { getEnv } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * ACTUALIZAR AHORA: invalida la caché del día en curso (nueva consulta a la fuente) y
 * dispara el workflow de sincronización manual en n8n cuando está configurado.
 */
export async function POST() {
  const session = await requirePermission("monitoring:trigger");
  if (!session) return forbidden();
  try {
    invalidate("live:");
    invalidate("sheets:dataset");
    invalidate("bq:freshness");
    invalidate("bq:quality");
    invalidate("state:");
    invalidate("runs:");
    // El histórico cerrado se conserva en caché; solo se refresca el día en curso.
    const env = getEnv();
    const today = businessDate(new Date(), baseSettings().timezone);
    invalidateMatching((k) => k.startsWith("bq:hourly") && k.endsWith(today));
    invalidateMatching((k) => k.startsWith("bq:daily") && k.endsWith(today));
    // Con Google Sheets y sin n8n: se vuelve a leer la hoja y se guarda la evaluación (alertas e incidentes).
    if (env.dataSource === "sheets" && !env.n8n.manualSyncWebhook) {
      const ctx = await getAppContext();
      const result = await evaluateNow(ctx, { dryRun: false, trigger: "manual" });
      await logActivity(session, "EVALUATION_TRIGGERED", "Actualizar ahora (hoja de Google Sheets)");
      return json({ ok: true, message: `Hoja leída de nuevo y evaluación guardada (corte ${String(result.cutoffHour).padStart(2, "0")}:00).`, webhook: { mode: "simulated", ok: true, status: null } });
    }
    const hook = await triggerWebhook("manualSync", { requestedBy: session.user.name, role: session.role, requestedAt: new Date().toISOString() });
    await logActivity(session, "EVALUATION_TRIGGERED", `Actualizar ahora (${hook.mode === "live" ? (hook.ok ? "n8n OK" : "n8n con error") : "simulado"})`);
    const message =
      hook.mode === "live"
        ? hook.ok
          ? "Sincronización solicitada a n8n y evaluación recalculada con los datos disponibles."
          : `Evaluación recalculada. ${hook.message}`
        : env.useMockData
          ? "Evaluación recalculada (MOCK MODE: el webhook de n8n se simula)."
          : "Evaluación recalculada. Configura N8N_MANUAL_SYNC_WEBHOOK para disparar la sincronización.";
    return json({ ok: true, message, webhook: { mode: hook.mode, ok: hook.ok, status: hook.status } });
  } catch (err) {
    return serverError("api", err, "monitoring/run");
  }
}
