import type { Metadata } from "next";
import Link from "next/link";
import { safeSnapshot } from "@/lib/services/safe";
import { platformCard } from "@/lib/services/view-models";
import { fmtCurrency, fmtMetric, fmtPercent } from "@/lib/format";
import { formatTimeInTz } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/monitoring/page-header";
import { PlatformCard } from "@/components/monitoring/platform-card";
import { DeltaText, isBadDataState, PlatformMark, PlatformStatusBadge } from "@/components/monitoring/status";
import { ErrorPanel } from "@/components/monitoring/error-panel";

export const metadata: Metadata = { title: "Platforms" };
export const dynamic = "force-dynamic";

export default async function PlatformsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const tz = snap.meta.timezone;
  const attention = snap.settings.thresholds.attention;
  const cards = snap.run.platforms.map((p) => platformCard(snap, p));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Platforms" subtitle="Estado, gasto, resultados y pacing por plataforma. Selecciona una para ver campañas, alertas, incidentes y calidad de datos." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <PlatformCard key={c.platform} vm={c} timezone={tz} weeks={snap.meta.historyWeeks} attention={attention} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Comparativo de plataformas</CardTitle>
            <CardDescription>Ventana 00:00–corte vs mismo día de la semana ({snap.meta.historyWeeks} semanas). Costos calculados como SUMA(costo) ÷ SUMA(resultados).</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plataforma</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Desv.</TableHead>
                <TableHead className="text-right">vs sem. ant.</TableHead>
                <TableHead className="text-right">vs prom.</TableHead>
                <TableHead>Resultado principal</TableHead>
                <TableHead className="text-right">Desv.</TableHead>
                <TableHead className="text-right">Costo / resultado</TableHead>
                <TableHead className="text-right">Pacing</TableHead>
                <TableHead>Último dato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.map((c) => {
                const bad = isBadDataState(c.dataState);
                return (
                  <TableRow key={c.platform}>
                    <TableCell>
                      <Link href={`/platforms/${c.platform}`} className="flex items-center gap-2 font-medium hover:underline">
                        <PlatformMark platform={c.platform} className="size-5 text-[9px]" />
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <PlatformStatusBadge severity={c.severity} dataState={c.dataState} />
                    </TableCell>
                    <TableCell className="text-right font-medium">{bad ? "—" : fmtCurrency(c.spend.current)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtCurrency(c.spend.expected)}</TableCell>
                    <TableCell className="text-right">
                      <DeltaText value={bad ? null : c.spend.deviation} attention={attention} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DeltaText value={bad ? null : c.spend.vsPrev} attention={attention} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DeltaText value={bad ? null : c.spend.vsMean} attention={attention} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium">{bad ? "—" : fmtMetric(c.result.metric, c.result.current, { compact: true })}</span> <span className="text-muted-foreground">{c.result.label}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DeltaText value={bad ? null : c.result.deviation} bad={c.result.lagging ? "none" : "down"} attention={attention} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {bad ? "—" : fmtMetric("cpr", c.cost.current)} <DeltaText value={bad ? null : c.cost.deviation} bad="up" attention={attention} />
                      <span className="block text-[10px] text-muted-foreground">{c.cost.label}</span>
                    </TableCell>
                    <TableCell className="text-right">{bad ? "—" : fmtPercent(c.pacingPct, 0)}</TableCell>
                    <TableCell className="tabular text-xs">{formatTimeInTz(c.lastDataAt, tz)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
