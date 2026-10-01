import { readFileSync } from "node:fs";
import { ApiError } from "../../utils/errors.js";

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_API_URL = "https://googleads.googleapis.com";

export type GoogleAuth =
  | { kind: "refresh_token"; clientId: string; clientSecret: string; refreshToken: string }
  | { kind: "service_account"; email: string; privateKey: string; subject?: string };

export interface GoogleConfig {
  version: "v24" | "v25";
  auth: GoogleAuth;
  developerToken?: string;
  cloudProject?: string;
  loginCustomerId?: string;
  customerIds: string[];
  clientMapping: Record<string, string>;
  conversionMapping: Record<string, string>;
  timeoutMs: number;
  retries: number;
}

export function customerId(value: string): string {
  if (!/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(value))
    throw new ApiError("INVALID_REQUEST", "El ID de cuenta de Google Ads debe tener 10 dígitos.");
  return value.replaceAll("-", "");
}

function stringMap(value: string | undefined, normalizeKeys = false): Record<string, string> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid mapping");
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => {
      if (typeof item !== "string" || !item.trim()) throw new Error("Invalid mapping");
      return [normalizeKeys ? customerId(key) : key, item.trim()];
    }),
  );
}

/** No devuelve valores secretos ni mensajes que incluyan su contenido. */
export function readGoogleConfig(
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = 15000,
): {
  config: GoogleConfig | null;
  missing: string[];
} {
  const get = (name: string) => env[name]?.trim();
  const missing: string[] = [];
  let auth: GoogleAuth | undefined;
  const serviceJson = get("GOOGLE_ADS_SERVICE_ACCOUNT_JSON");
  const serviceFile = get("GOOGLE_ADS_SERVICE_ACCOUNT_FILE");
  if (serviceJson || serviceFile) {
    try {
      const raw = JSON.parse(serviceJson ?? readFileSync(serviceFile!, "utf8")) as Record<string, unknown>;
      if (typeof raw.client_email !== "string" || typeof raw.private_key !== "string") throw new Error();
      auth = {
        kind: "service_account",
        email: raw.client_email,
        privateKey: raw.private_key.replaceAll("\\n", "\n"),
        subject: get("GOOGLE_ADS_IMPERSONATED_USER"),
      };
    } catch {
      missing.push(serviceJson ? "GOOGLE_ADS_SERVICE_ACCOUNT_JSON" : "GOOGLE_ADS_SERVICE_ACCOUNT_FILE");
    }
  } else {
    for (const name of ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"])
      if (!get(name)) missing.push(name);
    if (!missing.length)
      auth = {
        kind: "refresh_token",
        clientId: get("GOOGLE_ADS_CLIENT_ID")!,
        clientSecret: get("GOOGLE_ADS_CLIENT_SECRET")!,
        refreshToken: get("GOOGLE_ADS_REFRESH_TOKEN")!,
      };
  }
  const version = get("GOOGLE_ADS_API_VERSION") ?? "v25";
  if (get("GOOGLE_ADS_DEVELOPER_TOKEN") && /[\r\n]/.test(get("GOOGLE_ADS_DEVELOPER_TOKEN")!))
    missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (get("GOOGLE_ADS_CLOUD_PROJECT") && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}$/.test(get("GOOGLE_ADS_CLOUD_PROJECT")!))
    missing.push("GOOGLE_ADS_CLOUD_PROJECT");
  if (version !== "v24" && version !== "v25") missing.push("GOOGLE_ADS_API_VERSION");
  // v25 usa permisos del proyecto Cloud; conserva el encabezado legacy si se proporciona.
  if (version === "v24" && !get("GOOGLE_ADS_DEVELOPER_TOKEN")) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  let loginCustomerId: string | undefined;
  let customerIds: string[] = [];
  let clientMapping: Record<string, string> = {};
  let conversionMapping: Record<string, string> = {};
  const parse = (name: string, fn: (value: string) => void) => {
    const value = get(name);
    if (!value) return;
    try {
      fn(value);
    } catch {
      missing.push(name);
    }
  };
  parse("GOOGLE_ADS_LOGIN_CUSTOMER_ID", (v) => {
    loginCustomerId = customerId(v);
  });
  parse("GOOGLE_ADS_CUSTOMER_IDS", (v) => {
    customerIds = [...new Set(v.split(",").map((id) => customerId(id.trim())))];
  });
  parse("GOOGLE_ADS_CLIENT_MAPPING", (v) => {
    clientMapping = stringMap(v, true);
  });
  parse("GOOGLE_ADS_CONVERSION_MAPPING", (v) => {
    conversionMapping = stringMap(v);
  });
  const timeout = Number(get("GOOGLE_ADS_TIMEOUT_MS") ?? timeoutMs);
  const retries = Number(get("GOOGLE_ADS_RETRIES") ?? 2);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) missing.push("GOOGLE_ADS_TIMEOUT_MS");
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) missing.push("GOOGLE_ADS_RETRIES");
  if (missing.length || !auth) return { config: null, missing };
  return {
    config: {
      version: version as GoogleConfig["version"],
      auth,
      developerToken: get("GOOGLE_ADS_DEVELOPER_TOKEN"),
      cloudProject: get("GOOGLE_ADS_CLOUD_PROJECT"),
      loginCustomerId,
      customerIds,
      clientMapping,
      conversionMapping,
      timeoutMs: timeout,
      retries,
    },
    missing: [],
  };
}
