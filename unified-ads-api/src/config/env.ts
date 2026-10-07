import { z } from "zod";
import { hashApiKey, parseApiKeys } from "../utils/api-keys.js";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === "" ? fallback : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()),
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Llaves internas separadas por coma: en texto (mín. 24 caracteres) o "sha256:<hex>". */
  API_KEYS: z.string().default(""),
  /** Orígenes permitidos para CORS separados por coma (vacío = ninguno). */
  CORS_ORIGINS: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),
  TRUST_PROXY: bool(false),
  /** Swagger y /docs/json. Sin valor: activo fuera de producción e inactivo en producción. */
  DOCS_ENABLED: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === "" ? null : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()),
    ),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  /** Archivo privado (0600) donde se conservan los refresh tokens que las plataformas rotan. */
  TOKEN_STORE_FILE: z.string().optional(),
  /** "postgres": conserva esos tokens en DATABASE_URL (alojamientos sin disco persistente, como Replit). */
  TOKEN_STORE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export interface AppConfig {
  env: Env["NODE_ENV"];
  host: string;
  port: number;
  logLevel: Env["LOG_LEVEL"];
  /** Huellas SHA-256 de las llaves válidas (nunca se guardan en texto). */
  apiKeyHashes: Buffer[];
  corsOrigins: string[];
  rateLimit: { max: number; timeWindow: string };
  trustProxy: boolean;
  docsEnabled: boolean;
  providerTimeoutMs: number;
  /** Ruta del almacén de refresh tokens rotados, o null si no se conservan. */
  tokenStoreFile: string | null;
  /** Conexión PostgreSQL del almacén de tokens rotados (TOKEN_STORE=postgres), o null. */
  tokenStoreDatabaseUrl: string | null;
  /** Variables de proveedores (solo para saber si están configurados; se leen al integrar cada uno). */
  providerEnv: Readonly<Record<string, string | undefined>>;
  version: string;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuración inválida:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

const PROVIDER_ENV_PREFIXES = ["GOOGLE_ADS_", "META_", "TIKTOK_", "MICROSOFT_ADS_", "SPOTIFY_ADS_", "X_ADS_"];

export function loadConfig(source: NodeJS.ProcessEnv = process.env, version = "0.0.0"): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success)
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  const e = parsed.data;
  const keys = parseApiKeys(e.API_KEYS);
  const issues = [...keys.errors];
  const tokenStore = e.TOKEN_STORE?.trim().toLowerCase() || "file";
  const databaseUrl = e.DATABASE_URL?.trim() || null;
  if (tokenStore !== "file" && tokenStore !== "postgres") issues.push("TOKEN_STORE: usa file o postgres.");
  if (tokenStore === "postgres" && !databaseUrl) issues.push("TOKEN_STORE=postgres requiere DATABASE_URL.");
  if (tokenStore === "postgres" && e.TOKEN_STORE_FILE?.trim())
    issues.push("TOKEN_STORE=postgres no se combina con TOKEN_STORE_FILE: elige un solo almacén.");
  if (e.NODE_ENV !== "test" && keys.hashes.length === 0)
    issues.push("API_KEYS: define al menos una llave interna (X-API-Key).");
  if (issues.length) throw new ConfigError(issues);
  const providerEnv = Object.fromEntries(
    Object.entries(source).filter(([k]) => PROVIDER_ENV_PREFIXES.some((p) => k.startsWith(p))),
  );
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    apiKeyHashes: keys.hashes,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    rateLimit: { max: e.RATE_LIMIT_MAX, timeWindow: e.RATE_LIMIT_WINDOW },
    trustProxy: e.TRUST_PROXY,
    docsEnabled: e.DOCS_ENABLED ?? e.NODE_ENV !== "production",
    providerTimeoutMs: e.PROVIDER_TIMEOUT_MS,
    tokenStoreFile: e.TOKEN_STORE_FILE?.trim() || null,
    tokenStoreDatabaseUrl: tokenStore === "postgres" ? databaseUrl : null,
    providerEnv,
    version,
  };
}

/** Configuración mínima para pruebas: una llave conocida y sin proveedores. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "test",
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    apiKeyHashes: [hashApiKey("test-key-0123456789abcdefghij")],
    corsOrigins: [],
    rateLimit: { max: 1000, timeWindow: "1 minute" },
    trustProxy: false,
    docsEnabled: true,
    providerTimeoutMs: 2000,
    tokenStoreFile: null,
    tokenStoreDatabaseUrl: null,
    providerEnv: {},
    version: "0.0.0-test",
    ...overrides,
  };
}
