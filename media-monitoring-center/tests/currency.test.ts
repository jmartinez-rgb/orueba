import { describe, expect, it } from "vitest";
import type { BudgetRow, Catalog, DailyRow, FxRate, HourlyRow } from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "@/lib/data/source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { emptyMetrics } from "@/lib/metrics";

function row(date: string, accountId: string, spend: number): HourlyRow {
  return { date, hour: 10, platform: "google", accountId, campaignId: `${accountId}-c`, metrics: { ...emptyMetrics(), spend, clicks: 10 } };
}

class FakeSource implements MonitoringDataSource {
  readonly kind = "mock" as const;
  constructor(
    private readonly rows: HourlyRow[],
    private readonly rates: FxRate[],
  ) {}
  now() {
    return new Date("2026-09-28T18:00:00Z");
  }
  async getCatalog(): Promise<Catalog> {
    return {
      accounts: [
        { id: "mx", platform: "google", name: "Cuenta MXN", currency: "MXN" },
        { id: "us", platform: "google", name: "Cuenta USD", currency: "USD" },
      ],
      campaigns: [],
    };
  }
  async getHourly(q: HourlyQuery) {
    const rows = this.rows.filter((r) => q.dates.includes(r.date));
    if (q.level === "platform") {
      // La fuente original no puede convertir: devolvería la suma mezclando monedas.
      throw new Error("La conversión debe pedir el nivel cuenta");
    }
    return rows;
  }
  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    return this.rows.filter((r) => r.date >= q.from && r.date <= q.to).map((r) => ({ date: r.date, platform: r.platform, accountId: r.accountId, campaignId: r.campaignId, metrics: r.metrics }));
  }
  async getBudgets(month: string): Promise<BudgetRow[]> {
    return [
      { month, level: "account", platform: "google", accountId: "us", campaignId: null, amount: 1000, currency: "USD" },
      { month, level: "account", platform: "google", accountId: "mx", campaignId: null, amount: 5000 },
    ];
  }
  async getFreshness() {
    return [];
  }
  async getSyncLog() {
    return [];
  }
  async getDataQuality() {
    return [];
  }
  async getExecutionControl() {
    return [];
  }
  async getFxRates() {
    return this.rates;
  }
}

const rows = [row("2026-09-28", "mx", 100), row("2026-09-28", "us", 10), row("2026-08-31", "us", 10), row("2026-07-15", "us", 10)];

describe("conversión USD → MXN con tasa mensual", () => {
  it("convierte solo las cuentas en USD con la tasa del mes de cada fecha", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-08", rate: 18 }, { month: "2026-09", rate: 20 }]), { rates: {}, accountCurrency: {} });
    const out = await src.getHourly({ dates: ["2026-09-28", "2026-08-31"], level: "account" });
    const spend = (d: string, a: string) => out.find((r) => r.date === d && r.accountId === a)?.metrics.spend;
    expect(spend("2026-09-28", "mx")).toBe(100);
    expect(spend("2026-09-28", "us")).toBe(200);
    expect(spend("2026-08-31", "us")).toBe(180);
    expect(out[0].metrics.clicks).toBe(10);
  });
  it("agrega a nivel plataforma después de convertir", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-09", rate: 20 }]), { rates: {}, accountCurrency: {} });
    const out = await src.getHourly({ dates: ["2026-09-28"], level: "platform" });
    expect(out).toHaveLength(1);
    expect(out[0].metrics.spend).toBe(300);
    expect(out[0].accountId).toBeNull();
  });
  it("las tasas de Settings tienen prioridad sobre las de la fuente", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-09", rate: 20 }]), { rates: { "2026-09": 18.5 }, accountCurrency: {} });
    const out = await src.getHourly({ dates: ["2026-09-28"], level: "account" });
    expect(out.find((r) => r.accountId === "us")?.metrics.spend).toBeCloseTo(185);
  });
  it("sin tasa del mes usa la anterior y lo reporta; sin ninguna, el gasto queda NULL", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-08", rate: 18 }]), { rates: {}, accountCurrency: {} });
    const out = await src.getHourly({ dates: ["2026-09-28", "2026-07-15"], level: "account" });
    expect(out.find((r) => r.date === "2026-09-28" && r.accountId === "us")?.metrics.spend).toBe(180);
    expect(out.find((r) => r.date === "2026-07-15" && r.accountId === "us")?.metrics.spend).toBeNull();
    const report = await src.currencyReport(["2026-09", "2026-07"]);
    expect(report.usdAccounts.map((a) => a.id)).toEqual(["us"]);
    expect(report.issues.map((i) => `${i.month}:${i.kind}`).sort()).toEqual(["2026-07:missing", "2026-09:fallback"]);
  });
  it("Settings puede corregir la moneda de una cuenta", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-09", rate: 20 }]), { rates: {}, accountCurrency: { mx: "USD" } });
    const out = await src.getHourly({ dates: ["2026-09-28"], level: "account" });
    expect(out.find((r) => r.accountId === "mx")?.metrics.spend).toBe(2000);
    const catalog = await src.getCatalog();
    expect(catalog.accounts.find((a) => a.id === "mx")?.currency).toBe("USD");
  });
  it("convierte presupuestos en USD", async () => {
    const src = new CurrencyConvertedSource(new FakeSource(rows, [{ month: "2026-09", rate: 20 }]), { rates: {}, accountCurrency: {} });
    const b = await src.getBudgets("2026-09");
    expect(b.find((x) => x.accountId === "us")?.amount).toBe(20000);
    expect(b.find((x) => x.accountId === "mx")?.amount).toBe(5000);
    expect(b.every((x) => x.currency === "MXN")).toBe(true);
  });
});
