"use client";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChartView = "chart" | "table";

/** Alterna entre la gráfica y la tabla con los mismos datos (accesible y útil en móvil). */
export function ViewToggle({ view, onChange, className }: { view: ChartView; onChange: (v: ChartView) => void; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-md border p-0.5", className)} role="group" aria-label="Vista de la gráfica">
      {(
        [
          { id: "chart", label: "Gráfica", Icon: BarChart3 },
          { id: "table", label: "Ver datos", Icon: Table2 },
        ] as const
      ).map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={cn("inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors", view === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

/** Tabla genérica: una fila por punto del eje X y una columna por serie. */
export function SeriesTable({
  rows,
  xKey,
  xLabel,
  columns,
  format,
  highlight,
}: {
  rows: Array<Record<string, number | string | null | undefined>>;
  xKey: string;
  xLabel: string;
  columns: Array<{ key: string; label: string }>;
  format: (v: number | null) => string;
  highlight?: string;
}) {
  return (
    <div className="max-h-[360px] overflow-auto rounded-xl bg-foreground/[0.02] shadow-[inset_0_0_0_1px_var(--hairline)]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-(--hairline)">
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{xLabel}</th>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-2 py-1.5 text-right font-medium whitespace-nowrap text-muted-foreground", c.key === highlight && "text-foreground")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-(--hairline) last:border-0">
              <td className="tabular px-2 py-1 font-medium">{String(r[xKey] ?? "")}</td>
              {columns.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} className={cn("tabular px-2 py-1 text-right", c.key === highlight ? "font-semibold" : "text-muted-foreground")}>
                    {typeof v === "number" ? format(v) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
