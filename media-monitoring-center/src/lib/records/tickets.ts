import "server-only";
import type { Severity } from "@/lib/types";
import { getRecordStore, mapLimit } from "./store";
import { OPEN_TICKET_STATUSES, TICKET_CHANNEL_LABEL, TICKET_STATUS_LABEL, type NewTicket, type Ticket, type TicketChannel, type TicketStatus } from "./ticket-model";

export * from "./ticket-model";

/**
 * Tickets de reporte: cuando un problema es grave se documenta a quién se reportó, por qué
 * canal, con qué número de caso y cómo evolucionó. Queda un histórico consultable.
 * (Registro interno: la app no abre casos en las plataformas ni cambia nada en ellas.)
 */

async function nextId(): Promise<string> {
  const store = getRecordStore();
  const cur = (await store.get<{ n: number }>("counters/tickets"))?.n ?? 0;
  // Si otro proceso tomó el mismo número, se avanza hasta uno libre.
  let n = cur + 1;
  while (await store.get(`tickets/TKT-${String(n).padStart(4, "0")}`)) n++;
  await store.set("counters/tickets", { n });
  return `TKT-${String(n).padStart(4, "0")}`;
}

export async function createTicket(input: NewTicket, by: string): Promise<Ticket> {
  const id = await nextId();
  const now = new Date().toISOString();
  const status: TicketStatus = input.reportedTo.trim() ? "REPORTADO" : "ABIERTO";
  const t: Ticket = {
    id,
    createdAt: now,
    createdBy: by,
    title: input.title.trim().slice(0, 160),
    description: input.description.trim().slice(0, 4000),
    severity: input.severity,
    category: input.category,
    platform: input.platform,
    accountName: input.accountName?.trim() || null,
    incidentIds: [...new Set(input.incidentIds)].slice(0, 20),
    reportedTo: input.reportedTo.trim().slice(0, 120),
    channel: input.channel,
    externalRef: input.externalRef?.trim().slice(0, 80) || null,
    owner: input.owner?.trim().slice(0, 80) || by,
    status,
    updates: [{ at: now, by, status, text: "Ticket creado." }],
    resolvedAt: null,
    closedAt: null,
  };
  await getRecordStore().set(`tickets/${id}`, t);
  return t;
}

export async function getTicket(id: string): Promise<Ticket | null> {
  if (!/^TKT-\d{4,}$/.test(id)) return null;
  return getRecordStore().get<Ticket>(`tickets/${id}`);
}

export async function updateTicket(
  id: string,
  patch: { status?: TicketStatus; text?: string; externalRef?: string | null; owner?: string | null; reportedTo?: string; channel?: TicketChannel },
  by: string,
): Promise<Ticket | null> {
  const t = await getTicket(id);
  if (!t) return null;
  const now = new Date().toISOString();
  const notes: string[] = [];
  if (patch.externalRef !== undefined && (patch.externalRef?.trim() || null) !== t.externalRef) {
    t.externalRef = patch.externalRef?.trim().slice(0, 80) || null;
    notes.push(`Referencia externa: ${t.externalRef ?? "—"}.`);
  }
  if (patch.owner !== undefined && (patch.owner?.trim() || null) !== t.owner) {
    t.owner = patch.owner?.trim().slice(0, 80) || null;
    notes.push(`Responsable: ${t.owner ?? "sin asignar"}.`);
  }
  if (patch.reportedTo !== undefined && patch.reportedTo.trim() !== t.reportedTo) {
    t.reportedTo = patch.reportedTo.trim().slice(0, 120);
    notes.push(`Reportado a: ${t.reportedTo || "—"}.`);
  }
  if (patch.channel && patch.channel !== t.channel) {
    t.channel = patch.channel;
    notes.push(`Canal: ${TICKET_CHANNEL_LABEL[t.channel]}.`);
  }
  let status: TicketStatus | null = null;
  if (patch.status && patch.status !== t.status) {
    status = patch.status;
    t.status = patch.status;
    if (patch.status === "RESUELTO") t.resolvedAt = now;
    if (patch.status === "CERRADO") {
      t.closedAt = now;
      t.resolvedAt ??= now;
    }
    if (OPEN_TICKET_STATUSES.includes(patch.status)) {
      t.resolvedAt = null;
      t.closedAt = null;
    }
  }
  const text = [patch.text?.trim().slice(0, 2000), ...notes].filter(Boolean).join(" ");
  if (!text && !status) return t;
  t.updates.push({ at: now, by, status, text: text || `Estado: ${TICKET_STATUS_LABEL[t.status]}.` });
  await getRecordStore().set(`tickets/${id}`, t);
  return t;
}

export async function listTickets(): Promise<Ticket[]> {
  const store = getRecordStore();
  const keys = (await store.list("tickets/")).filter((k) => /^tickets\/TKT-\d+$/.test(k));
  const rows = await mapLimit(keys, 16, (k) => store.get<Ticket>(k));
  return rows.filter((t): t is Ticket => t !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export async function openTicketStats(): Promise<{ open: number; severity: Severity }> {
  const list = (await listTickets()).filter((t) => OPEN_TICKET_STATUSES.includes(t.status));
  const order: Severity[] = ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"];
  const severity = list.reduce<Severity>((acc, t) => (order.indexOf(t.severity) > order.indexOf(acc) ? t.severity : acc), "NORMAL");
  return { open: list.length, severity };
}
