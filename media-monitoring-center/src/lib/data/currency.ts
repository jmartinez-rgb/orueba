import type { Account, BudgetRow, Catalog, Currency, DailyRow, EntityLevel, FxRate, HourlyRow, MetricValues, PlatformId } from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "./source";
import { addMetrics } from "@/lib/metrics";

/**
 * Conversión a la moneda de reporte (MXN). Las cuentas en USD se convierten con la tasa del
 * mes de cada fecha (la tasa cambia cada mes). Si falta la tasa de un mes se usa la del mes
 * anterior más cercano y se reporta como faltante; si no hay ninguna, el gasto queda NULL
 * (nunca se inventa un valor).
 */

export interface FxIssue {
  accountId: string;
  accountName: string;
  platform: PlatformId;
  month: string;
  kind: "fallback" | "missing";
  usedMonth: string | null;
}

export interface CurrencyReport {
  usdAccounts: Array<{ id: string; name: string; platform: PlatformId }>;
  rates: FxRate[];
  issues: FxIssue[];
}

export interface CurrencyOptions {
  /** Tasas capturadas en Settings (tienen prioridad sobre las de la fuente). */
  rates: Record<string, number>;
  /** Corrección de moneda por cuenta. */
  accountCurrency: Record<string, Currency>;
}

type RateLookup = (month: string) => { rate: number | null; usedMonth: string | null };

function rateLookup(table: Map<string, number>): RateLookup {
  const months = [...table.keys()].sort();
  return (month) => {
    const exact = table.get(month);
    if (exact !== undefined) return { rate: exact, usedMonth: month };
    const prev = months.filter((m) => m < month).pop();
    if (prev) return { rate: table.get(prev)!, usedMonth: prev };
    return { rate: null, usedMonth: null };
  };
}

function convert(values: MetricValues, rate: number | null): MetricValues {
  return {
    ...values,
    spend: values.spend === null ? null : rate === null ? null : values.spend * rate,
    revenue: values.revenue === null ? null : rate === null ? null : values.revenue * rate,
  };
}

export class CurrencyConvertedSource implements MonitoringDataSource {
  readonly kind: MonitoringDataSource["kind"];
  private accountsCache: Promise<Map<string, Account>> | null = null;
  private lookupCache: Promise<RateLookup> | null = null;
  private readonly issues = new Map<string, FxIssue>();

  constructor(
    private readonly inner: MonitoringDataSource,
    private readonly opts: CurrencyOptions,
  ) {
    this.kind = inner.kind;
  }

  now() {
    return this.inner.now();
  }

  /** Fuente original (sin conversión ni correcciones de Settings). */
  get original(): MonitoringDataSource {
    return this.inner;
  }

  private accounts(): Promise<Map<string, Account>> {
    this.accountsCache ??= this.inner.getCatalog().then((c) => new Map(c.accounts.map((a) => [a.id, { ...a, currency: this.opts.accountCurrency[a.id] ?? a.currency }])));
    return this.accountsCache;
  }

  private lookup(): Promise<RateLookup> {
    this.lookupCache ??= this.inner.getFxRates().then((list) => {
      const table = new Map<string, number>(list.map((r) => [r.month, r.rate]));
      for (const [m, r] of Object.entries(this.opts.rates)) table.set(m, r);
      return rateLookup(table);
    });
    return this.lookupCache;
  }

  private rateFor(acc: Account | undefined, date: string, lookup: RateLookup): number | null {
    if (!acc || acc.currency !== "USD") return 1;
    const month = date.slice(0, 7);
    const { rate, usedMonth } = lookup(month);
    if (rate === null || usedMonth !== month) {
      this.issues.set(`${acc.id}|${month}`, { accountId: acc.id, accountName: acc.name, platform: acc.platform, month, kind: rate === null ? "missing" : "fallback", usedMonth });
    }
    return rate;
  }

  private async hasUsd(platforms?: PlatformId[]): Promise<boolean> {
    const accs = await this.accounts();
    return [...accs.values()].some((a) => a.currency === "USD" && (!platforms || platforms.includes(a.platform)));
  }

