import type { Account, BaseMetric, Campaign, CampaignStatus, Currency, HourlyRow, MetricValues, PlatformId } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { addMetrics, emptyMetrics } from "@/lib/metrics";
import { inferObjective } from "@/lib/classifiers/objective";
import type { ColumnRef, MetricRef, SheetSource } from "./mapping";
import { normHeader, normId, parseDateLoose, parseHourLoose, parseNumberLoose, type Cell } from "./parse";

/**
 * Transformaciones puras de la hoja de Dataslayer al modelo canónico (sin red ni caché):
 * pestaña → registros, unión de pestañas de una plataforma, catálogo y filas horarias.
 */

export interface SheetRecord {
  sheet: string;
  platform: PlatformId;
  shape: "daily" | "hourly";
  level: "campaign" | "account";
  date: string;
  hour: number | null;
  accountId: string;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  campaignType: string | null;
  objective: string | null;
  currency: Currency | null;
  metrics: MetricValues;
}

export interface TabParseResult {
  records: SheetRecord[];
  /** Columnas del mapeo que no están en la pestaña. */
  missingColumns: string[];
  dataRows: number;
  /** Filas repetidas por fecha (misma llave), solo se conserva la última. */
  duplicatesByDate: Map<string, number>;
  /** Filas por fecha con gasto vacío (NULL, no cero). */
  nullSpendByDate: Map<string, number>;
}

function slug(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function refList(ref: ColumnRef): string[] {
  return Array.isArray(ref) ? ref : [ref];
}

function describe(ref: ColumnRef | MetricRef): string {
  if (typeof ref === "object" && !Array.isArray(ref)) return ref.sum.join(" + ");
  return refList(ref).join(" / ");
}

function findColumn(headers: string[], ref: ColumnRef | undefined): number {
  if (!ref) return -1;
  for (const name of refList(ref)) {
    const i = headers.indexOf(normHeader(name));
    if (i >= 0) return i;
  }
  return -1;
}

function metricColumns(headers: string[], ref: MetricRef | undefined): number[] {
  if (!ref) return [];
  if (typeof ref === "object" && !Array.isArray(ref)) return ref.sum.map((n) => headers.indexOf(normHeader(n))).filter((i) => i >= 0);
  const i = findColumn(headers, ref);
  return i >= 0 ? [i] : [];
}

function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v)).trim();
  return s ? s : null;
}

function currencyOf(v: Cell): Currency | null {
  const t = (text(v) ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t) return null;
  return /^(USD|US\$|U\$S|DOLAR|DOLLAR)/.test(t) ? "USD" : "MXN";
}

export function parseTab(values: Cell[][], source: SheetSource, opts: { tz: string; decimalComma: boolean }): TabParseResult {
  const empty: TabParseResult = { records: [], missingColumns: [], dataRows: 0, duplicatesByDate: new Map(), nullSpendByDate: new Map() };
  if (!values.length) return empty;
  const headers = values[0].map(normHeader);
  const c = source.columns;
  const col = {
    date: findColumn(headers, c.date),
    hour: findColumn(headers, c.hour),
    accountId: findColumn(headers, c.accountId),
    accountName: findColumn(headers, c.accountName),
    campaignId: findColumn(headers, c.campaignId),
    campaignName: findColumn(headers, c.campaignName),
    campaignStatus: findColumn(headers, c.campaignStatus),
    campaignType: findColumn(headers, c.campaignType),
    objective: findColumn(headers, c.objective),
    currency: findColumn(headers, c.currency),
  };
  const metricCols = new Map<BaseMetric, number[]>();
  const missing: string[] = [];
  for (const [k, idx] of Object.entries(col)) {
    const ref = c[k as keyof typeof col];
    if (ref && idx < 0) missing.push(describe(ref));
  }
  for (const m of BASE_METRICS) {
    const ref = c[m];
    if (!ref) continue;
    const idx = metricColumns(headers, ref);
    if (!idx.length) missing.push(describe(ref));
    else metricCols.set(m, idx);
  }
  const pivotCol = source.pivot ? findColumn(headers, source.pivot.column) : -1;
  const pivotVal = source.pivot ? findColumn(headers, source.pivot.value) : -1;
  if (source.pivot && pivotCol < 0) missing.push(describe(source.pivot.column));
  if (source.pivot && pivotVal < 0) missing.push(describe(source.pivot.value));
  const pivotMap = new Map(Object.entries(source.pivot?.metrics ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v]));
  if (col.date < 0) return { ...empty, missingColumns: missing };

  const records = new Map<string, SheetRecord>();
  const seen = new Set<string>();
  const duplicates = new Map<string, number>();
  const nullSpend = new Map<string, number>();
  let dataRows = 0;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.every((v) => v === "" || v === null || v === undefined)) continue;
    const date = parseDateLoose(row[col.date], opts.tz);
    if (!date) continue;
    let hour: number | null = null;
    if (source.shape === "hourly") {
      hour = parseHourLoose(row[col.hour >= 0 ? col.hour : col.date]);
      if (hour === null) continue;
    }
    dataRows++;
    const accountName = text(row[col.accountName]) ?? source.constants.accountName ?? null;
    const accountId = normId(row[col.accountId]) ?? source.constants.accountId ?? (accountName ? `${source.platform}-${slug(accountName)}` : `${source.platform}-cuenta`);
    let campaignId: string | null = null;
    const campaignName = text(row[col.campaignName]);
    if (source.level === "campaign") {
      campaignId = normId(row[col.campaignId]) ?? (campaignName ? `${accountId}-${slug(campaignName)}` : null);
      if (!campaignId) continue;
    }
    const metrics = emptyMetrics();
    let action = "";
    if (source.pivot) {
      action = (text(row[pivotCol]) ?? "").toLowerCase();
      const metric = pivotMap.get(action);
      if (!metric) continue;
      metrics[metric] = parseNumberLoose(row[pivotVal], opts.decimalComma);
    }
    for (const [m, idx] of metricCols) {
      const vals = idx.map((i) => parseNumberLoose(row[i], opts.decimalComma)).filter((v): v is number => v !== null);
      metrics[m] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    }
    const rowKey = `${date}|${hour ?? ""}|${accountId}|${campaignId ?? ""}`;
    const dupKey = `${rowKey}|${action}`;
    if (seen.has(dupKey)) {
      duplicates.set(date, (duplicates.get(date) ?? 0) + 1);
      // Formato largo: la acción repetida se ignora. Formato normal: se queda la última fila.
      if (source.pivot) continue;
    }
    seen.add(dupKey);
    if (metricCols.has("spend") && metrics.spend === null) nullSpend.set(date, (nullSpend.get(date) ?? 0) + 1);
    const rec: SheetRecord = {
      sheet: source.sheet,
      platform: source.platform,
      shape: source.shape,
      level: source.level,
      date,
      hour,
      accountId,
      accountName,
      campaignId,
      campaignName,
      campaignStatus: text(row[col.campaignStatus]),
      campaignType: text(row[col.campaignType]),
      objective: text(row[col.objective]),
      currency: currencyOf(row[col.currency]) ?? source.constants.currency ?? null,
      metrics,
    };
    const cur = source.pivot ? records.get(rowKey) : undefined;
    if (cur) addMetrics(cur.metrics, metrics);
    else records.set(rowKey, rec);
  }
  return { records: [...records.values()], missingColumns: missing, dataRows, duplicatesByDate: duplicates, nullSpendByDate: nullSpend };
}

