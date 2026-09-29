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
  /** La llave salió del nombre (la pestaña no trae la columna de ID). */
  accountIdFromName?: boolean;
  campaignIdFromName?: boolean;
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

function hash36(v: string): string {
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Llave legible a partir de un nombre (cuando la hoja no trae IDs). Los nombres largos se
 * recortan y llevan una huella del nombre completo para que dos campañas parecidas no choquen.
 */
export function slugId(v: string): string {
  const s = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s.length <= 60 ? s : `${s.slice(0, 50).replace(/-$/, "")}-${hash36(v.trim().toLowerCase())}`;
}

function refList(ref: ColumnRef): string[] {
  return Array.isArray(ref) ? ref : [ref];
}

function describe(ref: ColumnRef | MetricRef): string {
  if (typeof ref === "object" && !Array.isArray(ref)) return ref.sum.join(" + ");
  return refList(ref).join(" / ");
}

export function findColumn(headers: string[], ref: ColumnRef | undefined): number {
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
  // Solo se reportan las columnas sin las que no se puede leer la pestaña. Los IDs son opcionales
  // si viene el nombre (la llave se arma con el nombre), y tipo, objetivo, estado y moneda son
  // complementarios (pueden venir de otra pestaña de la misma plataforma).
  const need = (ref: ColumnRef | undefined, idx: number) => {
    if (ref && idx < 0) missing.push(describe(ref));
  };
  need(c.date, col.date);
  if (source.shape === "hourly") need(c.hour, col.hour);
  if (col.accountId < 0 && col.accountName < 0 && !source.constants.accountId && !source.constants.accountName) need(c.accountName ?? c.accountId, -1);
  if (source.level === "campaign" && col.campaignId < 0 && col.campaignName < 0) need(c.campaignName ?? c.campaignId ?? "Campaign", -1);
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
    const realAccountId = normId(row[col.accountId]) ?? source.constants.accountId ?? null;
    const accountId = realAccountId ?? (accountName ? `${source.platform}-${slugId(accountName)}` : `${source.platform}-cuenta`);
    let campaignId: string | null = null;
    let campaignIdFromName = false;
    const campaignName = text(row[col.campaignName]);
    if (source.level === "campaign") {
      campaignId = normId(row[col.campaignId]);
      if (!campaignId && campaignName) {
        campaignId = `${accountId}-${slugId(campaignName)}`;
        campaignIdFromName = true;
      }
      if (!campaignId) continue;
    }
    const metrics = emptyMetrics();
    let action = "";
    if (source.pivot) {
      action = (text(row[pivotCol]) ?? "").toLowerCase();
      const metric = pivotMap.get(action);
      // Una acción que no se usa no suma métricas, pero sí aporta tipo de campaña y nombres.
      if (metric) metrics[metric] = parseNumberLoose(row[pivotVal], opts.decimalComma);
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
      accountIdFromName: realAccountId === null,
      campaignIdFromName,
    };
    const cur = source.pivot ? records.get(rowKey) : undefined;
    if (cur) addMetrics(cur.metrics, metrics);
    else records.set(rowKey, rec);
  }
  return { records: [...records.values()], missingColumns: missing, dataRows, duplicatesByDate: duplicates, nullSpendByDate: nullSpend };
}

const normName = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Si una pestaña trae IDs y otra solo nombres (p. ej. la diaria sin IDs y la de conversiones
 * con IDs), las llaves armadas con el nombre se cambian por el ID real de la misma cuenta o
 * campaña para que ambas pestañas se unan.
 */
