import { describe, expect, it } from "vitest";
import { aggregateReportTotals } from "@/lib/services/report";
import { emptyMetrics } from "@/lib/metrics";

describe("cobertura de totales del reporte", () => {
  const known = { ...emptyMetrics(), spend: 100, clicks: 3 };
  it("una campaña sin muestra no transforma un subtotal en el total de la cuenta", () => {
    const result = aggregateReportTotals([{ today: known, yesterday: known, lastWeek: known }, { today: null, yesterday: known, lastWeek: known }], true);
    expect(result.today).toBeNull();
    expect(result.yesterday?.spend).toBe(200);
    expect(aggregateReportTotals([undefined, { today: known, yesterday: known, lastWeek: known }], true).today).toBeNull();
  });
  it("conserva ceros conocidos y no convierte conversiones desconocidas en cero", () => {
    const zero = { ...known, spend: 0 };
    const result = aggregateReportTotals([{ today: zero, yesterday: known, lastWeek: known }], true);
    expect(result.today?.spend).toBe(0);
    expect(result.today?.conversions).toBeNull();
  });
  it("preserva la agregación heredada fuera de APIs directas", () => {
    expect(aggregateReportTotals([undefined, { today: known, yesterday: known, lastWeek: known }], false).today?.spend).toBe(100);
  });
});
