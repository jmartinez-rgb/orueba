"use client";
import { useEffect, useState } from "react";
import type { MetricId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { HistoricalResult } from "@/lib/services/analysis";
import { PLATFORMS } from "@/lib/platforms/registry";
import { isBaseMetric, METRICS } from "@/lib/metrics";
import { fmtCurrency, fmtMetric } from "@/lib/format";
import { WEEKDAYS_SHORT_ES } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyTrend } from "@/components/charts/daily-trend";
import { SameWeekdayBars } from "@/components/charts/weekday-bars";
import { StateMessage } from "./states";

const METRIC_OPTIONS: MetricId[] = ["spend", "conversions", "sales", "whatsapp", "leads", "cpa", "ctr", "cpc"];

export function HistoricalView({ initial }: { initial: HistoricalResult }) {
  const [weeks, setWeeks] = useState(initial.weeks);
  const [metric, setMetric] = useState<MetricId>(initial.metric);
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; technical?: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (weeks === initial.weeks && metric === initial.metric && data === initial) return;
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/historical?weeks=${weeks}&metric=${metric}`, { signal: ctrl.signal });
        const d = await res.json();
        if (!res.ok || !d.ok) setError({ message: d.message ?? "No se pudo cargar el histórico.", technical: d.technical });
        else {
          setError(null);
          setData(d);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError({ message: "No se pudo contactar al servidor." });
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo recarga al cambiar filtros
  }, [weeks, metric]);

  const def = METRICS[metric];
  const fmt = (v: number | null) => fmtMetric(metric, v, { compact: def.format !== "percent" });
  const max = Math.max(1, ...data.heatmap.flat().filter((v): v is number => v !== null));
  const today = data.sameWeekday[data.sameWeekday.length - 1];
  const samples = data.sameWeekday.slice(0, -1).reverse();
  const vals = samples.map((s) => s.value).filter((v): v is number => v !== null);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
          <TabsList>
            <TabsTrigger value="4">4 semanas</TabsTrigger>
            <TabsTrigger value="8">8 semanas</TabsTrigger>
            <TabsTrigger value="12">12 semanas</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={metric} onValueChange={(v) => setMetric(v as MetricId)}>
          <SelectTrigger size="sm" className="w-40" aria-label="Métrica">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m === "whatsapp" ? "WhatsApp" : METRICS[m].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {data.from} → {data.to}
          {loading && " · actualizando…"}
        </span>
      </div>
      {error ? (
        <Card>
          <StateMessage kind="error" title={error.message} technical={error.technical} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{data.metricLabel} diario por plataforma</CardTitle>
                <CardDescription>{isBaseMetric(metric) ? "Barras apiladas por plataforma (colores fijos por plataforma)." : "Métrica derivada: se calcula del total diario (no se apila ni se promedia)."}</CardDescription>
              </div>
              <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs text-primary hover:underline">
                {showTable ? "Ocultar tabla" : "Ver tabla"}
              </button>
            </CardHeader>
            <CardContent>
              <DailyTrend days={data.days} additive={isBaseMetric(metric)} currency={def.format === "currency"} format={fmt} totalLabel={`Total ${data.brandName}`} />
              {showTable && (
                <div className="mt-3 max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        {PLATFORM_IDS.map((p) => (
                          <TableHead key={p} className="text-right">
                            {PLATFORMS[p].shortName}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...data.days].reverse().map((d) => (
                        <TableRow key={d.date}>
                          <TableCell className="text-xs">{d.label}</TableCell>
                          {PLATFORM_IDS.map((p) => (
                            <TableCell key={p} className="text-right text-xs">
                              {fmt(d[p] ?? null)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-xs font-semibold">{fmt(d.total ?? null)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Mismo día de la semana · misma franja (00:00–{String(data.cutoffHour).padStart(2, "0")}:00)</CardTitle>
                  <CardDescription>Regla principal de comparación, extendida a {data.weeks} semanas.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <SameWeekdayBars today={today?.value ?? null} todayDate={today?.date ?? data.to} samples={samples} average={avg} currency={def.format === "currency"} label={data.metricLabel} height={230} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Gasto promedio por día y hora</CardTitle>
                  <CardDescription>Últimas {Math.min(4, data.weeks)} semanas · base de la curva horaria del PacingEngine.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(0, 1fr))" }} role="table" aria-label="Mapa de calor de gasto por día y hora">
                    <span />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="tabular text-center text-[9px] text-muted-foreground">
                        {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                      </span>
                    ))}
                    {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                      <div key={wd} className="contents" role="row">
                        <span className="text-[10px] text-muted-foreground">{WEEKDAYS_SHORT_ES[wd]}</span>
                        {data.heatmap[wd].map((v, h) => (
                          <span
                            key={h}
                            role="cell"
                            title={`${WEEKDAYS_SHORT_ES[wd]} ${String(h).padStart(2, "0")}:00 · ${v === null ? "Sin dato" : fmtCurrency(v)}`}
                            className="h-5 rounded-[2px]"
                            style={{ background: v === null ? "var(--muted)" : `color-mix(in oklab, var(--series-today) ${Math.round(8 + (v / max) * 88)}%, var(--muted))` }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  Menor
                  <span className="h-2 w-24 rounded" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--series-today) 8%, var(--muted)), var(--series-today))" }} />
                  Mayor
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