export function harmonizeIds(records: SheetRecord[]): SheetRecord[] {
  const accounts = new Map<string, string>();
  for (const r of records) if (!r.accountIdFromName && r.accountName) accounts.set(`${r.platform}|${normName(r.accountName)}`, r.accountId);
  if (accounts.size) {
    for (const r of records) {
      if (!r.accountIdFromName || !r.accountName) continue;
      const id = accounts.get(`${r.platform}|${normName(r.accountName)}`);
      if (!id) continue;
      if (r.campaignIdFromName && r.campaignId?.startsWith(`${r.accountId}-`)) r.campaignId = `${id}${r.campaignId.slice(r.accountId.length)}`;
      r.accountId = id;
      r.accountIdFromName = false;
    }
  }
  const campaigns = new Map<string, string>();
  for (const r of records) if (r.campaignId && !r.campaignIdFromName && r.campaignName) campaigns.set(`${r.platform}|${r.accountId}|${normName(r.campaignName)}`, r.campaignId);
  if (campaigns.size) {
    for (const r of records) {
      if (!r.campaignIdFromName || !r.campaignName) continue;
      const id = campaigns.get(`${r.platform}|${r.accountId}|${normName(r.campaignName)}`);
      if (id) {
        r.campaignId = id;
        r.campaignIdFromName = false;
      }
    }
  }
  return records;
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

/** Curvas de gasto por hora aprendidas de los días con pestaña por hora (cada día normalizado a 1). */
export interface LearnedCurves {
  platform: number[] | null;
  accounts: Map<string, number[]>;
}

/**
 * Aprende la curva horaria típica de la plataforma y de cada cuenta con los días completos que trae
 * la pestaña por hora (desde 2 días; lo ideal, una semana). Se usa para repartir los días que no tienen datos por
 * hora (p. ej. las semanas de referencia más viejas) en lugar de la curva genérica.
 */
export function learnCurves(hourlyByDate: Map<string, SheetRecord[]>, excludeDate: string, minDays = 2): LearnedCurves {
  const add = (acc: Map<string, number[][]>, key: string, day: number[]) => {
    const total = day.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const list = acc.get(key);
    const norm = day.map((v) => v / total);
    if (list) list.push(norm);
    else acc.set(key, [norm]);
  };
  const byAccount = new Map<string, number[][]>();
  const byPlatform = new Map<string, number[][]>();
  for (const [date, records] of hourlyByDate) {
    if (date === excludeDate) continue; // hoy va a medias
    const platformDay = new Array(24).fill(0);
    const accountDays = new Map<string, number[]>();
    for (const r of records) {
      const v = r.metrics.spend;
      if (r.hour === null || v === null || v <= 0) continue;
      platformDay[r.hour] += v;
      let d = accountDays.get(r.accountId);
      if (!d) accountDays.set(r.accountId, (d = new Array(24).fill(0)));
      d[r.hour] += v;
    }
    add(byPlatform, "p", platformDay);
    for (const [id, d] of accountDays) add(byAccount, id, d);
  }
  const average = (days: number[][] | undefined) =>
    days && days.length >= minDays ? Array.from({ length: 24 }, (_, h) => days.reduce((a, d) => a + d[h], 0) / days.length) : null;
  const accounts = new Map<string, number[]>();
  for (const [id, days] of byAccount) {
    const c = average(days);
    if (c) accounts.set(id, c);
  }
  return { platform: average(byPlatform.get("p")), accounts };
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
  /** Curvas reales aprendidas de otros días con datos por hora (van antes que la curva genérica). */
  learned?: LearnedCurves;
}

/**
 * Reparte el total diario de cada campaña en horas usando la curva real de su cuenta ese mismo
 * día (pestaña por hora de Dataslayer), la de la plataforma, o la curva típica si no hay datos
 * por hora (en ese caso `estimated` es true y la app lo avisa y baja la confianza).
 * La suma de las horas siempre es igual al total diario de la hoja.
 */
export function synthesizeHourly(input: SynthesisInput): { rows: HourlyRow[]; estimated: boolean } {
  const { platform, date, daily, hourlyAccount, coverHours, defaultCurve, learned } = input;
  const byAccount = new Map<string, SheetRecord[]>();
  for (const r of hourlyAccount) {
    const list = byAccount.get(r.accountId);
    if (list) list.push(r);
    else byAccount.set(r.accountId, [r]);
  }
  const accountProfiles = new Map<string, Profile>();
  const platformProfile = profileOf(hourlyAccount);
  const fallback = curveShares(defaultCurve, coverHours ?? 24);
  const learnedPlatform = learned?.platform ? curveShares(learned.platform, coverHours ?? 24) : null;
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
    const learnedAccount = learned?.accounts.get(accountId);
    let s =
      shares(prof.get(m)) ??
      shares(prof.get("spend")) ??
      shares(platformProfile.get(m)) ??
      shares(platformProfile.get("spend")) ??
      (learnedAccount ? curveShares(learnedAccount, coverHours ?? 24) : null) ??
      learnedPlatform;
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
