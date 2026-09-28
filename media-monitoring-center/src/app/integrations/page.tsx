import type { Metadata } from "next";
import { CircleCheck, CircleDashed, CloudOff, FlaskConical, Hourglass, Layers, PowerOff } from "lucide-react";
import { safeSnapshot } from "@/lib/services/safe";
import { getIntegrations, type IntegrationStatus } from "@/lib/services/integrations";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SectionTitle } from "@/components/monitoring/page-header";
import { PlatformMark } from "@/components/monitoring/status";
import { TestConnectionButton } from "@/components/monitoring/test-connection";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const STATUS: Record<IntegrationStatus, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  CONNECTED: { label: "Connected", tone: "text-status-normal-text border-status-normal/40 bg-status-normal/10", Icon: CircleCheck },
  MOCK: { label: "Mock (simulado)", tone: "text-muted-foreground border-dashed", Icon: FlaskConical },
  NOT_CONFIGURED: { label: "Sin configurar", tone: "text-muted-foreground", Icon: CircleDashed },
  DEGRADED: { label: "Parcial", tone: "text-status-attention-text border-status-attention/40 bg-status-attention/10", Icon: Layers },
  DELAYED: { label: "Data delayed", tone: "text-status-data-text border-status-data/50 bg-status-data/10", Icon: Hourglass },
  ERROR: { label: "Error", tone: "text-status-critical-text border-status-critical/40 bg-status-critical/10", Icon: CloudOff },
  DISABLED: { label: "Desactivado", tone: "text-muted-foreground", Icon: PowerOff },
};

export default async function IntegrationsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const items = getIntegrations(snap);
  const canTest = snap.meta.permissions.includes("technical:view");
  const render = (group: "core" | "platform") => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items
        .filter((i) => i.group === group)
        .map((i) => {
          const s = STATUS[i.status];
          return (
            <Card key={i.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {i.platform ? <PlatformMark platform={i.platform} className="size-5 text-[9px]" /> : null}
                  {i.name}
                </CardTitle>
                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.tone)}>
                  <s.Icon className="size-3" /> {s.label}
                </span>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <p className="text-xs">
                  <span className="text-muted-foreground">{i.lastLabel}: </span>
                  <span className="tabular font-semibold">{i.lastAt ? formatDateTimeInTz(i.lastAt, snap.meta.timezone) : "—"}</span>
                </p>
                <p className="text-xs text-muted-foreground">{i.detail}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {i.facts.map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="truncate font-medium" title={f.value}>
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {i.testable && <TestConnectionButton target={i.testable} enabled={canTest} />}
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Integrations" subtitle="APIs publicitarias → n8n → BigQuery (fuente única de verdad) → motores de monitoreo → app. Alertas: motor → n8n → WhatsApp. Ningún secreto llega al navegador." />
      <section>
        <SectionTitle>Infraestructura</SectionTitle>
        {render("core")}
      </section>
      <section>
        <SectionTitle>Plataformas publicitarias</SectionTitle>
        {render("platform")}
      </section>
    </div>
  );
}
