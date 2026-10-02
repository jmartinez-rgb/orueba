/**
 * Logging estructurado del servidor. Nunca registra secretos: cualquier llave que parezca
 * credencial se enmascara. Además guarda un buffer corto de eventos de integración para la
 * página de Integrations (última consulta a BigQuery, última llamada a n8n, errores...).
 */

import { explainGoogleError } from "@/lib/google/errors";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /(token|secret|password|passwd|credential|authorization|private|api[_-]?key|service[_-]?account|signature)/i;

export type IntegrationTarget = "bigquery" | "sheets" | "unified" | "n8n" | "whatsapp" | "api";

export interface IntegrationEvent {
  at: string;
  target: IntegrationTarget;
  action: string;
  ok: boolean;
  durationMs: number | null;
  detail: string | null;
}

const events: IntegrationEvent[] = [];
const MAX_EVENTS = 200;

/** Conserva códigos y host, pero ninguna ruta firmada, callback o credencial. */
export function sanitizeDiagnostic(value: string): string {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "[redactado]";
  const safe = value
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try { return `[URL ${new URL(raw).hostname}]`; }
      catch { return "[URL redactada]"; }
    })
    .replace(/\bAuthorization\s*:\s*[^\r\n]*/gi, "Authorization: [redactado]")
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [redactado]")
    .replace(/\bOAuth\s+(?:oauth_|realm=)[^\r\n]*/gi, "OAuth [redactado]")
    .replace(/(["']?[\w.-]*(?:token|secret|password|passwd|credential|authorization|private[_-]?key|api[_-]?key|signature)[\w.-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi, "$1[redactado]");
  return safe.length > 2000 ? `${safe.slice(0, 2000)}…` : safe;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[profundidad]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeDiagnostic(value);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: sanitizeDiagnostic(value.name), message: sanitizeDiagnostic(value.message) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redactado]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[lvl] ?? LEVELS.info;
}

function write(level: Level, event: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(context ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, ctx?: Record<string, unknown>) => write("debug", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => write("info", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => write("warn", event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => write("error", event, ctx),
};

export function recordIntegrationEvent(e: Omit<IntegrationEvent, "at">) {
  events.unshift({ at: new Date().toISOString(), ...e, detail: e.detail ? String(redact(e.detail)) : null });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  write(e.ok ? "info" : "error", `integration.${e.target}.${e.action}`, { ok: e.ok, durationMs: e.durationMs, detail: e.detail });
}

export function recentIntegrationEvents(target?: IntegrationTarget): IntegrationEvent[] {
  return target ? events.filter((e) => e.target === target) : [...events];
}

export function lastIntegrationEvent(target: IntegrationTarget, okOnly = false): IntegrationEvent | null {
  return events.find((e) => e.target === target && (!okOnly || e.ok)) ?? null;
}

/** Mensaje amigable para el usuario a partir de un error técnico. */
export function friendlyError(target: IntegrationTarget, err: unknown): { message: string; technical: string } {
  const technical = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const map: Record<IntegrationTarget, string> = {
    unified: "No pudimos leer el histórico de las APIs directas.",
    bigquery: "No pudimos consultar BigQuery.",
    sheets: "No pudimos leer la hoja de Google Sheets.",
    n8n: "No pudimos comunicarnos con n8n.",
    whatsapp: "No pudimos enviar la notificación de WhatsApp.",
    api: "Ocurrió un error al procesar la solicitud.",
  };
  const hint = target === "sheets" || target === "bigquery" ? explainGoogleError(technical) : null;
  return { message: hint ? `${map[target]} ${hint}` : map[target], technical: String(redact(technical)) };
}
