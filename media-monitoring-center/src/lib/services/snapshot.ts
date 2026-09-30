import "server-only";
import { sessionPermissions } from "@/lib/auth/session";
import type { Catalog, DataState, PlatformId, Severity, DataMode } from "@/lib/types";
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
import type { Permission, Role } from "@/lib/auth/roles";
import { friendlyError, logger } from "@/lib/logging/logger";
import type { RunSummary } from "@/lib/state/store";
import { overallConfidence, platformConfidence, summarizeExecution, type ConfidenceResult, type ExecutionSummary } from "@/lib/monitoring/confidence";
import type { CurrencyReport } from "@/lib/data/currency";
import { PLATFORMS } from "@/lib/platforms/registry";
import { getAppContext, monitoringInput, type AppContext } from "./context";
import { SheetsDataSource } from "@/lib/sheets/sheets-source";
import type { BrandId, BrandInfo } from "@/lib/brands";

export interface SnapshotMeta {
  appName: string;
  mode: DataMode;
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
  /** Marca del monitoreo y marcas que la persona puede ver. */
  brand: BrandInfo;
  brands: BrandId[];
  /** false = la fuente no trae cuentas de esta marca. */
  brandHasData: boolean;
  /** Modo Google Sheets: título de la hoja y problemas del mapeo o de las pestañas. */
  sheets: { title: string | null; readAt?: string | null; errors: string[]; tabs: Array<{ sheet: string; platform: string; rows: number | null; updatedAt: string | null; status: string | null; found: boolean }> } | null;
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
  /** Confianza de los datos (0–100 %) por plataforma y general. */
  confidence: { overall: ConfidenceResult; platforms: Record<PlatformId, ConfidenceResult> };
  /** Hoja de control de ejecución (Dataslayer / Apps Script / API). */
  execution: ExecutionSummary;
  /** Cuentas en USD, tasas usadas y meses sin tasa. */
  currency: CurrencyReport;
}


export function summarizeRun(run: MonitoringRun, state: AlertState, notifications: number, durationMs: number, trigger: RunSummary["trigger"], idPrefix = ""): RunSummary {
  return {
    id: `${idPrefix}RUN-${run.businessDate}-${String(run.cutoffHour).padStart(2, "0")}-${trigger}`,
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
    // El historial simulado de incidentes es de izzi; Sky arranca vacío.
    let state = ctx.brand === "izzi" ? emptyAlertState({ incident: PAST_INCIDENT_COUNT }) : emptyAlertState();
    if (ctx.brand === "izzi") state.incidents.push(...pastIncidents(today, ctx.settings.timezone));
    const runs: RunSummary[] = [];
    for (const t of times) {
      const started = Date.now();
      const run = await runMonitoring(ctx.source, await monitoringInput(ctx, t));
      const result = reconcile(state, run, { settings: ctx.settings, notify: true, whatsapp: env.whatsapp, brand: ctx.brandInfo });
      // En mock las notificaciones quedan como SIMULATED (lo que n8n habría enviado).
      const sentIds = new Set(result.notifications.map((n) => n.id));
      result.state.notifications = result.state.notifications.map((n) =>
        sentIds.has(n.id) ? { ...n, status: "SIMULATED", detail: "MOCK MODE: mensaje generado, no enviado." } : n,
      );
      state = result.state;
      runs.push(summarizeRun(run, state, result.notifications.length, Date.now() - started, "schedule", ctx.brandInfo.idPrefix));
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
    cached(`state:${ctx.mode}:${ctx.brand}`, 60 * 1000, () => ctx.store.loadAlertState()),
    cached(`runs:${ctx.mode}:${ctx.brand}:${businessDay}`, 60 * 1000, () => ctx.store.listRuns(businessDay)),
  ]);
  return { state, runs };
}

