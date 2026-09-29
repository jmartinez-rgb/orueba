import "server-only";
import type { MetricValues, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { addMetrics, emptyMetrics, METRICS } from "@/lib/metrics";
import { platformKpi } from "@/lib/platforms/registry";
import { addDays, weekdayOf, WEEKDAYS_ES, zonedParts } from "@/lib/time/tz";
import { cached } from "@/lib/data/cache";
import type { CampaignGroup, PlatformReportData, ReportData, ReportStatus } from "@/lib/reports/types";
import type { AppContext } from "./context";
import type { Snapshot } from "./snapshot";
import { getBudgetControl } from "./budget";

/**
 * Análisis para el mensaje de monitoreo (WhatsApp manual): compara la misma franja horaria de hoy
 * contra ayer y contra el mismo día de la semana pasada, por cuenta y por campaña. No modifica
 * nada: solo resume lo que muestran los datos.
 */

/** Así llama el equipo a cada plataforma en el mensaje. */
export const REPORT_PLATFORM_NAME: Record<PlatformId, string> = { google: "Google", meta: "Facebook", tiktok: "TikTok", microsoft: "Microsoft", spotify: "Spotify", x: "X" };

const BAD_DATA = ["DELAYED", "ERROR", "NO_DATA"];
const MIN_CAMPAIGN_SPEND = 500;
const MIN_CONVERSIONS = 10;

interface Totals {
  today: MetricValues | null;
  yesterday: MetricValues | null;
  lastWeek: MetricValues | null;
}

function change(cur: number | null | undefined, ref: number | null | undefined): number | null {
  if (cur === null || cur === undefined || ref === null || ref === undefined || ref <= 0) return null;
  return (cur - ref) / ref;
}

function worst(list: Severity[]): Severity {
  const order: Severity[] = ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"];
  return list.reduce<Severity>((a, s) => (order.indexOf(s) > order.indexOf(a) ? s : a), "NORMAL");
}

export async function buildReportData(ctx: AppContext, snap: Snapshot): Promise<ReportData> {
  const s = ctx.settings;
  const r = s.report;
  const tz = s.timezone;
  const today = snap.run.businessDate;
  const yesterday = addDays(today, -1);
  const lastWeek = addDays(today, -7);
  const catalog = snap.catalog;
  const accountById = new Map(catalog.accounts.map((a) => [a.id, a]));

  const rows = await cached(`report:rows:${ctx.mode}:${ctx.scenario?.id}:${ctx.settingsHash}:${snap.meta.asOf.slice(0, 15)}`, 60 * 1000, () =>
    ctx.source.getHourly({ dates: [today, yesterday, lastWeek], level: "campaign" }),
  );

  // Totales por campaña y fecha en la ventana [00:00, corte) de su plataforma.
  const cutOf = (p: PlatformId) => snap.run.entities.find((e) => e.key === `platform:${p}`)?.cutoffHour ?? snap.run.cutoffHour;
  const byCampaign = new Map<string, Totals>();
  for (const row of rows) {
    if (!row.campaignId || row.hour >= cutOf(row.platform)) continue;
    const key = row.campaignId;
    const t = byCampaign.get(key) ?? { today: null, yesterday: null, lastWeek: null };
    const slot: keyof Totals = row.date === today ? "today" : row.date === yesterday ? "yesterday" : "lastWeek";
    t[slot] = addMetrics(t[slot] ?? emptyMetrics(), row.metrics);
    byCampaign.set(key, t);
  }
  const excluded = new Set(PLATFORM_IDS.flatMap((p) => snap.run.entities.find((e) => e.key === `platform:${p}`)?.excludedAccounts ?? []));

  const platforms: PlatformReportData[] = PLATFORM_IDS.map((p) => {
    const pe = snap.run.entities.find((e) => e.key === `platform:${p}`)!;
    const metric = r.conversionMetric[p] ?? platformKpi(p, s.platformMetrics).result;
    const metricLabel = METRICS[metric].label;
    const accounts = catalog.accounts.filter((a) => a.platform === p);
    const accTotals = new Map<string, Totals>();
    const zeroSpend: PlatformReportData["zeroSpend"] = [];
    const higher = new Map<string, string[]>();
    for (const c of catalog.campaigns.filter((x) => x.platform === p)) {
      const t = byCampaign.get(c.id);
      if (!t || excluded.has(c.accountId)) continue;
      const acc = accTotals.get(c.accountId) ?? { today: null, yesterday: null, lastWeek: null };
      for (const k of ["today", "yesterday", "lastWeek"] as const) if (t[k]) acc[k] = addMetrics(acc[k] ?? emptyMetrics(), t[k]!);
      accTotals.set(c.accountId, acc);
      if (c.status !== "ACTIVE") continue;
      const sp = t.today?.spend ?? null;
      const accountName = accountById.get(c.accountId)?.name ?? c.accountId;
      if (sp === 0 && ((t.yesterday?.spend ?? 0) > 0 || (t.lastWeek?.spend ?? 0) > 0)) zeroSpend.push({ campaign: c.name, account: accountName });
      const vsY = change(sp, t.yesterday?.spend);
      if (sp !== null && sp >= MIN_CAMPAIGN_SPEND && vsY !== null && vsY >= r.spendIncreaseVsYesterday) higher.set(accountName, [...(higher.get(accountName) ?? []), c.name]);
    }
    const lowerLW: string[] = [];
    const higherLW: string[] = [];
    const lowerY: string[] = [];
    const higherY: string[] = [];
    const convLW: string[] = [];
    const convY: string[] = [];
    for (const a of accounts) {
      const t = accTotals.get(a.id);
      if (!t) continue;
      const dLW = change(t.today?.spend, t.lastWeek?.spend);
      const dY = change(t.today?.spend, t.yesterday?.spend);
      if (dLW !== null && dLW <= -r.spendChangeVsLastWeek) lowerLW.push(a.name);
      if (dLW !== null && dLW >= r.spendChangeVsLastWeek) higherLW.push(a.name);
      if (dY !== null && dY <= -r.spendChangeVsLastWeek) lowerY.push(a.name);
      if (dY !== null && dY >= r.spendIncreaseVsYesterday) higherY.push(a.name);
      const cT = t.today?.[metric] ?? null;
      const cLW = t.lastWeek?.[metric] ?? null;
      const cY = t.yesterday?.[metric] ?? null;
      if (cLW !== null && cLW >= MIN_CONVERSIONS && (change(cT, cLW) ?? 0) <= -r.conversionDrop) convLW.push(a.name);
      if (cY !== null && cY >= MIN_CONVERSIONS && (change(cT, cY) ?? 0) <= -r.conversionDrop) convY.push(a.name);
    }
    const anomalies = snap.run.anomalies.filter((a) => a.platform === p && !a.groupedUnder);
    const critical = snap.state.incidents.filter((i) => i.platform === p && i.resolvedAt === null && i.severity === "CRITICAL");
    const deliveryCritical = anomalies.some((a) => a.severity === "CRITICAL" && (a.family === "delivery" || a.type === "PLATFORM_INCIDENT"));
    const trackingCritical = anomalies.some((a) => a.severity === "CRITICAL" && a.family === "tracking");
    const badData = BAD_DATA.includes(pe.dataState);
    const campaignsHigherVsYesterday: CampaignGroup[] = [...higher.entries()].map(([account, campaigns]) => ({ account, campaigns })).sort((a, b) => b.campaigns.length - a.campaigns.length);
    const spendFindings = lowerLW.length + higherLW.length + lowerY.length + zeroSpend.length + campaignsHigherVsYesterday.length;
    const activeStatus: ReportStatus = deliveryCritical ? "bad" : badData || spendFindings > 0 || snap.platformStatus[p].severity !== "NORMAL" ? "warn" : "ok";
    const conversionStatus: ReportStatus = trackingCritical ? "bad" : convLW.length + convY.length > 0 ? "warn" : "ok";
    return {
      platform: p,
      name: REPORT_PLATFORM_NAME[p],
      activeStatus,
      conversionStatus,
      engineSeverity: snap.platformStatus[p].severity,
      dataIssue: badData ? (pe.dataStateReason ?? "Datos atrasados") : null,
      spendLowerVsLastWeek: lowerLW,
      spendHigherVsLastWeek: higherLW,
      spendLowerVsYesterday: lowerY,
      spendHigherVsYesterday: higherY,
      zeroSpend,
      campaignsHigherVsYesterday,
      conversionDropVsLastWeek: convLW,
      conversionDropVsYesterday: convY,
      metricLabel,
      conversionsByAccount: accounts.map((a) => ({ account: a.name, value: excluded.has(a.id) ? null : (accTotals.get(a.id)?.today?.[metric] ?? null) })),
      criticalIncidents: critical.map((i) => i.title),
    };
  });

  // Presupuesto (forecast de cierre del mes) por plataforma y total.
  let budget: ReportData["budget"] = { status: "ok", details: [] };
  try {
    const bc = await getBudgetControl(ctx, snap);
    const lines = bc.lines.filter((l) => l.level === "total" || l.level === "platform");
    const sev = worst(lines.map((l) => l.status));
    budget = {
      status: sev === "CRITICAL" ? "bad" : sev === "NORMAL" ? "ok" : "warn",
      details: lines
        .filter((l) => l.status !== "NORMAL" && l.forecastVsBudget !== null)
        .map((l) => `${l.name}: cierre estimado ${l.forecastVsBudget! > 0 ? "+" : ""}${Math.round(l.forecastVsBudget! * 100)}% vs presupuesto`),
    };
  } catch {
    budget = { status: "warn", details: ["No se pudo calcular el pacing de presupuesto."] };
  }

  // Problemas con plataformas: datos, incidentes de plataforma y control de ejecución.
  const problems: string[] = [];
  let pStatus: ReportStatus = "ok";
  for (const p of snap.run.platforms) {
    const st = snap.platformStatus[p];
    if (st.dataState === "ERROR" || st.dataState === "NO_DATA") {
      pStatus = "bad";
      problems.push(`${REPORT_PLATFORM_NAME[p]}: ${st.dataState === "ERROR" ? "error de sincronización" : "sin datos"}`);
    } else if (st.dataState === "DELAYED" || st.dataState === "PARTIAL") {
      if (pStatus === "ok") pStatus = "warn";
      problems.push(`${REPORT_PLATFORM_NAME[p]}: ${st.dataState === "DELAYED" ? "datos atrasados" : "una cuenta con datos atrasados"}`);
    }
  }
  if (snap.execution.status === "ERROR") pStatus = "bad";
  if (snap.execution.status === "PENDIENTE" && pStatus === "ok") pStatus = "warn";
  if (snap.execution.pending.length) problems.push(`Pendiente de ejecutar: ${snap.execution.pending.join(", ")}`);
  if (snap.execution.errors.length) problems.push(`Con error: ${snap.execution.errors.join(", ")}`);

  const hour = zonedParts(new Date(snap.meta.asOf), tz).hour;
  return {
    generatedAt: snap.meta.generatedAt,
    businessDate: today,
    cutoffHour: snap.run.cutoffHour,
    timezone: tz,
    lastWeekDay: WEEKDAYS_ES[weekdayOf(lastWeek)],
    greeting: hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches",
    budget,
    platformProblems: { status: pStatus, details: problems },
    platforms,
    confidence: snap.confidence.overall.score,
    thresholds: { spendIncreaseVsYesterday: r.spendIncreaseVsYesterday, spendChangeVsLastWeek: r.spendChangeVsLastWeek, conversionDrop: r.conversionDrop },
    manualChecks: r.manualChecks,
    closingNote: r.closingNote,
    accountBreakdown: r.accountBreakdown,
  };
}
