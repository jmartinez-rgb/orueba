import type { NormalizedAccount, NormalizedBudget } from "../../types/normalized.js";
import { averageDaily, datePart, todayIn } from "../../normalization/budgets.js";
import { tiktokObject } from "./types.js";

/**
 * Presupuestos vigentes de TikTok v1.3 (contrato: campaign/get y adgroup/get del SDK oficial
 * tiktok-business-api-sdk: budget, budget_mode, operation_status, schedule_start/end_time). Los
 * montos vienen en la moneda de la cuenta. Sin presupuesto en la campaña (BUDGET_MODE_INFINITE),
 * cuenta el de cada grupo de anuncios encendido y vigente.
 */
export const BUDGET_CAMPAIGN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective_type",
  "budget",
  "budget_mode",
  "operation_status",
  "secondary_status",
];
export const BUDGET_ADGROUP_FIELDS = [
  "adgroup_id",
  "adgroup_name",
  "campaign_id",
  "budget",
  "budget_mode",
  "operation_status",
  "schedule_start_time",
  "schedule_end_time",
];

const DAILY = new Set(["BUDGET_MODE_DAY", "BUDGET_MODE_DYNAMIC_DAILY_BUDGET"]);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const positive = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const hasBudget = (row: Record<string, unknown>) =>
  (DAILY.has(String(row.budget_mode)) || row.budget_mode === "BUDGET_MODE_TOTAL") && positive(row.budget) !== null;

export function needsAdGroups(campaigns: Record<string, unknown>[]): boolean {
  return campaigns.some((c) => tiktokObject(c) && c.operation_status === "ENABLE" && !hasBudget(c));
}

export function normalizeTikTokBudgets(
  account: NormalizedAccount,
  campaigns: Record<string, unknown>[],
  adGroups: Record<string, unknown>[],
  at: string,
  now = new Date(at),
): NormalizedBudget[] {
  const today = todayIn(account.timezone, now);
  const out: NormalizedBudget[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const g of adGroups.filter(tiktokObject)) {
    const id = text(g.campaign_id);
    const start = datePart(g.schedule_start_time),
      end = datePart(g.schedule_end_time);
    // Encendido y vigente hoy en la zona de la cuenta (las fechas de TikTok vienen en esa zona).
    if (!id || g.operation_status !== "ENABLE" || (end && end < today) || (start && start > today)) continue;
    groups.set(id, [...(groups.get(id) ?? []), g]);
  }
  for (const c of campaigns.filter(tiktokObject)) {
    const campaignId = text(c.campaign_id);
    if (!campaignId || c.operation_status !== "ENABLE") continue;
    const base = {
      platform: "tiktok" as const,
      client_id: account.client_id,
      account_id: account.account_id,
      account_name: account.account_name,
      currency: account.currency,
      campaign_id: campaignId,
      campaign_name: text(c.campaign_name) ?? campaignId,
      objective: text(c.objective_type),
      budget_remaining: null,
      shared_budget_id: null,
      limited_by_budget: null,
      recommended_daily_budget: null,
      extracted_at: at,
    };
    const row = (source: Record<string, unknown>, group: Record<string, unknown> | null): NormalizedBudget => {
      const amount = positive(source.budget);
      const daily = DAILY.has(String(source.budget_mode));
      const start = group ? datePart(group.schedule_start_time) : null,
        end = group ? datePart(group.schedule_end_time) : null;
      return {
        ...base,
        budget_level: group ? "ad_set" : "campaign",
        ad_set_id: group ? text(group.adgroup_id) : null,
        ad_set_name: group ? (text(group.adgroup_name) ?? text(group.adgroup_id)) : null,
        budget_type: daily ? "daily" : "lifetime",
        daily_budget: daily ? amount : null,
        lifetime_budget: daily ? null : amount,
        daily_estimate: daily ? null : averageDaily(amount, start, end),
        start_time: group ? text(group.schedule_start_time) : null,
        end_time: group ? text(group.schedule_end_time) : null,
        raw_metrics: {
          budget_mode: source.budget_mode ?? null,
          secondary_status: c.secondary_status ?? null,
          estimate_method: daily ? null : "total_over_period_days",
        },
      };
    };
    if (hasBudget(c)) {
      out.push(row(c, null));
      continue;
    }
    for (const g of groups.get(campaignId) ?? []) if (hasBudget(g)) out.push(row(g, g));
  }
  return out;
}
