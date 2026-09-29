/**
 * Tipos de dominio del izzi Media Monitoring Center.
 *
 * Regla de oro: un valor `null` significa "no hay dato" (no se reportó, no aplica o
 * la fuente está atrasada). Nunca se interpreta como cero.
 */

export type PlatformId = "google" | "meta" | "tiktok" | "microsoft" | "spotify" | "x";

export const PLATFORM_IDS: PlatformId[] = ["google", "meta", "tiktok", "microsoft", "spotify", "x"];

export type Severity = "NORMAL" | "ATTENTION" | "ALERT" | "CRITICAL";

export const SEVERITY_ORDER: Severity[] = ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"];

/** Métricas aditivas: son las únicas que se almacenan y se suman. */
export type BaseMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "conversions"
  | "leads"
  | "sales"
  | "whatsapp"
  | "calls"
  | "purchases"
  | "revenue";

export const BASE_METRICS: BaseMetric[] = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "leads",
  "sales",
  "whatsapp",
  "calls",
  "purchases",
  "revenue",
];

/**
 * Métricas derivadas: siempre se recalculan desde totales (SUMA(costo) ÷ SUMA(resultado)),
 * nunca se promedian. `cpr` = costo por resultado principal según el objetivo.
 */
export type DerivedMetric = "cpa" | "cpl" | "roas" | "ctr" | "cpc" | "cpm" | "cpr";

export const DERIVED_METRICS: DerivedMetric[] = ["cpr", "cpa", "cpl", "roas", "ctr", "cpc", "cpm"];

export type MetricId = BaseMetric | DerivedMetric;

export type ResultMetric = "conversions" | "leads" | "sales" | "whatsapp" | "calls" | "purchases";

export const RESULT_METRICS: ResultMetric[] = ["conversions", "sales", "whatsapp", "leads", "calls", "purchases"];

/** Métricas con curva acumulada por hora: los resultados más clics e impresiones (también se pueden monitorear). */
export type ChartResultMetric = ResultMetric | "clicks" | "impressions";
export const CHART_RESULT_METRICS: ChartResultMetric[] = [...RESULT_METRICS, "clicks", "impressions"];

export type MetricValues = Record<BaseMetric, number | null>;

export type CampaignObjective =
  | "SALES"
  | "LEADS"
  | "WHATSAPP"
  | "CALLS"
  | "TRAFFIC"
  | "ENGAGEMENT"
  | "VIDEO"
  | "AWARENESS"
  | "PURCHASES"
  | "CONVERSIONS";

export const CAMPAIGN_OBJECTIVES: CampaignObjective[] = [
  "SALES",
  "LEADS",
  "WHATSAPP",
  "CALLS",
  "TRAFFIC",
  "ENGAGEMENT",
  "VIDEO",
  "AWARENESS",
  "PURCHASES",
  "CONVERSIONS",
];

export type CampaignStatus = "ACTIVE" | "PAUSED" | "ENDED";

/** Monedas soportadas. Todo se reporta en MXN; las cuentas en USD se convierten con la tasa del mes. */
export type Currency = "MXN" | "USD";

export interface Account {
  id: string;
  platform: PlatformId;
  name: string;
  /** Moneda en la que la plataforma reporta la cuenta (Settings puede corregirla). */
  currency: Currency;
}

export interface Campaign {
  id: string;
  platform: PlatformId;
  accountId: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  /** Evento de conversión con el que se mide (p. ej. "MCC_Offline_Purchase"). */
  conversionEvent: string | null;
  /**
   * Objetivo o tipo tal como lo reporta la plataforma (Meta: OUTCOME_LEADS…; Google: SEARCH,
   * PERFORMANCE_MAX…). Lo usan los clasificadores de estrategia como campo secundario.
   */
  sourceType?: string | null;
  /** Texto del estado tal como lo reporta la plataforma (si la hoja trae la columna). */
  statusText?: string | null;
  /** "platform" = estado leído de la plataforma; "spend" = deducido porque gastó hoy o ayer. */
  statusSource?: "platform" | "spend";
  /** Estado con problema de entrega (en revisión, rechazada, sin pago, pausada por presupuesto). */
  statusIssue?: boolean;
  /** La plataforma la reporta activa, pero no gastó ni ayer ni hoy. */
  statusSilent?: boolean;
}

