import "server-only";
import type { Catalog, DataState, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { evaluationSlots, type MonitoringSettings } from "@/lib/config/settings";
import { getEnv } from "@/lib/config/env";
import { cached } from "@/lib/data/cache";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import type { MonitoringRun } from "@/lib/monitoring/types";
import { reconcile } from "@/lib/alerts/incident-manager";
import { emptyAlertState, type AlertState } from "@/lib/alerts/types";
import { platformImpactSeverity } from "@/lib/anomaly-engine/anomaly-engine";
import { maxSeverity } from "@/lib/anomaly-engine/severity";
import { pastIncidents, PAST_INCIDENT_COUNT } from "@/lib/mock/history";
import { listScenarios } from "@/lib/mock/scenarios";
import { addDays, businessDate, longDateLabel, zonedTimeToUtc } from "@/lib/time/tz";
import { can, type Permission, type Role } from "@/lib/auth/roles";
import { friendlyError, logger } from "@/lib/logging/logger";
import type { RunSummary } from "@/lib/state/store";
import { getAppContext, type AppContext } from "./context";

export interface SnapshotMeta {
  appName: string;
  mode: "mock" | "bigquery";
  scenario: { id: string; name: string; description: string } | null;
  scenarios: Array<{ id: string; name: string; description: string }>;
  timezone: string;
  generatedAt: string;
  asOf: string;
  businessDate: string;
  dateLabel: string;
  cutoffHour: number;
  lastDataAt: string | null;
  lastSyncAt: string | null;
  nextEvaluationAt: string;
  slots: number[];
  intervalHours: number;
  historyWeeks: number;
  baseline: "mean" | "median";
  comparisonDates: string[];
  role: Role;
  userName: string;
  permissions: Permission[];
  integrations: { bigquery: boolean; n8n: boolean; whatsapp: boolean };
  mappingErrors: string[];
}

export interface PlatformStatusView {
  platform: PlatformId;
  severity: Severity;
  dataState: DataState;
}

export interface Snapshot {
  meta: SnapshotMeta;
  run: MonitoringRun;
  platformStatus: Record<PlatformId, PlatformStatusView>;
  overall: Severity;
  state: AlertState;
  runs: RunSummary[];
  catalog: Catalog;
  settings: MonitoringSettings;
}

const PERMISSIONS: Permission[] = ["settings:write", "alerts:write", "incidents:write", "budgets:write", "monitoring:trigger", "technical:view"];

export function summarizeRun(run: MonitoringRun, state: AlertState, notifications: number, durationMs: number, trigger: RunSummary["trigger"]): RunSummary {
  return {
    id: `RUN-${run.businessDate}-${String(run.cutoffHour).padStart(2, "0")}-${trigger}`,
    at: run.runAt,
    businessDate: run.businessDate,
    cutoffHour: run.cutoffHour,
    trigger,
    overall: run.overall,
    platforms: Object.fromEntries(PLATFORM_IDS.map((p) => [p, { severity: run.platformStatus[p].severity, dataState: run.platformStatus[p].dataState }])) as RunSummary["platforms"],
    anomalies: run.anomalies.filter((a) => !a.groupedUnder).length,
    openIncidents: state.incidents.filter((i) => i.resolvedAt === null).length,
    notifications,
    durationMs,
  };
}

/** Horarios de evaluación ya transcurridos (ayer completo + hoy hasta ahora). */
function replayTimes(settings: MonitoringSettings, asOf: Date): Date[] {
  const tz = settings.timezone;
  const today = businessDate(asOf, tz);
  const slots = evaluationSlots(settings);
  const out: Date[] = [];
  for (const d of [addDays(today, -1), today]) {
    for (const h of slots) {
      const t = zonedTimeToUtc(d, h, 0, tz);
      if (t.getTime() <= asOf.getTime()) out.push(t);
    }
  }
  return out;
}

/**
 * MOCK MODE: reproduce las corridas programadas de ayer y hoy a través del motor y del
 * gestor de incidentes. Así el historial de incidentes, escalamientos y notificaciones es
 * el resultado real de la lógica anti-spam, no datos inventados.
 */
async function mockReplay(ctx: AppContext, asOf: Date): Promise<{ state: AlertState; runs: RunSummary[] }> {
  const times = replayTimes(ctx.settings, asOf);
  const last = times[times.length - 1]?.toISOString() ?? "none";
  const key = `replay:${ctx.scenario?.id}:${ctx.settingsHash}:${last}:${businessDate(asOf, ctx.settings.timezone)}`;
  return cached(key, 3 * 3600 * 1000, async () => {
    const env = getEnv();
    const today = businessDate(asOf, ctx.settings.timezone);
    let state = emptyAlertState({ incident: PAST_INCIDENT_COUNT });
    state.incidents.push(...pastIncidents(today, ctx.settings.timezone));
    const runs: RunSummary[] = [];
    for (const t of times) {
      const started = Date.now();
      const run = await runMonitoring(ctx.source, { settings: ctx.settings, asOf: t });
      const result = reconcile(state, run, { settings: ctx.settings, notify: true, whatsapp: env.whatsapp });
      // En mock las notificaciones quedan como SIMULATED (lo que n8n habría enviado).
      const sentIds = new Set(result.notifications.map((n) => n.id));
      result.state.notifications = result.state.notifications.map((n) =>
        sentIds.has(n.id) ? { ...n, status: "SIMULATED", detail: "MOCK MODE: mensaje generado, no enviado." } : n,
      );
      state = result.state;
      runs.push(summarizeRun(run, state, result.notifications.length, Date.now() - started, "schedule"));
    }
    return { state, runs };
  });
}

function applyOverrides(state: AlertState, overrides: Awaited<ReturnType<AppContext["store"]["getOverrides"]>>): AlertState {
  for (const a of state.alerts) {
    const o = overrides.alerts[a.id];
    if (!o) continue;
    if (a.resolvedAt !== null && o.status !== "FALSE_POSITIVE") continue;
    a.status = o.status;
    if (o.status === "RESOLVED" && a.resolvedAt === null) a.resolvedAt = o.at;
    const inc = state.incidents.find((i) => i.alertId === a.id && i.resolvedAt === null);
    if (inc && (o.status === "ACKNOWLEDGED" || o.status === "INVESTIGATING")) inc.status = o.status;
    if (inc && (o.status === "RESOLVED" || o.status === "FALSE_POSITIVE")) {
      inc.status = "RESOLVED";
      inc.resolvedAt = o.at;
      inc.timeline.push({ at: o.at, kind: "STATUS", severity: inc.severity, deviation: inc.currentDeviation, message: `Cerrado manualmente (${o.status}) por ${o.by}.`, notified: false });
    }
  }
  for (const inc of state.incidents) {
    const o = overrides.incidents[inc.id];
    if (!o) continue;
    if (o.owner !== undefined) inc.owner = o.owner;
    if (o.status && inc.resolvedAt === null) inc.status = o.status;
    if (o.notes) inc.notes = [...inc.notes, ...o.notes];
  }
  return state;
}

function nextEvaluation(settings: MonitoringSettings, asOf: Date): Date {
  const tz = settings.timezone;
  const today = businessDate(asOf, tz);
  for (const d of [today, addDays(today, 1)]) {
    for (const h of evaluationSlots(settings)) {
      const t = zonedTimeToUtc(d, h, 0, tz);
      if (t.getTime() > asOf.getTime()) return t;
    }
  }
  return zonedTimeToUtc(addDays(today, 1), settings.schedule.startHour, 0, tz);
}

/** Estado de alertas/incidentes previo a la evaluación en curso (replay en mock, persistido en BigQuery). */
export async function baseAlertState(ctx: AppContext, asOf: Date, businessDay: string): Promise<{ state: AlertState; runs: RunSummary[] }> {
  if (ctx.mode === "mock") return mockReplay(ctx, asOf);
  const [state, runs] = await Promise.all([
    cached("state:bq", 60 * 1000, () => ctx.store.loadAlertState()),
    cached(`runs:bq:${businessDay}`, 60 * 1000, () => ctx.store.listRuns(businessDay)),
  ]);
  return { state, runs };
}

export class SnapshotError extends Error {
  constructor(
    public readonly friendly: string,
    public readonly technical: string,
  ) {
    super(friendly);
  }
}

export async function getSnapshot(): Promise<Snapshot> {
  const ctx = await getAppContext();
  try {
    return await buildSnapshot(ctx);
  } catch (err) {
    const f = friendlyError(ctx.mode === "bigquery" ? "bigquery" : "api", err);
    logger.error("snapshot.failed", { error: err });
    throw new SnapshotError(f.message, f.technical);
  }
}

export async function buildSnapshot(ctx: AppContext): Promise<Snapshot> {
  const env = getEnv();
  const asOf = ctx.source.now();
  const tz = ctx.settings.timezone;
  const minuteKey = Math.floor(asOf.getTime() / 60000);
  const liveKey = `live:${ctx.mode}:${ctx.scenario?.id}:${ctx.settingsHash}:${minuteKey}`;
  const run = await cached(liveKey, 60 * 1000, () => runMonitoring(ctx.source, { settings: ctx.settings, asOf }));

  const { state: base, runs: allRuns } = await baseAlertState(ctx, asOf, run.businessDate);
  const runs = allRuns.filter((r) => r.businessDate === run.businessDate);
  // Vista previa en vivo: actualiza alertas/incidentes con la evaluación de este momento, sin notificar.
  const preview = reconcile(base, run, { settings: ctx.settings, notify: false, whatsapp: env.whatsapp });
  const overrides = await ctx.store.getOverrides();
  const state = applyOverrides(preview.state, overrides);
  // Falsos positivos no pintan el estado de la plataforma.
  const falsePositive = new Set(state.alerts.filter((a) => a.status === "FALSE_POSITIVE" && a.resolvedAt === null).map((a) => a.fingerprint));
  const platformStatus = Object.fromEntries(
    PLATFORM_IDS.map((p) => {
      const list = run.anomalies.filter((a) => a.platform === p && !falsePositive.has(a.fingerprint));
      return [p, { platform: p, severity: maxSeverity(...list.map((a) => platformImpactSeverity(a, ctx.settings))), dataState: run.platformStatus[p].dataState }];
    }),
  ) as Record<PlatformId, PlatformStatusView>;
  const overall = maxSeverity(...PLATFORM_IDS.map((p) => platformStatus[p].severity));

  const catalog = await ctx.source.getCatalog();
  const lastDataAt = PLATFORM_IDS.map((p) => run.dataHealth[p].lastDataAt).filter(Boolean).sort().pop() ?? null;
  const lastSyncAt = PLATFORM_IDS.map((p) => run.dataHealth[p].lastSyncAt).filter(Boolean).sort().pop() ?? null;

  const meta: SnapshotMeta = {
    appName: env.appName,
    mode: ctx.mode,
    scenario: ctx.scenario ? { id: ctx.scenario.id, name: ctx.scenario.name, description: ctx.scenario.description } : null,
    scenarios: ctx.mode === "mock" ? listScenarios() : [],
    timezone: tz,
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    businessDate: run.businessDate,
    dateLabel: longDateLabel(run.businessDate),
    cutoffHour: run.cutoffHour,
    lastDataAt,
    lastSyncAt,
    nextEvaluationAt: nextEvaluation(ctx.settings, asOf).toISOString(),
    slots: evaluationSlots(ctx.settings),
    intervalHours: ctx.settings.schedule.intervalHours,
    historyWeeks: ctx.settings.history.weeks,
    baseline: ctx.settings.history.baseline,
    comparisonDates: run.comparisonDates,
    role: ctx.session.role,
    userName: ctx.session.user.name,
    permissions: PERMISSIONS.filter((p) => can(ctx.session.role, p)),
    integrations: { bigquery: env.bigquery.configured, n8n: env.n8n.configured, whatsapp: env.whatsapp.enabled },
    mappingErrors: ctx.mappingErrors,
  };

  return { meta, run, platformStatus, overall, state, runs, catalog, settings: ctx.settings };
}
