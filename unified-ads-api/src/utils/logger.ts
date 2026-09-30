import type { LoggerOptions } from "pino";
import type { AppConfig } from "../config/env.js";

/** Rutas que nunca deben aparecer en los logs (llaves, tokens y secretos). */
export const REDACT_PATHS = [
  'req.headers["x-api-key"]',
  "req.headers.authorization",
  "req.headers.cookie",
  "*.access_token",
  "*.refresh_token",
  "*.client_secret",
  "*.developer_token",
  "*.api_key",
  "*.password",
  "*.token",
];

export function loggerOptions(config: Pick<AppConfig, "env" | "logLevel">): LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: "unified-ads-api" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    ...(config.env === "development"
      ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard", ignore: "pid,hostname" } } }
      : {}),
  };
}
