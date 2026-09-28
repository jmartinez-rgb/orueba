import type { Account, BaseMetric, Campaign, CampaignObjective, CampaignStatus, PlatformId } from "@/lib/types";

/**
 * Catálogo simulado: cuentas y campañas con nombres realistas, inversión diaria base (MXN)
 * y costo por resultado de referencia. Solo se usa en MOCK MODE.
 */

export interface MockCampaignSeed {
  id: string;
  platform: PlatformId;
  accountId: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  conversionEvent: string | null;
  /** Inversión diaria base en MXN. */
  dailySpend: number;
  /** Costo por unidad de cada resultado (MXN). Métrica ausente = 0 reportado; `null` = no se reporta (NULL). */
  costs: Partial<Record<BaseMetric, number | null>>;
}

export const MOCK_ACCOUNTS: Account[] = [
  { id: "g-101", platform: "google", name: "izzi | Search Nacional", currency: "MXN" },
  { id: "g-102", platform: "google", name: "izzi | PMax y Display", currency: "MXN" },
  { id: "m-201", platform: "meta", name: "MXN - IZZI WHATSAPP", currency: "MXN" },
  { id: "m-202", platform: "meta", name: "MXN - IZZI VENTAS", currency: "MXN" },
  { id: "m-203", platform: "meta", name: "MXN - IZZI MARCA", currency: "MXN" },
  { id: "t-301", platform: "tiktok", name: "izzi TikTok Performance", currency: "MXN" },
  { id: "t-302", platform: "tiktok", name: "izzi TikTok Branding", currency: "MXN" },
  { id: "b-401", platform: "microsoft", name: "izzi Bing Search", currency: "MXN" },
  { id: "b-402", platform: "microsoft", name: "izzi Bing Audience", currency: "MXN" },
  { id: "s-501", platform: "spotify", name: "izzi Spotify Audio", currency: "MXN" },
  { id: "x-601", platform: "x", name: "izzi X Ads", currency: "MXN" },
];

const G_SALE = "MCC_Offline_Purchase";
const G_LEAD = "MCC_Offline_Lead_Contact";
const M_INBOUND = "Compras Offline Web (Inbound)";
const M_OFB = "On-Facebook Purchase";

