import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth/session";
import { TICKET_CHANNELS, TICKET_STATUSES, updateTicket, type TicketChannel, type TicketStatus } from "@/lib/records/tickets";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  status: z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]).optional(),
  text: z.string().max(2000).optional(),
  externalRef: z.string().max(80).nullable().optional(),
  owner: z.string().max(80).nullable().optional(),
  reportedTo: z.string().max(120).optional(),
  channel: z.enum(TICKET_CHANNELS as [TicketChannel, ...TicketChannel[]]).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("tickets:write");
  if (!session) return forbidden();
  const { id } = await ctx.params;
  if (!/^TKT-\d{4,}$/.test(id)) return badRequest("Ticket inválido.");
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Datos inválidos.");
  const p = parsed.data;
  const managing = p.status !== undefined || p.externalRef !== undefined || p.owner !== undefined || p.reportedTo !== undefined || p.channel !== undefined;
  if (managing && !hasPermission(session, "tickets:manage")) return forbidden("Tu rol puede comentar el ticket, pero no cambiar su estado ni datos de seguimiento.");
  try {
    const t = await updateTicket(id, p, session.user.name);
    if (!t) return json({ ok: false, message: "No existe el ticket." }, 404);
    await logActivity(session, "TICKET_UPDATED", `${id}${p.status ? ` → ${p.status}` : ""}${p.text ? " · comentario" : ""}`);
    return json({ ok: true, ticket: t });
  } catch (err) {
    return serverError("api", err, "tickets/[id]");
  }
}
