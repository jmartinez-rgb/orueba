import type {
  BudgetRow,
  Catalog,
  DailyRow,
  DataQualityStats,
  FreshnessRecord,
  HourlyRow,
  MetricValues,
  PlatformId,
  SyncLogEntry,
} from "@/lib/types";
import { BASE_METRICS, PLATFORM_IDS } from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "@/lib/data/source";
import { addMetrics, emptyMetrics } from "@/lib/metrics";
import { addDays, businessDate, daysInMonth, diffDays, zonedParts } from "@/lib/time/tz";
import { MOCK_ACCOUNTS, MOCK_CAMPAIGNS, toCampaign } from "./catalog";
import { generateDataset, type MetricSeries, type MockDataset } from "./generator";
import { getScenario } from "./scenarios";

/** Retraso habitual (minutos) con el que llega cada plataforma. */
const NORMAL_LAG_MIN: Record<PlatformId, number> = { google: 2, meta: 6, tiktok: 12, microsoft: 9, spotify: 16, x: 11 };

const datasetCache = new Map<string, MockDataset>();

function getDataset(scenarioId: string, now: Date, tz: string): MockDataset {
  const p = zonedParts(now, tz);
  const key = `${scenarioId}|${tz}|${businessDate(now, tz)}|${p.hour}`;
  let ds = datasetCache.get(key);
  if (!ds) {
    if (datasetCache.size > 6) datasetCache.clear();
    ds = generateDataset(getScenario(scenarioId), now, tz);
    datasetCache.set(key, ds);
  }
  return ds;
}

function valuesAt(series: MetricSeries, idx: number): MetricValues | null {
  const out = emptyMetrics();
  let has = false;
  for (const m of BASE_METRICS) {
    const v = series[m][idx];
    if (!Number.isNaN(v)) {
      out[m] = v;
      has = true;
    }
  }
  return has ? out : null;
}

export interface MockSourceOptions {
  scenarioId: string;
  timezone: string;
  referenceTime?: string;
}

export class MockDataSource implements MonitoringDataSource {
  readonly kind = "mock" as const;
  constructor(private readonly opts: MockSourceOptions) {}

  now(): Date {
    if (this.opts.referenceTime) {
      const d = new Date(this.opts.referenceTime);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  private ds(): MockDataset {
    return getDataset(this.opts.scenarioId, this.now(), this.opts.timezone);
  }

  async getCatalog(): Promise<Catalog> {
    return { accounts: MOCK_ACCOUNTS, campaigns: MOCK_CAMPAIGNS.map(toCampaign) };
  }

  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    const ds = this.ds();
    const rows = new Map<string, HourlyRow>();
    for (const c of MOCK_CAMPAIGNS) {
      if (q.platforms && !q.platforms.includes(c.platform)) continue;
      const s = ds.series.get(c.id);
      if (!s) continue;
      for (const date of q.dates) {
        const d = diffDays(date, ds.startDate);
        if (d < 0 || d >= ds.days) continue;
        for (let h = 0; h < 24; h++) {
          const v = valuesAt(s, d * 24 + h);
          if (!v) continue;
          const accountId = q.level === "platform" ? null : c.accountId;
          const campaignId = q.level === "campaign" ? c.id : null;
          const key = `${date}|${h}|${c.platform}|${accountId}|${campaignId}`;
          const row = rows.get(key);
          if (row) addMetrics(row.metrics, v);
          else rows.set(key, { date, hour: h, platform: c.platform, accountId, campaignId, metrics: v });
        }
      }
    }
    return [...rows.values()];
  }

  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    const ds = this.ds();
    const rows = new Map<string, DailyRow>();
    const n = diffDays(q.to, q.from);
    for (const c of MOCK_CAMPAIGNS) {
      if (q.platforms && !q.platforms.includes(c.platform)) continue;
      const s = ds.series.get(c.id);
      if (!s) continue;
      for (let i = 0; i <= n; i++) {
        const date = addDays(q.from, i);
        const d = diffDays(date, ds.startDate);
        if (d < 0 || d >= ds.days) continue;
        const accountId = q.level === "platform" ? null : c.accountId;
        const campaignId = q.level === "campaign" ? c.id : null;
        const key = `${date}|${c.platform}|${accountId}|${campaignId}`;
        for (let h = 0; h < 24; h++) {
          const v = valuesAt(s, d * 24 + h);
          if (!v) continue;
          const row = rows.get(key);
          if (row) addMetrics(row.metrics, v);
          else rows.set(key, { date, platform: c.platform, accountId, campaignId, metrics: v });
        }
      }
    }
    return [...rows.values()];
  }

