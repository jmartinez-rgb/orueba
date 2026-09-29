import "server-only";
import type {
  BudgetRow,
  Catalog,
  DailyRow,
  DataQualityStats,
  EntityLevel,
  ExecutionControlRow,
  ExecutionStatus,
  FreshnessRecord,
  FxRate,
  HourlyRow,
  PlatformId,
  SyncLogEntry,
  SyncStatus,
} from "@/lib/types";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "@/lib/data/source";
import { addMetrics } from "@/lib/metrics";
import { cached } from "@/lib/data/cache";
import { addDays, businessDate, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import { parseDateTimeLoose } from "@/lib/time/parse";
import { PLATFORMS, resolvePlatformAlias } from "@/lib/platforms/registry";
import { HOURLY_SHARE } from "@/lib/mock/curves";
import { logger } from "@/lib/logging/logger";
import type { SheetSource, SheetsMapping } from "./mapping";
import { a1Range, cleanSheetName, columnLetter, normHeader, parseDateLoose, parseNumberLoose, rowsFromRange, usesDecimalComma, type Cell } from "./parse";
import type { SheetsInfo, SheetsReader } from "./reader";
import { buildCatalog, findColumn, harmonizeIds, mergeRecords, parseTab, synthesizeHourly, type SheetRecord } from "./transform";

/**
 * Fuente de datos: la hoja de Google Sheets que actualiza Dataslayer (cada 2 horas; tarda 5–10
 * minutos). Solo lee, con la cuenta de servicio y permiso de Lector.
 *
 * - Pestañas diarias por campaña (la fila de hoy es el acumulado a la hora de la actualización).
 * - Pestañas por hora a nivel cuenta (opcionales): dan la curva horaria real para comparar la
 *   misma franja contra semanas anteriores. Sin ellas se usa una curva típica y se avisa.
 * - DataslayerQueries: hora y estado de la última actualización de cada consulta.
 * - Si una lectura cae a mitad de una actualización (pestaña vacía o recortada), se conserva la
 *   última lectura completa para no confundir la actualización con una caída.
 */

export interface SheetsSourceOptions {
  mapping: SheetsMapping;
  spreadsheetId: string;
  /** Zona horaria de negocio. */
  timezone: string;
  reader: SheetsReader;
  /** Días de historia a leer de cada pestaña si el mapeo no fija historyDays. */
  historyDays?: number;
  /** Reloj inyectable (pruebas). */
  clock?: () => Date;
}

/** Historia por defecto: 4 semanas de comparación + el mes en curso, con margen. */
export const DEFAULT_HISTORY_DAYS = 45;

interface ControlEntry {
  sheet: string;
  updatedAt: string | null;
  statusText: string;
  status: ExecutionStatus;
  platform: PlatformId | null;
  rows: number | null;
}

interface PlatformData {
  sources: SheetSource[];
  daily: Map<string, SheetRecord[]>;
  hourlyCampaign: Map<string, SheetRecord[]>;
  hourlyAccount: Map<string, SheetRecord[]>;
}

export interface SheetsDataset {
  version: number;
  readAt: string;
  info: SheetsInfo;
  sheetTimeZone: string;
  records: SheetRecord[];
  platforms: Map<PlatformId, PlatformData>;
  control: Map<string, ControlEntry>;
  missingSheets: string[];
  missingColumns: Array<{ sheet: string; columns: string[] }>;
  /** Pestañas leídas a mitad de una actualización: se usó la lectura anterior. */
  refreshing: string[];
  quality: Map<string, { duplicates: number; nullSpend: number }>;
  budgets: Array<{ month: string; level: string | null; platform: string | null; account: string | null; campaign: string | null; amount: number; currency: string | null }>;
  fx: FxRate[];
  tabRows: Map<string, number>;
}

const lastGood = new Map<string, { values: Cell[][]; rows: number; total: number; at: number }>();
/** Encabezados de cada pestaña (cambian muy poco): se releen cada 10 minutos. */
const headerCache = new Map<string, { at: number; rows: Map<string, Cell[]> }>();
const HEADER_TTL_MS = 10 * 60 * 1000;
let datasetVersion = 0;

/**
 * Ventana de lectura de una pestaña a partir de su columna de fecha (fila 2 en adelante).
 * Dataslayer escribe las filas ordenadas por fecha, así que basta leer desde la primera fila
 * dentro de la historia necesaria. Si la columna no está ordenada se lee completa.
 */
export function readWindow(dates: Cell[], cutoff: string, tz: string): { first: number; last: number; total: number } | null {
  let first = -1;
  let last = -1;
  let max = "";
  let sorted = true;
  for (let k = 0; k < dates.length; k++) {
    const d = parseDateLoose(dates[k], tz);
    if (!d) continue;
    last = k;
    if (d < max) sorted = false;
    else max = d;
    if (first < 0 && d >= cutoff) first = k;
  }
  if (last < 0) return null;
  if (!sorted) return { first: 0, last, total: last + 1 };
  if (first < 0) return { first: last + 1, last, total: last + 1 };
  return { first, last, total: last + 1 };
}

function sheetKey(name: string): string {
  return normHeader(cleanSheetName(name));
}

/** Estado de Dataslayer ("Refreshed successfully", "Error: …") → estado de ejecución. */
export function dataslayerStatus(text: string): ExecutionStatus {
  const t = text.toLowerCase();
  if (!t.trim()) return "PENDIENTE";
  if (/error|fail|fall|denied|expired|invalid/.test(t)) return "ERROR";
  if (/refreshing|running|progress|queued|actualizando|en curso|pending/.test(t)) return "EJECUTANDO";
  if (/sampl|partial|parcial|warning/.test(t)) return "PARCIAL";
  if (/success|ok\b|exito|éxito|correct|refreshed|actualizad|listo/.test(t)) return "OK";
  return "PENDIENTE";
}

const DATASLAYER_SOURCE_ALIAS: Record<string, PlatformId> = {
  ads: "google",
  adwords: "google",
  google_ads: "google",
  googleads: "google",
  facebook: "meta",
  facebook_ads: "meta",
  bing: "microsoft",
  microsoft_ads: "microsoft",
  tiktok: "tiktok",
  tiktok_ads: "tiktok",
  spotify: "spotify",
  twitter: "x",
  x: "x",
};

function syncStatusOf(s: ExecutionStatus | undefined): SyncStatus {
  if (s === "OK" || s === "PARCIAL") return "SUCCESS";
  if (s === "ERROR") return "FAILED";
  if (s === "EJECUTANDO") return "RUNNING";
  return "UNKNOWN";
}

function aggregateHourly(rows: HourlyRow[], level: EntityLevel): HourlyRow[] {
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

function aggregateDaily(rows: DailyRow[], level: EntityLevel): DailyRow[] {
  if (level === "campaign") return rows;
  const map = new Map<string, DailyRow>();
  for (const r of rows) {
    const accountId = level === "account" ? r.accountId : null;
    const key = `${r.date}|${r.platform}|${accountId}`;
    const cur = map.get(key);
    if (cur) addMetrics(cur.metrics, r.metrics);
    else map.set(key, { ...r, accountId, campaignId: null, metrics: { ...r.metrics } });
  }
  return [...map.values()];
}

function groupByDate(records: SheetRecord[]): Map<string, SheetRecord[]> {
  const m = new Map<string, SheetRecord[]>();
  for (const r of records) {
    const list = m.get(r.date);
    if (list) list.push(r);
    else m.set(r.date, [r]);
  }
  return m;
}

export class SheetsDataSource implements MonitoringDataSource {
  readonly kind = "sheets" as const;
  private readonly memo = new Map<string, { version: number; value: unknown }>();

  constructor(private readonly opts: SheetsSourceOptions) {}

  now(): Date {
    return this.opts.clock ? this.opts.clock() : new Date();
  }

  private today(): string {
    return businessDate(this.now(), this.opts.timezone);
  }

  /** Plataformas que trae el mapeo (las demás no se monitorean). */
  platforms(): PlatformId[] {
    const set = new Set(this.opts.mapping.sources.map((s) => s.platform));
    return (Object.keys(PLATFORMS) as PlatformId[]).filter((p) => set.has(p));
  }

  private remember<T>(ds: SheetsDataset, key: string, fn: () => T): T {
    const hit = this.memo.get(key);
    if (hit && hit.version === ds.version) return hit.value as T;
    const value = fn();
    this.memo.set(key, { version: ds.version, value });
    if (this.memo.size > 400) this.memo.clear();
    return value;
  }

  /** Lee y procesa la hoja (una sola lectura en lote por ciclo de caché). */
  async dataset(): Promise<SheetsDataset> {
    const { mapping, spreadsheetId } = this.opts;
    return cached(`sheets:dataset:${spreadsheetId}`, mapping.cacheSeconds * 1000, () => this.load());
  }

  private async load(): Promise<SheetsDataset> {
    const { mapping, spreadsheetId, reader, timezone } = this.opts;
    const info = await cached(`sheets:info:${spreadsheetId}`, 10 * 60 * 1000, () => reader.info(spreadsheetId));
    const sheetTz = mapping.control && mapping.control.timeZone !== "sheet" ? mapping.control.timeZone : (info.timeZone ?? timezone);
    const decimalComma = usesDecimalComma(info.locale);
    const titles = new Map(info.sheets.map((t) => [sheetKey(t), t]));
    const missingSheets: string[] = [];
    type Want = { kind: "source"; source: SheetSource; title: string } | { kind: "control" | "budgets" | "fx"; title: string };
    const wants: Want[] = [];
    for (const source of mapping.sources) {
      const title = titles.get(sheetKey(source.sheet));
      if (title) wants.push({ kind: "source", source, title });
      else if (!source.optional) missingSheets.push(source.sheet);
    }
    const extra: Array<[Want["kind"], { sheet: string; optional?: boolean } | null]> = [
      ["control", mapping.control ? { sheet: mapping.control.sheet, optional: true } : null],
      ["budgets", mapping.budgets],
      ["fx", mapping.fxRates],
    ];
    for (const [kind, cfg] of extra) {
      if (!cfg) continue;
      const title = titles.get(sheetKey(cfg.sheet));
      if (title) wants.push({ kind: kind as "control", title });
      else if (!cfg.optional) missingSheets.push(cfg.sheet);
    }
    const sourceWants = wants.filter((w): w is Extract<Want, { kind: "source" }> => w.kind === "source");
    const otherWants = wants.filter((w) => w.kind !== "source");
    const historyDays = mapping.historyDays ?? this.opts.historyDays ?? DEFAULT_HISTORY_DAYS;
    const cutoff = addDays(this.today(), -historyDays);

    // 1) Encabezados (en caché) → columna de fecha de cada pestaña.
    const headers = await this.headers(sourceWants.map((w) => w.title));
    const dateCol = sourceWants.map((w) => findColumn((headers.get(w.title) ?? []).map(normHeader), w.source.columns.date));
    // 2) Control, presupuestos y tipo de cambio completos + solo la columna de fecha de cada pestaña.
    const withDates = sourceWants.map((w, i) => ({ w, i })).filter(({ i }) => dateCol[i] >= 0);
    const [otherValues, dateValues] = await Promise.all([
      reader.batchGet(spreadsheetId, otherWants.map((w) => a1Range(w.title))),
      reader.batchGet(
        spreadsheetId,
        withDates.map(({ w, i }) => a1Range(w.title, `${columnLetter(dateCol[i])}2:${columnLetter(dateCol[i])}`)),
        { majorDimension: "COLUMNS" },
      ),
    ]);
    // 3) Solo las filas dentro de la historia necesaria.
    const windows = new Map<number, { first: number; last: number; total: number }>();
    withDates.forEach(({ i }, k) => {
      const win = readWindow(dateValues[k]?.[0] ?? [], cutoff, timezone);
      if (win) windows.set(i, win);
    });
    const toRead = [...windows.entries()].filter(([, win]) => win.first <= win.last);
    const windowValues = await reader.batchGet(
      spreadsheetId,
      toRead.map(([i, win]) => {
        const width = Math.max(1, (headers.get(sourceWants[i].title) ?? []).length);
        return a1Range(sourceWants[i].title, `A${win.first + 2}:${columnLetter(width - 1)}${win.last + 2}`);
      }),
    );
    const windowByIndex = new Map(toRead.map(([i], k) => [i, windowValues[k] ?? []]));
    const sourceIndex = new Map(sourceWants.map((w, i) => [w, i]));
    const otherIndex = new Map(otherWants.map((w, i) => [w, i]));

    const refreshing: string[] = [];
    const missingColumns: SheetsDataset["missingColumns"] = [];
    const records: SheetRecord[] = [];
    const quality = new Map<string, { duplicates: number; nullSpend: number }>();
    const tabRows = new Map<string, number>();
    let control = new Map<string, ControlEntry>();
    let budgets: SheetsDataset["budgets"] = [];
    let fx: FxRate[] = [];
    const now = this.now().getTime();

    wants.forEach((w) => {
      if (w.kind === "source") {
        const i = sourceIndex.get(w)!;
        const header = headers.get(w.title) ?? [];
        const win = windows.get(i);
        const body = windowByIndex.get(i) ?? [];
        let tab: Cell[][] = header.length ? [header, ...body] : [];
        let total = win?.total ?? 0;
        // Protección durante la actualización de Dataslayer (5–10 min): una pestaña vacía,
        // recortada a menos del 40% o que cambió entre la lectura de fechas y la de filas se
        // sustituye por la última lectura completa (hasta 6 h).
        const key = `${spreadsheetId}|${sheetKey(w.title)}|${cutoff}`;
        const rows = body.length;
        const expected = win ? Math.max(0, win.last - win.first + 1) : 0;
        const prev = lastGood.get(key);
        const cut = (prev && prev.rows > 20 && rows < prev.rows * 0.4) || (expected > 20 && rows < expected * 0.9);
        if (cut && prev && now - prev.at < 6 * 3600 * 1000) {
          refreshing.push(w.source.sheet);
          tab = prev.values;
          total = prev.total;
        } else if (rows > 0) lastGood.set(key, { values: tab, rows, total, at: now });
        else if (cut) refreshing.push(w.source.sheet);
        if (tab.length) tabRows.set(w.source.sheet, total);
        const parsed = parseTab(tab, w.source, { tz: timezone, decimalComma });
        if (parsed.missingColumns.length) missingColumns.push({ sheet: w.source.sheet, columns: parsed.missingColumns });
        records.push(...parsed.records);
        for (const [date, n] of parsed.duplicatesByDate) {
          const q = quality.get(`${w.source.platform}|${date}`) ?? { duplicates: 0, nullSpend: 0 };
          q.duplicates += n;
          quality.set(`${w.source.platform}|${date}`, q);
        }
        for (const [date, n] of parsed.nullSpendByDate) {
          const q = quality.get(`${w.source.platform}|${date}`) ?? { duplicates: 0, nullSpend: 0 };
          q.nullSpend += n;
          quality.set(`${w.source.platform}|${date}`, q);
        }
        return;
      }
      const tab = otherValues[otherIndex.get(w)!] ?? [];
      if (w.kind === "control" && mapping.control) control = this.parseControl(tab, sheetTz);
      else if (w.kind === "budgets" && mapping.budgets) budgets = this.parseBudgets(tab, decimalComma);
      else if (w.kind === "fx" && mapping.fxRates) fx = this.parseFx(tab, decimalComma);
    });

    const merged = mergeRecords(harmonizeIds(records));
    const platforms = new Map<PlatformId, PlatformData>();
    for (const p of this.platforms()) {
      const mine = merged.filter((r) => r.platform === p);
      platforms.set(p, {
        sources: mapping.sources.filter((s) => s.platform === p),
        daily: groupByDate(mine.filter((r) => r.shape === "daily" && r.level === "campaign")),
        hourlyCampaign: groupByDate(mine.filter((r) => r.shape === "hourly" && r.level === "campaign")),
        hourlyAccount: groupByDate(mine.filter((r) => r.shape === "hourly" && r.level === "account")),
      });
    }
    if (missingSheets.length || missingColumns.length) logger.warn("sheets.mapping_mismatch", { missingSheets, missingColumns });
    return {
      version: ++datasetVersion,
      readAt: new Date(now).toISOString(),
      info,
      sheetTimeZone: sheetTz,
      records: merged,
      platforms,
      control,
      missingSheets,
      missingColumns,
      refreshing,
      quality,
      budgets,
      fx,
      tabRows,
    };
  }

  /** Fila de encabezados de cada pestaña (se guarda 10 min si todas vinieron completas). */
  private async headers(titles: string[]): Promise<Map<string, Cell[]>> {
    const { spreadsheetId, reader } = this.opts;
    const hit = headerCache.get(spreadsheetId);
    if (hit && Date.now() - hit.at < HEADER_TTL_MS && titles.every((t) => hit.rows.has(t))) return hit.rows;
    const values = await reader.batchGet(spreadsheetId, titles.map((t) => a1Range(t, "1:1")));
    const rows = new Map(titles.map((t, i) => [t, (values[i]?.[0] ?? []) as Cell[]]));
    // Una pestaña sin encabezado puede estar a mitad de una actualización: no se guarda.
    if ([...rows.values()].every((r) => r.length)) headerCache.set(spreadsheetId, { at: Date.now(), rows });
    else headerCache.delete(spreadsheetId);
    return rows;
  }

  private columnIndex(headers: string[], ref: string | string[] | undefined): number {
    if (!ref) return -1;
    for (const name of Array.isArray(ref) ? ref : [ref]) {
      const i = headers.indexOf(normHeader(name));
      if (i >= 0) return i;
    }
    return -1;
  }

  private parseControl(tab: Cell[][], tz: string): Map<string, ControlEntry> {
    const out = new Map<string, ControlEntry>();
    const cfg = this.opts.mapping.control;
    if (!cfg || !tab.length) return out;
    const headers = tab[0].map(normHeader);
    const c = {
      sheet: this.columnIndex(headers, cfg.columns.sheet),
      updated: this.columnIndex(headers, cfg.columns.updated),
      created: this.columnIndex(headers, cfg.columns.created),
      status: this.columnIndex(headers, cfg.columns.status),
      dataSource: this.columnIndex(headers, cfg.columns.dataSource),
      range: this.columnIndex(headers, cfg.columns.range),
    };
    if (c.sheet < 0) return out;
    for (const row of tab.slice(1)) {
      const sheet = cleanSheetName(row[c.sheet]);
      if (!sheet) continue;
      const statusText = String(row[c.status] ?? "").trim();
      // Una consulta recién creada aún no tiene "Updated": sus datos se escribieron al crearla.
      const updatedAt = (c.updated >= 0 ? parseDateTimeLoose(row[c.updated], tz) : null) ?? (c.created >= 0 ? parseDateTimeLoose(row[c.created], tz) : null);
      const entry: ControlEntry = {
        sheet,
        updatedAt,
        statusText,
        status: dataslayerStatus(statusText),
        platform: resolvePlatformAlias(String(row[c.dataSource] ?? ""), DATASLAYER_SOURCE_ALIAS),
        rows: c.range >= 0 ? rowsFromRange(row[c.range]) : null,
      };
      // Si una pestaña aparece dos veces (dos consultas), se queda la actualización más reciente.
      const key = sheetKey(sheet);
      const prev = out.get(key);
      if (!prev || (entry.updatedAt ?? "") > (prev.updatedAt ?? "")) out.set(key, entry);
    }
    return out;
  }

  private parseBudgets(tab: Cell[][], decimalComma: boolean): SheetsDataset["budgets"] {
    const cfg = this.opts.mapping.budgets;
    if (!cfg || !tab.length) return [];
    const headers = tab[0].map(normHeader);
    const idx = (k: keyof typeof cfg.columns) => this.columnIndex(headers, cfg.columns[k]);
    const c = { month: idx("month"), amount: idx("amount"), level: idx("level"), platform: idx("platform"), account: idx("account"), campaign: idx("campaign"), currency: idx("currency") };
    if (c.month < 0 || c.amount < 0) return [];
    const str = (v: Cell) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
    return tab
      .slice(1)
      .map((row) => {
        const rawMonth = row[c.month];
        const d = typeof rawMonth === "number" ? parseDateTimeLoose(rawMonth, this.opts.timezone) : null;
        const month = d ? businessDate(new Date(d), this.opts.timezone).slice(0, 7) : (String(rawMonth ?? "").match(/\d{4}-\d{2}/)?.[0] ?? null);
        return {
          month: month ?? "",
          level: str(row[c.level]),
          platform: str(row[c.platform]),
          account: str(row[c.account]),
          campaign: str(row[c.campaign]),
          amount: parseNumberLoose(row[c.amount], decimalComma) ?? 0,
          currency: str(row[c.currency]),
        };
      })
      .filter((b) => /^\d{4}-\d{2}$/.test(b.month) && b.amount > 0);
  }

  private parseFx(tab: Cell[][], decimalComma: boolean): FxRate[] {
    const cfg = this.opts.mapping.fxRates;
    if (!cfg || !tab.length) return [];
    const headers = tab[0].map(normHeader);
    const m = this.columnIndex(headers, cfg.columns.month);
    const r = this.columnIndex(headers, cfg.columns.rate);
    if (m < 0 || r < 0) return [];
    return tab
      .slice(1)
      .map((row) => {
        const raw = row[m];
        const d = typeof raw === "number" ? parseDateTimeLoose(raw, this.opts.timezone) : null;
        const month = d ? businessDate(new Date(d), this.opts.timezone).slice(0, 7) : (String(raw ?? "").match(/\d{4}-\d{2}/)?.[0] ?? "");
        return { month, rate: parseNumberLoose(row[r], decimalComma) ?? 0 };
      })
      .filter((x) => /^\d{4}-\d{2}$/.test(x.month) && x.rate > 0 && x.rate < 1000);
  }

  /** Control de la pestaña principal (la que trae el gasto) de una plataforma. */
  private primaryControl(ds: SheetsDataset, p: PlatformId): ControlEntry | null {
    const pd = ds.platforms.get(p);
    if (!pd) return null;
    const withSpend = pd.sources.filter((s) => s.columns.spend && ds.tabRows.has(s.sheet));
    const entries = [...withSpend, ...pd.sources].map((s) => ds.control.get(sheetKey(s.controlName ?? s.sheet))).filter((e): e is ControlEntry => Boolean(e));
    // Primero la pestaña del gasto; si su consulta aún no tiene hora, la de otra pestaña de la plataforma.
    return entries.find((e) => e.updatedAt) ?? entries[0] ?? null;
  }

  /** Hasta qué hora (con decimales, zona de negocio) cubre el acumulado de hoy de una plataforma. */
  private coverHoursToday(ds: SheetsDataset, p: PlatformId): number {
    const tz = this.opts.timezone;
    const today = this.today();
    const ctl = this.primaryControl(ds, p);
    const at = ctl?.updatedAt ? new Date(ctl.updatedAt) : ds.platforms.get(p)?.daily.get(today)?.length ? new Date(ds.readAt) : null;
    if (!at) return 0;
    const now = this.now();
    const ref = at.getTime() > now.getTime() ? now : at;
    if (businessDate(ref, tz) !== today) return 0;
    const parts = zonedParts(ref, tz);
    return Math.min(24, parts.hour + parts.minute / 60);
  }

  private hourlyFor(ds: SheetsDataset, p: PlatformId, date: string): { rows: HourlyRow[]; estimated: boolean } {
    return this.remember(ds, `h:${p}:${date}:${this.today()}`, () => {
      const pd = ds.platforms.get(p);
      if (!pd) return { rows: [], estimated: false };
      const exact = pd.hourlyCampaign.get(date);
      if (exact?.length) {
        return {
          rows: exact.map((r) => ({ date, hour: r.hour ?? 0, platform: p, accountId: r.accountId, campaignId: r.campaignId, metrics: { ...r.metrics } })),
          estimated: false,
        };
      }
      const daily = date === this.today() ? this.withStoppedCampaigns(pd, date) : (pd.daily.get(date) ?? []);
      const hourlyAccount = pd.hourlyAccount.get(date) ?? [];
      if (daily.length) {
        return synthesizeHourly({
          platform: p,
          date,
          daily,
          hourlyAccount,
          coverHours: date === this.today() ? this.coverHoursToday(ds, p) : null,
          defaultCurve: HOURLY_SHARE[p],
        });
      }
      return {
        rows: hourlyAccount.map((r) => ({ date, hour: r.hour ?? 0, platform: p, accountId: r.accountId, campaignId: null, metrics: { ...r.metrics } })),
        estimated: false,
      };
    });
  }

  /**
   * Dataslayer no escribe filas de campañas sin actividad. Con la pestaña ya actualizada hoy, una
   * campaña que gastó ayer y hoy no aparece gastó cero (no es un dato faltante): se agrega en
   * cero para poder detectar que dejó de gastar y listarla en el mensaje de monitoreo.
   */
  private withStoppedCampaigns(pd: PlatformData, today: string): SheetRecord[] {
    const todays = pd.daily.get(today) ?? [];
    if (!todays.length) return todays;
    const seen = new Set(todays.map((r) => r.campaignId));
    const stopped = (pd.daily.get(addDays(today, -1)) ?? [])
      .filter((r) => r.campaignId && !seen.has(r.campaignId) && (r.metrics.spend ?? 0) > 0)
      .map((r) => {
        const metrics = { ...r.metrics };
        for (const k of Object.keys(metrics) as Array<keyof typeof metrics>) if (metrics[k] !== null) metrics[k] = 0;
        return { ...r, date: today, metrics };
      });
    return stopped.length ? [...todays, ...stopped] : todays;
  }

  async getCatalog(): Promise<Catalog> {
    const ds = await this.dataset();
    const today = this.today();
    return this.remember(ds, `catalog:${today}`, () => buildCatalog(ds.records, today, addDays(today, -1)));
  }

  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    const ds = await this.dataset();
    const out: HourlyRow[] = [];
    for (const p of this.platforms()) {
      if (q.platforms?.length && !q.platforms.includes(p)) continue;
      for (const date of q.dates) {
        const { rows } = this.hourlyFor(ds, p, date);
        const campaignRows = q.level === "campaign" ? rows.filter((r) => r.campaignId !== null) : rows;
        out.push(...aggregateHourly(campaignRows, q.level));
      }
    }
    return out;
  }

  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    const ds = await this.dataset();
    const out: DailyRow[] = [];
    for (const p of this.platforms()) {
      if (q.platforms?.length && !q.platforms.includes(p)) continue;
      const pd = ds.platforms.get(p)!;
      for (let date = q.from; date <= q.to; date = addDays(date, 1)) {
        // Diario por campaña tal cual; si solo hay pestañas por hora, se suman las horas del día.
        const daily = pd.daily.get(date);
        const source = daily?.length ? daily : pd.hourlyCampaign.get(date)?.length ? pd.hourlyCampaign.get(date)! : q.level === "campaign" ? [] : (pd.hourlyAccount.get(date) ?? []);
        const byKey = new Map<string, DailyRow>();
        for (const r of source) {
          const key = `${r.accountId}|${r.campaignId}`;
          const cur = byKey.get(key);
          if (cur) addMetrics(cur.metrics, r.metrics);
          else byKey.set(key, { date, platform: p, accountId: r.accountId, campaignId: r.campaignId, metrics: { ...r.metrics } });
        }
        out.push(...aggregateDaily([...byKey.values()], q.level));
      }
    }
    return out;
  }

  async getBudgets(month: string): Promise<BudgetRow[]> {
    const ds = await this.dataset();
    if (!ds.budgets.length) return [];
    const catalog = await this.getCatalog();
    const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    return ds.budgets
      .filter((b) => b.month === month)
      .map((b) => {
        const platform = resolvePlatformAlias(b.platform, DATASLAYER_SOURCE_ALIAS);
        const account = b.account ? catalog.accounts.find((a) => (!platform || a.platform === platform) && (a.id === b.account!.replace(/[\s.\-]/g, "") || norm(a.name) === norm(b.account!))) : undefined;
        const campaign = b.campaign ? catalog.campaigns.find((c) => (!platform || c.platform === platform) && (c.id === b.campaign || norm(c.name) === norm(b.campaign!))) : undefined;
        const explicit = (b.level ?? "").toLowerCase();
        const level: BudgetRow["level"] = /camp/.test(explicit) || (campaign && !explicit) ? "campaign" : /cuenta|account/.test(explicit) || (account && !explicit) ? "account" : /plat/.test(explicit) || (platform && !explicit) ? "platform" : "total";
        return {
          month,
          level,
          platform: platform ?? account?.platform ?? campaign?.platform ?? null,
          accountId: level === "account" || level === "campaign" ? (account?.id ?? campaign?.accountId ?? null) : null,
          campaignId: level === "campaign" ? (campaign?.id ?? null) : null,
          amount: b.amount,
          currency: /usd|dolar|dólar/i.test(b.currency ?? "") ? "USD" : "MXN",
        } satisfies BudgetRow;
      })
      .filter((b) => (b.level !== "account" || b.accountId) && (b.level !== "campaign" || b.campaignId));
  }

  async getFxRates(): Promise<FxRate[]> {
    return (await this.dataset()).fx;
  }

  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const ds = await this.dataset();
    const catalog = await this.getCatalog();
    const today = businessDate(asOf, this.opts.timezone);
    const out: FreshnessRecord[] = [];
    for (const p of this.platforms()) {
      const pd = ds.platforms.get(p)!;
      const ctl = this.primaryControl(ds, p);
      let lastDataAt: string | null = ctl?.updatedAt ?? null;
      if (!lastDataAt) {
        // Sin DataslayerQueries no se sabe cuándo actualizó Dataslayer: si hay datos de hoy se toma
        // el momento de la lectura; si no, el fin del último día con datos.
        const hasToday = Boolean(pd.daily.get(today)?.length || pd.hourlyAccount.get(today)?.length || pd.hourlyCampaign.get(today)?.length);
        if (hasToday) lastDataAt = ds.readAt;
        else {
          const last = [...pd.daily.keys(), ...pd.hourlyAccount.keys(), ...pd.hourlyCampaign.keys()].sort().pop();
          lastDataAt = last ? zonedTimeToUtc(last, 23, 59, this.opts.timezone).toISOString() : null;
        }
      }
      const status = syncStatusOf(ctl?.status);
      const lastError = ctl?.status === "ERROR" ? ctl.statusText : ds.missingSheets.length ? `Pestaña no encontrada: ${ds.missingSheets.join(", ")}` : null;
      const base = { platform: p, lastDataAt, lastSyncAt: ctl?.updatedAt ?? ds.readAt, lastSyncStatus: status, lastError };
      out.push({ ...base, accountId: null });
      // La hoja se actualiza completa: todas sus cuentas tienen la misma frescura (una cuenta sin
      // filas hoy gastó cero; no está atrasada).
      for (const a of catalog.accounts.filter((x) => x.platform === p)) out.push({ ...base, accountId: a.id });
    }
    return out;
  }

  async getSyncLog(limit: number): Promise<SyncLogEntry[]> {
    const ds = await this.dataset();
    const out: SyncLogEntry[] = [];
    for (const p of this.platforms()) {
      for (const s of ds.platforms.get(p)!.sources) {
        const ctl = ds.control.get(sheetKey(s.controlName ?? s.sheet));
        if (!ctl?.updatedAt) continue;
        out.push({
          id: `ds-${sheetKey(s.sheet)}`,
          platform: p,
          workflow: `Dataslayer · ${s.sheet}`,
          startedAt: ctl.updatedAt,
          finishedAt: ctl.updatedAt,
          status: syncStatusOf(ctl.status),
          rowsLoaded: ds.tabRows.get(s.sheet) ?? ctl.rows,
          message: ctl.status === "OK" ? null : ctl.statusText || null,
        });
      }
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async getDataQuality(date: string): Promise<DataQualityStats[]> {
    const ds = await this.dataset();
    return this.platforms().map((p) => {
      const q = ds.quality.get(`${p}|${date}`);
      return { platform: p, date, duplicateRows: q?.duplicates ?? 0, nullSpendRows: q?.nullSpend ?? 0, lastHourRows: 0, expectedLastHourRows: 0 };
    });
  }

  /** Resumen para Integrations: pestañas mapeadas, filas, última actualización y problemas. */
  async summary(): Promise<{ title: string | null; readAt: string; errors: string[]; tabs: Array<{ sheet: string; platform: string; rows: number | null; updatedAt: string | null; status: string | null; found: boolean }> }> {
    const ds = await this.dataset();
    const errors = [
      ...ds.missingSheets.map((s) => `No existe la pestaña "${s}".`),
      ...ds.missingColumns.map((m) => `"${m.sheet}": faltan columnas ${m.columns.join(", ")}.`),
      ...(this.opts.mapping.control && !ds.control.size ? [`No se encontró la pestaña "${this.opts.mapping.control.sheet}" (hora de actualización de Dataslayer).`] : []),
    ];
    const tabs = this.opts.mapping.sources.map((s) => {
      const ctl = ds.control.get(sheetKey(s.controlName ?? s.sheet));
      return { sheet: s.sheet, platform: PLATFORMS[s.platform].name, rows: ds.tabRows.get(s.sheet) ?? null, updatedAt: ctl?.updatedAt ?? null, status: ctl?.statusText ?? null, found: ds.tabRows.has(s.sheet) };
    });
    return { title: ds.info.title || null, readAt: ds.readAt, errors, tabs };
  }

  /** Plataformas que hoy reparten el acumulado con la curva típica (no hay pestaña por hora). */
  async estimatedToday(): Promise<PlatformId[]> {
    const ds = await this.dataset();
    const today = this.today();
    return this.platforms().filter((p) => {
      const pd = ds.platforms.get(p)!;
      return Boolean(pd.daily.get(today)?.length) && !pd.hourlyAccount.get(today)?.length && !pd.hourlyCampaign.get(today)?.length;
    });
  }

  async getExecutionControl(asOf: Date): Promise<ExecutionControlRow[]> {
    const ds = await this.dataset();
    const { refreshEveryMinutes, refreshDurationMinutes } = this.opts.mapping;
    const rows: ExecutionControlRow[] = [];
    for (const p of this.platforms()) {
      for (const s of ds.platforms.get(p)!.sources) {
        if (!ds.tabRows.has(s.sheet)) continue;
        const ctl = ds.control.get(sheetKey(s.controlName ?? s.sheet));
        if (!ctl) continue;
        let status = ctl.status;
        let message = status === "OK" ? null : ctl.statusText || null;
        // Dataslayer tarda 5–10 min: pasada la hora esperada, dentro de esa ventana se reporta "en ejecución".
        const age = ctl.updatedAt ? (asOf.getTime() - new Date(ctl.updatedAt).getTime()) / 60000 : null;
        if (status === "OK" && age !== null && age > refreshEveryMinutes && age <= refreshEveryMinutes + refreshDurationMinutes) {
          status = "EJECUTANDO";
          message = "Dataslayer debería estar actualizando esta pestaña (tarda 5–10 minutos).";
        }
        if (ds.refreshing.includes(s.sheet)) {
          status = "EJECUTANDO";
          message = "Dataslayer está actualizando la pestaña: se muestran los datos de la lectura anterior.";
        }
        rows.push({
          id: `ds-${sheetKey(s.sheet)}`,
          step: `Dataslayer · ${s.sheet}`,
          platform: p,
          source: "dataslayer",
          status,
          lastRunAt: ctl.updatedAt,
          rows: ds.tabRows.get(s.sheet) ?? ctl.rows,
          message,
          expectedEveryMinutes: refreshEveryMinutes,
        });
      }
    }
    for (const sheet of ds.missingSheets) {
      const src = this.opts.mapping.sources.find((s) => s.sheet === sheet);
      rows.push({ id: `missing-${sheetKey(sheet)}`, step: `Pestaña "${sheet}"`, platform: src?.platform ?? null, source: "dataslayer", status: "ERROR", lastRunAt: null, rows: null, message: "No existe en la hoja: revisa el nombre de la pestaña o el mapeo.", expectedEveryMinutes: null });
    }
    for (const m of ds.missingColumns) {
      const src = this.opts.mapping.sources.find((s) => s.sheet === m.sheet);
      rows.push({ id: `cols-${sheetKey(m.sheet)}`, step: `Columnas de "${m.sheet}"`, platform: src?.platform ?? null, source: "dataslayer", status: "PARCIAL", lastRunAt: null, rows: null, message: `No se encontraron: ${m.columns.join(", ")}.`, expectedEveryMinutes: null });
    }
    for (const p of await this.estimatedToday()) {
      rows.push({
        id: `curve-${p}`,
        step: `Curva por hora · ${PLATFORMS[p].name}`,
        platform: p,
        source: "dataslayer",
        status: "PARCIAL",
        lastRunAt: ds.readAt,
        rows: null,
        message: "La hoja solo trae datos diarios: la franja horaria se estima con una curva típica. Agrega la consulta por hora en Dataslayer (docs/INSTALACION.md).",
        expectedEveryMinutes: null,
      });
    }
    return rows;
  }
}
