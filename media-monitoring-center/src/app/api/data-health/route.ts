import { getSnapshot } from "@/lib/services/snapshot";
import { json, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await getSnapshot();
    return json({ ok: true, asOf: snap.meta.asOf, platforms: snap.run.dataHealth });
  } catch (err) {
    return serverError("api", err, "data-health");
  }
}
