import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import type { PlatformCardVM } from "@/lib/services/view-models";
import { fmtCurrency, fmtMetric } from "@/lib/format";
import { formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { DATA_STATE_META, DeltaText, isBadDataState, PlatformMark, PlatformStatusBadge, SEVERITY_META } from "./status";
import { ConfidenceMeter } from "./confidence-meter";
import { MetricPicker } from "./metric-picker";

function Bar({ current, expected }: { current: number | null; expected: number | null }) {
  if (current === null || !expected) return <div className="h-1.5 rounded-full bg-muted" />;
  const pct = Math.min(1.5, current / expected);
  return (
    <div className="relative h-1.5 rounded-full bg-muted" role="img" aria-label={`${Math.round(pct * 100)}% del esperado`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--series-today)]" style={{ width: `${Math.min(100, (pct / 1.5) * 100)}%` }} />
      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-foreground/60" style={{ left: `${(1 / 1.5) * 100}%` }} title="Esperado" />
    </div>
  );
}

export function PlatformCard({ vm, timezone, weeks, attention, canEdit = false }: { vm: PlatformCardVM; timezone: string; weeks: number; attention: number; canEdit?: boolean }) {
  const bad = isBadDataState(vm.dataState);
  const sev = SEVERITY_META[vm.severity];
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/25">
    <Link href={`/platforms/${vm.platform}`} className="flex flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset">
      <span className={cn("absolute inset-y-0 left-0 w-1", bad ? "bg-status-data" : sev.dot)} aria-hidden />
      <div className={cn("flex items-center justify-between gap-2 border-b px-3.5 py-2.5 pl-4", !bad && vm.severity !== "NORMAL" && sev.tint)}>
        <div className="flex min-w-0 items-center gap-2">
          <PlatformMark platform={vm.platform} />
          <span className="truncate text-sm font-semibold">{vm.name}</span>
        </div>
        <PlatformStatusBadge severity={vm.severity} dataState={vm.dataState} />
      </div>

      {bad ? (
        <div className="flex flex-1 flex-col gap-2 px-4 py-3">
          <p className="text-2xl font-bold tracking-tight text-status-data-text">{DATA_STATE_META[vm.dataState].label}</p>
          <p className="text-xs text-muted-foreground">{vm.dataReason}</p>
          <p className="text-xs">
            Último dato recibido: <span className="tabular font-semibold">{formatTimeInTz(vm.lastDataAt, timezone)}</span>
            {vm.lagMinutes !== null && <span className="text-muted-foreground"> · hace {Math.floor(vm.lagMinutes / 60)} h {vm.lagMinutes % 60} min</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            No se muestra gasto $0 ni se evalúa rendimiento: un atraso no es una caída.
            {vm.cutoffHour > 0 && vm.spend.current !== null && ` Datos completos hasta ${hourLabel(vm.cutoffHour)}: ${fmtCurrency(vm.spend.current)} (esperado a esa hora ${fmtCurrency(vm.spend.expected)}).`}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-x-3">
            <div>
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Gasto actual</p>
              <p className="tabular text-xl leading-tight font-bold">{fmtCurrency(vm.spend.current)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Esperado</p>
              <p className="tabular text-sm font-semibold">{fmtCurrency(vm.spend.expected)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Desv.</p>
              <DeltaText value={vm.spend.deviation} className="text-sm" attention={attention} />
            </div>
          </div>
          <Bar current={vm.spend.current} expected={vm.spend.expected} />
          <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 text-xs">
            <span className="truncate text-muted-foreground" title={vm.result.lagging ? "Conversiones offline: llegan horas después. En el día no se juzgan; se revisan con el día cerrado." : undefined}>
              {vm.result.label}
              {vm.result.lagging && <span className="ml-1 text-[10px]">(llegan con retraso)</span>}
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
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              vs semana ant. <DeltaText value={vm.spend.vsPrev} attention={attention} />
            </span>
            <span className="text-right text-muted-foreground">
              vs prom. {weeks} sem. <DeltaText value={vm.spend.vsMean} attention={attention} />
            </span>
          </div>
          {vm.pinned.length > 0 && (
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-0.5 border-t pt-2 text-xs">
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
                    "rounded border px-1.5 py-0.5 text-[10.5px] font-medium",
                    t.ok === null ? "text-muted-foreground" : t.ok ? "border-status-normal/40 text-status-normal-text" : "border-status-alert/50 bg-status-alert/10 text-status-alert-text",
                  )}
                  title={t.note || undefined}
                >
                  {t.ok === null ? "○" : t.ok ? "✓" : "✕"} {t.label} {fmtMetric(t.metric, t.target, { compact: true })}
                  {t.value !== null && ` · ${t.projected ? "proy. " : ""}${fmtMetric(t.metric, t.value, { compact: true })}`}
                </span>
              ))}
            </div>
          )}
          {vm.topIssue && vm.severity !== "NORMAL" && (
            <p className={cn("line-clamp-2 text-xs font-medium", SEVERITY_META[vm.topIssue.severity].text)}>
              {vm.topIssue.type}: {vm.topIssue.title}
            </p>
          )}
          {vm.excludedAccounts.length > 0 && (
            <p className="text-[11px] text-status-attention-text">Comparación parcial: {vm.excludedAccounts.join(", ")} con datos atrasados (excluida).</p>
          )}
        </div>
      )}

    </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <MetricPicker platform={vm.platform} primary={vm.primaryMetric} choices={vm.metricChoices} pinned={vm.pinnedIds} canEdit={canEdit} />
        <ConfidenceMeter confidence={vm.confidence} />
        <span className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <span>
            Último dato <span className="tabular font-medium text-foreground">{formatTimeInTz(vm.lastDataAt, timezone)}</span>
            {!bad && vm.lagMinutes !== null && ` · hace ${vm.lagMinutes} min`}
          </span>
          <Link href={`/platforms/${vm.platform}`} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Ver ${vm.name}`}>
            {vm.alertsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <BellRing className="size-3" /> {vm.alertsCount}
              </span>
            )}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </span>
      </div>
    </div>
  );
}