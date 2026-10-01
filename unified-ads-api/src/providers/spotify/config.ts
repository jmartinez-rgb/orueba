import { ApiError } from "../../utils/errors.js";

export const SPOTIFY_REQUIRED = [
  "SPOTIFY_ADS_CLIENT_ID",
  "SPOTIFY_ADS_CLIENT_SECRET",
  "SPOTIFY_ADS_REFRESH_TOKEN",
] as const;
export const CONVERSION_FIELDS = [
  "PAGE_VIEWS",
  "LEADS",
  "ADD_TO_CART",
  "PURCHASES",
  "START_CHECKOUT",
  "PRODUCTS",
  "SIGN_UPS",
  "CUSTOM_EVENT_1",
  "CUSTOM_EVENT_2",
  "CUSTOM_EVENT_3",
  "CUSTOM_EVENT_4",
  "CUSTOM_EVENT_5",
] as const;
export const PERFORMANCE_FIELDS = [
  "SPEND",
  "IMPRESSIONS",
  "CLICKS",
  "REACH",
  "FREQUENCY",
  "VIDEO_VIEWS",
  "FIRST_QUARTILES",
  "MIDPOINTS",
  "THIRD_QUARTILES",
  "COMPLETES",
  "REVENUE",
] as const;
export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function spotifyId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
    throw new ApiError("INVALID_REQUEST", "Spotify Ads requiere identificadores UUID.");
  return value.toLowerCase();
}
export const conversionField = (value: string) => (CONVERSION_FIELDS as readonly string[]).includes(value);
export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountIds: string[];
  businessIds: string[];
  clientMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  primaryMetric: string | null;
  primaryMapping: Record<string, string>;
  timeoutMs: number;
  retries: number;
}
export function readSpotifyConfig(env: Readonly<Record<string, string | undefined>>, timeoutMs = 15000) {
  const get = (key: string) => env[key]?.trim() || undefined;
  const missing: string[] = [];
  for (const key of SPOTIFY_REQUIRED) if (!get(key) || /[\r\n]/.test(get(key)!)) missing.push(key);
  const clientId = get("SPOTIFY_ADS_CLIENT_ID") ?? "";
  if (clientId && !/^[A-Za-z\d_-]{1,128}$/.test(clientId)) missing.push("SPOTIFY_ADS_CLIENT_ID");
  const version = get("SPOTIFY_ADS_API_VERSION") ?? "v3";
  if (version !== "v3") missing.push("SPOTIFY_ADS_API_VERSION");
  const timeout = Number(get("SPOTIFY_ADS_TIMEOUT_MS") ?? timeoutMs);
  const retries = Number(get("SPOTIFY_ADS_RETRIES") ?? 2);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) missing.push("SPOTIFY_ADS_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("SPOTIFY_ADS_RETRIES");
  const ids: Record<string, string[]> = {};
  for (const key of ["SPOTIFY_ADS_ACCOUNT_IDS", "SPOTIFY_ADS_BUSINESS_IDS"]) {
    try {
      ids[key] = get(key)
        ? [
            ...new Set(
              get(key)!
                .split(",")
                .map((v) => spotifyId(v.trim())),
            ),
          ]
        : [];
    } catch {
      missing.push(key);
    }
  }
  const primary = get("SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC") ?? null;
  if (primary && !conversionField(primary)) missing.push("SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC");
  const maps: Record<string, Record<string, string>> = {};
  for (const key of [
    "SPOTIFY_ADS_CLIENT_MAPPING",
    "SPOTIFY_ADS_CONVERSION_MAPPING",
    "SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING",
  ]) {
    try {
      const parsed: unknown = JSON.parse(get(key) ?? "{}");
      if (!object(parsed)) throw new Error();
      const map = Object.create(null) as Record<string, string>;
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error();
        const mapId = key === "SPOTIFY_ADS_CONVERSION_MAPPING" ? id : spotifyId(id);
        if (key === "SPOTIFY_ADS_CONVERSION_MAPPING" && !conversionField(id)) throw new Error();
        if (key === "SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING" && !conversionField(value)) throw new Error();
        map[mapId] = value.trim();
      }
      maps[key] = map;
    } catch {
      missing.push(key);
    }
  }
  const config: SpotifyConfig | null = missing.length
    ? null
    : {
        clientId,
        clientSecret: get("SPOTIFY_ADS_CLIENT_SECRET")!,
        refreshToken: get("SPOTIFY_ADS_REFRESH_TOKEN")!,
        accountIds: ids.SPOTIFY_ADS_ACCOUNT_IDS!,
        businessIds: ids.SPOTIFY_ADS_BUSINESS_IDS!,
        clientMapping: maps.SPOTIFY_ADS_CLIENT_MAPPING!,
        conversionMapping: maps.SPOTIFY_ADS_CONVERSION_MAPPING!,
        primaryMapping: maps.SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING!,
        primaryMetric: primary,
        timeoutMs: timeout,
        retries,
      };
  return { config, missing: [...new Set(missing)] };
}
