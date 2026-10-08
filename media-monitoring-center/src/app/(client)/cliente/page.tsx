import type { Metadata } from "next";
import { CircleCheck, CircleDashed, Eye, LifeBuoy } from "lucide-react";
import { buildClientView, type ClientLevel } from "@/lib/client/client-view";
import { getViewContext } from "@/lib/services/context";
import { getBudgetControl } from "@/lib/services/budget";
import { safeSnapshot } from "@/lib/services/safe";
import { PLATFORMS } from "@/lib/platforms/registry";
import { formatDateTimeInTz } from "@/lib/time/tz";
import type { PlatformId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlatformMark, SeverityBadge } from "@/components/monitoring/status";

export const metadata: Metadata = { title: "Estado de campañas" };
export const dynamic = "force-dynamic";

const LEVEL: Record<ClientLevel, { Icon: typeof CircleCheck; tone: string; tint: string; dot: string }> = {
  ok: { Icon: CircleCheck, tone: "text-status-normal-text", tint: "bg-status-normal/12", dot: "bg-status-normal" },
  watch: { Icon: Eye, tone: "text-status-attention-text", tint: "bg-status-attention/14", dot: "bg-status-attention" },
  action: { Icon: LifeBuoy, tone: "text-status-alert-text", tint: "bg-status-alert/12", dot: "bg-status-alert" },
  nodata: { Icon: CircleDashed, tone: "text-muted-foreground", tint: "bg-foreground/[0.05]", dot: "bg-muted-foreground/50" },
};

