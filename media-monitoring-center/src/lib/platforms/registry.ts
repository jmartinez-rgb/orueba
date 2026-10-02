import type { BaseMetric, CampaignObjective, PlatformId } from "@/lib/types";
import { OBJECTIVE_KPI, type Kpi } from "@/lib/metrics";

export interface PlatformDefinition {
  id: PlatformId;
  name: string;
  shortName: string;
  /** Posición fija en la paleta categórica (validada para daltonismo). */
  colorSlot: 1 | 2 | 3 | 4 | 5 | 6;
  /** Métricas que la plataforma reporta. Las demás llegan como NULL (no aplica), nunca como 0. */
  supportedMetrics: BaseMetric[];
  /** Objetivo con el que se evalúa la plataforma en conjunto. */
  platformObjective: CampaignObjective;
  /** Resultados secundarios que se muestran en la vista de plataforma. */
  secondaryResults: BaseMetric[];
  /** Nombres con los que suele venir la plataforma en las tablas de origen. */
  sourceAliases: string[];
  /** Nota de medición (se muestra como contexto). */
  measurementNote: string | null;
}

export const PLATFORMS: Record<PlatformId, PlatformDefinition> = {
  google: {
    id: "google",
    name: "Google Ads",
    shortName: "Google",
    colorSlot: 1,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions", "leads", "sales", "calls", "revenue"],
    platformObjective: "SALES",
    secondaryResults: ["leads", "calls", "conversions"],
    sourceAliases: ["google", "google ads", "google_ads", "adwords", "googleads"],
    measurementNote: "Ventas con MCC_Offline_Purchase y leads con MCC_Offline_Lead_Contact (conversiones offline).",
  },
  meta: {
    id: "meta",
    name: "Meta Ads",
    shortName: "Meta",
    colorSlot: 2,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions", "leads", "sales", "whatsapp", "purchases", "revenue"],
    platformObjective: "WHATSAPP",
    secondaryResults: ["sales", "purchases", "leads"],
    sourceAliases: ["meta", "facebook", "facebook ads", "meta ads", "fb", "instagram"],
    measurementNote:
      "Campañas CAPI WhatsApp se miden con On-Facebook Purchase; el resto con Compras Offline Web (Inbound). No se mezclan en el análisis.",
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok Ads",
    shortName: "TikTok",
    colorSlot: 3,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions", "leads", "whatsapp", "sales"],
    platformObjective: "LEADS",
    secondaryResults: ["whatsapp", "conversions", "sales"],
    sourceAliases: ["tiktok", "tiktok ads", "tik tok", "tiktok_ads"],
    measurementNote: null,
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft Advertising",
    shortName: "Microsoft",
    colorSlot: 4,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions", "leads", "sales", "calls"],
    platformObjective: "CONVERSIONS",
    secondaryResults: ["leads", "sales", "calls"],
    sourceAliases: ["microsoft", "bing", "bing ads", "microsoft advertising", "microsoft ads"],
    measurementNote: null,
  },
  spotify: {
    id: "spotify",
    name: "Spotify Ads",
    shortName: "Spotify",
    colorSlot: 5,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions"],
    platformObjective: "AWARENESS",
    secondaryResults: ["clicks", "conversions"],
    sourceAliases: ["spotify", "spotify ads", "spotify_ads"],
    measurementNote: "Plataforma de alcance: se evalúa con impresiones y CPM.",
  },
  x: {
    id: "x",
    name: "X Ads",
    shortName: "X",
    colorSlot: 6,
    supportedMetrics: ["spend", "impressions", "clicks", "conversions", "leads"],
    platformObjective: "TRAFFIC",
    secondaryResults: ["conversions", "leads"],
    sourceAliases: ["x", "x ads", "twitter", "twitter ads"],
    measurementNote: null,
  },
};

/** KPI (resultado + costo por resultado) a partir de la métrica monitoreada elegida. */
export const KPI_BY_METRIC: Record<string, CampaignObjective> = {
  sales: "SALES",
  leads: "LEADS",
  whatsapp: "WHATSAPP",
  calls: "CALLS",
  purchases: "PURCHASES",
  conversions: "CONVERSIONS",
  clicks: "TRAFFIC",
  impressions: "AWARENESS",
};

/** Métrica monitoreada de la plataforma: la elegida en Overview/Métricas o la de su objetivo. */
export function platformKpi(platform: PlatformId, overrides?: Partial<Record<PlatformId, { primary: string }>>): Kpi {
  const chosen = overrides?.[platform]?.primary;
  if (chosen && KPI_BY_METRIC[chosen]) {
    const kpi = OBJECTIVE_KPI[KPI_BY_METRIC[chosen]];
    return chosen === "clicks" ? { ...kpi, resultLabel: "Clics" } : kpi;
  }
  return OBJECTIVE_KPI[PLATFORMS[platform].platformObjective];
}

/** Métricas que se pueden elegir como "monitoreada" en cada plataforma (las que reporta). */
export function kpiChoices(platform: PlatformId): BaseMetric[] {
  const supported = new Set(PLATFORMS[platform].supportedMetrics);
  return (["conversions", "sales", "whatsapp", "leads", "calls", "purchases", "clicks", "impressions"] as BaseMetric[]).filter((m) => supported.has(m));
}

export function isPlatformId(v: string): v is PlatformId {
  return v in PLATFORMS;
}

/** Normaliza el nombre de plataforma que venga de BigQuery ("facebook", "bing", "twitter"...). */
export function resolvePlatformAlias(raw: string | null | undefined, extra?: Record<string, PlatformId>): PlatformId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (extra && extra[key]) return extra[key];
  for (const p of Object.values(PLATFORMS)) {
    if (p.id === key || p.sourceAliases.includes(key)) return p.id;
  }
  return null;
}

/** Nombre visible de la fuente de datos. */
export const DATA_MODE_LABEL: Record<"mock" | "sheets" | "bigquery" | "unified", string> = { mock: "Datos simulados", sheets: "Google Sheets (Dataslayer)", bigquery: "BigQuery", unified: "APIs directas (histórico guardado)" };
