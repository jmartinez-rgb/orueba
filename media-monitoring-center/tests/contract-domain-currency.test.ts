import { describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { selectDomain } from "@/lib/domains/scope";
import { DomainScopedSource } from "@/lib/data/domain-source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { emptyMetrics, metricValue } from "@/lib/metrics";
import type { MonitoringDataSource } from "@/lib/data/source";
import type { Catalog, DailyRow } from "@/lib/types";

// Contrato: el filtro de dominio precede a la agregación y la conversión USD→MXN ocurre por cuenta
// antes de sumar. Sin tasa del equipo el total queda N/D: nunca un subtotal solo MXN ni una tasa inventada.
const master = googleDomainsSchema.parse({ version: 1, domains: [{ id: "alpha", name: "Dominio sintético", accounts: [{ customerId: "1111111111", name: "Uno" }], absoluteTopMinimum: 0.5 }], absoluteTop: { minImpressions: 100, warningGapPp: 5, suddenDropThresholdPp: 7, deepeningGapPp: 5, repeatAfterHours: 6, retentionDays: 90 } });
const catalog: Catalog = {
  accounts: [
    { id: "google:1111111111", platform: "google", name: "Clasificada", brand: "izzi", currency: "MXN" },
    { id: "google:4444444444", platform: "google", name: "Sin dominio MXN", brand: "izzi", currency: "MXN" },
    { id: "google:5555555555", platform: "google", name: "Sin dominio USD", brand: "izzi", currency: "USD" },
  ],
  campaigns: ["1111111111", "4444444444", "5555555555"].map(id => ({ id: `google:${id}:c`, accountId: `google:${id}`, platform: "google" as const, name: "Campaña", status: "ACTIVE" as const, objective: "TRAFFIC" as const, conversionEvent: null })),
};
const row = (id: string, spend: number, conversions: number | null = null): DailyRow => ({ date: "2026-10-01", platform: "google", accountId: `google:${id}`, campaignId: `google:${id}:c`, metrics: { ...emptyMetrics(), spend, impressions: 100, clicks: 10, conversions } });
const inner: MonitoringDataSource = {
  kind: "unified", now: () => new Date("2026-10-02T12:00:00Z"), getCatalog: async () => catalog,
  getDaily: async () => [row("1111111111", 1000, 10), row("4444444444", 200, 4), row("5555555555", 10, 1)], getHourly: async () => [],
  getFreshness: async () => [], getBudgets: async () => [], getFxRates: async () => [], getDataQuality: async () => [], getExecutionControl: async () => [], getSyncLog: async () => [],
};
const view = (rates: Record<string, number>) => new CurrencyConvertedSource(new DomainScopedSource(inner, selectDomain("unclassified", "izzi", master), master, "izzi"), { rates, accountCurrency: {} });

describe("contrato dominio × moneda", () => {
  it("sin tasa del mes ni anterior, el total del dominio queda N/D y se reporta la tasa faltante", async () => {
    const source = view({});
    const [platform] = await source.getDaily({ from: "2026-10-01", to: "2026-10-01", level: "platform" });
    expect(platform.metrics.spend).toBeNull();
    expect(platform.metrics.impressions).toBe(200);
    expect((await source.currencyReport(["2026-10"])).issues).toEqual([expect.objectContaining({ accountId: "google:5555555555", kind: "missing", usedMonth: null })]);
  });
  it("con la tasa capturada convierte por cuenta antes de sumar y excluye la cuenta de otro dominio", async () => {
    const [platform] = await view({ "2026-10": 18 }).getDaily({ from: "2026-10-01", to: "2026-10-01", level: "platform" });
    expect(platform.metrics.spend).toBe(200 + 10 * 18);
    // CPA = suma de costo / suma de conversiones, nunca el promedio de CPAs por cuenta.
    expect(metricValue(platform.metrics, "cpa")).toBeCloseTo((200 + 180) / 5);
  });
  it("una tasa anterior se usa solo como provisional y queda señalada", async () => {
    const source = view({ "2026-09": 17 });
    const [platform] = await source.getDaily({ from: "2026-10-01", to: "2026-10-01", level: "platform" });
    expect(platform.metrics.spend).toBe(200 + 170);
    expect((await source.currencyReport(["2026-10"])).issues).toEqual([expect.objectContaining({ kind: "fallback", usedMonth: "2026-09" })]);
  });
  it("una tasa futura nunca se aplica a un mes anterior", async () => {
    const [platform] = await view({ "2026-11": 19 }).getDaily({ from: "2026-10-01", to: "2026-10-01", level: "platform" });
    expect(platform.metrics.spend).toBeNull();
  });
});
