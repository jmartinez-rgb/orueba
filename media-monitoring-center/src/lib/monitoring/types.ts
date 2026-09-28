import type {
  CampaignObjective,
  CampaignStatus,
  DataState,
  EntityLevel,
  MetricId,
  PlatformId,
  ResultMetric,
  Severity,
} from "@/lib/types";
import type { Kpi } from "@/lib/metrics";
import type { PlatformDataHealth } from "./data-health";

/** Comparación de una métrica contra el mismo día de la semana y la misma franja horaria. */
export interface MetricComparison {
  current: number | null;
  prevWeek: number | null;
  mean: number | null;
  median: number | null;
  /** Valor esperado según el método configurado (promedio o mediana). */
  expected: number | null;
  samples: Array<{ date: string; value: number | null }>;
  sampleCount: number;
  deltaVsPrevWeek: number | null;
  deltaVsMean: number | null;
  deltaVsMedian: number | null;
  deltaVsExpected: number | null;
  stdDev: number | null;
  zScore: number | null;
}

export type MetricComparisons = Partial<Record<MetricId, MetricComparison>>;

export interface EntityRef {
  key: string;
  level: EntityLevel;
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface EntityEvaluation extends EntityRef {
  objective: CampaignObjective;
  kpi: Kpi;
  status: CampaignStatus | null;
  dataState: DataState;
  dataStateReason: string | null;
  /** Severidad del problema de datos (NORMAL si los datos están al día). */
  dataSeverity: Severity;
  lastDataAt: string | null;
  lagMinutes: number | null;
  /** Hora de corte efectiva: la ventana evaluada es [00:00, cutoffHour:00). */
  cutoffHour: number;
  /** Ventana acumulada del día (regla principal). */
  cumulative: MetricComparisons;
  /** Ventana reciente (desde la evaluación anterior): detecta paros súbitos. */
  recent: MetricComparisons | null;
  recentFromHour: number;
  /** Participación en el gasto esperado de su plataforma. */
  expectedSpendShare: number | null;
  /** Qué parte del gasto de un día completo suele haber ocurrido a la hora de corte (curva histórica). */
  dayShare: number | null;
  /** Cuentas excluidas de la comparación por datos atrasados (solo nivel plataforma). */
  excludedAccounts: string[];
}

export type AnomalyType =
  | "DATA_ISSUE"
  | "DELIVERY_CRITICAL"
  | "PLATFORM_INCIDENT"
  | "DELIVERY_ISSUE"
  | "TRACKING_ISSUE"
  | "PERFORMANCE_ISSUE"
  | "EFFICIENCY_ISSUE"
  | "OVERSPEND"
  | "UNDERSPEND"
  | "COST_INCREASE"
  | "PACING_DEVIATION";

export type AnomalyFamily = "data" | "delivery" | "tracking" | "performance" | "efficiency" | "pacing";

export interface AnomalyEvidence {
  metric: MetricId;
  label: string;
  current: number | null;
  expected: number | null;
  prevWeek: number | null;
  deviation: number | null;
}

export interface Anomaly extends EntityRef {
  /** Huella estable: misma entidad + misma familia = misma anomalía entre corridas. */
  fingerprint: string;
  type: AnomalyType;
  family: AnomalyFamily;
  severity: Severity;
  /** Severidad antes de ajustes (volumen, hora, variabilidad), para trazabilidad. */
  rawSeverity: Severity;
  metric: MetricId;
  current: number | null;
  expected: number | null;
  deviation: number | null;
  title: string;
  diagnosis: string;
  adjustments: string[];
  evidence: AnomalyEvidence[];
  objective: CampaignObjective;
  expectedSpendShare: number | null;
  cutoffHour: number;
  /** Si se agrupó bajo un incidente de plataforma, su huella. */
  groupedUnder: string | null;
}

export interface PlatformStatusInfo {
  platform: PlatformId;
  severity: Severity;
  dataState: DataState;
  anomalyCounts: Record<Severity, number>;
  topAnomaly: Anomaly | null;
}

export interface DailyPacing {
  dailyBudget: number | null;
  spend: number | null;
  /** Gasto esperado a esta hora según la curva horaria histórica. */
  expectedByCurve: number | null;
  /** Participación histórica del día ya transcurrida a la hora de corte. */
  curveShare: number;
  curveSource: "historical" | "linear";
  pctOfExpected: number | null;
  deviation: number | null;
  forecastClose: number | null;
  forecastVsBudget: number | null;
}

export interface CurvePoint {
  hour: number;
  label: string;
  today: number | null;
  prevWeek: number | null;
  avg: number | null;
  budget?: number | null;
}

export interface ScopeCurves {
  spend: CurvePoint[];
  results: Record<ResultMetric, CurvePoint[]>;
}

export interface MonitoringRun {
  runAt: string;
  timezone: string;
  businessDate: string;
  cutoffHour: number;
  intervalHours: number;
  comparisonDates: string[];
  historyWeeks: number;
  baseline: "mean" | "median";
  entities: EntityEvaluation[];
  anomalies: Anomaly[];
  platformStatus: Record<PlatformId, PlatformStatusInfo>;
  overall: Severity;
  pacing: Record<PlatformId | "total", DailyPacing>;
  curves: Record<PlatformId | "total", ScopeCurves>;
  dataHealth: Record<PlatformId, PlatformDataHealth>;
  /** Plataformas incluidas en el total (las que tienen datos al día). */
  totalIncludes: PlatformId[];
  totalCutoffHour: number;
}