  async getBudgets(month: string): Promise<BudgetRow[]> {
    const days = daysInMonth(month);
    const out: BudgetRow[] = [];
    // Presupuestos ligeramente distintos del ritmo histórico para que el pacing sea realista.
    const platformFactor: Record<PlatformId, number> = { google: 0.975, meta: 0.985, tiktok: 0.97, microsoft: 0.91, spotify: 0.99, x: 0.98 };
    let total = 0;
    for (const p of PLATFORM_IDS) {
      const camps = MOCK_CAMPAIGNS.filter((c) => c.platform === p && c.status === "ACTIVE");
      const daily = camps.reduce((a, c) => a + c.dailySpend, 0);
      const amount = Math.round((daily * days * platformFactor[p]) / 1000) * 1000;
      total += amount;
      out.push({ month, level: "platform", platform: p, accountId: null, campaignId: null, amount });
      for (const acc of MOCK_ACCOUNTS.filter((a) => a.platform === p)) {
        const accDaily = camps.filter((c) => c.accountId === acc.id).reduce((a, c) => a + c.dailySpend, 0);
        if (accDaily <= 0) continue;
        out.push({
          month,
          level: "account",
          platform: p,
          accountId: acc.id,
          campaignId: null,
          amount: Math.round((accDaily * days * platformFactor[p]) / 1000) * 1000,
        });
      }
      for (const c of camps) {
        out.push({
          month,
          level: "campaign",
          platform: p,
          accountId: c.accountId,
          campaignId: c.id,
          amount: Math.round((c.dailySpend * days * platformFactor[p]) / 1000) * 1000,
        });
      }
    }
    out.push({ month, level: "total", platform: null, accountId: null, campaignId: null, amount: Math.round(total * 1.0) });
    return out;
  }

  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const ds = this.ds();
    const asOfMs = asOf.getTime();
    const out: FreshnessRecord[] = [];
    for (const p of PLATFORM_IDS) {
      const lagMs = NORMAL_LAG_MIN[p] * 60000;
      const outages = ds.scenario.outages.filter((o) => o.platform === p);
      const accounts = MOCK_ACCOUNTS.filter((a) => a.platform === p);
      let platformLast = 0;
      let platformStatus: FreshnessRecord["lastSyncStatus"] = "SUCCESS";
      let platformError: string | null = null;
      for (const acc of accounts) {
        const outage = outages.find((o) => !o.accountId || o.accountId === acc.id);
        const stop = ds.stopTimes.find((st) => st.platform === p && (!st.accountId || st.accountId === acc.id));
        let last = asOfMs - lagMs;
        if (stop) last = Math.min(last, stop.stopMs);
        const stale = outage && asOfMs - last > 30 * 60000;
        const status = stale ? outage.syncStatus : "SUCCESS";
        const lastSyncAt = status === "FAILED" ? asOfMs - 20 * 60000 : stale ? asOfMs - lagMs : last + 2 * 60000;
        out.push({
          platform: p,
          accountId: acc.id,
          lastDataAt: new Date(last).toISOString(),
          lastSyncAt: new Date(Math.min(lastSyncAt, asOfMs)).toISOString(),
          lastSyncStatus: status,
          lastError: stale ? outage.message : null,
        });
        platformLast = Math.max(platformLast, last);
        if (stale && !outage.accountId) {
          platformStatus = outage.syncStatus;
          platformError = outage.message;
        }
      }
      out.push({
        platform: p,
        accountId: null,
        lastDataAt: new Date(platformLast).toISOString(),
        lastSyncAt: new Date(Math.min(platformStatus === "FAILED" ? asOfMs - 20 * 60000 : platformLast + 2 * 60000, asOfMs)).toISOString(),
        lastSyncStatus: platformStatus,
        lastError: platformError,
      });
    }
    return out;
  }

  async getSyncLog(limit: number): Promise<SyncLogEntry[]> {
    const ds = this.ds();
    const now = this.now().getTime();
    const entries: SyncLogEntry[] = [];
    const workflows: Record<PlatformId, string> = {
      google: "WF01 · Google ingestion",
      meta: "WF02 · Meta ingestion",
      tiktok: "WF03 · TikTok ingestion",
      microsoft: "WF04 · Microsoft ingestion",
      spotify: "WF05 · Spotify ingestion",
      x: "WF06 · X ingestion",
    };
    for (let i = 0; i < 6; i++) {
      const runAt = now - (i * 60 + 5) * 60000;
      for (const p of PLATFORM_IDS) {
        const outage = ds.scenario.outages.find((o) => o.platform === p);
        const stop = ds.stopTimes.find((st) => st.platform === p);
        const affected = outage && stop && runAt > stop.stopMs;
        const failed = affected && outage.syncStatus === "FAILED";
        const rows = MOCK_CAMPAIGNS.filter((c) => c.platform === p && c.status === "ACTIVE").length;
        entries.push({
          id: `sync-${p}-${i}`,
          platform: p,
          workflow: workflows[p],
          startedAt: new Date(runAt).toISOString(),
          finishedAt: new Date(runAt + (40 + ((i * 7) % 50)) * 1000).toISOString(),
          status: failed ? "FAILED" : "SUCCESS",
          rowsLoaded: failed ? 0 : affected ? (outage.accountId ? Math.max(0, rows - 2) : 0) : rows,
          message: affected ? outage.message : null,
        });
      }
      entries.push({
        id: `sync-bq-${i}`,
        platform: "bigquery",
        workflow: "MERGE · tabla horaria consolidada",
        startedAt: new Date(runAt + 3 * 60000).toISOString(),
        finishedAt: new Date(runAt + 3 * 60000 + 12000).toISOString(),
        status: "SUCCESS",
        rowsLoaded: MOCK_CAMPAIGNS.filter((c) => c.status === "ACTIVE").length,
        message: null,
      });
    }
    return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async getDataQuality(date: string): Promise<DataQualityStats[]> {
    const ds = this.ds();
    const lastHour = date === ds.today ? ds.currentHour - 1 : 23;
    const d = diffDays(date, ds.startDate);
    return PLATFORM_IDS.map((p) => {
      const camps = MOCK_CAMPAIGNS.filter((c) => c.platform === p && c.status === "ACTIVE");
      let lastHourRows = 0;
      if (lastHour >= 0 && d >= 0 && d < ds.days) {
        for (const c of camps) {
          const s = ds.series.get(c.id);
          if (s && !Number.isNaN(s.spend[d * 24 + lastHour])) lastHourRows++;
        }
      }
      return {
        platform: p,
        date,
        duplicateRows: date === ds.today ? (ds.scenario.duplicates[p] ?? 0) : 0,
        nullSpendRows: 0,
        lastHourRows,
        expectedLastHourRows: lastHour >= 0 ? camps.length : 0,
      };
    });
  }
}
