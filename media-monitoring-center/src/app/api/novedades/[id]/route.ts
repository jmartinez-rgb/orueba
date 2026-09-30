import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getNovedad, updateNovedad } from "@/lib/records/novedades";
import { logActivity } from "@/lib/services/activity";
import { resolveBrand } from "@/lib/services/brand";
import { badRequest, forbidden, json, notFound, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const body = z.object({
  text: z.string().trim().max(2000).optional(),
  effectiveUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["VIGENTE", "CERRADA"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("novedades:write");
  if (!session) return forbidden("Tu rol no puede modificar novedades.");
  const { id } = await params;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Cambio inválido.");
  try {
    const current = await getNovedad(id);
    if (!current || current.brand !== (await resolveBrand(session))) return notFound("No existe esa novedad en esta marca.");
    if (parsed.data.effectiveUntil && parsed.data.effectiveUntil < current.effectiveFrom) return badRequest("La fecha final no puede ser anterior al inicio.");
    const n = await updateNovedad(id, parsed.data, session.user.name);
    await logActivity(session, "NOVEDAD_UPDATED", `${id}${parsed.data.status ? ` · ${parsed.data.status}` : ""}${parsed.data.text ? ` · ${parsed.data.text.slice(0, 80)}` : ""}`);
    return json({ ok: true, novedad: n });
  } catch (err) {
    return serverError("api", err, "novedades");
  }
}
