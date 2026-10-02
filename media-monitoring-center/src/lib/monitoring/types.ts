import type {
  CampaignObjective,
  CampaignStatus,
  DataState,
  EntityLevel,
  AlertEntityLevel,
  DomainMetadata,
  MetricId,
  PlatformId,
  ChartResultMetric,
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

export interface EntityRef extends DomainMetadata {
  key: string;
  level: AlertEntityLevel;
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adGroupId?: string | null;
  adGroupName?: string | null;
}

export interface EntityEvaluation extends EntityRef {
  level: EntityLevel;
  objective: CampaignObjective;
  kpi: Kpi;
  status: CampaignStatus | null;
  /** Solo campañas: de dónde sale el estado y cómo lo reporta la plataforma (ver Campaign). */
  statusSource?: "platform" | "spend";
  statusText?: string | null;
  statusIssue?: boolean;
  statusSilent?: boolean;
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
  /** Hoy la franja horaria sale de una curva típica (la fuente solo trae el acumulado del día). */
  curveEstimated?: boolean;
  /** El resultado del KPI llega con retraso (conversiones offline): en el día no se evalúa. */
  resultLagging?: boolean;
  /** Gasto de los últimos días completos en un nivel distinto al de semanas anteriores (cambio sostenido). */
  sustained?: SustainedLevel | null;
  /** Gasto de ayer vs su referencia (1 = normal): un apagado de hoy es "de golpe" solo si ayer gastaba. */
  previousDayRatio?: number | null;
}

export interface SustainedLevel {
  /** Gasto de esos días ÷ su referencia (mismo día de semanas anteriores). */
  ratio: number;
  days: number;
  direction: "down" | "up";
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
  | "PACING_DEVIATION"
  | "ABSOLUTE_TOP_BELOW"
  | "ABSOLUTE_TOP_DROP";

export type AnomalyFamily = "data" | "delivery" | "tracking" | "performance" | "efficiency" | "pacing" | "absolute_top";

export interface AnomalyEvidence {
  metric: MetricId;
  label: string;
  current: number | null;
  expected: number | null;
  prevWeek: number | null;
  deviation: number | null;
}

/** Cómo se comportó cada campaña de una cuenta o plataforma frente a su esperado. */
export type BreakdownKind = "paused" | "stopped" | "down" | "up" | "new" | "steady";

export interface BreakdownItem {
  campaignId: string;
  campaignName: string;
  accountName: string | null;
  kind: BreakdownKind;
  current: number;
  expected: number;
  /** Estado tal como lo reporta la plataforma (si la hoja lo trae). */
  statusText: string | null;
}

/**
 * Lectura de una caída o subida de gasto: qué campañas se apagaron, cuáles bajaron o subieron
 * y cuáles son nuevas. Responde "¿qué pasó?" y decide si la alerta es grave o esperada.
 */
export type BreakdownVerdict = "mass_stop" | "planned_stop" | "partial_stop" | "rotation" | "mixed" | "running_change" | "launch";

export interface SpendBreakdown {
  /** "day" = acumulado del día; "recent" = ventana desde la evaluación anterior. */
  window: "day" | "recent";
  campaigns: number;
  current: number;
  expected: number;
  groups: Record<BreakdownKind, { count: number; current: number; expected: number }>;
  /** Parte del gasto esperado que corresponde a campañas detenidas (pausadas o sin gasto). */
  stoppedShare: number;
  /** Desviación de las campañas que siguen gastando, sin contar las detenidas ni las nuevas. */
  restDeviation: number | null;
  verdict: BreakdownVerdict;
  summary: string;
  top: BreakdownItem[];
}

/** Por qué una alerta se considera esperada (no abre incidente por persistir). */
export type ExplainedBy = "planned_stop" | "rotation" | "reallocation" | "sustained" | "launch";

export interface Anomaly extends EntityRef {
  absoluteTop?: import("@/lib/absolute-top/types").AbsoluteTopEvaluation;
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
  /** Desglose por campaña (solo caídas o subidas de gasto de cuenta o plataforma). */
  breakdown?: SpendBreakdown | null;
  explained?: ExplainedBy | null;
}

/** Anomalía que no se alerta porque el equipo autorizó el cambio. */
export interface SilencedAnomaly {
  anomaly: Anomaly;
  authorizationId: string;
  by: string;
  reason: string;
  until: string;
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
  results: Record<ChartResultMetric, CurvePoint[]>;
}

export interface MonitoringRun {
  /** Only validated, fresh module observations can resolve an Absolute Top episode. */
  absoluteTopPolicy?: import("@/lib/domains/config").GoogleDomainConfig["absoluteTop"];
  absoluteTopCoverage?: Record<string, { auditId: string; observedAt: string; evaluation?: import("@/lib/absolute-top/types").AbsoluteTopEvaluation }>;
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
  /** Plataformas monitoreadas, en orden (las demás tienen estado neutro y no se muestran). */
  platforms: PlatformId[];
  /** Anomalías silenciadas por un cambio autorizado vigente. */
  silenced?: SilencedAnomaly[];
}
