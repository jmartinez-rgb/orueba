import type { Severity } from "@/lib/types";
import type { MonitoringSettings, Recipient } from "@/lib/config/settings";
import type { Anomaly, MonitoringRun } from "@/lib/monitoring/types";
import { atLeast, maxSeverity, severityRank } from "@/lib/anomaly-engine/severity";
import { maskAddress } from "@/lib/format";
import { buildAlertMessage, buildRecoveryMessage, SEVERITY_ES, toTemplate, type MessageContext } from "./whatsapp-format";
import type { Alert, AlertState, Incident, IncidentEvent, NotificationKind, NotificationRecord } from "./types";

/**
 * Gestión de alertas e incidentes con ANTI-SPAM:
 * - Una anomalía = una alerta viva (por huella). No se crea otra cada 2 horas.
 * - Una anomalía persistente o grave se vuelve incidente (INC-0001) y se actualiza en cada corrida.
 * - Solo se notifica al abrir (si la severidad lo amerita), al escalar, al empeorar de forma
 *   significativa, al superar la duración configurada (una vez) y al recuperarse.
 */

export interface ReconcileOptions {
  settings: MonitoringSettings;
  /** false = corrida de vista previa: actualiza estado pero no genera notificaciones. */
  notify: boolean;
  whatsapp: { templateAlert: string; templateRecovery: string; templateLanguage: string };
}

export interface ReconcileResult {
  state: AlertState;
  notifications: NotificationRecord[];
}

const pad = (n: number) => String(n).padStart(4, "0");
const SAME_SLOT_MS = 30 * 60 * 1000;
const absDev = (v: number | null) => (v === null ? 0 : Math.abs(v));

function worseDeviation(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.abs(b) > Math.abs(a) ? b : a;
}

export function recipientsFor(settings: MonitoringSettings, severity: Severity, platform: Alert["platform"], channel: Recipient["channel"]): Recipient[] {
  return settings.recipients.filter(
    (r) => r.active && r.channel === channel && atLeast(severity, r.minSeverity) && (r.platforms === "all" || r.platforms.includes(platform)),
  );
}

function alertFromAnomaly(a: Anomaly, id: string, at: string): Alert {
  return {
    id,
    fingerprint: a.fingerprint,
    level: a.level,
    platform: a.platform,
    accountId: a.accountId,
    accountName: a.accountName,
    campaignId: a.campaignId,
    campaignName: a.campaignName,
    severity: a.severity,
    maxSeverity: a.severity,
    type: a.type,
    family: a.family,
    metric: a.metric,
    currentValue: a.current,
    expectedValue: a.expected,
    deviation: a.deviation,
    maxDeviation: a.deviation,
    title: a.title,
    diagnosis: a.diagnosis,
    adjustments: a.adjustments,
    evidence: a.evidence,
    detectedAt: at,
    lastUpdateAt: at,
    resolvedAt: null,
    status: "NEW",
    consecutiveRuns: 1,
    incidentId: null,
    groupedUnder: a.groupedUnder,
    cutoffHour: a.cutoffHour,
    expectedSpendShare: a.expectedSpendShare,
  };
}

/**
 * ¿Amerita notificación? Además de la severidad mínima, una campaña pequeña solo notifica
 * si es CRÍTICA: evita mandar WhatsApp por campañas con poco peso en la inversión.
 */
export function shouldNotify(settings: MonitoringSettings, severity: Severity, level: Alert["level"], share: number | null): boolean {
  if (!atLeast(severity, settings.alerts.notifyMinSeverity)) return false;
  if (level !== "campaign" || severity === "CRITICAL") return true;
  return (share ?? 0) >= settings.detection.materialShare;
}

