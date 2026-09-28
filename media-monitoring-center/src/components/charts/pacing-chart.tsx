"use client";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurvePoint } from "@/lib/monitoring/types";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { axisCurrency, axisNumber, ChartTooltip, LineLegend, type SeriesDef } from "./chart-kit";

/**
 * Curva acumulada por hora: hoy vs semana anterior vs promedio N semanas (vs presupuesto esperado).
 * Hoy es la serie protagonista (teal); las referencias van en tinta neutra con distinto trazo.
 */
export function CumulativeChart({
  data,
  cutoffHour,
  currency,
  weeks,
  showBudget,
  height = 240,
}: {
  data: CurvePoint[];
  cutoffHour: number;
  currency: boolean;
  weeks: number;
  showBudget?: boolean;
  height?: number;
}) {
  const series: SeriesDef[] = [
    { key: "today", label: "Hoy", color: "var(--series-today)", width: 2.5 },
    { key: "prevWeek", label: "Semana anterior", color: "var(--series-prev)", width: 1.5 },
    { key: "avg", label: `Promedio ${weeks} sem.`, color: "var(--series-avg)", dash: "5 4" },
  ];
  if (showBudget && data.some((d) => d.budget !== null && d.budget !== undefined)) {
    series.push({ key: "budget", label: "Presupuesto esperado", color: "var(--series-budget)", dash: "2 3" });
  }
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : currency ? fmtCurrency(v) : fmtNumber(v));
  const last = [...data].reverse().find((d) => d.today !== null);
  return (
    <div className="flex flex-col gap-2">
      <LineLegend series={series} />
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 88, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" minTickGap={18} tickMargin={6} />
            <YAxis tickFormatter={currency ? axisCurrency : axisNumber} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  title={`Acumulado a las ${label}`}
                  rows={series.map((s) => {
                    const p = payload?.[0]?.payload as CurvePoint | undefined;
                    return { key: s.key, label: s.label, color: s.color, dash: s.dash, value: fmt(p ? (p[s.key as keyof CurvePoint] as number | null) : null) };
                  })}
                />
              )}
            />
            {cutoffHour > 0 && cutoffHour < 24 && (
              <ReferenceLine x={data[cutoffHour - 1]?.label} stroke="var(--chart-axis)" strokeWidth={1} label={{ value: `Corte ${data[cutoffHour - 1]?.label}`, position: "insideTopLeft", fill: "var(--chart-axis)", fontSize: 10 }} />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dash}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
                connectNulls={false}
                strokeLinecap="round"
              />
            ))}
            {last && (
              <ReferenceLine
                y={last.today ?? 0}
                stroke="transparent"
                label={{ value: `Hoy ${currency ? axisCurrency(last.today ?? 0) : axisNumber(last.today ?? 0)}`, position: "right", fill: "var(--series-today)", fontSize: 11, fontWeight: 600 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
