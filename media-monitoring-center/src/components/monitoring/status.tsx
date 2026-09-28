import { CircleAlert, CircleCheck, CircleDashed, CloudOff, Hourglass, OctagonAlert, TriangleAlert, Layers } from "lucide-react";
import type { DataState, PlatformId, Severity } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { cn } from "@/lib/utils";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; text: string; tint: string; border: string; Icon: typeof CircleCheck }> = {
  NORMAL: { label: "NORMAL", dot: "bg-status-normal", text: "text-status-normal-text", tint: "bg-status-normal/10", border: "border-status-normal/40", Icon: CircleCheck },
  ATTENTION: { label: "ATENCIÓN", dot: "bg-status-attention", text: "text-status-attention-text", tint: "bg-status-attention/12", border: "border-status-attention/50", Icon: CircleAlert },
  ALERT: { label: "ALERTA", dot: "bg-status-alert", text: "text-status-alert-text", tint: "bg-status-alert/12", border: "border-status-alert/50", Icon: TriangleAlert },
  CRITICAL: { label: "CRÍTICO", dot: "bg-status-critical", text: "text-status-critical-text", tint: "bg-status-critical/12", border: "border-status-critical/50", Icon: OctagonAlert },
};

export const DATA_STATE_META: Record<DataState, { label: string; Icon: typeof CircleCheck; bad: boolean }> = {
  OK: { label: "Al día", Icon: CircleCheck, bad: false },
  PARTIAL: { label: "Parcial", Icon: Layers, bad: false },
  DELAYED: { label: "DATA DELAYED", Icon: Hourglass, bad: true },
  ERROR: { label: "ERROR", Icon: CloudOff, bad: true },
  NO_DATA: { label: "SIN DATOS", Icon: CircleDashed, bad: true },
};

export function isBadDataState(s: DataState) {
  return DATA_STATE_META[s].bad;
}

export function StatusDot({ severity, className, pulse }: { severity: Severity; className?: string; pulse?: boolean }) {
  const m = SEVERITY_META[severity];
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)} aria-hidden>
      {pulse && severity !== "NORMAL" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", m.dot)} />}
      <span className={cn("relative inline-flex size-full rounded-full", m.dot)} />
    </span>
  );
}

export function SeverityBadge({ severity, size = "sm", className }: { severity: Severity; size?: "sm" | "md" | "lg"; className?: string }) {
  const m = SEVERITY_META[severity];
  const Icon = m.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold tracking-wide whitespace-nowrap",
        m.tint,
        m.text,
        m.border,
        size === "sm" && "px-1.5 py-0.5 text-[10.5px]",
        size === "md" && "px-2 py-1 text-xs",
        size === "lg" && "px-2.5 py-1 text-sm",
        className,
      )}
    >
      <Icon className={cn(size === "lg" ? "size-4" : "size-3")} aria-hidden />
      {m.label}
    </span>
  );
}

export function DataStateBadge({ state, className }: { state: DataState; className?: string }) {
  const m = DATA_STATE_META[state];
  const Icon = m.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide whitespace-nowrap",
        m.bad ? "border-status-data/50 bg-status-data/12 text-status-data-text" : state === "PARTIAL" ? "border-status-attention/40 text-status-attention-text" : "border-border text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {m.label}
    </span>
  );
}

/** Estado de plataforma: si los datos están atrasados se muestra el estado del dato, no un semáforo engañoso. */
export function PlatformStatusBadge({ severity, dataState, size }: { severity: Severity; dataState: DataState; size?: "sm" | "md" | "lg" }) {
  if (isBadDataState(dataState)) return <DataStateBadge state={dataState} />;
  return <SeverityBadge severity={severity} size={size} />;
}

export function PlatformMark({ platform, className }: { platform: PlatformId; className?: string }) {
  const def = PLATFORMS[platform];
  const initials: Record<PlatformId, string> = { google: "G", meta: "M", tiktok: "T", microsoft: "Ms", spotify: "S", x: "X" };
  return (
    <span
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white", className)}
      style={{ background: `var(--chart-${def.colorSlot})` }}
      aria-hidden
    >
      {initials[platform]}
    </span>
  );
}

/** Variación con color según si la dirección es mala para la operación. */
export function DeltaText({
  value,
  bad = "both",
  attention = 0.15,
  className,
  digits = 1,
}: {
  value: number | null | undefined;
  bad?: "down" | "up" | "both" | "none";
  attention?: number;
  className?: string;
  digits?: number;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const abs = Math.abs(value);
  const isBad = bad === "both" ? true : bad === "down" ? value < 0 : bad === "up" ? value > 0 : false;
  const tone =
    abs < attention || !isBad
      ? "text-muted-foreground"
      : abs > attention * 2.67
        ? "text-status-critical-text"
        : abs >= attention * 1.67
          ? "text-status-alert-text"
          : "text-status-attention-text";
  const s = (abs * 100).toFixed(digits);
  return (
    <span className={cn("tabular font-medium", tone, className)}>
      {Number(s) === 0 ? `0.${"0".repeat(digits)}%` : `${value > 0 ? "+" : "−"}${s}%`}
    </span>
  );
}
