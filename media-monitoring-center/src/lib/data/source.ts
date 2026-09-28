import type {
  BudgetRow,
  Catalog,
  DailyRow,
  DataQualityStats,
  EntityLevel,
  ExecutionControlRow,
  FreshnessRecord,
  FxRate,
  HourlyRow,
  PlatformId,
  SyncLogEntry,
} from "@/lib/types";

export interface HourlyQuery {
  /** Fechas de negocio a consultar (se usan como filtro de partición). */
  dates: string[];
  level: EntityLevel;
  platforms?: PlatformId[];
}

export interface DailyQuery {
  from: string;
  to: string;
  level: EntityLevel;
  platforms?: PlatformId[];
}

/**
 * Contrato único de acceso a datos. La UI y los motores nunca saben si los datos vienen
 * del mock o de BigQuery: solo conocen esta interfaz.
 */
export interface MonitoringDataSource {
  readonly kind: "mock" | "bigquery";
  /** Instante de referencia (el mock puede fijarlo con MOCK_REFERENCE_TIME). */
  now(): Date;
  getCatalog(): Promise<Catalog>;
  getHourly(q: HourlyQuery): Promise<HourlyRow[]>;
  getDaily(q: DailyQuery): Promise<DailyRow[]>;
  getBudgets(month: string): Promise<BudgetRow[]>;
  /** Frescura por plataforma y por cuenta tal como se veía en `asOf`. */
  getFreshness(asOf: Date): Promise<FreshnessRecord[]>;
  getSyncLog(limit: number): Promise<SyncLogEntry[]>;
  getDataQuality(date: string): Promise<DataQualityStats[]>;
  /** Hoja/tabla de control de ejecución (Dataslayer, Apps Script, API). Vacío si no está configurada. */
  getExecutionControl(asOf: Date): Promise<ExecutionControlRow[]>;
  /** Tasas USD→MXN que trae la fuente (tabla de BigQuery o valores simulados). Settings las puede sobrescribir. */
  getFxRates(): Promise<FxRate[]>;
}
