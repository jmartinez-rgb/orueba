"use client";
import { useEffect, useState } from "react";
import type { MetricId, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { CompareResult } from "@/lib/services/analysis";
import { PLATFORMS } from "@/lib/platforms/registry";
import { METRICS } from "@/lib/metrics";
import { fmtMetric } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompareChart } from "@/components/charts/compare-chart";
import { DeltaText, PlatformMark } from "./status";
import { StateMessage } from "./states";

const METRIC_OPTIONS: MetricId[] = ["spend", "conversions", "cpa", "whatsapp", "leads", "sales", "ctr", "cpc"];

export function CompareView({ initial, attention, delayed = [] }: { initial: CompareResult; attention: number; delayed?: string[] }) {
  const [date, setDate] = useState(initial.date);
  const [cutoff, setCutoff] = useState(initial.cutoffHour);
  const [weeks, setWeeks] = useState<number[]>([1, 2, 3, 4]);
  const [custom, setCustom] = useState("");
  const [metric, setMetric] = useState<MetricId>(initial.metric);
  const [scope, setScope] = useState<PlatformId | "total">(initial.scope);
  const [data, setData] = useState<CompareResult>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; technical?: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ date, cutoff: String(cutoff), weeks: weeks.join(","), metric, scope });
    if (custom) params.set("custom", custom);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/compare?${params}`, { signal: ctrl.signal });
        const d = await res.json();
        if (!res.ok || !d.ok) setError({ message: d.message ?? "No se pudo comparar.", technical: d.technical });
        else {
          setError(null);
          setData(d);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError({ message: "No se pudo contactar al servidor." });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [date, cutoff, weeks, custom, metric, scope]);

  const fmt = (v: number | null) => fmtMetric(metric, v, { compact: METRICS[metric].format !== "percent" });
  const fmtFull = (v: number | null) => fmtMetric(metric, v);
  const bad = METRICS[metric].bad;
  const total = data.rows.find((r) => r.id === scope) ?? data.rows[data.rows.length - 1];
  const toggleWeek = (w: number) => setWeeks((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort()));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="space-y-1">
            <Label htmlFor="cmp-date">Fecha base</Label>
            <Input id="cmp-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1">
            <Label>Hora de corte</Label>
            <Select value={String(cutoff)} onValueChange={(v) => setCutoff(Number(v))}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <SelectItem key={h} value={String(h)}>{`00:00–${String(h).padStart(2, "0")}:00`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Comparar contra</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 8, 12].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWeek(w)}
                  aria-pressed={weeks.includes(w)}
                  className={cn("h-8 rounded-md border px-2 text-xs font-medium", weeks.includes(w) ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
                >
                  −{w} sem
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-custom">Fecha personalizada</Label>
            <Input id="cmp-custom" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1">
            <Label>Métrica</Label>
            <Select value={metric} onValueChange={(v) => setMetric(v as MetricId)}>
              <SelectTrigger size="sm" className="w-36">
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
          </div>
          <div className="space-y-1">
            <Label>Gráfica</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as PlatformId | "total")}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total izzi</SelectItem>
                {PLATFORM_IDS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORMS[p].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {loading && <span className="pb-2 text-xs text-muted-foreground">Actualizando…</span>}
        </CardContent>
      </Card>

      {delayed.length > 0 && date === initial.date && (
        <p className="rounded-md border border-status-data/50 bg-status-data/10 px-3 py-2 text-xs text-status-data-text">
          Datos atrasados hoy en: {delayed.join(", ")}. Sus cifras del día pueden estar incompletas: no las interpretes como caída.
        </p>
      )}
      {error ? (
        <Card>
          <StateMessage kind="error" title={error.message} technical={error.technical} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label={`${total.name} · base`} value={fmt(total.values[0])} />
            <Stat label="vs semana anterior" value={<DeltaText value={total.vsPrev} bad={bad} attention={attention} className="text-lg" />} />
            <Stat label="vs promedio" value={<DeltaText value={total.vsAvg} bad={bad} attention={attention} className="text-lg" />} sub={`Promedio ${fmt(total.avg)}`} />
            <Stat label="vs mediana" value={<DeltaText value={total.vsMedian} bad={bad} attention={attention} className="text-lg" />} sub={`Mediana ${fmt(total.median)}`} />
          </div>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>
                  {data.metricLabel} acumulado por hora · {scope === "total" ? "Total izzi" : PLATFORMS[scope].name}
                </CardTitle>
                <CardDescription>Misma franja horaria en cada fecha. La fecha base se corta a las {String(data.cutoffHour).padStart(2, "0")}:00.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CompareChart columns={data.columns} data={data.series} format={fmt} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tabla comparativa · 00:00–{String(data.cutoffHour).padStart(2, "0")}:00</CardTitle>
                <CardDescription>Métricas derivadas calculadas desde totales de cada fecha.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plataforma</TableHead>
                    {data.columns.map((c) => (
                      <TableHead key={c.key} className="text-right">
                        {c.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Promedio</TableHead>
                    <TableHead className="text-right">Mediana</TableHead>
                    <TableHead className="text-right">vs sem. ant.</TableHead>
                    <TableHead className="text-right">vs promedio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id} className={cn(r.id === "total" && "bg-muted/40 font-semibold")}>
                      <TableCell className="text-xs">
                        <span className="flex items-center gap-2">
                          {r.id !== "total" && <PlatformMark platform={r.id} className="size-5 text-[9px]" />}
                          {r.name}
                        </span>
                      </TableCell>
                      {r.values.map((v, i) => (
                        <TableCell key={i} className={cn("text-right text-xs", i === 0 ? "font-semibold" : "text-muted-foreground")}>
                          {v === null ? <span title="Sin dato (NULL)">—</span> : fmtFull(v)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right text-xs text-muted-foreground">{fmtFull(r.avg)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{fmtFull(r.median)}</TableCell>
                      <TableCell className="text-right text-xs">
                        <DeltaText value={r.vsPrev} bad={bad} attention={attention} />
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <DeltaText value={r.vsAvg} bad={bad} attention={attention} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
