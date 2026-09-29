import { z } from "zod";
import { requireAuth, requirePermission } from "@/lib/auth/session";
import { createTicket, listTickets, TICKET_CATEGORIES, TICKET_CHANNELS, type TicketCategory, type TicketChannel } from "@/lib/records/tickets";
import { logActivity } from "@/lib/services/activity";
import { resolveBrand } from "@/lib/services/brand";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    return json({ ok: true, tickets: await listTickets(await resolveBrand(session)) });
  } catch (err) {
    return serverError("api", err, "tickets");
  }
}

const body = z.object({
  title: z.string().trim().min(5, "El título necesita al menos 5 caracteres.").max(160),
  description: z.string().trim().min(10, "Describe el problema (mínimo 10 caracteres).").max(4000),
  severity: z.enum(["NORMAL", "ATTENTION", "ALERT", "CRITICAL"]),
  category: z.enum(TICKET_CATEGORIES as [TicketCategory, ...TicketCategory[]]),
  platform: z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]).nullable(),
  accountName: z.string().max(120).nullable().default(null),
  incidentIds: z.array(z.string().regex(/^(?:[A-Z]+-)?INC-[0-9]+$/)).max(20).default([]),
  reportedTo: z.string().trim().max(120).default(""),
  channel: z.enum(TICKET_CHANNELS as [TicketChannel, ...TicketChannel[]]).default("WHATSAPP"),
  externalRef: z.string().max(80).nullable().default(null),
  owner: z.string().max(80).nullable().default(null),
});

export async function POST(req: Request) {
  const session = await requirePermission("tickets:write");
  if (!session) return forbidden();
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Datos del ticket inválidos.");
  try {
    const t = await createTicket(parsed.data, session.user.name, await resolveBrand(session));
    await logActivity(session, "TICKET_CREATED", `${t.id} · ${t.title}`);
    return json({ ok: true, ticket: t });
  } catch (err) {
    return serverError("api", err, "tickets");
  }
}
