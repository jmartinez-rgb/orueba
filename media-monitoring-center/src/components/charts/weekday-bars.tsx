"use client";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { shortDateLabel } from "@/lib/time/tz";
import { axisCurrency, axisNumber } from "./chart-kit";

/** Hoy vs el mismo día de semanas anteriores en la misma franja. Una sola serie; hoy resaltado. */
export function SameWeekdayBars({
  today,
  todayDate,
  samples,
  average,
  currency,
  height = 200,
  label,
}: {
  today: number | null;
  todayDate: string;
  samples: Array<{ date: string; value: number | null }>;
  average: number | null;
  currency: boolean;
  height?: number;
  label: string;
}) {
  const dense = samples.length > 5;
  const dayLabel = (d: string) => (dense ? shortDateLabel(d).split(" ").slice(1).join(" ") : shortDateLabel(d));
  const data = [...samples]
    .reverse()
    .map((s) => ({ name: dayLabel(s.date), value: s.value, today: false }))
    .concat([{ name: dense ? "Hoy" : `Hoy · ${shortDateLabel(todayDate)}`, value: today, today: true }]);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : currency ? fmtCurrency(v, { compact: true }) : fmtNumber(v, { compact: true }));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`${label}: hoy vs mismo día de semanas anteriores`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval={0} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={currency ? axisCurrency : axisNumber} tickLine={false} axisLine={false} width={52} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="rounded-xl bg-popover/95 px-3 py-2.5 text-xs shadow-(--shadow-pop) backdrop-blur-md">
                  <p className="text-muted-foreground">{String(payload[0].payload.name)}</p>
                  <p className="tabular font-semibold">{fmt(payload[0].value as number)}</p>
                </div>
              ) : null
            }
          />
          {average !== null && (
            <ReferenceLine y={average} stroke="var(--series-avg)" strokeDasharray="5 4" label={{ value: `Prom. ${fmt(average)}`, position: "insideBottomLeft", fill: "var(--chart-axis)", fontSize: 10 }} />
          )}
          <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.today ? "var(--series-today)" : "var(--series-prev)"} fillOpacity={d.today ? 1 : 0.55} />
            ))}
            <LabelList dataKey="value" position="top" formatter={(v: unknown) => fmt(v as number)} style={{ fontSize: 10, fill: "var(--chart-axis)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
