import { requireAuth } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/services/snapshot";
import { json, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  try {
    const snap = await getSnapshot();
    return json({ ok: true, asOf: snap.meta.asOf, platforms: snap.run.dataHealth });
  } catch (err) {
    return serverError("api", err, "data-health");
  }
}
