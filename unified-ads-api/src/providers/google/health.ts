import type { DeliveryKind, NormalizedAccount, NormalizedDeliverySignal } from "../../types/normalized.js";
import type { GoogleRow } from "./types.js";

/**
 * Salud de entrega de Google Ads v25 (contrato: Campaign.primary_status y primary_status_reasons
 * del documento de descubrimiento v25). Solo campañas ENABLED; ELIGIBLE sin motivos es sana.
 */
export function healthQuery(): string {
  return "SELECT customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons FROM campaign WHERE campaign.status = 'ENABLED' ORDER BY campaign.id";
}

const POLICY = new Set([
  "HAS_ADS_DISAPPROVED",
  "HAS_ADS_LIMITED_BY_POLICY",
  "MOST_ADS_UNDER_REVIEW",
  "HAS_ASSET_GROUPS_DISAPPROVED",
  "HAS_ASSET_GROUPS_LIMITED_BY_POLICY",
  "MOST_ASSET_GROUPS_UNDER_REVIEW",
  "LEAD_FORM_EXTENSION_DISAPPROVED",
  "CALL_EXTENSION_DISAPPROVED",
]);
const BIDDING = new Set(["BIDDING_STRATEGY_LIMITED", "BIDDING_STRATEGY_CONSTRAINED", "BIDDING_STRATEGY_MISCONFIGURED"]);
const SETUP = new Set([
  "BUDGET_MISCONFIGURED",
  "NO_AD_GROUPS",
  "NO_KEYWORDS",
  "NO_AD_GROUP_ADS",
  "NO_ASSET_GROUPS",
  "AD_GROUPS_PAUSED",
  "KEYWORDS_PAUSED",
  "AD_GROUP_ADS_PAUSED",
  "ASSET_GROUPS_PAUSED",
  "MISSING_LOCATION_TARGETING",
  "CAMPAIGN_GROUP_PAUSED",
  "CAMPAIGN_GROUP_ALL_GROUP_BUDGETS_ENDED",
]);

export function normalizeGoogleHealth(
  row: GoogleRow,
  account: NormalizedAccount,
  at: string,
): NormalizedDeliverySignal[] {
  const c = row.campaign;
  if (!c?.id || c.status !== "ENABLED") return [];
  const status = c.primaryStatus ?? null;
  const reasons = Array.isArray(c.primaryStatusReasons) ? c.primaryStatusReasons : [];
  const base = {
    platform: "google" as const,
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    entity_level: "campaign" as const,
    campaign_id: c.id,
    campaign_name: c.name ?? c.id,
    entity_id: c.id,
    entity_name: c.name ?? c.id,
    detail: null,
    currency: row.customer?.currencyCode ?? account.currency,
    spend_cap: null,
    amount_spent: null,
    extracted_at: at,
  };
  const out: NormalizedDeliverySignal[] = [];
  const add = (kind: DeliveryKind, severity: NormalizedDeliverySignal["severity"], code: string) =>
    out.push({ ...base, kind, severity, code });
  // Estado general sin entrega: no elegible o mal configurada.
  if (status === "NOT_ELIGIBLE" || status === "MISCONFIGURED") add("delivery_issue", "critical", status);
  if (status === "PENDING") add("pending", "info", status);
  for (const r of reasons) {
    if (r === "BUDGET_CONSTRAINED") add("budget_limited", "warning", r);
    else if (POLICY.has(r)) add("policy", r.endsWith("DISAPPROVED") ? "critical" : "warning", r);
    else if (BIDDING.has(r)) add("bidding_limited", r === "BIDDING_STRATEGY_MISCONFIGURED" ? "critical" : "warning", r);
    else if (r === "BIDDING_STRATEGY_LEARNING") add("learning", "info", r);
    else if (SETUP.has(r) && status !== "ELIGIBLE") add("delivery_issue", "warning", r);
  }
  return out;
}