export default async function ClientPage() {
  const res = await safeSnapshot("domain");
  if (!res.ok)
    return (
      <section className="surface p-8 text-center">
        <p className="text-[17px] font-semibold">Estamos actualizando la información</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Vuelve a intentarlo en unos minutos.</p>
      </section>
    );
  const snap = res.snap;
  const tz = snap.meta.timezone;
  // Avance del mes por plataforma (si hay presupuesto); si no se puede calcular, la vista sigue sin él.
  const month: Partial<Record<PlatformId | "total", { usedPct: number | null; expectedPct: number | null }>> = {};
  try {
    const control = await getBudgetControl(await getViewContext(undefined, "domain"), snap);
    for (const l of control.lines) {
      if (l.level === "total") month.total = { usedPct: l.usedPct, expectedPct: l.expectedPct };
      else if (l.level === "platform" && l.platform) month[l.platform] = { usedPct: l.usedPct, expectedPct: l.expectedPct };
    }
  } catch {
    // Sin presupuesto disponible no se muestra el avance del mes.
  }
  const view = buildClientView({
    platforms: snap.run.platforms,
    platformStatus: snap.run.platformStatus,
    pacing: snap.run.pacing,
    incidents: snap.state.incidents,
    alerts: snap.state.alerts,
    lastDataAt: snap.meta.lastDataAt,
    nextEvaluationAt: snap.meta.nextEvaluationAt,
    month,
    domain: snap.meta.domain,
    hasAccounts: snap.catalog.accounts.length > 0,
    scopeAccounts: snap.catalog.accounts,
  });
  const hero = LEVEL[view.overall];

  return (
    <div className="flex flex-col gap-5">
      {snap.meta.domain && snap.meta.domain.id !== "all" && <p className="rounded-lg border bg-card px-4 py-3 text-sm" role="status">Alcance: {snap.meta.domain.name}. {snap.meta.domain.available ? "El estado mostrado corresponde a este alcance." : "Su clasificación está pendiente de configuración."}</p>}
      <section className={cn("surface flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8")} aria-live="polite">
        <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl", hero.tint)} aria-hidden>
          <hero.Icon className={cn("size-7", hero.tone)} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] text-balance">{view.headline}</h1>
          <p className="mt-1 text-[14px] text-muted-foreground text-pretty">{view.message}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:text-right">
          <dt className="text-muted-foreground">Datos al</dt>
          <dd className="tabular font-medium">{view.updatedAt ? formatDateTimeInTz(view.updatedAt, tz) : "—"}</dd>
          <dt className="text-muted-foreground">Próxima revisión</dt>
          <dd className="tabular font-medium">{formatDateTimeInTz(view.nextReviewAt, tz)}</dd>
        </dl>
      </section>

      <section className="surface p-5" aria-label="Alertas de solo lectura">
        <h2 className="text-[15px] font-semibold">Alertas</h2>
        <p className="mt-1 text-xs text-muted-foreground">Solo lectura. El equipo autorizado registra la atención y el seguimiento.</p>
        {view.alerts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No hay alertas abiertas.</p> : <ul className="mt-3 space-y-2">
          {view.alerts.map((alert, index) => <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <PlatformMark platform={alert.platform} className="size-5 text-[9px]" />
            <SeverityBadge severity={alert.severity} /><span>{alert.what}</span>
            <span className="ml-auto text-xs text-muted-foreground">{formatDateTimeInTz(alert.since, tz)}</span>
          </li>)}
        </ul>}
      </section>

      {view.month && view.month.usedPct !== null && (
        <section className="surface p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Avance de la inversión del mes</h2>
            <span className="tabular text-[13px] text-muted-foreground">
              {view.month.usedPct}% ejercido{view.month.expectedPct !== null ? ` · ${view.month.expectedPct}% esperado a hoy` : ""}
            </span>
          </div>
          <MonthBar used={view.month.usedPct} expected={view.month.expectedPct} />
        </section>
      )}

      <section aria-label="Plataformas">
        <h2 className="mb-2 text-[15px] font-semibold">Plataformas</h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {view.platforms.map((p) => {
            const m = LEVEL[p.level];
            return (
              <li key={p.platform} className="surface flex min-w-0 flex-col gap-3 p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <PlatformMark platform={p.platform} className="size-7 text-[11px]" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium" title={PLATFORMS[p.platform].name}>{PLATFORMS[p.platform].name}</span>
                  <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.tint, m.tone)}>
                    <span className={cn("size-1.5 rounded-full", m.dot)} aria-hidden />
                    {p.label}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">Ritmo de hoy</dt>
                    <dd className="tabular text-[15px] font-semibold">{p.todayPct === null ? "—" : `${p.todayPct}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Mes ejercido</dt>
                    <dd className="tabular text-[15px] font-semibold">
                      {p.monthUsedPct === null ? "—" : `${p.monthUsedPct}%`}
                      {p.monthExpectedPct !== null && p.monthUsedPct !== null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">de {p.monthExpectedPct}% esperado</span>}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">Ritmo de hoy: gasto contra lo esperado a esta hora según el comportamiento habitual (100% = en ritmo).</p>
      </section>

      <section className="surface p-5" aria-label="Lo que estamos atendiendo">
        <h2 className="mb-2 text-[15px] font-semibold">Lo que estamos atendiendo</h2>
        {view.attending.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CircleCheck className="size-4 text-status-normal-text" aria-hidden /> No hay situaciones abiertas.
          </p>
        ) : (
          <ul className="divide-y divide-(--hairline)">
            {view.attending.map((a, i) => (
              <li key={`${a.platform}-${a.since}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]">
                <PlatformMark platform={a.platform} className="size-5 text-[9px]" />
                {/* En móvil el texto ocupa su renglón y la fecha y la etapa bajan al siguiente. */}
                <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">{a.what}</span>
                <span className="pl-8 text-xs text-muted-foreground tabular sm:pl-0">desde {formatDateTimeInTz(a.since, tz)}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", a.stage === "En atención" ? "bg-primary/12 text-primary" : "bg-foreground/[0.06] text-muted-foreground")}>{a.stage}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MonthBar({ used, expected }: { used: number; expected: number | null }) {
  return (
    <div className="relative h-2.5 rounded-full bg-foreground/[0.06]" role="img" aria-label={`${used}% ejercido${expected !== null ? `, ${expected}% esperado a hoy` : ""}`}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-primary/80" style={{ width: `${Math.min(100, Math.max(1, used))}%` }} />
      {expected !== null && <span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/60" style={{ left: `${Math.min(100, Math.max(0, expected))}%` }} aria-hidden />}
    </div>
  );
}
