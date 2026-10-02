import "server-only";
import type { Catalog, DailyRow, DataQualityStats, EntityLevel, ExecutionControlRow, FreshnessRecord, HourlyRow, MetricValues, PlatformId, SyncLogEntry } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { emptyMetrics } from "@/lib/metrics";
import { inferObjective } from "@/lib/classifiers/objective";
import type { MonitoringDataSource, DailyQuery, HourlyQuery } from "@/lib/data/source";
import { addDays, businessDate, diffDays, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import { campaignId, sourceId, UnifiedDataError, type ApiPerformance, type UnifiedScope } from "./schema";
import { UnifiedSnapshotStore } from "./store";
import { coverAccounts } from "@/lib/data/account-coverage";
import { domainMetadata, type GoogleDomainConfig } from "@/lib/domains/config";

/** The API report clock can differ from the IANA clock for X historical reports. */
export function reportInstant(row: ApiPerformance, hour: number): Date {
  const offset = row.raw_metrics.report_utc_offset_minutes;
  return offset === undefined ? zonedTimeToUtc(row.date, hour, 0, row.source_timezone) : new Date(Date.parse(row.date) + hour * 3600000 - offset * 60000);
}
export function dailyAligned(row: ApiPerformance, timezone: string): boolean {
  return reportInstant(row, 0).getTime() === zonedTimeToUtc(row.date, 0, 0, timezone).getTime() &&
    reportInstant({ ...row, date: addDays(row.date, 1) }, 0).getTime() === zonedTimeToUtc(addDays(row.date, 1), 0, 0, timezone).getTime();
}
function metrics(row: ApiPerformance): MetricValues {
  // Business result mapping remains pending. Never copy an optimization default as a sale.
  return { ...emptyMetrics(), spend: row.spend, impressions: row.impressions, clicks: row.clicks };
}
function aggregate<T extends DailyRow | HourlyRow>(rows: T[], level: EntityLevel): T[] {
  if (level === "campaign") return rows;
  const groups = new Map<string, T>();
  for (const row of rows) {
    const accountId = level === "account" ? row.accountId : null;
    const key = `${row.date}/${"hour" in row ? row.hour : ""}/${row.platform}/${accountId}`;
    const current = groups.get(key);
    if (!current) groups.set(key, { ...row, accountId, campaignId: null, ...(accountId ? {} : { domain_id: null, domain_name: null, customer_id: null, account_name: null }), metrics: { ...row.metrics } });
    else for (const metric of BASE_METRICS) current.metrics[metric] = current.metrics[metric] === null || row.metrics[metric] === null ? null : current.metrics[metric]! + row.metrics[metric]!;
  }
  return [...groups.values()];
}

/** Read-only durable snapshots: page requests never fan out to the advertising APIs. */
export class UnifiedDataSource implements MonitoringDataSource {
  readonly kind = "unified" as const;
  private domainsPromise: Promise<GoogleDomainConfig | null> | null = null;
  constructor(private readonly opts: { store: UnifiedSnapshotStore; accounts: UnifiedScope[]; timezone: string; clock?: () => Date; domainConfig?: GoogleDomainConfig | null }) {}
  private domains() { return this.domainsPromise ??= this.opts.domainConfig === undefined ? this.opts.store.domainConfig().catch(() => null) : Promise.resolve(this.opts.domainConfig); }
  now() { return this.opts.clock?.() ?? new Date(); }
  private scopes(platforms?: PlatformId[]) { return this.opts.accounts.filter(s => !platforms?.length || platforms.includes(s.platform)); }
  private async annotateRows<T extends DailyRow | HourlyRow>(rows: T[]): Promise<T[]> {
    const accounts = new Map((await this.getCatalog()).accounts.map(account => [account.id, account]));
    return rows.map(row => {
      const account = row.accountId ? accounts.get(row.accountId) : undefined;
      return account ? { ...row, domain_id: account.domain_id, domain_name: account.domain_name, customer_id: account.customer_id, account_name: account.name } : { ...row, domain_id: null, domain_name: null, customer_id: null, account_name: null };
    });
  }
  async getCatalog(): Promise<Catalog> {
    const config = await this.domains();
    const accounts: Catalog["accounts"] = [], campaigns: Catalog["campaigns"] = [];
    for (const scope of this.opts.accounts) {
      const value = await this.opts.store.catalog(scope);
      const name = value?.account.account_name ?? scope.accountId;
      const meta = domainMetadata(config, scope.platform, scope.accountId, name, scope.brand);
      accounts.push({ id: sourceId(scope), platform: scope.platform, name, currency: value?.account.currency ?? scope.currency, brand: scope.brand, ...meta });
      if (!value) continue;
      for (const c of value.campaigns) campaigns.push({ id: campaignId(scope, c.campaign_id), accountId: sourceId(scope), platform: scope.platform, name: c.campaign_name, objective: inferObjective(c.campaign_name, c.objective), status: c.campaign_status === "active" ? "ACTIVE" : c.campaign_status === "paused" ? "PAUSED" : c.campaign_status === "removed" ? "ENDED" : "UNKNOWN", statusText: c.source_status, statusSource: "platform", conversionEvent: null, sourceType: c.objective, ...meta });
    }
    return { accounts, campaigns };
  }
  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    if (diffDays(q.to, q.from) < 0 || diffDays(q.to, q.from) > 400) throw new UnifiedDataError("INVALID_QUERY_RANGE");
    const rows: DailyRow[] = [];
    const config = await this.domains();
    for (const scope of this.scopes(q.platforms)) {
      const catalog = await this.opts.store.catalog(scope);
      if (!catalog) continue;
      const meta = domainMetadata(config, scope.platform, scope.accountId, catalog.account.account_name, scope.brand);
      for (let date = q.from; date <= q.to; date = addDays(date, 1)) {
        const part = await this.opts.store.partition(scope, date, "daily");
        for (const r of part?.rows ?? []) {
          if (!dailyAligned(r, this.opts.timezone) || reportInstant({ ...r, date: addDays(r.date, 1) }, 0).getTime() > Math.min(this.now().getTime(), Date.parse(r.extracted_at))) continue;
          rows.push({ date: r.date, platform: r.platform, accountId: sourceId(scope), campaignId: campaignId(scope, r.campaign_id), metrics: metrics(r), ...meta });
        }
      }
    }
    return this.annotateRows(aggregate(q.level === "campaign" ? rows : coverAccounts(rows, this.scopes(q.platforms).map(s => ({ id: sourceId(s), platform: s.platform }))), q.level));
  }
  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    if (q.dates.length > 100) throw new UnifiedDataError("INVALID_QUERY_RANGE");
    const wanted = new Set(q.dates), dates = [...new Set(q.dates.flatMap(d => [addDays(d, -1), d, addDays(d, 1)]))];
    const rows: HourlyRow[] = [];
    const config = await this.domains();
    for (const scope of this.scopes(q.platforms)) {
      const catalog = await this.opts.store.catalog(scope);
      if (!catalog) continue;
      const meta = domainMetadata(config, scope.platform, scope.accountId, catalog.account.account_name, scope.brand);
      for (const date of dates) {
        const part = await this.opts.store.partition(scope, date, "hourly");
        for (const r of part?.rows ?? []) {
          if (r.hour === null) throw new UnifiedDataError("INVALID_SAVED_PARTITION");
          const instant = reportInstant(r, r.hour), end = instant.getTime() + 3600000;
          if (end > this.now().getTime() || end > Date.parse(r.extracted_at)) continue;
          const local = zonedParts(instant, this.opts.timezone), day = businessDate(instant, this.opts.timezone);
          if (wanted.has(day)) rows.push({ date: day, hour: local.hour, platform: r.platform, accountId: sourceId(scope), campaignId: campaignId(scope, r.campaign_id), metrics: metrics(r), ...meta });
        }
      }
    }
    return this.annotateRows(aggregate(q.level === "campaign" ? rows : coverAccounts(rows, this.scopes(q.platforms).map(s => ({ id: sourceId(s), platform: s.platform }))), q.level));
  }
  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const rows: FreshnessRecord[] = [], today = businessDate(asOf, this.opts.timezone);
    const hourly = await this.getHourly({ dates: [addDays(today, -1), today], level: "campaign" });
    const catalog = await this.getCatalog();
    for (const scope of this.opts.accounts) {
      const attempt = await this.opts.store.attempt(scope, "hourly");
      const times = hourly.filter(r => r.accountId === sourceId(scope)).map(r => zonedTimeToUtc(r.date, r.hour + 1, 0, this.opts.timezone).getTime()).filter(t => t <= asOf.getTime());
      rows.push({ platform: scope.platform, accountId: sourceId(scope), ...domainMetadata(await this.domains(), scope.platform, scope.accountId, catalog.accounts.find(account => account.id === sourceId(scope))?.name ?? scope.accountId, scope.brand), lastDataAt: times.length ? new Date(Math.max(...times)).toISOString() : null, lastSyncAt: attempt && Date.parse(attempt.at) <= asOf.getTime() ? attempt.at : null, lastSyncStatus: !attempt || Date.parse(attempt.at) > asOf.getTime() ? "UNKNOWN" : attempt.status, lastError: attempt?.status === "FAILED" ? attempt.code : null });
    }
    // The engine first checks a platform record, then excludes individual stale/empty accounts.
    for (const platform of new Set(this.opts.accounts.map(s => s.platform))) {
      const accounts = rows.filter(r => r.platform === platform);
      const data = accounts.flatMap(r => r.lastDataAt ? [r.lastDataAt] : []).sort().at(-1) ?? null;
      const sync = accounts.flatMap(r => r.lastSyncAt ? [r.lastSyncAt] : []).sort().at(-1) ?? null;
      const failed = accounts.every(r => r.lastSyncStatus === "FAILED");
      rows.push({ platform, accountId: null, lastDataAt: data, lastSyncAt: sync, lastSyncStatus: failed ? "FAILED" : accounts.some(r => r.lastSyncStatus === "SUCCESS") ? "SUCCESS" : "UNKNOWN", lastError: failed ? accounts[0]?.lastError ?? null : null });
    }
    return rows;
  }
  async getExecutionControl(asOf: Date): Promise<ExecutionControlRow[]> {
    const rows: ExecutionControlRow[] = [];
    for (const scope of this.opts.accounts) for (const granularity of ["daily", "hourly"] as const) {
      const a = await this.opts.store.attempt(scope, granularity), visible = a && Date.parse(a.at) <= asOf.getTime();
      rows.push({ id: `${sourceId(scope)}:${granularity}`, accountId: sourceId(scope), ...domainMetadata(await this.domains(), scope.platform, scope.accountId, (await this.opts.store.catalog(scope))?.account.account_name ?? scope.accountId, scope.brand), step: `API · ${scope.platform} · ${scope.accountId} · ${granularity}`, platform: scope.platform, source: "api", status: visible ? a.status === "FAILED" ? "ERROR" : a.rows ? "OK" : "PARCIAL" : "PENDIENTE", lastRunAt: visible ? a.at : null, rows: visible ? a.rows : null, message: visible ? a.code : "Sin extracción comprobada.", expectedEveryMinutes: 60 });
    }
    return rows;
  }
  async getSyncLog(limit: number): Promise<SyncLogEntry[]> {
    return (await this.getExecutionControl(this.now())).filter(r => r.lastRunAt).map(r => ({ id: r.id, accountId: r.accountId, domain_id: r.domain_id, domain_name: r.domain_name, customer_id: r.customer_id, account_name: r.account_name, platform: r.platform!, workflow: r.step, startedAt: r.lastRunAt!, finishedAt: r.lastRunAt, status: r.status === "ERROR" ? "FAILED" as const : "SUCCESS" as const, rowsLoaded: r.rows, message: r.message })).slice(0, limit);
  }
  async getDataQuality(date: string): Promise<DataQualityStats[]> {
    const rows = await this.getHourly({ dates: [date], level: "campaign" });
    const hour = zonedParts(this.now(), this.opts.timezone).hour - 1;
    const catalog = await this.getCatalog();
    return [...new Set(this.opts.accounts.map(a => a.platform))].map(platform => ({ platform, date, duplicateRows: 0, nullSpendRows: rows.filter(r => r.platform === platform && r.metrics.spend === null).length, lastHourRows: rows.filter(r => r.platform === platform && r.hour === hour).length, expectedLastHourRows: catalog.campaigns.filter(c => c.platform === platform && c.status === "ACTIVE").length }));
  }
  async getBudgets() { return []; }
  async getFxRates() { return []; }
  async estimatedHourly() { return []; }
}