  async getCatalog(): Promise<Catalog> {
    const c = await this.inner.getCatalog();
    return { ...c, accounts: c.accounts.map((a) => ({ ...a, currency: this.opts.accountCurrency[a.id] ?? a.currency })) };
  }

  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    if (!(await this.hasUsd(q.platforms))) return this.inner.getHourly(q);
    // Se pide a nivel cuenta (o campaña) para convertir antes de agregar.
    const level: EntityLevel = q.level === "platform" ? "account" : q.level;
    const [rows, accs, lookup] = await Promise.all([this.inner.getHourly({ ...q, level }), this.accounts(), this.lookup()]);
    const converted = rows.map((r) => ({ ...r, metrics: convert(r.metrics, this.rateFor(r.accountId ? accs.get(r.accountId) : undefined, r.date, lookup)) }));
    if (q.level !== "platform") return converted;
    const agg = new Map<string, HourlyRow>();
    for (const r of converted) {
      const key = `${r.date}|${r.hour}|${r.platform}`;
      const cur = agg.get(key);
      if (cur) addMetrics(cur.metrics, r.metrics);
      else agg.set(key, { ...r, accountId: null, campaignId: null, metrics: { ...r.metrics } });
    }
    return [...agg.values()];
  }

  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    if (!(await this.hasUsd(q.platforms))) return this.inner.getDaily(q);
    const level: EntityLevel = q.level === "platform" ? "account" : q.level;
    const [rows, accs, lookup] = await Promise.all([this.inner.getDaily({ ...q, level }), this.accounts(), this.lookup()]);
    const converted = rows.map((r) => ({ ...r, metrics: convert(r.metrics, this.rateFor(r.accountId ? accs.get(r.accountId) : undefined, r.date, lookup)) }));
    if (q.level !== "platform") return converted;
    const agg = new Map<string, DailyRow>();
    for (const r of converted) {
      const key = `${r.date}|${r.platform}`;
      const cur = agg.get(key);
      if (cur) addMetrics(cur.metrics, r.metrics);
      else agg.set(key, { ...r, accountId: null, campaignId: null, metrics: { ...r.metrics } });
    }
    return [...agg.values()];
  }

  async getBudgets(month: string): Promise<BudgetRow[]> {
    const [rows, lookup] = await Promise.all([this.inner.getBudgets(month), this.lookup()]);
    return rows.map((b) => {
      if (b.currency !== "USD") return { ...b, currency: "MXN" as const };
      const { rate } = lookup(month);
      return { ...b, amount: rate === null ? Number.NaN : b.amount * rate, currency: "MXN" as const };
    }).filter((b) => Number.isFinite(b.amount));
  }

  getFreshness(asOf: Date) {
    return this.inner.getFreshness(asOf);
  }
  getSyncLog(limit: number) {
    return this.inner.getSyncLog(limit);
  }
  getDataQuality(date: string) {
    return this.inner.getDataQuality(date);
  }
  getExecutionControl(asOf: Date) {
    return this.inner.getExecutionControl(asOf);
  }
  async getFxRates(): Promise<FxRate[]> {
    const list = await this.inner.getFxRates();
    const table = new Map<string, number>(list.map((r) => [r.month, r.rate]));
    for (const [m, r] of Object.entries(this.opts.rates)) table.set(m, r);
    return [...table.entries()].map(([month, rate]) => ({ month, rate })).sort((a, b) => a.month.localeCompare(b.month));
  }

  /** Cuentas en USD, tasas vigentes y meses sin tasa (para la confianza de datos). */
  async currencyReport(months: string[]): Promise<CurrencyReport> {
    const [accs, lookup, rates] = await Promise.all([this.accounts(), this.lookup(), this.getFxRates()]);
    const usd = [...accs.values()].filter((a) => a.currency === "USD");
    for (const a of usd) for (const m of months) this.rateFor(a, `${m}-01`, lookup);
    return {
      usdAccounts: usd.map((a) => ({ id: a.id, name: a.name, platform: a.platform })),
      rates,
      issues: [...this.issues.values()].filter((i) => months.includes(i.month)),
    };
  }
}
