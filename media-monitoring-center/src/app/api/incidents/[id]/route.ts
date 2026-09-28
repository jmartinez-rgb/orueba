import { logActivity } from "@/lib/services/activity";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { invalidate } from "@/lib/data/cache";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  owner: z.string().max(120).nullable().optional(),
  note: z.string().min(1).max(2000).optional(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED"]).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("incidents:write");
  if (!session) return forbidden();
  const { id } = await ctx.params;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success || !/^INC-[0-9]+$/.test(id)) return badRequest("Datos o id de incidente inválidos.");
  try {
    const app = await getAppContext();
    await app.store.updateIncident(id, parsed.data, session.user.name);
    await logActivity(session, "INCIDENT_UPDATED", `${id}${parsed.data.status ? ` → ${parsed.data.status}` : ""}${parsed.data.owner !== undefined ? ` · responsable: ${parsed.data.owner ?? "—"}` : ""}${parsed.data.note ? " · nota" : ""}`);
    invalidate("state:");
    return json({ ok: true, id });
  } catch (err) {
    return serverError("api", err, "incidents/[id]");
  }
}
