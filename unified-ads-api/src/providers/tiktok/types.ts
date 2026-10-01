export type TikTokFetch = typeof fetch;
export interface TikTokAccount {
  advertiser_id?: string;
  name?: string;
  currency?: string;
  timezone?: string;
  display_timezone?: string;
  status?: string;
  owner_bc_id?: string;
}
export interface TikTokCampaign {
  advertiser_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  operation_status?: string;
  secondary_status?: string;
  objective_type?: string;
}
export interface TikTokReport {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}
export function tiktokObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Los IDs nunca pasan por Number; '-' y métricas censuradas no equivalen a cero. */
export function tiktokNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && (!Number.isInteger(n) || Number.isSafeInteger(n)) ? n : null;
}
