import type {
  BudgetRow,
  Catalog,
  DailyRow,
  DataQualityStats,
  ExecutionControlRow,
  ExecutionStatus,
  FreshnessRecord,
  FxRate,
  HourlyRow,
  IngestionMode,
  MetricValues,
  PlatformId,
  SyncLogEntry,
} from "@/lib/types";
import { BASE_METRICS, PLATFORM_IDS } from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "@/lib/data/source";
import { addMetrics, emptyMetrics } from "@/lib/metrics";
import { addDays, businessDate, daysInMonth, diffDays, monthOf, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import { PLATFORMS } from "@/lib/platforms/registry";
import { MOCK_ACCOUNTS, MOCK_CAMPAIGNS, mockFxRate, toCampaign } from "./catalog";
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
  /** Modo de ingesta por plataforma (define los pasos de la hoja de control). */
  ingestion?: Partial<Record<PlatformId, IngestionMode>>;
}

/**
 * Nivel de presupuesto simulado por cuenta: la mayoría a nivel cuenta, algunas por campaña
 * (Universal+, Discovery) y una con ambos niveles cargados para mostrar "confirmar nivel".
 */
const CAMPAIGN_LEVEL_ACCOUNTS = new Set(["g-107", "g-108", "m-211", "m-212"]);
const MIXED_LEVEL_ACCOUNTS = new Set(["g-102"]);

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
    return { accounts: MOCK_ACCOUNTS.map((a) => ({ ...a })), campaigns: MOCK_CAMPAIGNS.map(toCampaign) };
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
    const round = (v: number, step: number) => Math.round(v / step) * step;
    const rate = mockFxRate(month);
    let total = 0;
    for (const p of PLATFORM_IDS) {
      const camps = MOCK_CAMPAIGNS.filter((c) => c.platform === p && c.status === "ACTIVE");
      const daily = camps.reduce((a, c) => a + c.dailySpend, 0);
      const amount = round(daily * days * platformFactor[p], 1000);
      total += amount;
      out.push({ month, level: "platform", platform: p, accountId: null, campaignId: null, amount, currency: "MXN" });
      for (const acc of MOCK_ACCOUNTS.filter((a) => a.platform === p)) {
        const accCamps = camps.filter((c) => c.accountId === acc.id);
        const accDaily = accCamps.reduce((a, c) => a + c.dailySpend, 0);
        if (accDaily <= 0) continue;
        // Montos en la moneda de la cuenta (USD se convierte en la app con la tasa del mes).
        const toAcc = acc.currency === "USD" ? 1 / rate : 1;
        const step = acc.currency === "USD" ? 100 : 1000;
        if (!CAMPAIGN_LEVEL_ACCOUNTS.has(acc.id)) {
          out.push({ month, level: "account", platform: p, accountId: acc.id, campaignId: null, amount: round(accDaily * days * platformFactor[p] * toAcc, step), currency: acc.currency });
        }
        if (CAMPAIGN_LEVEL_ACCOUNTS.has(acc.id) || MIXED_LEVEL_ACCOUNTS.has(acc.id)) {
          for (const c of accCamps) {
            out.push({ month, level: "campaign", platform: p, accountId: c.accountId, campaignId: c.id, amount: round(c.dailySpend * days * platformFactor[p] * toAcc, step), currency: acc.currency });
          }
        }
      }
    }
    out.push({ month, level: "total", platform: null, accountId: null, campaignId: null, amount: Math.round(total), currency: "MXN" });
    return out;
  }

  async getFxRates(): Promise<FxRate[]> {
    const today = businessDate(this.now(), this.opts.timezone);
    const out: FxRate[] = [];
    // Cubre todo el histórico simulado (15 semanas) y el mes en curso.
    for (let d = addDays(today, -120); d <= today; d = addDays(d, 28)) out.push({ month: monthOf(d), rate: mockFxRate(monthOf(d)) });
    out.push({ month: monthOf(today), rate: mockFxRate(monthOf(today)) });
    return [...new Map(out.map((r) => [r.month, r])).values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  async getExecutionControl(asOf: Date): Promise<ExecutionControlRow[]> {
    const ds = this.ds();
    const tz = this.opts.timezone;
    const asOfMs = asOf.getTime();
    const today = businessDate(asOf, tz);
    // Dataslayer corre cada 2 horas (hh:50, antes de cada evaluación) y Apps Script 5 minutos después.
    const runs: number[] = [];
    for (const d of [addDays(today, -1), today]) for (let h = 5; h <= 23; h += 2) runs.push(zonedTimeToUtc(d, h, 50, tz).getTime());
    const lastRun = runs.filter((t) => t <= asOfMs).pop() ?? asOfMs - 2 * 3600 * 1000;
    const rows: ExecutionControlRow[] = [];
    for (const p of PLATFORM_IDS) {
      const mode = this.opts.ingestion?.[p] ?? "sheets";
      const outage = ds.scenario.outages.find((o) => o.platform === p && !o.accountId);
      const accountOutage = ds.scenario.outages.find((o) => o.platform === p && o.accountId);
      const stop = ds.stopTimes.find((st) => st.platform === p && !st.accountId);
      const expectedRows = MOCK_CAMPAIGNS.filter((c) => c.platform === p && c.status === "ACTIVE").length * 2;
      let status: ExecutionStatus = "OK";
      let at: number | null = lastRun;
      let rowsLoaded: number | null = expectedRows;
      let message: string | null = null;
      if (outage && stop && asOfMs - stop.stopMs > 30 * 60000) {
        status = outage.syncStatus === "FAILED" ? "ERROR" : "PENDIENTE";
        at = runs.filter((t) => t <= stop.stopMs).pop() ?? stop.stopMs;
        rowsLoaded = outage.syncStatus === "FAILED" ? 0 : null;
        message = outage.syncStatus === "FAILED" ? outage.message : `No se ha ejecutado desde el corte anterior: ${outage.message}`;
      } else if (accountOutage) {
        const acc = MOCK_ACCOUNTS.find((a) => a.id === accountOutage.accountId);
        status = "PARCIAL";
        rowsLoaded = Math.max(0, expectedRows - 4);
        message = `0 filas nuevas para ${acc?.name ?? accountOutage.accountId}.`;
      }
      rows.push({
        id: `exec-${p}`,
        step: mode === "api" ? `API directa (n8n) · ${PLATFORMS[p].name}` : `Dataslayer · ${PLATFORMS[p].name} → Google Sheets`,
        platform: p,
        source: mode === "api" ? "api" : "dataslayer",
        status,
        lastRunAt: at === null ? null : new Date(at).toISOString(),
        rows: rowsLoaded,
        message,
        expectedEveryMinutes: 120,
      });
    }
    const anyError = rows.some((r) => r.status === "ERROR");
    rows.push({
      id: "exec-apps-script",
      step: "Apps Script · Google Sheets → BigQuery",
      platform: null,
      source: "apps_script",
      status: anyError ? "PARCIAL" : "OK",
      lastRunAt: new Date(lastRun + 5 * 60000 <= asOfMs ? lastRun + 5 * 60000 : lastRun - 115 * 60000).toISOString(),
      rows: rows.reduce((a, r) => a + (r.rows ?? 0), 0),
      message: anyError ? "Cargó las hojas disponibles; faltan las plataformas con error." : null,
      expectedEveryMinutes: 120,
    });
    return rows;
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
