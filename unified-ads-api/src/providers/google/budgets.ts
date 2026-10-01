import type { NormalizedAccount, NormalizedBudget } from "../../types/normalized.js";
import { averageDaily, datePart } from "../../normalization/budgets.js";
import { googleNumber, type GoogleRow } from "./types.js";

/**
 * Presupuestos vigentes de Google Ads v25 (contrato: CampaignBudget y Campaign del documento de
 * descubrimiento v25). Solo campañas ENABLED que están entregando (serving_status SERVING). El
 * monto viene en micros de la moneda de la cuenta. Un presupuesto compartido se reporta en cada
 * campaña con su ID para contarlo una sola vez.
 */
export function budgetsQuery(): string {
  return [
    "SELECT customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.serving_status,",
    "campaign.primary_status_reasons, campaign.advertising_channel_type, campaign.start_date_time, campaign.end_date_time,",
    "campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.total_amount_micros,",
    "campaign_budget.period, campaign_budget.explicitly_shared, campaign_budget.has_recommended_budget,",
    "campaign_budget.recommended_budget_amount_micros",
    "FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.serving_status = 'SERVING' ORDER BY campaign.id",
  ].join(" ");
}

const micros = (v: unknown) => {
  const n = googleNumber(v);
  return n === null || n <= 0 ? null : n / 1_000_000;
};

export function normalizeGoogleBudget(row: GoogleRow, account: NormalizedAccount, at: string): NormalizedBudget | null {
  const c = row.campaign,
    b = row.campaignBudget;
  if (!c?.id || !b || c.status !== "ENABLED" || c.servingStatus !== "SERVING") return null;
  const custom = b.period === "CUSTOM_PERIOD";
  const daily = custom ? null : micros(b.amountMicros);
  const lifetime = custom ? micros(b.totalAmountMicros) : null;
  if (daily === null && lifetime === null) return null;
  const start = datePart(c.startDateTime),
    end = datePart(c.endDateTime);
  const budgetId = typeof b.resourceName === "string" ? (b.resourceName.split("/").pop() ?? null) : null;
  return {
    platform: "google",
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    currency: row.customer?.currencyCode ?? account.currency,
    campaign_id: c.id,
    campaign_name: c.name ?? c.id,
    objective: c.advertisingChannelType ?? null,
    budget_level: "campaign",
    ad_set_id: null,
    ad_set_name: null,
    budget_type: custom ? "lifetime" : "daily",
    daily_budget: daily,
    lifetime_budget: lifetime,
    budget_remaining: null,
    daily_estimate: custom ? averageDaily(lifetime, start, end) : null,
    shared_budget_id: b.explicitlyShared === true ? budgetId : null,
    limited_by_budget: Array.isArray(c.primaryStatusReasons)
      ? c.primaryStatusReasons.includes("BUDGET_CONSTRAINED")
      : null,
    recommended_daily_budget:
      b.hasRecommendedBudget === true && !custom ? micros(b.recommendedBudgetAmountMicros) : null,
    start_time: c.startDateTime ?? null,
    end_time: c.endDateTime ?? null,
    extracted_at: at,
    raw_metrics: {
      period: b.period ?? null,
      budget_id: budgetId,
      primary_status_reasons: c.primaryStatusReasons ?? null,
      estimate_method: custom ? "total_over_period_days" : null,
    },
  };
}
