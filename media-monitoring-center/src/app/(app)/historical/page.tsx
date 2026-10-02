import type { Metadata } from "next";
import { getViewContext } from "@/lib/services/context";
import { getHistorical } from "@/lib/services/analysis";
import { safeSnapshot } from "@/lib/services/safe";
import { businessDate, zonedParts } from "@/lib/time/tz";
import { friendlyError } from "@/lib/logging/logger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { HistoricalView } from "@/components/monitoring/historical-view";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";

export const metadata: Metadata = { title: "Histórico" };
export const dynamic = "force-dynamic";

export default async function HistoricalPage() {
  const ctx = await getViewContext();
  const now = ctx.source.now();
  const tz = ctx.settings.timezone;
  let data: [Awaited<ReturnType<typeof getHistorical>>, Awaited<ReturnType<typeof safeSnapshot>>];
  try {
    data = await Promise.all([
      getHistorical(ctx, { today: businessDate(now, tz), weeks: 8, metric: "spend", cutoffHour: Math.max(1, zonedParts(now, tz).hour) }),
      safeSnapshot(),
    ]);
  } catch (err) {
    const f = friendlyError(ctx.mode === "mock" ? "api" : ctx.mode, err);
    return <ErrorPanel message={f.message} technical={f.technical} />;
  }
  const [initial, res] = data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Histórico" subtitle={`Referencia principal: ${ctx.settings.history.weeks} semanas (configurable). Revisa la evolución del gasto y compara con semanas anteriores.`} />
      <HistoricalView key={ctx.scopeKey} initial={initial} />
      {res.ok && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Historial de incidentes</CardTitle>
              <CardDescription>Incidentes resueltos con duración y desviación máxima.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <IncidentsTable
              incidents={res.snap.state.incidents.filter((i) => i.resolvedAt !== null)}
              alerts={res.snap.state.alerts.filter((a) => a.incidentId !== null)}
              notifications={res.snap.state.notifications}
              timezone={tz}
              asOf={res.snap.meta.asOf}
              canWrite={false}
              initialTab="resolved"
              attention={ctx.settings.thresholds.attention}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
