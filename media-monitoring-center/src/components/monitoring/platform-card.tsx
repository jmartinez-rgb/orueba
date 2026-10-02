import Link from "next/link";
import { BellRing, Check, ChevronRight, Circle, X } from "lucide-react";
import type { PlatformCardVM } from "@/lib/services/view-models";
import { fmtCurrency, fmtMetric } from "@/lib/format";
import { formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { DATA_STATE_META, DeltaText, isBadDataState, PlatformMark, PlatformStatusBadge, SEVERITY_META } from "./status";
import { ConfidenceMeter } from "./confidence-meter";
import { MetricPicker } from "./metric-picker";

function Bar({ current, expected }: { current: number | null; expected: number | null }) {
  if (current === null || !expected) return <div className="h-1 rounded-full bg-foreground/[0.07]" />;
  const pct = Math.min(1.5, current / expected);
  return (
    <div className="relative h-1 rounded-full bg-foreground/[0.07]" role="img" aria-label={`${Math.round(pct * 100)}% del esperado`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-(--series-today) transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, (pct / 1.5) * 100)}%` }} />
      <div className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-foreground/45" style={{ left: `${(1 / 1.5) * 100}%` }} title="Esperado" />
    </div>
  );
}

/** Problema principal de la plataforma, con el ícono y el color de su severidad. */
function IssueLine({ severity, title }: { severity: keyof typeof SEVERITY_META; title: string }) {
  const m = SEVERITY_META[severity];
  const Icon = m.Icon;
  return (
    <p className={cn("flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[13px] leading-snug font-medium", m.tint, m.text)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="line-clamp-2">{title}</span>
    </p>
  );
}

/** Atraso legible: "12 min" o "2 h 15 min". */
function ago(min: number): string {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function PlatformCard({ vm, timezone, weeks, attention, canEdit = false }: { vm: PlatformCardVM; timezone: string; weeks: number; attention: number; canEdit?: boolean }) {
  const bad = isBadDataState(vm.dataState);
  return (
    <div className="surface group relative flex flex-col overflow-hidden transition-shadow duration-200 ease-out hover:shadow-(--shadow-card-hover)">
    <Link href={`/platforms/${vm.platform}`} className="flex flex-1 flex-col rounded-t-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <PlatformMark platform={vm.platform} className="size-7 rounded-[8px] text-[11px]" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.015em]">{vm.name}</span>
        </div>
        <PlatformStatusBadge severity={vm.severity} dataState={vm.dataState} />
      </div>

      {bad ? (
        <div className="flex flex-1 flex-col gap-2 px-5 pt-3 pb-4">
          <p className="text-2xl font-semibold tracking-[-0.02em] text-status-data-text">{DATA_STATE_META[vm.dataState].label}</p>
          <p className="text-xs text-muted-foreground">{vm.dataReason}</p>
          <p className="text-xs">
            Último dato recibido: <span className="tabular font-semibold">{formatTimeInTz(vm.lastDataAt, timezone)}</span>
            {vm.lagMinutes !== null && <span className="text-muted-foreground"> · hace {ago(vm.lagMinutes)}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            No se muestra gasto $0 ni se evalúa rendimiento: un atraso no es una caída.
            {vm.cutoffHour > 0 && vm.spend.current !== null && ` Datos completos hasta ${hourLabel(vm.cutoffHour)}: ${fmtCurrency(vm.spend.current)} (esperado a esa hora ${fmtCurrency(vm.spend.expected)}).`}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 px-5 pt-3 pb-4">
          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-x-4">
            <div>
              <p className="label-sm">Gasto actual</p>
              <p className="tabular text-[26px] leading-[1.15] font-semibold tracking-[-0.025em]">{fmtCurrency(vm.spend.current)}</p>
            </div>
            <div className="text-right">
              <p className="label-sm">Esperado</p>
              <p className="tabular text-[15px] font-semibold">{fmtCurrency(vm.spend.expected)}</p>
            </div>
            <div className="text-right">
              <p className="label-sm">Desviación</p>
              <DeltaText value={vm.spend.deviation} className="text-[15px] font-semibold" attention={attention} />
            </div>
          </div>
          <Bar current={vm.spend.current} expected={vm.spend.expected} />
          <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1 text-[13px]">
            <span className="truncate text-muted-foreground" title={vm.result.lagging ? "Conversiones offline: llegan horas después. En el día no se juzgan; se revisan con el día cerrado." : undefined}>
              {vm.result.label}
              {vm.result.lagging && <span className="ml-1 text-[11px]">· con retraso</span>}
            </span>
            <span className="tabular text-right font-semibold">
              {fmtMetric(vm.result.metric, vm.result.current, { compact: true })}
              <span className="font-normal text-muted-foreground"> / {fmtMetric(vm.result.metric, vm.result.expected, { compact: true })}</span>
            </span>
            <DeltaText value={vm.result.deviation} bad={vm.result.lagging ? "none" : "down"} className="text-right" attention={attention} />
            <span className="truncate text-muted-foreground">{vm.cost.label}</span>
            <span className="tabular text-right font-semibold">{fmtMetric("cpr", vm.cost.current)}</span>
            <DeltaText value={vm.cost.deviation} bad={vm.result.lagging ? "none" : "up"} className="text-right" attention={attention} />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-(--hairline) pt-2.5 text-xs text-muted-foreground">
            <span>
              vs semana anterior <DeltaText value={vm.spend.vsPrev} attention={attention} />
            </span>
            <span className="text-right">
              vs promedio {weeks} sem. <DeltaText value={vm.spend.vsMean} attention={attention} />
            </span>
          </div>
          {vm.pinned.length > 0 && (
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1 border-t border-(--hairline) pt-2.5 text-[13px]">
              {vm.pinned.map((m) => (
                <span key={m.metric} className="contents">
                  <span className="truncate text-muted-foreground">{m.label}</span>
                  <span className="tabular text-right font-semibold">{fmtMetric(m.metric, m.current, { compact: true })}</span>
                  <DeltaText value={m.deviation} bad={m.metric === "spend" ? "both" : undefined} className="text-right" attention={attention} />
                </span>
              ))}
            </div>
          )}
          {vm.targets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vm.targets.map((t) => (
                <span
                  key={t.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium",
                    t.ok === null ? "bg-foreground/[0.05] text-muted-foreground" : t.ok ? "bg-status-normal/12 text-status-normal-text" : "bg-status-alert/14 text-status-alert-text",
                  )}
                  title={t.note || undefined}
                >
                  {t.ok === null ? <Circle className="size-3" aria-hidden /> : t.ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />} {t.label} {fmtMetric(t.metric, t.target, { compact: true })}
                  {t.value !== null && ` · ${t.projected ? "proy. " : ""}${fmtMetric(t.metric, t.value, { compact: true })}`}
                </span>
              ))}
            </div>
          )}
          {vm.topIssue && vm.severity !== "NORMAL" && (
            <IssueLine severity={vm.topIssue.severity} title={vm.topIssue.title} />
          )}
          {vm.excludedAccounts.length > 0 && (
            <p className="text-xs text-status-attention-text">Comparación parcial: {vm.excludedAccounts.join(", ")} con datos atrasados (excluida).</p>
          )}
        </div>
      )}

    </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-(--hairline) px-5 py-2.5 text-xs text-muted-foreground">
        <MetricPicker platform={vm.platform} primary={vm.primaryMetric} choices={vm.metricChoices} pinned={vm.pinnedIds} canEdit={canEdit} />
        <ConfidenceMeter confidence={vm.confidence} />
        <span className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <span>
            Último dato <span className="tabular font-medium text-foreground">{formatTimeInTz(vm.lastDataAt, timezone)}</span>
            {!bad && vm.lagMinutes !== null && ` · hace ${ago(vm.lagMinutes)}`}
          </span>
          <Link href={`/platforms/${vm.platform}`} className="inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-1.5 py-0.5 outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Ver ${vm.name}`}>
            {vm.alertsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <BellRing className="size-3" /> {vm.alertsCount}
              </span>
            )}
            <ChevronRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          </Link>
        </span>
      </div>
    </div>
  );
}
