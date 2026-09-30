import "server-only";
import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_SETTINGS, mergeSettings, settingsDiff, type MonitoringSettings } from "@/lib/config/settings";
import type { MonitoringDataSource } from "@/lib/data/source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { MockDataSource } from "@/lib/mock/mock-source";
import { DEFAULT_SCENARIO, getScenario, type MockScenario } from "@/lib/mock/scenarios";
import { parseMapping, type BigQueryMapping } from "@/lib/bigquery/mapping";
import { BigQueryDataSource } from "@/lib/bigquery/bigquery-source";
import { BigQueryStateStore } from "@/lib/state/bigquery-store";
import { MemoryStateStore, type StateStore } from "@/lib/state/store";
import { RecordsStateStore } from "@/lib/state/records-store";
import { parseSheetsMapping, type SheetsMapping } from "@/lib/sheets/mapping";
import { DEFAULT_HISTORY_DAYS, SheetsDataSource } from "@/lib/sheets/sheets-source";
import { FixtureSheetsReader, GoogleSheetsReader, type SheetsReader } from "@/lib/sheets/reader";
import { RecordsCurveMemory } from "@/lib/sheets/curve-memory-store";
import type { BudgetRow, DataMode } from "@/lib/types";
import { listNovedades, getKickoff, type MonthKickoff } from "@/lib/records/novedades";
import { planFor, type MonitoringPlan } from "@/lib/novedades/plan";
import { businessDate, isValidTimeZone } from "@/lib/time/tz";
import { getSession, type Session } from "@/lib/auth/session";
import { cached, invalidate } from "@/lib/data/cache";
import { getRecordStore } from "@/lib/records/store";
import { logger } from "@/lib/logging/logger";
import { BrandScopedSource } from "@/lib/data/brand-source";
import { BRAND_COOKIE, BRAND_IDS, BRANDS, parseBrand, type BrandId, type BrandInfo } from "@/lib/brands";
import type { PlatformId } from "@/lib/types";

/** Llave de la configuración compartida en el almacén de registros (modo simulado). */
export const SETTINGS_RECORD_KEY = "settings/patch";
export const SCENARIO_COOKIE = "immc_scenario";

export interface AppContext {
  mode: DataMode;
  settings: MonitoringSettings;
  settingsHash: string;
  /** Fuente con conversión a MXN aplicada (cuentas en USD con la tasa del mes). */
  source: CurrencyConvertedSource;
  store: StateStore;
  scenario: MockScenario | null;
  mapping: BigQueryMapping | null;
  mappingErrors: string[];
  sheetsMapping: SheetsMapping | null;
  sheetsErrors: string[];
  session: Session;
  /** Marca del monitoreo (izzi o Sky): cada una con sus cuentas, alertas, incidentes y tickets. */
  brand: BrandId;
  brandInfo: BrandInfo;
  /** Marcas que la persona puede ver (el botón de cambio solo muestra estas). */
  brands: BrandId[];
  /** Plataformas donde la marca tiene cuentas (vacío si la fuente no trae cuentas de la marca). */
  brandPlatforms: PlatformId[];
  /** Fuente completa, sin filtro de marca ni conversión de moneda (resúmenes técnicos). */
  raw: MonitoringDataSource;
  /** Mes de negocio en curso (YYYY-MM) y su arranque (null si nadie lo ha confirmado). */
  month: string;
  kickoff: MonthKickoff | null;
  /** Lo que el monitoreo toma en cuenta de las novedades y del arranque de mes. */
  plan: MonitoringPlan;
}

/** Entrada del motor con lo que el equipo aprobó (novedades, arranque de mes y presupuestos capturados en la app). */
export async function monitoringInput(ctx: AppContext, asOf: Date) {
  const overrides = await ctx.store.getOverrides().catch(() => ({ budgets: [] as BudgetRow[] }));
  const month = businessDate(asOf, ctx.settings.timezone).slice(0, 7);
  return {
    settings: ctx.settings,
    asOf,
    authorizations: ctx.plan.authorizations,
    declaredCampaigns: ctx.plan.declaredCampaigns,
    extraBudgets: [ctx.plan.kickoffBudgets, overrides.budgets.filter((b) => b.month === month), ctx.plan.novedadBudgets],
  };
}

const memoryStores: Record<BrandId, MemoryStateStore> = { izzi: new MemoryStateStore("izzi"), sky: new MemoryStateStore("sky") };
const curveMemory = new RecordsCurveMemory();
const recordsStores: Record<BrandId, RecordsStateStore> = { izzi: new RecordsStateStore("state/"), sky: new RecordsStateStore("state/sky/") };
let sheetsReader: SheetsReader | null = null;

