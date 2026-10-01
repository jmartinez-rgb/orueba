import { ApiError } from "../../utils/errors.js";

export const META_GRAPH_URL = "https://graph.facebook.com";
export interface MetaConfig {
  version: "v25.0" | "v26.0";
  accessToken: string;
  appSecret?: string;
  accountIds: string[];
  businessIds: string[];
  includeBusinessMetadata: boolean;
  clientMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  primaryAction?: string;
  primaryActions: Record<string, string>;
  /**
   * Acción principal por nombre de campaña (gana sobre la de la cuenta y la global). Permite medir
   * campañas de un mismo tipo con su propia acción, p. ej. las que dicen «CAPI WhatsApp».
   */
  primaryRules: Array<{ contains: string; action: string }>;
  timeoutMs: number;
  retries: number;
}

export function metaId(value: string): string {
  if (!/^\d{1,30}$/.test(value)) throw new ApiError("INVALID_REQUEST", "Meta requiere un ID numérico.");
  return value;
}
/** El modelo público usa el ID numérico; act_ se agrega solo en Graph API. */
export function metaAccountId(value: string): string {
  return metaId(value.replace(/^act_/, ""));
}

function stringMap(value: string, accounts = false): Record<string, string> {
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => {
      if (typeof item !== "string" || !item.trim() || item.length > 200 || /[\r\n]/.test(item)) throw new Error();
      return [accounts ? metaAccountId(key) : key, item.trim()];
    }),
  );
}

export function readMetaConfig(
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = 15000,
): { config: MetaConfig | null; missing: string[] } {
  const get = (key: string) => env[key]?.trim() || undefined;
  const missing: string[] = [];
  const token = get("META_ACCESS_TOKEN");
  if (!token || /[\r\n]/.test(token)) missing.push("META_ACCESS_TOKEN");
  const version = get("META_API_VERSION") ?? "v26.0";
  if (version !== "v25.0" && version !== "v26.0") missing.push("META_API_VERSION");
  const timeout = Number(get("META_TIMEOUT_MS") ?? timeoutMs);
  const retries = Number(get("META_RETRIES") ?? 2);
  const businessMetadata = get("META_INCLUDE_BUSINESS_METADATA") ?? "false";
  if (!["true", "false"].includes(businessMetadata)) missing.push("META_INCLUDE_BUSINESS_METADATA");
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) missing.push("META_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("META_RETRIES");
  const values = {
    accountIds: [] as string[],
    businessIds: [] as string[],
    clientMapping: {} as Record<string, string>,
    conversionMapping: {} as Record<string, string>,
    primaryActions: {} as Record<string, string>,
    primaryRules: [] as Array<{ contains: string; action: string }>,
  };
  const parse = (name: string, fn: (value: string) => void) => {
    const value = get(name);
    if (value) {
      try {
        fn(value);
      } catch {
        missing.push(name);
      }
    }
  };
  parse("META_AD_ACCOUNT_IDS", (v) => {
    values.accountIds = [...new Set(v.split(",").map((id) => metaAccountId(id.trim())))];
  });
  parse("META_BUSINESS_IDS", (v) => {
    values.businessIds = [...new Set(v.split(",").map((id) => metaId(id.trim())))];
  });
  parse("META_CLIENT_MAPPING", (v) => {
    values.clientMapping = stringMap(v, true);
  });
  parse("META_CONVERSION_MAPPING", (v) => {
    values.conversionMapping = stringMap(v);
  });
  parse("META_PRIMARY_CONVERSION_MAPPING", (v) => {
    values.primaryActions = stringMap(v, true);
  });
  parse("META_PRIMARY_CONVERSION_RULES", (v) => {
    const raw: unknown = JSON.parse(v);
    if (!Array.isArray(raw) || raw.length > 50) throw new Error();
    values.primaryRules = raw.map((r: unknown) => {
      if (!r || typeof r !== "object") throw new Error();
      const { campaign_contains: contains, action } = r as Record<string, unknown>;
      if (typeof contains !== "string" || !contains.trim() || contains.length > 120) throw new Error();
      if (typeof action !== "string" || !/^[\w.:-]{1,200}$/.test(action)) throw new Error();
      return { contains: contains.trim(), action };
    });
  });
  const primaryAction = get("META_PRIMARY_CONVERSION_ACTION");
  if (primaryAction && !/^[\w.:-]{1,200}$/.test(primaryAction)) missing.push("META_PRIMARY_CONVERSION_ACTION");
  if (Object.values(values.primaryActions).some((v) => !/^[\w.:-]{1,200}$/.test(v)))
    missing.push("META_PRIMARY_CONVERSION_MAPPING");
  if (missing.length || !token) return { config: null, missing: [...new Set(missing)] };
  return {
    config: {
      version: version as MetaConfig["version"],
      accessToken: token,
      appSecret: get("META_APP_SECRET"),
      ...values,
      includeBusinessMetadata: businessMetadata === "true",
      primaryAction,
      timeoutMs: timeout,
      retries,
    },
    missing: [],
  };
}
