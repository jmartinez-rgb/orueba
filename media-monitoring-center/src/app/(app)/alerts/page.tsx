import type { Metadata } from "next";
import { BellRing, CheckCheck, Eye, Layers, ListChecks, ShieldAlert } from "lucide-react";
import type { Severity } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { alertRows } from "@/lib/services/view-models";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { AlertsTable } from "@/components/monitoring/alerts-table";
import { SEVERITY_META } from "@/components/monitoring/status";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Alertas" };
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
  const STATUS_LABEL = { NEW: "Nuevas", ACKNOWLEDGED: "Reconocidas", INVESTIGATING: "En revisión" } as const;
  const byStatus = (["NEW", "ACKNOWLEDGED", "INVESTIGATING"] as const).map((s) => ({ s, n: primary.filter((r) => r.status === s).length }));
  const resolved = rows.filter((r) => r.resolvedAt !== null).length;
  const canWrite = snap.meta.permissions.includes("alerts:write");
  const whatsappPreview: Record<string, string> = {};
  for (const n of snap.state.notifications) if (n.channel === "whatsapp") whatsappPreview[n.incidentId] = n.text;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Centro de alertas" subtitle="Detecta lo que cambió, revisa la evidencia y da seguimiento a cada anomalía." />
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="surface rounded-2xl p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <dt className="text-xs font-medium text-muted-foreground">Alertas activas</dt>
            <span className="rounded-xl bg-primary/10 p-2 text-primary"><BellRing className="size-4" aria-hidden /></span>
          </div>
          <dd className="tabular text-3xl leading-none font-semibold tracking-tight">{primary.length}</dd>
          <p className="mt-2 text-[11px] text-muted-foreground">Sin contar alertas agrupadas</p>
        </div>
        {bySev.map(({ s, n }) => {
          const meta = SEVERITY_META[s];
          const Icon = meta.Icon;
          return (
            <div key={s} className="surface rounded-2xl p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <dt className="text-xs font-medium text-muted-foreground">{meta.label}</dt>
                <span className={cn("rounded-xl p-2", meta.tint, meta.text)}><Icon className="size-4" aria-hidden /></span>
              </div>
              <dd className={cn("tabular text-3xl leading-none font-semibold tracking-tight", n > 0 && meta.text)}>{n}</dd>
              <p className="mt-2 text-[11px] text-muted-foreground">Alertas activas sin agrupar</p>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-(--hairline) bg-card/60 px-4 py-3 text-xs">
        <span className="flex items-center gap-2 font-medium"><ListChecks className="size-4 text-muted-foreground" aria-hidden /> Seguimiento</span>
        {byStatus.map(({ s, n }) => <span key={s} className="text-muted-foreground">{STATUS_LABEL[s]} <strong className="tabular ml-1 font-semibold text-foreground">{n}</strong></span>)}
        <span className="flex items-center gap-1.5 text-muted-foreground"><Layers className="size-3.5" aria-hidden /> Agrupadas <strong className="tabular font-semibold text-foreground">{grouped}</strong></span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><CheckCheck className="size-3.5" aria-hidden /> Resueltas (36 h) <strong className="tabular font-semibold text-foreground">{resolved}</strong></span>
      </div>
      <Card>
        <CardHeader className="flex-wrap border-b border-(--hairline) pb-4">
          <div>
            <CardTitle>Cola de alertas</CardTitle>
            <CardDescription>Selecciona una alerta para consultar su diagnóstico y evidencia.</CardDescription>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {canWrite ? <ShieldAlert className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {canWrite ? "Seguimiento habilitado" : "Solo consulta"}
          </span>
        </CardHeader>
        <CardContent className="pt-4">
          <AlertsTable rows={rows} timezone={snap.meta.timezone} canWrite={canWrite} canNovedad={snap.meta.permissions.includes("novedades:write")} attention={snap.settings.thresholds.attention} whatsappPreview={whatsappPreview} />
        </CardContent>
      </Card>
      <p className="max-w-3xl px-1 text-xs leading-relaxed text-muted-foreground">Cada anomalía mantiene una sola alerta que se actualiza en cada evaluación. Las campañas con la misma causa se agrupan bajo la alerta de su plataforma o cuenta.</p>
    </div>
  );
}