/** Mapeo de la hoja de Dataslayer: SHEETS_MAPPING o config/sheets.mapping.json (no es secreto). */
function sheetsMappingSource(): string | undefined {
  const env = getEnv();
  if (env.sheets.mappingJson) return env.sheets.mappingJson;
  try {
    const file = path.join(/*turbopackIgnore: true*/ process.cwd(), env.sheets.mappingFile);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ajustes propios de la hoja: solo se monitorean las plataformas que trae, y un dato se
 * considera atrasado después de un ciclo completo de Dataslayer (cada 2 h + lo que tarda).
 */
function adaptToSheets(settings: MonitoringSettings, mapping: SheetsMapping): MonitoringSettings {
  const inSheet = [...new Set(mapping.sources.map((s) => s.platform))];
  // Las plataformas que llegan con un día de atraso (intraday: false) no se pueden vigilar en vivo.
  const live = inSheet.filter((p) => mapping.sources.some((s) => s.platform === p && s.intraday));
  const cycle = mapping.refreshEveryMinutes + mapping.refreshDurationMinutes + 20;
  const delayed = Math.max(settings.freshness.delayedAfterMinutes, cycle);
  return {
    ...settings,
    // La hoja decide qué se vigila (no hay pantalla para elegirlo); así una lista guardada por
    // error desde una marca (Sky sin Bing) no deja a la otra sin plataformas.
    monitoredPlatforms: live.length ? live : inSheet,
    ingestion: { ...settings.ingestion, ...Object.fromEntries(inSheet.map((p) => [p, "sheets" as const])) },
    freshness: { ...settings.freshness, delayedAfterMinutes: delayed, criticalAfterMinutes: Math.max(settings.freshness.criticalAfterMinutes, delayed + 120) },
    // Métrica monitoreada por omisión según lo que trae la hoja (lo elegido en Overview/Métricas manda).
    platformMetrics: {
      ...Object.fromEntries(Object.entries(mapping.defaultKpi).map(([p, primary]) => [p, { primary, pinned: [] }])),
      ...settings.platformMetrics,
    },
    // Las conversiones offline llegan horas después: el mapeo dice cuáles no se evalúan en el día.
    detection: { ...settings.detection, laggingMetrics: { ...settings.detection.laggingMetrics, ...mapping.laggingMetrics } },
  };
}

/** El mapeo no es secreto: puede vivir en BIGQUERY_MAPPING o en un archivo versionado (config/bigquery.mapping.json). */
function mappingSource(): string | undefined {
  const env = getEnv();
  if (env.bigquery.mappingJson) return env.bigquery.mappingJson;
  try {
    // config/**/*.json se incluye en el despliegue con outputFileTracingIncludes (next.config.ts).
    const file = path.join(/*turbopackIgnore: true*/ process.cwd(), env.bigquery.mappingFile);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

export function baseSettings(): MonitoringSettings {
  const env = getEnv();
  const tz = env.timezone && isValidTimeZone(env.timezone) ? env.timezone : DEFAULT_SETTINGS.timezone;
  return { ...DEFAULT_SETTINGS, timezone: tz };
}

/**
 * Configuración guardada por el equipo (valores por omisión + cambios), leída directo del
 * almacén y sin los ajustes que la app calcula por marca u hoja. Es la base de todo guardado:
 * partir de la configuración vigente fijaba esos ajustes (p. ej. guardar desde Sky dejaba a
 * izzi sin Bing).
 */
export async function loadStoredSettings(ctx: Pick<AppContext, "mode" | "store">): Promise<MonitoringSettings> {
  const patch = ctx.mode === "bigquery" && ctx.store.loadSettingsPatch ? await ctx.store.loadSettingsPatch() : await getRecordStore().get<unknown>(SETTINGS_RECORD_KEY);
  return mergeSettings(baseSettings(), patch);
}

/** Guarda solo lo que difiere de los valores por omisión y limpia las copias en memoria. */
export async function saveStoredSettings(ctx: Pick<AppContext, "mode" | "store">, next: MonitoringSettings | null, by: string): Promise<void> {
  const patch = next ? settingsDiff(baseSettings(), next) : null;
  if (ctx.mode === "bigquery" && ctx.store.saveSettingsPatch) await ctx.store.saveSettingsPatch(patch, by);
  else if (patch) await getRecordStore().set(SETTINGS_RECORD_KEY, patch);
  else await getRecordStore().delete(SETTINGS_RECORD_KEY);
  invalidate("live:");
  invalidate("replay:");
  invalidate("settings:");
  invalidate("brandstatus:");
  invalidate("report:");
}

function hash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Contexto de cada request: modo (mock/BigQuery), configuración vigente, fuente de datos
 * y almacén de estado. Los componentes y API routes solo hablan con este contexto.
 */
export async function getAppContext(opts: { brand?: BrandId } = {}): Promise<AppContext> {
  const env = getEnv();
  const c = await cookies();
  const session = await getSession();
  const brands = session.brands.length ? session.brands : BRAND_IDS;
  const wanted = opts.brand ?? parseBrand(c.get(BRAND_COOKIE)?.value);
  const brand = brands.includes(wanted) ? wanted : brands[0];
  const { mapping, errors } = env.bigquery.configured ? parseMapping(mappingSource()) : { mapping: null, errors: [] as string[] };
  const sheets = env.dataSource === "sheets" ? parseSheetsMapping(sheetsMappingSource()) : { mapping: null, errors: [] as string[] };
  const mode: DataMode = env.dataSource === "sheets" && sheets.mapping ? "sheets" : env.dataSource === "bigquery" && mapping ? "bigquery" : "mock";
  const useMock = mode === "mock";
  if (env.dataSource === "bigquery" && !mapping) logger.warn("bigquery.mapping_invalid_fallback_mock", { errors });
  if (env.dataSource === "sheets" && !sheets.mapping) logger.warn("sheets.mapping_invalid_fallback_mock", { errors: sheets.errors });

  let settings = baseSettings();
  let store: StateStore = mode === "sheets" ? recordsStores[brand] : memoryStores[brand];
  if (mode === "bigquery" && mapping) {
    store = new BigQueryStateStore(mapping.state, BRANDS[brand].idPrefix, BRAND_IDS.map((b) => BRANDS[b].idPrefix));
    try {
      const patch = await cached("settings:bq", 60 * 1000, () => store.loadSettingsPatch?.() ?? Promise.resolve(null));
      settings = mergeSettings(settings, patch);
    } catch (err) {
      logger.warn("settings.load_failed", { error: err });
    }
  } else {
    try {
      // TTL corto: en Netlify cada instancia tiene su copia y un cambio debe verse en segundos en todas.
      const patch = await cached("settings:records", 5 * 1000, () => getRecordStore().get<unknown>(SETTINGS_RECORD_KEY));
      settings = mergeSettings(settings, patch);
    } catch (err) {
      logger.warn("settings.load_failed", { error: err });
    }
  }

  const scenarioId = c.get(SCENARIO_COOKIE)?.value ?? env.mockScenario ?? DEFAULT_SCENARIO;
  const scenario = useMock ? getScenario(scenarioId) : null;
  if (mode === "sheets") settings = adaptToSheets(settings, sheets.mapping!);
  let inner: MonitoringDataSource;
  if (mode === "sheets") {
    sheetsReader ??= env.sheets.fixtureFile ? new FixtureSheetsReader(env.sheets.fixtureFile) : new GoogleSheetsReader();
    inner = new SheetsDataSource({
      mapping: sheets.mapping!,
      spreadsheetId: sheets.mapping!.spreadsheetId ?? env.sheets.spreadsheetId!,
      timezone: settings.timezone,
      reader: sheetsReader,
      // Semanas de comparación + margen, y al menos el mes en curso (control de presupuesto).
      historyDays: Math.max(DEFAULT_HISTORY_DAYS, settings.history.weeks * 7 + 10),
      curveMemory,
    });
  } else if (mode === "bigquery") {
    inner = new BigQueryDataSource({ mapping: mapping!, timezone: settings.timezone, toleranceMinutes: settings.freshness.cutoffToleranceMinutes });
  } else {
    inner = new MockDataSource({ scenarioId: scenario!.id, timezone: settings.timezone, referenceTime: env.mockReferenceTime, ingestion: settings.ingestion });
  }
  const scoped = new BrandScopedSource(inner, brand);
  // Solo se monitorean las plataformas donde la marca tiene cuentas (Sky no tiene Bing ni Spotify).
  let brandPlatforms: PlatformId[] = [];
  try {
    brandPlatforms = await scoped.platforms();
  } catch (err) {
    logger.warn("brand.platforms_failed", { brand, error: err });
  }
  const forBrand = settings.monitoredPlatforms.filter((p) => brandPlatforms.includes(p));
  if (forBrand.length) settings = { ...settings, monitoredPlatforms: forBrand };
  const source = new CurrencyConvertedSource(scoped, { rates: settings.currency.rates, accountCurrency: settings.currency.accountCurrency });
  const today = businessDate(source.now(), settings.timezone);
  const month = today.slice(0, 7);
  const [novedades, kickoff] = await Promise.all([
    listNovedades(brand).catch((err) => {
      logger.warn("novedades.load_failed", { error: err });
      return [];
    }),
    getKickoff(brand, month).catch(() => null),
  ]);
  const plan = planFor(novedades, kickoff, today, settings.timezone);

  return {
    mode,
    settings,
    // Incluye lo aprobado en novedades y el arranque: si cambia, la evaluación en vivo se recalcula.
    settingsHash: hash({ brand, settings, plan }),
    source,
    store,
    scenario,
    mapping,
    mappingErrors: errors,
    sheetsMapping: sheets.mapping,
    sheetsErrors: sheets.errors,
    session,
    brand,
    brandInfo: BRANDS[brand],
    brands,
    brandPlatforms,
    raw: inner,
    month,
    kickoff,
    plan,
  };
}
