import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { durationLabel } from "@/lib/time/tz";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { IncidentsTable } from "@/components/monitoring/incidents-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const s = snap.settings.alerts;
  const open = snap.state.incidents.filter((i) => i.resolvedAt === null);
  const resolved = snap.state.incidents.filter((i) => i.resolvedAt !== null);
  const mttr = resolved.length ? resolved.reduce((a, i) => a + (Date.parse(i.resolvedAt!) - Date.parse(i.startedAt)), 0) / resolved.length : null;
  const sent = snap.state.notifications.filter((n) => n.channel === "whatsapp").length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Incidents"
        subtitle={`Una anomalía se vuelve incidente si llega a ${s.incidentMinSeverity} o persiste ${s.persistRunsForIncident} evaluaciones. Se notifica al abrir (≥ ${s.notifyMinSeverity}), al escalar, al empeorar ${Math.round(s.worsenDeltaPts * 100)} pp, al superar ${s.escalateAfterHours} h y al recuperarse. Nunca un incidente nuevo por la misma anomalía.`}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Abiertos" value={String(open.length)} />
        <Stat label="Resueltos (historial)" value={String(resolved.length)} />
        <Stat label="Tiempo medio de resolución" value={mttr === null ? "—" : durationLabel(mttr)} />
        <Stat label="Mensajes WhatsApp (ayer y hoy)" value={String(sent)} />
      </div>
      <Card>
        <CardContent className="pt-4">
          <IncidentsTable
            incidents={snap.state.incidents}
            notifications={snap.state.notifications}
            timezone={snap.meta.timezone}
            asOf={snap.meta.asOf}
            canWrite={snap.meta.permissions.includes("incidents:write")}
            initialId={id ?? null}
            attention={snap.settings.thresholds.attention}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-xl px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular text-[22px] leading-tight font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  );
}
