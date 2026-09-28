import type { Metadata } from "next";
import { PLATFORM_IDS } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows, chartProps, platformCard } from "@/lib/services/view-models";
import { PLATFORMS } from "@/lib/platforms/registry";
import { ANOMALY_LABEL } from "@/lib/anomaly-engine/anomaly-engine";
import { fmtMetric } from "@/lib/format";
import { durationLabel, formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetaChip, PageHeader } from "@/components/monitoring/page-header";
import { StatusStrip } from "@/components/monitoring/status-strip";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { ResultsPacingCard, SpendPacingCard } from "@/components/monitoring/pacing-cards";
import { StatusTimeline } from "@/components/monitoring/status-timeline";
import { DataHealthTable } from "@/components/monitoring/data-health";
import { DeltaText, PlatformMark, SeverityBadge, SEVERITY_META } from "@/components/monitoring/status";
import { StateMessage } from "@/components/monitoring/states";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { Countdown } from "@/components/layout/live-clock";
import { RefreshButton } from "@/components/layout/refresh-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Live Monitoring" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const { meta, settings } = snap;
  const tz = meta.timezone;
  const attention = settings.thresholds.attention;
  const cards = Object.fromEntries(PLATFORM_IDS.map((p) => [p, platformCard(snap, p)])) as Record<(typeof PLATFORM_IDS)[number], ReturnType<typeof platformCard>>;
  const charts = chartProps(snap);
  const critical = snap.state.incidents
    .filter((i) => i.resolvedAt === null && (i.severity === "CRITICAL" || i.severity === "ALERT"))
    .sort((a, b) => (a.severity === b.severity ? Date.parse(a.startedAt) - Date.parse(b.startedAt) : a.severity === "CRITICAL" ? -1 : 1));
  const now = Date.parse(meta.asOf);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Live Monitoring"
        subtitle={`Evaluación cada ${meta.intervalHours} h (${meta.slots.map((s) => hourLabel(s)).join(" · ")}) · ventana 00:00–${hourLabel(meta.cutoffHour)} vs mismo día de las últimas ${meta.historyWeeks} semanas`}
        actions={
          <>
            <MetaChip label="Hora de corte" value={hourLabel(meta.cutoffHour)} />
            <MetaChip label="Última sincronización" value={formatTimeInTz(meta.lastSyncAt, tz)} />
            <MetaChip
              label="Próximo monitoreo"
              value={
                <>
                  {formatTimeInTz(meta.nextEvaluationAt, tz)} <Countdown target={meta.nextEvaluationAt} className="text-xs font-normal text-muted-foreground" />
                </>
              }
            />
            <RefreshButton canTrigger={meta.permissions.includes("monitoring:trigger")} size="default" />
          </>
        }
      />

      <StatusStrip cards={cards} attention={attention} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Incidencias críticas</CardTitle>
            <CardDescription>Incidentes abiertos en ALERTA o CRÍTICO, con sus cifras clave.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {critical.length === 0 ? (
            <StateMessage kind="no-incidents" title="Sin incidencias críticas" description="No hay incidentes en ALERTA o CRÍTICO en este momento." compact />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {critical.map((i) => {
                const spend = i.evidence.find((e) => e.metric === "spend");
                const result = i.evidence.find((e) => e.metric !== "spend" && e.metric !== "cpr" && !["clicks", "ctr", "cpc", "cpm"].includes(e.metric));
                return (
                  <a key={i.id} href={`/incidents?id=${i.id}`} className={cn("flex flex-col gap-2 rounded-lg border p-3 hover:bg-muted/50", SEVERITY_META[i.severity].border)}>
                    <div className="flex items-center gap-2">
                      <PlatformMark platform={i.platform} className="size-5 text-[9px]" />
                      <span className="text-xs font-semibold">{PLATFORMS[i.platform].name}</span>
                      <SeverityBadge severity={i.severity} className="ml-auto" />
                    </div>
                    <p className="text-sm leading-snug font-medium">{i.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {i.id} · {ANOMALY_LABEL[i.type]} · {i.campaignName ?? i.accountName ?? "Toda la plataforma"}
                    </p>
                    {i.type !== "DATA_ISSUE" && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {spend && (
                          <div className="rounded-md bg-muted/60 px-2 py-1.5">
                            <p className="text-[10px] text-muted-foreground">Gasto vs esperado</p>
                            <p className="tabular font-semibold">
                              {fmtMetric("spend", spend.current, { compact: true })} <span className="font-normal text-muted-foreground">/ {fmtMetric("spend", spend.expected, { compact: true })}</span>
                            </p>
                            <DeltaText value={spend.deviation} attention={attention} />
                          </div>
                        )}
                        {result && (
                          <div className="rounded-md bg-muted/60 px-2 py-1.5">
                            <p className="truncate text-[10px] text-muted-foreground">{result.label}</p>
                            <p className="tabular font-semibold">
                              {fmtMetric(result.metric, result.current, { compact: true })} <span className="font-normal text-muted-foreground">/ {fmtMetric(result.metric, result.expected, { compact: true })}</span>
                            </p>
                            <DeltaText value={result.deviation} bad="down" attention={attention} />
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Detectado {formatTimeInTz(i.startedAt, tz)} · abierto {durationLabel(now - Date.parse(i.startedAt))} · {i.notification.count} notificación(es)
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Alertas</CardTitle>
            <CardDescription>Activas en la evaluación en curso.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <AlertsTable rows={alertRows(snap)} timezone={tz} canWrite={meta.permissions.includes("alerts:write")} compact attention={attention} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <SpendPacingCard curves={charts.spendCurves} pacing={charts.pacing} scopes={charts.scopes} weeks={charts.weeks} />
        <ResultsPacingCard curves={charts.resultCurves} scopes={charts.scopes} weeks={charts.weeks} available={charts.available} height={270} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Histórico del día</CardTitle>
            <CardDescription>Estado de cada plataforma en cada evaluación programada de hoy.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <StatusTimeline
            runs={snap.runs}
            slots={meta.slots}
            live={{ cutoffHour: meta.cutoffHour, overall: snap.overall, platforms: Object.fromEntries(PLATFORM_IDS.map((p) => [p, { severity: snap.platformStatus[p].severity, dataState: snap.platformStatus[p].dataState }])) as never }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Estado de datos</CardTitle>
            <CardDescription>Data Health: se valida la calidad del dato antes de evaluar rendimiento (0 ≠ NULL ≠ DATA DELAYED ≠ ERROR).</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <DataHealthTable health={snap.run.dataHealth} timezone={tz} />
        </CardContent>
      </Card>
    </div>
  );
}
