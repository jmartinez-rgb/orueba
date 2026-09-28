"use client";
import Link from "next/link";
import { CircleCheck, CircleDashed, CircleX, Clock3 } from "lucide-react";
import type { ExecutionSummary } from "@/lib/monitoring/confidence";
import { formatTimeInTz } from "@/lib/time/tz";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const META = {
  LISTO: { Icon: CircleCheck, tone: "text-status-normal-text" },
  PARCIAL: { Icon: CircleCheck, tone: "text-status-attention-text" },
  PENDIENTE: { Icon: Clock3, tone: "text-status-attention-text" },
  ERROR: { Icon: CircleX, tone: "text-status-critical-text" },
  SIN_CONTROL: { Icon: CircleDashed, tone: "text-muted-foreground" },
} as const;

/** Estado de la hoja de control de ejecución (Dataslayer / Apps Script / API). */
export function ExecutionChip({ execution, timezone }: { execution: ExecutionSummary; timezone: string }) {
  const m = META[execution.status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/integrations#flujo" className={cn("inline-flex items-center gap-1 text-sm font-semibold", m.tone)}>
          <m.Icon className="size-3.5" aria-hidden /> {execution.label}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        {execution.rows.length === 0 ? (
          <p>No hay hoja/tabla de control configurada (mapeo executionControl).</p>
        ) : (
          <ul className="space-y-0.5">
            {execution.rows.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{r.step}</span>
                <span className="shrink-0 font-semibold">
                  {r.stale && r.status !== "PENDIENTE" ? "VENCIDO" : r.status} · {formatTimeInTz(r.lastRunAt, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
