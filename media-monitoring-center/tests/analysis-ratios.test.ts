import { describe, expect, it } from "vitest";
import { getCompare, getHistorical } from "@/lib/services/analysis";
import { emptyMetrics } from "@/lib/metrics";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { BRANDS } from "@/lib/brands";
import type { MonitoringDataSource } from "@/lib/data/source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import type { MetricId, MetricValues } from "@/lib/types";

const date = "2026-10-01";
const references = ["2026-09-24", "2026-09-17"];
function context(weekly: Partial<MetricValues>[]) {
  const source: MonitoringDataSource = {
    kind: "mock", now: () => new Date("2026-10-02T18:00:00Z"),
    getCatalog: async () => ({ accounts: [{ id: "a", name: "izzi", platform: "google", currency: "MXN" }], campaigns: [] }),
    getHourly: async query => [date, ...references].flatMap((day, index) => query.dates.includes(day) ? [{ date: day, hour: 0, platform: "google" as const, accountId: null, campaignId: null,
      metrics: { ...emptyMetrics(), ...(index ? weekly[index - 1] : { spend: 100, conversions: 2, clicks: 1, impressions: 10 }) } }] : []),
    getDaily: async query => references.flatMap((day, index) => day >= query.from && day <= query.to ? [{ date: day, platform: "google" as const, accountId: null, campaignId: null, metrics: { ...emptyMetrics(), ...weekly[index] } }] : []),
    getBudgets: async () => [], getFreshness: async () => [], getSyncLog: async () => [], getDataQuality: async () => [], getExecutionControl: async () => [], getFxRates: async () => [],
  };
  return { mode: "mock" as const, source: new CurrencyConvertedSource(source, DEFAULT_SETTINGS.currency), settings: DEFAULT_SETTINGS, brandInfo: BRANDS.izzi };
}
const compare = (metric: MetricId, weekly: Partial<MetricValues>[]) => getCompare(context(weekly), { date, cutoffHour: 1, weeksBack: [1, 2], customDates: [], metric, dimension: "platform", platform: "all", focus: null });

describe("ratios de referencia calculados desde totales", () => {
  it("CPA de referencia divide la suma de costo por la suma de conversiones", async () => {
    const result = await compare("cpa", [{ spend: 100, conversions: 1 }, { spend: 100, conversions: 9 }]);
    expect(result.total.values[0]).toBe(50); expect(result.total.avg).toBe(20);
    expect(result.rows[0].avg).toBe(20); expect(result.total.vsAvg).toBe(1.5);
  });
  it("el costo de una referencia con cero conversiones permanece en el numerador", async () => {
    const result = await compare("cpa", [{ spend: 100, conversions: 0 }, { spend: 100, conversions: 10 }]);
    expect(result.total.values.slice(1)).toEqual([null, 10]); expect(result.total.avg).toBe(20);
  });
  it("todas las conversiones cero conservan CPA desconocido", async () => {
    const result = await compare("cpa", [{ spend: 100, conversions: 0 }, { spend: 200, conversions: 0 }]);
    expect(result.total.avg).toBeNull(); expect(result.total.vsAvg).toBeNull();
  });
  it("una referencia con costo desconocido no aporta solo sus conversiones", async () => {
    const result = await compare("cpa", [{ spend: null, conversions: 9 }, { spend: 100, conversions: 1 }]);
    expect(result.total.avg).toBe(100);
  });
  it("CTR de referencia también se deriva de clics e impresiones agregados", async () => {
    const result = await compare("ctr", [{ clicks: 1, impressions: 10 }, { clicks: 9, impressions: 100 }]);
    expect(result.total.avg).toBeCloseTo(10 / 110);
  });

  it.each([
    { label: "CPA agregado", metric: "cpa" as const, weekly: [{ spend: 100, conversions: 1 }, { spend: 100, conversions: 9 }], expected: 20 },
    { label: "gasto con cero conversiones", metric: "cpa" as const, weekly: [{ spend: 100, conversions: 0 }, { spend: 100, conversions: 10 }], expected: 20 },
    { label: "denominador cero", metric: "cpa" as const, weekly: [{ spend: 100, conversions: 0 }, { spend: 200, conversions: 0 }], expected: null },
    { label: "costo desconocido", metric: "cpa" as const, weekly: [{ spend: null, conversions: 9 }, { spend: 100, conversions: 1 }], expected: 100 },
    { label: "CTR agregado", metric: "ctr" as const, weekly: [{ clicks: 1, impressions: 10 }, { clicks: 9, impressions: 100 }], expected: 10 / 110 },
  ])("el perfil de Histórico conserva $label", async ({ metric, weekly, expected }) => {
    const result = await getHistorical(context(weekly), { today: date, weeks: 2, cutoffHour: 1, metric });
    const thursday = result.weekdayProfile.find(row => row.weekday === 4)?.avg;
    if (expected === null) expect(thursday).toBeNull();
    else expect(thursday).toBeCloseTo(expected);
    expect(result.weekdayProfile.find(row => row.weekday === 0)?.avg).toBeNull();
  });
});
