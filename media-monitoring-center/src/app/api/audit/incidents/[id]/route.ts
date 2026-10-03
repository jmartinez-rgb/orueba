import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/services/activity";
import { getAppContext } from "@/lib/services/context";
import { getFullSnapshot } from "@/lib/services/snapshot";
import { AUDIT_VERDICT_LABEL, saveReview } from "@/lib/records/incident-reviews";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  verdict: z.enum(["CUMPLE", "OBSERVACION", "NO_CUMPLE"]),
  comment: z.string().trim().max(2000),
});

/** Dictamen de auditoría de un incidente. Una observación o un incumplimiento exigen comentario. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("audit:write");
  if (!session) return forbidden();
  const { id } = await ctx.params;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success || !/^(?:[A-Z]+-)?INC-[0-9]+$/.test(id)) return badRequest("Dictamen o id de incidente inválidos.");
  if (parsed.data.verdict !== "CUMPLE" && parsed.data.comment.length < 5)
    return badRequest("Explica la observación o el incumplimiento en el comentario.");
  try {
    const app = await getAppContext();
    if (!(await getFullSnapshot()).state.incidents.some(i => i.id === id)) return json({ ok: false, message: "El incidente no existe en esta marca." }, 404);
    const review = await saveReview(app.brand, { incidentId: id, verdict: parsed.data.verdict, comment: parsed.data.comment, by: session.user.name });
    await logActivity(session, "AUDIT_REVIEWED", `${id} · ${AUDIT_VERDICT_LABEL[review.verdict]}`);
    return json({ ok: true, review });
  } catch (err) {
    return serverError("api", err, "audit/incidents/[id]");
  }
}
