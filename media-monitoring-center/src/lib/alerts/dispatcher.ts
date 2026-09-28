import "server-only";
import { getEnv } from "@/lib/config/env";
import { triggerWebhook } from "@/lib/n8n/client";
import { recordIntegrationEvent } from "@/lib/logging/logger";
import type { MonitoringSettings } from "@/lib/config/settings";
import { recipientsFor } from "./incident-manager";
import type { NotificationRecord } from "./types";

/**
 * Despacho de notificaciones: la app NUNCA llama a WhatsApp directamente.
 * Cada notificación se entrega al webhook de alertas de n8n, que la envía por
 * WhatsApp Business Cloud API (o email) con sus propias credenciales.
 */
export async function dispatchNotifications(list: NotificationRecord[], settings: MonitoringSettings): Promise<NotificationRecord[]> {
  const env = getEnv();
  const out: NotificationRecord[] = [];
  for (const n of list) {
    if (n.channel === "whatsapp" && !env.whatsapp.enabled && !env.useMockData) {
      out.push({ ...n, status: "SKIPPED", detail: "WHATSAPP_ALERTS_ENABLED=false: no se envió." });
      continue;
    }
    const result = await triggerWebhook("alert", {
      notificationId: n.id,
      incidentId: n.incidentId,
      kind: n.kind,
      severity: n.severity,
      platform: n.platform,
      channel: n.channel,
      text: n.text,
      whatsappTemplate: n.template,
      recipientCount: n.recipientCount,
      // Destinatarios completos solo viajan servidor → n8n (nunca al navegador).
      recipients: recipientsFor(settings, n.severity, n.platform, n.channel).map((r) => ({ name: r.name, address: r.address })),
    });
    const status: NotificationRecord["status"] = result.mode === "simulated" ? "SIMULATED" : result.ok ? "SENT" : "FAILED";
    if (n.channel === "whatsapp") {
      recordIntegrationEvent({ target: "whatsapp", action: n.kind.toLowerCase(), ok: result.ok, durationMs: result.durationMs, detail: `${n.id} · ${status}` });
    }
    out.push({ ...n, status, detail: result.message });
  }
  return out;
}
