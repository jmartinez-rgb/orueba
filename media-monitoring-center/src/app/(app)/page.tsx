import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PLATFORM_IDS } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows, chartProps, onlyMonitored, platformCard, totalKpis } from "@/lib/services/view-models";
import { formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetaStrip } from "@/components/monitoring/page-header";
import { StatusHero } from "@/components/monitoring/status-hero";
import { KpiTiles } from "@/components/monitoring/kpi-tiles";
import { PlatformCard } from "@/components/monitoring/platform-card";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { SpendPacingCard } from "@/components/monitoring/pacing-cards";
import { FreshnessList } from "@/components/monitoring/data-health";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { LiveClock } from "@/components/layout/live-clock";
import { ConfidenceMeter } from "@/components/monitoring/confidence-meter";
import { ExecutionChip } from "@/components/monitoring/execution-chip";
import { DeliveryHealthPanel, type DeliveryPanelState } from "@/components/monitoring/delivery-health-panel";
import { unifiedBudgets, unifiedDelivery } from "@/lib/integrations/unified-api";
import { demoDeliverySignals } from "@/lib/mock/delivery-health";
import { demoBudgets } from "@/lib/mock/platform-budgets";
import { buildDeliveryView } from "@/lib/services/delivery-health";
import type { Snapshot } from "@/lib/services/snapshot";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const { meta, settings } = snap;
  const tz = meta.timezone;
  const attention = settings.thresholds.attention;
  const cards = Object.fromEntries(snap.run.platforms.map((p) => [p, platformCard(snap, p)])) as Record<(typeof PLATFORM_IDS)[number], ReturnType<typeof platformCard>>;
  const alerts = alertRows(snap);
  const activeAlerts = alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
  const openIncidents = snap.state.incidents.filter((i) => i.resolvedAt === null);
  const charts = chartProps(snap);
  const canWrite = meta.permissions.includes("alerts:write");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.028em] sm:text-[34px]">
            <span className="text-primary">{meta.brand.name}</span> Media Monitoring Center
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground first-letter:uppercase">
            {meta.dateLabel} · <LiveClock timezone={tz} className="tabular font-medium text-foreground" /> · comparado con el mismo día y franja horaria de las últimas {meta.historyWeeks} semanas
          </p>
        </div>
        <MetaStrip
          items={[
            { label: "Hora de corte", value: hourLabel(meta.cutoffHour) },
            { label: "Última actualización", value: formatTimeInTz(meta.lastDataAt, tz) },
            { label: "Última sincronización", value: formatTimeInTz(meta.lastSyncAt, tz) },
            { label: "Próxima evaluación", value: formatTimeInTz(meta.nextEvaluationAt, tz) },
            { label: "Carga de datos", value: <ExecutionChip execution={snap.execution} timezone={tz} /> },
            { label: "Confianza de datos", value: <ConfidenceMeter confidence={snap.confidence.overall} compact /> },
          ]}
        />
      </header>

      <StatusHero overall={snap.overall} cards={cards} openIncidents={openIncidents.length} activeAlerts={activeAlerts.length} />

      <div className="order-4 lg:order-none">
        <KpiTiles kpis={totalKpis(snap)} attention={attention} />
      </div>

      <section aria-label="Plataformas" className="order-3 grid gap-4 sm:grid-cols-2 lg:order-none xl:grid-cols-3">
        {snap.run.platforms.map((p) => (
          <PlatformCard key={p} vm={cards[p]} timezone={tz} weeks={meta.historyWeeks} attention={attention} canEdit={meta.permissions.includes("settings:write")} />
        ))}
      </section>

      <div className="order-2 grid gap-5 lg:order-none xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Alertas activas</CardTitle>
              <CardDescription>Una alerta por anomalía; las campañas con la misma causa se agrupan.</CardDescription>
            </div>
            <Link href="/alerts" className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10">
              Ver todas <ChevronRight className="size-4" />
            </Link>
          </CardHeader>
          <CardContent>
            <AlertsTable rows={alerts} timezone={tz} canWrite={canWrite} canNovedad={meta.permissions.includes("novedades:write")} compact limit={8} attention={attention} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Incidentes abiertos</CardTitle>
              <CardDescription>Anomalías persistentes o graves. Se actualizan, no se duplican.</CardDescription>
            </div>
            <Link href="/incidents" className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10">
              Ver todos <ChevronRight className="size-4" />
            </Link>
          </CardHeader>
          <CardContent>
            <IncidentsTable incidents={snap.state.incidents} alerts={snap.state.alerts.filter((a) => a.incidentId !== null)} notifications={[]} timezone={tz} asOf={meta.asOf} canWrite={canWrite} canNovedad={meta.permissions.includes("novedades:write")} compact attention={attention} />
          </CardContent>
        </Card>
      </div>

      <div className="order-2 lg:order-none">
        <DeliveryHealthPanel state={await deliveryState(snap)} />
      </div>

      <div className="order-5 grid gap-5 lg:order-none xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SpendPacingCard curves={charts.spendCurves} pacing={charts.pacing} scopes={charts.scopes} weeks={charts.weeks} />
        </div>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Frescura de datos</CardTitle>
              <CardDescription>Último dato recibido por plataforma. Con más de {settings.freshness.delayedAfterMinutes} min de atraso se marca como atrasada.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FreshnessList health={onlyMonitored(snap.run.dataHealth, snap.run.platforms)} timezone={tz} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Salud de entrega: API unificada con datos reales; señales de ejemplo en modo demo. */
async function deliveryState(snap: Snapshot): Promise<DeliveryPanelState> {
  const demo = snap.meta.mode === "mock";
  const [delivery, budgets] = demo
    ? [{ ok: true as const, signals: demoDeliverySignals(snap), warnings: [] as string[] }, { ok: true as const, budgets: demoBudgets(snap, null) }]
    : await Promise.all([unifiedDelivery(), unifiedBudgets()]);
  if (!delivery.ok) return { kind: "unavailable", reason: delivery.reason, configured: delivery.configured };
  const [y, m, d] = snap.meta.businessDate.split("-").map(Number);
  const daysLeft = new Date(Date.UTC(y!, m!, 0)).getUTCDate() - d!;
  const view = buildDeliveryView({ signals: delivery.signals, brand: snap.meta.brand.id, platforms: snap.run.platforms, budgets: budgets.ok ? budgets.budgets : [], daysLeft });
  if (delivery.warnings.length) view.insights.push({ tone: "warn", text: `Lectura incompleta: ${delivery.warnings[0]}` });
  return { kind: "ready", view, demo };
}
