import type { BaseMetric, PlatformId, Severity, SyncStatus } from "@/lib/types";

/**
 * Escenarios de anomalías simuladas. Cada escenario modifica el histórico "normal" para
 * reproducir problemas reales: caídas de gasto, tracking roto, sobreinversión, fuentes
 * atrasadas, campañas activas sin delivery, etc.
 */

export interface ScenarioEffect {
  label: string;
  /** 0 = hoy, -1 = ayer. */
  dayOffset: number;
  platform?: PlatformId;
  accountId?: string;
  campaignIds?: string[];
  excludeCampaignIds?: string[];
  /** Horas afectadas [fromHour, toHour). */
  fromHour?: number;
  toHour?: number;
  /** Alternativa relativa: las últimas N horas antes de la hora actual. */
  lastHours?: number;
  /** Factor sobre el gasto (número o arreglo de 24 factores por hora). */
  spend?: number | number[];
  /** Factor sobre la tasa de resultados (conversiones, ventas, WhatsApp...). */
  results?: number;
  /** Resultados reportados en cero (tracking roto). */
  zeroResults?: BaseMetric[];
}

export interface ScenarioOutage {
  platform: PlatformId;
  accountId?: string;
  /** La fuente dejó de enviar datos hace N minutos (respecto a la hora de referencia). */
  stoppedMinutesAgo: number;
  syncStatus: SyncStatus;
  message: string;
}

export interface MockScenario {
  id: string;
  name: string;
  description: string;
  /** Estado esperado por plataforma (documentación y pruebas). */
  expected: Record<PlatformId, Severity | "DATA">;
  effects: ScenarioEffect[];
  outages: ScenarioOutage[];
  duplicates: Partial<Record<PlatformId, number>>;
}

const META_DROP_CAMPAIGNS = ["m-2001", "m-2002", "m-2003", "m-2004", "m-2005", "m-2008", "m-2009", "m-2022", "m-2023"];

/** Caída progresiva de Meta: 0.8 de madrugada, 0.65 al amanecer y 0.55 desde las 8:00. */
const META_DROP_CURVE = Array.from({ length: 24 }, (_, h) => (h < 4 ? 0.8 : h < 8 ? 0.65 : 0.55));

/**
 * Efectos "de contexto" para el mensaje de monitoreo: cambian AYER, no hoy ni las semanas de
 * referencia. Hoy Google sigue dentro de lo esperado (semáforo verde), pero el mensaje sí reporta
 * campañas con más gasto que ayer, caídas de conversiones vs ayer y una campaña sin gasto.
 */
const GOOGLE_CONTEXT: ScenarioEffect[] = [
  { label: "Ayer: izzi - Ofertas con gasto bajo", dayOffset: -1, accountId: "g-104", spend: 0.75 },
  { label: "Ayer: izzi - Paquetes - 2do Dominio con gasto bajo", dayOffset: -1, accountId: "g-105", spend: 0.75 },
  { label: "Ayer: Discovery con gasto bajo", dayOffset: -1, accountId: "g-108", spend: 0.75 },
  // Ayer con +80% de conversiones: hoy se reporta una caída fuerte vs ayer (aunque ayer sea domingo, que convierte menos).
  { label: "Ayer: más conversiones en Performance ppal", dayOffset: -1, accountId: "g-101", results: 1.8 },
  { label: "Ayer: más conversiones en mxn 2", dayOffset: -1, accountId: "g-103", results: 1.8 },
  { label: "Hoy: DSP-Audience sin gasto (volumen bajo, no genera alerta)", dayOffset: 0, campaignIds: ["g-1030"], spend: 0 },
];

/** Ayer: TikTok con caída de delivery 9:00-15:00 y recuperación con gasto acelerado. */
const TIKTOK_YESTERDAY_CURVE = Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 15 ? 0.2 : h >= 15 && h < 21 ? 1.7 : 1));

const yesterdayTikTok: ScenarioEffect = {
  label: "Ayer: TikTok sin delivery 09:00–15:00 y recuperación",
  dayOffset: -1,
  platform: "tiktok",
  spend: TIKTOK_YESTERDAY_CURVE,
};

