import { describe, expect, it } from "vitest";
import type { UnifiedBudget, UnifiedDeliverySignal } from "@/lib/integrations/unified-api";
import { buildDeliveryView } from "@/lib/services/delivery-health";

// Contrato: un presupuesto diario desconocido no se suma como cero al estimar cuántos días alcanza
// el tope de gasto; sin diario completo de la cuenta, la estimación queda N/D y no oculta el aviso.
const at = "2026-10-01T18:00:00.000Z";
const cap: UnifiedDeliverySignal = { platform: "meta", account_id: "a1", account_name: "MXN - izzi 1", entity_level: "account", campaign_id: null, campaign_name: null, entity_id: "a1", entity_name: "MXN - izzi 1", kind: "spend_cap", severity: "info", code: "SPEND_CAP", detail: null, currency: "MXN", spend_cap: 100000, amount_spent: 98000, extracted_at: at };
const budget = (campaign: string, daily: number | null, estimate: number | null = null): UnifiedBudget => ({ platform: "meta", account_id: "a1", account_name: "MXN - izzi 1", currency: "MXN", campaign_id: campaign, campaign_name: campaign, objective: null, budget_level: "campaign", ad_set_id: null, ad_set_name: null, budget_type: daily === null ? "lifetime" : "daily", daily_budget: daily, lifetime_budget: daily === null ? 50000 : null, budget_remaining: null, daily_estimate: estimate, shared_budget_id: null, limited_by_budget: null, recommended_daily_budget: null, end_time: null, extracted_at: at });
const view = (budgets: UnifiedBudget[]) => buildDeliveryView({ brand: "izzi", platforms: ["meta"], budgets, daysLeft: 18, signals: [cap] });

describe("contrato salud de entrega — tope de gasto con presupuesto diario desconocido", () => {
  it("no oculta el tope ni estima días cuando un presupuesto de la cuenta no tiene diario conocido", () => {
    const result = view([budget("c1", 100), budget("c2", null)]);
    // Con 100 conocidos y el desconocido como 0 se estimarían 20 días y, con 18 días restantes del mes, el aviso se suprimía.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].detail).toMatch(/Quedan 2,000 MXN de 100,000\./);
    expect(result.items[0].detail).not.toMatch(/alcanza para/);
  });
  it("con todos los diarios conocidos (o estimados) conserva la estimación existente", () => {
    const result = view([budget("c1", 100), budget("c2", null, 900)]);
    expect(result.items[0]).toMatchObject({ severity: "warning" });
    expect(result.items[0].detail).toMatch(/alcanza para 2 días/);
  });
});
