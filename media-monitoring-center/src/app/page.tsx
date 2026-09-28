import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PLATFORM_IDS } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows, chartProps, platformCard, totalKpis } from "@/lib/services/view-models";
import { formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetaChip } from "@/components/monitoring/page-header";
import { StatusHero } from "@/components/monitoring/status-hero";
import { KpiTiles } from "@/components/monitoring/kpi-tiles";
import { PlatformCard } from "@/components/monitoring/platform-card";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { SpendPacingCard } from "@/components/monitoring/pacing-cards";
import { FreshnessList } from "@/components/monitoring/data-health";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { LiveClock } from "@/components/layout/live-clock";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const { meta, settings } = snap;
  const tz = meta.timezone;
  const attention = settings.thresholds.attention;
  const cards = Object.fromEntries(PLATFORM_IDS.map((p) => [p, platformCard(snap, p)])) as Record<(typeof PLATFORM_IDS)[number], ReturnType<typeof platformCard>>;
  const alerts = alertRows(snap);
  const activeAlerts = alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
  const openIncidents = snap.state.incidents.filter((i) => i.resolvedAt === null);
  const charts = chartProps(snap);
  const canWrite = meta.permissions.includes("alerts:write");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">IZZI MEDIA MONITORING CENTER</h1>
          <p className="text-xs text-muted-foreground first-letter:uppercase">
            {meta.dateLabel} · <LiveClock timezone={tz} className="tabular font-medium text-foreground" /> · comparación: mismo día de la semana y misma franja horaria ({meta.historyWeeks} semanas)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MetaChip label="Hora de corte" value={hourLabel(meta.cutoffHour)} />
          <MetaChip label="Última actualización" value={formatTimeInTz(meta.lastDataAt, tz)} />
          <MetaChip label="Última sincronización" value={formatTimeInTz(meta.lastSyncAt, tz)} />
          <MetaChip label="Próxima evaluación" value={formatTimeInTz(meta.nextEvaluationAt, tz)} />
        </div>
      </div>

      <StatusHero overall={snap.overall} cards={cards} openIncidents={openIncidents.length} activeAlerts={activeAlerts.length} />

      <div className="order-4 lg:order-none">
        <KpiTiles kpis={totalKpis(snap)} attention={attention} />
      </div>

      <section aria-label="Plataformas" className="order-3 grid gap-3 sm:grid-cols-2 lg:order-none xl:grid-cols-3">
        {PLATFORM_IDS.map((p) => (
          <PlatformCard key={p} vm={cards[p]} timezone={tz} weeks={meta.historyWeeks} attention={attention} />
        ))}
      </section>

      <div className="order-2 grid gap-4 lg:order-none xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Alertas activas</CardTitle>
              <CardDescription>Una alerta por anomalía; las campañas con la misma causa se agrupan.</CardDescription>
            </div>
            <Link href="/alerts" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Alert Center <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <AlertsTable rows={alerts} timezone={tz} canWrite={canWrite} compact limit={8} attention={attention} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Incidentes abiertos</CardTitle>
              <CardDescription>Anomalías persistentes o graves. Se actualizan, no se duplican.</CardDescription>
            </div>
            <Link href="/incidents" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Incidents <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <IncidentsTable incidents={snap.state.incidents} notifications={[]} timezone={tz} asOf={meta.asOf} canWrite={canWrite} compact attention={attention} />
          </CardContent>
        </Card>
      </div>

      <div className="order-5 grid gap-4 lg:order-none xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SpendPacingCard curves={charts.spendCurves} pacing={charts.pacing} scopes={charts.scopes} weeks={charts.weeks} />
        </div>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Data freshness</CardTitle>
              <CardDescription>Último dato recibido por plataforma. Atraso &gt; {settings.freshness.delayedAfterMinutes} min = DATA DELAYED.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FreshnessList health={snap.run.dataHealth} timezone={tz} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
