"use client";
import { Line, LineChart, ResponsiveContainer } from "recharts";

export function Sparkline({ values, color = "var(--series-today)", height = 28 }: { values: Array<number | null>; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  if (!values.some((v) => v !== null)) return <div style={{ height }} />;
  return (
    <div style={{ height }} className="w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line dataKey="v" type="monotone" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
