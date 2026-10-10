import "server-only";
import type { Catalog, DailyRow, DataQualityStats, EntityLevel, ExecutionControlRow, FreshnessRecord, HourlyRow, MetricValues, PlatformId, SyncLogEntry } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { emptyMetrics } from "@/lib/metrics";
import { inferObjective } from "@/lib/classifiers/objective";
import type { MonitoringDataSource, DailyQuery, HistoryCoverage, HourlyQuery } from "@/lib/data/source";
import { addDays, businessDate, diffDays, isValidTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import { campaignId, sourceId, UnifiedDataError, type ApiCatalog, type ApiPerformance, type UnifiedScope } from "./schema";
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
/**
 * Whether an account's report day always matches the business day. Mexico City has no daylight saving time,
 * so an account in America/Chicago is one hour ahead from March to November: its provider daily totals are not
 * Mexican days and are rebuilt from its hourly rows instead. Unknown or non-IANA zones keep the row check.
 */
export function sameReportDay(accountTimezone: string | null | undefined, timezone: string, year = new Date().getUTCFullYear()): boolean {
  if (!accountTimezone || accountTimezone === timezone || !isValidTimeZone(accountTimezone)) return true;
  for (const y of [year, year + 1]) for (let month = 1; month <= 12; month++) for (const day of ["01", "15"]) {
    const date = `${y}-${String(month).padStart(2, "0")}-${day}`;
    if (zonedTimeToUtc(date, 0, 0, accountTimezone).getTime() !== zonedTimeToUtc(date, 0, 0, timezone).getTime()) return false;
  }
  return true;
}
/** The account's report dates that overlap one business day (one or two). */
function reportDatesOf(day: string, accountTimezone: string, timezone: string): string[] {
  const start = zonedTimeToUtc(day, 0, 0, timezone), end = zonedTimeToUtc(addDays(day, 1), 0, 0, timezone);
  return [...new Set([businessDate(start, accountTimezone), businessDate(new Date(end.getTime() - 1), accountTimezone)])];
}
const DERIVED_METRICS = ["spend", "impressions", "clicks"] as const;
/** Code plus its allowlisted diagnosis (no bodies, URLs or tokens), so a failure can be told apart without logs. */
function attemptMessage(attempt: { code: string | null; diagnostic?: string }): string | null {
  if (attempt.code === "DAILY_FROM_HOURLY") return "Días calculados con las horas (la cuenta reporta en otra zona horaria).";
  return attempt.code && attempt.diagnostic ? `${attempt.code} · ${attempt.diagnostic}` : attempt.code;
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
  /** One catalog read per account and request: every query of a snapshot reuses it. */
  private readonly catalogs = new Map<string, Promise<ApiCatalog | null>>();
  private catalog(scope: UnifiedScope) {
    const key = `${scope.brand}/${scope.platform}/${scope.accountId}/${scope.currency}`;
    let value = this.catalogs.get(key);
    if (!value) { value = this.opts.store.catalog(scope); this.catalogs.set(key, value); }
    return value;
  }
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
      const value = await this.catalog(scope);
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
      const catalog = await this.catalog(scope);
      if (!catalog) continue;
      const meta = domainMetadata(config, scope.platform, scope.accountId, catalog.account.account_name, scope.brand);
      const dates: string[] = [];
      for (let date = q.from; date <= q.to; date = addDays(date, 1)) dates.push(date);
      if (!sameReportDay(catalog.account.timezone, this.opts.timezone, Number(dates[0].slice(0, 4)))) {
        rows.push(...(await this.dailyFromHourly(scope, catalog.account.timezone!, dates)).map(row => ({ ...row, ...meta })));
        continue;
      }
      const parts = await this.opts.store.partitions(scope, dates, "daily");
      for (const date of dates) {
        for (const r of parts.get(date)?.rows ?? []) {
          if (!dailyAligned(r, this.opts.timezone) || reportInstant({ ...r, date: addDays(r.date, 1) }, 0).getTime() > Math.min(this.now().getTime(), Date.parse(r.extracted_at))) continue;
          rows.push({ date: r.date, platform: r.platform, accountId: sourceId(scope), campaignId: campaignId(scope, r.campaign_id), metrics: metrics(r), ...meta });
        }
      }
    }
    return this.annotateRows(aggregate(q.level === "campaign" ? rows : coverAccounts(rows, this.scopes(q.platforms).map(s => ({ id: sourceId(s), platform: s.platform }))), q.level));
  }
  /**
   * Business days of an account in another report clock, summed from its hourly rows converted to the business
   * time zone. A day counts only once it has ended and every overlapping report date is stored and was read
   * after that end; otherwise it stays unknown (never zero).
   */
  private async dailyFromHourly(scope: UnifiedScope, accountTimezone: string, days: string[]): Promise<DailyRow[]> {
    const tz = this.opts.timezone;
    const parts = await this.opts.store.partitions(scope, [...new Set(days.flatMap(day => reportDatesOf(day, accountTimezone, tz)))], "hourly");
    const rows: DailyRow[] = [];
    for (const day of days) {
      const end = zonedTimeToUtc(addDays(day, 1), 0, 0, tz).getTime();
      const sources = reportDatesOf(day, accountTimezone, tz).map(date => parts.get(date));
      if (end > this.now().getTime() || sources.some(part => !part || Date.parse(part.extractedAt) < end)) continue;
      const sums = new Map<string, MetricValues>();
      for (const part of sources) for (const r of part!.rows) {
        if (r.hour === null) throw new UnifiedDataError("INVALID_SAVED_PARTITION");
        if (businessDate(reportInstant(r, r.hour), tz) !== day) continue;
        const value = metrics(r), current = sums.get(r.campaign_id);
        if (!current) { sums.set(r.campaign_id, value); continue; }
        for (const metric of DERIVED_METRICS) current[metric] = current[metric] === null || value[metric] === null ? null : current[metric]! + value[metric]!;
      }
      for (const [campaign, value] of sums) rows.push({ date: day, platform: scope.platform, accountId: sourceId(scope), campaignId: campaignId(scope, campaign), metrics: value });
    }
    return rows;
  }
  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    if (q.dates.length > 100) throw new UnifiedDataError("INVALID_QUERY_RANGE");
    const wanted = new Set(q.dates), dates = [...new Set(q.dates.flatMap(d => [addDays(d, -1), d, addDays(d, 1)]))];
    const rows: HourlyRow[] = [];
    const config = await this.domains();
    for (const scope of this.scopes(q.platforms)) {
      const catalog = await this.catalog(scope);
      if (!catalog) continue;
      const meta = domainMetadata(config, scope.platform, scope.accountId, catalog.account.account_name, scope.brand);
      const parts = await this.opts.store.partitions(scope, dates, "hourly");
      for (const date of dates) {
        for (const r of parts.get(date)?.rows ?? []) {
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
      rows.push({ id: `${sourceId(scope)}:${granularity}`, accountId: sourceId(scope), ...domainMetadata(await this.domains(), scope.platform, scope.accountId, (await this.catalog(scope))?.account.account_name ?? scope.accountId, scope.brand), step: `API · ${scope.platform} · ${scope.accountId} · ${granularity}`, platform: scope.platform, source: "api", status: visible ? a.status === "FAILED" ? "ERROR" : a.rows || a.code === "DAILY_FROM_HOURLY" ? "OK" : "PARCIAL" : "PENDIENTE", lastRunAt: visible ? a.at : null, rows: visible ? a.rows : null, message: visible ? attemptMessage(a) : "Sin extracción comprobada.", expectedEveryMinutes: 60 });
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
  /** One listing per brand: which days each account already has stored (empty days included). */
  async historyCoverage(): Promise<HistoryCoverage> {
    const daily = new Map<string, Set<string>>(), hourly = new Map<string, Set<string>>();
    const byBrand = new Map<string, Awaited<ReturnType<UnifiedSnapshotStore["brandPartitionDates"]>>>();
    for (const brand of new Set(this.opts.accounts.map(scope => scope.brand))) byBrand.set(brand, await this.opts.store.brandPartitionDates(brand));
    for (const scope of this.opts.accounts) {
      const stored = byBrand.get(scope.brand)?.get(`${scope.platform}/${scope.accountId}`);
      const hours = stored?.hourly ?? new Set<string>();
      hourly.set(sourceId(scope), hours);
      const accountTimezone = (await this.catalog(scope))?.account.timezone;
      if (sameReportDay(accountTimezone, this.opts.timezone, Number(businessDate(this.now(), this.opts.timezone).slice(0, 4)))) { daily.set(sourceId(scope), stored?.daily ?? new Set()); continue; }
      // Days rebuilt from hours: covered when every overlapping report date is stored.
      const candidates = new Set([...hours].flatMap(date => [addDays(date, -1), date, addDays(date, 1)]));
      daily.set(sourceId(scope), new Set([...candidates].filter(day => reportDatesOf(day, accountTimezone!, this.opts.timezone).every(date => hours.has(date)))));
    }
    return { daily, hourly };
  }
}
