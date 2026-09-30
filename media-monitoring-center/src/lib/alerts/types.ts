import type { EntityLevel, MetricId, PlatformId, Severity } from "@/lib/types";
import type { AnomalyEvidence, AnomalyFamily, AnomalyType, ExplainedBy, SpendBreakdown } from "@/lib/monitoring/types";

export type AlertStatus = "NEW" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE";
export const ALERT_STATUSES: AlertStatus[] = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];

export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED";
export const INCIDENT_STATUSES: IncidentStatus[] = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED"];

interface EntityFields {
  level: EntityLevel;
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface Alert extends EntityFields {
  id: string;
  fingerprint: string;
  severity: Severity;
  maxSeverity: Severity;
  type: AnomalyType;
  family: AnomalyFamily;
  metric: MetricId;
  currentValue: number | null;
  expectedValue: number | null;
  deviation: number | null;
  maxDeviation: number | null;
  title: string;
  diagnosis: string;
  adjustments: string[];
  evidence: AnomalyEvidence[];
  detectedAt: string;
  lastUpdateAt: string;
  resolvedAt: string | null;
  status: AlertStatus;
  consecutiveRuns: number;
  incidentId: string | null;
  /** Huella del padre bajo el que se agrupó (anti-spam). */
  groupedUnder: string | null;
  cutoffHour: number;
  /** Participación en el gasto esperado de su plataforma (materialidad). */
  expectedSpendShare: number | null;
  /** ¿Qué pasó? Desglose por campaña de una caída o subida de gasto. */
  breakdown?: SpendBreakdown | null;
  explained?: ExplainedBy | null;
}

/**
 * Cambio autorizado por el equipo (p. ej. apagar campañas a propósito): mientras esté vigente,
 * la anomalía de ese alcance no se alerta. Vuelve a alertar si empeora más allá de lo autorizado.
 */
export interface Authorization {
  id: string;
  /** Huella de la anomalía autorizada (entidad + familia). */
  fingerprint: string;
  level: EntityLevel;
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  family: AnomalyFamily;
  title: string;
  /** Desviación al autorizar: si empeora más de worsenDeltaPts, vuelve a alertar. */
  deviation: number | null;
  /** Si al autorizar ya era un apagado masivo (si no, un apagado masivo posterior vuelve a alertar). */
  massStop: boolean;
  reason: string;
  authorizedBy: string;
  createdBy: string;
  createdAt: string;
  until: string;
  revokedAt: string | null;
  revokedBy: string | null;
  incidentId: string | null;
}

export type IncidentEventKind =
  | "OPENED"
  | "UPDATED"
  | "ESCALATED"
  | "DEESCALATED"
  | "WORSENED"
  | "DURATION_EXCEEDED"
  | "RECOVERED"
  | "GROUPED"
  | "STATUS"
  | "NOTE";

export interface IncidentEvent {
  at: string;
  kind: IncidentEventKind;
  severity: Severity;
  deviation: number | null;
  message: string;
  notified: boolean;
}

export interface Incident extends EntityFields {
  id: string;
  fingerprint: string;
  alertId: string;
  type: AnomalyType;
  title: string;
  metric: MetricId;
  startedAt: string;
  resolvedAt: string | null;
  lastUpdateAt: string;
  severity: Severity;
  maxSeverity: Severity;
  currentDeviation: number | null;
  maxDeviation: number | null;
  status: IncidentStatus;
  owner: string | null;
  notes: Array<{ at: string; author: string; text: string }>;
  timeline: IncidentEvent[];
  evidence: AnomalyEvidence[];
  childAlertIds: string[];
  expectedSpendShare: number | null;
  notification: {
    count: number;
    lastNotifiedAt: string | null;
    lastSeverity: Severity | null;
    lastDeviation: number | null;
    durationReminderSent: boolean;
  };
}

export type NotificationKind = "OPENED" | "ESCALATED" | "WORSENED" | "DURATION_EXCEEDED" | "RECOVERED";

export interface WhatsAppTemplatePayload {
  name: string;
  language: { code: string };
  components: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>;
}

export interface NotificationRecord {
  id: string;
  incidentId: string;
  kind: NotificationKind;
  severity: Severity;
  platform: PlatformId;
  createdAt: string;
  channel: "whatsapp" | "email";
  /** Destinatarios enmascarados (nunca se exponen completos en la UI). */
  recipients: string[];
  recipientCount: number;
  text: string;
  template: WhatsAppTemplatePayload | null;
  status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED" | "PENDING";
  detail: string | null;
}

export interface AlertState {
  alerts: Alert[];
  incidents: Incident[];
  notifications: NotificationRecord[];
  seq: { alert: number; incident: number; notification: number };
}

export function emptyAlertState(seq?: Partial<AlertState["seq"]>): AlertState {
  return { alerts: [], incidents: [], notifications: [], seq: { alert: 0, incident: 0, notification: 0, ...seq } };
}
