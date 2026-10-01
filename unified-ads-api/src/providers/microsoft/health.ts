import type { NormalizedAccount, NormalizedDeliverySignal } from "../../types/normalized.js";
import { object } from "./config.js";
import { vendorId } from "./accounts.js";

/**
 * Salud de entrega de Microsoft Advertising v13 (contrato: CampaignStatus del WSDL oficial:
 * Active, Paused, BudgetPaused, BudgetAndManualPaused, Deleted, Suspended). BudgetPaused significa
 * que la campaña se detuvo por presupuesto; Suspended, que Microsoft la suspendió.
 */
export function normalizeMicrosoftHealth(
  account: NormalizedAccount,
  campaigns: Record<string, unknown>[],
  at: string,
): NormalizedDeliverySignal[] {
  const out: NormalizedDeliverySignal[] = [];
  for (const row of campaigns.filter(object)) {
    const status = row.Status;
    if (status !== "BudgetPaused" && status !== "BudgetAndManualPaused" && status !== "Suspended") continue;
    const id = vendorId(row.Id),
      name = typeof row.Name === "string" && row.Name ? row.Name : id;
    out.push({
      platform: "microsoft",
      client_id: account.client_id,
      account_id: account.account_id,
      account_name: account.account_name,
      entity_level: "campaign",
      campaign_id: id,
      campaign_name: name,
      entity_id: id,
      entity_name: name,
      kind: status === "Suspended" ? "delivery_issue" : "paused_by_budget",
      // BudgetAndManualPaused también fue pausada a mano: no se trata como urgencia.
      severity: status === "Suspended" ? "critical" : status === "BudgetPaused" ? "warning" : "info",
      code: status,
      detail: null,
      currency: account.currency,
      spend_cap: null,
      amount_spent: null,
      extracted_at: at,
    });
  }
  return out;
}