/** Resumen de la hoja de Dataslayer para Integrations (solo en modo Google Sheets). */
async function sheetsMeta(ctx: AppContext): Promise<SnapshotMeta["sheets"]> {
  if (ctx.mode !== "sheets" && !ctx.sheetsErrors.length) return null;
  const inner = ctx.raw;
  if (!(inner instanceof SheetsDataSource)) return { title: null, errors: ctx.sheetsErrors, tabs: [] };
  try {
    return await inner.summary();
  } catch (err) {
    return { title: null, errors: [err instanceof Error ? err.message : String(err)], tabs: [] };
  }
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
    const f = friendlyError(ctx.mode === "mock" ? "api" : ctx.mode, err);
    logger.error("snapshot.failed", { error: err });
    throw new SnapshotError(f.message, f.technical);
  }
}

// Compartido entre páginas y API routes (ver data/cache.ts): una sola evaluación automática por minuto.
const autoRuns = ((globalThis as unknown as { __immcAutoRuns?: Map<string, Promise<boolean>> }).__immcAutoRuns ??= new Map<string, Promise<boolean>>());

/**
 * Google Sheets sin n8n: nadie llama a la evaluación programada, así que la app la guarda sola
 * cuando alguien la abre y (a) ya pasó el intervalo de evaluación desde la última guardada o
 * (b) aparece un incidente crítico nuevo. Así los incidentes conservan su folio y su hora de
 * inicio (el acuse de una alerta crítica no se vuelve a pedir cada minuto). Con n8n configurado
 * no se hace: la evaluación la dispara n8n y es la que envía los WhatsApp.
 */
async function autoPersist(ctx: AppContext, asOf: Date, base: AlertState, preview: AlertState, runs: RunSummary[]): Promise<boolean> {
  if (ctx.mode !== "sheets" || getEnv().n8n.configured || !ctx.brandPlatforms.length) return false;
  const last = runs.map((r) => Date.parse(r.at)).sort((a, b) => a - b).pop();
  const due = last === undefined || asOf.getTime() - last >= ctx.settings.schedule.intervalHours * 3600 * 1000;
  const known = new Set(base.incidents.map((i) => i.id));
  const newCritical = preview.incidents.some((i) => i.resolvedAt === null && i.severity === "CRITICAL" && !known.has(i.id));
  if (!due && !newCritical) return false;
  const key = `${ctx.brand}:${Math.floor(asOf.getTime() / 60000)}`;
  let job = autoRuns.get(key);
  if (!job) {
    job = import("./evaluate")
      .then(({ evaluateNow }) => evaluateNow(ctx, { dryRun: false, trigger: "schedule", reuseData: true }))
      .then(() => true)
      .catch((err) => {
        logger.warn("auto_evaluation.failed", { brand: ctx.brand, error: err });
        return false;
      });
    autoRuns.set(key, job);
    if (autoRuns.size > 20) autoRuns.delete(autoRuns.keys().next().value!);
  }
  return job;
}

/** Estado resumido de una marca (para el botón izzi | Sky): se recalcula como máximo cada minuto. */
export async function getBrandStatus(brand: BrandId): Promise<{ brand: BrandId; overall: Severity | null; critical: number } | null> {
  try {
    const ctx = await getAppContext({ brand });
    if (ctx.brand !== brand) return null;
    if (!ctx.brandPlatforms.length) return { brand, overall: null, critical: 0 };
    const minute = Math.floor(ctx.source.now().getTime() / 60000);
    return await cached(`brandstatus:${ctx.mode}:${ctx.scenario?.id}:${ctx.settingsHash}:${minute}`, 60 * 1000, async () => {
      const snap = await buildSnapshot(ctx);
      return { brand, overall: snap.overall, critical: snap.state.incidents.filter((i) => i.resolvedAt === null && i.severity === "CRITICAL").length };
    });
  } catch (err) {
    logger.warn("brand_status.failed", { brand, error: err });
    return { brand, overall: null, critical: 0 };
  }
}

