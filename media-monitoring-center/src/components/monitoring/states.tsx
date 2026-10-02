"use client";
import { useId, useState } from "react";
import { CircleCheck, CloudOff, Hourglass, Inbox, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "empty" | "no-alerts" | "no-incidents" | "error" | "delayed" | "disconnected";

const ICONS: Record<Kind, typeof Inbox> = {
  empty: Inbox,
  "no-alerts": CircleCheck,
  "no-incidents": CircleCheck,
  error: TriangleAlert,
  delayed: Hourglass,
  disconnected: CloudOff,
};

/** Estados vacíos y de error. Nunca muestra errores técnicos crudos: quedan detrás de "Ver detalles técnicos". */
export function StateMessage({
  kind,
  title,
  description,
  technical,
  className,
  compact,
}: {
  kind: Kind;
  title: string;
  description?: string;
  technical?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const Icon = ICONS[kind];
  const tone =
    kind === "error" ? "text-status-critical-text" : kind === "no-alerts" || kind === "no-incidents" ? "text-status-normal-text" : kind === "delayed" || kind === "disconnected" ? "text-status-data-text" : "text-muted-foreground";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 text-center", compact ? "py-5" : "py-10", className)}>
      <Icon className={cn("size-6", tone)} aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {technical && (
        <div className="mt-1 w-full max-w-lg">
          <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)} className="min-h-8 rounded px-2 text-xs text-primary outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
            {open ? "Ocultar detalles técnicos" : "Ver detalles técnicos"}
          </button>
          <pre id={detailsId} hidden={!open} className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted p-2 text-left font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{technical}</pre>
        </div>
      )}
    </div>
  );
}
