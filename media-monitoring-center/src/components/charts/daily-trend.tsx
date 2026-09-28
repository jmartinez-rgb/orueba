"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { axisCurrency, axisNumber, ChartTooltip, SwatchLegend } from "./chart-kit";

type Day = { date: string; label: string } & Partial<Record<PlatformId | "total", number | null>>;

/** Tendencia diaria: barras apiladas por plataforma (métricas aditivas) o línea total (métricas derivadas). */
export function DailyTrend({ days, additive, currency, format, height = 260 }: { days: Day[]; additive: boolean; currency: boolean; format: (v: number | null) => string; height?: number }) {
  const items = PLATFORM_IDS.map((p) => ({ key: p, label: PLATFORMS[p].shortName, color: `var(--chart-${PLATFORMS[p].colorSlot})` }));
  const tick = currency ? axisCurrency : axisNumber;
  return (
    <div className="flex flex-col gap-2">
      {additive && <SwatchLegend items={items} />}
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {additive ? (
            <BarChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={56} />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                content={({ active, payload, label }) => (
                  <ChartTooltip
                    active={active}
                    title={String(label)}
                    rows={[
                      ...items.map((i) => ({ key: i.key, label: i.label, color: i.color, value: format((payload?.[0]?.payload?.[i.key] as number | null) ?? null) })),
                      { key: "total", label: "Total", color: "var(--foreground)", value: format((payload?.[0]?.payload?.total as number | null) ?? null) },
                    ]}
                  />
                )}
              />
              {items.map((i, idx) => (
                <Bar key={i.key} dataKey={i.key} stackId="a" fill={i.color} stroke="var(--card)" strokeWidth={1} isAnimationActive={false} radius={idx === items.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={24} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={56} />
              <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} title={String(label)} rows={[{ key: "total", label: "Total izzi", color: "var(--series-today)", value: format((payload?.[0]?.payload?.total as number | null) ?? null) }]} />} />
              <Line dataKey="total" stroke="var(--series-today)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
