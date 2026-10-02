import type { BudgetRow, Catalog, DailyRow, EntityLevel, FreshnessRecord, HourlyRow, PlatformId } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { coverAccounts } from "./account-coverage";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "./source";
import type { BrandId } from "@/lib/brands";
import { enrichCatalog, filterCatalog, scopedBudgets } from "@/lib/domains/scope";
import type { DomainSelection, GoogleDomainConfig } from "@/lib/domains/types";
import { zonedParts } from "@/lib/time/tz";

function aggregate<T extends DailyRow | HourlyRow>(rows: T[], level: EntityLevel): T[] {
  if (level === "campaign") return rows;
  const groups = new Map<string, T>();
  for (const row of rows) {
    const accountId = level === "account" ? row.accountId : null;
    const key = `${row.date}/${"hour" in row ? row.hour : "daily"}/${row.platform}/${accountId}`;
    const current = groups.get(key);
    if (!current) groups.set(key, { ...row, accountId, campaignId: null, ...(accountId ? {} : { customer_id: null, account_name: null }), metrics: { ...row.metrics } });
    else for (const metric of BASE_METRICS) current.metrics[metric] = current.metrics[metric] === null || row.metrics[metric] === null ? null : current.metrics[metric]! + row.metrics[metric]!;
  }
  return [...groups.values()];
}

/** View-only dimension. Filtering precedes aggregation; expected accounts never disappear. */
export class DomainScopedSource implements MonitoringDataSource {
  readonly kind: MonitoringDataSource["kind"];
  private catalogPromise: Promise<Catalog> | null = null;
  constructor(readonly inner: MonitoringDataSource, readonly selection: DomainSelection, private config: GoogleDomainConfig | null, private brand: BrandId, private timezone = "America/Mexico_City") { this.kind = inner.kind; }
  now() { return this.inner.now(); }
  getCatalog() { return this.catalogPromise ??= this.inner.getCatalog().then(catalog => filterCatalog(enrichCatalog(catalog, this.config, this.brand), this.selection)); }
  private async rows<T extends DailyRow | HourlyRow>(load: () => Promise<T[]>, level: EntityLevel, platforms?: PlatformId[]) {
    const catalog = await this.getCatalog();
    const accounts = catalog.accounts.filter(account => !platforms?.length || platforms.includes(account.platform));
    const accountById = new Map(accounts.map(account => [account.id, account]));
    if (!accounts.length) return [];
    const filtered = (await load()).filter(row => row.accountId !== null && accountById.has(row.accountId)).map(row => {
      const account = accountById.get(row.accountId!)!;
      return { ...row, domain_id: account.domain_id, domain_name: account.domain_name, customer_id: account.customer_id, account_name: account.name };
    });
    const covered = (level === "campaign" ? filtered : coverAccounts(filtered, accounts)).map(row => {
      const account = row.accountId ? accountById.get(row.accountId) : undefined;
      return account ? { ...row, domain_id: account.domain_id, domain_name: account.domain_name, customer_id: account.customer_id, account_name: account.name } : row;
    });
    return aggregate(covered, level);
  }
  async getDaily(query: DailyQuery): Promise<DailyRow[]> {
    if (this.selection.id === "all") return this.inner.getDaily(query);
    return this.rows(() => this.inner.getDaily({ ...query, level: "campaign" }), query.level, query.platforms);
  }
  async getHourly(query: HourlyQuery): Promise<HourlyRow[]> {
    if (this.selection.id === "all") return this.inner.getHourly(query);
    return this.rows(() => this.inner.getHourly({ ...query, level: "campaign" }), query.level, query.platforms);
  }
  async getBudgets(month: string): Promise<BudgetRow[]> { return scopedBudgets(await this.inner.getBudgets(month), await this.getCatalog(), this.selection.id !== "all"); }
  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const full = await this.inner.getFreshness(asOf);
    if (this.selection.id === "all") return full;
    const catalog = await this.getCatalog();
    const rows: FreshnessRecord[] = catalog.accounts.map(account => {
      const known = full.find(row => row.accountId === account.id && row.platform === account.platform);
      return { ...(known ?? { platform: account.platform, accountId: account.id, lastDataAt: null, lastSyncAt: null, lastSyncStatus: "UNKNOWN", lastError: null }), domain_id: account.domain_id, domain_name: account.domain_name, customer_id: account.customer_id, account_name: account.name };
    });
    for (const platform of new Set(catalog.accounts.map(account => account.platform))) {
      const selected = rows.filter(row => row.platform === platform);
      const latest = (field: "lastDataAt" | "lastSyncAt") => selected.flatMap(row => row[field] ? [row[field]!] : []).sort().at(-1) ?? null;
      rows.push({ platform, accountId: null, lastDataAt: latest("lastDataAt"), lastSyncAt: latest("lastSyncAt"), lastSyncStatus: selected.length && selected.every(row => row.lastSyncStatus === "FAILED") ? "FAILED" : selected.some(row => row.lastSyncStatus === "SUCCESS") ? "SUCCESS" : "UNKNOWN", lastError: selected.find(row => row.lastSyncStatus === "FAILED")?.lastError ?? null, domain_id: this.selection.id, domain_name: this.selection.name });
    }
    return rows;
  }
  async getDataQuality(date: string) {
    if (this.selection.id === "all") return this.inner.getDataQuality(date);
    const [rows, catalog] = await Promise.all([this.getHourly({ dates: [date], level: "campaign" }), this.getCatalog()]);
    const lastHour = zonedParts(this.now(), this.timezone).hour - 1;
    return [...new Set(catalog.accounts.map(account => account.platform))].map(platform => {
      const selected = rows.filter(row => row.platform === platform);
      const keys = selected.map(row => `${row.date}/${row.hour}/${row.accountId}/${row.campaignId}`);
      return { platform, date, duplicateRows: keys.length - new Set(keys).size, nullSpendRows: selected.filter(row => row.metrics.spend === null).length, lastHourRows: selected.filter(row => row.hour === lastHour).length, expectedLastHourRows: catalog.campaigns.filter(campaign => campaign.platform === platform && campaign.status === "ACTIVE").length };
    });
  }
  async getExecutionControl(asOf: Date) {
    const rows = await this.inner.getExecutionControl(asOf);
    if (this.selection.id === "all") return rows;
    const ids = new Set((await this.getCatalog()).accounts.map(account => account.id));
    return rows.filter(row => typeof row.accountId === "string" && ids.has(row.accountId));
  }
  async getSyncLog(limit: number) {
    const rows = await this.inner.getSyncLog(limit);
    if (this.selection.id === "all") return rows;
    const ids = new Set((await this.getCatalog()).accounts.map(account => account.id));
    return rows.filter(row => typeof row.accountId === "string" && ids.has(row.accountId));
  }
  getFxRates() { return this.inner.getFxRates(); }
  async estimatedHourly(date: string) { const platforms = new Set((await this.getCatalog()).accounts.map(account => account.platform)); return ((await this.inner.estimatedHourly?.(date)) ?? []).filter(platform => platforms.has(platform)); }
}
