import { headers } from "next/headers";
import { z } from "zod";
import { requireAuth, hasPermission } from "@/lib/auth/session";
import { acknowledgeCritical, pendingCritical } from "@/lib/services/critical";
import { requestInfo } from "@/lib/records/audit";
import { TICKET_CHANNELS, type TicketChannel } from "@/lib/records/ticket-model";
import { badRequest, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Incidentes críticos abiertos que la persona actual aún no ha acusado. */
export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    return json({ ok: true, pending: await pendingCritical(session) });
  } catch (err) {
    return serverError("api", err, "critical");
  }
}

const body = z.object({
  incidentIds: z.array(z.string().regex(/^(?:[A-Z]+-)?INC-[0-9]+$/)).min(1).max(30),
  text: z.string().trim().min(20, "Describe en al menos 20 caracteres qué revisaste.").max(1000),
  reportTo: z.string().trim().min(2, "Indica a quién lo vas a reportar.").max(120),
  channel: z.enum(TICKET_CHANNELS as [TicketChannel, ...TicketChannel[]]).default("WHATSAPP"),
  createTicket: z.boolean().default(true),
  confirmed: z.literal(true, { message: "Confirma que revisaste la alerta y la vas a reportar." }),
});

/** Acuse obligatorio de alertas críticas: cualquier rol puede (y debe) hacerlo. */
export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return unauthorized();
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  try {
    const r = await acknowledgeCritical(
      session,
      parsed.data.incidentIds,
      { text: parsed.data.text, reportTo: parsed.data.reportTo, channel: parsed.data.channel, createTicket: parsed.data.createTicket && hasPermission(session, "tickets:write") },
      requestInfo(await headers()),
    );
    return json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof Error && err.message === "INCIDENT_NOT_FOUND") return json({ ok: false, message: "Los incidentes ya no están abiertos." }, 404);
    return serverError("api", err, "critical");
  }
}
