import type { BrandId } from "@/lib/brands";
import type { DataMode, DataState, PlatformId } from "@/lib/types";

export interface NexusLink { label: string; href: string }
export interface NexusAnswer {
  kind: "guide" | "overview" | "campaign" | "account" | "alerts" | "freshness" | "metrics" | "clarify" | "unavailable";
  title: string;
  paragraphs: string[];
  facts: Array<{ label: string; value: string }>;
  items: Array<{ title: string; detail: string; href?: string }>;
  sources: NexusLink[];
  suggestions: string[];
  context: { brand: BrandId; brandName: string; date: string; cutoffHour: number; timezone: string; asOf: string; mode: DataMode };
}

export interface NexusMetrics { spend: number | null; impressions: number | null; clicks: number | null }
export interface NexusEntity {
  id: string;
  name: string;
  platform: PlatformId;
  accountId: string;
  status: string;
  dataState: DataState;
  lastDataAt: string | null;
  cutoffHour: number | null;
  metrics: NexusMetrics;
}

/** Small allowlisted projection; never hand a full snapshot to the answer engine or browser. */
export interface NexusData {
  context: NexusAnswer["context"];
  accounts: NexusEntity[];
  campaigns: NexusEntity[];
  platforms: Array<{ id: PlatformId; state: DataState; lastDataAt: string | null }>;
  alerts: Array<{ id: string; platform: PlatformId; severity: string; status: string }>;
  incidents: Array<{ id: string; platform: PlatformId; severity: string; status: string }>;
  missingFx: number;
  fallbackFx: number;
}