export async function buildSnapshot(ctx: AppContext): Promise<Snapshot> {
  const env = getEnv();
  const asOf = ctx.source.now();
  const tz = ctx.settings.timezone;
  const minuteKey = Math.floor(asOf.getTime() / 60000);
  const liveKey = `live:${ctx.mode}:${ctx.scenario?.id}:${ctx.settingsHash}:${minuteKey}`;
  const run = await cached(liveKey, 60 * 1000, async () => runMonitoring(ctx.source, await monitoringInput(ctx, asOf)));

  let { state: base, runs: allRuns } = await baseAlertState(ctx, asOf, run.businessDate);
  // Vista previa en vivo: actualiza alertas/incidentes con la evaluación de este momento, sin notificar.
  let preview = reconcile(base, run, { settings: ctx.settings, notify: false, whatsapp: env.whatsapp, brand: ctx.brandInfo });
  if (await autoPersist(ctx, asOf, base, preview.state, allRuns)) {
    ({ state: base, runs: allRuns } = await baseAlertState(ctx, asOf, run.businessDate));
    preview = reconcile(base, run, { settings: ctx.settings, notify: false, whatsapp: env.whatsapp, brand: ctx.brandInfo });
  }
  const runs = allRuns.filter((r) => r.businessDate === run.businessDate);
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
  const overall = maxSeverity(...run.platforms.map((p) => platformStatus[p].severity));

  const [catalog, execRows] = await Promise.all([ctx.source.getCatalog(), ctx.source.getExecutionControl(asOf).catch((err) => {
    logger.warn("execution_control.failed", { error: err });
    return [];
  })]);
  const execution = summarizeExecution(execRows, asOf);
  const months = [...new Set([run.businessDate, ...run.comparisonDates].map((d) => d.slice(0, 7)))];
  const currency = await ctx.source.currencyReport(months);
  const confidencePlatforms = Object.fromEntries(
    PLATFORM_IDS.map((p) => {
      const pe = run.entities.find((e) => e.key === `platform:${p}`)!;
      const excludedExpected = run.entities
        .filter((e) => e.level === "account" && e.platform === p && pe.excludedAccounts.includes(e.accountId ?? ""))
        .reduce((a, e) => a + (e.cumulative.spend?.expected ?? 0), 0);
      const includedExpected = pe.cumulative.spend?.expected ?? 0;
      const sheets = (ctx.settings.ingestion[p] ?? "sheets") === "sheets";
      return [
        p,
        platformConfidence({
          platform: p,
          health: run.dataHealth[p],
          delayedAfterMinutes: ctx.settings.freshness.delayedAfterMinutes,
          excludedShare: excludedExpected + includedExpected > 0 ? excludedExpected / (excludedExpected + includedExpected) : 0,
          historySamples: pe.cumulative.spend?.sampleCount ?? null,
          historyWeeks: ctx.settings.history.weeks,
          execution: execution.rows.filter((r) => r.platform === p || (r.platform === null && sheets)),
          fxIssues: currency.issues.filter((i) => i.platform === p),
        }),
      ];
    }),
  ) as Record<PlatformId, ConfidenceResult>;
  const confidence = {
    platforms: confidencePlatforms,
    overall: overallConfidence(
      run.platforms.map((p) => ({ name: PLATFORMS[p].shortName, result: confidencePlatforms[p], weight: run.entities.find((e) => e.key === `platform:${p}`)?.cumulative.spend?.expected ?? 0 })),
    ),
  };
  const lastDataAt = run.platforms.map((p) => run.dataHealth[p].lastDataAt).filter(Boolean).sort().pop() ?? null;
  const lastSyncAt = run.platforms.map((p) => run.dataHealth[p].lastSyncAt).filter(Boolean).sort().pop() ?? null;

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
    permissions: sessionPermissions(ctx.session),
    integrations: { bigquery: env.bigquery.configured, n8n: env.n8n.configured, whatsapp: env.whatsapp.enabled },
    mappingErrors: ctx.mappingErrors,
    sheets: await sheetsMeta(ctx),
    brand: ctx.brandInfo,
    brands: ctx.brands,
    brandHasData: ctx.brandPlatforms.length > 0,
  };

  return { meta, run, platformStatus, overall, state, runs, catalog, settings: ctx.settings, confidence, execution, currency };
}
