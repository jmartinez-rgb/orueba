import "server-only";
import type { BudgetLevel, BudgetRow, DataState, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { cached } from "@/lib/data/cache";
import { monthlyPacing } from "@/lib/monitoring/pacing-engine";
import { PLATFORMS } from "@/lib/platforms/registry";
import { addDays, daysInMonth, diffDays, monthOf, startOfMonth, weekdayOf } from "@/lib/time/tz";
import type { MonitoringSettings } from "@/lib/config/settings";
import type { AppContext } from "./context";
import type { Snapshot } from "./snapshot";

export interface BudgetLine {
  key: string;
  level: BudgetLevel;
  platform: PlatformId | null;
  accountId: string | null;
  campaignId: string | null;
  name: string;
  parentName: string | null;
  budget: number | null;
  spend: number;
  todaySpend: number;
  remaining: number | null;
  usedPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  forecast: number;
  forecastVsBudget: number | null;
  status: Severity;
  dataState: DataState;
}

export interface BudgetControl {
  month: string;
  daysInMonth: number;
  elapsedDays: number;
  lines: BudgetLine[];
}

function statusFor(forecastVsBudget: number | null, s: MonitoringSettings["budget"]): Severity {
  if (forecastVsBudget === null) return "NORMAL";
  if (forecastVsBudget >= s.overspendCritical) return "CRITICAL";
  if (forecastVsBudget >= s.overspendAlert) return "ALERT";
  if (forecastVsBudget >= s.overspendAttention) return "ATTENTION";
  if (forecastVsBudget <= -s.underspendAlert) return "ALERT";
  if (forecastVsBudget <= -s.underspendAttention) return "ATTENTION";
  return "NORMAL";
}

const keyOf = (b: Pick<BudgetRow, "level" | "platform" | "accountId" | "campaignId">) => [b.level, b.platform ?? "", b.accountId ?? "", b.campaignId ?? ""].join("|");

export async function getBudgetControl(ctx: AppContext, snap: Snapshot): Promise<BudgetControl> {
  const today = snap.run.businessDate;
  const month = monthOf(today);
  const monthStart = startOfMonth(today);
  const histStart = addDays(today, -28);
  const from = monthStart < histStart ? monthStart : histStart;
  const [daily, sourceBudgets, overrides] = await Promise.all([
    cached(`budget:daily:${ctx.mode}:${ctx.scenario?.id}:${from}:${today}:${snap.meta.cutoffHour}`, 5 * 60 * 1000, () => ctx.source.getDaily({ from, to: today, level: "campaign" })),
    ctx.source.getBudgets(month),
    ctx.store.getOverrides(),
  ]);
  const budgetMap = new Map<string, BudgetRow>();
  for (const b of sourceBudgets) budgetMap.set(keyOf(b), b);
  for (const b of overrides.budgets.filter((o) => o.month === month)) budgetMap.set(keyOf(b), b);

  const catalog = snap.catalog;
  const accountName = new Map(catalog.accounts.map((a) => [a.id, a.name]));
  const campaignById = new Map(catalog.campaigns.map((c) => [c.id, c]));
  const nDays = daysInMonth(month);
  const elapsedFullDays = diffDays(today, monthStart);
  const remainingWeekdays: number[] = [];
  for (let d = addDays(today, 1); monthOf(d) === month; d = addDays(d, 1)) remainingWeekdays.push(weekdayOf(d));

  // Agregados por entidad.
  interface Agg {
    mtd: number;
    today: number;
    byWeekday: number[];
    weekdayDays: number[];
  }
  const aggs = new Map<string, Agg>();
  const get = (k: string) => {
    let a = aggs.get(k);
    if (!a) {
      a = { mtd: 0, today: 0, byWeekday: [0, 0, 0, 0, 0, 0, 0], weekdayDays: [0, 0, 0, 0, 0, 0, 0] };
      aggs.set(k, a);
    }
    return a;
  };
  const seenDay = new Map<string, Set<string>>();
  for (const r of daily) {
    const spend = r.metrics.spend ?? 0;
    const camp = r.campaignId ? campaignById.get(r.campaignId) : undefined;
    const accountId = r.accountId ?? camp?.accountId ?? null;
    const keys = [keyOf({ level: "total", platform: null, accountId: null, campaignId: null }), keyOf({ level: "platform", platform: r.platform, accountId: null, campaignId: null })];
    if (accountId) keys.push(keyOf({ level: "account", platform: r.platform, accountId, campaignId: null }));
    if (r.campaignId) keys.push(keyOf({ level: "campaign", platform: r.platform, accountId, campaignId: r.campaignId }));
    for (const k of keys) {
      const a = get(k);
      if (r.date >= monthStart && r.date <= today) a.mtd += spend;
      if (r.date === today) a.today += spend;
      else if (r.date >= histStart && r.date < today) {
        const wd = weekdayOf(r.date);
        a.byWeekday[wd] += spend;
        const seen = seenDay.get(k) ?? new Set<string>();
        if (!seen.has(r.date)) {
          seen.add(r.date);
          a.weekdayDays[wd] += 1;
        }
        seenDay.set(k, seen);
      }
    }
  }

  const shareFor = (p: PlatformId | null) => (p ? snap.run.pacing[p].curveShare : snap.run.pacing.total.curveShare);
  const lines: BudgetLine[] = [];
  const keys = new Set<string>([...budgetMap.keys(), ...aggs.keys()]);
  for (const k of keys) {
    const [level, platform, accountId, campaignId] = k.split("|") as [BudgetLevel, string, string, string];
    const agg = aggs.get(k) ?? { mtd: 0, today: 0, byWeekday: [0, 0, 0, 0, 0, 0, 0], weekdayDays: [0, 0, 0, 0, 0, 0, 0] };
    const b = budgetMap.get(k);
    if (!b && agg.mtd === 0) continue;
    const p = (platform || null) as PlatformId | null;
    const share = shareFor(p);
    const weekdayAverages = agg.byWeekday.map((v, i) => (agg.weekdayDays[i] ? v / agg.weekdayDays[i] : 0));
    const mp = monthlyPacing({
      budget: b?.amount ?? null,
      monthToDateSpend: agg.mtd,
      todaySpend: agg.today,
      todayForecast: share > 0.02 ? agg.today / share : null,
      elapsedFullDays,
      todayShare: share,
      daysInMonth: nDays,
      weekdayAverages,
      remainingWeekdays,
    });
    const dataState = p ? snap.platformStatus[p].dataState : "OK";
    const camp = campaignId ? campaignById.get(campaignId) : undefined;
    lines.push({
      key: k,
      level,
      platform: p,
      accountId: accountId || null,
      campaignId: campaignId || null,
      name: level === "total" ? "Total izzi" : level === "platform" ? PLATFORMS[p!].name : level === "account" ? (accountName.get(accountId) ?? accountId) : (camp?.name ?? campaignId),
      parentName: level === "campaign" ? (accountName.get(accountId) ?? null) : level === "account" && p ? PLATFORMS[p].name : null,
      budget: b?.amount ?? null,
      spend: agg.mtd,
      todaySpend: agg.today,
      remaining: mp.remaining,
      usedPct: mp.usedPct,
      expectedPct: mp.expectedPct,
      variance: mp.variance,
      forecast: mp.forecast,
      forecastVsBudget: mp.forecastVsBudget,
      status: statusFor(mp.forecastVsBudget, ctx.settings.budget),
      dataState,
    });
  }
  const levelRank: Record<BudgetLevel, number> = { total: 0, platform: 1, account: 2, campaign: 3 };
  lines.sort((a, b) => levelRank[a.level] - levelRank[b.level] || PLATFORM_IDS.indexOf(a.platform ?? "google") - PLATFORM_IDS.indexOf(b.platform ?? "google") || b.spend - a.spend);
  return { month, daysInMonth: nDays, elapsedDays: elapsedFullDays, lines };
}
