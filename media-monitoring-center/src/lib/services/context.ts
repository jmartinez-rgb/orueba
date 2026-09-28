import "server-only";
import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_SETTINGS, mergeSettings, type MonitoringSettings } from "@/lib/config/settings";
import type { MonitoringDataSource } from "@/lib/data/source";
import { MockDataSource } from "@/lib/mock/mock-source";
import { DEFAULT_SCENARIO, getScenario, type MockScenario } from "@/lib/mock/scenarios";
import { parseMapping, type BigQueryMapping } from "@/lib/bigquery/mapping";
import { BigQueryDataSource } from "@/lib/bigquery/bigquery-source";
import { BigQueryStateStore } from "@/lib/state/bigquery-store";
import { MemoryStateStore, type StateStore } from "@/lib/state/store";
import { isValidTimeZone } from "@/lib/time/tz";
import { getSession, type Session } from "@/lib/auth/session";
import { cached } from "@/lib/data/cache";
import { logger } from "@/lib/logging/logger";

export const SETTINGS_COOKIE = "immc_settings";
export const SCENARIO_COOKIE = "immc_scenario";

export interface AppContext {
  mode: "mock" | "bigquery";
  settings: MonitoringSettings;
  settingsHash: string;
  source: MonitoringDataSource;
  store: StateStore;
  scenario: MockScenario | null;
  mapping: BigQueryMapping | null;
  mappingErrors: string[];
  session: Session;
}

const memoryStore = new MemoryStateStore();

/** El mapeo no es secreto: puede vivir en BIGQUERY_MAPPING o en un archivo versionado (config/bigquery.mapping.json). */
function mappingSource(): string | undefined {
  const env = getEnv();
  if (env.bigquery.mappingJson) return env.bigquery.mappingJson;
  try {
    const file = path.join(process.cwd(), env.bigquery.mappingFile);
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
  const useMock = env.useMockData || !mapping;
  if (!env.useMockData && !mapping) logger.warn("bigquery.mapping_invalid_fallback_mock", { errors });

  let settings = baseSettings();
  let store: StateStore = memoryStore;
  if (!useMock && mapping) {
    store = new BigQueryStateStore(mapping.state);
    try {
      const patch = await cached("settings:bq", 60 * 1000, () => store.loadSettingsPatch?.() ?? Promise.resolve(null));
      settings = mergeSettings(settings, patch);
    } catch (err) {
      logger.warn("settings.load_failed", { error: err });
    }
  } else {
    const raw = c.get(SETTINGS_COOKIE)?.value;
    if (raw) {
      try {
        settings = mergeSettings(settings, JSON.parse(raw));
      } catch {
        /* cookie inválida: se ignora */
      }
    }
  }

  const scenarioId = c.get(SCENARIO_COOKIE)?.value ?? env.mockScenario ?? DEFAULT_SCENARIO;
  const scenario = useMock ? getScenario(scenarioId) : null;
  const source: MonitoringDataSource = useMock
    ? new MockDataSource({ scenarioId: scenario!.id, timezone: settings.timezone, referenceTime: env.mockReferenceTime })
    : new BigQueryDataSource({ mapping: mapping!, timezone: settings.timezone, toleranceMinutes: settings.freshness.cutoffToleranceMinutes });

  return {
    mode: useMock ? "mock" : "bigquery",
    settings,
    settingsHash: hash(settings),
    source,
    store,
    scenario,
    mapping,
    mappingErrors: errors,
    session,
  };
}
