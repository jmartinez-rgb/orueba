import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { MetricId, PlatformId } from "@/lib/types";
import { CHART_RESULT_METRICS } from "@/lib/types";
import { isPlatformId, PLATFORMS } from "@/lib/platforms/registry";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows, campaignRows, chartProps, compareVM, platformCard, platformEval } from "@/lib/services/view-models";
import { METRICS } from "@/lib/metrics";
import { fmtCurrency, fmtMetric, fmtPercent } from "@/lib/format";
import { formatTimeInTz, hourLabel, shortDateLabel } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/monitoring/page-header";
import { DataStateBadge, DeltaText, isBadDataState, PlatformMark, PlatformStatusBadge } from "@/components/monitoring/status";
import { ResultsPacingCard, SpendPacingCard } from "@/components/monitoring/pacing-cards";
import { SameWeekdayBars } from "@/components/charts/weekday-bars";
import { CampaignsTable } from "@/components/monitoring/campaigns-table";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";
import { classifyCampaign } from "@/lib/classifiers/classify";
import { DEFAULT_CLASSIFIERS } from "@/lib/classifiers/defaults";
import { ConfidenceMeter } from "@/components/monitoring/confidence-meter";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const { platform } = await params;
  return { title: isPlatformId(platform) ? PLATFORMS[platform].name : "Plataforma" };
}

const CHECK_TONE = { OK: "text-status-normal-text", WARN: "text-status-attention-text", FAIL: "text-status-critical-text" };

