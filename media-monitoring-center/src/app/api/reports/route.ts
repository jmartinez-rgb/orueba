import { z } from "zod";
import { requireAuth, requirePermission } from "@/lib/auth/session";
import { listReports, saveReport } from "@/lib/records/reports";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  try {
    return json({ ok: true, reports: await listReports(30) });
  } catch (err) {
    return serverError("api", err, "reports");
  }
}

const body = z.object({
  text: z.string().trim().min(20).max(8000),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoffHour: z.number().int().min(0).max(24),
  platforms: z.array(z.string().max(20)).max(6),
  summary: z.string().max(300),
});

/** Guarda el mensaje en el historial (el envío por WhatsApp lo hace la persona manualmente). */
export async function POST(req: Request) {
  const session = await requirePermission("reports:write");
  if (!session) return forbidden();
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("El mensaje está vacío o es inválido.");
  try {
    const r = await saveReport({ ...parsed.data, by: session.user.name });
    await logActivity(session, "REPORT_GENERATED", `${r.id} · corte ${String(parsed.data.cutoffHour).padStart(2, "0")}:00 · ${parsed.data.summary}`);
    return json({ ok: true, report: r });
  } catch (err) {
    return serverError("api", err, "reports");
  }
}
