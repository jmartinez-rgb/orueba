"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dash?: string;
  width?: number;
}

/** Tooltip: el valor manda (negrita), la etiqueta acompaña; clave de línea corta. */
export function ChartTooltip({
  active,
  label,
  rows,
  title,
}: {
  active?: boolean;
  label?: ReactNode;
  title?: ReactNode;
  rows: Array<{ key: string; label: string; color: string; dash?: string; value: string }>;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="min-w-44 rounded-xl bg-popover/95 px-3 py-2.5 text-xs shadow-(--shadow-pop) backdrop-blur-md">
      <p className="mb-1.5 font-medium text-muted-foreground">{title ?? label}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <svg width="14" height="6" aria-hidden>
                <line x1="0" y1="3" x2="14" y2="3" stroke={r.color} strokeWidth="2" strokeDasharray={r.dash} strokeLinecap="round" />
              </svg>
              {r.label}
            </span>
            <span className="tabular font-semibold text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden>
            <line x1="1" y1="3" x2="15" y2="3" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinecap="round" />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function SwatchLegend({ items, className }: { items: Array<{ key: string; label: string; color: string }>; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {items.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

const compact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
export const axisCurrency = (v: number) => (Math.abs(v) >= 1000 ? `$${compact.format(v)}` : `$${Math.round(v)}`);
export const axisNumber = (v: number) => (Math.abs(v) >= 1000 ? compact.format(v) : String(Math.round(v)));
