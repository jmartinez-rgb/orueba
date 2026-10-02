"use client";
import { useState } from "react";
import type { ChartResultMetric, PlatformId } from "@/lib/types";
import type { CurvePoint, DailyPacing } from "@/lib/monitoring/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CumulativeChart } from "@/components/charts/pacing-chart";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { DeltaText } from "./status";

export type Scope = PlatformId | "total";

export interface ScopeOption {
  id: Scope;
  label: string;
  cutoffHour: number;
  unavailable?: string | null;
}

const RESULT_LABELS: Record<ChartResultMetric, string> = {
  conversions: "Conversiones",
  sales: "Ventas",
  whatsapp: "WhatsApp",
  leads: "Leads",
  calls: "Llamadas",
  purchases: "Compras",
  clicks: "Clics",
  impressions: "Impresiones",
};

function ScopeSelect({ value, onChange, scopes }: { value: Scope; onChange: (s: Scope) => void; scopes: ScopeOption[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Scope)}>
      <SelectTrigger size="sm" className="w-full max-w-full sm:w-40" aria-label="Plataforma" title={scopes.find((scope) => scope.id === value)?.label}>
        <SelectValue className="min-w-0 truncate" />
      </SelectTrigger>
      <SelectContent>
        {scopes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SpendPacingCard({
  curves,
  pacing,
  scopes,
  weeks,
  initial = "total",
  title = "Ritmo de gasto",
  height,
}: {
  curves: Record<Scope, CurvePoint[]>;
  pacing: Record<Scope, DailyPacing>;
  scopes: ScopeOption[];
  weeks: number;
  initial?: Scope;
  title?: string;
  height?: number;
}) {
  const [scope, setScope] = useState<Scope>(initial);
  const opt = scopes.find((s) => s.id === scope) ?? scopes[0];
  const p = pacing[scope];
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Gasto acumulado por hora · curva horaria histórica ({p?.curveSource === "historical" ? "no lineal" : "lineal por falta de histórico"})</CardDescription>
        </div>
        {scopes.length > 1 && <ScopeSelect value={scope} onChange={setScope} scopes={scopes} />}
      </CardHeader>
      <CardContent className="space-y-3">
        {p && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Gasto actual</p>
              <p className="tabular text-sm font-semibold">{fmtCurrency(p.spend)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Esperado por presupuesto</p>
              <p className="tabular text-sm font-semibold">
                {fmtCurrency(p.expectedByCurve)} <DeltaText value={p.deviation} className="text-xs" />
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Día transcurrido (curva)</p>
              <p className="tabular text-sm font-semibold">{fmtPercent(p.curveShare, 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Forecast cierre del día</p>
              <p className="tabular text-sm font-semibold">
                {fmtCurrency(p.forecastClose)} <DeltaText value={p.forecastVsBudget} className="text-xs" />
              </p>
            </div>
          </div>
        )}
        {opt?.unavailable ? (
          <p className="rounded-xl bg-foreground/[0.03] p-6 text-center text-[13px] text-muted-foreground">{opt.unavailable}</p>
        ) : (
          <CumulativeChart data={curves[scope]} cutoffHour={opt?.cutoffHour ?? 0} currency weeks={weeks} showBudget height={height} />
        )}
      </CardContent>
    </Card>
  );
}

export function ResultsPacingCard({
  curves,
  scopes,
  weeks,
  initial = "total",
  initialMetric = "conversions",
  available,
  height,
}: {
  curves: Record<Scope, Record<ChartResultMetric, CurvePoint[]>>;
  scopes: ScopeOption[];
  weeks: number;
  initial?: Scope;
  initialMetric?: ChartResultMetric;
  available?: Partial<Record<Scope, ChartResultMetric[]>>;
  height?: number;
}) {
  const [scope, setScope] = useState<Scope>(initial);
  const metrics = available?.[scope] ?? (Object.keys(RESULT_LABELS) as ChartResultMetric[]);
  const [metricState, setMetric] = useState<ChartResultMetric>(initialMetric);
  const metric = metrics.includes(metricState) ? metricState : metrics[0];
  const opt = scopes.find((s) => s.id === scope) ?? scopes[0];
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Ritmo de resultados</CardTitle>
          <CardDescription>Acumulado por hora vs el mismo día de semanas anteriores</CardDescription>
        </div>
        <div className="flex w-full min-w-0 max-w-full flex-wrap gap-2 sm:w-auto">
          <Select value={metric} onValueChange={(v) => setMetric(v as ChartResultMetric)}>
            <SelectTrigger size="sm" className="w-full max-w-full sm:w-36" aria-label="Métrica">
              <SelectValue className="min-w-0 truncate" />
            </SelectTrigger>
            <SelectContent>
              {metrics.map((m) => (
                <SelectItem key={m} value={m}>
                  {RESULT_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scopes.length > 1 && <ScopeSelect value={scope} onChange={setScope} scopes={scopes} />}
        </div>
      </CardHeader>
      <CardContent>
        {opt?.unavailable ? (
          <p className="rounded-xl bg-foreground/[0.03] p-6 text-center text-[13px] text-muted-foreground">{opt.unavailable}</p>
        ) : metric && curves[scope]?.[metric]?.some((p) => p.avg !== null || p.today !== null) ? (
          <CumulativeChart data={curves[scope][metric]} cutoffHour={opt?.cutoffHour ?? 0} currency={false} weeks={weeks} height={height} />
        ) : (
          <p className="rounded-xl bg-foreground/[0.03] p-6 text-center text-[13px] text-muted-foreground">Esta plataforma no reporta {RESULT_LABELS[metric] ?? "esta métrica"} (NULL, no cero).</p>
        )}
      </CardContent>
    </Card>
  );
}
