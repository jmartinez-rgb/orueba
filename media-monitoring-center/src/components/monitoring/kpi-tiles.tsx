import type { KpiVM } from "@/lib/services/view-models";
import { fmtMetric } from "@/lib/format";
import { Sparkline } from "@/components/charts/sparkline";
import { DeltaText } from "./status";

/** Totales del día en una sola superficie agrupada (celdas separadas por un filo), al estilo de Apple. */
export function KpiTiles({ kpis, attention }: { kpis: KpiVM[]; attention: number }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-(--hairline) shadow-(--shadow-card) md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.metric} className="flex min-w-0 flex-col gap-1.5 bg-card px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-medium text-muted-foreground">{k.label}</span>
            <DeltaText value={k.deviation} bad={k.metric === "spend" ? "both" : "down"} className="text-[13px] font-semibold" attention={attention} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="tabular text-[26px] leading-[1.1] font-semibold tracking-[-0.025em]">{fmtMetric(k.metric, k.current, { compact: true })}</span>
            <div className="mb-1 w-16 shrink-0 opacity-80">
              <Sparkline values={k.spark} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
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
