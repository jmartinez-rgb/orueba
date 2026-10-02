import { describe, expect, it } from "vitest";
import type { UnifiedBudget, UnifiedDeliverySignal } from "@/lib/integrations/unified-api";
import { buildDeliveryView } from "@/lib/services/delivery-health";
import type { BrandId } from "@/lib/brands";

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

describe("salud de entrega con cuentas directas autorizadas", () => {
  const directBase = { ...base, platforms: [...base.platforms] };
  const directAccounts = () => new Map<string, BrandId>([["meta:a1", "izzi"], ["google:a1", "sky"]]);
  const issue = (extra: Partial<UnifiedDeliverySignal> = {}) => signal({ platform: "meta", kind: "account_status", severity: "critical", code: "DISABLED", ...extra });

  it("excluye una cuenta ajena aunque su nombre neutro se clasifique como izzi", () => {
    const view = buildDeliveryView({ ...directBase, directAccounts: directAccounts(), signals: [issue({ account_id: "outside", account_name: "Another Company" })] });
    expect(view.items).toEqual([]);
    expect(view.counts.critical).toBe(0);
    expect(view.extractedAt).toBeNull();
  });

  it("el mapeo explícito prevalece sobre un nombre que diga Sky", () => {
    const view = buildDeliveryView({ ...directBase, directAccounts: directAccounts(), signals: [issue({ account_name: "Sky - Nombre anterior" })] });
    expect(view.items).toHaveLength(1);
  });

  it("una cuenta mixta conserva la marca asignada aunque la campaña mencione la otra", () => {
    const view = buildDeliveryView({ ...directBase, directAccounts: directAccounts(), signals: [issue({ account_name: "izzi - Sky Social", campaign_name: "Sky Sports" })] });
    expect(view.items).toHaveLength(1);
  });

  it("la autorización incluye la plataforma y no se hereda por compartir el ID", () => {
    const view = buildDeliveryView({ ...directBase, directAccounts: directAccounts(), signals: [issue({ platform: "google", account_name: "izzi" })] });
    expect(view.items).toEqual([]);
  });

  it("un mapa vacío no se sustituye por la heurística de nombres", () => {
    expect(buildDeliveryView({ ...directBase, directAccounts: new Map(), signals: [issue()] }).items).toEqual([]);
  });

  it("una extracción ajena más reciente no cambia la hora de esta marca", () => {
    const view = buildDeliveryView({ ...directBase, directAccounts: directAccounts(), signals: [issue(), issue({ account_id: "outside", extracted_at: "2026-10-02T12:00:00Z" })] });
    expect(view.extractedAt).toBe(at);
    expect(view.items).toHaveLength(1);
  });

  it("las fuentes heredadas conservan la selección por nombre", () => {
    const view = buildDeliveryView({ ...directBase, signals: [issue({ account_id: "legacy", account_name: "Another Company" })] });
    expect(view.items).toHaveLength(1);
  });
});
