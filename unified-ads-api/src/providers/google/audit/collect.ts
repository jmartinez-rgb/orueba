import { isApiError } from "../../../utils/errors.js";
import { todayIn } from "../../../normalization/budgets.js";
import { googleNumber } from "../types.js";
import { auditWindows, dailyStart, Q, shiftDate, windowOf } from "./queries.js";
import type {
  ActionDailyRow,
  AdRow,
  AssetGroupAssetRow,
  AssetGroupRow,
  AssetLink,
  AuditData,
  AuditTarget,
  CampaignInfo,
  ChangeRow,
  ConversionActionInfo,
  CustomerInfo,
  DailyRow,
  DateWindow,
  KeywordRow,
  SegmentRow,
  TextAsset,
  UrlCheck,
  WindowKey,
} from "./types.js";

type Row = Record<string, unknown>;

/** Lo único que la auditoría necesita del cliente de Google Ads: consultas GAQL de lectura. */
export interface Searcher {
  search(id: string, query: string, signal: AbortSignal): Promise<Row[]>;
}

export interface CollectOptions {
  /** Último día completo a analizar (AAAA-MM-DD). Por omisión, ayer en el huso de la cuenta. */
  end?: string;
  now?: Date;
  /** Tiempo máximo por consulta. */
  timeoutMs?: number;
  concurrency?: number;
  /** Revisión HTTP de las páginas de destino (inyectable; se omite si no se proporciona). */
  checkUrls?: (urls: string[]) => Promise<UrlCheck[]>;
  onProgress?: (message: string) => void;
}

export const LIMITS = { searchTerms: 10000, pmaxTerms: 5000, keywords: 50000, ads: 20000, changes: 5000 };

/** Lee un campo anidado de la respuesta REST (camelCase) por ruta con puntos. */
export function pick(row: unknown, path: string): unknown {
  let node: unknown = row;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Row)[key];
  }
  return node;
}
const str = (row: unknown, path: string): string | null => {
  const v = pick(row, path);
  return typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null;
};
const num = (row: unknown, path: string): number => googleNumber(pick(row, path)) ?? 0;
const numOrNull = (row: unknown, path: string): number | null => googleNumber(pick(row, path));
const money = (row: unknown, path: string): number => num(row, path) / 1_000_000;
const moneyOrNull = (row: unknown, path: string): number | null => {
  const v = numOrNull(row, path);
  return v === null || v <= 0 ? null : v / 1_000_000;
};
const bool = (row: unknown, path: string): boolean | null => {
  const v = pick(row, path);
  return typeof v === "boolean" ? v : null;
};
const list = (row: unknown, path: string): unknown[] => {
  const v = pick(row, path);
  return Array.isArray(v) ? v : [];
};
const lastId = (resource: string | null): string | null => (resource ? (resource.split("/").pop() ?? null) : null);

/** Motivo seguro para el reporte: código normalizado y códigos de Google, nunca el cuerpo. */
export function failureReason(error: unknown): string {
  if (!isApiError(error)) return "Error inesperado al consultar Google Ads.";
  const details = error.details && typeof error.details === "object" ? (error.details as Row) : {};
  const codes = Array.isArray(details.google_error_codes) ? details.google_error_codes.join(", ") : "";
  return `${error.code}${codes ? ` (${codes})` : ""}`;
}

/** Errores que invalidan toda la lectura: no tiene sentido seguir con otras secciones. */
const fatal = (error: unknown) =>
  isApiError(error) && (error.code === "AUTH_ERROR" || error.code === "ACCESS_REQUIRED");

