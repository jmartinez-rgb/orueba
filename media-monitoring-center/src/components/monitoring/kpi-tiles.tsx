import type { KpiVM } from "@/lib/services/view-models";
import { fmtMetric } from "@/lib/format";
import { Sparkline } from "@/components/charts/sparkline";
import { DeltaText } from "./status";
import { Banknote, CircleHelp, HandCoins, MessageCircle, ShoppingBag, Users } from "lucide-react";

/** Totales del día en una sola superficie agrupada (celdas separadas por un filo), al estilo de Apple. */
export function KpiTiles({ kpis, attention }: { kpis: KpiVM[]; attention: number }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-(--hairline) shadow-(--shadow-card) md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.metric} className="flex min-w-0 flex-col gap-2 bg-card px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium text-muted-foreground">
              {k.metric === "spend" ? <Banknote className="size-3.5 shrink-0" aria-hidden /> : k.metric === "sales" ? <ShoppingBag className="size-3.5 shrink-0" aria-hidden /> : k.metric === "whatsapp" ? <MessageCircle className="size-3.5 shrink-0" aria-hidden /> : k.metric === "leads" ? <Users className="size-3.5 shrink-0" aria-hidden /> : <HandCoins className="size-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{k.label}</span>
            </span>
            <DeltaText value={k.deviation} bad={k.metric === "spend" ? "both" : "down"} className="text-[13px] font-semibold" attention={attention} />
          </div>
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
            <span className="tabular min-w-0 text-[26px] leading-[1.1] font-semibold tracking-[-0.025em]">{fmtMetric(k.metric, k.current, { compact: true })}</span>
            {k.current !== null && <div className="mb-1 w-12 shrink-0 opacity-80 sm:w-16">
              <Sparkline values={k.spark} />
            </div>}
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            {k.current === null ? <><CircleHelp className="size-3 shrink-0" aria-hidden />Sin dato disponible</> : `${k.platforms} ${k.platforms === 1 ? "plataforma con dato" : "plataformas con dato"}`}
          </p>
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
