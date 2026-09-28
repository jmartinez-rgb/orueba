import type { Account, BaseMetric, Campaign, CampaignObjective, CampaignStatus, PlatformId } from "@/lib/types";

/**
 * Catálogo simulado con la estructura real de la cuenta: varias cuentas por plataforma,
 * cuentas en MXN y en USD, y nombres de campaña como los que usa el equipo (así los
 * clasificadores de estrategia se comportan igual que en la hoja de cálculo).
 * La inversión diaria base está expresada en MXN equivalentes. Solo se usa en MOCK MODE.
 */

export interface MockCampaignSeed {
  id: string;
  platform: PlatformId;
  accountId: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  conversionEvent: string | null;
  /** Objetivo/tipo reportado por la plataforma (campo secundario de los clasificadores). */
  sourceType: string | null;
  /** Inversión diaria base en MXN equivalentes. */
  dailySpend: number;
  /** Costo por unidad de cada resultado (MXN). Métrica ausente = 0 reportado; `null` = no se reporta (NULL). */
  costs: Partial<Record<BaseMetric, number | null>>;
}

export const MOCK_ACCOUNTS: Account[] = [
  // Google Ads
  { id: "g-101", platform: "google", name: "izzi – Performance ppal", currency: "MXN" },
  { id: "g-102", platform: "google", name: "izzi – Performance AO - mxn", currency: "MXN" },
  { id: "g-103", platform: "google", name: "izzi – Performance AO - mxn 2", currency: "MXN" },
  { id: "g-104", platform: "google", name: "izzi - Ofertas", currency: "MXN" },
  { id: "g-105", platform: "google", name: "izzi - Paquetes - 2do Dominio", currency: "MXN" },
  { id: "g-106", platform: "google", name: "izzi - móvil - mxn", currency: "MXN" },
  { id: "g-107", platform: "google", name: "izzi - Universal+", currency: "MXN" },
  { id: "g-108", platform: "google", name: "Discovery", currency: "USD" },
  // Meta Ads
  { id: "m-201", platform: "meta", name: "izzi MXN - IZZI WHATSAPP", currency: "MXN" },
  { id: "m-202", platform: "meta", name: "izzi ABCW", currency: "MXN" },
  { id: "m-203", platform: "meta", name: "Paquetes izzi Telecom", currency: "MXN" },
  { id: "m-204", platform: "meta", name: "izzi Telecom", currency: "MXN" },
  { id: "m-205", platform: "meta", name: "izzi Exponente", currency: "MXN" },
  { id: "m-206", platform: "meta", name: "izzi MXN - izzi 1", currency: "MXN" },
  { id: "m-207", platform: "meta", name: "izzi MXN - izzi 2", currency: "MXN" },
  { id: "m-208", platform: "meta", name: "izzi MXN - izzi 3", currency: "MXN" },
  { id: "m-209", platform: "meta", name: "izzi MXN - izzi 4", currency: "MXN" },
  { id: "m-210", platform: "meta", name: "izzi MXN - izzi 5", currency: "MXN" },
  { id: "m-211", platform: "meta", name: "izzi Universal+", currency: "MXN" },
  { id: "m-212", platform: "meta", name: "izzi Discovery", currency: "USD" },
  // TikTok, Microsoft, Spotify, X
  { id: "t-301", platform: "tiktok", name: "izzi TikTok Performance", currency: "MXN" },
  { id: "t-302", platform: "tiktok", name: "izzi TikTok Branding", currency: "MXN" },
  { id: "b-401", platform: "microsoft", name: "izzi Bing Search", currency: "MXN" },
  { id: "b-402", platform: "microsoft", name: "izzi Bing Audience", currency: "MXN" },
  { id: "s-501", platform: "spotify", name: "izzi Spotify Audio", currency: "USD" },
  { id: "x-601", platform: "x", name: "izzi X Ads", currency: "USD" },
];

const G_SALE = "MCC_Offline_Purchase";
const G_LEAD = "MCC_Offline_Lead_Contact";
const M_INBOUND = "Compras Offline Web (Inbound)";
const M_OFB = "On-Facebook Purchase";

type Seed = MockCampaignSeed;
const g = (id: string, accountId: string, name: string, objective: CampaignObjective, dailySpend: number, costs: Seed["costs"], sourceType: string, status: CampaignStatus = "ACTIVE", conversionEvent: string | null = objective === "LEADS" ? G_LEAD : G_SALE): Seed => ({
  id,
  platform: "google",
  accountId,
  name,
  objective,
  status,
  conversionEvent,
  sourceType,
  dailySpend,
  costs,
});
const m = (id: string, accountId: string, name: string, objective: CampaignObjective, dailySpend: number, costs: Seed["costs"], sourceType: string, conversionEvent: string | null = M_INBOUND, status: CampaignStatus = "ACTIVE"): Seed => ({
  id,
  platform: "meta",
  accountId,
  name,
  objective,
  status,
  conversionEvent,
  sourceType,
  dailySpend,
  costs,
});