/** Une los registros de varias pestañas de la misma forma y nivel (p. ej. General + Conversiones de Google). */
export function mergeRecords(records: SheetRecord[]): SheetRecord[] {
  const map = new Map<string, SheetRecord>();
  for (const r of records) {
    const key = `${r.platform}|${r.shape}|${r.level}|${r.date}|${r.hour ?? ""}|${r.accountId}|${r.campaignId ?? ""}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...r, metrics: { ...r.metrics } });
      continue;
    }
    addMetrics(cur.metrics, r.metrics);
    cur.accountName ??= r.accountName;
    cur.campaignName ??= r.campaignName;
    cur.campaignStatus ??= r.campaignStatus;
    cur.campaignType ??= r.campaignType;
    cur.objective ??= r.objective;
    cur.currency ??= r.currency;
  }
  return [...map.values()];
}

function statusOf(raw: string | null, recentSpend: number): CampaignStatus {
  const s = (raw ?? "").toUpperCase();
  if (/PAUS/.test(s)) return "PAUSED";
  if (/END|REMOV|ELIMIN|ARCHIV|DELET/.test(s)) return "ENDED";
  if (/ACTIV|ENABL/.test(s)) return "ACTIVE";
  return recentSpend > 0 ? "ACTIVE" : "PAUSED";
}

/**
 * Cuentas y campañas vistas en la hoja. Sin columna de estado, una campaña está activa si
 * gastó hoy o ayer (una campaña que gastó ayer y hoy no, sigue contando como activa: así se
 * detecta que dejó de gastar).
 */
export function buildCatalog(records: SheetRecord[], today: string, yesterday: string): { accounts: Account[]; campaigns: Campaign[] } {
  const accounts = new Map<string, Account & { lastDate: string }>();
  const campaigns = new Map<string, { c: Campaign; lastDate: string; recent: number; rawStatus: string | null }>();
  for (const r of records) {
    const acc = accounts.get(r.accountId);
    if (!acc) accounts.set(r.accountId, { id: r.accountId, platform: r.platform, name: r.accountName ?? r.accountId, currency: r.currency ?? "MXN", lastDate: r.date });
    else if (r.date >= acc.lastDate) {
      acc.lastDate = r.date;
      if (r.accountName) acc.name = r.accountName;
      if (r.currency) acc.currency = r.currency;
    }
    if (r.level !== "campaign" || !r.campaignId) continue;
    const spend = r.date === today || r.date === yesterday ? (r.metrics.spend ?? 0) : 0;
    const cur = campaigns.get(r.campaignId);
    if (!cur) {
      const name = r.campaignName ?? r.campaignId;
      campaigns.set(r.campaignId, {
        c: { id: r.campaignId, platform: r.platform, accountId: r.accountId, name, objective: inferObjective(name, r.objective ?? r.campaignType), status: "PAUSED", conversionEvent: null, sourceType: r.campaignType ?? r.objective },
        lastDate: r.date,
        recent: spend,
        rawStatus: r.campaignStatus,
      });
      continue;
    }
    cur.recent += spend;
    if (r.date >= cur.lastDate) {
      cur.lastDate = r.date;
      if (r.campaignName && r.campaignName !== cur.c.name) {
        cur.c.name = r.campaignName;
        cur.c.objective = inferObjective(r.campaignName, r.objective ?? r.campaignType ?? cur.c.sourceType ?? null);
      }
      if (r.campaignStatus) cur.rawStatus = r.campaignStatus;
      cur.c.sourceType = r.campaignType ?? r.objective ?? cur.c.sourceType;
    }
  }
  return {
    accounts: [...accounts.values()].map((a) => ({ id: a.id, platform: a.platform, name: a.name, currency: a.currency })),
    campaigns: [...campaigns.values()].map(({ c, recent, rawStatus }) => ({ ...c, status: statusOf(rawStatus, recent) })),
  };
}

type Profile = Map<BaseMetric, number[]>;

function profileOf(records: SheetRecord[]): Profile {
  const p: Profile = new Map();
  for (const r of records) {
    if (r.hour === null) continue;
    for (const m of BASE_METRICS) {
      const v = r.metrics[m];
      if (v === null) continue;
      let arr = p.get(m);
      if (!arr) p.set(m, (arr = new Array(24).fill(0)));
      arr[r.hour] += v;
    }
  }
  return p;
}

function shares(values: number[] | undefined): number[] | null {
  if (!values) return null;
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return null;
  return values.map((v) => Math.max(0, v) / total);
}

/** Pesos de la curva típica dentro de lo que cubre el día (la última hora, parcial). */
export function curveShares(curve: number[], coverHours: number): number[] | null {
  if (coverHours <= 0) return null;
  const full = Math.floor(coverHours);
  const frac = coverHours - full;
  const w = curve.map((v, h) => (h < full ? v : h === full ? v * frac : 0));
  return shares(w);
}

export interface SynthesisInput {
  platform: PlatformId;
  date: string;
  /** Registros diarios por campaña de esa fecha (el de hoy es el acumulado hasta la actualización). */
  daily: SheetRecord[];
  /** Registros por hora a nivel cuenta de esa fecha (curva real). */
  hourlyAccount: SheetRecord[];
  /** Hasta qué hora (con decimales) cubre el acumulado de hoy; null = día completo. */
  coverHours: number | null;
  defaultCurve: number[];
}

/**
 * Reparte el total diario de cada campaña en horas usando la curva real de su cuenta ese mismo
 * día (pestaña por hora de Dataslayer), la de la plataforma, o la curva típica si no hay datos
 * por hora (en ese caso `estimated` es true y la app lo avisa y baja la confianza).
 * La suma de las horas siempre es igual al total diario de la hoja.
 */
export function synthesizeHourly(input: SynthesisInput): { rows: HourlyRow[]; estimated: boolean } {
  const { platform, date, daily, hourlyAccount, coverHours, defaultCurve } = input;
  const byAccount = new Map<string, SheetRecord[]>();
  for (const r of hourlyAccount) {
    const list = byAccount.get(r.accountId);
    if (list) list.push(r);
    else byAccount.set(r.accountId, [r]);
  }
  const accountProfiles = new Map<string, Profile>();
  const platformProfile = profileOf(hourlyAccount);
  const fallback = curveShares(defaultCurve, coverHours ?? 24);
  let estimated = false;
  const cache = new Map<string, number[] | null>();
  const sharesFor = (accountId: string, m: BaseMetric): number[] | null => {
    const key = `${accountId}|${m}`;
    if (cache.has(key)) return cache.get(key)!;
    let prof = accountProfiles.get(accountId);
    if (!prof) {
      prof = profileOf(byAccount.get(accountId) ?? []);
      accountProfiles.set(accountId, prof);
    }
    let s = shares(prof.get(m)) ?? shares(prof.get("spend")) ?? shares(platformProfile.get(m)) ?? shares(platformProfile.get("spend"));
    if (!s) {
      s = fallback;
      if (s) estimated = true;
    }
    cache.set(key, s);
    return s;
  };
  const maxHour = coverHours === null ? 24 : Math.min(24, Math.ceil(coverHours));
  const rows: HourlyRow[] = [];
  for (const r of daily) {
    const perMetric = new Map<BaseMetric, number[] | null>();
    for (const m of BASE_METRICS) if (r.metrics[m] !== null) perMetric.set(m, sharesFor(r.accountId, m));
    for (let h = 0; h < maxHour; h++) {
      const metrics = emptyMetrics();
      for (const [m, s] of perMetric) metrics[m] = s ? r.metrics[m]! * s[h] : null;
      rows.push({ date, hour: h, platform, accountId: r.accountId, campaignId: r.campaignId, metrics });
    }
  }
  return { rows, estimated };
}
