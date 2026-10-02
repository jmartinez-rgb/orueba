/**
 * Tipos de la auditoría de Google Ads (solo lectura). Los montos ya vienen convertidos de micros a la
 * moneda de la cuenta y los conteos a número; un dato que Google no devolvió queda en null, nunca en cero.
 */

export interface AuditTarget {
  id: string;
  name: string;
  priority: 1 | 2;
}

/** Cuentas del encargo, en el orden de prioridad acordado (máxima prioridad primero). */
export const AUDIT_TARGETS: AuditTarget[] = [
  { id: "8779536058", name: "izzi – Performance AO - mxn", priority: 1 },
  { id: "6214109105", name: "izzi – Performance AO - mxn 2", priority: 1 },
  { id: "7367928294", name: "izzi - Ofertas", priority: 1 },
  { id: "3224850043", name: "izzi - Paquetes - 2do Dominio", priority: 1 },
  { id: "8110571939", name: "izzi - Apple TV", priority: 2 },
  { id: "7771629164", name: "izzi - campañas", priority: 2 },
  { id: "4536282576", name: "izzi - Universal+", priority: 2 },
  { id: "1970842746", name: "Sky - ABCW", priority: 2 },
];

export type WindowKey = "L7" | "P7" | "L14" | "P14" | "L30" | "P30" | "MTD" | "PMTD" | "PM" | "L90" | "PRE_BID";

export interface DateWindow {
  key: WindowKey;
  label: string;
  from: string;
  to: string;
}

export interface CustomerInfo {
  id: string;
  name: string;
  currency: string;
  timeZone: string | null;
  optimizationScore: number | null;
  autoTagging: boolean | null;
  trackingStatus: string | null;
  acceptedTerms: boolean | null;
  enhancedLeads: boolean | null;
}

export interface CampaignInfo {
  id: string;
  name: string;
  status: string;
  servingStatus: string | null;
  primaryStatus: string | null;
  reasons: string[];
  channel: string;
  subChannel: string | null;
  bidding: string | null;
  biddingStatus: string | null;
  portfolio: string | null;
  targetCpa: number | null;
  targetRoas: number | null;
  optimizationScore: number | null;
  start: string | null;
  end: string | null;
  searchNetwork: boolean | null;
  partners: boolean | null;
  display: boolean | null;
  merchantId: string | null;
  finalUrlExpansion: boolean | null;
  budget: number | null;
  budgetTotal: number | null;
  budgetPeriod: string | null;
  budgetShared: boolean;
  budgetId: string | null;
  recommendedBudget: number | null;
}

export interface Metrics {
  cost: number;
  impressions: number;
  clicks: number;
  interactions: number;
  conversions: number;
  value: number;
  allConversions: number;
  calls: number;
}

export interface DailyRow extends Metrics {
  campaignId: string;
  date: string;
}

export interface ActionDailyRow {
  campaignId: string;
  date: string;
  actionName: string;
  category: string | null;
  conversions: number;
  allConversions: number;
}

export interface ShareRow {
  campaignId: string;
  window: WindowKey;
  impressionShare: number | null;
  lostBudget: number | null;
  lostRank: number | null;
  top: number | null;
  absoluteTop: number | null;
}

export interface ConversionActionInfo {
  id: string;
  name: string;
  status: string;
  type: string;
  category: string | null;
  origin: string | null;
  primary: boolean | null;
  included: boolean | null;
  counting: string | null;
  clickWindowDays: number | null;
  attribution: string | null;
  owner: "account" | "manager";
}

export interface GoalRow {
  campaignId: string | null;
  category: string;
  origin: string;
  biddable: boolean | null;
}

export interface GoalConfigRow {
  campaignId: string;
  level: string | null;
  customGoal: string | null;
}

