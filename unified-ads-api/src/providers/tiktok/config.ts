import { ApiError } from "../../utils/errors.js";

export const TIKTOK_BASE_URL = "https://business-api.tiktok.com";
/** Contrato GET v1.3 documentado y publicado en el SDK oficial. v2.0 usa otro contrato. */
export const TIKTOK_API_VERSION = "v1.3";
export const CONVERSION_METRICS: Readonly<Record<string, { category: string | null; value?: string }>> = {
  conversion: { category: null },
  complete_payment: { category: "PURCHASE", value: "total_complete_payment_rate" },
  form: { category: "LEAD" },
  onsite_form: { category: "LEAD" },
  total_purchase: { category: "PURCHASE", value: "total_purchase_value" },
  total_registration: { category: "REGISTRATION" },
  on_web_order: { category: "ORDER" },
  onsite_shopping: { category: "PURCHASE", value: "total_onsite_shopping_value" },
};
export interface TikTokConfig {
  version: typeof TIKTOK_API_VERSION;
  accessToken: string;
  appId?: string;
  appSecret?: string;
  advertiserIds: string[];
  clientMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  conversionMetrics: string[];
  primaryMetric: string;
  primaryMetrics: Record<string, string>;
  timeoutMs: number;
  retries: number;
}
export function tiktokId(value: string): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,29}$/.test(value))
    throw new ApiError("INVALID_REQUEST", "TikTok requiere un ID numérico positivo en texto.");
  return value;
}
function stringMap(value: string, accounts = false): Record<string, string> {
  const raw: unknown = JSON.parse(value);
  if (!tiktokMap(raw)) throw new Error();
  return Object.fromEntries(Object.entries(raw).map(([key, item]) => [accounts ? tiktokId(key) : key, item.trim()]));
}
function tiktokMap(raw: unknown): raw is Record<string, string> {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.values(raw).every((v) => typeof v === "string" && v.trim() && v.length <= 200 && !/[\r\n]/.test(v))
  );
}
export function readTikTokConfig(
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = 15000,
): { config: TikTokConfig | null; missing: string[] } {
  const get = (key: string) => env[key]?.trim() || undefined;
  const missing: string[] = [];
  const token = get("TIKTOK_ACCESS_TOKEN"),
    appId = get("TIKTOK_APP_ID"),
    appSecret = get("TIKTOK_APP_SECRET");
  if (!token || /[\r\n]/.test(token)) missing.push("TIKTOK_ACCESS_TOKEN");
  if (appId && !/^[1-9]\d{0,29}$/.test(appId)) missing.push("TIKTOK_APP_ID");
  if (appSecret && /[\r\n]/.test(appSecret)) missing.push("TIKTOK_APP_SECRET");
  if ((get("TIKTOK_API_VERSION") ?? TIKTOK_API_VERSION) !== TIKTOK_API_VERSION) missing.push("TIKTOK_API_VERSION");
  const timeout = Number(get("TIKTOK_TIMEOUT_MS") ?? timeoutMs),
    retries = Number(get("TIKTOK_RETRIES") ?? 2);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) missing.push("TIKTOK_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("TIKTOK_RETRIES");
  const values = {
    advertiserIds: [] as string[],
    clientMapping: {} as Record<string, string>,
    conversionMapping: {} as Record<string, string>,
    primaryMetrics: {} as Record<string, string>,
    conversionMetrics: Object.keys(CONVERSION_METRICS),
  };
  const parse = (name: string, fn: (v: string) => void) => {
    const value = get(name);
    if (value)
      try {
        fn(value);
      } catch {
        missing.push(name);
      }
  };
  parse("TIKTOK_ADVERTISER_IDS", (v) => {
    values.advertiserIds = [...new Set(v.split(",").map((id) => tiktokId(id.trim())))];
  });
  if (!values.advertiserIds.length) {
    if (!appId) missing.push("TIKTOK_APP_ID");
    if (!appSecret) missing.push("TIKTOK_APP_SECRET");
  }
  parse("TIKTOK_CLIENT_MAPPING", (v) => {
    values.clientMapping = stringMap(v, true);
  });
  parse("TIKTOK_CONVERSION_MAPPING", (v) => {
    values.conversionMapping = stringMap(v);
    if (Object.keys(values.conversionMapping).some((k) => !Object.hasOwn(CONVERSION_METRICS, k))) throw new Error();
  });
  parse("TIKTOK_PRIMARY_CONVERSION_MAPPING", (v) => {
    values.primaryMetrics = stringMap(v, true);
    if (Object.values(values.primaryMetrics).some((k) => !Object.hasOwn(CONVERSION_METRICS, k))) throw new Error();
  });
  parse("TIKTOK_CONVERSION_METRICS", (v) => {
    values.conversionMetrics = [...new Set(v.split(",").map((k) => k.trim()))];
    if (values.conversionMetrics.some((k) => !Object.hasOwn(CONVERSION_METRICS, k))) throw new Error();
  });
  const primaryMetric = get("TIKTOK_PRIMARY_CONVERSION_METRIC") ?? "conversion";
  if (!Object.hasOwn(CONVERSION_METRICS, primaryMetric)) missing.push("TIKTOK_PRIMARY_CONVERSION_METRIC");
  if (missing.length || !token) return { config: null, missing: [...new Set(missing)] };
  return {
    config: {
      version: TIKTOK_API_VERSION,
      accessToken: token,
      appId,
      appSecret,
      ...values,
      primaryMetric,
      timeoutMs: timeout,
      retries,
    },
    missing: [],
  };
}
