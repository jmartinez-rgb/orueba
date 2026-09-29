import { CircleAlert, CircleCheck, CircleDashed, CloudOff, Hourglass, OctagonAlert, TriangleAlert, Layers } from "lucide-react";
import type { DataState, PlatformId, Severity } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { cn } from "@/lib/utils";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; text: string; tint: string; border: string; Icon: typeof CircleCheck }> = {
  NORMAL: { label: "Normal", dot: "bg-status-normal", text: "text-status-normal-text", tint: "bg-status-normal/12", border: "border-status-normal/35", Icon: CircleCheck },
  ATTENTION: { label: "Atención", dot: "bg-status-attention", text: "text-status-attention-text", tint: "bg-status-attention/16", border: "border-status-attention/45", Icon: CircleAlert },
  ALERT: { label: "Alerta", dot: "bg-status-alert", text: "text-status-alert-text", tint: "bg-status-alert/14", border: "border-status-alert/45", Icon: TriangleAlert },
  CRITICAL: { label: "Crítico", dot: "bg-status-critical", text: "text-status-critical-text", tint: "bg-status-critical/12", border: "border-status-critical/45", Icon: OctagonAlert },
};

export const DATA_STATE_META: Record<DataState, { label: string; Icon: typeof CircleCheck; bad: boolean }> = {
  OK: { label: "Al día", Icon: CircleCheck, bad: false },
  PARTIAL: { label: "Parcial", Icon: Layers, bad: false },
  DELAYED: { label: "Datos atrasados", Icon: Hourglass, bad: true },
  ERROR: { label: "Error de carga", Icon: CloudOff, bad: true },
  NO_DATA: { label: "Sin datos", Icon: CircleDashed, bad: true },
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
        "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap",
        m.tint,
        m.text,
        size === "sm" && "px-2 py-[3px] text-[11px]",
        size === "md" && "px-2.5 py-1 text-xs",
        size === "lg" && "px-3 py-1 text-[13px]",
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
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap",
        m.bad ? "bg-status-data/15 text-status-data-text" : state === "PARTIAL" ? "bg-status-attention/16 text-status-attention-text" : "bg-status-normal/12 text-status-normal-text",
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
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[10px] font-semibold text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.12)]", className)}
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
