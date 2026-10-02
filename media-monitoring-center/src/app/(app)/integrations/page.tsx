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
import Link from "next/link";
import { getRecordStore, RECORD_BACKEND_LABEL } from "@/lib/records/store";
import { ExecutionTable, PipelineDiagram } from "@/components/monitoring/pipeline";
import { ExecutionChip } from "@/components/monitoring/execution-chip";
import { PLATFORMS } from "@/lib/platforms/registry";
import { MONTHS_ES } from "@/lib/time/tz";

import { UnifiedApiPanel } from "@/components/monitoring/unified-api-panel";
import { unifiedStatus } from "@/lib/integrations/unified-api";

export const metadata: Metadata = { title: "Integraciones" };
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
  const [items, unified] = [getIntegrations(snap), await unifiedStatus()];
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
      <PageHeader
        title="Integraciones"
        subtitle={
          snap.meta.mode === "unified"
            ? "Métricas de las APIs directas, con histórico guardado y cuentas separadas por marca. Los datos ausentes y los eventos pendientes de definir se muestran sin valor."
            : snap.meta.mode === "sheets"
            ? "Los datos se leen de la hoja de Google Sheets que actualiza Dataslayer (solo lectura, con la cuenta de servicio). Alertas: motor → n8n → WhatsApp. Ningún secreto llega al navegador."
            : "Conexión directa con cada plataforma (n8n) o, si no es posible, Google Sheets actualizado por Dataslayer y cargado por Apps Script a BigQuery (fuente única de verdad). Alertas: motor → n8n → WhatsApp. Ningún secreto llega al navegador."
        }
      />
      <section id="api-unificada" className="scroll-mt-20">
        <SectionTitle>API unificada de plataformas</SectionTitle>
        <UnifiedApiPanel status={unified} timezone={snap.meta.timezone} canTest={canTest} />
      </section>
      <section id="flujo" className="scroll-mt-20">
        <SectionTitle aside={<ExecutionChip execution={snap.execution} timezone={snap.meta.timezone} />}>Flujo de datos y control de ejecución</SectionTitle>
        <Card>
          <CardContent className="space-y-4 pt-4">
            <PipelineDiagram mode={snap.meta.mode} />
            {snap.execution.status === "PENDIENTE" && (
              <p className="rounded-md border border-status-attention/40 bg-status-attention/10 px-3 py-2 text-xs text-status-attention-text">
                Debe ejecutarse: {snap.execution.pending.join(", ")}. Corre el paso pendiente ({snap.meta.mode === "unified" ? "extracción de la API directa" : snap.meta.mode === "sheets" ? "actualiza la consulta en Dataslayer" : "Dataslayer / Apps Script"}) y luego usa “Actualizar ahora”. Mientras tanto la confianza de datos baja.
              </p>
            )}
            {snap.execution.status === "ERROR" && (
              <p className="rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-xs text-status-critical-text">Con error: {snap.execution.errors.join(", ")}. Revisa el paso en la hoja de control.</p>
            )}
            <ExecutionTable execution={snap.execution} ingestion={snap.settings.ingestion} timezone={snap.meta.timezone} canEdit={snap.meta.permissions.includes("settings:write")} fixedSource={snap.meta.mode === "sheets" || snap.meta.mode === "unified"} />
          </CardContent>
        </Card>
      </section>
      <section>
        <SectionTitle aside={<Link href="/settings#moneda" className="text-xs text-primary hover:underline">Capturar tasas</Link>}>Moneda y tipo de cambio</SectionTitle>
        <Card>
          <CardContent className="grid gap-4 pt-4 lg:grid-cols-2">
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">Todo se reporta en MXN. Las cuentas en USD se convierten con la tasa del mes de cada fecha (cambia cada mes).</p>
              {snap.currency.usdAccounts.length === 0 ? (
                <p>No hay cuentas en USD.</p>
              ) : (
                <ul className="space-y-1">
                  {snap.currency.usdAccounts.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <PlatformMark platform={a.platform} className="size-5 text-[9px]" /> <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground">({PLATFORMS[a.platform].shortName})</span>
                    </li>
                  ))}
                </ul>
              )}
              {snap.currency.issues.length > 0 && (
                <p className="rounded-md border border-status-attention/40 bg-status-attention/10 px-2.5 py-1.5 text-status-attention-text">
                  Falta la tasa de {[...new Set(snap.currency.issues.map((i) => i.month))].join(", ")}: {snap.currency.issues.some((i) => i.kind === "missing") ? "el gasto en USD de esos meses queda sin convertir (NULL)." : "se usa la del mes anterior."}
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">Mes</th>
                    <th className="py-1 text-right font-medium">1 USD =</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.currency.rates.slice(-6).map((r) => {
                    const [yy, mm] = r.month.split("-").map(Number);
                    return (
                      <tr key={r.month} className="border-b last:border-0">
                        <td className="py-1">
                          {MONTHS_ES[mm - 1]} {yy}
                        </td>
                        <td className="tabular py-1 text-right font-semibold">{r.rate.toFixed(4)} MXN</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
      <section>
        <SectionTitle>Infraestructura</SectionTitle>
        {render("core")}
      </section>
      <section>
        <SectionTitle>Plataformas publicitarias</SectionTitle>
        {render("platform")}
      </section>
      <p className="text-[11px] text-muted-foreground">
        Registros de la app (bitácora de accesos, tickets, acuses, mensajes de monitoreo): {RECORD_BACKEND_LABEL[getRecordStore().backend]}. Las métricas nunca se guardan ahí: se leen de {snap.meta.mode === "unified" ? "el histórico de APIs directas" : snap.meta.mode === "sheets" ? "la hoja de Google Sheets" : snap.meta.mode === "bigquery" ? "BigQuery" : "la fuente simulada"}.
      </p>
    </div>
  );
}
