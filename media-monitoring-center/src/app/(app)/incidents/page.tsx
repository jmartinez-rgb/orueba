import type { Metadata } from "next";
import { BellRing, CircleCheck, Clock3, Eye, ShieldAlert, UserRoundCheck, type LucideIcon } from "lucide-react";
import { safeSnapshot } from "@/lib/services/safe";
import { durationLabel } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Incidentes" };
export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const { id, view } = await searchParams;
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const s = snap.settings.alerts;
  const open = snap.state.incidents.filter((i) => i.resolvedAt === null);
  const resolved = snap.state.incidents.filter((i) => i.resolvedAt !== null);
  const mttr = resolved.length ? resolved.reduce((a, i) => a + (Date.parse(i.resolvedAt!) - Date.parse(i.startedAt)), 0) / resolved.length : null;
  const sent = snap.state.notifications.filter((n) => n.channel === "whatsapp").length;
  const canWrite = snap.meta.permissions.includes("incidents:write");
  const canAssign = snap.meta.permissions.includes("incidents:assign");
  const unassigned = open.filter((i) => !i.ownerId).length;
  const investigating = open.filter((i) => i.status === "INVESTIGATING").length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Gestión de incidentes"
        subtitle="Revisa los casos abiertos, identifica al responsable y conserva el historial de atención."
      />
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Incidentes abiertos" value={String(open.length)} detail="Pendientes de resolución" Icon={ShieldAlert} tone={open.length > 0 ? "text-status-alert-text bg-status-alert/12" : "text-primary bg-primary/10"} />
        <Stat label="Resueltos" value={String(resolved.length)} detail="Historial disponible" Icon={CircleCheck} tone="text-status-normal-text bg-status-normal/12" />
        <Stat label="Tiempo medio de resolución" value={mttr === null ? "—" : durationLabel(mttr)} detail="Calculado sobre casos resueltos" Icon={Clock3} tone="text-primary bg-primary/10" />
        <Stat label="Notificaciones registradas" value={String(sent)} detail="Canal WhatsApp" Icon={BellRing} tone="text-muted-foreground bg-foreground/[0.05]" />
      </dl>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-(--hairline) bg-card/60 px-4 py-3 text-xs">
        <span className="flex items-center gap-2 font-medium"><UserRoundCheck className="size-4 text-muted-foreground" aria-hidden /> Atención del equipo</span>
        <span className="text-muted-foreground">Con responsable <strong className="tabular ml-1 font-semibold text-foreground">{open.length - unassigned}</strong></span>
        <span className="text-muted-foreground">Sin delegar <strong className={cn("tabular ml-1 font-semibold", unassigned > 0 ? "text-status-attention-text" : "text-foreground")}>{unassigned}</strong></span>
        <span className="text-muted-foreground">En revisión <strong className="tabular ml-1 font-semibold text-foreground">{investigating}</strong></span>
      </div>
      <Card>
        <CardHeader className="flex-wrap border-b border-(--hairline) pb-4">
          <div>
            <CardTitle>Casos y seguimiento</CardTitle>
            <CardDescription>Abre un incidente para revisar su línea de tiempo, alertas y notas.</CardDescription>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {canWrite ? <UserRoundCheck className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {canWrite ? canAssign ? "Delegación habilitada" : "Seguimiento habilitado" : "Solo consulta"}
          </span>
        </CardHeader>
        <CardContent className="pt-4">
          <IncidentsTable
            incidents={snap.state.incidents}
            alerts={snap.state.alerts.filter((a) => a.incidentId !== null)}
            notifications={snap.state.notifications}
            timezone={snap.meta.timezone}
            asOf={snap.meta.asOf}
            canWrite={canWrite}
            canNovedad={snap.meta.permissions.includes("novedades:write")}
            canAssign={canAssign}
            currentUserId={snap.meta.userId}
            initialTab={view === "mine" ? "mine" : view === "unassigned" && canAssign ? "unassigned" : "open"}
            initialId={id ?? null}
            attention={snap.settings.thresholds.attention}
          />
        </CardContent>
      </Card>
      <p className="max-w-4xl px-1 text-xs leading-relaxed text-muted-foreground">{`Una anomalía se vuelve incidente si llega a ${s.incidentMinSeverity} o persiste ${s.persistRunsForIncident} evaluaciones. Se notifica al abrir (≥ ${s.notifyMinSeverity}), al escalar, al empeorar ${Math.round(s.worsenDeltaPts * 100)} pp, al superar ${s.escalateAfterHours} h y al recuperarse. La misma anomalía conserva su incidente.`}</p>
    </div>
  );
}

function Stat({ label, value, detail, Icon, tone }: { label: string; value: string; detail: string; Icon: LucideIcon; tone: string }) {
  return (
    <div className="surface rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <span className={cn("shrink-0 rounded-xl p-2", tone)}><Icon className="size-4" aria-hidden /></span>
      </div>
      <dd className="tabular text-3xl leading-none font-semibold tracking-tight">{value}</dd>
      <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}
