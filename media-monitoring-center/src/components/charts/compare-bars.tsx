"use client";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, SwatchLegend } from "./chart-kit";

export interface BarRow {
  id: string;
  name: string;
  base: number | null;
  avg: number | null;
}

/**
 * Hoy vs promedio de semanas anteriores por entidad (barras horizontales con el valor visible).
 * Hoy es la serie protagonista (teal); el promedio va en tinta neutra.
 */
export function CompareBars({ rows, format, baseLabel, avgLabel, onSelect, selected }: { rows: BarRow[]; format: (v: number | null) => string; baseLabel: string; avgLabel: string; onSelect?: (id: string) => void; selected?: string }) {
  const data = rows.map((r) => ({ ...r, short: r.name.length > 34 ? `${r.name.slice(0, 33)}…` : r.name }));
  const height = Math.max(160, data.length * 44 + 40);
  return (
    <div className="flex flex-col gap-2">
      <SwatchLegend
        items={[
          { key: "base", label: baseLabel, color: "var(--series-today)" },
          { key: "avg", label: avgLabel, color: "var(--series-avg)" },
        ]}
      />
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => format(v)} tickLine={false} axisLine={false} fontSize={11} />
            <YAxis type="category" dataKey="short" width={170} tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (BarRow & { short: string }) | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p?.name}
                    rows={[
                      { key: "base", label: baseLabel, color: "var(--series-today)", value: format(p?.base ?? null) },
                      { key: "avg", label: avgLabel, color: "var(--series-avg)", value: format(p?.avg ?? null) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="base" fill="var(--series-today)" radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(d) => onSelect?.((d as unknown as BarRow).id)} cursor={onSelect ? "pointer" : undefined}>
              <LabelList dataKey="base" position="right" formatter={(v: unknown) => format(typeof v === "number" ? v : null)} fill="var(--foreground)" fontSize={11} fontWeight={600} />
            </Bar>
            <Bar dataKey="avg" fill="var(--series-avg)" fillOpacity={selected ? 0.55 : 0.75} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="avg" position="right" formatter={(v: unknown) => format(typeof v === "number" ? v : null)} fill="var(--muted-foreground)" fontSize={10} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
