import "server-only";
import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { recordIntegrationEvent, sanitizeDiagnostic } from "@/lib/logging/logger";

/**
 * Integración desacoplada con n8n. La app solo dispara webhooks firmados; n8n orquesta
 * ingestas, corridas programadas, WhatsApp, escalamientos y reintentos.
 * Firma: X-IMMC-Signature = sha256=HMAC_SHA256(N8N_WEBHOOK_SECRET, `${timestamp}.${body}`).
 */

export type WebhookKind = "monitoring" | "alert" | "manualSync";

export interface WebhookResult {
  ok: boolean;
  mode: "live" | "simulated" | "not_configured";
  status: number | null;
  durationMs: number;
  attempts: number;
  message: string;
  response: unknown;
}

function urlFor(kind: WebhookKind): string | undefined {
  const n = getEnv().n8n;
  return kind === "monitoring" ? n.monitoringWebhook : kind === "alert" ? n.alertWebhook : n.manualSyncWebhook;
}

export function webhookConfigured(kind: WebhookKind): boolean {
  return Boolean(urlFor(kind));
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function triggerWebhook(kind: WebhookKind, payload: Record<string, unknown>, opts?: { retries?: number; simulate?: boolean }): Promise<WebhookResult> {
  const env = getEnv();
  const url = urlFor(kind);
  const started = Date.now();
  // La simulación es una barrera de efectos, incluso si quedaron URLs reales
  // configuradas. También protege los callers manualSync y monitoring.
  const simulated = env.useMockData || opts?.simulate === true;
  if (simulated || !url) {
    const result: WebhookResult = {
      ok: simulated,
      mode: simulated ? "simulated" : "not_configured",
      status: null,
      durationMs: 0,
      attempts: 0,
      message: simulated ? "MOCK MODE: webhook simulado; no se ejecutó n8n." : `Webhook de n8n "${kind}" sin configurar.`,
      response: null,
    };
    recordIntegrationEvent({ target: "n8n", action: `webhook:${kind}`, ok: result.ok, durationMs: 0, detail: result.message });
    return result;
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ event: kind, sentAt: timestamp, source: "izzi-media-monitoring-center", payload });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-IMMC-Event": kind,
    "X-IMMC-Timestamp": timestamp,
  };
  if (env.n8n.webhookSecret) headers["X-IMMC-Signature"] = signPayload(env.n8n.webhookSecret, timestamp, body);

  const retries = opts?.retries ?? 2;
  let lastError = "";
  let status: number | null = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.n8n.timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      status = res.status;
      const text = await res.text();
      let response: unknown = text;
      try {
        response = text ? JSON.parse(text) : null;
      } catch {
        /* respuesta en texto */
      }
      if (res.ok) {
        const result: WebhookResult = { ok: true, mode: "live", status, durationMs: Date.now() - started, attempts: attempt, message: "Webhook aceptado por n8n.", response };
        recordIntegrationEvent({ target: "n8n", action: `webhook:${kind}`, ok: true, durationMs: result.durationMs, detail: `HTTP ${status} · ${new URL(url).host}` });
        return result;
      }
      lastError = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // errores 4xx no se reintentan
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? (err.name === "AbortError" ? `Tiempo de espera agotado (${env.n8n.timeoutMs} ms)` : err.message) : String(err);
    }
    if (attempt <= retries) await sleep(500 * 3 ** (attempt - 1));
  }
  // El mensaje también llega a usuarios sin detalle técnico; sanearlo antes
  // de devolverlo evita exponer una URL firmada o credenciales del transporte.
  const safeError = sanitizeDiagnostic(lastError);
  const result: WebhookResult = {
    ok: false,
    mode: "live",
    status,
    durationMs: Date.now() - started,
    attempts: retries + 1,
    message: `n8n no aceptó el webhook: ${safeError}`,
    response: null,
  };
  recordIntegrationEvent({ target: "n8n", action: `webhook:${kind}`, ok: false, durationMs: result.durationMs, detail: `${safeError} · ${new URL(url).host}` });
  return result;
}
