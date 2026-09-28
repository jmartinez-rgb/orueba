import { getSnapshot } from "@/lib/services/snapshot";
import { alertRows } from "@/lib/services/view-models";
import { json, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const snap = await getSnapshot();
    const all = new URL(req.url).searchParams.get("all") === "1";
    const rows = alertRows(snap).filter((a) => all || (a.resolvedAt === null && !a.groupedUnder));
    const compact = rows.map((r) => {
      const { evidence, adjustments, ...rest } = r;
      void evidence;
      void adjustments;
      return rest;
    });
    return json({ ok: true, asOf: snap.meta.asOf, alerts: compact });
  } catch (err) {
    return serverError("api", err, "alerts");
  }
}
