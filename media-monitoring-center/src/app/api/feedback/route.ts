import { z } from "zod";
import { headers } from "next/headers";
import { requireAuth, hasPermission } from "@/lib/auth/session";
import { createFeedback, FEEDBACK_IMPACTS, listFeedback, listFeedbackBy, type FeedbackImpact } from "@/lib/records/feedback";
import { requestInfo } from "@/lib/records/audit";
import { logActivity } from "@/lib/services/activity";
import { badRequest, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** El administrador ve todos; cada persona solo ve los que envió (para saber su estado). */
export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    const all = hasPermission(session, "feedback:manage");
    return json({ ok: true, scope: all ? "all" : "mine", feedback: all ? await listFeedback() : await listFeedbackBy(session.user.id) });
  } catch (err) {
    return serverError("api", err, "feedback");
  }
}

const body = z.object({
  kind: z.enum(["BUG", "SUGERENCIA"]),
  title: z.string().trim().min(5, "El título necesita al menos 5 caracteres.").max(140),
  description: z.string().trim().min(10, "Cuéntanos un poco más (mínimo 10 caracteres).").max(4000),
  page: z.string().trim().max(120).nullable().default(null),
  impact: z.enum(FEEDBACK_IMPACTS as [FeedbackImpact, ...FeedbackImpact[]]).default("MEDIO"),
});

const DAILY_LIMIT = 30;

/** Cualquier persona con sesión puede enviar un bug o una sugerencia. */
export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return unauthorized();
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  try {
    const since = new Date(Date.now() - 86400000).toISOString();
    const recent = (await listFeedbackBy(session.user.id)).filter((f) => f.createdAt >= since).length;
    if (recent >= DAILY_LIMIT) return json({ ok: false, message: "Enviaste muchos reportes hoy; intenta mañana." }, 429);
    const info = requestInfo(await headers());
    const fb = await createFeedback(parsed.data, { id: session.user.id, name: session.user.name, role: session.role }, info.agent);
    await logActivity(session, "FEEDBACK_SENT", `${fb.id} · ${fb.kind === "BUG" ? "Bug" : "Sugerencia"} · ${fb.title}`);
    return json({ ok: true, id: fb.id });
  } catch (err) {
    return serverError("api", err, "feedback");
  }
}