export interface Catalog {
  accounts: Account[];
  campaigns: Campaign[];
}

/** Fila horaria canónica que devuelve cualquier fuente (mock o BigQuery). */
export interface HourlyRow {
  /** Fecha de negocio (zona horaria configurada), YYYY-MM-DD. */
  date: string;
  /** Hora local 0..23. La fila cubre [hour:00, hour+1:00). */
  hour: number;
  platform: PlatformId;
  accountId: string | null;
  campaignId: string | null;
  metrics: MetricValues;
}

export interface DailyRow {
  date: string;
  platform: PlatformId;
  accountId: string | null;
  campaignId: string | null;
  metrics: MetricValues;
}

export type EntityLevel = "platform" | "account" | "campaign";

export type BudgetLevel = "total" | "platform" | "account" | "campaign";

export interface BudgetRow {
  /** Mes de negocio, YYYY-MM. */
  month: string;
  level: BudgetLevel;
  platform: PlatformId | null;
  accountId: string | null;
  campaignId: string | null;
  amount: number;
  /** Moneda del monto (por defecto MXN). Los montos en USD se convierten con la tasa del mes. */
  currency?: Currency;
}

export type SyncStatus = "SUCCESS" | "FAILED" | "RUNNING" | "UNKNOWN";

export interface FreshnessRecord {
  platform: PlatformId;
  /** null = registro a nivel plataforma. */
  accountId: string | null;
  /** Último dato recibido (ISO UTC). null = nunca / sin datos. */
  lastDataAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus;
  lastError: string | null;
}

export interface SyncLogEntry {
  id: string;
  platform: PlatformId | "bigquery" | "n8n";
  workflow: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncStatus;
  rowsLoaded: number | null;
  message: string | null;
}

export interface DataQualityStats {
  platform: PlatformId;
  date: string;
  /** Filas con la misma llave (fecha, hora, campaña) detectadas en la carga. */
  duplicateRows: number;
  /** Filas con gasto NULL (campo obligatorio). */
  nullSpendRows: number;
  /** Filas cargadas en la última hora completa. */
  lastHourRows: number;
  /** Campañas activas esperadas en la última hora completa. */
  expectedLastHourRows: number;
}

/**
 * Estado de los datos de una entidad. Distingue explícitamente:
 * OK, DELAYED (atrasado: no se evalúa rendimiento), ERROR (falló la sincronización),
 * NO_DATA (no hay ninguna fila hoy) y PARTIAL (hay cuentas excluidas por atraso).
 */
export type DataState = "OK" | "PARTIAL" | "DELAYED" | "ERROR" | "NO_DATA";

/** Tasa de cambio mensual (1 USD = rate MXN). */
export interface FxRate {
  month: string;
  rate: number;
}

/** Fuente de datos de la app: simulada, Google Sheets (Dataslayer) o BigQuery. */
export type DataMode = "mock" | "sheets" | "bigquery";

/** Cómo llegan los datos de una plataforma a BigQuery. */
export type IngestionMode = "api" | "sheets";

export type ExecutionStatus = "OK" | "PARCIAL" | "PENDIENTE" | "EJECUTANDO" | "ERROR";

/**
 * Fila de la hoja/tabla de control de ejecución: confirma si Dataslayer, Apps Script o la
 * API ya corrieron y cargaron datos, o si falta ejecutar algún paso.
 */
export interface ExecutionControlRow {
  id: string;
  /** Paso del flujo (p. ej. "Dataslayer · Meta Ads → Sheets"). */
  step: string;
  platform: PlatformId | null;
  source: "dataslayer" | "apps_script" | "api" | "bigquery" | "n8n" | "otro";
  status: ExecutionStatus;
  lastRunAt: string | null;
  rows: number | null;
  message: string | null;
  /** Cada cuánto debería correr (minutos); sirve para marcar como pendiente si no ha corrido. */
  expectedEveryMinutes: number | null;
}
