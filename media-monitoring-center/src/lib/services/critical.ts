import "server-only";
import type { PlatformId } from "@/lib/types";
import type { Incident } from "@/lib/alerts/types";
import type { AnomalyType } from "@/lib/monitoring/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { ANOMALY_LABEL } from "@/lib/anomaly-engine/anomaly-engine";
import { auditUser, type Session } from "@/lib/auth/session";
import { hasAck, listAcks, saveAck } from "@/lib/records/acks";
import { recordAudit } from "@/lib/records/audit";
import { createTicket, listTickets, OPEN_TICKET_STATUSES, type TicketCategory, type TicketChannel } from "@/lib/records/tickets";
import { invalidate } from "@/lib/data/cache";
import { getAppContext } from "./context";
import { getFullSnapshot } from "./snapshot";

/** Incidente crítico pendiente de acuse para una persona. */
export interface PendingCritical {
  id: string;
  openedAt: string;
  platform: PlatformId;
  platformName: string;
  type: string;
  title: string;
  entity: string;
  deviation: number | null;
  deviationUnit?: "%" | "pp";
  lastUpdateAt: string;
  diagnosis: string | null;
  ackedBy: string[];
  ticketId: string | null;
}

export function categoryFor(type: AnomalyType): TicketCategory {
  if (type === "TRACKING_ISSUE") return "TRACKING";
  if (type === "DATA_ISSUE") return "DATOS";
  if (type === "PLATFORM_INCIDENT") return "PLATAFORMA";
  if (type === "OVERSPEND" || type === "UNDERSPEND" || type === "PACING_DEVIATION") return "PRESUPUESTO";
  return "DELIVERY";
}

function entityOf(i: Incident): string {
  if (i.level === "ad_group") return `${i.domain_name ?? "Sin clasificar"} · ${i.accountName ?? ""} · ${i.campaignName ?? i.campaignId} → ${i.adGroupName ?? i.adGroupId}`;
  if (i.level === "campaign") return `${i.campaignName ?? i.campaignId} · ${i.accountName ?? ""}`.trim();
  if (i.level === "account") return i.accountName ?? i.accountId ?? "Cuenta";
  return PLATFORMS[i.platform].name;
}

export async function pendingCritical(session: Session): Promise<PendingCritical[]> {
  const snap = await getFullSnapshot();
  const critical = snap.state.incidents.filter((i) => i.resolvedAt === null && i.severity === "CRITICAL");
  if (!critical.length) return [];
  const tickets = await listTickets(snap.meta.brand.id).catch(() => []);
  const out: PendingCritical[] = [];
  for (const i of critical) {
    if (await hasAck(i.id, i.startedAt, session.user.id)) continue;
    const acks = await listAcks(i.id, i.startedAt);
    const alert = snap.state.alerts.find((a) => a.id === i.alertId);
    const ticket = tickets.find((t) => t.incidentIds.includes(i.id) && OPEN_TICKET_STATUSES.includes(t.status));
    out.push({
      id: i.id,
      openedAt: i.startedAt,
      platform: i.platform,
      platformName: PLATFORMS[i.platform].name,
      type: ANOMALY_LABEL[i.type],
      title: i.title,
      entity: entityOf(i),
      deviation: i.currentDeviation,
      deviationUnit: i.metric === "absolute_top_rate" ? "pp" : "%",
      lastUpdateAt: i.lastUpdateAt,
      diagnosis: alert?.diagnosis ?? null,
      ackedBy: acks.map((a) => a.userName),
      ticketId: ticket?.id ?? null,
    });
  }
  return out;
}

export async function acknowledgeCritical(
  session: Session,
  incidentIds: string[],
  input: { text: string; reportTo: string; channel: TicketChannel; createTicket: boolean },
  info: { ip: string | null; agent: string | null },
): Promise<{ ticketId: string | null; acknowledged: string[] }> {
  const snap = await getFullSnapshot();
  const incidents = snap.state.incidents.filter((i) => incidentIds.includes(i.id) && i.resolvedAt === null);
  if (!incidents.length) throw new Error("INCIDENT_NOT_FOUND");
  const by = session.user.name;
  let ticketId: string | null = null;
  if (input.createTicket) {
    const open = (await listTickets(snap.meta.brand.id)).filter((t) => OPEN_TICKET_STATUSES.includes(t.status));
    const existing = open.find((t) => incidents.every((i) => t.incidentIds.includes(i.id)));
    if (existing) ticketId = existing.id;
    else {
      const main = incidents[0];
      const platforms = [...new Set(incidents.map((i) => i.platform))];
      const t = await createTicket(
        {
          title: incidents.length === 1 ? `${PLATFORMS[main.platform].shortName}: ${main.title}` : `${platforms.map((p) => PLATFORMS[p].shortName).join(" / ")}: ${incidents.length} incidentes críticos`,
          description: `${incidents.map((i) => `• ${i.id} · ${entityOf(i)} · ${i.title}`).join("\n")}\n\n${input.text}`,
          severity: "CRITICAL",
          category: categoryFor(main.type),
          platform: platforms.length === 1 ? main.platform : null,
          accountName: incidents.length === 1 ? main.accountName : null,
          incidentIds: incidents.map((i) => i.id),
          reportedTo: input.reportTo,
          channel: input.channel,
          externalRef: null,
          owner: by,
        },
        by,
        snap.meta.brand.id,
      );
      ticketId = t.id;
      await recordAudit({ type: "TICKET_CREATED", user: auditUser(session), detail: `${t.id} desde acuse de ${incidents.map((i) => i.id).join(", ")}`, ...info, sid: session.sid });
    }
  }
  const at = new Date().toISOString();
  const ctx = await getAppContext({ brand: snap.meta.brand.id });
  for (const inc of incidents) {
    await saveAck({ incidentId: inc.id, openedAt: inc.startedAt, userId: session.user.id, userName: by, at, text: input.text, reportTo: input.reportTo, ticketId });
    await ctx.store.updateIncident(inc.id, { note: `Acuse de alerta crítica (${by}): ${input.text}${input.reportTo ? ` · Se reportará a: ${input.reportTo}` : ""}${ticketId ? ` · ${ticketId}` : ""}` }, by);
  }
  invalidate("state:");
  await recordAudit({ type: "CRITICAL_ACK", user: auditUser(session), detail: `${incidents.map((i) => i.id).join(", ")} · reporta a ${input.reportTo}`.slice(0, 300), ...info, sid: session.sid });
  return { ticketId, acknowledged: incidents.map((i) => i.id) };
}
