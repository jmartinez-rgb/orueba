import type { DomainMetadata } from "../config/google-domains.js";
import type { Granularity } from "./normalized.js";

/** A bounded, account-scoped read in the Google Ads account's source clock. */
export interface GoogleAbsoluteTopQuery {
  account_id: string;
  date_from: string;
  date_to: string;
  granularity: Granularity;
}

export type GoogleShareMetric = "search_impression_share" | "search_lost_is_rank" | "search_lost_is_budget";
export type GoogleShareBound = "lt_10_percent" | "gt_90_percent";

/** Native Google rates; an omitted value is unknown, never an invented zero. */
export interface GoogleAbsoluteTopRow extends DomainMetadata {
  platform: "google";
  account_id: string;
  account_name: string;
  level: "campaign" | "ad_group";
  campaign_id: string;
  campaign_name: string;
  campaign_status: "active";
  ad_group_id: string | null;
  ad_group_name: string | null;
  ad_group_status: "active" | null;
  date: string;
  hour: number | null;
  currency: string | null;
  source_timezone: string | null;
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
  /** Google platform total conversions; not a selected offline business event. */
  conversions: number | null;
  bidding_strategy: string | null;
  /** Campaign daily budget; ad groups do not acquire their campaign's budget. */
  daily_budget: number | null;
  share_bounds?: Partial<Record<GoogleShareMetric, GoogleShareBound>>;
  warnings: string[];
}
