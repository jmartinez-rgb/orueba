import type { Incident, NotificationRecord } from "@/lib/alerts/types";
import type { CriticalAck } from "@/lib/records/acks";
import type { Novedad } from "@/lib/records/novedad-model";
import type { SavedReport } from "@/lib/records/reports";
import type { Ticket } from "@/lib/records/ticket-model";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";

/**
 * Auditoría del proceso de incidencias: con lo que el equipo dejó registrado, ¿se atendió a tiempo,
 * tuvo responsable, se le dio seguimiento, se reportó y se cerró como corresponde? Solo cuenta lo que
 * hicieron personas (estado, responsable, notas, acuses, tickets, mensajes de monitoreo y novedades);
 * los avisos automáticos se miden aparte.
 */

/** Metas del proceso por severidad máxima del incidente (minutos u horas). */
export const AUDIT_TARGETS: Record<"attentionMin" | "followUpHours" | "resolutionHours", Record<Severity, number>> = {
  attentionMin: { CRITICAL: 30, ALERT: 120, ATTENTION: 480, NORMAL: 1440 },
  followUpHours: { CRITICAL: 4, ALERT: 12, ATTENTION: 24, NORMAL: 48 },
  resolutionHours: { CRITICAL: 24, ALERT: 72, ATTENTION: 168, NORMAL: 336 },
};

export type CheckId = "attention" | "owner" | "followup" | "reported" | "notified" | "closure" | "resolution";
export type CheckStatus = "ok" | "fail" | "pending" | "na";
export type AuditVerdict = "CUMPLE" | "OBSERVACION" | "NO_CUMPLE";
export type AutoVerdict = "CUMPLE" | "PARCIAL" | "NO_CUMPLE" | "EN_CURSO";

export const CHECK_LABEL: Record<CheckId, string> = {
  attention: "Atención a tiempo",
  owner: "Responsable asignado",
  followup: "Seguimiento",
  reported: "Reportado por el equipo",
  notified: "Aviso automático",
  closure: "Cierre documentado",
  resolution: "Resuelto a tiempo",
};

export interface AuditCheck {
  id: CheckId;
  status: CheckStatus;
  detail: string;
}

export interface IncidentReview {
  incidentId: string;
  verdict: AuditVerdict;
  comment: string;
  by: string;
  at: string;
}

export interface HumanAction {
  at: string;
  by: string;
  what: string;
}

export interface IncidentAudit {
  incidentId: string;
  title: string;
  platform: Incident["platform"];
  accountName: string | null;
  campaignName: string | null;
  maxSeverity: Severity;
  status: Incident["status"];
  open: boolean;
  startedAt: string;
  resolvedAt: string | null;
  owner: string | null;
  firstActionAt: string | null;
  firstActionBy: string | null;
  minutesToAttention: number | null;
  actions: HumanAction[];
  checks: AuditCheck[];
  /** Porcentaje de verificaciones cumplidas entre las que ya aplican (sin pendientes ni N/A). */
  score: number | null;
  auto: AutoVerdict;
  review: IncidentReview | null;
}

export interface AuditInputs {
  incidents: Incident[];
  tickets: Ticket[];
  acks: Record<string, CriticalAck[]>;
  reports: SavedReport[];
  novedades: Novedad[];
  notifications: NotificationRecord[];
  reviews: Record<string, IncidentReview>;
  now: Date;
  /** Severidad mínima que dispara avisos automáticos (settings.alerts.notifyMinSeverity). */
  notifyMinSeverity: Severity;
}

