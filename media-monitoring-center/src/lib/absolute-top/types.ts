import type { GoogleDomainConfig } from "@/lib/domains/config";
import type { Severity } from "@/lib/types";

export type AbsoluteTopLevel = "campaign" | "ad_group";
export type AbsoluteTopState = "meets" | "near" | "below" | "insufficient" | "unclassified";
export type AbsoluteTopCoverage = "complete" | "partial" | "unavailable";
export interface AbsoluteTopRow {
  level: AbsoluteTopLevel;
  domain_id: string | null;
  domain_name: string | null;
  customer_id: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: "active";
  ad_group_id: string | null;
  ad_group_name: string | null;
  ad_group_status: "active" | null;
  date: string;
  hour: number | null;
  currency: string;
  source_timezone: string;
  extracted_at: string;
  absolute_top_rate: number | null;
  top_of_page_rate: number | null;
  search_impression_share: number | null;
  search_lost_is_rank: number | null;
  search_lost_is_budget: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  conversions: number | null;
  bidding_strategy: string | null;
  daily_budget: number | null;
  share_bounds: Partial<Record<"search_impression_share" | "search_lost_is_rank" | "search_lost_is_budget", "lt_10_percent" | "gt_90_percent">>;
  warnings: string[];
}

export interface AbsoluteTopAudit {
  version: 1;
  auditId: string;
  customerId: string;
  observedAt: string;
  from: string;
  to: string;
  granularity: "daily" | "hourly";
  coverage: AbsoluteTopCoverage;
  rows: AbsoluteTopRow[];
  warnings: string[];
}

export interface AbsoluteTopComparison {
  rate: number | null;
  delta_pp: number | null;
  samples: number;
  approximate: boolean;
}
export interface AbsoluteTopPersistence {
  consecutive_audits: number;
  label: "Sin evaluación" | "Observación" | "Advertencia" | "Alerta persistente" | "Dentro del objetivo";
  first_detected_at: string | null;
  last_detected_at: string | null;
  hours_since_detection: number | null;
  worst_rate: number | null;
  best_rate: number | null;
  mean_rate: number | null;
  audit_id: string;
}
export interface AbsoluteTopEvaluation extends AbsoluteTopRow {
  window_from?: string;
  window_to?: string;
  window_end_hour?: number | null;
  episode_open?: boolean;
  last_valid_rate?: number | null;
  entity_key: string;
  audit_id: string;
  audit_at: string;
  coverage: AbsoluteTopCoverage;
  target_rate: number | null;
  gap_pp: number | null;
  state: AbsoluteTopState;
  severity: Severity;
  severity_score: number;
  score_components: Record<string, number | null>;
  group_weight: number | null;
  sudden_drop: boolean;
  persistence: AbsoluteTopPersistence;
  comparison: { previous: AbsoluteTopComparison; previous_day: AbsoluteTopComparison; last_24h: AbsoluteTopComparison; last_7d: AbsoluteTopComparison };
  evolution: Array<{ at: string; rate: number | null; impressions: number | null; audit_id: string }>;
  cross_status: "generalized" | "localized" | "concentrated" | "healthy" | "unknown";
  diagnostics: string[];
}

export interface AbsoluteTopDomainSummary {
  domain_id: string;
  domain_name: string;
  target_rate: number;
  campaigns: number;
  ad_groups: number;
  meets: number;
  near: number;
  below: number;
  insufficient: number;
  compliance_rate: number | null;
  weighted_absolute_top: number | null;
  weighting_approximate: true;
  severity_score: number;
}
export interface AbsoluteTopDashboard {
  brand: "izzi" | "sky";
  selectedDomain: string;
  configured: boolean;
  available: boolean;
  lastAuditAt: string | null;
  domains: GoogleDomainConfig["domains"];
  policy: GoogleDomainConfig["absoluteTop"] | null;
  rows: AbsoluteTopEvaluation[];
  summaries: AbsoluteTopDomainSummary[];
  warnings: string[];
  approximationNotice: string;
}

export class AbsoluteTopError extends Error {
  constructor(readonly code: string) { super(`No se pudo completar la auditoría de Absolute Top (${code}).`); this.name = "AbsoluteTopError"; }
}