export default async function PlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isPlatformId(platform)) notFound();
  const p = platform as PlatformId;
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const { meta, settings } = snap;
  const tz = meta.timezone;
  const attention = settings.thresholds.attention;
  const card = platformCard(snap, p);
  const ev = platformEval(snap, p);
  const bad = isBadDataState(card.dataState);
  const charts = chartProps(snap, p);
  const health = snap.run.dataHealth[p];
  const accounts = snap.run.entities.filter((e) => e.level === "account" && e.platform === p);
  // Sin repetidos: la métrica monitoreada puede ser clics o impresiones.
  const tableMetrics: MetricId[] = [...new Set<MetricId>(["spend", ev.kpi.result, "cpr", "impressions", "clicks", "ctr", "cpc", "cpm", ...PLATFORMS[p].secondaryResults])];
  const pacing = snap.run.pacing[p];
  const currencyOf = new Map(snap.catalog.accounts.map((a) => [a.id, a.currency]));
  const accountRows = [...accounts].sort((a, b) => (b.cumulative.spend?.expected ?? 0) - (a.cumulative.spend?.expected ?? 0));
  const platformSpend = ev.cumulative.spend?.current ?? 0;
  // Estrategias según el clasificador de la plataforma (fórmula por nombre de campaña).
  const classifier = settings.classifiers[p] ?? DEFAULT_CLASSIFIERS[p];
  const campaignById = new Map(snap.catalog.campaigns.map((c) => [c.id, c]));
  const strategies = new Map<string, { campaigns: number; spend: number; expected: number; result: number; resultExpected: number }>();
  for (const e of snap.run.entities.filter((x) => x.level === "campaign" && x.platform === p)) {
    const camp = campaignById.get(e.campaignId ?? "");
    if (!camp || isBadDataState(e.dataState)) continue;
    const label = classifyCampaign(classifier, camp);
    const g = strategies.get(label) ?? { campaigns: 0, spend: 0, expected: 0, result: 0, resultExpected: 0 };
    g.campaigns += 1;
    g.spend += e.cumulative.spend?.current ?? 0;
    g.expected += e.cumulative.spend?.expected ?? 0;
    g.result += e.cumulative[ev.kpi.result]?.current ?? 0;
    g.resultExpected += e.cumulative[ev.kpi.result]?.expected ?? 0;
    strategies.set(label, g);
  }
  const strategyRows = [...strategies.entries()].sort((a, b) => b[1].spend - a[1].spend);

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Ruta">
        <Link href="/platforms" className="hover:text-foreground">
          Platforms
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{PLATFORMS[p].name}</span>
      </nav>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <PlatformMark platform={p} className="size-7 text-xs" />
            {PLATFORMS[p].name}
            <PlatformStatusBadge severity={card.severity} dataState={card.dataState} size="md" />
          </span>
        }
        subtitle={
          <>
            Corte {hourLabel(card.cutoffHour)} · último dato {formatTimeInTz(card.lastDataAt, tz)} · KPI: {ev.kpi.resultLabel} / {ev.kpi.costLabel}
            {card.measurementNote && <span className="block">{card.measurementNote}</span>}
          </>
        }
      />

      {bad && (
        <Card className="border-status-data/50">
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <DataStateBadge state={card.dataState} />
            <p className="text-sm">{card.dataReason}</p>
            <p className="text-xs text-muted-foreground">No se evalúa rendimiento ni se muestran caídas mientras la fuente esté atrasada. Las cifras de abajo corresponden a los datos completos hasta {hourLabel(card.cutoffHour)}.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Gasto" value={fmtCurrency(card.spend.current)} sub={`Esperado ${fmtCurrency(card.spend.expected)}`} delta={card.spend.deviation} attention={attention} />
        <Tile
          label={card.result.label}
          value={fmtMetric(card.result.metric, card.result.current)}
          sub={card.result.lagging ? "Llegan con retraso: se juzgan con el día cerrado" : `Esperado ${fmtMetric(card.result.metric, card.result.expected)}`}
          delta={card.result.deviation}
          bad={card.result.lagging ? "none" : "down"}
          attention={attention}
        />
        <Tile label={card.cost.label} value={fmtMetric("cpr", card.cost.current)} sub={`Esperado ${fmtMetric("cpr", card.cost.expected)}`} delta={card.cost.deviation} bad="up" attention={attention} />
        <Tile label="Pacing vs presupuesto" value={fmtPercent(pacing.pctOfExpected, 0)} sub={`Esperado ${fmtCurrency(pacing.expectedByCurve)} (${fmtPercent(pacing.curveShare, 0)} del día)`} delta={pacing.deviation} attention={attention} />
        <Tile label="Forecast cierre del día" value={fmtCurrency(pacing.forecastClose)} sub={`Presupuesto diario ${fmtCurrency(pacing.dailyBudget)}`} delta={pacing.forecastVsBudget} attention={attention} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Cuentas de {PLATFORMS[p].shortName}</CardTitle>
              <CardDescription>
                {accountRows.length} cuenta(s) · gasto en MXN (las cuentas en USD se convierten con la tasa del mes) · hoy 00:00–{hourLabel(card.cutoffHour)} vs esperado.
              </CardDescription>
            </div>
            <ConfidenceMeter confidence={card.confidence} />
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuenta</TableHead>
                  <TableHead className="text-right">Gasto</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Desv.</TableHead>
                  <TableHead className="text-right">{ev.kpi.resultLabel}</TableHead>
                  <TableHead className="text-right">Desv.</TableHead>
                  <TableHead>Peso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountRows.map((a) => {
                  const delayedAcc = isBadDataState(a.dataState);
                  const spend = a.cumulative.spend?.current ?? null;
                  const share = !delayedAcc && platformSpend > 0 && spend !== null ? spend / platformSpend : null;
                  return (
                    <TableRow key={a.key}>
                      <TableCell className="text-xs font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {a.accountName}
                          {currencyOf.get(a.accountId ?? "") === "USD" && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">USD→MXN</span>}
                          {delayedAcc && <DataStateBadge state={a.dataState} />}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold">{delayedAcc ? "—" : fmtCurrency(spend)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{fmtCurrency(a.cumulative.spend?.expected ?? null)}</TableCell>
                      <TableCell className="text-right text-xs">
                        <DeltaText value={delayedAcc ? null : (a.cumulative.spend?.deltaVsExpected ?? null)} attention={attention} />
                      </TableCell>
                      <TableCell className="text-right text-xs">{delayedAcc ? "—" : fmtMetric(ev.kpi.result, a.cumulative[ev.kpi.result]?.current ?? null)}</TableCell>
                      <TableCell className="text-right text-xs">
                        <DeltaText value={delayedAcc ? null : (a.cumulative[ev.kpi.result]?.deltaVsExpected ?? null)} bad="down" attention={attention} />
                      </TableCell>
                      <TableCell className="w-28">
                        {share !== null ? (
                          <span className="flex items-center gap-1.5">
                            <span className="relative h-1.5 w-14 rounded-full bg-muted" aria-hidden>
                              <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--series-today)]" style={{ width: `${Math.min(100, share * 100)}%` }} />
                            </span>
                            <span className="tabular text-[11px] text-muted-foreground">{fmtPercent(share, 0)}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">excluida</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Estrategias</CardTitle>
              <CardDescription>Clasificación por nombre de campaña (reglas en Settings · explicación en la Guía).</CardDescription>
            </div>
            <Link href={`/compare?dimension=strategy&platform=${p}`} className="text-xs text-primary hover:underline">
              Comparar
            </Link>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {strategyRows.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Sin campañas con datos al día.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estrategia</TableHead>
                    <TableHead className="text-right">Camp.</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Desv.</TableHead>
                    <TableHead className="text-right">{ev.kpi.resultLabel}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strategyRows.map(([label, g]) => (
                    <TableRow key={label}>
                      <TableCell className="text-xs font-medium">{label}</TableCell>
                      <TableCell className="tabular text-right text-xs text-muted-foreground">{g.campaigns}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{fmtCurrency(g.spend)}</TableCell>
                      <TableCell className="text-right text-xs">
                        <DeltaText value={g.expected > 0 ? (g.spend - g.expected) / g.expected : null} attention={attention} />
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtMetric(ev.kpi.result, g.result)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SpendPacingCard curves={charts.spendCurves} pacing={charts.pacing} scopes={charts.scopes} weeks={charts.weeks} initial={p} title="Curva horaria de gasto" />
        {/* key: si cambia la métrica monitoreada, la gráfica arranca en la nueva. */}
        <ResultsPacingCard key={ev.kpi.result} curves={charts.resultCurves} scopes={charts.scopes} weeks={charts.weeks} initial={p} initialMetric={CHART_RESULT_METRICS.find((m) => m === ev.kpi.result) ?? "conversions"} available={charts.available} height={270} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Historical comparison</CardTitle>
            <CardDescription>
              Hoy 00:00–{hourLabel(card.cutoffHour)} vs {meta.comparisonDates.map((d) => shortDateLabel(d)).join(", ")} en la misma franja.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium">Gasto</p>
              <SameWeekdayBars today={card.spend.current} todayDate={meta.businessDate} samples={card.spend.samples} average={card.spend.mean} currency label="Gasto" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">{card.result.label}</p>
              <SameWeekdayBars today={card.result.current} todayDate={meta.businessDate} samples={card.result.samples} average={card.result.mean} currency={false} label={card.result.label} />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Métrica</TableHead>
                <TableHead className="text-right">Hoy</TableHead>
                <TableHead className="text-right">Sem. anterior</TableHead>
                <TableHead className="text-right">Promedio {meta.historyWeeks} sem.</TableHead>
                <TableHead className="text-right">Mediana</TableHead>
                <TableHead className="text-right">vs sem. ant.</TableHead>
                <TableHead className="text-right">vs promedio</TableHead>
                <TableHead className="text-right">vs mediana</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableMetrics.map((m) => {
                const c = compareVM(ev.cumulative[m]);
                const bad2 = METRICS[m].bad;
                const label = m === "cpr" ? ev.kpi.costLabel : m === ev.kpi.result ? ev.kpi.resultLabel : METRICS[m].label;
                const na = c.current === null && c.mean === null;
                return (
                  <TableRow key={m}>
                    <TableCell className="text-xs font-medium">{label}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{na ? <span className="font-normal text-muted-foreground">NULL (no se reporta)</span> : fmtMetric(m, c.current)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(m, c.prevWeek)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(m, c.mean)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(m, c.median)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <DeltaText value={c.vsPrev} bad={bad2} attention={attention} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <DeltaText value={c.vsMean} bad={bad2} attention={attention} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <DeltaText value={c.vsMedian} bad={bad2} attention={attention} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Campaigns</CardTitle>
            <CardDescription>El KPI de cada campaña depende de su objetivo.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CampaignsTable rows={campaignRows(snap).filter((r) => r.platform === p)} fixedPlatform={p} attention={attention} weeks={meta.historyWeeks} />
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsTable rows={alertRows(snap).filter((a) => a.platform === p)} timezone={tz} canWrite={meta.permissions.includes("alerts:write")} canNovedad={meta.permissions.includes("novedades:write")} compact attention={attention} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Incidents</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentsTable incidents={snap.state.incidents.filter((i) => i.platform === p)} alerts={snap.state.alerts.filter((a) => a.incidentId !== null && a.platform === p)} notifications={snap.state.notifications} timezone={tz} asOf={meta.asOf} canWrite={meta.permissions.includes("incidents:write")} canNovedad={meta.permissions.includes("novedades:write")} compact attention={attention} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Data Health</CardTitle>
            <CardDescription>
              Salud {health.score}/100 · última sync {formatTimeInTz(health.lastSyncAt, tz)} ({health.lastSyncStatus})
            </CardDescription>
          </div>
          <DataStateBadge state={health.state} />
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <ul className="space-y-1.5 text-xs">
            {health.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={cn("w-4 font-semibold", CHECK_TONE[c.status])}>{c.status === "OK" ? "✓" : c.status === "WARN" ? "!" : "✕"}</span>
                <span className="w-32 shrink-0 font-medium">{c.label}</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Datos</TableHead>
                <TableHead>Último dato</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Desv.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.key}>
                  <TableCell className="text-xs font-medium">{a.accountName}</TableCell>
                  <TableCell>
                    <DataStateBadge state={a.dataState} />
                  </TableCell>
                  <TableCell className="tabular text-xs">{formatTimeInTz(a.lastDataAt, tz)}</TableCell>
                  <TableCell className="text-right text-xs">{isBadDataState(a.dataState) ? "Datos atrasados" : fmtCurrency(a.cumulative.spend?.current ?? null)}</TableCell>
                  <TableCell className="text-right text-xs">
                    <DeltaText value={isBadDataState(a.dataState) ? null : (a.cumulative.spend?.deltaVsExpected ?? null)} attention={attention} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, delta, bad = "both", attention }: { label: string; value: string; sub: string; delta: number | null; bad?: "both" | "down" | "up" | "none"; attention: number }) {
  return (
    <div className="flex flex-col gap-0.5 surface rounded-xl px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <DeltaText value={delta} bad={bad} className="text-xs" attention={attention} />
      </div>
      <span className="text-lg leading-tight font-semibold">{value}</span>
      <span className="truncate text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}
