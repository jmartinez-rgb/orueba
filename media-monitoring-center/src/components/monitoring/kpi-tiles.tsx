import type { KpiVM } from "@/lib/services/view-models";
import { fmtMetric } from "@/lib/format";
import { Sparkline } from "@/components/charts/sparkline";
import { DeltaText } from "./status";

export function KpiTiles({ kpis, attention }: { kpis: KpiVM[]; attention: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.metric} className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium text-muted-foreground">{k.label}</span>
            <DeltaText value={k.deviation} bad={k.metric === "spend" ? "both" : "down"} className="text-xs" attention={attention} />
          </div>
          <div className="flex items-end justify-between gap-2">
            <span className="text-lg leading-tight font-bold">{fmtMetric(k.metric, k.current, { compact: true })}</span>
            <div className="w-20">
              <Sparkline values={k.spark} />
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Esperado <span className="tabular font-medium text-foreground">{fmtMetric(k.metric, k.expected, { compact: true })}</span>
            </span>
            <span>
              vs sem. ant. <DeltaText value={k.vsPrev} bad={k.metric === "spend" ? "both" : "down"} attention={attention} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
