import { ApiError } from "../src/utils/errors.js";
import type { Searcher } from "../src/providers/google/audit/collect.js";

/**
 * Google Ads sintético para la auditoría: responde cada consulta GAQL según su FROM y sus campos, con
 * datos diarios deterministas. Escenario: una campaña eficiente limitada por presupuesto, una que se
 * deteriora, PMax incompleta, una campaña activa sin gasto y Demand Gen con presupuesto bajo.
 */

export const END = "2026-09-30";
export const ACCOUNT = "8779536058";
type Row = Record<string, unknown>;

const DAY = 86_400_000;
const shift = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const micros = (n: number) => String(Math.round(n * 1_000_000));
const range = (q: string) => /segments\.date BETWEEN '(\d{4}-\d{2}-\d{2})' AND '(\d{4}-\d{2}-\d{2})'/.exec(q);

/** Métricas diarias por campaña. */
export function day(
  campaign: string,
  date: string,
): { cost: number; impressions: number; clicks: number; conversions: number } | null {
  const recent = date > shift(END, -14);
  switch (campaign) {
    case "1":
      return { cost: 950, impressions: 10000, clicks: 500, conversions: 5 };
    case "2":
      return recent
        ? { cost: 700, impressions: 8000, clicks: 400, conversions: 1.5 }
        : { cost: 500, impressions: 8000, clicks: 400, conversions: 4 };
    case "3":
      return { cost: 600, impressions: 20000, clicks: 300, conversions: 3 };
    case "4":
      return date <= shift(END, -5) ? { cost: 200, impressions: 3000, clicks: 100, conversions: 1 } : null;
    case "5":
      return { cost: 1500, impressions: 100000, clicks: 800, conversions: 2 };
    default:
      return null;
  }
}

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
}

const metricsRow = (m: { cost: number; impressions: number; clicks: number; conversions: number }) => ({
  costMicros: micros(m.cost),
  impressions: String(m.impressions),
  clicks: String(m.clicks),
  conversions: m.conversions,
});