export const SCENARIOS: Record<string, MockScenario> = {
  default: {
    id: "default",
    name: "Operación con incidencias (demo)",
    description:
      "Meta en crítico por caída de delivery en varias campañas, una campaña activa sin gasto y tracking roto en otra. Microsoft en atención por caída de conversiones, sobreinversión en una campaña y una cuenta con datos atrasados. Resto normal. Ayer TikTok tuvo una caída que se recuperó.",
    expected: { google: "NORMAL", meta: "CRITICAL", tiktok: "NORMAL", microsoft: "ATTENTION", spotify: "NORMAL", x: "NORMAL" },
    effects: [
      {
        label: "Meta: caída de delivery simultánea en 7 campañas",
        dayOffset: 0,
        platform: "meta",
        campaignIds: META_DROP_CAMPAIGNS,
        spend: META_DROP_CURVE,
        results: 0.85,
      },
      {
        label: "Meta: campaña activa con gasto cero",
        dayOffset: 0,
        campaignIds: ["m-2007"],
        spend: 0,
      },
      {
        label: "Meta: gasto normal con ventas en cero (tracking)",
        dayOffset: 0,
        campaignIds: ["m-2006"],
        zeroResults: ["sales", "conversions"],
      },
      {
        label: "Microsoft: caída de conversiones con gasto normal",
        dayOffset: 0,
        accountId: "b-401",
        results: 0.85,
      },
      {
        label: "Microsoft: sobreinversión en campaña de llamadas",
        dayOffset: 0,
        campaignIds: ["b-4004"],
        spend: 1.3,
      },
      yesterdayTikTok,
      ...GOOGLE_CONTEXT,
    ],
    outages: [
      {
        platform: "microsoft",
        accountId: "b-402",
        stoppedMinutesAgo: 210,
        syncStatus: "SUCCESS",
        message: "Sincronización correcta pero sin filas nuevas para la cuenta izzi Bing Audience.",
      },
    ],
    duplicates: { microsoft: 3 },
  },
  normal: {
    id: "normal",
    name: "Todo normal",
    description: "Todas las plataformas dentro de parámetros. Útil para validar que no hay falsas alarmas.",
    expected: { google: "NORMAL", meta: "NORMAL", tiktok: "NORMAL", microsoft: "NORMAL", spotify: "NORMAL", x: "NORMAL" },
    effects: [],
    outages: [],
    duplicates: {},
  },
  "meta-delayed": {
    id: "meta-delayed",
    name: "Meta sin datos recientes",
    description:
      "Meta no envía datos desde hace más de 3 horas: se muestra como datos atrasados (no $0) y no se evalúa rendimiento. La cuenta de X falla al sincronizar (ERROR).",
    expected: { google: "NORMAL", meta: "DATA", tiktok: "NORMAL", microsoft: "NORMAL", spotify: "NORMAL", x: "DATA" },
    effects: [yesterdayTikTok],
    outages: [
      {
        platform: "meta",
        stoppedMinutesAgo: 190,
        syncStatus: "SUCCESS",
        message: "La extracción terminó sin filas nuevas de Meta Ads.",
      },
      {
        platform: "x",
        stoppedMinutesAgo: 150,
        syncStatus: "FAILED",
        message: "La API de X respondió 401 (token vencido). Revisar credencial en n8n.",
      },
    ],
    duplicates: {},
  },
  "tiktok-stopped": {
    id: "tiktok-stopped",
    name: "TikTok dejó de gastar",
    description:
      "Los datos de TikTok llegan a tiempo, pero el gasto cayó a cero en las últimas 3 horas: es un problema real de delivery, no de datos.",
    expected: { google: "NORMAL", meta: "NORMAL", tiktok: "CRITICAL", microsoft: "NORMAL", spotify: "NORMAL", x: "NORMAL" },
    effects: [
      { label: "TikTok: gasto en cero las últimas 3 horas", dayOffset: 0, platform: "tiktok", lastHours: 3, spend: 0 },
      yesterdayTikTok,
    ],
    outages: [],
    duplicates: {},
  },
};

export const DEFAULT_SCENARIO = "default";

export function getScenario(id: string | undefined | null): MockScenario {
  return (id && SCENARIOS[id]) || SCENARIOS[DEFAULT_SCENARIO];
}

export function listScenarios() {
  return Object.values(SCENARIOS).map((s) => ({ id: s.id, name: s.name, description: s.description }));
}
