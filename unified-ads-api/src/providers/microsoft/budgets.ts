import type { NormalizedAccount, NormalizedBudget } from "../../types/normalized.js";
import { object } from "./config.js";
import { vendorId } from "./accounts.js";

/**
 * Presupuestos vigentes de Microsoft Advertising v13 (contrato: Campaign del WSDL oficial de
 * CampaignManagement: DailyBudget, BudgetType DailyBudgetStandard/DailyBudgetAccelerated/
 * LifetimeBudgetStandard, BudgetId, Status, EndDate). Solo campañas Active. Con BudgetId el
 * presupuesto es compartido: se informa su ID para contarlo una sola vez. Un presupuesto total no
 * lleva diario estimado porque la API no informa cuánto queda.
 */

function endDate(value: unknown): string | null {
  if (!object(value)) return null;
  const { Year: y, Month: m, Day: d } = value;
  if (typeof y !== "number" || typeof m !== "number" || typeof d !== "number") return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizeMicrosoftBudgets(
  account: NormalizedAccount,
  campaigns: Record<string, unknown>[],
  at: string,
): NormalizedBudget[] {
  // La zona de la cuenta usa nombres propios de Microsoft; se compara contra ayer en UTC para no
  // descartar una campaña que termina hoy en una zona al oeste de UTC.
  const yesterday = new Date(Date.parse(at) - 86_400_000).toISOString().slice(0, 10);
  const out: NormalizedBudget[] = [];
  for (const row of campaigns.filter(object)) {
    if (row.Status !== "Active") continue;
    const end = endDate(row.EndDate);
    if (end && end < yesterday) continue;
    const amount =
      typeof row.DailyBudget === "number" && Number.isFinite(row.DailyBudget) && row.DailyBudget > 0
        ? row.DailyBudget
        : null;
    if (amount === null) continue;
    const lifetime = row.BudgetType === "LifetimeBudgetStandard";
    const id = vendorId(row.Id);
    out.push({
      platform: "microsoft",
      client_id: account.client_id,
      account_id: account.account_id,
      account_name: account.account_name,
      currency: account.currency,
      campaign_id: id,
      campaign_name: typeof row.Name === "string" && row.Name ? row.Name : id,
      objective: typeof row.CampaignType === "string" ? row.CampaignType : null,
      budget_level: "campaign",
      ad_set_id: null,
      ad_set_name: null,
      budget_type: lifetime ? "lifetime" : "daily",
      daily_budget: lifetime ? null : amount,
      lifetime_budget: lifetime ? amount : null,
      budget_remaining: null,
      daily_estimate: null,
      shared_budget_id: row.BudgetId === null || row.BudgetId === undefined ? null : vendorId(row.BudgetId),
      limited_by_budget: null,
      recommended_daily_budget: null,
      start_time: null,
      end_time: end,
      extracted_at: at,
      raw_metrics: { budget_type: row.BudgetType ?? null, status: row.Status },
    });
  }
  return out;
}
