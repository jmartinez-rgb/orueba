import type { BaseMetric, CampaignObjective, CampaignStatus, DataState, MetricId, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { METRICS } from "@/lib/metrics";
import { kpiChoices, PLATFORMS } from "@/lib/platforms/registry";
import type { ConfidenceResult } from "@/lib/monitoring/confidence";
import { evaluateTargets, type TargetCheck } from "@/lib/monitoring/targets";
import type { EntityEvaluation, MetricComparison } from "@/lib/monitoring/types";
import type { Alert, Incident } from "@/lib/alerts/types";
import { ANOMALY_LABEL } from "@/lib/anomaly-engine/anomaly-engine";
import type { Snapshot } from "./snapshot";

/** Modelos de vista: solo lo que cada componente necesita (payload chico hacia el navegador). */

export interface CompareVM {
  current: number | null;
  expected: number | null;
  prevWeek: number | null;
  mean: number | null;
  median: number | null;
  deviation: number | null;
  vsPrev: number | null;
  vsMean: number | null;
  vsMedian: number | null;
  samples: Array<{ date: string; value: number | null }>;
}

export function compareVM(c: MetricComparison | undefined): CompareVM {
  return {
    current: c?.current ?? null,
    expected: c?.expected ?? null,
    prevWeek: c?.prevWeek ?? null,
    mean: c?.mean ?? null,
    median: c?.median ?? null,
    deviation: c?.deltaVsExpected ?? null,
    vsPrev: c?.deltaVsPrevWeek ?? null,
    vsMean: c?.deltaVsMean ?? null,
    vsMedian: c?.deltaVsMedian ?? null,
    samples: c?.samples ?? [],
  };
}

export interface PlatformCardVM {
  platform: PlatformId;
  name: string;
  severity: Severity;
  dataState: DataState;
  dataReason: string | null;
  lastDataAt: string | null;
  lagMinutes: number | null;
  cutoffHour: number;
  spend: CompareVM;
  /** `lagging`: llega con retraso (conversiones offline); en el día no se juzga. */
  result: CompareVM & { metric: BaseMetric; label: string; lagging: boolean };
  cost: CompareVM & { label: string };
  pacingPct: number | null;
  forecastClose: number | null;
  dailyBudget: number | null;
  alertsCount: number;
  topIssue: { title: string; type: string; severity: Severity } | null;
  excludedAccounts: string[];
  measurementNote: string | null;
  /** Confianza de los datos de la plataforma (0–100 %). */
  confidence: ConfidenceResult;
  /** Métrica monitoreada elegida y opciones disponibles para la plataforma. */
  primaryMetric: BaseMetric;
  metricChoices: Array<{ metric: BaseMetric; label: string }>;
  /** Métricas fijas que siempre se muestran en la tarjeta. */
  pinned: Array<CompareVM & { metric: MetricId; label: string }>;
  pinnedIds: MetricId[];
  /** Objetivos fijos de la plataforma. */
  targets: TargetCheck[];
}

export function platformEval(snap: Snapshot, p: PlatformId): EntityEvaluation {
  return snap.run.entities.find((e) => e.key === `platform:${p}`)!;
}

export function platformCard(snap: Snapshot, p: PlatformId): PlatformCardVM {
  const e = platformEval(snap, p);
  const status = snap.platformStatus[p];
  const alerts = snap.state.alerts.filter((a) => a.platform === p && a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
  const top = snap.run.platformStatus[p].topAnomaly;
  const pacing = snap.run.pacing[p];
  const accountNames = new Map(snap.catalog.accounts.map((a) => [a.id, a.name]));
  return {
    platform: p,
    name: PLATFORMS[p].name,
    severity: status.severity,
    dataState: status.dataState,
    dataReason: e.dataStateReason,
    lastDataAt: e.lastDataAt,
    lagMinutes: e.lagMinutes,
    cutoffHour: e.cutoffHour,
    spend: compareVM(e.cumulative.spend),
    result: { ...compareVM(e.cumulative[e.kpi.result]), metric: e.kpi.result, label: e.kpi.resultLabel, lagging: Boolean(e.resultLagging) },
    cost: { ...compareVM(e.cumulative.cpr), label: e.kpi.costLabel },
    pacingPct: pacing.pctOfExpected,
    forecastClose: pacing.forecastClose,
    dailyBudget: pacing.dailyBudget,
    alertsCount: alerts.length,
    topIssue: top ? { title: top.title, type: ANOMALY_LABEL[top.type], severity: top.severity } : null,
    excludedAccounts: e.excludedAccounts.map((id) => accountNames.get(id) ?? id),
    measurementNote: PLATFORMS[p].measurementNote,
    confidence: snap.confidence.platforms[p],
    primaryMetric: e.kpi.result,
    metricChoices: kpiChoices(p).map((m) => ({ metric: m, label: m === "clicks" ? "Clics" : m === "impressions" ? "Impresiones" : METRICS[m].label })),
    pinned: (snap.settings.platformMetrics[p]?.pinned ?? []).map((m) => ({ ...compareVM(e.cumulative[m]), metric: m, label: m === "cpr" ? e.kpi.costLabel : METRICS[m].label })),
    pinnedIds: snap.settings.platformMetrics[p]?.pinned ?? [],
    targets: evaluateTargets(snap.settings, snap.run.entities).filter((t) => t.platform === p),
  };
}

export interface KpiVM {
  metric: MetricId;
  label: string;
  current: number | null;
  expected: number | null;
  prevWeek: number | null;
  deviation: number | null;
  vsPrev: number | null;
  platforms: number;
  spark: Array<number | null>;
}

/** KPIs totales (solo plataformas con datos al día). Derivadas desde totales. */
export function totalKpis(snap: Snapshot): KpiVM[] {
  const included = snap.run.totalIncludes;
  const evals = included.map((p) => platformEval(snap, p));
  const metrics: Array<{ m: BaseMetric; label: string }> = [
    { m: "spend", label: "Gasto" },
    { m: "conversions", label: "Conversiones" },
    { m: "sales", label: "Ventas" },
    { m: "whatsapp", label: "WhatsApp" },
    { m: "leads", label: "Leads" },
  ];
  return metrics.map(({ m, label }) => {
    let cur = 0;
    let exp = 0;
    let prev = 0;
    let n = 0;
    let expOk = true;
    for (const e of evals) {
      const c = e.cumulative[m];
      if (!c || c.current === null) continue;
      n++;
      cur += c.current;
      if (c.expected === null) expOk = false;
      else exp += c.expected;
      prev += c.prevWeek ?? 0;
    }
    const curve = m === "spend" ? snap.run.curves.total.spend : snap.run.curves.total.results[m as keyof typeof snap.run.curves.total.results];
    return {
      metric: m,
      label,
      current: n ? cur : null,
      expected: n && expOk ? exp : null,
      prevWeek: n ? prev : null,
      deviation: n && expOk && exp > 0 ? (cur - exp) / exp : null,
      vsPrev: n && prev > 0 ? (cur - prev) / prev : null,
      platforms: n,
      spark: (curve ?? []).map((pt) => pt.today),
    };
  });
}

export interface CampaignRowVM {
  id: string;
  name: string;
  platform: PlatformId;
  accountName: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  dataState: DataState;
  spend: number | null;
  expected: number | null;
  deviation: number | null;
  vsPrev: number | null;
  histDeviation: number | null;
  resultLabel: string;
  resultMetric: BaseMetric;
  results: number | null;
  resultsExpected: number | null;
  resultsDeviation: number | null;
  /** El resultado llega con retraso (conversiones offline): en el día no se juzga. */
  resultLagging: boolean;
  costLabel: string;
  cost: number | null;
  costDeviation: number | null;
  alertSeverity: Severity | null;
  alertType: string | null;
  alertId: string | null;
  grouped: boolean;
  impact: number;
  share: number | null;
}

export function campaignRows(snap: Snapshot): CampaignRowVM[] {
  const alertsByKey = new Map<string, Alert>();
  for (const a of snap.state.alerts) if (a.resolvedAt === null && a.level === "campaign" && a.campaignId) alertsByKey.set(a.campaignId, a);
  return snap.run.entities
    .filter((e) => e.level === "campaign")
    .map((e) => {
      const s = e.cumulative.spend;
      const r = e.cumulative[e.kpi.result];
      const c = e.cumulative.cpr;
      const alert = alertsByKey.get(e.campaignId!);
      const impact = Math.abs((s?.current ?? 0) - (s?.expected ?? 0));
      return {
        id: e.campaignId!,
        name: e.campaignName ?? e.campaignId!,
        platform: e.platform,
        accountName: e.accountName ?? "",
        objective: e.objective,
        status: e.status ?? "ACTIVE",
        dataState: e.dataState,
        spend: s?.current ?? null,
        expected: s?.expected ?? null,
        deviation: s?.deltaVsExpected ?? null,
        vsPrev: s?.deltaVsPrevWeek ?? null,
        histDeviation: r?.deltaVsMean ?? null,
        resultLabel: e.kpi.resultLabel,
        resultMetric: e.kpi.result,
        results: r?.current ?? null,
        resultsExpected: r?.expected ?? null,
        resultsDeviation: r?.deltaVsExpected ?? null,
        resultLagging: Boolean(e.resultLagging),
        costLabel: e.kpi.costLabel,
        cost: c?.current ?? null,
        costDeviation: c?.deltaVsExpected ?? null,
        alertSeverity: alert && alert.status !== "FALSE_POSITIVE" ? alert.severity : null,
        alertType: alert ? ANOMALY_LABEL[alert.type] : null,
        alertId: alert?.id ?? null,
        grouped: Boolean(alert?.groupedUnder),
        impact,
        share: e.expectedSpendShare,
      };
    });
}

export interface AlertRowVM extends Alert {
  typeLabel: string;
  metricLabel: string;
  durationMs: number;
  groupedUnderId: string | null;
  incidentStatus: Incident["status"] | null;
}

export function alertRows(snap: Snapshot): AlertRowVM[] {
  const now = Date.parse(snap.meta.asOf);
  const byFp = new Map(snap.state.alerts.filter((a) => a.resolvedAt === null).map((a) => [a.fingerprint, a.id]));
  const incidents = new Map(snap.state.incidents.map((i) => [i.id, i]));
  return snap.state.alerts
    .filter((a) => a.resolvedAt === null || now - Date.parse(a.resolvedAt) < 36 * 3600 * 1000)
    .map((a) => ({
      ...a,
      typeLabel: ANOMALY_LABEL[a.type],
      metricLabel: METRICS[a.metric]?.label ?? a.metric,
      durationMs: (a.resolvedAt ? Date.parse(a.resolvedAt) : now) - Date.parse(a.detectedAt),
      groupedUnderId: a.groupedUnder ? (byFp.get(a.groupedUnder) ?? null) : null,
      incidentStatus: a.incidentId ? (incidents.get(a.incidentId)?.status ?? null) : null,
    }))
    .sort((x, y) => {
      const open = Number(y.resolvedAt === null) - Number(x.resolvedAt === null);
      if (open !== 0) return open;
      const sev = ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"];
      return sev.indexOf(y.severity) - sev.indexOf(x.severity) || Date.parse(y.lastUpdateAt) - Date.parse(x.lastUpdateAt);
    });
}

export function platformOrder(): PlatformId[] {
  return PLATFORM_IDS;
}

/** Deja solo las plataformas monitoreadas de un registro por plataforma. */
export function onlyMonitored<T>(rec: Record<PlatformId, T>, platforms: PlatformId[]): Record<PlatformId, T> {
  return Object.fromEntries(platforms.map((p) => [p, rec[p]])) as Record<PlatformId, T>;
}

type Scope = PlatformId | "total";

/** Props de las gráficas de pacing (gasto y resultados) para todas las plataformas + total. */
export function chartProps(snap: Snapshot, only?: PlatformId) {
  const scopes: Array<{ id: Scope; label: string; cutoffHour: number; unavailable: string | null }> = [];
  if (!only) {
    scopes.push({
      id: "total",
      label: snap.run.totalIncludes.length === snap.run.platforms.length ? `Total ${snap.meta.brand.name}` : `Total (${snap.run.totalIncludes.length} de ${snap.run.platforms.length})`,
      cutoffHour: snap.run.totalCutoffHour,
      unavailable: null,
    });
  }
  for (const p of only ? [only] : snap.run.platforms) {
    const st = snap.platformStatus[p].dataState;
    const bad = st === "DELAYED" || st === "ERROR" || st === "NO_DATA";
    scopes.push({
      id: p,
      label: PLATFORMS[p].name,
      cutoffHour: platformEval(snap, p).cutoffHour,
      unavailable: bad ? `${PLATFORMS[p].name}: ${st === "DELAYED" ? "DATA DELAYED" : st === "ERROR" ? "ERROR de sincronización" : "sin datos"}. La curva de hoy no se compara hasta recibir datos.` : null,
    });
  }
  const ids = scopes.map((s) => s.id);
  const spendCurves = Object.fromEntries(ids.map((id) => [id, snap.run.curves[id].spend])) as Record<Scope, (typeof snap.run.curves)["total"]["spend"]>;
  const resultCurves = Object.fromEntries(ids.map((id) => [id, snap.run.curves[id].results])) as Record<Scope, (typeof snap.run.curves)["total"]["results"]>;
  const pacing = Object.fromEntries(ids.map((id) => [id, snap.run.pacing[id]])) as Record<Scope, (typeof snap.run.pacing)["total"]>;
  const results = ["conversions", "sales", "whatsapp", "leads", "calls", "purchases"] as const;
  const available = Object.fromEntries(
    ids.map((id) => [
      id,
      id === "total" ? [...results] : results.filter((m) => PLATFORMS[id as PlatformId].supportedMetrics.includes(m)),
    ]),
  ) as Partial<Record<Scope, Array<(typeof results)[number]>>>;
  return { scopes, spendCurves, resultCurves, pacing, available, weeks: snap.meta.historyWeeks };
}
