import { requireAuth } from "@/lib/auth/session";
import { PLATFORM_IDS } from "@/lib/types";
import { getSnapshot } from "@/lib/services/snapshot";
import { json, serverError, unauthorized } from "@/lib/services/http";
import { platformCard } from "@/lib/services/view-models";

export const dynamic = "force-dynamic";

/** Resumen compacto del estado actual (para integraciones y n8n). */
export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  try {
    const snap = await getSnapshot();
    return json({
      ok: true,
      asOf: snap.meta.asOf,
      businessDate: snap.meta.businessDate,
      cutoffHour: snap.meta.cutoffHour,
      overall: snap.overall,
      platforms: PLATFORM_IDS.map((p) => {
        const c = platformCard(snap, p);
        return { platform: p, severity: c.severity, dataState: c.dataState, spend: c.spend.current, expectedSpend: c.spend.expected, deviation: c.spend.deviation, lastDataAt: c.lastDataAt };
      }),
      openIncidents: snap.state.incidents.filter((i) => i.resolvedAt === null).map((i) => ({ id: i.id, platform: i.platform, severity: i.severity, title: i.title, startedAt: i.startedAt })),
      activeAlerts: snap.state.alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder).length,
    });
  } catch (err) {
    return serverError("api", err, "monitoring/snapshot");
  }
}
