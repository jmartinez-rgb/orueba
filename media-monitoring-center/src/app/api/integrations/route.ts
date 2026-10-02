import { hasPermission, requireAuth } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/services/snapshot";
import { getIntegrations } from "@/lib/services/integrations";
import { json, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    return json({ ok: true, integrations: getIntegrations(await getSnapshot(), { canViewTechnical: hasPermission(session, "technical:view") }) });
  } catch (err) {
    return serverError("api", err, "integrations");
  }
}