export interface SearchTermRow {
  campaignId: string;
  adGroupId: string;
  term: string;
  status: string | null;
  matchType: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface PmaxTermRow {
  campaignId: string;
  term: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number | null;
}

export interface KeywordRow {
  campaignId: string;
  adGroupId: string;
  adGroup: string;
  criterionId: string;
  text: string;
  matchType: string;
  servingStatus: string | null;
  approval: string | null;
  qualityScore: number | null;
  adRelevance: string | null;
  landingExperience: string | null;
  expectedCtr: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface TextAsset {
  text: string;
  pinned: string | null;
  label: string | null;
}

export interface AdRow {
  campaignId: string;
  adGroupId: string;
  adGroup: string;
  adId: string;
  type: string;
  strength: string | null;
  approval: string | null;
  review: string | null;
  topics: string[];
  finalUrls: string[];
  headlines: TextAsset[];
  descriptions: TextAsset[];
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AssetLink {
  level: "account" | "campaign" | "ad_group";
  campaignId: string | null;
  adGroupId: string | null;
  fieldType: string;
  primaryStatus: string | null;
  assetId: string;
  assetType: string | null;
  approval: string | null;
  text: string | null;
  endDate: string | null;
}

export interface AssetGroupRow {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  primaryStatus: string | null;
  reasons: string[];
  strength: string | null;
  finalUrls: string[];
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AssetGroupAssetRow {
  assetGroupId: string;
  fieldType: string;
  source: string | null;
  primaryStatus: string | null;
  approval: string | null;
}

export interface SignalRow {
  assetGroupId: string;
  searchTheme: string | null;
  audience: string | null;
}

/** Corte genérico por segmento (región, dispositivo, red). */
export interface SegmentRow {
  campaignId: string;
  key: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface ScheduleRow {
  campaignId: string;
  day: string;
  hour: number;
  cost: number;
  clicks: number;
  conversions: number;
}

export interface LandingRow {
  url: string;
  cost: number;
  clicks: number;
  conversions: number;
  speedScore: number | null;
  mobileFriendly: number | null;
}

export interface PlacementRow {
  campaignId: string;
  name: string;
  placement: string;
  type: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface FrequencyRow {
  campaignId: string;
  uniqueUsers: number | null;
  frequency: number | null;
}

/** Cambio del historial con los valores antes y después que interesan a la auditoría. */
export interface ChangeRow {
  at: string;
  resourceType: string;
  operation: string;
  fields: string[];
  client: string | null;
  campaignId: string | null;
  before: Record<string, string | number | boolean | null>;
  after: Record<string, string | number | boolean | null>;
}

export interface RecommendationRow {
  type: string;
  campaignId: string | null;
  dismissed: boolean;
}

export interface UrlCheck {
  url: string;
  status: number | null;
  location: string | null;
  outcome: "ok" | "redirect" | "error" | "unverifiable";
}

export interface AuditData {
  target: AuditTarget;
  extractedAt: string;
  end: string;
  windows: DateWindow[];
  customer: CustomerInfo | null;
  campaigns: CampaignInfo[];
  adGroupCount: Record<string, number>;
  daily: DailyRow[];
  actionsDaily: ActionDailyRow[];
  shares: ShareRow[];
  conversionActions: ConversionActionInfo[];
  customerGoals: GoalRow[];
  campaignGoals: GoalRow[];
  goalConfigs: GoalConfigRow[];
  searchTerms: SearchTermRow[];
  pmaxTerms: PmaxTermRow[];
  keywords: KeywordRow[];
  ads: AdRow[];
  assets: AssetLink[];
  assetGroups: AssetGroupRow[];
  assetGroupAssets: AssetGroupAssetRow[];
  signals: SignalRow[];
  geo: SegmentRow[];
  devices: SegmentRow[];
  networks: SegmentRow[];
  schedule: ScheduleRow[];
  landing: LandingRow[];
  placements: PlacementRow[];
  frequency: FrequencyRow[];
  changes: ChangeRow[];
  recommendations: RecommendationRow[];
  urlChecks: UrlCheck[];
  /** Secciones que Google no devolvió, con el motivo (código de error, nunca el cuerpo). */
  unavailable: Array<{ section: string; reason: string }>;
  /** Secciones recortadas por el límite de filas de la consulta. */
  truncated: string[];
}

export type Risk = "bajo" | "moderado" | "alto";
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type Confidence = "alta" | "media" | "baja";
export type When = "hoy" | "48h" | "semana" | "no_ejecutar";

export type SectionKey =
  | "general"
  | "search"
  | "pmax"
  | "video"
  | "budget"
  | "bidding"
  | "conversions"
  | "terms"
  | "keywords"
  | "creatives"
  | "assets"
  | "geo"
  | "devices"
  | "schedule"
  | "urls"
  | "changes";

export interface Finding {
  id: string;
  accountId: string;
  campaign: string;
  section: SectionKey;
  title: string;
  evidence: string[];
  diagnosis: string;
  action: string;
  steps: string[];
  risk: Risk;
  priority: Priority;
  confidence: Confidence;
  impact: string;
  metric: string;
  observation: string;
  rollback: string;
  minutes: number | null;
  when: When;
  /** Gasto de los últimos 30 días relacionado con el hallazgo, para ordenar por relevancia. */
  stake: number;
  rule: string | null;
  sources: string[];
  /** Gasto mensual estimado sin retorno que el hallazgo permitiría recuperar (solo si es cuantificable). */
  waste?: number;
  /** Recomienda una prueba controlada en lugar de un cambio directo. */
  experiment?: { hypothesis: string; design: string; duration: string };
}

export interface HoldItem {
  campaign: string;
  item: string;
  reason: string;
}
