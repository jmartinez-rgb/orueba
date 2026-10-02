import { logActivity } from "@/lib/services/activity";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { invalidate } from "@/lib/data/cache";
import { listAccounts } from "@/lib/auth/users";
import { canAssignIncident, eligibleAssignees } from "@/lib/alerts/assignment";
import { getFullSnapshot } from "@/lib/services/snapshot";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  ownerId: z.string().regex(/^[a-z0-9._-]{3,40}$/).nullable().optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED"]).optional(),
}).strict().refine(value => Object.keys(value).length > 0);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("incidents:write");
  if (!session) return forbidden();
  const { id } = await ctx.params;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success || !/^(?:[A-Z]+-)?INC-[0-9]+$/.test(id)) return badRequest("Datos o id de incidente inválidos.");
  try {
    const app = await getAppContext();
    const incident = (await getFullSnapshot()).state.incidents.find(i => i.id === id);
    if (!incident) return json({ ok: false, message: "El incidente no existe en esta marca." }, 404);
    if (incident.resolvedAt && parsed.data.status && parsed.data.status !== "RESOLVED") return badRequest("El incidente ya está resuelto.");
    if (parsed.data.status === "RESOLVED" && !parsed.data.note) return badRequest("Documenta el cierre con una nota.");
    let owner: string | null | undefined;
    if (parsed.data.ownerId !== undefined) {
      if (!canAssignIncident(session)) return forbidden("Solo quien puede delegar incidentes cambia al responsable.");
      const target = parsed.data.ownerId === null ? null : eligibleAssignees(await listAccounts(), app.brand).find(a => a.id === parsed.data.ownerId);
      if (parsed.data.ownerId !== null && !target) return badRequest("Elige una cuenta activa con acceso operativo a esta marca.");
      owner = target?.name ?? null;
    }
    await app.store.updateIncident(id, { ...parsed.data, ...(owner !== undefined ? { owner } : {}) }, session.user.name);
    await logActivity(session, "INCIDENT_UPDATED", `${id}${parsed.data.status ? ` → ${parsed.data.status}` : ""}${owner !== undefined ? ` · responsable: ${owner ?? "—"}` : ""}${parsed.data.note ? " · nota" : ""}`);
    invalidate("state:");
    return json({ ok: true, id });
  } catch (err) {
    return serverError("api", err, "incidents/[id]");
  }
}
