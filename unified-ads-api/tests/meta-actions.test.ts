import { describe, expect, it } from "vitest";
import { actionLabel, actionsWorkbook, aggregateActions, matchesRule } from "../src/providers/meta/actions-report.js";

const insights = [
  {
    campaign_id: "1",
    campaign_name: "MXN | Venta CAPI WhatsApp | Hogar",
    spend: "1000",
    actions: [
      { action_type: "onsite_conversion.purchase", value: "12" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "80" },
    ],
    action_values: [{ action_type: "onsite_conversion.purchase", value: "9600" }],
  },
  {
    campaign_id: "2",
    campaign_name: "Mensajes WhatsApp | CDMX",
    spend: "3000",
    actions: [
      { action_type: "offsite_conversion.custom.555", value: "20" },
      { action_type: "lead", value: "40" },
    ],
  },
  {
    campaign_id: "3",
    campaign_name: "Sitio Web | Venta",
    spend: "1000",
    actions: [{ action_type: "offsite_conversion.custom.555", value: "5" }],
  },
];
const names = new Map([["555", "Compras Offline Web (Inbound)"]]);

describe("acciones de Meta por universo", () => {
  it("nombra conversiones personalizadas y marca las que coinciden por nombre con la regla, sin elegir", () => {
    expect(actionLabel("offsite_conversion.custom.555", names)).toBe("Compras Offline Web (Inbound) (personalizada)");
    expect(actionLabel("lead", names)).toBe("lead");
    expect(matchesRule("CAPI WhatsApp", "onsite_conversion.purchase", "")).toBe(true);
    expect(matchesRule("Compras Offline Web", "offsite_conversion.custom.555", "Compras Offline Web (Inbound)")).toBe(
      true,
    );
    expect(matchesRule("Compras Offline Web", "lead", "lead")).toBe(false);
  });

  it("separa universos, suma conversiones y calcula el peso del gasto de las campañas con cada acción", () => {
    const rows = aggregateActions({ id: "111", name: "MXN - izzi 1" }, insights, names);
    const capi = rows.filter((r) => r.universe === "CAPI WhatsApp");
    const rest = rows.filter((r) => r.universe === "Compras Offline Web");
    expect(capi[0]).toMatchObject({
      actionType: "onsite_conversion.purchase",
      conversions: 12,
      value: 9600,
      matchesRule: true,
      universeSpend: 1000,
    });
    expect(rest[0]).toMatchObject({
      actionType: "offsite_conversion.custom.555",
      conversions: 25,
      campaigns: 2,
      campaignSpend: 4000,
      universeSpend: 4000,
      matchesRule: true,
    });
    const sheets = actionsWorkbook(rows, [{ id: "111", name: "MXN - izzi 1", error: null }], {
      since: "2026-09-24",
      until: "2026-09-30",
      generatedAt: "x",
    });
    const config = Object.fromEntries(sheets[1]!.rows.map((r) => [r[0], r[1]]));
    expect(config.META_PRIMARY_CONVERSION_RULES).toBe(
      '[{"campaign_contains":"CAPI WhatsApp","action":"onsite_conversion.purchase"}]',
    );
    expect(config.META_PRIMARY_CONVERSION_ACTION).toBe("offsite_conversion.custom.555");
  });

  it("si no hay una sola candidata lo dice en vez de elegir", () => {
    const rows = aggregateActions({ id: "111", name: "A" }, [insights[1]!], new Map());
    const sheets = actionsWorkbook(rows, [], { since: "a", until: "b", generatedAt: "x" });
    const config = Object.fromEntries(sheets[1]!.rows.map((r) => [r[0], r[1]]));
    expect(config.META_PRIMARY_CONVERSION_ACTION).toMatch(/^Sin candidata por nombre/);
    expect(config.META_PRIMARY_CONVERSION_RULES).toMatch(/^Sin candidata por nombre/);
  });
});
