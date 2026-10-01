import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { hasPermission, requireSession } from "@/lib/auth/session";
import { AUDIT_TARGETS, CHECK_LABEL } from "@/lib/audit/incident-audit";
import { buildAuditView } from "@/lib/services/audit";
import { safeSnapshot } from "@/lib/services/safe";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SectionTitle } from "@/components/monitoring/page-header";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { StateMessage } from "@/components/monitoring/states";
import { AuditBoard } from "@/components/audit/audit-board";

export const metadata: Metadata = { title: "Auditoría" };
export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90] as const;
const pct = (ok: number, of: number) => (of ? Math.round((ok / of) * 100) : null);
const minutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`);

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireSession("/auditoria");
  if (!hasPermission(session, "audit:view"))
    return (
      <Card>
        <StateMessage kind="empty" title="Sin acceso a la auditoría" description="La auditoría de incidencias es para el equipo de auditoría y la administración. Pide el permiso a un administrador." />
      </Card>
    );
  const sp = await searchParams;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 30;
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const view = await buildAuditView(snap, days);
  const s = view.summary;
  const canWrite = hasPermission(session, "audit:write");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Auditoría de incidencias"
        subtitle="Revisa si el proceso se cumple en cada incidente: si se atendió a tiempo, tuvo responsable, se le dio seguimiento, se reportó y se cerró documentado. Solo cuenta lo que el equipo dejó registrado."
        actions={
          <div className="flex gap-1 rounded-full bg-foreground/[0.05] p-1" role="group" aria-label="Periodo">
            {PERIODS.map((d) => (
              <Link
                key={d}
                href={`/auditoria?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", d === days ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {d} días
              </Link>
            ))}
          </div>
        }
      />

      {view.warnings.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-status-attention/10 px-3 py-2 text-[13px] text-status-attention-text">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {view.warnings.join(" ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Cumplimiento del proceso" value={s.compliance === null ? "—" : `${s.compliance}%`} tone={s.compliance === null ? undefined : s.compliance >= 90 ? "good" : s.compliance >= 70 ? "warn" : "bad"} />
        <Stat label={`Incidentes (${days} días)`} value={String(s.total)} hint={`${s.open} abiertos`} />
        <Stat label="Mediana a la primera atención" value={minutes(s.medianAttentionMin)} />
        <Stat label="Abiertos sin seguimiento" value={String(s.staleOpen)} tone={s.staleOpen ? "bad" : "good"} />
        <Stat label="Con dictamen" value={`${s.reviewed} de ${s.total}`} hint={s.reviewVerdicts.NO_CUMPLE ? `${s.reviewVerdicts.NO_CUMPLE} no cumplen` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="surface p-5">
          <SectionTitle>Cumplimiento por paso del proceso</SectionTitle>
          <ul className="flex flex-col gap-2.5">
            {s.byCheck.map((c) => {
              const p = pct(c.ok, c.applicable);
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="truncate">{CHECK_LABEL[c.id]}</span>
                  <span className="relative h-2 rounded-full bg-foreground/[0.06]" aria-hidden>
                    {p !== null && (
                      <span
                        className={cn("absolute inset-y-0 left-0 rounded-full", p >= 90 ? "bg-status-normal" : p >= 70 ? "bg-status-attention" : "bg-status-critical")}
                        style={{ width: `${Math.max(2, p)}%` }}
                      />
                    )}
                  </span>
                  <span className="w-24 text-right tabular text-muted-foreground">{p === null ? "No aplica" : `${p}% · ${c.ok}/${c.applicable}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="surface p-5">
          <SectionTitle>Por responsable</SectionTitle>
          {s.byPerson.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Sin incidentes en el periodo.</p>
          ) : (
            <ul className="divide-y divide-(--hairline)">
              {s.byPerson.slice(0, 10).map((p) => (
                <li key={p.person} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{p.person}</span>
                  <span className="tabular text-muted-foreground">{p.incidents} inc.</span>
                  <span className={cn("w-12 text-right font-semibold tabular", p.compliance === null ? "text-muted-foreground" : p.compliance >= 90 ? "text-status-normal-text" : p.compliance >= 70 ? "text-status-attention-text" : "text-status-critical-text")}>
                    {p.compliance === null ? "—" : `${p.compliance}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Card>
        <CardContent className="pt-4">
          <AuditBoard rows={view.rows} canWrite={canWrite} timezone={snap.meta.timezone} days={days} />
        </CardContent>
      </Card>

      <section className="surface flex items-start gap-3 p-5 text-[13px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium text-foreground">Metas del proceso</p>
          <p>
            Primera atención: crítico {AUDIT_TARGETS.attentionMin.CRITICAL} min, alerta {AUDIT_TARGETS.attentionMin.ALERT / 60} h, atención {AUDIT_TARGETS.attentionMin.ATTENTION / 60} h. Seguimiento
            máximo sin actualizar: {AUDIT_TARGETS.followUpHours.CRITICAL} h, {AUDIT_TARGETS.followUpHours.ALERT} h y {AUDIT_TARGETS.followUpHours.ATTENTION} h. Resolución: {AUDIT_TARGETS.resolutionHours.CRITICAL} h,{" "}
            {AUDIT_TARGETS.resolutionHours.ALERT} h y {AUDIT_TARGETS.resolutionHours.ATTENTION} h. Desde alerta se exige responsable y reporte (ticket, acuse crítico o mensaje de monitoreo). Un cierre manual necesita nota o novedad.
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="surface rounded-xl px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular text-[22px] leading-tight font-semibold tracking-[-0.02em]",
          tone === "good" && "text-status-normal-text",
          tone === "warn" && "text-status-attention-text",
          tone === "bad" && "text-status-critical-text",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
