import "server-only";
import { getEnv } from "@/lib/config/env";
import { invalidate, invalidateMatching } from "@/lib/data/cache";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import { reconcile } from "@/lib/alerts/incident-manager";
import { dispatchNotifications } from "@/lib/alerts/dispatcher";
import { logger } from "@/lib/logging/logger";
import { businessDate } from "@/lib/time/tz";
import { baseAlertState, summarizeRun } from "./snapshot";
import { getAppContext, monitoringInput, type AppContext } from "./context";
import { BRAND_IDS } from "@/lib/brands";

/**
 * Evaluación programada (la llama n8n WF07 cada 2 horas):
 * 1) consulta fresca del día, 2) motor de monitoreo + anomalías, 3) reconciliación con el
 * estado persistido (anti-spam), 4) despacho de notificaciones a n8n (WF08 → WhatsApp),
 * 5) persistencia de alertas, incidentes, notificaciones y corrida en BigQuery.
 * En MOCK MODE es un ensayo: calcula y simula el despacho, pero no persiste.
 */
export async function evaluateNow(ctx: AppContext, opts: { dryRun: boolean; trigger: "schedule" | "manual"; reuseData?: boolean }) {
  const env = getEnv();
  const started = Date.now();
  const asOf = ctx.source.now();
  const today = businessDate(asOf, ctx.settings.timezone);
  if (!opts.reuseData) {
    invalidate("live:");
    invalidate("sheets:dataset");
    invalidateMatching((k) => (k.startsWith("bq:hourly") || k.startsWith("bq:freshness") || k.startsWith("bq:quality")) && (k.endsWith(today) || k.startsWith("bq:freshness") || k.startsWith("bq:quality")));
  }

  const run = await runMonitoring(ctx.source, await monitoringInput(ctx, asOf));
  const mock = ctx.mode === "mock";
  // Estado previo: replay de las corridas programadas (mock) o el persistido en BigQuery (sin caché).
  const base = mock ? (await baseAlertState(ctx, asOf, run.businessDate)).state : await ctx.store.loadAlertState();
  const result = reconcile(base, run, { settings: ctx.settings, notify: true, whatsapp: env.whatsapp, brand: ctx.brandInfo });
  const persist = !mock && !opts.dryRun;
  const dispatched = opts.dryRun ? result.notifications.map((n) => ({ ...n, status: "SKIPPED" as const, detail: "dryRun: no se envió." })) : await dispatchNotifications(result.notifications, ctx.settings);
  const summary = summarizeRun(run, result.state, dispatched.length, Date.now() - started, opts.trigger, ctx.brandInfo.idPrefix);
  if (persist) {
    await ctx.store.saveAlertState(result.state);
    await ctx.store.saveNotifications(dispatched);
    await ctx.store.saveRun(summary);
    invalidate("state:");
    invalidate("runs:");
  }
  logger.info("monitoring.evaluated", { brand: ctx.brand, mode: ctx.mode, persisted: persist, overall: run.overall, anomalies: run.anomalies.length, notifications: dispatched.length, durationMs: Date.now() - started });
  return {
    ok: true,
    brand: ctx.brand,
    mode: ctx.mode,
    persisted: persist,
    dryRun: opts.dryRun || mock,
    runAt: run.runAt,
    businessDate: run.businessDate,
    cutoffHour: run.cutoffHour,
    overall: run.overall,
    platforms: summary.platforms,
    anomalies: summary.anomalies,
    openIncidents: summary.openIncidents,
    notifications: dispatched.map((n) => ({ id: n.id, incidentId: n.incidentId, kind: n.kind, severity: n.severity, platform: n.platform, channel: n.channel, status: n.status })),
    durationMs: Date.now() - started,
  };
}

/**
 * Evalúa todas las marcas con cuentas en la fuente (izzi y Sky), cada una con su propio estado
 * de alertas e incidentes. La hoja se lee una sola vez.
 */
export async function evaluateAllBrands(opts: { dryRun: boolean; trigger: "schedule" | "manual" }) {
  const results: Array<Awaited<ReturnType<typeof evaluateNow>>> = [];
  for (const brand of BRAND_IDS) {
    const ctx = await getAppContext({ brand });
    if (ctx.brand !== brand || !ctx.brandPlatforms.length) continue;
    results.push(await evaluateNow(ctx, { ...opts, reuseData: results.length > 0 }));
  }
  return results;
}
