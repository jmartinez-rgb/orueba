import { requireAuth } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/services/snapshot";
import { json, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAuth())) return unauthorized();
  try {
    const snap = await getSnapshot();
    const open = new URL(req.url).searchParams.get("open") === "1";
    return json({ ok: true, asOf: snap.meta.asOf, incidents: snap.state.incidents.filter((i) => !open || i.resolvedAt === null) });
  } catch (err) {
    return serverError("api", err, "incidents");
  }
}
