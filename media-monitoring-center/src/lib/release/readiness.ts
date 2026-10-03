import type { ServerEnv } from "@/lib/config/env";
import type { AuthConfig } from "@/lib/auth/config";
import type { RecordBackend } from "@/lib/records/store";
import type { UnifiedProvider } from "@/lib/integrations/unified-api";

const PLATFORM_IDS = [
  "google",
  "meta",
  "tiktok",
  "microsoft",
  "spotify",
  "x",
] as const;

/** All six known platforms must be present exactly once. Access alone never certifies reports. */
export function v1ProviderAccess(providers: UnifiedProvider[]) {
  return {
    available:
      providers.length === PLATFORM_IDS.length &&
      PLATFORM_IDS.every((id) => {
        const matches = providers.filter((p) => p.id === id);
        return (
          matches.length === 1 &&
          matches[0].implemented &&
          matches[0].status.configured &&
          matches[0].status.state === "connected"
        );
      }),
    providers: PLATFORM_IDS.map((id) => {
      const matches = providers.filter((p) => p.id === id);
      if (matches.length !== 1)
        return {
          id,
          state: "pending",
          code: matches.length ? "DUPLICATE_PROVIDER" : "MISSING_PROVIDER",
        };
      const provider = matches[0];
      const rawCode = provider.status.last_error?.code;
      return {
        id,
        state: provider.status.state,
        code: rawCode && /^[A-Z_]{1,80}$/.test(rawCode) ? rawCode : null,
      };
    }),
  };
}

export interface ReadinessCheck {
  id: "data" | "auth" | "records" | "unified_api";
  status: "configured" | "pending";
  code: string;
  variables: string[];
}

/** Configuration only: never certifies real metrics, attribution, persistence after restart or release acceptance. */
export function v1Configuration(
  env: Pick<
    ServerEnv,
    "dataSource" | "requestedDataSource" | "sheets" | "bigquery" | "unifiedApi"
  > & Pick<Partial<ServerEnv>, "unifiedData">,
  auth: Pick<AuthConfig, "mode" | "accounts" | "issues"> & Pick<Partial<AuthConfig>, "alertResponders" | "primaryAdminId">,
  backend: RecordBackend,
  unifiedMappingReady = false,
) {
  const liveData = env.dataSource !== "mock" && (env.dataSource !== "unified" || Boolean(env.unifiedData?.configured && unifiedMappingReady));
  const usernames = new Set(auth.accounts.map((account) => account.username));
  // Without the nominal list the role policy returns (administrators and operators outside the list could
  // write alerts); without a protected primary administrator nobody keeps maximum control.
  const accessPolicy = !auth.primaryAdminId || !usernames.has(auth.primaryAdminId)
    ? "PRIMARY_ADMIN_MISSING"
    : !auth.alertResponders?.length
      ? "ALERT_RESPONDERS_MISSING"
      : auth.alertResponders.some((id) => !usernames.has(id))
        ? "ALERT_RESPONDERS_UNKNOWN"
        : null;
  const accounts =
    auth.mode === "password" &&
    auth.accounts.length > 0 &&
    auth.issues.length === 0;
  const secured = accounts && accessPolicy === null;
  const persistent = backend !== "memory";
  const checks: ReadinessCheck[] = [
    {
      id: "data",
      status: liveData ? "configured" : "pending",
      code: liveData
        ? "REAL_SOURCE_CONFIGURED"
        : env.requestedDataSource && env.requestedDataSource !== "mock"
          ? "SOURCE_CONFIGURATION_MISSING"
          : "DEMO_DATA",
      variables: liveData
        ? []
        : env.requestedDataSource === "unified"
          ? ["DATA_SOURCE", "UNIFIED_ADS_DATA_DIR", "UNIFIED_ADS_MAPPING_FILE"]
        : env.requestedDataSource === "bigquery"
          ? ["DATA_SOURCE", "GOOGLE_CLOUD_PROJECT", "BIGQUERY_DATASET"]
          : [
              "DATA_SOURCE",
              "SHEETS_SPREADSHEET_ID",
              "GOOGLE_CLIENT_EMAIL",
              "GOOGLE_PRIVATE_KEY",
            ],
    },
    {
      id: "auth",
      status: secured ? "configured" : "pending",
      code: secured
        ? "NAMED_ACCOUNTS_CONFIGURED"
        : auth.mode === "header"
          ? "SSO_REQUIRES_VERIFICATION"
          : accounts && accessPolicy
            ? accessPolicy
            : "NAMED_ACCOUNTS_CONFIGURATION_MISSING",
      variables: secured
        ? []
        : accounts && accessPolicy
          ? [accessPolicy === "PRIMARY_ADMIN_MISSING" ? "AUTH_PRIMARY_ADMIN_ID" : "ALERT_RESPONDER_USER_IDS"]
          : ["AUTH_SECRET", "AUTH_USERS"],
    },
    {
      id: "records",
      status: persistent ? "configured" : "pending",
      code: persistent ? "RECORD_BACKEND_CONFIGURED" : "VOLATILE_RECORDS",
      variables: persistent ? [] : ["RECORDS_BACKEND", "RECORDS_DIR"],
    },
    {
      id: "unified_api",
      status: env.unifiedApi.configured ? "configured" : "pending",
      code: env.unifiedApi.configured
        ? "API_CONFIGURATION_PRESENT"
        : "API_CONFIGURATION_MISSING",
      variables: env.unifiedApi.configured
        ? []
        : ["UNIFIED_ADS_API_URL", "UNIFIED_ADS_API_KEY"],
    },
  ];
  return {
    configurationReady: checks.every((c) => c.status === "configured"),
    checks,
  };
}
