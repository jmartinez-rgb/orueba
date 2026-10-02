import type { BaseMetric, CampaignObjective, DerivedMetric, MetricId, MetricValues } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";

export type MetricFormat = "currency" | "number" | "percent" | "ratio";

/** Qué dirección de cambio es mala para la operación. */
export type BadDirection = "down" | "up" | "both";

export interface MetricDefinition {
  id: MetricId;
  label: string;
  short: string;
  format: MetricFormat;
  bad: BadDirection;
}

export const METRICS: Record<MetricId, MetricDefinition> = {
  absolute_top_rate: { id: "absolute_top_rate", label: "Absolute Top", short: "Abs. Top", format: "percent", bad: "down" },
  spend: { id: "spend", label: "Gasto", short: "Gasto", format: "currency", bad: "both" },
  impressions: { id: "impressions", label: "Impresiones", short: "Impr.", format: "number", bad: "down" },
  clicks: { id: "clicks", label: "Clics", short: "Clics", format: "number", bad: "down" },
  conversions: { id: "conversions", label: "Conversiones", short: "Conv.", format: "number", bad: "down" },
  leads: { id: "leads", label: "Leads", short: "Leads", format: "number", bad: "down" },
  sales: { id: "sales", label: "Ventas", short: "Ventas", format: "number", bad: "down" },
  whatsapp: { id: "whatsapp", label: "Conversaciones WhatsApp", short: "WhatsApp", format: "number", bad: "down" },
  calls: { id: "calls", label: "Llamadas", short: "Llamadas", format: "number", bad: "down" },
  purchases: { id: "purchases", label: "Compras", short: "Compras", format: "number", bad: "down" },
  revenue: { id: "revenue", label: "Ingresos", short: "Ingresos", format: "currency", bad: "down" },
  cpa: { id: "cpa", label: "CPA", short: "CPA", format: "currency", bad: "up" },
  cpl: { id: "cpl", label: "CPL", short: "CPL", format: "currency", bad: "up" },
  cpr: { id: "cpr", label: "Costo por resultado", short: "CPR", format: "currency", bad: "up" },
  roas: { id: "roas", label: "ROAS", short: "ROAS", format: "ratio", bad: "down" },
  ctr: { id: "ctr", label: "CTR", short: "CTR", format: "percent", bad: "down" },
  cpc: { id: "cpc", label: "CPC", short: "CPC", format: "currency", bad: "up" },
  cpm: { id: "cpm", label: "CPM", short: "CPM", format: "currency", bad: "up" },
};

/** KPI que evalúa cada objetivo de campaña: qué resultado y qué costo por resultado. */
export interface Kpi {
  result: BaseMetric;
  cost: DerivedMetric;
  resultLabel: string;
  costLabel: string;
}

export const OBJECTIVE_KPI: Record<CampaignObjective, Kpi> = {
  SALES: { result: "sales", cost: "cpa", resultLabel: "Ventas", costLabel: "CPA venta" },
  LEADS: { result: "leads", cost: "cpl", resultLabel: "Leads", costLabel: "CPL" },
  WHATSAPP: { result: "whatsapp", cost: "cpa", resultLabel: "Conversaciones WhatsApp", costLabel: "Costo por conversación" },
  CALLS: { result: "calls", cost: "cpa", resultLabel: "Llamadas", costLabel: "Costo por llamada" },
  TRAFFIC: { result: "clicks", cost: "cpc", resultLabel: "Clics", costLabel: "CPC" },
  ENGAGEMENT: { result: "clicks", cost: "cpc", resultLabel: "Interacciones", costLabel: "CPC" },
  VIDEO: { result: "impressions", cost: "cpm", resultLabel: "Impresiones de video", costLabel: "CPM" },
  AWARENESS: { result: "impressions", cost: "cpm", resultLabel: "Impresiones", costLabel: "CPM" },
  PURCHASES: { result: "purchases", cost: "cpa", resultLabel: "Compras", costLabel: "CPA compra" },
  CONVERSIONS: { result: "conversions", cost: "cpa", resultLabel: "Conversiones", costLabel: "CPA" },
};

export const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  SALES: "Sales",
  LEADS: "Leads",
  WHATSAPP: "WhatsApp",
  CALLS: "Calls",
  TRAFFIC: "Traffic",
  ENGAGEMENT: "Engagement",
  VIDEO: "Video",
  AWARENESS: "Awareness",
  PURCHASES: "Purchases",
  CONVERSIONS: "Conversions",
};

export function emptyMetrics(): MetricValues {
  return {
    spend: null,
    impressions: null,
    clicks: null,
    conversions: null,
    leads: null,
    sales: null,
    whatsapp: null,
    calls: null,
    purchases: null,
    revenue: null,
  };
}

/** Suma que respeta NULL: null + null = null; null + 5 = 5; 0 + 0 = 0. */
export function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

export function addMetrics(target: MetricValues, source: MetricValues): MetricValues {
  for (const m of BASE_METRICS) target[m] = addNullable(target[m], source[m]);
  return target;
}

/** Complete direct-report totals: an unknown component cannot become a complete number. */
export function addCompleteMetrics(target: MetricValues, source: MetricValues): MetricValues {
  for (const m of BASE_METRICS) target[m] = target[m] === null || source[m] === null ? null : target[m]! + source[m]!;
  return target;
}

export function sumMetrics(rows: Iterable<MetricValues>): MetricValues {
  const acc = emptyMetrics();
  for (const r of rows) addMetrics(acc, r);
  return acc;
}

function ratio(num: number | null, den: number | null, factor = 1): number | null {
  if (num === null || den === null || den === 0) return null;
  return (num / den) * factor;
}

/** Calcula una métrica (base o derivada) a partir de totales. */
export function metricValue(values: MetricValues, metric: MetricId, kpi?: Kpi): number | null {
  switch (metric) {
    case "absolute_top_rate":
      return null; // Independent Google report; cannot be derived from additive totals.
    case "cpa":
      return ratio(values.spend, values.conversions);
    case "cpl":
      return ratio(values.spend, values.leads);
    case "cpr":
      return kpi ? ratio(values.spend, values[kpi.result], kpi.cost === "cpm" ? 1000 : 1) : null;
    case "roas":
      return ratio(values.revenue, values.spend);
    case "ctr":
      return ratio(values.clicks, values.impressions);
    case "cpc":
      return ratio(values.spend, values.clicks);
    case "cpm":
      return ratio(values.spend, values.impressions, 1000);
    default:
      return values[metric];
  }
}

export function isBaseMetric(m: MetricId): m is BaseMetric {
  return (BASE_METRICS as string[]).includes(m);
}
