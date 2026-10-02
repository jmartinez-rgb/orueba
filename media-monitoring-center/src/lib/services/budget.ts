import "server-only";
import type { BudgetLevel, BudgetRow, Currency, DataState, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { cached } from "@/lib/data/cache";
import { monthlyPacing } from "@/lib/monitoring/pacing-engine";
import { PLATFORMS } from "@/lib/platforms/registry";
import { addDays, daysInMonth, diffDays, monthOf, startOfMonth, weekdayOf } from "@/lib/time/tz";
import type { MonitoringSettings } from "@/lib/config/settings";
import type { AppContext } from "./context";
import type { Snapshot } from "./snapshot";
import { windowTotals, type HourlySeries } from "@/lib/monitoring/historical-comparator";

export interface BudgetLine {
  key: string;
  level: BudgetLevel;
  platform: PlatformId | null;
  accountId: string | null;
  campaignId: string | null;
  name: string;
  parentName: string | null;
  budget: number | null;
  spend: number | null;
  todaySpend: number | null;
  remaining: number | null;
  usedPct: number | null;
  expectedPct: number | null;
  variance: number | null;
  forecast: number | null;
  forecastVsBudget: number | null;
  status: Severity;
  dataState: DataState;
  /** De dónde sale el presupuesto de la línea: directo o suma de las campañas de la cuenta. */
  budgetSource: "direct" | "campaign_sum" | null;
  /** La cuenta tiene presupuesto a nivel cuenta y por campaña y nadie ha confirmado cuál aplica. */
  needsConfirmation: boolean;
  /** Moneda original de la cuenta (los montos ya están en MXN). */
  currency: Currency;
}

export type DetectedBudgetLevel = "account" | "campaign" | "mixed" | "none";

export interface AccountBudgetLevel {
  accountId: string;
  accountName: string;
  platform: PlatformId;
  currency: Currency;
  detected: DetectedBudgetLevel;
  confirmed: "account" | "campaign" | null;
  effective: "account" | "campaign" | null;
  campaignBudgets: number;
  accountBudget: number | null;
  campaignBudgetSum: number | null;
}

export interface BudgetControl {
  month: string;
  daysInMonth: number;
  elapsedDays: number;
  lines: BudgetLine[];
  accounts: AccountBudgetLevel[];
  /** Tasa usada para convertir cuentas en USD este mes (null si no hay cuentas en USD). */
  fxRate: number | null;
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
  const [loadedDaily, sourceBudgets, overrides] = await Promise.all([
    cached(`budget:daily:${ctx.mode}:${ctx.brand}:${ctx.scenario?.id}:${from}:${today}:${snap.meta.cutoffHour}`, 5 * 60 * 1000, () => ctx.source.getDaily({ from, to: today, level: "campaign" })),
    ctx.source.getBudgets(month),
    ctx.store.getOverrides(),
  ]);
  const strict = ctx.mode === "unified";
  // Today's direct-mode subtotal comes from closed hours, never a second daily total.
  const daily = loadedDaily.filter(row => !strict || row.date < today);
  const budgetMap = new Map<string, BudgetRow>();
  // Capas: hoja → arranque de mes → capturados en la app → ajustes aprobados en novedades.
  for (const b of sourceBudgets) budgetMap.set(keyOf(b), b);
  for (const b of ctx.plan.kickoffBudgets.filter((o) => o.month === month)) budgetMap.set(keyOf(b), b);
  for (const b of overrides.budgets.filter((o) => o.month === month)) budgetMap.set(keyOf(b), b);
  for (const b of ctx.plan.novedadBudgets.filter((o) => o.month === month)) budgetMap.set(keyOf(b), b);

  const catalog = snap.catalog;
  const campaignById = new Map(catalog.campaigns.map((c) => [c.id, c]));
  if (strict) {
    const hours = await ctx.source.getHourly({ dates: [today], level: "campaign" });
    const series = new Map<string, HourlySeries>();
    for (const r of hours) if (r.campaignId) {
      const campaign = campaignById.get(r.campaignId);
      if (r.date !== today || !campaign || r.platform !== campaign.platform || (r.accountId !== null && r.accountId !== campaign.accountId) || !Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
      const s = series.get(r.campaignId) ?? new Map();
      const h = s.get(today) ?? Array.from({ length: 24 }, () => null);
      h[r.hour] = r.metrics; s.set(today, h); series.set(r.campaignId, s);
    }
    for (const c of catalog.campaigns) {
      const cutoff = snap.run.entities.find(e => e.key === `platform:${c.platform}`)?.cutoffHour ?? snap.run.cutoffHour;
      const totals = windowTotals(series.get(c.id) ?? new Map(), today, 0, cutoff, true);
      // Real closed hours may form today's subtotal; missing hours never become zero.
      daily.push({ date: today, platform: c.platform, accountId: c.accountId, campaignId: c.id, metrics: totals ?? { spend: null, impressions: null, clicks: null, conversions: null, leads: null, sales: null, whatsapp: null, calls: null, purchases: null, revenue: null } });
    }
  }
  const accountName = new Map(catalog.accounts.map((a) => [a.id, a.name]));
  const accountById = new Map(catalog.accounts.map((a) => [a.id, a]));

  // Nivel de presupuesto por cuenta: detectado en los datos y confirmado en Settings.
  const allBudgets = [...budgetMap.values()];
  const accounts: AccountBudgetLevel[] = catalog.accounts.map((acc) => {
    const accountBudget = budgetMap.get(keyOf({ level: "account", platform: acc.platform, accountId: acc.id, campaignId: null }))?.amount ?? null;
    const camp = allBudgets.filter((b) => b.level === "campaign" && b.accountId === acc.id);
    const detected: DetectedBudgetLevel = accountBudget !== null && camp.length ? "mixed" : accountBudget !== null ? "account" : camp.length ? "campaign" : "none";
    const confirmed = ctx.settings.budgetLevels[acc.id] ?? null;
    const effective = confirmed ?? (detected === "account" || detected === "campaign" ? detected : null);
    return {
      accountId: acc.id,
      accountName: acc.name,
      platform: acc.platform,
      currency: acc.currency,
      detected,
      confirmed,
      effective,
      campaignBudgets: camp.length,
      accountBudget,
      campaignBudgetSum: camp.length ? camp.reduce((a, b) => a + b.amount, 0) : null,
    };
  });
  const levelOf = new Map(accounts.map((a) => [a.accountId, a]));
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
  const monthDays = new Map<string, Set<string>>();
  const unknownMonth = new Set<string>();
  const unknownToday = new Set<string>();
  const historicalDays = new Set<string>();
  const historicalTotals = new Map<string, Map<string, { spend: number; complete: boolean }>>();
  // A date with any row is not complete coverage of an account/platform/brand.
  // Each catalog member must be covered, including members with no rows at all.
  const requiredMembers = new Map<string, string[]>();
  if (strict) {
    const totalKey = keyOf({ level: "total", platform: null, accountId: null, campaignId: null });
    const requireAccount = (platform: PlatformId, accountId: string) => {
      const platformKey = keyOf({ level: "platform", platform, accountId: null, campaignId: null });
      const accountKey = keyOf({ level: "account", platform, accountId, campaignId: null });
      requiredMembers.set(totalKey, []);
      requiredMembers.set(platformKey, [totalKey]);
      requiredMembers.set(accountKey, [platformKey, totalKey]);
      return [accountKey, platformKey, totalKey];
    };
    for (const account of catalog.accounts) requireAccount(account.platform, account.id);
    for (const campaign of catalog.campaigns) {
      const parents = requireAccount(campaign.platform, campaign.accountId);
      requiredMembers.set(keyOf({ level: "campaign", platform: campaign.platform, accountId: campaign.accountId, campaignId: campaign.id }), parents);
    }
  }
  for (const r of daily) {
    const spend = r.metrics.spend ?? 0;
    const camp = r.campaignId ? campaignById.get(r.campaignId) : undefined;
    const accountId = r.accountId ?? camp?.accountId ?? null;
    const keys = [keyOf({ level: "total", platform: null, accountId: null, campaignId: null }), keyOf({ level: "platform", platform: r.platform, accountId: null, campaignId: null })];
    if (accountId) keys.push(keyOf({ level: "account", platform: r.platform, accountId, campaignId: null }));
    if (r.campaignId) keys.push(keyOf({ level: "campaign", platform: r.platform, accountId, campaignId: r.campaignId }));
    for (const k of keys) {
      const a = get(k);
      if (strict && r.date >= monthStart && r.date <= today) {
        const days = monthDays.get(k) ?? new Set<string>(); days.add(r.date); monthDays.set(k, days);
        if (r.metrics.spend === null) unknownMonth.add(k);
        if (r.date === today && r.metrics.spend === null) unknownToday.add(k);
      }
      if (r.date >= monthStart && r.date <= today) a.mtd += spend;
      if (r.date === today) a.today += spend;
      else if (r.date >= histStart && r.date < today && (!strict || r.metrics.spend !== null)) {
        const wd = weekdayOf(r.date);
        a.byWeekday[wd] += spend;
        const seen = seenDay.get(k) ?? new Set<string>();
        if (!seen.has(r.date)) {
          seen.add(r.date);
          a.weekdayDays[wd] += 1;
        }
        seenDay.set(k, seen);
      }
      if (strict && r.date >= histStart && r.date < today) {
        historicalDays.add(r.date);
        const days = historicalTotals.get(k) ?? new Map<string, { spend: number; complete: boolean }>();
        const previous = days.get(r.date) ?? { spend: 0, complete: true };
        days.set(r.date, { spend: previous.spend + spend, complete: previous.complete && r.metrics.spend !== null });
        historicalTotals.set(k, days);
      }
    }
  }
  for (const [member, parents] of requiredMembers) {
    if (unknownMonth.has(member) || (monthDays.get(member)?.size ?? 0) < elapsedFullDays + 1) {
      unknownMonth.add(member);
      for (const parent of parents) unknownMonth.add(parent);
    }
    if (unknownToday.has(member) || !monthDays.get(member)?.has(today)) {
      unknownToday.add(member);
      for (const parent of parents) unknownToday.add(parent);
    }
    for (const date of historicalDays) if (!historicalTotals.get(member)?.get(date)?.complete) {
      for (const parent of parents) {
        const day = historicalTotals.get(parent)?.get(date);
        if (day) day.complete = false;
      }
    }
  }
  if (strict) for (const [k, dates] of historicalTotals) {
    const agg = get(k);
    agg.byWeekday.fill(0);
    agg.weekdayDays.fill(0);
    for (const [date, day] of dates) if (day.complete) {
      const weekday = weekdayOf(date);
      agg.byWeekday[weekday] += day.spend;
      agg.weekdayDays[weekday] += 1;
    }
  }

  const shareFor = (p: PlatformId | null) => (p ? snap.run.pacing[p].curveShare : snap.run.pacing.total.curveShare);
  const lines: BudgetLine[] = [];
  const keys = new Set<string>([...budgetMap.keys(), ...aggs.keys(), ...requiredMembers.keys()]);
  for (const k of keys) {
    const [level, platform, accountId, campaignId] = k.split("|") as [BudgetLevel, string, string, string];
    const agg = aggs.get(k) ?? { mtd: 0, today: 0, byWeekday: [0, 0, 0, 0, 0, 0, 0], weekdayDays: [0, 0, 0, 0, 0, 0, 0] };
    const info = accountId ? levelOf.get(accountId) : undefined;
    let b = budgetMap.get(k);
    let budgetSource: BudgetLine["budgetSource"] = b ? "direct" : null;
    // Presupuesto por campaña confirmado: la cuenta suma sus campañas; el de cuenta se ignora.
    if (level === "account" && info?.effective === "campaign" && info.campaignBudgetSum !== null) {
      b = { month, level: "account", platform: info.platform, accountId: info.accountId, campaignId: null, amount: info.campaignBudgetSum };
      budgetSource = "campaign_sum";
    }
    // Presupuesto a nivel cuenta confirmado: los montos por campaña no se usan para el pacing.
    if (level === "campaign" && info?.effective === "account") {
      b = undefined;
      budgetSource = null;
    }
    if (!b && agg.mtd === 0 && !(strict && (unknownMonth.has(k) || requiredMembers.has(k)))) continue;
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
    const incomplete = strict && (unknownMonth.has(k) || (monthDays.get(k)?.size ?? 0) < elapsedFullDays + 1);
    const cutoff = p ? (snap.run.entities.find(entity => entity.key === `platform:${p}`)?.cutoffHour ?? snap.run.cutoffHour) : snap.run.cutoffHour;
    const forecastIncomplete = incomplete || (strict && ((cutoff < 24 && (!Number.isFinite(share) || share <= 0.02)) || remainingWeekdays.some((weekday) => agg.weekdayDays[weekday] < ctx.settings.history.minSamples)));
    const todayUnknown = strict && (unknownToday.has(k) || !monthDays.get(k)?.has(today));
    const dataState = incomplete ? "PARTIAL" : p ? snap.platformStatus[p].dataState : "OK";
    const camp = campaignId ? campaignById.get(campaignId) : undefined;
    lines.push({
      key: k,
      level,
      platform: p,
      accountId: accountId || null,
      campaignId: campaignId || null,
      name: level === "total" ? `Total ${ctx.brandInfo.name}` : level === "platform" ? PLATFORMS[p!].name : level === "account" ? (accountName.get(accountId) ?? accountId) : (camp?.name ?? campaignId),
      parentName: level === "campaign" ? (accountName.get(accountId) ?? null) : level === "account" && p ? PLATFORMS[p].name : null,
      budget: b?.amount ?? null,
      spend: incomplete ? null : agg.mtd,
      todaySpend: todayUnknown ? null : agg.today,
      remaining: incomplete ? null : mp.remaining,
      usedPct: incomplete ? null : mp.usedPct,
      expectedPct: mp.expectedPct,
      variance: incomplete ? null : mp.variance,
      forecast: forecastIncomplete ? null : mp.forecast,
      forecastVsBudget: forecastIncomplete ? null : mp.forecastVsBudget,
      status: forecastIncomplete ? "ATTENTION" : statusFor(mp.forecastVsBudget, ctx.settings.budget),
      dataState,
      budgetSource,
      needsConfirmation: Boolean(info && info.detected === "mixed" && !info.confirmed && (level === "account" || level === "campaign")),
      currency: accountId ? (accountById.get(accountId)?.currency ?? "MXN") : "MXN",
    });
  }
  const levelRank: Record<BudgetLevel, number> = { total: 0, platform: 1, account: 2, campaign: 3 };
  lines.sort((a, b) => levelRank[a.level] - levelRank[b.level] || PLATFORM_IDS.indexOf(a.platform ?? "google") - PLATFORM_IDS.indexOf(b.platform ?? "google") || (b.spend ?? 0) - (a.spend ?? 0));
  const fx = snap.currency.usdAccounts.length ? (snap.currency.rates.find((r) => r.month === month)?.rate ?? snap.currency.rates.filter((r) => r.month < month).pop()?.rate ?? null) : null;
  return { month, daysInMonth: nDays, elapsedDays: elapsedFullDays, lines, accounts, fxRate: fx };
}
