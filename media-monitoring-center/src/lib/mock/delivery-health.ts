import type { UnifiedDeliverySignal } from "@/lib/integrations/unified-api";
import type { Snapshot } from "@/lib/services/snapshot";
import type { PlatformId } from "@/lib/types";

/**
 * Señales de salud de demostración para el modo demo: unas cuantas por plataforma sobre campañas
 * del catálogo de ejemplo, con las mismas formas que devuelve la API. Nunca se usan con datos reales.
 */
export function demoDeliverySignals(snap: Snapshot): UnifiedDeliverySignal[] {
  const at = snap.meta.generatedAt;
  const accounts = new Map(snap.catalog.accounts.map((a) => [a.id, a]));
  const pick = (platform: PlatformId, n: number) =>
    snap.catalog.campaigns.filter((c) => c.platform === platform && c.status === "ACTIVE").slice(0, n);
  const signal = (c: (typeof snap.catalog.campaigns)[number], extra: Partial<UnifiedDeliverySignal>): UnifiedDeliverySignal => {
    const account = accounts.get(c.accountId);
    return {
      platform: c.platform,
      account_id: c.accountId,
      account_name: account?.name ?? c.accountId,
      entity_level: "campaign",
      campaign_id: c.id,
      campaign_name: c.name,
      entity_id: c.id,
      entity_name: c.name,
      kind: "delivery_issue",
      severity: "warning",
      code: null,
      detail: null,
      currency: account?.currency ?? "MXN",
      spend_cap: null,
      amount_spent: null,
      extracted_at: at,
      ...extra,
    };
  };
  const out: UnifiedDeliverySignal[] = [];
  const meta = pick("meta", 4);
  if (meta[0]) out.push(signal(meta[0], { severity: "critical", code: "WITH_ISSUES", detail: "El método de pago de la cuenta fue rechazado." }));
  if (meta[1]) out.push(signal(meta[1], { entity_level: "ad_set", entity_id: `${meta[1].id}-a`, entity_name: "Conjunto A", kind: "learning", severity: "info", code: "LEARNING" }));
  if (meta[2]) out.push(signal(meta[2], { entity_level: "ad_set", entity_id: `${meta[2].id}-b`, entity_name: "Conjunto B", kind: "learning_limited", severity: "warning", code: "FAIL" }));
  if (meta[3]) {
    const account = accounts.get(meta[3].accountId);
    out.push(
      signal(meta[3], {
        entity_level: "account",
        campaign_id: null,
        campaign_name: null,
        entity_id: meta[3].accountId,
        entity_name: account?.name ?? meta[3].accountId,
        kind: "spend_cap",
        severity: "info",
        code: "SPEND_CAP",
        spend_cap: 1_500_000,
        amount_spent: 1_420_000,
      }),
    );
  }
  const google = pick("google", 5);
  google.slice(0, 3).forEach((c) => out.push(signal(c, { kind: "budget_limited", code: "BUDGET_CONSTRAINED" })));
  if (google[3]) out.push(signal(google[3], { kind: "policy", severity: "critical", code: "HAS_ADS_DISAPPROVED" }));
  if (google[4]) out.push(signal(google[4], { kind: "learning", severity: "info", code: "BIDDING_STRATEGY_LEARNING" }));
  const microsoft = pick("microsoft", 1);
  if (microsoft[0]) out.push(signal(microsoft[0], { kind: "paused_by_budget", code: "BudgetPaused" }));
  return out;
}
