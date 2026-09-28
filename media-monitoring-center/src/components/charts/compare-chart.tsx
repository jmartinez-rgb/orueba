"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CompareColumn } from "@/lib/services/analysis";
import { axisCurrency, axisNumber, ChartTooltip, LineLegend, type SeriesDef } from "./chart-kit";

/** Hoy (teal) vs semanas anteriores en rampa neutra ordinal: más antigua = más clara. */
const WEEK_RAMP = ["var(--series-avg)", "color-mix(in oklab, var(--series-avg) 72%, var(--card))", "color-mix(in oklab, var(--series-avg) 52%, var(--card))", "color-mix(in oklab, var(--series-avg) 36%, var(--card))"];

export function CompareChart({ columns, data, format, height = 280 }: { columns: CompareColumn[]; data: Array<Record<string, number | string | null>>; format: (v: number | null) => string; height?: number }) {
  let w = 0;
  const series: SeriesDef[] = columns.map((c) => {
    if (c.kind === "base") return { key: c.key, label: c.label, color: "var(--series-today)", width: 2.5 };
    if (c.kind === "custom") return { key: c.key, label: c.label, color: "var(--series-budget)", dash: "2 3" };
    const color = WEEK_RAMP[Math.min(w, WEEK_RAMP.length - 1)];
    w++;
    return { key: c.key, label: c.label, color, dash: w > 1 ? "5 4" : undefined };
  });
  const currencyAxis = columns.length > 0 && format(1000).includes("$");
  return (
    <div className="flex flex-col gap-2">
      <LineLegend series={series} />
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" minTickGap={18} tickMargin={6} />
            <YAxis tickFormatter={currencyAxis ? axisCurrency : axisNumber} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  title={`Acumulado a las ${label}`}
                  rows={series.map((s) => ({ key: s.key, label: s.label, color: s.color, dash: s.dash, value: format((payload?.[0]?.payload?.[s.key] as number | null) ?? null) }))}
                />
              )}
            />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
