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

export type DataSourceKind = "mock" | "sheets" | "bigquery";

export interface ServerEnv {
  appName: string;
  /** Fuente de datos efectiva: simulada, Google Sheets (Dataslayer) o BigQuery. */
  dataSource: DataSourceKind;
  /** Lo que se pidió en DATA_SOURCE (si se pidió y falta configuración, se usa mock y se avisa). */
  requestedDataSource: DataSourceKind | null;
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
  sheets: {
    spreadsheetId: string | undefined;
    mappingJson: string | undefined;
    mappingFile: string;
    /** Solo fuera de producción: lee la hoja desde un archivo JSON (pruebas sin Google). */
    fixtureFile: string | undefined;
    credentials: boolean;
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
  /** API unificada de plataformas (unified-ads-api): estado de conexión de cada plataforma. */
  unifiedApi: {
    url: string | undefined;
    apiKey: string | undefined;
    timeoutMs: number;
    configured: boolean;
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
  const level = (str("LOG_LEVEL") ?? "info").toLowerCase();

  const serviceAccountJson = str("GOOGLE_SERVICE_ACCOUNT");
  const clientEmail = str("GOOGLE_CLIENT_EMAIL");
  const privateKey = str("GOOGLE_PRIVATE_KEY");
  const credentials = Boolean(serviceAccountJson || (clientEmail && privateKey));
  const spreadsheetId = str("SHEETS_SPREADSHEET_ID");
  const fixtureFile = process.env.NODE_ENV !== "production" ? str("SHEETS_FIXTURE_FILE") : undefined;
  const sheetsConfigured = Boolean(spreadsheetId && (credentials || fixtureFile));
  const requestedRaw = (str("DATA_SOURCE") ?? "").toLowerCase();
  const requested: DataSourceKind | null = requestedRaw === "sheets" || requestedRaw === "bigquery" || requestedRaw === "mock" ? requestedRaw : null;
  // DATA_SOURCE manda; si no se define, USE_MOCK_DATA=false elige Sheets o BigQuery según lo configurado.
  // Si falta configuración, se usa el modo simulado para no romper la app (Integrations lo avisa).
  let dataSource: DataSourceKind;
  if (requested === "sheets") dataSource = sheetsConfigured ? "sheets" : "mock";
  else if (requested === "bigquery") dataSource = bqConfigured ? "bigquery" : "mock";
  else if (requested === "mock" || bool("USE_MOCK_DATA", true)) dataSource = "mock";
  else dataSource = sheetsConfigured ? "sheets" : bqConfigured ? "bigquery" : "mock";

  cached = {
    appName: str("NEXT_PUBLIC_APP_NAME") ?? "izzi Media Monitoring Center",
    dataSource,
    requestedDataSource: requested,
    useMockData: dataSource === "mock",
    mockScenario: str("MOCK_SCENARIO"),
    mockReferenceTime: str("MOCK_REFERENCE_TIME"),
    timezone: str("APP_TIMEZONE"),
    bigquery: {
      projectId,
      dataset,
      stateDataset: str("BIGQUERY_STATE_DATASET") ?? dataset,
      location: str("BIGQUERY_LOCATION") ?? "US",
      serviceAccountJson,
      clientEmail,
      privateKey,
      mappingJson: str("BIGQUERY_MAPPING"),
      mappingFile: str("BIGQUERY_MAPPING_FILE") ?? "config/bigquery.mapping.json",
      maxBytesBilled: int("BIGQUERY_MAX_BYTES_BILLED", 5 * 1024 ** 3),
      configured: bqConfigured,
    },
    sheets: {
      spreadsheetId,
      mappingJson: str("SHEETS_MAPPING"),
      mappingFile: str("SHEETS_MAPPING_FILE") ?? "config/sheets.mapping.json",
      fixtureFile,
      credentials,
      configured: sheetsConfigured,
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
    unifiedApi: {
      url: str("UNIFIED_ADS_API_URL")?.replace(/\/+$/, ""),
      apiKey: str("UNIFIED_ADS_API_KEY"),
      timeoutMs: int("UNIFIED_ADS_API_TIMEOUT_MS", 8000),
      configured: Boolean(str("UNIFIED_ADS_API_URL") && str("UNIFIED_ADS_API_KEY")),
    },
    logLevel: level === "debug" || level === "warn" || level === "error" ? level : "info",
  };
  return cached;
}

/** Solo para pruebas. */
export function resetEnvCache() {
  cached = null;
}
