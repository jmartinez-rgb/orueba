import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetaChip({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("surface flex flex-col gap-0.5 rounded-xl px-3.5 py-2.5 leading-tight", className)}>
      <span className="label-sm">{label}</span>
      <span className="tabular text-[15px] font-semibold">{value}</span>
    </div>
  );
}

export function SectionTitle({ children, className, aside }: { children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <h2 className="text-[15px] font-semibold tracking-[-0.015em]">{children}</h2>
      {aside}
    </div>
  );
}

/** Datos de contexto en una sola superficie agrupada (celdas separadas por un filo). */
export function MetaStrip({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-(--hairline) shadow-(--shadow-card) sm:grid-cols-3 xl:grid-cols-6", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-4 py-2.5 sm:py-3">
          <dt className="label-sm truncate">{it.label}</dt>
          <dd className="tabular truncate text-[15px] font-semibold">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