const H = 3_600_000;
const M = 60_000;
const atLeast = (s: Severity, min: Severity) => SEVERITY_ORDER.indexOf(s) >= SEVERITY_ORDER.indexOf(min);
const fmtMin = (min: number) => (min < 60 ? `${Math.round(min)} min` : min < 48 * 60 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min / 1440)} d`);

/** Acciones de personas sobre el incidente, en orden: estado, responsable, notas y acuses críticos. */
export function humanActions(inc: Incident, acks: CriticalAck[]): HumanAction[] {
  const out: HumanAction[] = [];
  for (const a of inc.actions ?? [])
    out.push({
      at: a.at,
      by: a.by,
      what: a.kind === "STATUS" ? `Estado: ${a.value}` : a.kind === "OWNER" ? `Responsable: ${a.value ?? "sin asignar"}` : "Nota",
    });
  // Notas anteriores al registro de acciones: cuentan como acción con su fecha y autor.
  const noted = new Set(out.filter((a) => a.what === "Nota").map((a) => `${a.at}|${a.by}`));
  for (const n of inc.notes) if (!noted.has(`${n.at}|${n.author}`)) out.push({ at: n.at, by: n.author, what: "Nota" });
  for (const k of acks) out.push({ at: k.at, by: k.userName, what: `Acuse crítico${k.reportTo ? ` · reporta a ${k.reportTo}` : ""}` });
  return out.filter((a) => Number.isFinite(Date.parse(a.at))).sort((x, y) => x.at.localeCompare(y.at));
}

export function auditIncident(inc: Incident, input: AuditInputs): IncidentAudit {
  const now = input.now.getTime();
  const start = Date.parse(inc.startedAt);
  const end = inc.resolvedAt ? Date.parse(inc.resolvedAt) : now;
  const sev = inc.maxSeverity;
  const acks = input.acks[inc.id] ?? [];
  const actions = humanActions(inc, acks).filter((a) => Date.parse(a.at) >= start - 5 * M);
  const first = actions[0] ?? null;
  const attentionTarget = AUDIT_TARGETS.attentionMin[sev] * M;
  const withinAttention = now - start <= attentionTarget;
  const checks: AuditCheck[] = [];

  // 1. Atención: la primera acción de una persona dentro de la meta.
  if (first) {
    const took = Date.parse(first.at) - start;
    checks.push({
      id: "attention",
      status: took <= attentionTarget ? "ok" : "fail",
      detail: `${first.by} actuó a los ${fmtMin(Math.max(0, took) / M)} (meta ${fmtMin(attentionTarget / M)}).`,
    });
  } else if (!inc.resolvedAt && withinAttention) {
    checks.push({ id: "attention", status: "pending", detail: `Sin acción aún; meta ${fmtMin(attentionTarget / M)}.` });
  } else {
    checks.push({ id: "attention", status: "fail", detail: "Nadie registró una acción sobre el incidente." });
  }

  // 2. Responsable (desde Alerta).
  if (!atLeast(sev, "ALERT")) checks.push({ id: "owner", status: "na", detail: "No se exige por debajo de Alerta." });
  else if (inc.owner) checks.push({ id: "owner", status: "ok", detail: `Responsable: ${inc.owner}.` });
  else if (!inc.resolvedAt && withinAttention) checks.push({ id: "owner", status: "pending", detail: "Sin responsable todavía." });
  else checks.push({ id: "owner", status: "fail", detail: "Nunca se asignó responsable." });

  // 3. Seguimiento: ninguna ventana sin acciones mayor a la meta mientras estuvo abierto.
  const window = AUDIT_TARGETS.followUpHours[sev] * H;
  if (end - start <= window) {
    checks.push({ id: "followup", status: "ok", detail: `Duró menos que la ventana de seguimiento (${AUDIT_TARGETS.followUpHours[sev]} h).` });
  } else {
    const marks = [start, ...actions.map((a) => Date.parse(a.at)).filter((t) => t <= end), end];
    let gap = 0;
    for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i]! - marks[i - 1]!);
    checks.push({
      id: "followup",
      status: gap <= window ? "ok" : "fail",
      detail:
        gap <= window
          ? `Actualizado al menos cada ${AUDIT_TARGETS.followUpHours[sev]} h.`
          : `Pasaron ${fmtMin(gap / M)} sin actualización (máximo ${AUDIT_TARGETS.followUpHours[sev]} h).`,
    });
  }

  // 4. Reportado por el equipo: ticket, acuse con destinatario o mensaje de monitoreo de esa plataforma.
  if (!atLeast(sev, "ALERT")) {
    checks.push({ id: "reported", status: "na", detail: "No se exige por debajo de Alerta." });
  } else {
    const ticket = input.tickets.find((t) => t.incidentIds.includes(inc.id));
    const ack = acks.find((k) => k.reportTo?.trim());
    const report = input.reports.find((r) => {
      const at = Date.parse(r.at);
      return at >= start && at <= end + 12 * H && r.platforms.includes(inc.platform);
    });
    if (ticket) checks.push({ id: "reported", status: "ok", detail: `Ticket ${ticket.id}.` });
    else if (ack) checks.push({ id: "reported", status: "ok", detail: `Acuse de ${ack.userName}: reporta a ${ack.reportTo}.` });
    else if (report) checks.push({ id: "reported", status: "ok", detail: `Mensaje de monitoreo ${report.id} de ${report.by}.` });
    else if (!inc.resolvedAt && withinAttention) checks.push({ id: "reported", status: "pending", detail: "Aún sin reporte." });
    else checks.push({ id: "reported", status: "fail", detail: "Sin ticket, acuse ni mensaje de monitoreo que lo reporte." });
  }

  // 5. Aviso automático (lo mide el sistema, no el equipo).
  const sent = input.notifications.filter((n) => n.incidentId === inc.id);
  if (!atLeast(sev, input.notifyMinSeverity)) checks.push({ id: "notified", status: "na", detail: "Por debajo del umbral de aviso." });
  else if (sent.some((n) => n.status === "SENT" || n.status === "SIMULATED") || inc.notification.count > 0)
    checks.push({ id: "notified", status: "ok", detail: `${Math.max(sent.length, inc.notification.count)} aviso(s) enviados.` });
  else if (sent.some((n) => n.status === "FAILED")) checks.push({ id: "notified", status: "fail", detail: "El aviso falló." });
  else checks.push({ id: "notified", status: "fail", detail: "No hay registro de aviso." });

  // 6. Cierre documentado.
  if (!inc.resolvedAt) {
    checks.push({ id: "closure", status: "na", detail: "Sigue abierto." });
  } else {
    const recovered = inc.timeline.some((e) => e.kind === "RECOVERED");
    const authorized = inc.timeline.some((e) => e.kind === "STATUS" && /autorizad/i.test(e.message));
    const novedad = input.novedades.find((n) => n.incidentId === inc.id);
    const resolvedAt = Date.parse(inc.resolvedAt);
    const note = inc.notes.some((n) => Math.abs(Date.parse(n.at) - resolvedAt) <= 24 * H);
    if (recovered) checks.push({ id: "closure", status: "ok", detail: "El monitoreo detectó la recuperación." });
    else if (authorized || novedad) checks.push({ id: "closure", status: "ok", detail: novedad ? `Novedad ${novedad.id}.` : "Cambio autorizado." });
    else if (note) checks.push({ id: "closure", status: "ok", detail: "Cerrado con nota." });
    else checks.push({ id: "closure", status: "fail", detail: "Cerrado a mano sin nota ni novedad." });
  }

  // 7. Resolución dentro de la meta.
  const resolution = AUDIT_TARGETS.resolutionHours[sev] * H;
  if (inc.resolvedAt)
    checks.push({
      id: "resolution",
      status: end - start <= resolution ? "ok" : "fail",
      detail: `Resuelto en ${fmtMin((end - start) / M)} (meta ${AUDIT_TARGETS.resolutionHours[sev]} h).`,
    });
  else if (now - start <= resolution)
    checks.push({ id: "resolution", status: "pending", detail: `Abierto ${fmtMin((now - start) / M)} de ${AUDIT_TARGETS.resolutionHours[sev]} h.` });
  else checks.push({ id: "resolution", status: "fail", detail: `Abierto hace ${fmtMin((now - start) / M)}; meta ${AUDIT_TARGETS.resolutionHours[sev]} h.` });

  const decided = checks.filter((c) => c.status === "ok" || c.status === "fail");
  const ok = decided.filter((c) => c.status === "ok").length;
  const score = decided.length ? Math.round((ok / decided.length) * 100) : null;
  const failed = (id: CheckId) => checks.some((c) => c.id === id && c.status === "fail");
  const auto: AutoVerdict =
    score === null
      ? "EN_CURSO"
      : sev === "CRITICAL" && (failed("attention") || failed("reported"))
        ? "NO_CUMPLE"
        : score === 100
          ? checks.some((c) => c.status === "pending")
            ? "EN_CURSO"
            : "CUMPLE"
          : score >= 60
            ? "PARCIAL"
            : "NO_CUMPLE";

  return {
    incidentId: inc.id,
    title: inc.title,
    platform: inc.platform,
    accountName: inc.accountName,
    campaignName: inc.campaignName,
    maxSeverity: sev,
    status: inc.status,
    open: inc.resolvedAt === null,
    startedAt: inc.startedAt,
    resolvedAt: inc.resolvedAt,
    owner: inc.owner,
    firstActionAt: first?.at ?? null,
    firstActionBy: first?.by ?? null,
    minutesToAttention: first ? Math.max(0, Math.round((Date.parse(first.at) - start) / M)) : null,
    actions,
    checks,
    score,
    auto,
    review: input.reviews[inc.id] ?? null,
  };
}

export interface AuditSummary {
  total: number;
  open: number;
  reviewed: number;
  /** Promedio del porcentaje de cumplimiento de los incidentes con verificaciones decididas. */
  compliance: number | null;
  medianAttentionMin: number | null;
  /** Por verificación: cumplidas y aplicables (ok + fail). */
  byCheck: Array<{ id: CheckId; ok: number; applicable: number }>;
  /** Por responsable (o quien actuó primero si no hubo responsable). */
  byPerson: Array<{ person: string; incidents: number; compliance: number | null }>;
  verdicts: Record<AutoVerdict, number>;
  reviewVerdicts: Record<AuditVerdict, number>;
  /** Abiertos que ya rebasaron la ventana de seguimiento. */
  staleOpen: number;
}

export function summarizeAudit(rows: IncidentAudit[]): AuditSummary {
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
  };
  const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
  const ids = Object.keys(CHECK_LABEL) as CheckId[];
  const people = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const who = r.owner ?? r.firstActionBy ?? "Sin responsable";
    counts.set(who, (counts.get(who) ?? 0) + 1);
    if (r.score !== null) people.set(who, [...(people.get(who) ?? []), r.score]);
  }
  const avg = (xs: number[] | undefined) => (xs && xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    total: rows.length,
    open: rows.filter((r) => r.open).length,
    reviewed: rows.filter((r) => r.review).length,
    compliance: avg(scores),
    medianAttentionMin: median(rows.map((r) => r.minutesToAttention).filter((m): m is number => m !== null)),
    byCheck: ids.map((id) => {
      const decided = rows.flatMap((r) => r.checks.filter((c) => c.id === id && (c.status === "ok" || c.status === "fail")));
      return { id, ok: decided.filter((c) => c.status === "ok").length, applicable: decided.length };
    }),
    byPerson: [...counts.entries()]
      .map(([person, incidents]) => ({ person, incidents, compliance: avg(people.get(person)) }))
      .sort((a, b) => b.incidents - a.incidents),
    verdicts: {
      CUMPLE: rows.filter((r) => r.auto === "CUMPLE").length,
      PARCIAL: rows.filter((r) => r.auto === "PARCIAL").length,
      NO_CUMPLE: rows.filter((r) => r.auto === "NO_CUMPLE").length,
      EN_CURSO: rows.filter((r) => r.auto === "EN_CURSO").length,
    },
    reviewVerdicts: {
      CUMPLE: rows.filter((r) => r.review?.verdict === "CUMPLE").length,
      OBSERVACION: rows.filter((r) => r.review?.verdict === "OBSERVACION").length,
      NO_CUMPLE: rows.filter((r) => r.review?.verdict === "NO_CUMPLE").length,
    },
    staleOpen: rows.filter((r) => r.open && r.checks.some((c) => c.id === "followup" && c.status === "fail")).length,
  };
}

/** Auditoría de los incidentes que empezaron desde `from` (los abiertos siempre entran). */
export function auditIncidents(input: AuditInputs, from: Date): { rows: IncidentAudit[]; summary: AuditSummary } {
  const rows = input.incidents
    .filter((i) => i.resolvedAt === null || Date.parse(i.startedAt) >= from.getTime())
    .map((i) => auditIncident(i, input))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { rows, summary: summarizeAudit(rows) };
}
