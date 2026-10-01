import { describe, expect, it } from "vitest";
import { MetaProvider } from "../src/providers/meta/index.js";
import { MetaSimulator as Sim } from "./meta-simulator.js";

// Pruebas de la auditoría: comportamiento financiero que no depende de cómo está escrito el código.
const query = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const, account_id: "111" };
function setup(extra: Record<string, string | undefined> = {}) {
  const sim = new Sim();
  return { sim, provider: new MetaProvider({ ...sim.env, ...extra }, { fetch: sim.fetch }) };
}
const sumBy = (rows: Array<{ normalized_conversion: string | null; conversions: number | null }>, category: string) =>
  rows.filter((r) => r.normalized_conversion === category).reduce((a, r) => a + (r.conversions ?? 0), 0);

describe("auditoría Meta: conversiones solapadas", () => {
  it("sumar por categoría no cuenta varias veces la misma compra (pixel, omni y alias)", async () => {
    // La muestra trae 2 compras reportadas como fb_pixel_purchase, omni_purchase y purchase.
    const { provider } = setup({ META_CONVERSION_MAPPING: "" });
    const rows = await provider.getConversions(query);
    expect(sumBy(rows, "PURCHASE")).toBe(2);
    // Las filas solapadas se conservan para conciliación, pero sin categoría por omisión.
    expect(rows.map((r) => r.source_conversion)).toEqual(
      expect.arrayContaining(["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    );
    expect(rows.find((r) => r.source_conversion === "purchase")?.normalized_conversion).toBeNull();
  });

  it("sin acción principal, la categoría por omisión es solo el total agregado (omni_purchase)", async () => {
    const { provider } = setup({ META_CONVERSION_MAPPING: "", META_PRIMARY_CONVERSION_ACTION: "" });
    const rows = await provider.getConversions(query);
    expect(rows.filter((r) => r.normalized_conversion === "PURCHASE").map((r) => r.source_conversion)).toEqual([
      "omni_purchase",
    ]);
    expect(sumBy(rows, "PURCHASE")).toBe(2);
  });
});

describe("auditoría Meta: cero real frente a dato ausente", () => {
  it("un día con gasto y sin la acción principal reporta 0 conversiones, no null", async () => {
    const { provider, sim } = setup();
    sim.insight.actions = [{ action_type: "link_click", value: "15" }];
    sim.insight.action_values = [];
    const [row] = await provider.getPerformance(query);
    expect(row).toMatchObject({ spend: 100.5, conversions: 0, conversion_value: 0, cpa: null });
    expect(row?.raw_metrics.primary_action_present).toBe(false);
  });

  it("sin acción principal configurada las conversiones siguen en null (no se elige una)", async () => {
    const { provider } = setup({ META_PRIMARY_CONVERSION_ACTION: "" });
    expect((await provider.getPerformance(query))[0]).toMatchObject({ conversions: null, cpa: null });
  });
});