export function reconcile(prev: AlertState, run: MonitoringRun, opts: ReconcileOptions): ReconcileResult {
  const state: AlertState = structuredClone(prev);
  const { settings } = opts;
  const now = run.runAt;
  const notifications: NotificationRecord[] = [];
  const ctx: MessageContext = { timezone: run.timezone, cutoffHour: run.cutoffHour, now };
  const anomalies = new Map(run.anomalies.map((a) => [a.fingerprint, a]));
  const active = state.alerts.filter((a) => a.resolvedAt === null);
  const activeByFp = new Map(active.map((a) => [a.fingerprint, a]));

  // 1) Actualizar o resolver alertas vivas.
  for (const alert of active) {
    const a = anomalies.get(alert.fingerprint);
    if (!a) {
      alert.resolvedAt = now;
      alert.lastUpdateAt = now;
      if (alert.status !== "FALSE_POSITIVE") alert.status = "RESOLVED";
      continue;
    }
    alert.severity = a.severity;
    alert.maxSeverity = maxSeverity(alert.maxSeverity, a.severity);
    alert.type = a.type;
    alert.metric = a.metric;
    alert.currentValue = a.current;
    alert.expectedValue = a.expected;
    alert.deviation = a.deviation;
    alert.maxDeviation = worseDeviation(alert.maxDeviation, a.deviation);
    alert.title = a.title;
    alert.diagnosis = a.diagnosis;
    alert.adjustments = a.adjustments;
    alert.evidence = a.evidence;
    // Idempotencia: dos evaluaciones dentro de la misma ventana (p. ej. un reintento de n8n o
    // una evaluación manual junto a la programada) no cuentan como persistencia adicional.
    const sameSlot = Date.parse(now) - Date.parse(alert.lastUpdateAt) < SAME_SLOT_MS;
    alert.lastUpdateAt = now;
    if (!sameSlot) alert.consecutiveRuns += 1;
    alert.groupedUnder = a.groupedUnder;
    alert.cutoffHour = a.cutoffHour;
    alert.expectedSpendShare = a.expectedSpendShare;
  }

  // 2) Nuevas alertas.
  for (const a of run.anomalies) {
    if (activeByFp.has(a.fingerprint)) continue;
    state.seq.alert += 1;
    const alert = alertFromAnomaly(a, `ALT-${pad(state.seq.alert)}`, now);
    state.alerts.push(alert);
    activeByFp.set(a.fingerprint, alert);
  }

  const alertById = new Map(state.alerts.map((a) => [a.id, a]));
  const alertByFpActive = new Map(state.alerts.filter((a) => a.resolvedAt === null).map((a) => [a.fingerprint, a]));

  const notify = (inc: Incident, kind: NotificationKind, severity: Severity) => {
    if (!opts.notify) return false;
    const msg = kind === "RECOVERED" ? buildRecoveryMessage(inc, ctx) : buildAlertMessage(inc, kind, ctx);
    const template =
      kind === "RECOVERED"
        ? toTemplate(opts.whatsapp.templateRecovery, opts.whatsapp.templateLanguage, msg.params)
        : toTemplate(opts.whatsapp.templateAlert, opts.whatsapp.templateLanguage, msg.params);
    let created = false;
    for (const channel of ["whatsapp", "email"] as const) {
      const recipients = recipientsFor(settings, severity, inc.platform, channel);
      if (recipients.length === 0) continue;
      state.seq.notification += 1;
      const rec: NotificationRecord = {
        id: `NTF-${pad(state.seq.notification)}`,
        incidentId: inc.id,
        kind,
        severity,
        platform: inc.platform,
        createdAt: now,
        channel,
        recipients: recipients.map((r) => `${r.name} (${maskAddress(r.address)})`),
        recipientCount: recipients.length,
        text: msg.text,
        template: channel === "whatsapp" ? template : null,
        status: "PENDING",
        detail: null,
      };
      state.notifications.push(rec);
      notifications.push(rec);
      created = true;
    }
    if (created) {
      inc.notification.count += 1;
      inc.notification.lastNotifiedAt = now;
      inc.notification.lastSeverity = severity;
      inc.notification.lastDeviation = inc.currentDeviation;
    }
    return created;
  };

  const pushEvent = (inc: Incident, ev: Omit<IncidentEvent, "at">) => inc.timeline.push({ at: now, ...ev });

  // 3) Incidentes abiertos: actualizar, escalar, recuperar.
  for (const inc of state.incidents.filter((i) => i.resolvedAt === null)) {
    const alert = alertById.get(inc.alertId);
    const live = alert && alert.resolvedAt === null ? alert : undefined;
    if (!live || live.status === "FALSE_POSITIVE") {
      inc.resolvedAt = now;
      inc.lastUpdateAt = now;
      inc.status = "RESOLVED";
      const falsePositive = live?.status === "FALSE_POSITIVE";
      const shouldNotify = !falsePositive && settings.alerts.notifyRecovery && inc.notification.count > 0;
      const notified = shouldNotify ? notify(inc, "RECOVERED", inc.maxSeverity) : false;
      pushEvent(inc, {
        kind: "RECOVERED",
        severity: "NORMAL",
        deviation: null,
        message: falsePositive ? "Cerrado como falso positivo." : "Regresó a parámetros normales.",
        notified,
      });
      continue;
    }
    if (live.groupedUnder) {
      const parent = alertByFpActive.get(live.groupedUnder);
      inc.resolvedAt = now;
      inc.lastUpdateAt = now;
      inc.status = "RESOLVED";
      pushEvent(inc, {
        kind: "GROUPED",
        severity: live.severity,
        deviation: live.deviation,
        message: `Agrupado en ${parent?.incidentId ?? parent?.id ?? "incidente superior"} (misma causa en la plataforma).`,
        notified: false,
      });
      live.incidentId = parent?.incidentId ?? null;
      continue;
    }
    const prevSeverity = inc.severity;
    inc.severity = live.severity;
    inc.maxSeverity = maxSeverity(inc.maxSeverity, live.severity);
    inc.type = live.type;
    inc.title = live.title;
    inc.metric = live.metric;
    inc.currentDeviation = live.deviation;
    inc.maxDeviation = worseDeviation(inc.maxDeviation, live.deviation);
    inc.evidence = live.evidence;
    inc.lastUpdateAt = now;
    inc.expectedSpendShare = live.expectedSpendShare;
    const canNotify = shouldNotify(settings, live.severity, inc.level, live.expectedSpendShare);
    const hoursOpen = (Date.parse(now) - Date.parse(inc.startedAt)) / 3600000;
    const lastSev = inc.notification.lastSeverity;
    if (severityRank(live.severity) > severityRank(prevSeverity) || (canNotify && lastSev === null)) {
      const escalate = canNotify && (lastSev === null || severityRank(live.severity) > severityRank(lastSev));
      const notified = escalate ? notify(inc, severityRank(live.severity) > severityRank(prevSeverity) ? "ESCALATED" : "OPENED", live.severity) : false;
      pushEvent(inc, {
        kind: "ESCALATED",
        severity: live.severity,
        deviation: live.deviation,
        message: `Severidad sube de ${SEVERITY_ES[prevSeverity]} a ${SEVERITY_ES[live.severity]}.`,
        notified,
      });
    } else if (severityRank(live.severity) < severityRank(prevSeverity)) {
      pushEvent(inc, {
        kind: "DEESCALATED",
        severity: live.severity,
        deviation: live.deviation,
        message: `Severidad baja de ${SEVERITY_ES[prevSeverity]} a ${SEVERITY_ES[live.severity]}. Sigue abierto hasta normalizar.`,
        notified: false,
      });
    } else if (canNotify && inc.notification.lastDeviation !== null && absDev(live.deviation) - absDev(inc.notification.lastDeviation) >= settings.alerts.worsenDeltaPts) {
      const notified = notify(inc, "WORSENED", live.severity);
      pushEvent(inc, { kind: "WORSENED", severity: live.severity, deviation: live.deviation, message: "Empeora de forma significativa.", notified });
    } else if (canNotify && hoursOpen >= settings.alerts.escalateAfterHours && !inc.notification.durationReminderSent) {
      inc.notification.durationReminderSent = true;
      const notified = notify(inc, "DURATION_EXCEEDED", live.severity);
      pushEvent(inc, {
        kind: "DURATION_EXCEEDED",
        severity: live.severity,
        deviation: live.deviation,
        message: `Supera ${settings.alerts.escalateAfterHours} h abierto: se escala.`,
        notified,
      });
    } else {
      pushEvent(inc, { kind: "UPDATED", severity: live.severity, deviation: live.deviation, message: "Sigue activo. Actualizado sin notificar.", notified: false });
    }
  }

  // 4) Promover alertas a incidentes.
  for (const alert of state.alerts) {
    if (alert.resolvedAt !== null || alert.incidentId || alert.groupedUnder || alert.status === "FALSE_POSITIVE") continue;
    const promote = atLeast(alert.severity, settings.alerts.incidentMinSeverity) || alert.consecutiveRuns >= settings.alerts.persistRunsForIncident;
    if (!promote) continue;
    state.seq.incident += 1;
    const inc: Incident = {
      id: `INC-${pad(state.seq.incident)}`,
      fingerprint: alert.fingerprint,
      alertId: alert.id,
      level: alert.level,
      platform: alert.platform,
      accountId: alert.accountId,
      accountName: alert.accountName,
      campaignId: alert.campaignId,
      campaignName: alert.campaignName,
      type: alert.type,
      title: alert.title,
      metric: alert.metric,
      startedAt: alert.detectedAt,
      resolvedAt: null,
      lastUpdateAt: now,
      severity: alert.severity,
      maxSeverity: alert.maxSeverity,
      currentDeviation: alert.deviation,
      maxDeviation: alert.maxDeviation,
      status: "OPEN",
      owner: null,
      notes: [],
      timeline: [],
      evidence: alert.evidence,
      childAlertIds: [],
      expectedSpendShare: alert.expectedSpendShare,
      notification: { count: 0, lastNotifiedAt: null, lastSeverity: null, lastDeviation: null, durationReminderSent: false },
    };
    alert.incidentId = inc.id;
    state.incidents.push(inc);
    const notified = shouldNotify(settings, alert.severity, alert.level, alert.expectedSpendShare) ? notify(inc, "OPENED", alert.severity) : false;
    pushEvent(inc, {
      kind: "OPENED",
      severity: alert.severity,
      deviation: alert.deviation,
      message:
        alert.consecutiveRuns > 1
          ? `Anomalía persistente (${alert.consecutiveRuns} evaluaciones): se abre incidente.`
          : `Se abre incidente con severidad ${SEVERITY_ES[alert.severity]}.`,
      notified,
    });
  }

  // 5) Vincular alertas hijas agrupadas al incidente del padre.
  for (const inc of state.incidents) {
    if (inc.resolvedAt !== null) continue;
    const children = state.alerts.filter((a) => a.resolvedAt === null && a.groupedUnder === inc.fingerprint);
    inc.childAlertIds = children.map((c) => c.id);
    children.forEach((c) => (c.incidentId = inc.id));
  }

  return { state, notifications };
}

/** Cambia el estado de una alerta (acción del usuario). */
export function applyAlertStatus(state: AlertState, alertId: string, status: Alert["status"], at: string): AlertState {
  const next = structuredClone(state);
  const alert = next.alerts.find((a) => a.id === alertId);
  if (!alert) return next;
  alert.status = status;
  alert.lastUpdateAt = at;
  if (status === "RESOLVED" && alert.resolvedAt === null) alert.resolvedAt = at;
  const inc = next.incidents.find((i) => i.alertId === alertId && i.resolvedAt === null);
  if (inc) {
    if (status === "ACKNOWLEDGED" || status === "INVESTIGATING") inc.status = status;
    if (status === "RESOLVED" || status === "FALSE_POSITIVE") {
      inc.status = "RESOLVED";
      inc.resolvedAt = at;
    }
    inc.timeline.push({ at, kind: "STATUS", severity: inc.severity, deviation: inc.currentDeviation, message: `Estado cambiado a ${status}.`, notified: false });
  }
  return next;
}