const SEARCH_COSTS = { sales: 1400, leads: 280, calls: 800 };
const PMAX_COSTS = { sales: 1500, leads: 300, calls: 1200 };

export const MOCK_CAMPAIGNS: MockCampaignSeed[] = [
  // ── Google Ads ─────────────────────────────────────────────────────────────
  // izzi – Performance ppal
  g("g-1001", "g-101", "Search | Genéricas Maradona | Nacional", "SALES", 420000, { sales: 1250, leads: 260, calls: 520 }, "SEARCH"),
  g("g-1002", "g-101", "Search | Genéricas | Internet Hogar", "SALES", 380000, { sales: 1650, leads: 310, calls: 700 }, "SEARCH"),
  g("g-1003", "g-101", "Search | Competencia | Nacional", "LEADS", 180000, { sales: 2400, leads: 290, calls: 900 }, "SEARCH"),
  g("g-1004", "g-101", "Search | Negocios | Llamadas 800", "CALLS", 140000, { sales: 2100, leads: 700, calls: 165 }, "SEARCH", "ACTIVE", "Calls from ads"),
  g("g-1009", "g-101", "Search | Buen Fin 2025", "SALES", 0, { sales: 1500, leads: 300 }, "SEARCH", "PAUSED"),
  // izzi – Performance AO - mxn
  g("g-1005", "g-102", "Performance Max | 2026 | Descuentos", "SALES", 520000, { sales: 1450, leads: 280, calls: 1100 }, "PERFORMANCE_MAX"),
  g("g-1006", "g-102", "Performance Max | 2026 | Especiales", "SALES", 300000, { sales: 1550, leads: 300, calls: 1200 }, "PERFORMANCE_MAX"),
  g("g-1007", "g-102", "V - Nacional - Conv Demand", "CONVERSIONS", 120000, { sales: 2600, leads: 330 }, "DEMAND_GEN", "ACTIVE", G_LEAD),
  g("g-1010", "g-102", "Genéricas (NUEVO) Test AI Max Génerica", "SALES", 90000, { sales: 1700, leads: 320 }, "SEARCH"),
  g("g-1011", "g-102", "Performance Max | 2026 ECommerce max", "SALES", 110000, PMAX_COSTS, "PERFORMANCE_MAX"),
  // izzi – Performance AO - mxn 2
  g("g-1012", "g-103", "MXNORTE - MARCA", "SALES", 60000, { sales: 900, leads: 200, calls: 500 }, "SEARCH"),
  g("g-1013", "g-103", "CENTRO - MARCA", "SALES", 55000, { sales: 950, leads: 210, calls: 520 }, "SEARCH"),
  g("g-1014", "g-103", "NORESTE - MARCA", "SALES", 45000, { sales: 980, leads: 220, calls: 540 }, "SEARCH"),
  g("g-1015", "g-103", "CIUDAD DE MEXICO - MARCA", "SALES", 70000, { sales: 920, leads: 205, calls: 510 }, "SEARCH"),
  g("g-1016", "g-103", "Contratación NACIONAL", "SALES", 50000, { sales: 1300, leads: 260 }, "SEARCH"),
  g("g-1017", "g-103", "Temporal", "SALES", 25000, { sales: 1600, leads: 320 }, "SEARCH"),
  // izzi - Ofertas
  g("g-1018", "g-104", "MXSUR - CPC Manual", "SALES", 35000, SEARCH_COSTS, "SEARCH"),
  g("g-1019", "g-104", "CENTRO - CPC Manual", "SALES", 40000, SEARCH_COSTS, "SEARCH"),
  g("g-1020", "g-104", "GOLFO - CPC Manual", "SALES", 30000, SEARCH_COSTS, "SEARCH"),
  g("g-1021", "g-104", "NORESTE - CPC Manual", "SALES", 32000, SEARCH_COSTS, "SEARCH"),
  g("g-1022", "g-104", "Performance Max | 2026 | Genericas Ofertas", "SALES", 75000, PMAX_COSTS, "PERFORMANCE_MAX"),
  g("g-1023", "g-104", "Performance Max | 2026 | Descuentos Ofertas", "SALES", 70000, PMAX_COSTS, "PERFORMANCE_MAX"),
  // izzi - Paquetes - 2do Dominio
  g("g-1024", "g-105", "MXCENTRO", "SALES", 38000, SEARCH_COSTS, "SEARCH"),
  g("g-1025", "g-105", "MXNORTE", "SALES", 34000, SEARCH_COSTS, "SEARCH"),
  g("g-1026", "g-105", "OCCIDENTE", "SALES", 30000, SEARCH_COSTS, "SEARCH"),
  g("g-1027", "g-105", "GOLFO", "SALES", 26000, SEARCH_COSTS, "SEARCH"),
  // izzi - móvil - mxn
  g("g-1028", "g-106", "izzi móvil PMAX", "SALES", 65000, PMAX_COSTS, "PERFORMANCE_MAX"),
  g("g-1029", "g-106", "izzi móvil DEMAND GEN", "CONVERSIONS", 30000, { sales: 2500, leads: 340 }, "DEMAND_GEN", "ACTIVE", G_LEAD),
  g("g-1030", "g-106", "DSP-Audience", "CONVERSIONS", 4500, { sales: 3000, leads: 400 }, "DISPLAY", "ACTIVE", G_LEAD),
  // izzi - Universal+
  g("g-1008", "g-107", "YouTube | Universal+ | Septiembre 2026", "VIDEO", 140000, { sales: 9000, leads: 1800 }, "VIDEO", "ACTIVE", null),
  g("g-1031", "g-107", "PMax | The Hunting Party | Agosto 2026", "SALES", 45000, { sales: 2200, leads: 420 }, "PERFORMANCE_MAX"),
  // Discovery (USD)
  g("g-1032", "g-108", "PMAX | Caricaturas | Septiembre 2026", "CONVERSIONS", 40000, { sales: 2600, leads: 380 }, "PERFORMANCE_MAX", "ACTIVE", G_LEAD),
  g("g-1033", "g-108", "HBO Max - Programas | Search 2026", "CONVERSIONS", 28000, { sales: 2400, leads: 360 }, "SEARCH", "ACTIVE", G_LEAD),
  g("g-1034", "g-108", "HBO Max - Animales | Search 2026", "CONVERSIONS", 22000, { sales: 2500, leads: 370 }, "SEARCH", "ACTIVE", G_LEAD),
  g("g-1035", "g-108", "YouTube l Septiembre 2026", "VIDEO", 30000, { sales: 9500, leads: 1900 }, "VIDEO", "ACTIVE", null),

  // ── Meta Ads ───────────────────────────────────────────────────────────────
  m("m-2001", "m-201", "Performance 2025 | WhatsApp | Nacional", "WHATSAPP", 650000, { whatsapp: 62, sales: 1500, leads: 900, purchases: 9000 }, "OUTCOME_ENGAGEMENT"),
  m("m-2002", "m-201", "Performance 2025 | WhatsApp | CDMX", "WHATSAPP", 380000, { whatsapp: 58, sales: 1400, leads: 850, purchases: 9500 }, "OUTCOME_ENGAGEMENT"),
  m("m-2004", "m-202", "ABCW | CAPI WHATSAPP | Nacional", "PURCHASES", 480000, { whatsapp: 74, purchases: 1180, sales: 4800 }, "OUTCOME_SALES", M_OFB),
  m("m-2011", "m-202", "ABCW | Negocios | Pymes", "LEADS", 80000, { leads: 240, sales: 3000 }, "OUTCOME_LEADS", "Lead (formulario instantáneo)"),
  m("m-2006", "m-203", "Paquetes | Sitio Web | Venta", "SALES", 420000, { sales: 1580, leads: 420, whatsapp: 900 }, "OUTCOME_SALES"),
  m("m-2017", "m-203", "Paquetes | SALES | Salesforce Leads", "LEADS", 60000, { leads: 230, sales: 3100 }, "OUTCOME_LEADS", "Lead (formulario instantáneo)"),
  m("m-2003", "m-204", "izzi Telecom | WhatsApp | Monterrey", "WHATSAPP", 260000, { whatsapp: 66, sales: 1600, leads: 950, purchases: 9800 }, "OUTCOME_ENGAGEMENT"),
  m("m-2019", "m-204", "izzi Telecom | móvil | Branding", "AWARENESS", 30000, { leads: 5200 }, "OUTCOME_AWARENESS", null),
  m("m-2007", "m-205", "Exponente | Venta | Ofertas", "SALES", 160000, { sales: 1700, leads: 450, whatsapp: 1000 }, "OUTCOME_SALES"),
  m("m-2021", "m-205", "Exponente | Hogar | Alcance", "AWARENESS", 30000, { leads: 5000 }, "OUTCOME_AWARENESS", null),
  m("m-2008", "m-206", "MXN 1 | Formulario | FTTH", "LEADS", 190000, { leads: 215, sales: 3200 }, "OUTCOME_LEADS", "Lead (formulario instantáneo)"),
  m("m-2023", "m-206", "MXN 1 | WhatsApp | Bajío", "WHATSAPP", 50000, { whatsapp: 61, sales: 1550, leads: 920, purchases: 9600 }, "OUTCOME_ENGAGEMENT"),
  m("m-2012", "m-207", "MXN 2 | Performance | Móvil | Formulario", "LEADS", 70000, { leads: 220, sales: 3300 }, "OUTCOME_LEADS", "Lead (formulario instantáneo)"),
  m("m-2022", "m-207", "MXN 2 | WhatsApp | Occidente", "WHATSAPP", 55000, { whatsapp: 60, sales: 1500, leads: 900, purchases: 9500 }, "OUTCOME_ENGAGEMENT"),
  m("m-2005", "m-208", "MXN 3 | CAPI WHATSAPP | Guadalajara", "PURCHASES", 210000, { whatsapp: 71, purchases: 1250, sales: 5200 }, "OUTCOME_SALES", M_OFB),
  m("m-2013", "m-208", "MXN 3 | Auronix | Bot", "WHATSAPP", 60000, { whatsapp: 64, sales: 1700, leads: 950 }, "OUTCOME_ENGAGEMENT"),
  m("m-2014", "m-209", "MXN 4 | Llamada | Nacional", "CONVERSIONS", 45000, { leads: 400, sales: 3200 }, "OUTCOME_LEADS", "Llamada"),
  m("m-2024", "m-209", "MXN 4 | Venta | Paquetes", "SALES", 45000, { sales: 1650, leads: 440, whatsapp: 950 }, "OUTCOME_SALES"),
  m("m-2010", "m-209", "MXN 4 | Seguidores izzi Sky", "ENGAGEMENT", 0, {}, "OUTCOME_ENGAGEMENT", null, "ENDED"),
  m("m-2015", "m-210", "MXN 5 | Performance 2024 | Nuevos Artes | Hogar", "WHATSAPP", 90000, { whatsapp: 64, sales: 1700, leads: 950 }, "OUTCOME_ENGAGEMENT"),
  m("m-2016", "m-210", "MXN 5 | Temporal | Septiembre", "AWARENESS", 40000, { leads: 5000 }, "OUTCOME_AWARENESS", null),
  m("m-2009", "m-211", "Universal+ | Brand 100% l Digital", "AWARENESS", 150000, { leads: 5000 }, "OUTCOME_AWARENESS", null),
  m("m-2020", "m-211", "Universal+ | Performance 2024 | Móvil", "LEADS", 25000, { leads: 260, sales: 3500 }, "OUTCOME_LEADS", "Lead (formulario instantáneo)"),
  m("m-2018", "m-212", "Discovery | Temporal | Caricaturas", "AWARENESS", 35000, { leads: 5200 }, "OUTCOME_AWARENESS", null),

  // ── TikTok Ads ─────────────────────────────────────────────────────────────
  { id: "t-3001", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Leads_Paquetes", objective: "LEADS", status: "ACTIVE", conversionEvent: "Complete Registration", sourceType: "LEAD_GENERATION", dailySpend: 180000, costs: { leads: 185, conversions: 185, sales: 3400, whatsapp: 1500 } },
  { id: "t-3002", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Leads_FTTH", objective: "LEADS", status: "ACTIVE", conversionEvent: "Complete Registration", sourceType: "LEAD_GENERATION", dailySpend: 140000, costs: { leads: 205, conversions: 205, sales: 3600 } },
  { id: "t-3003", platform: "tiktok", accountId: "t-301", name: "izzi_TT_WhatsApp_Nacional", objective: "WHATSAPP", status: "ACTIVE", conversionEvent: "Click to WhatsApp", sourceType: "ENGAGEMENT", dailySpend: 120000, costs: { whatsapp: 48, leads: 700, sales: 3900 } },
  { id: "t-3004", platform: "tiktok", accountId: "t-302", name: "izzi_TT_Video_UniversalPlus", objective: "VIDEO", status: "ACTIVE", conversionEvent: null, sourceType: "VIDEO_VIEWS", dailySpend: 90000, costs: { leads: 2400 } },
  { id: "t-3005", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Conversiones_Sitio", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Place an Order", sourceType: "WEB_CONVERSIONS", dailySpend: 70000, costs: { conversions: 240, leads: 480, sales: 2900 } },

  // ── Microsoft Advertising ──────────────────────────────────────────────────
  { id: "b-4001", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Marca", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", sourceType: "SEARCH", dailySpend: 72000, costs: { conversions: 380, leads: 420, sales: 1900, calls: 1400 } },
  { id: "b-4002", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Genericas", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", sourceType: "SEARCH", dailySpend: 62000, costs: { conversions: 430, leads: 470, sales: 2300, calls: 1700 } },
  { id: "b-4003", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Competencia", objective: "LEADS", status: "ACTIVE", conversionEvent: "Lead contact", sourceType: "SEARCH", dailySpend: 40000, costs: { leads: 250, conversions: 250, sales: 3100 } },
  { id: "b-4004", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Llamadas", objective: "CALLS", status: "ACTIVE", conversionEvent: "Llamadas", sourceType: "SEARCH", dailySpend: 24000, costs: { calls: 120, conversions: 600, sales: 2800 } },
  { id: "b-4005", platform: "microsoft", accountId: "b-402", name: "izzi_Bing_Audience_Remarketing", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", sourceType: "AUDIENCE", dailySpend: 30000, costs: { conversions: 520, leads: 600, sales: 2700 } },
  { id: "b-4006", platform: "microsoft", accountId: "b-402", name: "izzi_MSAN_Paquetes", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", sourceType: "AUDIENCE", dailySpend: 22000, costs: { conversions: 560, leads: 650, sales: 3000 } },

  // ── Spotify Ads (USD) ──────────────────────────────────────────────────────
  { id: "s-5001", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Audio_Nacional", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, sourceType: "AUDIO", dailySpend: 60000, costs: { conversions: 2400 } },
  { id: "s-5002", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Podcast_UniversalPlus", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, sourceType: "PODCAST", dailySpend: 35000, costs: { conversions: 2800 } },
  { id: "s-5003", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Video_Paquetes", objective: "VIDEO", status: "ACTIVE", conversionEvent: null, sourceType: "VIDEO", dailySpend: 25000, costs: { conversions: 2200 } },

  // ── X Ads (USD) ────────────────────────────────────────────────────────────
  { id: "x-6001", platform: "x", accountId: "x-601", name: "izzi_X_Trafico_Paquetes", objective: "TRAFFIC", status: "ACTIVE", conversionEvent: null, sourceType: "WEBSITE_CLICKS", dailySpend: 45000, costs: { conversions: 900, leads: 1100 } },
  { id: "x-6002", platform: "x", accountId: "x-601", name: "izzi_X_Conversiones_Ofertas", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Pixel X (sin configurar)", sourceType: "WEBSITE_CONVERSIONS", dailySpend: 25000, costs: { conversions: null, leads: null } },
  { id: "x-6003", platform: "x", accountId: "x-601", name: "izzi_X_Alcance_Eventos", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, sourceType: "REACH", dailySpend: 20000, costs: { conversions: 3000 } },
];

/** CPM (MXN) y CTR de referencia por plataforma. */
export const DELIVERY_PROFILE: Record<PlatformId, { cpm: number; ctr: number }> = {
  google: { cpm: 175, ctr: 0.058 },
  meta: { cpm: 46, ctr: 0.012 },
  tiktok: { cpm: 31, ctr: 0.009 },
  microsoft: { cpm: 150, ctr: 0.049 },
  spotify: { cpm: 62, ctr: 0.0032 },
  x: { cpm: 36, ctr: 0.0085 },
};

/** Valor medio de una venta para calcular ingresos y ROAS (MXN). */
export const REVENUE_PER_SALE = 2400;

const ACCOUNT_BY_ID = new Map(MOCK_ACCOUNTS.map((a) => [a.id, a]));

export function mockAccount(id: string): Account | undefined {
  return ACCOUNT_BY_ID.get(id);
}

/**
 * Tipo de cambio simulado (1 USD = N MXN) por mes. Determinista y distinto cada mes para que
 * se note la conversión; en producción las tasas se capturan en Settings o vienen de BigQuery.
 */
export function mockFxRate(month: string): number {
  const [y, mo] = month.split("-").map(Number);
  const i = y * 12 + (mo - 1);
  return Math.round((18.35 + 0.32 * Math.sin(i * 1.7) + 0.12 * Math.cos(i * 0.9)) * 100) / 100;
}

export function toCampaign(seed: MockCampaignSeed): Campaign {
  return {
    id: seed.id,
    platform: seed.platform,
    accountId: seed.accountId,
    name: seed.name,
    objective: seed.objective,
    status: seed.status,
    conversionEvent: seed.conversionEvent,
    sourceType: seed.sourceType,
  };
}
