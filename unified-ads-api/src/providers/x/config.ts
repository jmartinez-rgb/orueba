import { ApiError } from "../../utils/errors.js";
import { CONVERSION_CATEGORIES } from "../../normalization/conversions.js";

export const X_REQUIRED = [
  "X_ADS_CONSUMER_KEY",
  "X_ADS_CONSUMER_SECRET",
  "X_ADS_ACCESS_TOKEN",
  "X_ADS_ACCESS_TOKEN_SECRET",
] as const;
export const X_BASE = "https://ads-api.x.com/12";
export const X_CONVERSIONS = [
  "conversion_purchases",
  "conversion_sign_ups",
  "conversion_site_visits",
  "conversion_downloads",
  "conversion_custom",
  "conversion_add_to_carts",
  "conversion_checkouts_initiated",
  "conversion_content_views",
  "conversion_payment_info_additions",
  "conversion_add_to_wishlists",
  "conversion_searches",
  "conversion_landing_page_views",
  "conversion_subscriptions",
] as const;
export const X_PLACEMENTS = ["ALL_ON_TWITTER", "SPOTLIGHT", "TREND"] as const;
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function xId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9]{1,80}$/.test(v))
    throw new ApiError("INVALID_REQUEST", "X Ads requiere un identificador alfanumérico.");
  return v;
}
export interface XConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  accountIds: string[];
  clientMapping: Record<string, string>;
  primary: string | null;
  primaryMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  attribution: "post_engagement" | "post_view";
  reportMode: "auto" | "sync" | "async";
  timeoutMs: number;
  retries: number;
}
export function readXConfig(env: Readonly<Record<string, string | undefined>>, fallbackTimeout = 15000) {
  const get = (k: string) => env[k]?.trim();
  const missing: string[] = [];
  for (const k of X_REQUIRED) if (!get(k) || /[\r\n]/.test(get(k)!)) missing.push(k);
  const timeoutMs = Number(get("X_ADS_TIMEOUT_MS") || fallbackTimeout),
    retries = Number(get("X_ADS_RETRIES") || 2);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) missing.push("X_ADS_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("X_ADS_RETRIES");
  if (get("X_ADS_API_VERSION") && get("X_ADS_API_VERSION") !== "12") missing.push("X_ADS_API_VERSION");
  let accountIds: string[] = [];
  try {
    accountIds = [
      ...new Set(
        (get("X_ADS_ACCOUNT_IDS") || "")
          .split(",")
          .filter(Boolean)
          .map((id) => xId(id.trim())),
      ),
    ];
  } catch {
    missing.push("X_ADS_ACCOUNT_IDS");
  }
  const primary = get("X_ADS_PRIMARY_CONVERSION_METRIC") || null;
  const isConversion = (v: string) => (X_CONVERSIONS as readonly string[]).includes(v);
  if (primary && !isConversion(primary)) missing.push("X_ADS_PRIMARY_CONVERSION_METRIC");
  const maps: Record<string, Record<string, string>> = {};
  for (const key of ["X_ADS_CLIENT_MAPPING", "X_ADS_PRIMARY_CONVERSION_MAPPING", "X_ADS_CONVERSION_MAPPING"]) {
    try {
      const value: unknown = JSON.parse(get(key) || "{}");
      if (!object(value)) throw new Error();
      const map = Object.create(null) as Record<string, string>;
      for (const [id, label] of Object.entries(value)) {
        if (typeof label !== "string" || !label.trim() || label.length > 120) throw new Error();
        if (key === "X_ADS_CONVERSION_MAPPING") {
          if (!isConversion(id) || !(CONVERSION_CATEGORIES as readonly string[]).includes(label)) throw new Error();
        } else {
          xId(id);
          if (key === "X_ADS_PRIMARY_CONVERSION_MAPPING" && !isConversion(label)) throw new Error();
        }
        map[id] = label.trim();
      }
      maps[key] = map;
    } catch {
      missing.push(key);
    }
  }
  const attribution = get("X_ADS_CONVERSION_ATTRIBUTION") || "post_engagement",
    reportMode = get("X_ADS_REPORT_MODE") || "auto";
  if (!["post_engagement", "post_view"].includes(attribution)) missing.push("X_ADS_CONVERSION_ATTRIBUTION");
  if (!["auto", "sync", "async"].includes(reportMode)) missing.push("X_ADS_REPORT_MODE");
  const config: XConfig | null = missing.length
    ? null
    : {
        consumerKey: get(X_REQUIRED[0])!,
        consumerSecret: get(X_REQUIRED[1])!,
        accessToken: get(X_REQUIRED[2])!,
        accessTokenSecret: get(X_REQUIRED[3])!,
        accountIds,
        clientMapping: maps.X_ADS_CLIENT_MAPPING!,
        primary,
        primaryMapping: maps.X_ADS_PRIMARY_CONVERSION_MAPPING!,
        conversionMapping: maps.X_ADS_CONVERSION_MAPPING!,
        attribution: attribution as XConfig["attribution"],
        reportMode: reportMode as XConfig["reportMode"],
        timeoutMs,
        retries,
      };
  return { config, missing: [...new Set(missing)] };
}
