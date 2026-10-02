import type { BrandId } from "@/lib/brands";
import { brandOfCampaign } from "@/lib/brands";
import { classify, classifyCampaign } from "@/lib/classifiers/classify";
import type { ClassifierConfig } from "@/lib/classifiers/defaults";
import type { UnifiedBudget } from "@/lib/integrations/unified-api";
import type { Campaign, PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";

/**
 * Presupuesto diario vigente por plataforma y por estrategia, contra el gasto de hoy. Es lectura de
 * la configuración actual de cada plataforma (no se modifica nada). Reglas:
 * - Montos en MXN; las cuentas en USD usan la tasa del mes. Sin tasa, el presupuesto queda fuera y se avisa.
 * - Un presupuesto total (lifetime) cuenta con su diario estimado; si la plataforma no da cómo
 *   estimarlo, se informa aparte y no suma al diario.
 * - Un presupuesto compartido entre campañas (Google, Microsoft) se cuenta una sola vez.
 * - Estrategias: el mismo clasificador del resto del monitoreo. Umbrales de ritmo: los del equipo.
 */

export interface BudgetInput {
  budgets: UnifiedBudget[];
  brand: BrandId;
  platforms: PlatformId[];
  classifiers: Record<PlatformId, ClassifierConfig>;
  /** Campañas del catálogo por `plataforma:id`: así la estrategia coincide con el resto de la app. */
  campaigns: Map<string, Campaign>;
  /** Gasto de hoy por `plataforma:id`, en MXN. */
  spendToday: Map<string, number | null>;
  /** Direct source: exact account scopes and missing costs remain unknown. */
  directAccounts?: Map<string, BrandId>;
  /** Parte del día que suele haberse gastado a esta hora, por plataforma (curva histórica). */
  curveShare: Partial<Record<PlatformId, number | null>>;
  /** Tasa USD → MXN del mes; null si no hay. */
  fxRate: number | null;
  /** Umbrales de desviación del equipo (Configuración). */
  thresholds: { attention: number; alert: number };
  /** Mes en curso de Budget Control (gasto del mes con hoy y presupuesto mensual por plataforma). */
  month?: MonthContext;
  /** Umbrales de sobre y subejercicio mensual del equipo (Configuración → presupuesto). */
  budgetThresholds?: { overspendAttention: number; underspendAttention: number };
}

export interface MonthContext {
  daysInMonth: number;
  /** Días completos ya transcurridos antes de hoy. */
  elapsedDays: number;
  lines: Partial<Record<PlatformId | "total", { budget: number | null; spend: number | null }>>;
}

/**
 * Cierre de mes si se entrega el presupuesto diario configurado: gasto del mes (con lo de hoy) + lo
 * que falta de hoy + el diario por los días restantes. Es un escenario, no un pronóstico: la
 * plataforma puede entregar menos del diario.
 */
export interface Projection {
  monthBudget: number | null;
  monthSpend: number;
  projected: number;
  /** projected ÷ presupuesto mensual − 1. */
  vsBudget: number | null;
  daysLeft: number;
  /** Diario que cerraría el mes justo en el presupuesto mensual. */
  neededDaily: number | null;
  /** Lectura con los umbrales mensuales del equipo; null sin presupuesto o sin umbrales. */
  status: "over" | "under" | "on" | null;
}

export type Pace = "below" | "on" | "above" | "unknown";

export interface BudgetGroup {
  label: string;
  campaigns: number;
  adSets: number;
  /** Presupuesto diario configurado (MXN). */
  daily: number;
  /** Diario estimado de presupuestos totales (MXN). */
  estimated: number;
  total: number;
  spend: number | null;
  expectedNow: number | null;
  usedPct: number | null;
  pace: number | null;
  paceLabel: Pace;
  share: number;
  /** Campañas con presupuesto activo que no han gastado hoy. */
  idle: number;
  idleBudget: number;
}

export interface BudgetUnitRow {
  key: string;
  name: string;
  account: string;
  strategy: string;
  level: "campaign" | "ad_set" | "shared";
  type: "daily" | "lifetime" | "mixed";
  budget: number;
  spend: number | null;
  usedPct: number | null;
  limited: boolean;
}

export interface Insight {
  tone: "good" | "warn" | "info";
  text: string;
}

export interface PlatformBudgetView {
  platform: PlatformId;
  name: string;
  total: BudgetGroup;
  strategies: BudgetGroup[];
  units: BudgetUnitRow[];
  structure: { campaignLevel: number; adSetLevel: number; shared: number; lifetime: number; lifetimeWithoutEstimate: number };
  insights: Insight[];
  curveShare: number | null;
  projection: Projection | null;
}

export interface BudgetOverview {
  total: BudgetGroup;
  projection: Projection | null;
  platforms: PlatformBudgetView[];
  insights: Insight[];
  excluded: { rows: number; currencies: string[] };
  extractedAt: string | null;
}

const money = (v: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Math.round(v));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function toMxn(amount: number | null, currency: string | null, fx: number | null): number | null {
  if (amount === null) return null;
  if (currency === "MXN") return amount;
  if (currency === "USD" && fx !== null) return amount * fx;
  return null;
}

function emptyGroup(label: string): BudgetGroup {
  return { label, campaigns: 0, adSets: 0, daily: 0, estimated: 0, total: 0, spend: 0, expectedNow: null, usedPct: null, pace: null, paceLabel: "unknown", share: 0, idle: 0, idleBudget: 0 };
}

function finish(g: BudgetGroup, grand: number, share: number | null, t: BudgetInput["thresholds"], expectedOverride?: number | null): BudgetGroup {
  g.share = grand > 0 ? g.total / grand : 0;
  g.usedPct = g.total > 0 && g.spend !== null ? g.spend / g.total : null;
  g.expectedNow = expectedOverride !== undefined ? expectedOverride : share !== null && g.total > 0 ? g.total * share : null;
  g.pace = g.expectedNow && g.expectedNow > 0 && g.spend !== null ? g.spend / g.expectedNow : null;
  g.paceLabel = g.pace === null ? "unknown" : g.pace < 1 - t.attention ? "below" : g.pace > 1 + t.attention ? "above" : "on";
  return g;
}

export function projectMonth(daily: number, spendToday: number | null, month: MonthContext, line: { budget: number | null; spend: number | null } | undefined): Projection | null {
  if (!line || line.spend === null || spendToday === null) return null;
  const daysLeft = Math.max(0, month.daysInMonth - month.elapsedDays - 1);
  const restOfToday = Math.max(0, daily - spendToday);
  const projected = line.spend + restOfToday + daily * daysLeft;
  const budget = line.budget !== null && line.budget > 0 ? line.budget : null;
  return {
    monthBudget: budget,
    monthSpend: line.spend,
    projected,
    vsBudget: budget === null ? null : projected / budget - 1,
    daysLeft,
    neededDaily: budget === null || daysLeft === 0 ? null : Math.max(0, (budget - line.spend - restOfToday) / daysLeft),
    status: null,
  };
}

function withStatus(p: Projection | null, t: BudgetInput["budgetThresholds"]): Projection | null {
  if (!p) return null;
  p.status = p.vsBudget === null || !t ? null : p.vsBudget >= t.overspendAttention ? "over" : p.vsBudget <= -t.underspendAttention ? "under" : "on";
  return p;
}

function projectionInsight(name: string, p: Projection | null, daily: number): Insight | null {
  if (!p || p.vsBudget === null || p.monthBudget === null || p.status === null) return null;
  const needed = p.neededDaily !== null ? ` Para cerrar en ${money(p.monthBudget)}, el diario debería ser ${money(p.neededDaily)} (hoy ${money(daily)}).` : "";
  if (p.status === "over")
    return { tone: "warn", text: `Con los diarios actuales, ${name} cerraría el mes en ${money(p.projected)}, ${pct(p.vsBudget)} sobre su presupuesto mensual.${needed}` };
  if (p.status === "under")
    return { tone: "warn", text: `Con los diarios actuales, ${name} cerraría el mes en ${money(p.projected)}, ${pct(-p.vsBudget)} debajo de su presupuesto mensual.${needed}` };
  return { tone: "good", text: `Con los diarios actuales, ${name} cerraría el mes en ${money(p.projected)}, en línea con su presupuesto mensual (${money(p.monthBudget)}).` };
}

interface Unit {
  key: string;
  campaignIds: Set<string>;
  names: string[];
  account: string;
  strategies: Set<string>;
  adSets: number;
  level: "campaign" | "ad_set" | "shared";
  types: Set<"daily" | "lifetime">;
  daily: number;
  estimated: number;
  lifetimeWithoutEstimate: boolean;
  limited: boolean;
  recommendedExtra: number;
}

function platformView(platform: PlatformId, rows: UnifiedBudget[], input: BudgetInput, excluded: { rows: number; currencies: Set<string> }): PlatformBudgetView {
  const classifier = input.classifiers[platform];
  const units = new Map<string, Unit>();
  for (const b of rows) {
    const daily = toMxn(b.daily_budget, b.currency, input.fxRate);
    const estimated = toMxn(b.daily_estimate, b.currency, input.fxRate);
    const lifetime = toMxn(b.lifetime_budget, b.currency, input.fxRate);
    const convertible = b.budget_type === "daily" ? daily !== null : b.lifetime_budget === null || lifetime !== null;
    if (!convertible) {
      excluded.rows++;
      excluded.currencies.add(b.currency ?? "desconocida");
      continue;
    }
    const known = input.campaigns.get(`${platform}:${b.campaign_id}`);
    const strategy = known ? classifyCampaign(classifier, known) : classify(classifier, { campaign: b.campaign_name, secondary: b.objective, objective: b.objective }).label;
    const key = b.shared_budget_id ? `shared:${b.shared_budget_id}` : `campaign:${b.campaign_id}`;
    const u = units.get(key) ?? {
      key,
      campaignIds: new Set<string>(),
      names: [],
      account: b.account_name,
      strategies: new Set<string>(),
      adSets: 0,
      level: b.shared_budget_id ? "shared" : b.budget_level,
      types: new Set(),
      daily: 0,
      estimated: 0,
      lifetimeWithoutEstimate: false,
      limited: false,
      recommendedExtra: 0,
    };
    const firstForCampaign = !u.campaignIds.has(b.campaign_id);
    u.campaignIds.add(b.campaign_id);
    if (firstForCampaign) u.names.push(b.campaign_name);
    u.strategies.add(strategy);
    u.types.add(b.budget_type);
    if (b.limited_by_budget) u.limited = true;
    if (b.shared_budget_id) {
      // Un compartido llega repetido en cada campaña: su monto se toma una sola vez.
      if (u.daily === 0 && u.estimated === 0) {
        u.daily = daily ?? 0;
        u.estimated = estimated ?? 0;
        if (b.recommended_daily_budget !== null && b.daily_budget !== null) u.recommendedExtra = Math.max(0, (toMxn(b.recommended_daily_budget, b.currency, input.fxRate) ?? 0) - (daily ?? 0));
      }
    } else {
      if (b.budget_level === "ad_set") u.adSets++;
      u.daily += daily ?? 0;
      u.estimated += estimated ?? 0;
      if (b.recommended_daily_budget !== null && daily !== null) u.recommendedExtra += Math.max(0, (toMxn(b.recommended_daily_budget, b.currency, input.fxRate) ?? 0) - daily);
    }
    if (b.budget_type === "lifetime" && b.daily_estimate === null) u.lifetimeWithoutEstimate = true;
    units.set(key, u);
  }

  const share = input.curveShare[platform] ?? null;
  const total = emptyGroup(PLATFORMS[platform].name);
  const groups = new Map<string, BudgetGroup>();
  const out: BudgetUnitRow[] = [];
  for (const u of units.values()) {
    const strategy = u.strategies.size === 1 ? [...u.strategies][0]! : "Presupuesto compartido";
    const g = groups.get(strategy) ?? emptyGroup(strategy);
    const budget = u.daily + u.estimated;
    const spend = [...u.campaignIds].reduce<number | null>((s, id) => {
      const value = input.spendToday.get(`${platform}:${id}`);
      return s === null || (value == null && input.directAccounts) ? null : s + (value ?? 0);
    }, 0);
    for (const x of [g, total]) {
      x.campaigns += u.campaignIds.size;
      x.adSets += u.adSets;
      x.daily += u.daily;
      x.estimated += u.estimated;
      x.total += budget;
      x.spend = x.spend === null || spend === null ? null : x.spend + spend;
      if (spend === 0 && budget > 0) {
        x.idle += u.campaignIds.size;
        x.idleBudget += budget;
      }
    }
    groups.set(strategy, g);
    out.push({
      key: u.key,
      name: u.level === "shared" && u.names.length > 1 ? `Compartido · ${plural(u.names.length, "campaña", "campañas")}: ${u.names.slice(0, 2).join(", ")}${u.names.length > 2 ? "…" : ""}` : u.names[0]!,
      account: u.account,
      strategy,
      level: u.level,
      type: u.types.size > 1 ? "mixed" : [...u.types][0]!,
      budget,
      spend,
      usedPct: budget > 0 && spend !== null ? spend / budget : null,
      limited: u.limited,
    });
  }
  const strategies = [...groups.values()].map((g) => finish(g, total.total, share, input.thresholds)).sort((a, b) => b.total - a.total);
  finish(total, total.total, share, input.thresholds);
  out.sort((a, b) => b.budget - a.budget);

  const all = [...units.values()];
  const structure = {
    campaignLevel: all.filter((u) => u.level === "campaign").length,
    adSetLevel: all.filter((u) => u.level === "ad_set").length,
    shared: all.filter((u) => u.level === "shared").length,
    lifetime: all.filter((u) => u.types.has("lifetime")).length,
    lifetimeWithoutEstimate: all.filter((u) => u.lifetimeWithoutEstimate).length,
  };

  const insights: Insight[] = [];
  const name = PLATFORMS[platform].name;
  if (total.campaigns) {
    const top = strategies[0];
    if (top && strategies.length > 1) insights.push({ tone: "info", text: `${top.label} concentra ${pct(top.share)} del presupuesto diario de ${name}.` });
    insights.push(...paceInsights(strategies, input.thresholds));
    if (total.idle) insights.push({ tone: "warn", text: `${plural(total.idle, "campaña con presupuesto activo no ha", "campañas con presupuesto activo no han")} gastado hoy (${money(total.idleBudget)} de presupuesto diario sin entregar).` });
    const over = out.filter((r) => r.usedPct !== null && r.usedPct > 1);
    if (over.length) insights.push({ tone: "info", text: `${plural(over.length, "presupuesto ya se superó", "presupuestos ya se superaron")} hoy.` });
    const limited = out.filter((r) => r.limited);
    if (limited.length) {
      const extra = all.filter((u) => u.limited).reduce((s, u) => s + u.recommendedExtra, 0);
      insights.push({
        tone: "warn",
        text: `${name} reporta ${plural(limited.length, "campaña limitada", "campañas limitadas")} por presupuesto${extra > 0 ? `; su recomendación suma ${money(extra)} diarios más` : ""}.`,
      });
    }
    if (structure.shared) insights.push({ tone: "info", text: `${plural(structure.shared, "presupuesto compartido", "presupuestos compartidos")} entre campañas: cada uno se cuenta una vez.` });
    if (structure.lifetime) {
      const missing = structure.lifetimeWithoutEstimate;
      insights.push({
        tone: "info",
        text: `${plural(structure.lifetime, "presupuesto total", "presupuestos totales")}: ${missing ? `${missing} sin diario estimable (la plataforma no informa cuánto queda) y no suman al diario` : "su diario es estimado"}.`,
      });
    }
  }
  const projection = withStatus(input.month ? projectMonth(total.total, total.spend, input.month, input.month.lines[platform]) : null, input.budgetThresholds);
  const closing = projectionInsight(name, projection, total.total);
  if (closing) insights.unshift(closing);
  return { platform, name, total, strategies, units: out, structure, insights, curveShare: share, projection };
}

/**
 * Ritmo por grupo sin saturar la lectura: las desviaciones mayores al umbral de alerta van una por
 * una (hasta tres, de mayor a menor); las que solo pasan el de atención se resumen en una línea.
 */
function paceInsights(groups: BudgetGroup[], t: BudgetInput["thresholds"]): Insight[] {
  const off = groups.filter((g) => g.pace !== null && g.paceLabel !== "on").sort((a, b) => Math.abs(b.pace! - 1) - Math.abs(a.pace! - 1));
  const strong = off.filter((g) => Math.abs(g.pace! - 1) > t.alert);
  const out: Insight[] = strong.slice(0, 3).map((g) => ({
    tone: "warn",
    text:
      g.paceLabel === "below"
        ? `${g.label} va al ${pct(g.pace!)} de lo esperado a esta hora (${money(g.spend!)} de ${money(g.expectedNow ?? 0)}): revisa entrega.`
        : `${g.label} va al ${pct(g.pace!)} de lo esperado a esta hora: podría agotar su presupuesto antes del cierre.`,
  }));
  const rest = off.filter((g) => !strong.slice(0, 3).includes(g));
  for (const side of ["below", "above"] as const) {
    const list = rest.filter((g) => g.paceLabel === side);
    if (!list.length) continue;
    const range = list.map((g) => g.pace!);
    const lo = pct(Math.min(...range)),
      hi = pct(Math.max(...range));
    const span = lo === hi ? `al ${lo}` : `entre ${lo} y ${hi}`;
    out.push({
      tone: "warn",
      text: `${out.length ? "Además, " : ""}${list.length === 1 ? `${list[0]!.label} va` : `${list.length} grupos van`} ${side === "below" ? "por debajo" : "por encima"} de lo esperado a esta hora (${span})${list.length > 1 ? `: ${list.slice(0, 4).map((g) => g.label).join(", ")}${list.length > 4 ? "…" : ""}` : ""}.`,
    });
  }
  return out;
}

export function buildBudgetOverview(input: BudgetInput): BudgetOverview {
  const excluded = { rows: 0, currencies: new Set<string>() };
  const byPlatform = new Map<PlatformId, UnifiedBudget[]>();
  for (const b of input.budgets) {
    const platform = b.platform as PlatformId;
    const brand = input.directAccounts ? input.directAccounts.get(`${platform}:${b.account_id}`) : brandOfCampaign(b.account_name, b.campaign_name);
    if (!input.platforms.includes(platform) || brand !== input.brand) continue;
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), b]);
  }
  // Una plataforma cuyos presupuestos quedaron todos fuera (sin tasa) no se muestra vacía; el aviso queda en el total.
  const platforms = input.platforms
    .filter((p) => byPlatform.has(p))
    .map((p) => platformView(p, byPlatform.get(p)!, input, excluded))
    .filter((p) => p.total.campaigns > 0);
  const total = emptyGroup("Total");
  let expected: number | null = 0;
  for (const p of platforms) {
    total.campaigns += p.total.campaigns;
    total.adSets += p.total.adSets;
    total.daily += p.total.daily;
    total.estimated += p.total.estimated;
    total.total += p.total.total;
    total.spend = total.spend === null || p.total.spend === null ? null : total.spend + p.total.spend;
    total.idle += p.total.idle;
    total.idleBudget += p.total.idleBudget;
    expected = expected === null || p.total.expectedNow === null ? (p.total.total > 0 ? null : expected) : expected + p.total.expectedNow;
  }
  finish(total, total.total, null, input.thresholds, total.total > 0 ? expected : null);
  for (const p of platforms) p.total.share = total.total > 0 ? p.total.total / total.total : 0;
  platforms.sort((a, b) => b.total.total - a.total.total);

  const insights: Insight[] = [];
  if (total.campaigns) {
    insights.push({
      tone: "info",
      text: `${money(total.total)} de presupuesto diario activo en ${plural(total.campaigns, "campaña", "campañas")} de ${plural(platforms.length, "plataforma", "plataformas")}.`,
    });
    if (platforms.length > 1) insights.push({ tone: "info", text: `${platforms[0]!.name} concentra ${pct(platforms[0]!.total.share)} del presupuesto diario.` });
    if (total.pace !== null && total.paceLabel === "on") insights.push({ tone: "good", text: `El total va en ritmo: ${pct(total.pace)} de lo esperado a esta hora.` });
    insights.push(...paceInsights(platforms.map((p) => ({ ...p.total, label: p.name })), input.thresholds));
  }
  if (excluded.rows) insights.push({ tone: "warn", text: `${plural(excluded.rows, "presupuesto", "presupuestos")} en ${[...excluded.currencies].join(", ")} quedaron fuera por falta de tasa de cambio.` });
  // Cierre combinado de las plataformas con presupuesto leído (las demás no entran en el escenario).
  const projections = platforms.map((p) => p.projection).filter((p): p is Projection => p !== null);
  let projection: Projection | null = null;
  if (projections.length && (!input.directAccounts || projections.length === platforms.length)) {
    const budgets = projections.map((p) => p.monthBudget);
    const monthBudget = budgets.every((b) => b !== null) ? budgets.reduce<number>((s, b) => s + b!, 0) : null;
    const projected = projections.reduce((s, p) => s + p.projected, 0);
    const daysLeft = projections[0]!.daysLeft;
    const monthSpend = projections.reduce((s, p) => s + p.monthSpend, 0);
    const restOfToday = projected - monthSpend - total.total * daysLeft;
    projection = {
      monthBudget,
      monthSpend,
      projected,
      vsBudget: monthBudget ? projected / monthBudget - 1 : null,
      daysLeft,
      neededDaily: monthBudget && daysLeft ? Math.max(0, (monthBudget - monthSpend - restOfToday) / daysLeft) : null,
      status: null,
    };
    withStatus(projection, input.budgetThresholds);
    const closing = projectionInsight("el total", projection, total.total);
    if (closing) insights.splice(Math.min(1, insights.length), 0, closing);
  }
  const extractedAt = [...byPlatform.values()].flat().reduce<string | null>((max, b) => (max === null || b.extracted_at > max ? b.extracted_at : max), null);
  return { total, projection, platforms, insights, excluded: { rows: excluded.rows, currencies: [...excluded.currencies] }, extractedAt };
}
