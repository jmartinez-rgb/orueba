import "server-only";
import type {
  Account,
  BaseMetric,
  BudgetRow,
  Campaign,
  CampaignObjective,
  Catalog,
  Currency,
  DailyRow,
  DataQualityStats,
  EntityLevel,
  ExecutionControlRow,
  ExecutionStatus,
  FreshnessRecord,
  FxRate,
  HourlyRow,
  MetricValues,
  PlatformId,
  SyncLogEntry,
} from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "@/lib/data/source";
import { cached, peek, put } from "@/lib/data/cache";
import { addMetrics, emptyMetrics } from "@/lib/metrics";
import { isPlatformId, resolvePlatformAlias } from "@/lib/platforms/registry";
import { readSheetRows } from "@/lib/google/sheets";
import { parseDateTimeLoose } from "@/lib/time/parse";
import { addDays, businessDate, zonedParts } from "@/lib/time/tz";
import { fullTableName, runQuery } from "./client";
import type { BigQueryMapping, MetricSourceMapping } from "./mapping";
import * as Q from "./queries";

/**
 * Fuente de datos real sobre BigQuery. Implementa el mismo contrato que el mock.
 * Caché por fecha: el histórico (días cerrados) se guarda horas; el día en curso, minutos.
 */

type Row = Record<string, unknown>;

const HISTORY_TTL = 6 * 3600 * 1000;
const TODAY_TTL = 4 * 60 * 1000;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v && "value" in (v as Record<string, unknown>)) return String((v as { value: unknown }).value);
  return String(v);
}

