import { ApiError } from "../../utils/errors.js";

export const MICROSOFT_REQUIRED = [
  "MICROSOFT_ADS_DEVELOPER_TOKEN",
  "MICROSOFT_ADS_CLIENT_ID",
  "MICROSOFT_ADS_CLIENT_SECRET",
  "MICROSOFT_ADS_REFRESH_TOKEN",
] as const;
export const MICROSOFT_SCOPE = "https://ads.microsoft.com/msads.manage offline_access";
export interface MicrosoftConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenant: string;
  accountIds: string[];
  clientMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  timeoutMs: number;
  retries: number;
  pollMs: number;
  completeData: boolean;
}

/** Microsoft Long is an Int64. Keep IDs as strings through JSON and CSV. */
export function microsoftId(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw new ApiError("INVALID_REQUEST", "Microsoft requiere IDs enteros positivos de 64 bits, en texto.");
  return id;
}
export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readMicrosoftConfig(env: Readonly<Record<string, string | undefined>>, timeoutMs = 15000) {
  const get = (key: string) => env[key]?.trim() || undefined;
  const missing: string[] = [];
  for (const key of MICROSOFT_REQUIRED) {
    const value = get(key);
    if (!value || /[\r\n]/.test(value)) missing.push(key);
  }
  const clientId = get("MICROSOFT_ADS_CLIENT_ID") ?? "";
  if (clientId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clientId))
    missing.push("MICROSOFT_ADS_CLIENT_ID");
  const tenant = get("MICROSOFT_ADS_TENANT") ?? "common";
  if (!/^(?:common|organizations|consumers|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(tenant))
    missing.push("MICROSOFT_ADS_TENANT");
  const timeout = Number(get("MICROSOFT_ADS_TIMEOUT_MS") ?? timeoutMs);
  const retries = Number(get("MICROSOFT_ADS_RETRIES") ?? 2);
  const pollMs = Number(get("MICROSOFT_ADS_POLL_INTERVAL_MS") ?? 5000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) missing.push("MICROSOFT_ADS_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("MICROSOFT_ADS_RETRIES");
  if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 30000) missing.push("MICROSOFT_ADS_POLL_INTERVAL_MS");
  const complete = get("MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA") ?? "false";
  if (!["true", "false"].includes(complete)) missing.push("MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA");
  let accountIds: string[] = [];
  const maps: Record<string, Record<string, string>> = {};
  for (const key of ["MICROSOFT_ADS_CLIENT_MAPPING", "MICROSOFT_ADS_CONVERSION_MAPPING"]) {
    try {
      const data: unknown = JSON.parse(get(key) ?? "{}");
      if (!object(data)) throw new Error();
      const map = Object.create(null) as Record<string, string>;
      for (const [id, value] of Object.entries(data)) {
        if (key.endsWith("CLIENT_MAPPING")) microsoftId(id);
        if (!id || typeof value !== "string" || !value.trim() || value.length > 120) throw new Error();
        map[id] = value;
      }
      maps[key] = map;
    } catch {
      missing.push(key);
    }
  }
  try {
    if (get("MICROSOFT_ADS_ACCOUNT_IDS"))
      accountIds = [
        ...new Set(
          get("MICROSOFT_ADS_ACCOUNT_IDS")!
            .split(",")
            .map((v) => microsoftId(v.trim())),
        ),
      ];
  } catch {
    missing.push("MICROSOFT_ADS_ACCOUNT_IDS");
  }
  const config: MicrosoftConfig | null = missing.length
    ? null
    : {
        developerToken: get("MICROSOFT_ADS_DEVELOPER_TOKEN")!,
        clientId,
        clientSecret: get("MICROSOFT_ADS_CLIENT_SECRET")!,
        refreshToken: get("MICROSOFT_ADS_REFRESH_TOKEN")!,
        tenant,
        accountIds,
        clientMapping: maps.MICROSOFT_ADS_CLIENT_MAPPING!,
        conversionMapping: maps.MICROSOFT_ADS_CONVERSION_MAPPING!,
        timeoutMs: timeout,
        retries,
        pollMs,
        completeData: complete === "true",
      };
  return { config, missing: [...new Set(missing)] };
}
