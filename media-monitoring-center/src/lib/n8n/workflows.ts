import type { PlatformId } from "@/lib/types";

/** Workflows de n8n que forman el sistema (documentados en docs/N8N.md). */
export interface WorkflowDef {
  id: string;
  name: string;
  kind: "ingestion" | "monitoring" | "alerting";
  trigger: string;
  purpose: string;
  platform?: PlatformId;
  /** Variable de entorno de la app relacionada (si aplica). */
  appEnv?: "N8N_MONITORING_WEBHOOK" | "N8N_ALERT_WEBHOOK" | "N8N_MANUAL_SYNC_WEBHOOK";
  /** Endpoint de la app que usa el workflow (si aplica). */
  appEndpoint?: string;
  template?: string;
}

export const WORKFLOWS: WorkflowDef[] = [
  { id: "WF01", name: "Google ingestion", kind: "ingestion", platform: "google", trigger: "Cron cada hora (:05) + webhook de sync manual", purpose: "Extrae métricas horarias de Google Ads (MCC) y hace MERGE a la tabla horaria de BigQuery; registra la carga en el sync log.", appEnv: "N8N_MANUAL_SYNC_WEBHOOK" },
  { id: "WF02", name: "Meta ingestion", kind: "ingestion", platform: "meta", trigger: "Cron cada hora (:05) + webhook de sync manual", purpose: "Extrae insights horarios de Meta Ads (Compras Offline Web Inbound y On-Facebook Purchase por separado) hacia BigQuery.", appEnv: "N8N_MANUAL_SYNC_WEBHOOK" },
  { id: "WF03", name: "TikTok ingestion", kind: "ingestion", platform: "tiktok", trigger: "Cron cada hora (:05)", purpose: "Extrae el reporte horario de TikTok Ads hacia BigQuery." },
  { id: "WF04", name: "Microsoft ingestion", kind: "ingestion", platform: "microsoft", trigger: "Cron cada hora (:05)", purpose: "Extrae el reporte horario de Microsoft Advertising (Reporting API) hacia BigQuery." },
  { id: "WF05", name: "Spotify ingestion", kind: "ingestion", platform: "spotify", trigger: "Cron cada hora (:05)", purpose: "Extrae métricas de Spotify Ads hacia BigQuery." },
  { id: "WF06", name: "X ingestion", kind: "ingestion", platform: "x", trigger: "Cron cada hora (:05)", purpose: "Extrae métricas de X Ads hacia BigQuery." },
  { id: "WF07", name: "Monitoring Runner", kind: "monitoring", trigger: "Cron 07:00–23:00 cada 2 h (configurable)", purpose: "Llama a POST /api/monitoring/evaluate: la app evalúa, agrupa incidentes (anti-spam), persiste en BigQuery y entrega notificaciones a WF08.", appEnv: "N8N_MONITORING_WEBHOOK", appEndpoint: "/api/monitoring/evaluate", template: "n8n/workflows/WF07-monitoring-runner.json" },
  { id: "WF08", name: "WhatsApp Alert", kind: "alerting", trigger: "Webhook (N8N_ALERT_WEBHOOK)", purpose: "Verifica la firma HMAC, arma el template aprobado y envía por WhatsApp Business Cloud API a cada destinatario; registra el resultado.", appEnv: "N8N_ALERT_WEBHOOK", template: "n8n/workflows/WF08-whatsapp-alert.json" },
  { id: "WF09", name: "Incident Escalation", kind: "alerting", trigger: "Sub-workflow de WF08 (kind = ESCALATED / DURATION_EXCEEDED)", purpose: "Escala a líderes (segundo nivel de destinatarios) cuando sube la severidad o se supera la duración configurada." },
  { id: "WF10", name: "Recovery Notifications", kind: "alerting", trigger: "Sub-workflow de WF08 (kind = RECOVERED)", purpose: "Envía el mensaje de recuperación con inicio, normalización, duración y desviación máxima." },
];
