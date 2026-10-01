import { describe, expect, it } from "vitest";
import type { UnifiedBudget, UnifiedDeliverySignal } from "@/lib/integrations/unified-api";
import { buildDeliveryView } from "@/lib/services/delivery-health";

const at = "2026-10-01T18:00:00.000Z";
function signal(p: Partial<UnifiedDeliverySignal> & Pick<UnifiedDeliverySignal, "platform" | "kind" | "severity">): UnifiedDeliverySignal {
  return {
    account_id: "a1",
    account_name: "MXN - izzi 1",
    entity_level: "campaign",
    campaign_id: "c1",
    campaign_name: "Venta",
    entity_id: "c1",
    entity_name: "Venta",
    code: null,
    detail: null,
    currency: "MXN",
    spend_cap: null,
    amount_spent: null,
    extracted_at: at,
    ...p,
  };
}
const metaBudget = (daily: number): UnifiedBudget => ({
  platform: "meta",
  account_id: "a1",
  account_name: "MXN - izzi 1",
  currency: "MXN",
  campaign_id: "c1",
  campaign_name: "Venta",
  objective: null,
  budget_level: "campaign",
  ad_set_id: null,
  ad_set_name: null,
  budget_type: "daily",
  daily_budget: daily,
  lifetime_budget: null,
  budget_remaining: null,
  daily_estimate: null,
  shared_budget_id: null,
  limited_by_budget: null,
  recommended_daily_budget: null,
  end_time: null,
  extracted_at: at,
});
const base = { brand: "izzi" as const, platforms: ["meta", "google", "microsoft"] as const, budgets: [] as UnifiedBudget[], daysLeft: 20 };

describe("salud de entrega en el monitoreo", () => {
  it("ordena por gravedad, filtra la marca y explica los códigos de la plataforma", () => {
    const view = buildDeliveryView({
      ...base,
      platforms: [...base.platforms],
      signals: [
        signal({ platform: "google", kind: "budget_limited", severity: "warning", code: "BUDGET_CONSTRAINED" }),
        signal({ platform: "meta", kind: "account_status", severity: "critical", code: "UNSETTLED", entity_level: "account", entity_id: "a1", entity_name: "MXN - izzi 1" }),
        signal({ platform: "microsoft", kind: "paused_by_budget", severity: "warning", code: "BudgetPaused" }),
        signal({ platform: "meta", kind: "learning", severity: "info", code: "LEARNING", entity_level: "ad_set" }),
        signal({ platform: "meta", kind: "delivery_issue", severity: "critical", account_name: "Sky - ABCW" }),
      ],
    });
    expect(view.items.map((i) => [i.severity, i.platform, i.kind])).toEqual([
      ["critical", "meta", "account_status"],
      ["warning", "google", "budget_limited"],
      ["warning", "microsoft", "paused_by_budget"],
      ["info", "meta", "learning"],
    ]);
    expect(view.items[0]).toMatchObject({ title: "Cuenta con problema", detail: "con saldo pendiente" });
    expect(view.counts).toEqual({ critical: 1, warning: 2, info: 1 });
    expect(view.insights.map((i) => i.text).join(" ")).toMatch(/1 cuenta reporta.*1 campaña de Google.*1 campaña de Microsoft.*aprendizaje/);
  });

  it("el tope de gasto de Meta se cruza con el diario de la cuenta: sin ruido si alcanza el mes", () => {
    const cap = (spent: number) => signal({ platform: "meta", kind: "spend_cap", severity: "info", code: "SPEND_CAP", entity_level: "account", entity_id: "a1", spend_cap: 100000, amount_spent: spent });
    const short = buildDeliveryView({ ...base, platforms: ["meta"], budgets: [metaBudget(1000)], signals: [cap(95000)] });
    expect(short.items[0]).toMatchObject({ severity: "warning", kind: "spend_cap" });
    expect(short.items[0]!.detail).toMatch(/Quedan 5,000 MXN de 100,000: alcanza para 5 días/);
    expect(short.insights.some((i) => i.text.includes("tope de gasto de Meta no alcanza"))).toBe(true);
    const critical = buildDeliveryView({ ...base, platforms: ["meta"], budgets: [metaBudget(1000)], signals: [cap(99500)] });
    expect(critical.items[0]).toMatchObject({ severity: "critical" });
    const plenty = buildDeliveryView({ ...base, platforms: ["meta"], budgets: [metaBudget(1000)], signals: [cap(10000)] });
    expect(plenty.items).toEqual([]);
    expect(plenty.insights[0]).toMatchObject({ tone: "good" });
  });
});