/** Moneda reportada por la fuente ("USD", "usd", "US$", "Dólares"...). Todo lo demás cuenta como MXN. */
export function currencyOf(v: unknown): Currency {
  const t = (str(v) ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^(USD|US\$|U\$S|DOLAR|DOLLAR)/.test(t) ? "USD" : "MXN";
}

function metricsOf(r: Row): MetricValues {
  const m = emptyMetrics();
  for (const k of BASE_METRICS) m[k] = num(r[k]);
  return m;
}

/** Heurística de objetivo por nombre de campaña (se puede corregir en Settings). */
export function inferObjective(name: string | null, raw: string | null): CampaignObjective {
  const t = `${raw ?? ""} ${name ?? ""}`.toLowerCase();
  if (/capi/.test(t)) return "PURCHASES";
  if (/whats|msg|mensaje/.test(t)) return "WHATSAPP";
  if (/lead|registro|formulario/.test(t)) return "LEADS";
  if (/llamad|call/.test(t)) return "CALLS";
  if (/venta|sale|compra|purchase|pmax|paquete|oferta/.test(t)) return "SALES";
  if (/video|youtube/.test(t)) return "VIDEO";
  if (/alcance|awareness|reach|branding|marca/.test(t)) return "AWARENESS";
  if (/trafico|tráfico|traffic|clic/.test(t)) return "TRAFFIC";
  if (/engagement|interacc|seguidores/.test(t)) return "ENGAGEMENT";
  return "CONVERSIONS";
}

export interface BigQuerySourceOptions {
  mapping: BigQueryMapping;
  timezone: string;
  toleranceMinutes: number;
}

export class BigQueryDataSource implements MonitoringDataSource {
  readonly kind = "bigquery" as const;
  private readonly resolve = (ref: string) => fullTableName(ref);
  constructor(private readonly opts: BigQuerySourceOptions) {}

  now(): Date {
    return new Date();
  }

  private today(): string {
    return businessDate(new Date(), this.opts.timezone);
  }

  private sourcesByShape(): { hourly: MetricSourceMapping[]; snapshot: MetricSourceMapping[] } {
    const all = this.opts.mapping.metricSources;
    return { hourly: all.filter((s) => s.shape === "hourly"), snapshot: all.filter((s) => s.shape === "cumulative_snapshot") };
  }

  private baseParams() {
    return { tz: this.opts.timezone };
  }

  async getCatalog(): Promise<Catalog> {
    return cached(`bq:catalog:${this.today()}`, 30 * 60 * 1000, async () => {
      const to = this.today();
      const from = addDays(to, -14);
      const accounts = new Map<string, Account>();
      const campaigns: Campaign[] = [];
      const all = this.opts.mapping.metricSources;
      const { rows } = await runQuery<Row>("catalog", Q.catalogQuery(all, this.resolve), { ...this.baseParams(), from_date: from, to_date: to }, { from_date: "DATE", to_date: "DATE" });
      for (const r of rows) {
        const platform = str(r.platform);
        if (!platform || !isPlatformId(platform)) continue;
        const accountId = str(r.account_id) ?? `${platform}-sin-cuenta`;
        if (!accounts.has(accountId)) accounts.set(accountId, { id: accountId, platform, name: str(r.account_name) ?? accountId, currency: currencyOf(r.currency) });
        const rawStatus = (str(r.campaign_status) ?? "").toUpperCase();
        const recent = num(r.recent_spend) ?? 0;
        const status: Campaign["status"] = /PAUS/.test(rawStatus) ? "PAUSED" : /END|REMOV|ELIMIN|ARCHIV/.test(rawStatus) ? "ENDED" : recent > 0 || /ACTIV|ENABL/.test(rawStatus) ? "ACTIVE" : "PAUSED";
        const name = str(r.campaign_name);
        campaigns.push({
          id: str(r.campaign_id)!,
          platform,
          accountId,
          name: name ?? str(r.campaign_id)!,
          objective: inferObjective(name, str(r.objective)),
          status,
          conversionEvent: null,
          sourceType: str(r.campaign_type) ?? str(r.objective),
        });
      }
      return { accounts: [...accounts.values()], campaigns };
    });
  }

  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    // Caché por fecha: el histórico cerrado dura horas; el día en curso, minutos.
    // Las fechas que faltan se piden en UNA sola consulta (con poda de particiones).
    const today = this.today();
    const keyFor = (date: string) => `bq:hourly:${q.level}:${(q.platforms ?? []).join(",")}:${date}`;
    const out: HourlyRow[] = [];
    const missing: string[] = [];
    for (const date of q.dates) {
      const hit = peek<HourlyRow[]>(keyFor(date));
      if (hit) out.push(...hit);
      else missing.push(date);
    }
    if (missing.length) {
      const rows = await cached(`bq:hourly-batch:${q.level}:${(q.platforms ?? []).join(",")}:${missing.join(",")}`, 60 * 1000, () => this.fetchHourly(missing, q.level, q.platforms));
      const byDate = new Map<string, HourlyRow[]>(missing.map((d) => [d, []]));
      for (const r of rows) byDate.get(r.date)?.push(r);
      for (const [date, list] of byDate) {
        put(keyFor(date), list, date >= today ? TODAY_TTL : HISTORY_TTL);
        out.push(...list);
      }
    }
    return out;
  }

  private async fetchHourly(dates: string[], level: EntityLevel, platforms?: PlatformId[]): Promise<HourlyRow[]> {
    const { hourly, snapshot } = this.sourcesByShape();
    const partitionDates = [...new Set(dates.flatMap((d) => [addDays(d, -1), d, addDays(d, 1)]))];
    const sorted = [...dates].sort();
    const params = {
      ...this.baseParams(),
      dates,
      partition_dates: partitionDates,
      min_date: sorted[0],
      max_date: sorted[sorted.length - 1],
      platforms: platforms ?? [],
      tolerance_min: this.opts.toleranceMinutes,
    };
    const types = { dates: ["DATE"], partition_dates: ["DATE"], min_date: "DATE", max_date: "DATE", platforms: ["STRING"], tolerance_min: "INT64" } as const;
    const out: HourlyRow[] = [];
    if (hourly.length) {
      const { rows } = await runQuery<Row>("hourly", Q.hourlyQuery(hourly, this.resolve, level, Boolean(platforms?.length)), params, types as never);
      for (const r of rows) {
        const platform = str(r.platform);
        if (!platform || !isPlatformId(platform)) continue;
        out.push({ date: str(r.date)!, hour: num(r.hour) ?? 0, platform, accountId: str(r.account_id), campaignId: str(r.campaign_id), metrics: metricsOf(r) });
      }
    }
    if (snapshot.length) {
      const { rows } = await runQuery<Row>("snapshot", Q.snapshotQuery(snapshot, this.resolve, Boolean(platforms?.length)), params, types as never);
      out.push(...aggregateLevel(snapshotsToHourly(rows), level));
    }
    return out;
  }

  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    const today = this.today();
    return cached(`bq:daily:${q.level}:${(q.platforms ?? []).join(",")}:${q.from}:${q.to}`, q.to >= today ? TODAY_TTL : HISTORY_TTL, async () => {
      const { hourly, snapshot } = this.sourcesByShape();
      const params = { ...this.baseParams(), from_date: q.from, to_date: q.to, platforms: q.platforms ?? [] };
      const types = { from_date: "DATE", to_date: "DATE", platforms: ["STRING"] } as const;
      const out: DailyRow[] = [];
      for (const group of [hourly, snapshot]) {
        if (!group.length) continue;
        const { rows } = await runQuery<Row>("daily", Q.dailyQuery(group, this.resolve, q.level, Boolean(q.platforms?.length)), params, types as never);
        for (const r of rows) {
          const platform = str(r.platform);
          if (!platform || !isPlatformId(platform)) continue;
          out.push({ date: str(r.date)!, platform, accountId: str(r.account_id), campaignId: str(r.campaign_id), metrics: metricsOf(r) });
        }
      }
      return out;
    });
  }

  async getBudgets(month: string): Promise<BudgetRow[]> {
    const b = this.opts.mapping.budgets;
    if (!b) return [];
    return cached(`bq:budgets:${month}`, 15 * 60 * 1000, async () => {
      const { rows } = await runQuery<Row>("budgets", Q.budgetsQuery(b, this.resolve), { month });
      return rows
        .map((r) => {
          const level = (str(r.level) ?? "total") as BudgetRow["level"];
          const platform = str(r.platform);
          return {
            month,
            level: ["total", "platform", "account", "campaign"].includes(level) ? level : "total",
            platform: platform && isPlatformId(platform) ? platform : null,
            accountId: str(r.account_id),
            campaignId: str(r.campaign_id),
            amount: num(r.amount) ?? 0,
            currency: currencyOf(r.currency),
          } as BudgetRow;
        })
        .filter((r) => r.amount > 0);
    });
  }

  async getFxRates(): Promise<FxRate[]> {
    const fx = this.opts.mapping.fxRates;
    if (!fx) return [];
    return cached("bq:fx", 6 * 3600 * 1000, async () => {
      const { rows } = await runQuery<Row>("fx_rates", Q.fxRatesQuery(fx, this.resolve), {});
      return rows.map((r) => ({ month: str(r.month) ?? "", rate: num(r.rate) ?? 0 })).filter((r) => /^\d{4}-\d{2}$/.test(r.month) && r.rate > 0);
    });
  }

  async getExecutionControl(asOf: Date): Promise<ExecutionControlRow[]> {
    const ec = this.opts.mapping.executionControl;
    if (!ec) return [];
    return cached(`bq:exec:${Math.floor(asOf.getTime() / 120000)}`, 2 * 60 * 1000, async () => {
      const raw: Array<Record<string, unknown>> = [];
      if (ec.type === "bigquery") {
        const { rows } = await runQuery<Row>("execution_control", Q.executionControlQuery(ec, this.resolve), {});
        raw.push(...rows.map((r) => ({ step: r.step, platform: r.platform, source: r.source, status: r.status, lastRunAt: r.last_run_at, rows: r.rows_loaded, message: r.message, expected: r.expected_every })));
      } else {
        const f = ec.fields;
        const rows = await readSheetRows(ec.spreadsheetId, ec.range);
        raw.push(
          ...rows.map((r) => ({
            step: r[f.step],
            platform: f.platform ? r[f.platform] : null,
            source: f.source ? r[f.source] : null,
            status: r[f.status],
            lastRunAt: r[f.lastRunAt],
            rows: f.rows ? r[f.rows] : null,
            message: f.message ? r[f.message] : null,
            expected: f.expectedEveryMinutes ? r[f.expectedEveryMinutes] : null,
          })),
        );
      }
      const sv = ec.statusValues;
      const statusOf = (v: string): ExecutionStatus => {
        const t = v.trim().toLowerCase();
        const has = (list: string[]) => list.some((x) => x.toLowerCase() === t);
        if (has(sv.ok)) return "OK";
        if (has(sv.error)) return "ERROR";
        if (has(sv.running)) return "EJECUTANDO";
        if (has(sv.partial)) return "PARCIAL";
        if (has(sv.pending)) return "PENDIENTE";
        return "PENDIENTE";
      };
      return raw
        .filter((r) => str(r.step))
        .map((r, i) => {
          const src = (str(r.source) ?? "").toLowerCase();
          return {
            id: `exec-${i}`,
            step: str(r.step)!,
            platform: resolvePlatformAlias(str(r.platform)),
            source: /slayer/.test(src) ? "dataslayer" : /script/.test(src) ? "apps_script" : /api/.test(src) ? "api" : /bigquery|bq/.test(src) ? "bigquery" : /n8n/.test(src) ? "n8n" : "otro",
            status: statusOf(str(r.status) ?? ""),
            lastRunAt: parseDateTimeLoose(r.lastRunAt, this.opts.timezone),
            rows: num(r.rows),
            message: str(r.message),
            expectedEveryMinutes: num(r.expected),
          } satisfies ExecutionControlRow;
        });
    });
  }

  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const to = businessDate(asOf, this.opts.timezone);
    return cached(`bq:freshness:${Math.floor(asOf.getTime() / 120000)}`, 2 * 60 * 1000, async () => {
      const all = this.opts.mapping.metricSources;
      const { rows } = await runQuery<Row>("freshness", Q.freshnessQuery(all, this.resolve), { ...this.baseParams(), from_date: addDays(to, -1), to_date: to }, { from_date: "DATE", to_date: "DATE" });
      const sync = await this.getSyncLog(200).catch(() => [] as SyncLogEntry[]);
      const out: FreshnessRecord[] = [];
      for (const r of rows) {
        const platform = str(r.platform);
        if (!platform || !isPlatformId(platform)) continue;
        const lastSync = sync.find((s) => s.platform === platform);
        const last = r.last_data_at ? new Date(str(r.last_data_at)!).toISOString() : null;
        out.push({
          platform,
          accountId: str(r.account_id),
          lastDataAt: last,
          lastSyncAt: lastSync?.startedAt ?? null,
          lastSyncStatus: lastSync?.status ?? "UNKNOWN",
          lastError: lastSync?.status === "FAILED" ? lastSync.message : null,
        });
      }
      return out;
    });
  }

  async getSyncLog(limit: number): Promise<SyncLogEntry[]> {
    const s = this.opts.mapping.syncLog;
    if (!s) return [];
    return cached(`bq:synclog:${limit}`, 2 * 60 * 1000, async () => {
      const { rows } = await runQuery<Row>("sync_log", Q.syncLogQuery(s, this.resolve), { limit }, { limit: "INT64" });
      return rows.map((r, i) => {
        const raw = str(r.status) ?? "";
        const status: SyncLogEntry["status"] = s.successValues.includes(raw) ? "SUCCESS" : s.failureValues.includes(raw) ? "FAILED" : /run|progress/i.test(raw) ? "RUNNING" : "UNKNOWN";
        const platform = str(r.platform);
        return {
          id: `bq-sync-${i}`,
          platform: platform && isPlatformId(platform) ? platform : "n8n",
          workflow: str(r.workflow) ?? "Ingesta",
          startedAt: new Date(str(r.started_at)!).toISOString(),
          finishedAt: r.finished_at ? new Date(str(r.finished_at)!).toISOString() : null,
          status,
          rowsLoaded: num(r.rows_loaded),
          message: str(r.message),
        } satisfies SyncLogEntry;
      });
    });
  }

  async getDataQuality(date: string): Promise<DataQualityStats[]> {
    const lastHour = date === this.today() ? zonedParts(new Date(), this.opts.timezone).hour - 1 : 23;
    return cached(`bq:quality:${date}:${lastHour}`, TODAY_TTL, async () => {
      const hourly = this.sourcesByShape().hourly;
      if (!hourly.length) return [];
      const { rows } = await runQuery<Row>(
        "data_quality",
        Q.dataQualityQuery(hourly, this.resolve),
        { ...this.baseParams(), date, dates: [date], partition_dates: [addDays(date, -1), date, addDays(date, 1)], min_date: date, max_date: date, last_hour: lastHour },
        { date: "DATE", dates: ["DATE"], partition_dates: ["DATE"], min_date: "DATE", max_date: "DATE", last_hour: "INT64" } as never,
      );
      return rows
        .filter((r) => isPlatformId(str(r.platform) ?? ""))
        .map((r) => ({
          platform: str(r.platform) as PlatformId,
          date,
          duplicateRows: num(r.duplicate_rows) ?? 0,
          nullSpendRows: num(r.null_spend_rows) ?? 0,
          lastHourRows: num(r.last_hour_rows) ?? 0,
          expectedLastHourRows: num(r.expected_last_hour_rows) ?? 0,
        }));
    });
  }
}

