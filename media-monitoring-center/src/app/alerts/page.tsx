import type { Metadata } from "next";
import type { Severity } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows } from "@/lib/services/view-models";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { SEVERITY_META, StatusDot } from "@/components/monitoring/status";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Alert Center" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const rows = alertRows(snap);
  const active = rows.filter((r) => r.resolvedAt === null && r.status !== "FALSE_POSITIVE");
  const primary = active.filter((r) => !r.groupedUnder);
  const grouped = active.length - primary.length;
  const bySev = (["CRITICAL", "ALERT", "ATTENTION"] as Severity[]).map((s) => ({ s, n: primary.filter((r) => r.severity === s).length }));
  const byStatus = (["NEW", "ACKNOWLEDGED", "INVESTIGATING"] as const).map((s) => ({ s, n: primary.filter((r) => r.status === s).length }));
  const resolved = rows.filter((r) => r.resolvedAt !== null).length;
  const whatsappPreview: Record<string, string> = {};
  for (const n of snap.state.notifications) if (n.channel === "whatsapp") whatsappPreview[n.incidentId] = n.text;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Alert Center" subtitle="Cada anomalía genera una sola alerta viva que se actualiza en cada evaluación. Las campañas con la misma causa se agrupan bajo la alerta de su plataforma o cuenta." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {bySev.map(({ s, n }) => (
          <div key={s} className={cn("rounded-lg border bg-card px-3 py-2", n > 0 && SEVERITY_META[s].border)}>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusDot severity={s} /> {SEVERITY_META[s].label}
            </p>
            <p className="tabular text-xl font-bold">{n}</p>
          </div>
        ))}
        {byStatus.map(({ s, n }) => (
          <div key={s} className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{s}</p>
            <p className="tabular text-xl font-bold">{n}</p>
          </div>
        ))}
        <div className="rounded-lg border bg-card px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Agrupadas / resueltas 36 h</p>
          <p className="tabular text-xl font-bold">
            {grouped} <span className="text-sm font-medium text-muted-foreground">/ {resolved}</span>
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="pt-4">
          <AlertsTable rows={rows} timezone={snap.meta.timezone} canWrite={snap.meta.permissions.includes("alerts:write")} attention={snap.settings.thresholds.attention} whatsappPreview={whatsappPreview} />
        </CardContent>
      </Card>
    </div>
  );
}
