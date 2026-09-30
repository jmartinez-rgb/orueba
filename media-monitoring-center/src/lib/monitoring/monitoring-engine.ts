import type { BudgetRow, Campaign, DataState, FreshnessRecord, HourlyRow, MetricValues, PlatformId, Severity } from "@/lib/types";
import { CHART_RESULT_METRICS, PLATFORM_IDS } from "@/lib/types";
import type { MonitoringSettings } from "@/lib/config/settings";
import type { MonitoringDataSource } from "@/lib/data/source";
import { addMetrics, emptyMetrics, OBJECTIVE_KPI, type Kpi } from "@/lib/metrics";
import { PLATFORMS, platformKpi } from "@/lib/platforms/registry";
import { addDays, businessDate, daysInMonth, hourLabel, monthOf, sameWeekdayDates, zonedParts } from "@/lib/time/tz";
import { detectAnomalies, platformImpactSeverity } from "@/lib/anomaly-engine/anomaly-engine";
import { applyAuthorizations } from "@/lib/alerts/authorizations";
import type { Authorization } from "@/lib/alerts/types";
import { mergeBudgets, type DeclaredCampaign } from "@/lib/novedades/plan";
import { maxSeverity, severityRank } from "@/lib/anomaly-engine/severity";
import { compareWindow, cumulativeByHour, windowTotals, type HourlySeries } from "./historical-comparator";
import { previousDayRatio, sustainedLevel } from "./sustained";
import { buildHourlyCurve, dailyPacing } from "./pacing-engine";
import { buildPlatformDataHealth, evaluateFreshness, type FreshnessEvaluation, type PlatformDataHealth } from "./data-health";
import type { CurvePoint, DailyPacing, EntityEvaluation, MonitoringRun, PlatformStatusInfo, ScopeCurves, SustainedLevel } from "./types";

/**
 * MonitoringEngine: obtiene valores actuales e histórico, calcula esperado, pacing y
 * desviaciones con la regla MISMO DÍA DE LA SEMANA + MISMA FRANJA HORARIA, y entrega
 * las evaluaciones al AnomalyEngine.
 */

function addToSeries(series: HourlySeries, date: string, hour: number, values: MetricValues) {
  let day = series.get(date);
  if (!day) {
    day = Array.from({ length: 24 }, () => null);
    series.set(date, day);
  }
  const cur = day[hour];
  if (cur) addMetrics(cur, values);
  else day[hour] = addMetrics(emptyMetrics(), values);
}

function getSeries(map: Map<string, HourlySeries>, key: string): HourlySeries {
  let s = map.get(key);
  if (!s) {
    s = new Map();
    map.set(key, s);
  }
  return s;
}

const BAD_STATES: DataState[] = ["DELAYED", "ERROR", "NO_DATA"];
const LEVEL_RANK = { platform: 0, account: 1, campaign: 2 } as const;

export interface MonitoringInput {
  settings: MonitoringSettings;
  asOf: Date;
  /** Cambios autorizados por el equipo: silencian las anomalías que cubren mientras estén vigentes. */
  authorizations?: Authorization[];
  /** Campañas que el equipo declaró detenidas (arranque de mes, pausas aprobadas). */
  declaredCampaigns?: Record<string, DeclaredCampaign>;
  /** Presupuestos del arranque de mes, capturados en la app y ajustes aprobados (en ese orden, sobre los de la fuente). */
  extraBudgets?: BudgetRow[][];
}