/** Convierte cortes acumulados en incrementos horarios (se reparten entre las horas del intervalo). */
export function snapshotsToHourly(rows: Row[]): HourlyRow[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${str(r.date)}|${str(r.platform)}|${str(r.account_id)}|${str(r.campaign_id)}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: HourlyRow[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => (num(a.cover_h) ?? 0) - (num(b.cover_h) ?? 0));
    let prevHour = 0;
    let prev: MetricValues = emptyMetrics();
    for (const r of g) {
      const h = Math.min(24, Math.max(0, num(r.cover_h) ?? 0));
      if (h <= prevHour) continue;
      const cur = metricsOf(r);
      const span = h - prevHour;
      const platform = str(r.platform);
      if (!platform || !isPlatformId(platform)) continue;
      for (let hour = prevHour; hour < h; hour++) {
        const m = emptyMetrics();
        for (const k of BASE_METRICS as BaseMetric[]) {
          const c = cur[k];
          if (c === null) continue;
          m[k] = Math.max(0, c - (prev[k] ?? 0)) / span;
        }
        out.push({ date: str(r.date)!, hour, platform, accountId: str(r.account_id), campaignId: str(r.campaign_id), metrics: m });
      }
      prev = cur;
      prevHour = h;
    }
  }
  return out;
}

function aggregateLevel(rows: HourlyRow[], level: EntityLevel): HourlyRow[] {
  if (level === "campaign") return rows;
  const map = new Map<string, HourlyRow>();
  for (const r of rows) {
    const accountId = level === "account" ? r.accountId : null;
    const key = `${r.date}|${r.hour}|${r.platform}|${accountId}`;
    const cur = map.get(key);
    if (cur) addMetrics(cur.metrics, r.metrics);
    else map.set(key, { ...r, accountId, campaignId: null, metrics: { ...r.metrics } });
  }
  return [...map.values()];
}
