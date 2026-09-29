import "server-only";
import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_SETTINGS, mergeSettings, type MonitoringSettings } from "@/lib/config/settings";
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
import { SheetsDataSource } from "@/lib/sheets/sheets-source";
import { FixtureSheetsReader, GoogleSheetsReader, type SheetsReader } from "@/lib/sheets/reader";
import type { DataMode } from "@/lib/types";
import { isValidTimeZone } from "@/lib/time/tz";
import { getSession, type Session } from "@/lib/auth/session";
import { cached } from "@/lib/data/cache";
import { getRecordStore } from "@/lib/records/store";
import { logger } from "@/lib/logging/logger";

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
}

const memoryStore = new MemoryStateStore();
const recordsStore = new RecordsStateStore();
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
  const chosen = settings.monitoredPlatforms.filter((p) => inSheet.includes(p));
  const cycle = mapping.refreshEveryMinutes + mapping.refreshDurationMinutes + 20;
  const delayed = Math.max(settings.freshness.delayedAfterMinutes, cycle);
  return {
    ...settings,
    monitoredPlatforms: chosen.length ? chosen : inSheet,
    ingestion: { ...settings.ingestion, ...Object.fromEntries(inSheet.map((p) => [p, "sheets" as const])) },
    freshness: { ...settings.freshness, delayedAfterMinutes: delayed, criticalAfterMinutes: Math.max(settings.freshness.criticalAfterMinutes, delayed + 120) },
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
export async function getAppContext(): Promise<AppContext> {
  const env = getEnv();
  const c = await cookies();
  const session = await getSession();
  const { mapping, errors } = env.bigquery.configured ? parseMapping(mappingSource()) : { mapping: null, errors: [] as string[] };
  const sheets = env.dataSource === "sheets" ? parseSheetsMapping(sheetsMappingSource()) : { mapping: null, errors: [] as string[] };
  const mode: DataMode = env.dataSource === "sheets" && sheets.mapping ? "sheets" : env.dataSource === "bigquery" && mapping ? "bigquery" : "mock";
  const useMock = mode === "mock";
  if (env.dataSource === "bigquery" && !mapping) logger.warn("bigquery.mapping_invalid_fallback_mock", { errors });
  if (env.dataSource === "sheets" && !sheets.mapping) logger.warn("sheets.mapping_invalid_fallback_mock", { errors: sheets.errors });

  let settings = baseSettings();
  let store: StateStore = mode === "sheets" ? recordsStore : memoryStore;
  if (mode === "bigquery" && mapping) {
    store = new BigQueryStateStore(mapping.state);
    try {
      const patch = await cached("settings:bq", 60 * 1000, () => store.loadSettingsPatch?.() ?? Promise.resolve(null));
      settings = mergeSettings(settings, patch);
    } catch (err) {
      logger.warn("settings.load_failed", { error: err });
    }
  } else {
    try {
      const patch = await cached("settings:records", 30 * 1000, () => getRecordStore().get<unknown>(SETTINGS_RECORD_KEY));
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
    inner = new SheetsDataSource({ mapping: sheets.mapping!, spreadsheetId: sheets.mapping!.spreadsheetId ?? env.sheets.spreadsheetId!, timezone: settings.timezone, reader: sheetsReader });
  } else if (mode === "bigquery") {
    inner = new BigQueryDataSource({ mapping: mapping!, timezone: settings.timezone, toleranceMinutes: settings.freshness.cutoffToleranceMinutes });
  } else {
    inner = new MockDataSource({ scenarioId: scenario!.id, timezone: settings.timezone, referenceTime: env.mockReferenceTime, ingestion: settings.ingestion });
  }
  const source = new CurrencyConvertedSource(inner, { rates: settings.currency.rates, accountCurrency: settings.currency.accountCurrency });

  return {
    mode,
    settings,
    settingsHash: hash(settings),
    source,
    store,
    scenario,
    mapping,
    mappingErrors: errors,
    sheetsMapping: sheets.mapping,
    sheetsErrors: sheets.errors,
    session,
  };
}