async function pool<T>(tasks: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

function metricsOf(row: Row) {
  return {
    cost: money(row, "metrics.costMicros"),
    impressions: num(row, "metrics.impressions"),
    clicks: num(row, "metrics.clicks"),
    conversions: num(row, "metrics.conversions"),
  };
}

function parseCustomer(row: Row): CustomerInfo {
  return {
    id: str(row, "customer.id") ?? "",
    name: str(row, "customer.descriptiveName") ?? "",
    currency: str(row, "customer.currencyCode") ?? "",
    timeZone: str(row, "customer.timeZone"),
    optimizationScore: numOrNull(row, "customer.optimizationScore"),
    autoTagging: bool(row, "customer.autoTaggingEnabled"),
    trackingStatus: str(row, "customer.conversionTrackingSetting.conversionTrackingStatus"),
    acceptedTerms: bool(row, "customer.conversionTrackingSetting.acceptedCustomerDataTerms"),
    enhancedLeads: bool(row, "customer.conversionTrackingSetting.enhancedConversionsForLeadsEnabled"),
  };
}

export function parseCampaign(
  row: Row,
  portfolios: Map<string, { cpa: number | null; roas: number | null }>,
): CampaignInfo {
  const automation = list(row, "campaign.assetAutomationSettings");
  const expansion = automation.find(
    (a) => pick(a, "assetAutomationType") === "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
  );
  const portfolio = str(row, "campaign.biddingStrategy");
  const fromPortfolio = portfolio ? portfolios.get(portfolio) : undefined;
  const period = str(row, "campaignBudget.period");
  return {
    id: str(row, "campaign.id") ?? "",
    name: str(row, "campaign.name") ?? "",
    status: str(row, "campaign.status") ?? "UNKNOWN",
    servingStatus: str(row, "campaign.servingStatus"),
    primaryStatus: str(row, "campaign.primaryStatus"),
    reasons: list(row, "campaign.primaryStatusReasons").filter((r): r is string => typeof r === "string"),
    channel: str(row, "campaign.advertisingChannelType") ?? "UNKNOWN",
    subChannel: str(row, "campaign.advertisingChannelSubType"),
    bidding: str(row, "campaign.biddingStrategyType"),
    biddingStatus: str(row, "campaign.biddingStrategySystemStatus"),
    portfolio,
    targetCpa:
      moneyOrNull(row, "campaign.targetCpa.targetCpaMicros") ??
      moneyOrNull(row, "campaign.maximizeConversions.targetCpaMicros") ??
      fromPortfolio?.cpa ??
      null,
    targetRoas:
      numOrNull(row, "campaign.targetRoas.targetRoas") ??
      numOrNull(row, "campaign.maximizeConversionValue.targetRoas") ??
      fromPortfolio?.roas ??
      null,
    optimizationScore: numOrNull(row, "campaign.optimizationScore"),
    start: str(row, "campaign.startDateTime")?.slice(0, 10) ?? null,
    end: str(row, "campaign.endDateTime")?.slice(0, 10) ?? null,
    searchNetwork: bool(row, "campaign.networkSettings.targetSearchNetwork"),
    partners: bool(row, "campaign.networkSettings.targetPartnerSearchNetwork"),
    display: bool(row, "campaign.networkSettings.targetContentNetwork"),
    merchantId: str(row, "campaign.shoppingSetting.merchantId"),
    finalUrlExpansion: expansion ? pick(expansion, "assetAutomationStatus") === "OPTED_IN" : null,
    budget: period === "CUSTOM_PERIOD" ? null : moneyOrNull(row, "campaignBudget.amountMicros"),
    budgetTotal: period === "CUSTOM_PERIOD" ? moneyOrNull(row, "campaignBudget.totalAmountMicros") : null,
    budgetPeriod: period,
    budgetShared: bool(row, "campaignBudget.explicitlyShared") === true,
    budgetId: lastId(str(row, "campaignBudget.resourceName")),
    recommendedBudget:
      bool(row, "campaignBudget.hasRecommendedBudget") === true
        ? moneyOrNull(row, "campaignBudget.recommendedBudgetAmountMicros")
        : null,
  };
}

function textAssets(row: Row, path: string): TextAsset[] {
  return list(row, path)
    .map((a) => ({
      text: typeof pick(a, "text") === "string" ? (pick(a, "text") as string) : "",
      pinned: (pick(a, "pinnedField") as string | undefined) ?? null,
      label: (pick(a, "assetPerformanceLabel") as string | undefined) ?? null,
    }))
    .filter((a) => a.text);
}

/** Campos del historial que la auditoría compara antes y después. */
const CHANGE_VALUES: Array<[string, string, "money" | "plain"]> = [
  ["presupuesto", "campaignBudget.amountMicros", "money"],
  ["estado", "campaign.status", "plain"],
  ["estrategia", "campaign.biddingStrategyType", "plain"],
  ["tCPA", "campaign.targetCpa.targetCpaMicros", "money"],
  ["tCPA (maximizar conversiones)", "campaign.maximizeConversions.targetCpaMicros", "money"],
  ["tROAS", "campaign.targetRoas.targetRoas", "plain"],
  ["tROAS (maximizar valor)", "campaign.maximizeConversionValue.targetRoas", "plain"],
  ["estado del anuncio", "adGroupAd.status", "plain"],
  ["estado de la keyword", "adGroupCriterion.status", "plain"],
];

export function parseChange(row: Row): ChangeRow {
  const before: ChangeRow["before"] = {},
    after: ChangeRow["after"] = {};
  for (const [label, path, kind] of CHANGE_VALUES) {
    const o = pick(row, `changeEvent.oldResource.${path}`),
      n = pick(row, `changeEvent.newResource.${path}`);
    if (o === undefined && n === undefined) continue;
    const value = (v: unknown) =>
      v === undefined || v === null
        ? null
        : kind === "money"
          ? (googleNumber(v) ?? 0) / 1_000_000
          : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? v
            : null;
    if (JSON.stringify(value(o)) === JSON.stringify(value(n))) continue;
    before[label] = value(o);
    after[label] = value(n);
  }
  const fields = pick(row, "changeEvent.changedFields");
  return {
    at: str(row, "changeEvent.changeDateTime") ?? "",
    resourceType: str(row, "changeEvent.changeResourceType") ?? "UNKNOWN",
    operation: str(row, "changeEvent.resourceChangeOperation") ?? "UNKNOWN",
    fields:
      typeof fields === "string"
        ? fields
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : [],
    client: str(row, "changeEvent.clientType"),
    campaignId: lastId(str(row, "changeEvent.campaign")),
    before,
    after,
  };
}

function assetLink(row: Row, level: AssetLink["level"], prefix: string): AssetLink {
  return {
    level,
    campaignId: level === "account" ? null : str(row, "campaign.id"),
    adGroupId: level === "ad_group" ? str(row, "adGroup.id") : null,
    fieldType: str(row, `${prefix}.fieldType`) ?? "UNKNOWN",
    primaryStatus: str(row, `${prefix}.primaryStatus`),
    assetId: str(row, "asset.id") ?? "",
    assetType: str(row, "asset.type"),
    approval: str(row, "asset.policySummary.approvalStatus"),
    text: str(row, "asset.sitelinkAsset.linkText") ?? str(row, "asset.calloutAsset.calloutText"),
    endDate:
      str(row, "asset.sitelinkAsset.endDate") ??
      str(row, "asset.calloutAsset.endDate") ??
      str(row, "asset.promotionAsset.endDate"),
  };
}

function segmentRows(rows: Row[], keyPath: string): SegmentRow[] {
  return rows.map((r) => ({
    campaignId: str(r, "campaign.id") ?? "",
    key: str(r, keyPath) ?? "UNKNOWN",
    ...metricsOf(r),
  }));
}

export function emptyAudit(target: AuditTarget, now: Date): AuditData {
  return {
    target,
    extractedAt: now.toISOString(),
    end: "",
    windows: [],
    customer: null,
    campaigns: [],
    adGroupCount: {},
    daily: [],
    actionsDaily: [],
    shares: [],
    conversionActions: [],
    customerGoals: [],
    campaignGoals: [],
    goalConfigs: [],
    searchTerms: [],
    pmaxTerms: [],
    keywords: [],
    ads: [],
    assets: [],
    assetGroups: [],
    assetGroupAssets: [],
    signals: [],
    geo: [],
    devices: [],
    networks: [],
    schedule: [],
    landing: [],
    placements: [],
    frequency: [],
    changes: [],
    recommendations: [],
    urlChecks: [],
    unavailable: [],
    truncated: [],
  };
}

/**
 * Lee una cuenta completa para la auditoría. Solo consultas de lectura. Si una sección falla se
 * registra como no disponible y el resto continúa; autenticación o acceso del proyecto detienen todo.
 */
export async function collectAccount(
  client: Searcher,
  target: AuditTarget,
  opts: CollectOptions = {},
): Promise<AuditData> {
  const now = opts.now ?? new Date();
  const data = emptyAudit(target, now);
  const timeoutMs = opts.timeoutMs ?? 120000;
  const progress = opts.onProgress ?? (() => undefined);
  const query = (q: string) => client.search(target.id, q, AbortSignal.timeout(timeoutMs));

  /** Consulta con respaldo: si la principal es rechazada por parámetros, intenta la reducida. */
  async function section(name: string, main: string, fallback?: string): Promise<Row[] | null> {
    try {
      return await query(main);
    } catch (e) {
      if (fatal(e)) throw e;
      if (fallback && isApiError(e) && e.code === "INVALID_REQUEST") {
        try {
          const rows = await query(fallback);
          data.unavailable.push({ section: `${name} (campos ampliados)`, reason: failureReason(e) });
          return rows;
        } catch (e2) {
          if (fatal(e2)) throw e2;
          data.unavailable.push({ section: name, reason: failureReason(e2) });
          return null;
        }
      }
      data.unavailable.push({ section: name, reason: failureReason(e) });
      return null;
    }
  }

  const customerRows = await section("Cuenta", Q.customer(), Q.customerBasic());
  if (!customerRows?.length) {
    if (!data.unavailable.length) data.unavailable.push({ section: "Cuenta", reason: "Google no devolvió la cuenta." });
    return data;
  }
  data.customer = parseCustomer(customerRows[0]!);
  data.end = opts.end ?? shiftDate(todayIn(data.customer.timeZone, now), -1);
  data.windows = auditWindows(data.end);
  const w = (key: WindowKey) => windowOf(data.windows, key)!;
  const L30 = w("L30");
  progress(`${target.name}: estructura y campañas`);

  const portfolios = new Map<string, { cpa: number | null; roas: number | null }>();
  for (const r of (await section("Estrategias de cartera", Q.portfolios())) ?? [])
    portfolios.set(str(r, "biddingStrategy.resourceName") ?? "", {
      cpa:
        moneyOrNull(r, "biddingStrategy.targetCpa.targetCpaMicros") ??
        moneyOrNull(r, "biddingStrategy.maximizeConversions.targetCpaMicros"),
      roas:
        numOrNull(r, "biddingStrategy.targetRoas.targetRoas") ??
        numOrNull(r, "biddingStrategy.maximizeConversionValue.targetRoas"),
    });
  data.campaigns = ((await section("Campañas", Q.campaigns(), Q.campaignsBasic())) ?? [])
    .map((r) => parseCampaign(r, portfolios))
    .filter((c) => c.id);

  const truncated = (name: string, rows: Row[] | null, limit: number) => {
    if (rows && rows.length >= limit) data.truncated.push(name);
  };
  const shareWindows: WindowKey[] = ["L7", "P7", "L14", "P14", "L30", "P30"];
  const tasks: Array<() => Promise<void>> = [
    async () => {
      for (const r of (await section("Grupos de anuncios", Q.adGroups())) ?? []) {
        const id = str(r, "campaign.id") ?? "";
        data.adGroupCount[id] = (data.adGroupCount[id] ?? 0) + 1;
      }
    },
    async () => {
      const from = dailyStart(data.windows);
      const rows = await section("Serie diaria", Q.daily(from, data.end), Q.dailyBasic(from, data.end));
      data.daily = (rows ?? []).map((r): DailyRow => ({
        campaignId: str(r, "campaign.id") ?? "",
        date: str(r, "segments.date") ?? "",
        ...metricsOf(r),
        interactions: num(r, "metrics.interactions"),
        value: num(r, "metrics.conversionsValue"),
        allConversions: num(r, "metrics.allConversions"),
        calls: num(r, "metrics.phoneCalls"),
      }));
    },
    async () => {
      const rows = await section("Conversiones por acción", Q.actionsDaily(w("L90").from, data.end));
      data.actionsDaily = (rows ?? []).map((r): ActionDailyRow => ({
        campaignId: str(r, "campaign.id") ?? "",
        date: str(r, "segments.date") ?? "",
        actionName: str(r, "segments.conversionActionName") ?? "",
        category: str(r, "segments.conversionActionCategory"),
        conversions: num(r, "metrics.conversions"),
        allConversions: num(r, "metrics.allConversions"),
      }));
    },
    ...shareWindows.map((key) => async () => {
      const rows = await section(`Cuota de impresiones (${key})`, Q.shares(w(key)));
      for (const r of rows ?? [])
        data.shares.push({
          campaignId: str(r, "campaign.id") ?? "",
          window: key,
          impressionShare: numOrNull(r, "metrics.searchImpressionShare"),
          lostBudget: numOrNull(r, "metrics.searchBudgetLostImpressionShare"),
          lostRank: numOrNull(r, "metrics.searchRankLostImpressionShare"),
          top: numOrNull(r, "metrics.searchTopImpressionShare"),
          absoluteTop: numOrNull(r, "metrics.searchAbsoluteTopImpressionShare"),
        });
    }),
    async () => {
      const rows = await section("Acciones de conversión", Q.conversionActions());
      data.conversionActions = (rows ?? []).map((r): ConversionActionInfo => ({
        id: str(r, "conversionAction.id") ?? "",
        name: str(r, "conversionAction.name") ?? "",
        status: str(r, "conversionAction.status") ?? "UNKNOWN",
        type: str(r, "conversionAction.type") ?? "UNKNOWN",
        category: str(r, "conversionAction.category"),
        origin: str(r, "conversionAction.origin"),
        primary: bool(r, "conversionAction.primaryForGoal"),
        included: bool(r, "conversionAction.includeInConversionsMetric"),
        counting: str(r, "conversionAction.countingType"),
        clickWindowDays: numOrNull(r, "conversionAction.clickThroughLookbackWindowDays"),
        attribution: str(r, "conversionAction.attributionModelSettings.attributionModel"),
        owner: (() => {
          const owner = lastId(str(r, "conversionAction.ownerCustomer"));
          return owner && owner !== target.id ? "manager" : "account";
        })(),
      }));
    },
    async () => {
      data.customerGoals = ((await section("Objetivos de la cuenta", Q.customerGoals())) ?? []).map((r) => ({
        campaignId: null,
        category: str(r, "customerConversionGoal.category") ?? "UNKNOWN",
        origin: str(r, "customerConversionGoal.origin") ?? "UNKNOWN",
        biddable: bool(r, "customerConversionGoal.biddable"),
      }));
      data.campaignGoals = ((await section("Objetivos por campaña", Q.campaignGoals())) ?? []).map((r) => ({
        campaignId: lastId(str(r, "campaignConversionGoal.campaign")),
        category: str(r, "campaignConversionGoal.category") ?? "UNKNOWN",
        origin: str(r, "campaignConversionGoal.origin") ?? "UNKNOWN",
        biddable: bool(r, "campaignConversionGoal.biddable"),
      }));
      data.goalConfigs = ((await section("Configuración de objetivos", Q.goalConfigs())) ?? []).map((r) => ({
        campaignId: lastId(str(r, "conversionGoalCampaignConfig.campaign")) ?? "",
        level: str(r, "conversionGoalCampaignConfig.goalConfigLevel"),
        customGoal: str(r, "conversionGoalCampaignConfig.customConversionGoal"),
      }));
    },
    async () => {
      const rows = await section(
        "Términos de búsqueda",
        Q.searchTerms(L30, LIMITS.searchTerms),
        Q.searchTermsBasic(L30, LIMITS.searchTerms),
      );
      truncated("Términos de búsqueda", rows, LIMITS.searchTerms);
      data.searchTerms = (rows ?? []).map((r) => ({
        campaignId: str(r, "campaign.id") ?? "",
        adGroupId: str(r, "adGroup.id") ?? "",
        term: str(r, "searchTermView.searchTerm") ?? "",
        status: str(r, "searchTermView.status"),
        matchType: str(r, "segments.searchTermMatchType"),
        ...metricsOf(r),
      }));
    },
    async () => {
      if (!data.campaigns.some((c) => c.channel === "PERFORMANCE_MAX" && c.status === "ENABLED")) return;
      const rows = await section(
        "Términos de búsqueda de Performance Max",
        Q.pmaxTerms(L30, LIMITS.pmaxTerms),
        Q.pmaxTermsBasic(L30, LIMITS.pmaxTerms),
      );
      truncated("Términos de búsqueda de Performance Max", rows, LIMITS.pmaxTerms);
      data.pmaxTerms = (rows ?? []).map((r) => ({
        campaignId: str(r, "campaign.id") ?? "",
        term: str(r, "campaignSearchTermView.searchTerm") ?? "",
        impressions: num(r, "metrics.impressions"),
        clicks: num(r, "metrics.clicks"),
        conversions: num(r, "metrics.conversions"),
        cost: pick(r, "metrics.costMicros") === undefined ? null : money(r, "metrics.costMicros"),
      }));
    },
    async () => {
      const rows = await section("Keywords", Q.keywords(LIMITS.keywords));
      truncated("Keywords", rows, LIMITS.keywords);
      const metrics = new Map<string, ReturnType<typeof metricsOf>>();
      for (const r of (await section("Métricas de keywords", Q.keywordMetrics(L30))) ?? [])
        metrics.set(`${str(r, "adGroup.id")}~${str(r, "adGroupCriterion.criterionId")}`, metricsOf(r));
      data.keywords = (rows ?? []).map((r): KeywordRow => {
        const adGroupId = str(r, "adGroup.id") ?? "",
          criterionId = str(r, "adGroupCriterion.criterionId") ?? "";
        return {
          campaignId: str(r, "campaign.id") ?? "",
          adGroupId,
          adGroup: str(r, "adGroup.name") ?? adGroupId,
          criterionId,
          text: str(r, "adGroupCriterion.keyword.text") ?? "",
          matchType: str(r, "adGroupCriterion.keyword.matchType") ?? "UNKNOWN",
          servingStatus: str(r, "adGroupCriterion.systemServingStatus"),
          approval: str(r, "adGroupCriterion.approvalStatus"),
          qualityScore: numOrNull(r, "adGroupCriterion.qualityInfo.qualityScore"),
          adRelevance: str(r, "adGroupCriterion.qualityInfo.creativeQualityScore"),
          landingExperience: str(r, "adGroupCriterion.qualityInfo.postClickQualityScore"),
          expectedCtr: str(r, "adGroupCriterion.qualityInfo.searchPredictedCtr"),
          ...(metrics.get(`${adGroupId}~${criterionId}`) ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 }),
        };
      });
    },
    async () => {
      const rows = await section("Anuncios", Q.ads(LIMITS.ads));
      truncated("Anuncios", rows, LIMITS.ads);
      const metrics = new Map<string, ReturnType<typeof metricsOf>>();
      for (const r of (await section("Métricas de anuncios", Q.adMetrics(L30))) ?? [])
        metrics.set(`${str(r, "adGroup.id")}~${str(r, "adGroupAd.ad.id")}`, metricsOf(r));
      data.ads = (rows ?? []).map((r): AdRow => {
        const adGroupId = str(r, "adGroup.id") ?? "",
          adId = str(r, "adGroupAd.ad.id") ?? "";
        return {
          campaignId: str(r, "campaign.id") ?? "",
          adGroupId,
          adGroup: str(r, "adGroup.name") ?? adGroupId,
          adId,
          type: str(r, "adGroupAd.ad.type") ?? "UNKNOWN",
          strength: str(r, "adGroupAd.adStrength"),
          approval: str(r, "adGroupAd.policySummary.approvalStatus"),
          review: str(r, "adGroupAd.policySummary.reviewStatus"),
          topics: list(r, "adGroupAd.policySummary.policyTopicEntries")
            .map((t) => pick(t, "topic"))
            .filter((t): t is string => typeof t === "string"),
          finalUrls: list(r, "adGroupAd.ad.finalUrls").filter((u): u is string => typeof u === "string"),
          headlines: textAssets(r, "adGroupAd.ad.responsiveSearchAd.headlines"),
          descriptions: textAssets(r, "adGroupAd.ad.responsiveSearchAd.descriptions"),
          ...(metrics.get(`${adGroupId}~${adId}`) ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 }),
        };
      });
    },
    async () => {
      const customer = (await section("Assets de la cuenta", Q.customerAssets())) ?? [];
      const campaign = (await section("Assets de campaña", Q.campaignAssets())) ?? [];
      const adGroup = (await section("Assets de grupo de anuncios", Q.adGroupAssets())) ?? [];
      data.assets = [
        ...customer.map((r) => assetLink(r, "account", "customerAsset")),
        ...campaign.map((r) => assetLink(r, "campaign", "campaignAsset")),
        ...adGroup.map((r) => assetLink(r, "ad_group", "adGroupAsset")),
      ];
    },
    async () => {
      if (!data.campaigns.some((c) => c.channel === "PERFORMANCE_MAX" && c.status === "ENABLED")) return;
      const groups = (await section("Grupos de recursos (PMax)", Q.assetGroups())) ?? [];
      const metrics = new Map<string, ReturnType<typeof metricsOf>>();
      for (const r of (await section("Métricas de grupos de recursos", Q.assetGroupMetrics(L30))) ?? [])
        metrics.set(str(r, "assetGroup.id") ?? "", metricsOf(r));
      data.assetGroups = groups.map((r): AssetGroupRow => {
        const id = str(r, "assetGroup.id") ?? "";
        return {
          id,
          campaignId: lastId(str(r, "assetGroup.campaign")) ?? "",
          name: str(r, "assetGroup.name") ?? id,
          status: str(r, "assetGroup.status") ?? "UNKNOWN",
          primaryStatus: str(r, "assetGroup.primaryStatus"),
          reasons: list(r, "assetGroup.primaryStatusReasons").filter((x): x is string => typeof x === "string"),
          strength: str(r, "assetGroup.adStrength"),
          finalUrls: list(r, "assetGroup.finalUrls").filter((u): u is string => typeof u === "string"),
          ...(metrics.get(id) ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 }),
        };
      });
      data.assetGroupAssets = ((await section("Recursos de PMax", Q.assetGroupAssets())) ?? []).map(
        (r): AssetGroupAssetRow => ({
          assetGroupId: str(r, "assetGroup.id") ?? "",
          fieldType: str(r, "assetGroupAsset.fieldType") ?? "UNKNOWN",
          source: str(r, "assetGroupAsset.source"),
          primaryStatus: str(r, "assetGroupAsset.primaryStatus"),
          approval: str(r, "asset.policySummary.approvalStatus"),
        }),
      );
      data.signals = ((await section("Señales de PMax", Q.signals())) ?? []).map((r) => ({
        assetGroupId: str(r, "assetGroup.id") ?? "",
        searchTheme: str(r, "assetGroupSignal.searchTheme.text"),
        audience: str(r, "assetGroupSignal.audience.audience"),
      }));
    },
    async () => {
      const rows = (await section("Geografía", Q.geo(L30))) ?? [];
      const ids = [...new Set(rows.map((r) => str(r, "segments.geoTargetRegion")).filter((x): x is string => !!x))];
      const names = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200)
        for (const r of (await section("Nombres de regiones", Q.geoNames(ids.slice(i, i + 200)))) ?? [])
          names.set(str(r, "geoTargetConstant.resourceName") ?? "", str(r, "geoTargetConstant.name") ?? "");
      data.geo = segmentRows(rows, "segments.geoTargetRegion").map((g) => ({
        ...g,
        key: names.get(g.key) || (g.key === "UNKNOWN" ? "Sin región identificada" : g.key),
      }));
    },
    async () => {
      data.devices = segmentRows((await section("Dispositivos", Q.devices(L30))) ?? [], "segments.device");
    },
    async () => {
      data.networks = segmentRows((await section("Redes de Search", Q.networks(L30))) ?? [], "segments.adNetworkType");
    },
    async () => {
      data.schedule = ((await section("Horarios", Q.schedule(L30))) ?? []).map((r) => ({
        campaignId: str(r, "campaign.id") ?? "",
        day: str(r, "segments.dayOfWeek") ?? "UNKNOWN",
        hour: num(r, "segments.hour"),
        cost: money(r, "metrics.costMicros"),
        clicks: num(r, "metrics.clicks"),
        conversions: num(r, "metrics.conversions"),
      }));
    },
    async () => {
      data.landing = ((await section("Páginas de destino", Q.landing(L30), Q.landingBasic(L30))) ?? []).map((r) => ({
        url: str(r, "landingPageView.unexpandedFinalUrl") ?? "",
        cost: money(r, "metrics.costMicros"),
        clicks: num(r, "metrics.clicks"),
        conversions: num(r, "metrics.conversions"),
        speedScore: numOrNull(r, "metrics.speedScore"),
        mobileFriendly: numOrNull(r, "metrics.mobileFriendlyClicksPercentage"),
      }));
    },
    async () => {
      if (!data.campaigns.some((c) => ["DISPLAY", "VIDEO", "DEMAND_GEN"].includes(c.channel))) return;
      data.placements = ((await section("Ubicaciones (placements)", Q.placements(L30))) ?? []).map((r) => ({
        campaignId: str(r, "campaign.id") ?? "",
        name: str(r, "detailPlacementView.displayName") ?? "",
        placement: str(r, "detailPlacementView.placement") ?? "",
        type: str(r, "detailPlacementView.placementType"),
        ...metricsOf(r),
      }));
      data.frequency = ((await section("Frecuencia", Q.frequency(L30))) ?? []).map((r) => ({
        campaignId: str(r, "campaign.id") ?? "",
        uniqueUsers: numOrNull(r, "metrics.uniqueUsers"),
        frequency: numOrNull(r, "metrics.averageImpressionFrequencyPerUser"),
      }));
    },
    async () => {
      // El historial acepta solo los últimos 30 días contados desde hoy.
      const today = todayIn(data.customer!.timeZone, now);
      const rows = await section("Historial de cambios", Q.changes(shiftDate(today, -29), today, LIMITS.changes));
      truncated("Historial de cambios", rows, LIMITS.changes);
      const budgetToCampaigns = new Map<string, string[]>();
      for (const c of data.campaigns)
        if (c.budgetId) budgetToCampaigns.set(c.budgetId, [...(budgetToCampaigns.get(c.budgetId) ?? []), c.id]);
      data.changes = (rows ?? []).flatMap((r) => {
        const change = parseChange(r);
        // Un presupuesto no siempre trae la campaña; se atribuye a las campañas que lo usan.
        if (!change.campaignId && change.resourceType === "CAMPAIGN_BUDGET") {
          const ids = budgetToCampaigns.get(lastId(str(r, "changeEvent.changeResourceName")) ?? "") ?? [];
          if (ids.length) return ids.map((campaignId) => ({ ...change, campaignId }));
        }
        return [change];
      });
    },
    async () => {
      data.recommendations = ((await section("Recomendaciones de Google", Q.recommendations())) ?? []).map((r) => ({
        type: str(r, "recommendation.type") ?? "UNKNOWN",
        campaignId: lastId(str(r, "recommendation.campaign")),
        dismissed: bool(r, "recommendation.dismissed") === true,
      }));
    },
  ];
  progress(`${target.name}: métricas, conversiones, términos, anuncios y assets`);
  await pool(tasks, opts.concurrency ?? 3);

  if (opts.checkUrls) {
    const byCost = [...data.landing].sort((a, b) => b.cost - a.cost).map((l) => l.url);
    const extra = [...data.ads.flatMap((a) => a.finalUrls), ...data.assetGroups.flatMap((g) => g.finalUrls)];
    const urls = [...new Set([...byCost.slice(0, 30), ...extra])].filter((u) => /^https?:\/\//i.test(u)).slice(0, 50);
    if (urls.length) {
      progress(`${target.name}: revisión de ${urls.length} páginas de destino`);
      data.urlChecks = await opts.checkUrls(urls);
    }
  }
  return data;
}

/** Ventanas declaradas por clave, para el análisis. */
export function windowMap(windows: DateWindow[]): Partial<Record<WindowKey, DateWindow>> {
  return Object.fromEntries(windows.map((x) => [x.key, x]));
}
