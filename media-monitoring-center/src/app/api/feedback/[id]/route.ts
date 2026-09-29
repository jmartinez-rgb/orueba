import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { FEEDBACK_STATUSES, updateFeedback, type FeedbackStatus } from "@/lib/records/feedback";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  status: z.enum(FEEDBACK_STATUSES as [FeedbackStatus, ...FeedbackStatus[]]).optional(),
  adminNote: z.string().max(2000).nullable().optional(),
});

/** Solo el administrador cambia el estado o responde. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("feedback:manage");
  if (!session) return forbidden("Solo el administrador gestiona los bugs y sugerencias.");
  const { id } = await ctx.params;
  if (!/^FB-\d{4,}$/.test(id)) return badRequest("Reporte inválido.");
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Datos inválidos.");
  try {
    const fb = await updateFeedback(id, parsed.data, session.user.name);
    if (!fb) return json({ ok: false, message: "No existe el reporte." }, 404);
    await logActivity(session, "FEEDBACK_UPDATED", `${id}${parsed.data.status ? ` → ${parsed.data.status}` : ""}${parsed.data.adminNote !== undefined ? " · nota" : ""}`);
    return json({ ok: true, feedback: fb });
  } catch (err) {
    return serverError("api", err, "feedback/[id]");
  }
}
