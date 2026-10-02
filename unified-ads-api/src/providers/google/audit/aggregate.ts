import type { AuditData, CampaignInfo, DateWindow, Metrics, ShareRow, WindowKey } from "./types.js";

/**
 * Agregados por ventana. CPA = SUMA(costo) ÷ SUMA(conversiones), nunca un promedio de CPA.
 * Ventas y leads se leen de las acciones offline válidas de la cuenta (regla de negocio de izzi).
 */

export const SALES_ACTION = "MCC_Offline_Purchase";
export const LEAD_ACTION = "MCC_Offline_Lead_Contact";
export const VALID_OFFLINE = [SALES_ACTION, LEAD_ACTION];
const norm = (s: string) => s.trim().toLowerCase();
export const isSalesAction = (name: string) => norm(name) === norm(SALES_ACTION);
export const isLeadAction = (name: string) => norm(name) === norm(LEAD_ACTION);

export interface Totals extends Metrics {
  sales: number;
  leads: number;
  days: number;
}

export const ZERO: Metrics = {
  cost: 0,
  impressions: 0,
  clicks: 0,
  interactions: 0,
  conversions: 0,
  value: 0,
  allConversions: 0,
  calls: 0,
};

export const cpa = (m: { cost: number; conversions: number }) => (m.conversions > 0 ? m.cost / m.conversions : null);
export const ctr = (m: { clicks: number; impressions: number }) =>
  m.impressions > 0 ? m.clicks / m.impressions : null;
export const cpc = (m: { cost: number; clicks: number }) => (m.clicks > 0 ? m.cost / m.clicks : null);
export const cvr = (m: { conversions: number; clicks: number }) => (m.clicks > 0 ? m.conversions / m.clicks : null);
export const cpm = (m: { cost: number; impressions: number }) =>
  m.impressions > 0 ? (m.cost / m.impressions) * 1000 : null;
export const roas = (m: { value: number; cost: number }) => (m.cost > 0 && m.value > 0 ? m.value / m.cost : null);
export const salesCpa = (t: Totals) => (t.sales > 0 ? t.cost / t.sales : null);
/** Cambio relativo; null si la base es cero. */
export const delta = (current: number | null, base: number | null) =>
  current === null || base === null || base === 0 ? null : current / base - 1;

export function totals(data: AuditData, w: DateWindow | undefined, campaignId?: string): Totals {
  const t: Totals = { ...ZERO, sales: 0, leads: 0, days: 0 };
  if (!w) return t;
  t.days = Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86_400_000) + 1;
  for (const d of data.daily) {
    if (d.date < w.from || d.date > w.to || (campaignId && d.campaignId !== campaignId)) continue;
    t.cost += d.cost;
    t.impressions += d.impressions;
    t.clicks += d.clicks;
    t.interactions += d.interactions;
    t.conversions += d.conversions;
    t.value += d.value;
    t.allConversions += d.allConversions;
    t.calls += d.calls;
  }
  for (const a of data.actionsDaily) {
    if (a.date < w.from || a.date > w.to || (campaignId && a.campaignId !== campaignId)) continue;
    // Si la acción es primaria, `conversions` coincide con la columna de puja; si es secundaria, solo
    // aparece en todas las conversiones.
    const count = a.conversions > 0 ? a.conversions : a.allConversions;
    if (isSalesAction(a.actionName)) t.sales += count;
    else if (isLeadAction(a.actionName)) t.leads += count;
  }
  return t;
}

export interface CampaignSummary {
  info: CampaignInfo;
  w: Record<WindowKey, Totals>;
  shares: Partial<Record<WindowKey, ShareRow>>;
  /** Gasto diario promedio de los últimos 7 y 14 días. */
  avg7: number;
  avg14: number;
  /** Participación en el gasto de la cuenta (últimos 30 días). */
  share30: number;
  /** Días recientes consecutivos sin gasto, contados desde el último día completo. */
  zeroDays: number;
  firstSpend: string | null;
  changes7: number;
  /** Fecha del último cambio de presupuesto o puja (historial de 30 días). */
  lastBudgetBidChange: string | null;
  biddingChanges30: number;
}

const KEYS: WindowKey[] = ["L7", "P7", "L14", "P14", "L30", "P30", "MTD", "PMTD", "PM", "L90", "PRE_BID"];

