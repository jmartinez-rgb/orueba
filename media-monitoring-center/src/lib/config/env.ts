import "server-only";

/**
 * Lectura centralizada de variables de entorno (solo servidor).
 * Nada de este módulo llega al navegador: los componentes cliente reciben
 * únicamente banderas booleanas ("configurado / no configurado").
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "si", "sí", "on"].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = str(name);
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function joinUrl(base: string | undefined, pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

export interface ServerEnv {
  appName: string;
  useMockData: boolean;
  mockScenario: string | undefined;
  mockReferenceTime: string | undefined;
  timezone: string | undefined;
  bigquery: {
    projectId: string | undefined;
    dataset: string | undefined;
    stateDataset: string | undefined;
    location: string;
    serviceAccountJson: string | undefined;
    clientEmail: string | undefined;
    privateKey: string | undefined;
    mappingJson: string | undefined;
    mappingFile: string;
    maxBytesBilled: number;
    configured: boolean;
  };
  n8n: {
    baseUrl: string | undefined;
    monitoringWebhook: string | undefined;
    alertWebhook: string | undefined;
    manualSyncWebhook: string | undefined;
    webhookSecret: string | undefined;
    timeoutMs: number;
    configured: boolean;
  };
  whatsapp: {
    enabled: boolean;
    templateAlert: string;
    templateRecovery: string;
    templateLanguage: string;
  };
  monitoringApiKey: string | undefined;
  auth: {
    mode: "dev" | "header";
    defaultRole: "admin" | "manager" | "viewer";
  };
  logLevel: "debug" | "info" | "warn" | "error";
}

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const projectId = str("GOOGLE_CLOUD_PROJECT");
  const dataset = str("BIGQUERY_DATASET");
  const bqConfigured = Boolean(projectId && dataset);
  const n8nBase = str("N8N_BASE_URL");
  const monitoringWebhook = joinUrl(n8nBase, str("N8N_MONITORING_WEBHOOK"));
  const alertWebhook = joinUrl(n8nBase, str("N8N_ALERT_WEBHOOK"));
  const manualSyncWebhook = joinUrl(n8nBase, str("N8N_MANUAL_SYNC_WEBHOOK"));
  const role = (str("AUTH_DEFAULT_ROLE") ?? "admin").toLowerCase();
  const level = (str("LOG_LEVEL") ?? "info").toLowerCase();

  cached = {
    appName: str("NEXT_PUBLIC_APP_NAME") ?? "izzi Media Monitoring Center",
    // Sin BigQuery configurado, el modo mock es obligatorio para no romper la app.
    useMockData: bool("USE_MOCK_DATA", true) || !bqConfigured,
    mockScenario: str("MOCK_SCENARIO"),
    mockReferenceTime: str("MOCK_REFERENCE_TIME"),
    timezone: str("APP_TIMEZONE"),
    bigquery: {
      projectId,
      dataset,
      stateDataset: str("BIGQUERY_STATE_DATASET") ?? dataset,
      location: str("BIGQUERY_LOCATION") ?? "US",
      serviceAccountJson: str("GOOGLE_SERVICE_ACCOUNT"),
      clientEmail: str("GOOGLE_CLIENT_EMAIL"),
      privateKey: str("GOOGLE_PRIVATE_KEY"),
      mappingJson: str("BIGQUERY_MAPPING"),
      mappingFile: str("BIGQUERY_MAPPING_FILE") ?? "config/bigquery.mapping.json",
      maxBytesBilled: int("BIGQUERY_MAX_BYTES_BILLED", 5 * 1024 ** 3),
      configured: bqConfigured,
    },
    n8n: {
      baseUrl: n8nBase,
      monitoringWebhook,
      alertWebhook,
      manualSyncWebhook,
      webhookSecret: str("N8N_WEBHOOK_SECRET"),
      timeoutMs: int("N8N_TIMEOUT_MS", 10000),
      configured: Boolean(monitoringWebhook || alertWebhook || manualSyncWebhook),
    },
    whatsapp: {
      enabled: bool("WHATSAPP_ALERTS_ENABLED", false),
      templateAlert: str("WHATSAPP_TEMPLATE_ALERT") ?? "izzi_media_alert",
      templateRecovery: str("WHATSAPP_TEMPLATE_RECOVERY") ?? "izzi_media_recovery",
      templateLanguage: str("WHATSAPP_TEMPLATE_LANGUAGE") ?? "es_MX",
    },
    monitoringApiKey: str("MONITORING_API_KEY"),
    auth: {
      mode: str("AUTH_MODE") === "header" ? "header" : "dev",
      defaultRole: role === "viewer" || role === "manager" ? role : "admin",
    },
    logLevel: level === "debug" || level === "warn" || level === "error" ? level : "info",
  };
  return cached;
}

/** Solo para pruebas. */
export function resetEnvCache() {
  cached = null;
}