function sumRange(campaign: string, from: string, to: string) {
  const t = { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
  for (const d of dates(from, to)) {
    const m = day(campaign, d);
    if (!m) continue;
    t.cost += m.cost;
    t.impressions += m.impressions;
    t.clicks += m.clicks;
    t.conversions += m.conversions;
  }
  return t;
}

const campaign = (id: string, name: string, channel: string, extra: Row = {}): Row => ({
  campaign: {
    id,
    name,
    status: "ENABLED",
    servingStatus: "SERVING",
    primaryStatus: "ELIGIBLE",
    primaryStatusReasons: [],
    advertisingChannelType: channel,
    biddingStrategyType: "MAXIMIZE_CONVERSIONS",
    biddingStrategySystemStatus: "ENABLED",
    startDateTime: "2026-01-01 00:00:00",
    endDateTime: "2037-12-30 23:59:59",
    ...((extra.campaign as Row) ?? {}),
  },
  campaignBudget: {
    resourceName: `customers/${ACCOUNT}/campaignBudgets/90${id}`,
    amountMicros: micros(1000),
    period: "DAILY",
    explicitlyShared: false,
    ...((extra.campaignBudget as Row) ?? {}),
  },
});

export const CAMPAIGNS: Row[] = [
  campaign("1", "Search Marca", "SEARCH", {
    campaign: {
      primaryStatus: "LIMITED",
      primaryStatusReasons: ["BUDGET_CONSTRAINED"],
      maximizeConversions: { targetCpaMicros: micros(300) },
    },
  }),
  campaign("2", "Search Genérica", "SEARCH", { campaignBudget: { amountMicros: micros(900) } }),
  campaign("3", "PMax Ofertas", "PERFORMANCE_MAX", {
    campaign: {
      assetAutomationSettings: [
        { assetAutomationType: "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION", assetAutomationStatus: "OPTED_IN" },
      ],
    },
    campaignBudget: { amountMicros: micros(700) },
  }),
  campaign("4", "Search Respaldo", "SEARCH", { campaignBudget: { amountMicros: micros(300) } }),
  campaign("5", "Demand Gen Prospección", "DEMAND_GEN", {
    campaign: { biddingStrategyType: "TARGET_CPA", targetCpa: { targetCpaMicros: micros(500) } },
    campaignBudget: { amountMicros: micros(2000) },
  }),
];

const text = (t: string, pinned?: string) => ({ text: t, ...(pinned ? { pinnedField: pinned } : {}) });

export interface FixtureOptions {
  /** Consultas que fallan con el error indicado (por coincidencia de texto). */
  fail?: Array<{ match: string; error: ApiError }>;
  /** Registro de consultas recibidas. */
  log?: string[];
}

export function fakeGoogle(opts: FixtureOptions = {}): Searcher {
  return {
    async search(id, query) {
      opts.log?.push(query);
      for (const f of opts.fail ?? []) if (query.includes(f.match)) throw f.error;
      if (id !== ACCOUNT)
        throw new ApiError("ACCESS_DENIED", "sin acceso", {
          details: { google_error_codes: ["USER_PERMISSION_DENIED"] },
        });
      return respond(query);
    },
  };
}

function respond(q: string): Row[] {
  const r = range(q);
  const from = r?.[1] ?? "",
    to = r?.[2] ?? "";
  const ids = ["1", "2", "3", "4", "5"];
  if (/FROM customer$/.test(q))
    return [
      {
        customer: {
          id: ACCOUNT,
          descriptiveName: "izzi – Performance AO - mxn",
          currencyCode: "MXN",
          timeZone: "America/Mexico_City",
          optimizationScore: 0.72,
          autoTaggingEnabled: false,
          conversionTrackingSetting: {
            conversionTrackingStatus: "CONVERSION_TRACKING_MANAGED_BY_SELF",
            acceptedCustomerDataTerms: false,
            enhancedConversionsForLeadsEnabled: false,
          },
        },
      },
    ];
  if (q.includes("FROM bidding_strategy")) return [];
  if (q.includes("FROM campaign WHERE campaign.status != 'REMOVED'")) return CAMPAIGNS;
  if (q.includes("FROM ad_group WHERE"))
    return [
      { campaign: { id: "1" }, adGroup: { id: "11" } },
      { campaign: { id: "1" }, adGroup: { id: "12" } },
      { campaign: { id: "2" }, adGroup: { id: "21" } },
    ];
  if (q.includes("FROM campaign WHERE segments.date") && q.includes("segments.conversion_action_name"))
    return ids.flatMap((c) =>
      dates(from, to).flatMap((d) => {
        if (!day(c, d)) return [];
        const recent = d > shift(END, -14);
        const rows: Row[] = [];
        const add = (name: string, category: string, n: number) =>
          n > 0 &&
          rows.push({
            campaign: { id: c },
            segments: { date: d, conversionActionName: name, conversionActionCategory: category },
            metrics: { conversions: n, allConversions: n },
          });
        if (c === "1") {
          add("MCC_Offline_Purchase", "PURCHASE", 2);
          add("MCC_Offline_Lead_Contact", "IMPORTED_LEAD", 3);
          if (d >= shift(END, -59) && d <= shift(END, -30)) add("Formulario web", "SUBMIT_LEAD_FORM", 0.5);
        }
        if (c === "2") {
          add("MCC_Offline_Purchase", "PURCHASE", recent ? 0.5 : 1);
          add("MCC_Offline_Lead_Contact", "IMPORTED_LEAD", recent ? 1 : 3);
        }
        if (c === "3") add("Page view home", "PAGE_VIEW", 3);
        return rows;
      }),
    );
  if (q.includes("metrics.search_impression_share"))
    return ["1", "2", "4"].map((c) => ({
      campaign: { id: c },
      metrics: {
        searchImpressionShare: c === "1" ? 0.6 : 0.0999,
        searchBudgetLostImpressionShare: c === "1" ? 0.35 : 0,
        searchRankLostImpressionShare: c === "1" ? 0.05 : 0.4,
        searchTopImpressionShare: 0.5,
        searchAbsoluteTopImpressionShare: 0.2,
      },
    }));
  if (q.includes("FROM campaign WHERE segments.date") && q.includes("segments.date,"))
    return ids.flatMap((c) =>
      dates(from, to).flatMap((d) => {
        const m = day(c, d);
        return m
          ? [
              {
                campaign: { id: c },
                segments: { date: d },
                metrics: {
                  ...metricsRow(m),
                  interactions: String(m.clicks),
                  conversionsValue: 0,
                  allConversions: m.conversions,
                  phoneCalls: "0",
                },
              },
            ]
          : [];
      }),
    );
  if (q.includes("FROM conversion_action"))
    return [
      ["1", "MCC_Offline_Purchase", "UPLOAD_CLICKS", "PURCHASE"],
      ["2", "MCC_Offline_Lead_Contact", "UPLOAD_CLICKS", "IMPORTED_LEAD"],
      ["3", "Page view home", "WEBPAGE", "PAGE_VIEW"],
      ["4", "Formulario web", "WEBPAGE", "SUBMIT_LEAD_FORM"],
    ].map(([i, name, type, category]) => ({
      conversionAction: {
        id: i,
        name,
        status: "ENABLED",
        type,
        category,
        origin: "WEBSITE",
        primaryForGoal: true,
        includeInConversionsMetric: true,
        countingType: "ONE_PER_CLICK",
        clickThroughLookbackWindowDays: "30",
        attributionModelSettings: { attributionModel: "GOOGLE_ADS_LAST_CLICK" },
        ownerCustomer: `customers/${ACCOUNT}`,
      },
    }));
  if (q.includes("FROM customer_conversion_goal"))
    return [{ customerConversionGoal: { category: "PURCHASE", origin: "WEBSITE", biddable: true } }];
  if (q.includes("FROM campaign_conversion_goal") || q.includes("FROM conversion_goal_campaign_config")) return [];
  if (q.includes("FROM search_term_view"))
    return [
      ["2", "21", "vacantes izzi", 300, 25, 0],
      ["2", "21", "bolsa de trabajo izzi", 120, 10, 0],
      ["1", "11", "pagar recibo izzi", 200, 30, 0],
      ["2", "21", "izzi internet 100 megas", 400, 50, 5],
      ["1", "11", "internet izzi", 900, 100, 6],
      ["1", "11", "izzi vs totalplay", 80, 8, 0],
    ].map(([c, ag, term, cost, clicks, conv]) => ({
      campaign: { id: c },
      adGroup: { id: ag },
      searchTermView: { searchTerm: term, status: "NONE" },
      segments: { searchTermMatchType: "BROAD" },
      metrics: {
        costMicros: micros(cost as number),
        impressions: String((clicks as number) * 10),
        clicks: String(clicks),
        conversions: conv,
      },
    }));
  if (q.includes("FROM campaign_search_term_view"))
    return [
      {
        campaign: { id: "3" },
        campaignSearchTermView: { searchTerm: "empleos izzi" },
        metrics: { impressions: "500", clicks: "20", conversions: 0, costMicros: micros(60) },
      },
    ];
  if (q.includes("FROM ad_group_criterion"))
    return [
      ["1", "11", "AG Marca 1", "1001", "internet izzi", "EXACT", 4, "BELOW_AVERAGE"],
      ["1", "12", "AG Marca 2", "1002", "internet izzi", "EXACT", 5, "BELOW_AVERAGE"],
      ["1", "12", "AG Marca 2", "1003", "paquetes izzi", "PHRASE", 3, "BELOW_AVERAGE"],
      ["2", "21", "AG Gen", "2001", "internet en casa", "BROAD", null, null],
    ].map(([c, ag, agName, crit, kw, match, qs, lp]) => ({
      campaign: { id: c },
      adGroup: { id: ag, name: agName },
      adGroupCriterion: {
        criterionId: crit,
        keyword: { text: kw, matchType: match },
        systemServingStatus: crit === "2001" ? "RARELY_SERVED" : "ELIGIBLE",
        approvalStatus: "APPROVED",
        qualityInfo:
          qs === null
            ? {}
            : {
                qualityScore: qs,
                creativeQualityScore: "AVERAGE",
                postClickQualityScore: lp,
                searchPredictedCtr: "AVERAGE",
              },
      },
    }));
  if (q.includes("FROM keyword_view"))
    return [
      ["11", "1001", 3000],
      ["12", "1002", 2000],
      ["12", "1003", 1500],
    ].map(([ag, crit, cost]) => ({
      adGroup: { id: ag },
      adGroupCriterion: { criterionId: crit },
      metrics: { costMicros: micros(cost as number), impressions: "5000", clicks: "200", conversions: 10 },
    }));
  if (q.includes("FROM ad_group_ad") && q.includes("responsive_search_ad"))
    return [
      {
        campaign: { id: "1" },
        adGroup: { id: "11", name: "AG Marca 1" },
        adGroupAd: {
          ad: {
            id: "111",
            type: "RESPONSIVE_SEARCH_AD",
            finalUrls: ["https://www.izzi.mx/"],
            responsiveSearchAd: {
              headlines: [
                text("izzi Internet", "HEADLINE_1"),
                text("Internet en casa"),
                text("Internet en casa"),
                text("Paquetes izzi"),
                text("Fibra óptica"),
                text("WiFi rápido"),
                text("TV y más"),
                text("Planes desde $349"),
              ],
              descriptions: [
                text("Internet de alta velocidad para tu hogar."),
                text("Fibra óptica en tu colonia."),
                text("Planes con TV incluidos."),
              ],
            },
          },
          adStrength: "AVERAGE",
          policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED", policyTopicEntries: [] },
        },
      },
      {
        campaign: { id: "1" },
        adGroup: { id: "12", name: "AG Marca 2" },
        adGroupAd: {
          ad: {
            id: "121",
            type: "RESPONSIVE_SEARCH_AD",
            finalUrls: ["https://www.izzi.mx/paquetes"],
            responsiveSearchAd: {
              headlines: Array.from({ length: 15 }, (_, i) => text(`Título distinto ${i}`)),
              descriptions: [
                text("Contrata hoy tu paquete."),
                text("Llama y cambia hoy."),
                text("Aprovecha la oferta."),
                text("Conoce los planes."),
              ],
            },
          },
          adStrength: "EXCELLENT",
          policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED", policyTopicEntries: [] },
        },
      },
      {
        campaign: { id: "2" },
        adGroup: { id: "21", name: "AG Gen" },
        adGroupAd: {
          ad: {
            id: "211",
            type: "RESPONSIVE_SEARCH_AD",
            finalUrls: ["https://www.izzi.mx/paquetes-viejos"],
            responsiveSearchAd: { headlines: [text("Internet")], descriptions: [text("Contrata ya.")] },
          },
          adStrength: "POOR",
          policySummary: {
            approvalStatus: "DISAPPROVED",
            reviewStatus: "REVIEWED",
            policyTopicEntries: [{ topic: "DESTINATION_NOT_WORKING", type: "PROHIBITED" }],
          },
        },
      },
    ];
  if (q.includes("FROM ad_group_ad"))
    return [
      {
        adGroup: { id: "11" },
        adGroupAd: { ad: { id: "111" } },
        metrics: metricsRow({ cost: 5000, impressions: 40000, clicks: 2000, conversions: 20 }),
      },
      {
        adGroup: { id: "21" },
        adGroupAd: { ad: { id: "211" } },
        metrics: metricsRow({ cost: 800, impressions: 4000, clicks: 200, conversions: 1 }),
      },
    ];
  if (q.includes("FROM customer_asset"))
    return [
      {
        customerAsset: { fieldType: "STRUCTURED_SNIPPET", primaryStatus: "ELIGIBLE" },
        asset: { id: "a1", type: "STRUCTURED_SNIPPET", policySummary: { approvalStatus: "APPROVED" } },
      },
      {
        customerAsset: { fieldType: "CALLOUT", primaryStatus: "NOT_ELIGIBLE" },
        asset: {
          id: "a2",
          type: "CALLOUT",
          policySummary: { approvalStatus: "DISAPPROVED" },
          calloutAsset: { calloutText: "El mejor internet" },
        },
      },
    ];
  if (q.includes("FROM campaign_asset"))
    return [
      {
        campaign: { id: "1" },
        campaignAsset: { fieldType: "SITELINK", primaryStatus: "ELIGIBLE" },
        asset: {
          id: "s1",
          type: "SITELINK",
          policySummary: { approvalStatus: "APPROVED" },
          sitelinkAsset: { linkText: "Paquetes" },
        },
      },
      {
        campaign: { id: "1" },
        campaignAsset: { fieldType: "SITELINK", primaryStatus: "ELIGIBLE" },
        asset: {
          id: "s2",
          type: "SITELINK",
          policySummary: { approvalStatus: "APPROVED" },
          sitelinkAsset: { linkText: "Promo septiembre 2025", endDate: "2025-09-30" },
        },
      },
    ];
  if (q.includes("FROM ad_group_asset")) return [];
  if (q.includes("FROM asset_group_asset"))
    return [
      ...Array.from({ length: 5 }, () => "HEADLINE"),
      "LONG_HEADLINE",
      "DESCRIPTION",
      "DESCRIPTION",
      "BUSINESS_NAME",
      "LOGO",
      "MARKETING_IMAGE",
      "SQUARE_MARKETING_IMAGE",
    ].map((field) => ({
      assetGroup: { id: "31" },
      assetGroupAsset: { fieldType: field, source: "ADVERTISER", primaryStatus: "ELIGIBLE" },
      asset: { policySummary: { approvalStatus: "APPROVED" } },
    }));
  if (q.includes("FROM asset_group_signal")) return [];
  if (q.includes("FROM asset_group WHERE segments.date"))
    return [{ assetGroup: { id: "31" }, metrics: metricsRow(sumRange("3", from, to)) }];
  if (q.includes("FROM asset_group"))
    return [
      {
        assetGroup: {
          id: "31",
          campaign: `customers/${ACCOUNT}/campaigns/3`,
          name: "AG Ofertas",
          status: "ENABLED",
          primaryStatus: "ELIGIBLE",
          primaryStatusReasons: [],
          adStrength: "AVERAGE",
          finalUrls: ["https://www.izzi.mx/ofertas"],
        },
      },
    ];
  if (q.includes("FROM user_location_view"))
    return [
      ["1", "geoTargetConstants/20001", 15000, 100],
      ["1", "geoTargetConstants/20002", 9000, 2],
      ["2", "geoTargetConstants/20003", 20000, 120],
    ].map(([c, region, cost, conv]) => ({
      campaign: { id: c },
      segments: { geoTargetRegion: region },
      metrics: metricsRow({ cost: cost as number, impressions: 10000, clicks: 1000, conversions: conv as number }),
    }));
  if (q.includes("FROM geo_target_constant"))
    return [
      ["geoTargetConstants/20001", "Jalisco"],
      ["geoTargetConstants/20002", "Chiapas"],
      ["geoTargetConstants/20003", "Ciudad de México"],
    ].map(([resourceName, name]) => ({ geoTargetConstant: { resourceName, name } }));
  if (q.includes("segments.device"))
    return [
      {
        campaign: { id: "1" },
        segments: { device: "MOBILE" },
        metrics: metricsRow({ cost: 30000, impressions: 100000, clicks: 3000, conversions: 60 }),
      },
      {
        campaign: { id: "1" },
        segments: { device: "DESKTOP" },
        metrics: metricsRow({ cost: 14000, impressions: 40000, clicks: 1000, conversions: 160 }),
      },
    ];
  if (q.includes("segments.ad_network_type"))
    return [
      {
        campaign: { id: "1" },
        segments: { adNetworkType: "SEARCH" },
        metrics: metricsRow({ cost: 24500, impressions: 250000, clicks: 13000, conversions: 150 }),
      },
      {
        campaign: { id: "1" },
        segments: { adNetworkType: "SEARCH_PARTNERS" },
        metrics: metricsRow({ cost: 4000, impressions: 50000, clicks: 2000, conversions: 0 }),
      },
    ];
  if (q.includes("segments.day_of_week"))
    return [
      {
        campaign: { id: "1" },
        segments: { dayOfWeek: "MONDAY", hour: 10 },
        metrics: { costMicros: micros(10000), clicks: "500", conversions: 50 },
      },
      {
        campaign: { id: "1" },
        segments: { dayOfWeek: "SUNDAY", hour: 2 },
        metrics: { costMicros: micros(3000), clicks: "200", conversions: 1 },
      },
    ];
  if (q.includes("FROM landing_page_view"))
    return [
      ["https://www.izzi.mx/", 10000, 800, 40, 7],
      ["https://www.izzi.mx/empleo/vacantes", 800, 60, 0, 5],
      ["https://www.izzi.mx/paquetes-viejos", 500, 40, 0, 3],
    ].map(([url, cost, clicks, conv, speed]) => ({
      landingPageView: { unexpandedFinalUrl: url },
      metrics: {
        costMicros: micros(cost as number),
        clicks: String(clicks),
        conversions: conv,
        speedScore: String(speed),
        mobileFriendlyClicksPercentage: 1,
      },
    }));
  if (q.includes("FROM detail_placement_view"))
    return [
      {
        campaign: { id: "5" },
        detailPlacementView: {
          displayName: "Candy Puzzle Games",
          placement: "mobileapp::2-123",
          placementType: "MOBILE_APPLICATION",
        },
        metrics: metricsRow({ cost: 900, impressions: 50000, clicks: 300, conversions: 0 }),
      },
    ];
  if (q.includes("metrics.unique_users"))
    return [{ campaign: { id: "5" }, metrics: { uniqueUsers: "40000", averageImpressionFrequencyPerUser: 3.2 } }];
  if (q.includes("FROM change_event"))
    return [
      {
        changeEvent: {
          changeDateTime: `${shift(END, -2)} 10:00:00.000000`,
          changeResourceType: "CAMPAIGN_BUDGET",
          changeResourceName: `customers/${ACCOUNT}/campaignBudgets/901`,
          resourceChangeOperation: "UPDATE",
          changedFields: "amountMicros",
          clientType: "GOOGLE_ADS_WEB_CLIENT",
          oldResource: { campaignBudget: { amountMicros: micros(800) } },
          newResource: { campaignBudget: { amountMicros: micros(1000) } },
        },
      },
    ];
  if (q.includes("FROM recommendation"))
    return [
      { recommendation: { type: "SITELINK_ASSET", campaign: `customers/${ACCOUNT}/campaigns/1`, dismissed: false } },
      {
        recommendation: {
          type: "DISPLAY_EXPANSION_OPT_IN",
          campaign: `customers/${ACCOUNT}/campaigns/2`,
          dismissed: false,
        },
      },
      { recommendation: { type: "CAMPAIGN_BUDGET", campaign: `customers/${ACCOUNT}/campaigns/1`, dismissed: false } },
    ];
  return [];
}
