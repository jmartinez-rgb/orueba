import { requirePermission } from "@/lib/auth/session";
import { buildAuditView } from "@/lib/services/audit";
import { getSnapshot } from "@/lib/services/snapshot";
import { badRequest, forbidden, json, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Auditoría de incidencias del periodo (7, 30 o 90 días) para la marca activa. */
export async function GET(req: Request) {
  const session = await requirePermission("audit:view");
  if (!session) return forbidden();
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  if (![7, 30, 90].includes(days)) return badRequest("El periodo debe ser 7, 30 o 90 días.");
  try {
    return json({ ok: true, ...(await buildAuditView(await getSnapshot(), days)) });
  } catch (err) {
    return serverError("api", err, "audit/incidents");
  }
}
