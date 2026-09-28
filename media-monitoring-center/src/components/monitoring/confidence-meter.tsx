"use client";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import type { ConfidenceResult } from "@/lib/monitoring/confidence";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const TONE = {
  ALTA: { bar: "bg-status-normal", text: "text-status-normal-text", Icon: ShieldCheck },
  MEDIA: { bar: "bg-status-attention", text: "text-status-attention-text", Icon: ShieldAlert },
  BAJA: { bar: "bg-status-critical", text: "text-status-critical-text", Icon: ShieldX },
} as const;

/** Confianza de los datos (0–100 %) con el motivo de cada punto descontado. */
export function ConfidenceMeter({ confidence, compact, className }: { confidence: ConfidenceResult; compact?: boolean; className?: string }) {
  const t = TONE[confidence.level];
  const Icon = t.Icon;
  const body = (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-label={`Confianza de datos ${confidence.score}% (${confidence.level.toLowerCase()})`}>
      <Icon className={cn("size-3.5 shrink-0", t.text)} aria-hidden />
      {!compact && <span className="text-[11px] text-muted-foreground">Confianza</span>}
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", t.bar)} style={{ width: `${confidence.score}%` }} />
      </span>
      <span className={cn("tabular text-[11px] font-bold", t.text)}>{confidence.score}%</span>
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          {body}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <p className="mb-1 font-semibold">
          Confianza de datos: {confidence.score}% ({confidence.level.toLowerCase()})
        </p>
        {confidence.reasons.length === 0 ? (
          <p className="text-muted-foreground">Datos al día, completos y con histórico suficiente.</p>
        ) : (
          <ul className="space-y-0.5">
            {confidence.reasons.slice(0, 6).map((r, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{r.text}</span>
                <span className="tabular shrink-0 font-semibold">−{r.impact}</span>
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