export async function runMonitoring(source: MonitoringDataSource, input: MonitoringInput): Promise<MonitoringRun> {
  const { settings, asOf } = input;
  const tz = settings.timezone;
  let date = businessDate(asOf, tz);
  let cutoff = zonedParts(asOf, tz).hour;
  if (cutoff === 0) {
    // A medianoche se evalúa el día anterior completo.
    date = addDays(date, -1);
    cutoff = 24;
  }
  const weeks = settings.history.weeks;
  const refDates = sameWeekdayDates(date, weeks);
  const interval = settings.schedule.intervalHours;

  const sustainedDays = settings.detection.sustainedDays;
  const [sourceCatalog, freshness, quality, rows, sourceBudgets, recentDaily, estimated] = await Promise.all([
    source.getCatalog(),
    source.getFreshness(asOf),
    source.getDataQuality(date),
    source.getHourly({ dates: [date, ...refDates], level: "campaign" }),
    source.getBudgets(monthOf(date)),
    // Días completos recientes y su referencia: distinguen un cambio de nivel sostenido de una falla de hoy.
    source.getDaily({ from: addDays(date, -(sustainedDays + 7 * weeks)), to: addDays(date, -1), level: "campaign" }),
    source.estimatedHourly?.(date) ?? Promise.resolve([] as PlatformId[]),
  ]);
  const estimatedCurve = new Set<PlatformId>(estimated);
  const budgets = mergeBudgets(sourceBudgets, ...(input.extraBudgets ?? []));
  // Lo que el equipo declaró detenido (arranque de mes, pausas aprobadas) cuenta como pausa a propósito.
  const declared = input.declaredCampaigns ?? {};
  const catalog = {
    ...sourceCatalog,
    campaigns: sourceCatalog.campaigns.map((c) => {
      const d = declared[c.id];
      return d ? { ...c, status: d.status, statusText: d.text, statusSource: "platform" as const, statusIssue: false, statusSilent: false } : c;
    }),
  };

  // 1) Frescura por plataforma y por cuenta (antes de cualquier análisis de rendimiento).
  const recordFor = (p: PlatformId, accountId: string | null): FreshnessRecord | undefined =>
    freshness.find((f) => f.platform === p && f.accountId === accountId) ?? (accountId ? freshness.find((f) => f.platform === p && f.accountId === null) : undefined);
  const platformFresh = new Map<PlatformId, FreshnessEvaluation>();
  const accountFresh = new Map<string, FreshnessEvaluation>();
  // Plataformas fuera del monitoreo (p. ej. sin pestaña en la hoja): estado neutro, sin alertas.
  const monitored = new Set<PlatformId>(settings.monitoredPlatforms?.length ? settings.monitoredPlatforms : PLATFORM_IDS);
  const monitoredList = PLATFORM_IDS.filter((p) => monitored.has(p));
  const offFreshness: FreshnessEvaluation = { state: "OK", lagMinutes: null, coveredUntilHour: cutoff, reason: null, severity: "NORMAL" };
  for (const p of PLATFORM_IDS) platformFresh.set(p, monitored.has(p) ? evaluateFreshness(recordFor(p, null), asOf, settings) : offFreshness);
  for (const acc of catalog.accounts) {
    const pf = platformFresh.get(acc.platform)!;
    accountFresh.set(acc.id, BAD_STATES.includes(pf.state) ? pf : evaluateFreshness(recordFor(acc.platform, acc.id), asOf, settings));
  }
  const excluded = new Set<string>();
  for (const acc of catalog.accounts) {
    const pf = platformFresh.get(acc.platform)!;
    const af = accountFresh.get(acc.id)!;
    if (!BAD_STATES.includes(pf.state) && BAD_STATES.includes(af.state)) excluded.add(acc.id);
  }

  // Hora de corte efectiva por plataforma: la mínima hora completa de sus cuentas incluidas.
  const effCutoff = new Map<PlatformId, number>();
  for (const p of PLATFORM_IDS) {
    const pf = platformFresh.get(p)!;
    const coveredOf = (f: FreshnessEvaluation) => (date === businessDate(asOf, tz) ? f.coveredUntilHour : 24);
    if (BAD_STATES.includes(pf.state)) {
      effCutoff.set(p, Math.min(cutoff, coveredOf(pf)));
      continue;
    }
    const included = catalog.accounts.filter((a) => a.platform === p && !excluded.has(a.id));
    const covered = included.map((a) => coveredOf(accountFresh.get(a.id)!));
    effCutoff.set(p, Math.min(cutoff, ...(covered.length ? covered : [coveredOf(pf)])));
  }

  // 2) Series horarias por campaña, cuenta, plataforma y total.
  const campaignSeries = new Map<string, HourlySeries>();
  const accountSeries = new Map<string, HourlySeries>();
  const accountSeriesAll = new Map<string, HourlySeries>();
  const platformSeries = new Map<string, HourlySeries>();
  const totalSeries: HourlySeries = new Map();
  const campaignById = new Map<string, Campaign>(catalog.campaigns.map((c) => [c.id, c]));
  const okPlatforms = monitoredList.filter((p) => !BAD_STATES.includes(platformFresh.get(p)!.state));
  for (const r of rows as HourlyRow[]) {
    if (!r.campaignId) continue;
    const accountId = r.accountId ?? campaignById.get(r.campaignId)?.accountId ?? "";
    addToSeries(getSeries(campaignSeries, r.campaignId), r.date, r.hour, r.metrics);
    addToSeries(getSeries(accountSeriesAll, accountId), r.date, r.hour, r.metrics);
    if (excluded.has(accountId)) continue;
    addToSeries(getSeries(accountSeries, accountId), r.date, r.hour, r.metrics);
    addToSeries(getSeries(platformSeries, r.platform), r.date, r.hour, r.metrics);
    if (okPlatforms.includes(r.platform)) addToSeries(totalSeries, r.date, r.hour, r.metrics);
  }

  const baseline = settings.history.baseline;
  const minSamples = settings.history.minSamples;

  // Gasto diario por entidad para detectar cambios sostenidos (p. ej. una reasignación de presupuesto).
  const dailySpend = new Map<string, Map<string, number>>();
  const platformDates = new Map<PlatformId, Set<string>>();
  const addDaily = (key: string, d: string, v: number) => {
    let m = dailySpend.get(key);
    if (!m) dailySpend.set(key, (m = new Map()));
    m.set(d, (m.get(d) ?? 0) + v);
  };
  for (const r of recentDaily) {
    const spend = r.metrics.spend;
    if (spend === null || !r.campaignId) continue;
    const accountId = r.accountId ?? campaignById.get(r.campaignId)?.accountId ?? "";
    let dates = platformDates.get(r.platform);
    if (!dates) platformDates.set(r.platform, (dates = new Set()));
    dates.add(r.date);
    addDaily(`campaign:${r.platform}:${r.campaignId}`, r.date, spend);
    addDaily(`account:${r.platform}:${accountId}`, r.date, spend);
    addDaily(`platform:${r.platform}`, r.date, spend);
  }
  const yesterdayOf = (key: string, p: PlatformId): number | null => {
    const byDate = dailySpend.get(key);
    const known = platformDates.get(p);
    if (!byDate || !known) return null;
    return previousDayRatio({ date, weeks, baseline, minSamples, valueOn: (d) => (known.has(d) ? (byDate.get(d) ?? 0) : null) });
  };
  const sustainedOf = (key: string, p: PlatformId): SustainedLevel | null => {
    const byDate = dailySpend.get(key);
    const known = platformDates.get(p);
    if (!byDate || !known) return null;
    return sustainedLevel({
      date,
      days: sustainedDays,
      weeks,
      baseline,
      minSamples,
      threshold: settings.thresholds.attention,
      // Sin fila un día con datos de la plataforma = no gastó (Dataslayer no escribe filas vacías).
      valueOn: (d) => (known.has(d) ? (byDate.get(d) ?? 0) : null),
    });
  };
  const laggingFor = (p: PlatformId) => settings.detection.laggingMetrics[p] ?? [];
  const extras = (key: string, p: PlatformId, kpi: Kpi, cut: number) => ({
    curveEstimated: cut < 24 && estimatedCurve.has(p),
    resultLagging: cut < 24 && laggingFor(p).includes(kpi.result),
    sustained: sustainedOf(key, p),
    previousDayRatio: yesterdayOf(key, p),
  });
  const evaluate = (series: HourlySeries, kpi: Kpi, cut: number) => ({
    cumulative: compareWindow({ series, date, referenceDates: refDates, fromHour: 0, toHour: cut, kpi, baseline, minSamples }),
    recent:
      cut > interval
        ? compareWindow({
            series,
            date,
            referenceDates: refDates,
            fromHour: cut - interval,
            toHour: cut,
            kpi,
            baseline,
            minSamples,
            metrics: ["spend", kpi.result, "cpr"],
          })
        : null,
    recentFromHour: Math.max(0, cut - interval),
  });

  /** Parte del gasto diario que suele ocurrir antes del corte (según las fechas de referencia). */
  const dayShareOf = (series: HourlySeries, cut: number): number | null => {
    let part = 0;
    let full = 0;
    for (const d of refDates) {
      const w = windowTotals(series, d, 0, cut)?.spend;
      const f = windowTotals(series, d, 0, 24)?.spend;
      if (w !== null && w !== undefined && f !== null && f !== undefined && f > 0) {
        part += w;
        full += f;
      }
    }
    return full > 0 ? part / full : null;
  };

  // 3) Evaluaciones por entidad.
  const evaluations: EntityEvaluation[] = [];
  const platformExpectedSpend = new Map<PlatformId, number>();
  for (const p of PLATFORM_IDS) {
    const pf = platformFresh.get(p)!;
    const kpi = platformKpi(p, settings.platformMetrics);
    const cut = effCutoff.get(p)!;
    const ev = evaluate(platformSeries.get(p) ?? new Map(), kpi, cut);
    const excludedAccounts = catalog.accounts.filter((a) => a.platform === p && excluded.has(a.id)).map((a) => a.id);
    platformExpectedSpend.set(p, ev.cumulative.spend?.expected ?? 0);
    evaluations.push({
      key: `platform:${p}`,
      level: "platform",
      platform: p,
      accountId: null,
      accountName: null,
      campaignId: null,
      campaignName: null,
      objective: PLATFORMS[p].platformObjective,
      kpi,
      status: null,
      dataState: BAD_STATES.includes(pf.state) ? pf.state : excludedAccounts.length ? "PARTIAL" : "OK",
      dataStateReason: pf.reason,
      dataSeverity: pf.severity,
      lastDataAt: recordFor(p, null)?.lastDataAt ?? null,
      lagMinutes: pf.lagMinutes,
      cutoffHour: cut,
      ...ev,
      expectedSpendShare: 1,
      dayShare: dayShareOf(platformSeries.get(p) ?? new Map(), cut),
      excludedAccounts,
      ...extras(`platform:${p}`, p, kpi, cut),
    });
  }
  for (const acc of catalog.accounts) {
    const af = accountFresh.get(acc.id)!;
    const kpi = platformKpi(acc.platform, settings.platformMetrics);
    const cut = excluded.has(acc.id) ? Math.min(cutoff, af.coveredUntilHour) : effCutoff.get(acc.platform)!;
    const ev = evaluate(accountSeriesAll.get(acc.id) ?? new Map(), kpi, cut);
    const pExp = platformExpectedSpend.get(acc.platform) ?? 0;
    evaluations.push({
      key: `account:${acc.platform}:${acc.id}`,
      level: "account",
      platform: acc.platform,
      accountId: acc.id,
      accountName: acc.name,
      campaignId: null,
      campaignName: null,
      objective: PLATFORMS[acc.platform].platformObjective,
      kpi,
      status: null,
      dataState: af.state,
      dataStateReason: af.reason,
      dataSeverity: af.severity,
      lastDataAt: recordFor(acc.platform, acc.id)?.lastDataAt ?? null,
      lagMinutes: af.lagMinutes,
      cutoffHour: cut,
      ...ev,
      expectedSpendShare: !excluded.has(acc.id) && pExp > 0 ? (ev.cumulative.spend?.expected ?? 0) / pExp : null,
      dayShare: dayShareOf(accountSeriesAll.get(acc.id) ?? new Map(), cut),
      excludedAccounts: [],
      ...extras(`account:${acc.platform}:${acc.id}`, acc.platform, kpi, cut),
    });
  }
  const accountName = new Map(catalog.accounts.map((a) => [a.id, a.name]));
  for (const c of catalog.campaigns) {
    const af = accountFresh.get(c.accountId) ?? platformFresh.get(c.platform)!;
    const objective = settings.objectiveOverrides[c.id] ?? c.objective;
    const kpi = OBJECTIVE_KPI[objective];
    const cut = excluded.has(c.accountId) ? Math.min(cutoff, af.coveredUntilHour) : effCutoff.get(c.platform)!;
    const ev = evaluate(campaignSeries.get(c.id) ?? new Map(), kpi, cut);
    const pExp = platformExpectedSpend.get(c.platform) ?? 0;
    evaluations.push({
      key: `campaign:${c.platform}:${c.id}`,
      level: "campaign",
      platform: c.platform,
      accountId: c.accountId,
      accountName: accountName.get(c.accountId) ?? c.accountId,
      campaignId: c.id,
      campaignName: c.name,
      objective,
      kpi,
      status: c.status,
      statusSource: c.statusSource,
      statusText: c.statusText,
      statusIssue: c.statusIssue,
      statusSilent: c.statusSilent,
      dataState: af.state,
      dataStateReason: af.reason,
      dataSeverity: af.severity,
      lastDataAt: recordFor(c.platform, c.accountId)?.lastDataAt ?? null,
      lagMinutes: af.lagMinutes,
      cutoffHour: cut,
      ...ev,
      expectedSpendShare: !excluded.has(c.accountId) && pExp > 0 ? (ev.cumulative.spend?.expected ?? 0) / pExp : null,
      dayShare: dayShareOf(campaignSeries.get(c.id) ?? new Map(), cut),
      excludedAccounts: [],
      ...extras(`campaign:${c.platform}:${c.id}`, c.platform, kpi, cut),
    });
  }

  // 4) Anomalías y estado por plataforma.
  const detected = detectAnomalies(
    evaluations.filter((e) => monitored.has(e.platform)),
    { settings, cutoffHour: cutoff },
  );
  const { kept: anomalies, silenced } = applyAuthorizations(detected, input.authorizations ?? [], asOf.toISOString(), settings);
  const platformStatus = {} as Record<PlatformId, PlatformStatusInfo>;
  for (const p of PLATFORM_IDS) {
    const list = anomalies.filter((a) => a.platform === p);
    const counts: Record<Severity, number> = { NORMAL: 0, ATTENTION: 0, ALERT: 0, CRITICAL: 0 };
    list.filter((a) => !a.groupedUnder).forEach((a) => counts[a.severity]++);
    const severity = maxSeverity(...list.map((a) => platformImpactSeverity(a, settings)));
    const platformEval = evaluations.find((e) => e.key === `platform:${p}`)!;
    platformStatus[p] = {
      platform: p,
      severity,
      dataState: platformEval.dataState,
      anomalyCounts: counts,
      topAnomaly:
        [...list]
          .filter((a) => !a.groupedUnder)
          .sort((a, b) => severityRank(platformImpactSeverity(b, settings)) - severityRank(platformImpactSeverity(a, settings)) || LEVEL_RANK[a.level] - LEVEL_RANK[b.level])[0] ?? null,
    };
  }
  const overall = maxSeverity(...monitoredList.map((p) => platformStatus[p].severity));

  // 5) Pacing con curva horaria histórica y curvas para gráficas.
  const monthDays = daysInMonth(monthOf(date));
  const budgetFor = (p: PlatformId) => budgets.find((b: BudgetRow) => b.level === "platform" && b.platform === p)?.amount ?? null;
  const pacing = {} as Record<PlatformId | "total", DailyPacing>;
  const curves = {} as Record<PlatformId | "total", ScopeCurves>;
  const totalCutoff = okPlatforms.length ? Math.min(...okPlatforms.map((p) => effCutoff.get(p)!)) : cutoff;
  let totalBudget = 0;
  const totalBudgetCurve = Array.from({ length: 24 }, () => 0);

  const buildCurves = (series: HourlySeries, cut: number, kpi: Kpi, dailyBudget: number | null, cumShare: number[]): ScopeCurves => {
    const make = (metric: Parameters<typeof cumulativeByHour>[2], withBudget: boolean): CurvePoint[] => {
      const today = cumulativeByHour(series, date, metric, kpi, cut);
      const prev = cumulativeByHour(series, refDates[0], metric, kpi);
      const refs = refDates.map((d) => cumulativeByHour(series, d, metric, kpi));
      return Array.from({ length: 24 }, (_, h) => {
        const vals = refs.map((r) => r[h]).filter((v): v is number => v !== null);
        return {
          hour: h + 1,
          label: hourLabel(h + 1),
          today: today[h],
          prevWeek: prev[h],
          avg: vals.length >= minSamples ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
          ...(withBudget ? { budget: dailyBudget !== null ? dailyBudget * cumShare[h] : null } : {}),
        };
      });
    };
    return {
      spend: make("spend", true),
      results: Object.fromEntries(CHART_RESULT_METRICS.map((m) => [m, make(m, false)])) as ScopeCurves["results"],
    };
  };

  for (const p of PLATFORM_IDS) {
    const series = platformSeries.get(p) ?? new Map();
    const curve = buildHourlyCurve(series, refDates);
    const monthly = budgetFor(p);
    const daily = monthly !== null ? monthly / monthDays : null;
    const cut = effCutoff.get(p)!;
    const platformEval = evaluations.find((e) => e.key === `platform:${p}`)!;
    const spend = BAD_STATES.includes(platformEval.dataState) ? null : (platformEval.cumulative.spend?.current ?? null);
    pacing[p] = dailyPacing({ spend, cutoffHour: cut, curve, dailyBudget: daily });
    curves[p] = buildCurves(series, cut, platformKpi(p, settings.platformMetrics), daily, curve.cumShare);
    if (okPlatforms.includes(p) && daily !== null) {
      totalBudget += daily;
      curve.cumShare.forEach((v, h) => (totalBudgetCurve[h] += daily * v));
    }
  }
  const totalCurve = buildHourlyCurve(totalSeries, refDates);
  const totalSpendNow = compareWindow({
    series: totalSeries,
    date,
    referenceDates: refDates,
    fromHour: 0,
    toHour: totalCutoff,
    kpi: OBJECTIVE_KPI.CONVERSIONS,
    baseline,
    minSamples,
    metrics: ["spend"],
  }).spend?.current ?? null;
  pacing.total = dailyPacing({ spend: totalSpendNow, cutoffHour: totalCutoff, curve: totalCurve, dailyBudget: totalBudget || null });
  const totalCurves = buildCurves(totalSeries, totalCutoff, OBJECTIVE_KPI.CONVERSIONS, null, totalCurve.cumShare);
  totalCurves.spend = totalCurves.spend.map((pt, h) => ({ ...pt, budget: totalBudget ? totalBudgetCurve[h] : null }));
  curves.total = totalCurves;

  // 6) Data Health por plataforma.
  const dataHealth = {} as Record<PlatformId, PlatformDataHealth>;
  for (const p of PLATFORM_IDS) {
    const series = platformSeries.get(p);
    const todayHours = series?.get(date) ?? [];
    const cut = effCutoff.get(p)!;
    const hasActive = catalog.campaigns.some((c) => c.platform === p && c.status === "ACTIVE");
    const missing: number[] = [];
    if (hasActive) for (let h = 0; h < cut; h++) if (!todayHours[h]) missing.push(h);
    dataHealth[p] = buildPlatformDataHealth({
      platform: p,
      record: recordFor(p, null),
      freshness: platformFresh.get(p)!,
      quality: quality.find((q) => q.platform === p),
      missingHours: monitored.has(p) ? missing : [],
      hasRowsToday: !monitored.has(p) || todayHours.some((h) => h !== null),
      effectiveCutoffHour: cut,
      delayedAccounts: catalog.accounts
        .filter((a) => a.platform === p && excluded.has(a.id))
        .map((a) => {
          const f = accountFresh.get(a.id)!;
          return { accountId: a.id, accountName: a.name, state: f.state, lagMinutes: f.lagMinutes, reason: f.reason };
        }),
    });
  }

  return {
    runAt: asOf.toISOString(),
    timezone: tz,
    businessDate: date,
    cutoffHour: cutoff,
    intervalHours: interval,
    comparisonDates: refDates,
    historyWeeks: weeks,
    baseline,
    entities: evaluations,
    anomalies,
    platformStatus,
    overall,
    pacing,
    curves,
    dataHealth,
    totalIncludes: okPlatforms,
    totalCutoffHour: totalCutoff,
    platforms: monitoredList,
    silenced,
  };
}