export const MOCK_CAMPAIGNS: MockCampaignSeed[] = [
  // Google Ads
  { id: "g-1001", platform: "google", accountId: "g-101", name: "izzi_Search_Marca_Nacional", objective: "SALES", status: "ACTIVE", conversionEvent: G_SALE, dailySpend: 420000, costs: { sales: 1250, leads: 260, calls: 520 } },
  { id: "g-1002", platform: "google", accountId: "g-101", name: "izzi_Search_Genericas_Internet", objective: "SALES", status: "ACTIVE", conversionEvent: G_SALE, dailySpend: 380000, costs: { sales: 1650, leads: 310, calls: 700 } },
  { id: "g-1003", platform: "google", accountId: "g-101", name: "izzi_Search_Competencia", objective: "LEADS", status: "ACTIVE", conversionEvent: G_LEAD, dailySpend: 180000, costs: { sales: 2400, leads: 290, calls: 900 } },
  { id: "g-1004", platform: "google", accountId: "g-101", name: "izzi_Search_Llamadas_800", objective: "CALLS", status: "ACTIVE", conversionEvent: "Calls from ads", dailySpend: 140000, costs: { sales: 2100, leads: 700, calls: 165 } },
  { id: "g-1005", platform: "google", accountId: "g-102", name: "izzi_PMax_Paquetes_Nacional", objective: "SALES", status: "ACTIVE", conversionEvent: G_SALE, dailySpend: 520000, costs: { sales: 1450, leads: 280, calls: 1100 } },
  { id: "g-1006", platform: "google", accountId: "g-102", name: "izzi_PMax_Ofertas_FTTH", objective: "SALES", status: "ACTIVE", conversionEvent: G_SALE, dailySpend: 300000, costs: { sales: 1550, leads: 300, calls: 1200 } },
  { id: "g-1007", platform: "google", accountId: "g-102", name: "izzi_Display_Remarketing", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: G_LEAD, dailySpend: 120000, costs: { sales: 2600, leads: 330 } },
  { id: "g-1008", platform: "google", accountId: "g-102", name: "izzi_YouTube_Awareness_UniversalPlus", objective: "VIDEO", status: "ACTIVE", conversionEvent: null, dailySpend: 140000, costs: { sales: 9000, leads: 1800 } },
  { id: "g-1009", platform: "google", accountId: "g-101", name: "izzi_Search_BuenFin_2025", objective: "SALES", status: "PAUSED", conversionEvent: G_SALE, dailySpend: 0, costs: { sales: 1500, leads: 300 } },

  // Meta Ads
  { id: "m-2001", platform: "meta", accountId: "m-201", name: "IZZI_MSG_WhatsApp_Nacional", objective: "WHATSAPP", status: "ACTIVE", conversionEvent: M_INBOUND, dailySpend: 650000, costs: { whatsapp: 62, sales: 1500, leads: 900, purchases: 9000 } },
  { id: "m-2002", platform: "meta", accountId: "m-201", name: "IZZI_MSG_WhatsApp_CDMX", objective: "WHATSAPP", status: "ACTIVE", conversionEvent: M_INBOUND, dailySpend: 380000, costs: { whatsapp: 58, sales: 1400, leads: 850, purchases: 9500 } },
  { id: "m-2003", platform: "meta", accountId: "m-201", name: "IZZI_MSG_WhatsApp_Monterrey", objective: "WHATSAPP", status: "ACTIVE", conversionEvent: M_INBOUND, dailySpend: 260000, costs: { whatsapp: 66, sales: 1600, leads: 950, purchases: 9800 } },
  { id: "m-2004", platform: "meta", accountId: "m-201", name: "IZZI_CAPI WhatsApp_Nacional", objective: "PURCHASES", status: "ACTIVE", conversionEvent: M_OFB, dailySpend: 480000, costs: { whatsapp: 74, purchases: 1180, sales: 4800 } },
  { id: "m-2005", platform: "meta", accountId: "m-201", name: "IZZI_CAPI WhatsApp_Guadalajara", objective: "PURCHASES", status: "ACTIVE", conversionEvent: M_OFB, dailySpend: 210000, costs: { whatsapp: 71, purchases: 1250, sales: 5200 } },
  { id: "m-2006", platform: "meta", accountId: "m-202", name: "IZZI_Venta_Sitio_Paquetes", objective: "SALES", status: "ACTIVE", conversionEvent: M_INBOUND, dailySpend: 420000, costs: { sales: 1580, leads: 420, whatsapp: 900 } },
  { id: "m-2007", platform: "meta", accountId: "m-202", name: "IZZI_Venta_Sitio_Ofertas", objective: "SALES", status: "ACTIVE", conversionEvent: M_INBOUND, dailySpend: 160000, costs: { sales: 1700, leads: 450, whatsapp: 1000 } },
  { id: "m-2008", platform: "meta", accountId: "m-202", name: "IZZI_Leads_Formulario_FTTH", objective: "LEADS", status: "ACTIVE", conversionEvent: "Lead (formulario instantáneo)", dailySpend: 190000, costs: { leads: 215, sales: 3200 } },
  { id: "m-2009", platform: "meta", accountId: "m-203", name: "IZZI_Alcance_UniversalPlus", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, dailySpend: 150000, costs: { leads: 5000 } },
  { id: "m-2010", platform: "meta", accountId: "m-203", name: "IZZI_Seguidores_izzi_Sky", objective: "ENGAGEMENT", status: "ENDED", conversionEvent: null, dailySpend: 0, costs: {} },

  // TikTok Ads
  { id: "t-3001", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Leads_Paquetes", objective: "LEADS", status: "ACTIVE", conversionEvent: "Complete Registration", dailySpend: 180000, costs: { leads: 185, conversions: 185, sales: 3400, whatsapp: 1500 } },
  { id: "t-3002", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Leads_FTTH", objective: "LEADS", status: "ACTIVE", conversionEvent: "Complete Registration", dailySpend: 140000, costs: { leads: 205, conversions: 205, sales: 3600 } },
  { id: "t-3003", platform: "tiktok", accountId: "t-301", name: "izzi_TT_WhatsApp_Nacional", objective: "WHATSAPP", status: "ACTIVE", conversionEvent: "Click to WhatsApp", dailySpend: 120000, costs: { whatsapp: 48, leads: 700, sales: 3900 } },
  { id: "t-3004", platform: "tiktok", accountId: "t-302", name: "izzi_TT_Video_UniversalPlus", objective: "VIDEO", status: "ACTIVE", conversionEvent: null, dailySpend: 90000, costs: { leads: 2400 } },
  { id: "t-3005", platform: "tiktok", accountId: "t-301", name: "izzi_TT_Conversiones_Sitio", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Place an Order", dailySpend: 70000, costs: { conversions: 240, leads: 480, sales: 2900 } },

  // Microsoft Advertising
  { id: "b-4001", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Marca", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", dailySpend: 72000, costs: { conversions: 380, leads: 420, sales: 1900, calls: 1400 } },
  { id: "b-4002", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Genericas", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", dailySpend: 62000, costs: { conversions: 430, leads: 470, sales: 2300, calls: 1700 } },
  { id: "b-4003", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Competencia", objective: "LEADS", status: "ACTIVE", conversionEvent: "Lead contact", dailySpend: 40000, costs: { leads: 250, conversions: 250, sales: 3100 } },
  { id: "b-4004", platform: "microsoft", accountId: "b-401", name: "izzi_Bing_Llamadas", objective: "CALLS", status: "ACTIVE", conversionEvent: "Llamadas", dailySpend: 24000, costs: { calls: 120, conversions: 600, sales: 2800 } },
  { id: "b-4005", platform: "microsoft", accountId: "b-402", name: "izzi_Bing_Audience_Remarketing", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", dailySpend: 30000, costs: { conversions: 520, leads: 600, sales: 2700 } },
  { id: "b-4006", platform: "microsoft", accountId: "b-402", name: "izzi_MSAN_Paquetes", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Compra offline", dailySpend: 22000, costs: { conversions: 560, leads: 650, sales: 3000 } },

  // Spotify Ads
  { id: "s-5001", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Audio_Nacional", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, dailySpend: 60000, costs: { conversions: 2400 } },
  { id: "s-5002", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Podcast_UniversalPlus", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, dailySpend: 35000, costs: { conversions: 2800 } },
  { id: "s-5003", platform: "spotify", accountId: "s-501", name: "izzi_Spotify_Video_Paquetes", objective: "VIDEO", status: "ACTIVE", conversionEvent: null, dailySpend: 25000, costs: { conversions: 2200 } },

  // X Ads
  { id: "x-6001", platform: "x", accountId: "x-601", name: "izzi_X_Trafico_Paquetes", objective: "TRAFFIC", status: "ACTIVE", conversionEvent: null, dailySpend: 45000, costs: { conversions: 900, leads: 1100 } },
  { id: "x-6002", platform: "x", accountId: "x-601", name: "izzi_X_Conversiones_Ofertas", objective: "CONVERSIONS", status: "ACTIVE", conversionEvent: "Pixel X (sin configurar)", dailySpend: 25000, costs: { conversions: null, leads: null } },
  { id: "x-6003", platform: "x", accountId: "x-601", name: "izzi_X_Alcance_Eventos", objective: "AWARENESS", status: "ACTIVE", conversionEvent: null, dailySpend: 20000, costs: { conversions: 3000 } },
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

export function toCampaign(seed: MockCampaignSeed): Campaign {
  return {
    id: seed.id,
    platform: seed.platform,
    accountId: seed.accountId,
    name: seed.name,
    objective: seed.objective,
    status: seed.status,
    conversionEvent: seed.conversionEvent,
  };
}
