import { z } from "zod";
import { cookies } from "next/headers";
import { requireAuth, requirePermission } from "@/lib/auth/session";
import { listReports, saveReport } from "@/lib/records/reports";
import { logActivity } from "@/lib/services/activity";
import { resolveBrand } from "@/lib/services/brand";
import { DOMAIN_COOKIE, parseDomainFilter } from "@/lib/domains/scope";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    const brand = await resolveBrand(session);
    if (brand === "izzi" && parseDomainFilter((await cookies()).get(DOMAIN_COOKIE)?.value) !== "all") return json({ ok: true, reports: [] });
    return json({ ok: true, reports: await listReports(30, brand) });
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
    const brand = await resolveBrand(session);
    if (brand === "izzi" && parseDomainFilter((await cookies()).get(DOMAIN_COOKIE)?.value) !== "all") return json({ ok: false, message: "Selecciona Todos los dominios antes de guardar un mensaje en el historial de la marca." }, 409);
    const r = await saveReport({ ...parsed.data, by: session.user.name, brand });
    await logActivity(session, "REPORT_GENERATED", `${r.id} · corte ${String(parsed.data.cutoffHour).padStart(2, "0")}:00 · ${parsed.data.summary}`);
    return json({ ok: true, report: r });
  } catch (err) {
    return serverError("api", err, "reports");
  }
}
