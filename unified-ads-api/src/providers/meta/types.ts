export type MetaFetch = typeof fetch;
export interface MetaAccount {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id?: string; name?: string };
}
export interface MetaCampaign {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
}
export interface MetaAction {
  action_type?: string;
  value?: string | number;
  [key: string]: unknown;
}
export interface MetaInsight extends Record<string, unknown> {
  account_id?: string;
  campaign_id?: string;
  account_name?: string;
  campaign_name?: string;
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}
export function metaNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n)) ? n : null;
}
export function metaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