export function summarize(data: AuditData): { campaigns: CampaignSummary[]; account: Record<WindowKey, Totals> } {
  const win = (k: WindowKey) => data.windows.find((x) => x.key === k);
  const account = Object.fromEntries(KEYS.map((k) => [k, totals(data, win(k))])) as Record<WindowKey, Totals>;
  const recent = new Date(Date.parse(data.end) - 6 * 86_400_000).toISOString().slice(0, 10);
  const campaigns = data.campaigns.map((info): CampaignSummary => {
    const w = Object.fromEntries(KEYS.map((k) => [k, totals(data, win(k), info.id)])) as Record<WindowKey, Totals>;
    const shares: CampaignSummary["shares"] = {};
    for (const s of data.shares) if (s.campaignId === info.id) shares[s.window] = s;
    const spendByDay = new Map<string, number>();
    for (const d of data.daily)
      if (d.campaignId === info.id) spendByDay.set(d.date, (spendByDay.get(d.date) ?? 0) + d.cost);
    let zeroDays = 0;
    for (let i = 0; i < 90; i++) {
      const day = new Date(Date.parse(data.end) - i * 86_400_000).toISOString().slice(0, 10);
      if ((spendByDay.get(day) ?? 0) > 0) break;
      zeroDays++;
    }
    const spent = [...spendByDay.entries()]
      .filter(([, v]) => v > 0)
      .map(([d]) => d)
      .sort();
    const own = data.changes.filter((c) => c.campaignId === info.id);
    return {
      info,
      w,
      shares,
      avg7: w.L7.cost / 7,
      avg14: w.L14.cost / 14,
      share30: account.L30.cost > 0 ? w.L30.cost / account.L30.cost : 0,
      zeroDays,
      firstSpend: spent[0] ?? null,
      changes7: own.filter((c) => c.at.slice(0, 10) >= recent && isBudgetOrBidding(c.before, c.after)).length,
      lastBudgetBidChange:
        own
          .filter((c) => isBudgetOrBidding(c.before, c.after))
          .map((c) => c.at.slice(0, 10))
          .sort()
          .at(-1) ?? null,
      biddingChanges30: own.filter((c) =>
        Object.keys(c.after).some((k) => k.startsWith("tCPA") || k.startsWith("tROAS") || k === "estrategia"),
      ).length,
    };
  });
  return { campaigns, account };
}

export function isBudgetOrBidding(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return [...Object.keys(before), ...Object.keys(after)].some(
    (k) => k === "presupuesto" || k === "estrategia" || k.startsWith("tCPA") || k.startsWith("tROAS"),
  );
}

/** Campaña que debería estar entregando: activa, sin fecha de fin vencida ni inicio futuro. */
export function shouldServe(c: CampaignInfo, end: string): boolean {
  if (c.status !== "ENABLED") return false;
  if (c.end && c.end < end) return false;
  if (c.start && c.start > end) return false;
  return !["ENDED", "PAUSED", "REMOVED", "PENDING"].includes(c.primaryStatus ?? "");
}

export const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Search",
  PERFORMANCE_MAX: "Performance Max",
  DEMAND_GEN: "Demand Gen",
  DISPLAY: "Display",
  VIDEO: "Video",
  SHOPPING: "Shopping",
  MULTI_CHANNEL: "App",
  SMART: "Smart",
  LOCAL: "Local",
};

export const BIDDING_LABEL: Record<string, string> = {
  MAXIMIZE_CONVERSIONS: "Maximizar conversiones",
  MAXIMIZE_CONVERSION_VALUE: "Maximizar valor de conversión",
  TARGET_CPA: "CPA objetivo",
  TARGET_ROAS: "ROAS objetivo",
  TARGET_SPEND: "Maximizar clics",
  MANUAL_CPC: "CPC manual",
  ENHANCED_CPC: "CPC mejorado",
  TARGET_IMPRESSION_SHARE: "Cuota de impresiones objetivo",
  TARGET_CPM: "CPM objetivo",
  MANUAL_CPM: "CPM manual",
  MANUAL_CPV: "CPV manual",
  TARGET_CPV: "CPV objetivo",
  TARGET_CPC: "CPC objetivo",
};
