import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CalendarCheck2, CalendarClock, TriangleAlert } from "lucide-react";
import { requireSession, hasPermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { safeSnapshot } from "@/lib/services/safe";
import { kickoffStatus } from "@/lib/services/kickoff";
import { listNovedades, novedadActiveOn } from "@/lib/records/novedades";
import { PLATFORMS } from "@/lib/platforms/registry";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionTitle } from "@/components/monitoring/page-header";
import { DeltaText, PlatformMark } from "@/components/monitoring/status";
import { NovedadesBoard } from "@/components/novedades/novedades-board";
import type { ScopeCatalog } from "@/components/novedades/novedad-form";

export const metadata: Metadata = { title: "Novedades" };
export const dynamic = "force-dynamic";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;

export default async function NovedadesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await requireSession("/novedades");
  const sp = await searchParams;
  const [ctx, snapRes] = await Promise.all([getAppContext(), safeSnapshot()]);
  const snap = snapRes.ok ? snapRes.snap : null;
  const status = await kickoffStatus(ctx, snap);
  const novedades = await listNovedades(ctx.brand);
  const tz = ctx.settings.timezone;
  const today = status.today;
  const catalog: ScopeCatalog = {
    platforms: snap?.run.platforms ?? ctx.settings.monitoredPlatforms,
    accounts: (snap?.catalog.accounts ?? []).map((a) => ({ id: a.id, name: a.name, platform: a.platform })).sort((a, b) => a.name.localeCompare(b.name)),
    campaigns: (snap?.catalog.campaigns ?? []).map((c) => ({ id: c.id, name: c.name, platform: c.platform, accountId: c.accountId })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  const silenced = snap?.run.silenced ?? [];
  const applying: Record<string, number> = {};
  for (const s of silenced) if (!s.anomaly.groupedUnder) applying[s.authorizationId] = (applying[s.authorizationId] ?? 0) + 1;
  const month = status.month;
  const active = novedades.filter((n) => novedadActiveOn(n, today)).length;
  const thisMonth = novedades.filter((n) => n.createdAt.slice(0, 7) === month || n.effectiveFrom.slice(0, 7) === month);
  const budgetAdjustments = thisMonth.filter((n) => n.kind === "PRESUPUESTO").length;
  const canKickoff = hasPermission(session, "kickoff:write");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Novedades"
        subtitle="Ajustes aprobados durante el mes: presupuesto, pausas, activaciones y cambios de plataforma. Quedan en el historial con quién los aprobó y por qué medio, y el monitoreo los toma en cuenta para no alertar lo que ya se sabe."
      />

      <section
        className={cn("surface flex flex-col gap-3 p-5", !status.confirmed && "ring-1 ring-status-attention/40")}
        aria-label={`Arranque de ${monthName(month)}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", status.confirmed ? "bg-status-normal/12" : "bg-status-attention/14")} aria-hidden>
              {status.confirmed ? <CalendarCheck2 className="size-5 text-status-normal-text" /> : <CalendarClock className="size-5 text-status-attention-text" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-[-0.015em]">
                Arranque de {monthName(month)} {status.confirmed ? "confirmado" : "pendiente"}
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {status.confirmed
                  ? `Lo confirmó ${status.confirmedBy} el ${formatDateTimeInTz(status.confirmedAt!, tz)}.`
                  : "Cada mes un administrador o co-administrador captura los presupuestos y marca qué está activo y qué está pendiente por iniciar. Sin esto, el pacing contra presupuesto no se puede evaluar."}
              </p>
            </div>
          </div>
          {canKickoff ? (
            <Button asChild size="sm" variant={status.confirmed ? "outline" : "default"}>
              <Link href="/novedades/arranque">{status.confirmed ? "Editar arranque" : "Completar arranque"}</Link>
            </Button>
          ) : (
            !status.confirmed && <p className="text-xs text-muted-foreground">Lo completa un administrador o co-administrador.</p>
          )}
        </div>
        {status.missingBudgets.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-status-attention/10 px-3 py-2 text-[13px] text-status-attention-text">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Sin presupuesto de {monthName(month)}: {status.missingBudgets.map((p) => PLATFORMS[p].name).join(", ")}.
          </p>
        )}
        {status.pending.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Pendientes por iniciar ({status.pending.length})</p>
            <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.03]">
              {status.pending.slice(0, 8).map((p) => (
                <li key={p.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <PlatformMark platform={p.platform} className="size-5 text-[9px]" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className={cn("shrink-0 text-xs tabular", p.overdue ? "font-semibold text-status-alert-text" : "text-muted-foreground")}>
                    {p.expectedStart ? `${p.overdue ? "Debía iniciar" : "Inicia"} ${p.expectedStart}` : "Sin fecha"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Vigentes hoy" value={String(active)} />
        <Stat label={`Registradas en ${monthName(month)}`} value={String(thisMonth.length)} />
        <Stat label="Ajustes de presupuesto" value={String(budgetAdjustments)} />
        <Stat label="Alertas en silencio hoy" value={String(silenced.filter((s) => !s.anomaly.groupedUnder).length)} />
      </div>

      {silenced.length > 0 && (
        <section className="surface p-5">
          <SectionTitle>Lo que el monitoreo está tomando en cuenta hoy</SectionTitle>
          <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.03]">
            {silenced
              .filter((s) => !s.anomaly.groupedUnder)
              .map((s) => (
                <li key={s.anomaly.fingerprint} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13px]">
                  <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <PlatformMark platform={s.anomaly.platform} className="size-5 text-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.anomaly.title}</span>
                    <span className="text-muted-foreground"> · {s.anomaly.campaignName ?? s.anomaly.accountName ?? PLATFORMS[s.anomaly.platform].name}</span>
                  </span>
                  {s.anomaly.deviation !== null && <DeltaText value={s.anomaly.deviation} attention={ctx.settings.thresholds.attention} />}
                  <Link href={s.authorizationId.startsWith("NOV-") ? `/novedades?id=${s.authorizationId}` : "/novedades"} className="text-xs text-primary hover:underline">
                    {s.authorizationId.startsWith("NOV-") ? s.authorizationId : "Arranque de mes"} · aprobó {s.by}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      <Card>
        <CardContent className="pt-4">
          <NovedadesBoard
            novedades={novedades}
            today={today}
            timezone={tz}
            catalog={catalog}
            canWrite={hasPermission(session, "novedades:write")}
            applying={applying}
            initialId={sp.id && /^NOV-\d+$/.test(sp.id) ? sp.id : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-xl px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-[22px] leading-tight font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  );
}
