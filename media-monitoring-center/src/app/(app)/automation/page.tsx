import type { Metadata } from "next";
import { getEnv } from "@/lib/config/env";
import { safeSnapshot } from "@/lib/services/safe";
import { getAppContext } from "@/lib/services/context";
import { WORKFLOWS } from "@/lib/n8n/workflows";
import { PLATFORMS } from "@/lib/platforms/registry";
import { durationLabel, formatDateTimeInTz, formatTimeInTz, hourLabel } from "@/lib/time/tz";
import type { SyncLogEntry } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/monitoring/page-header";
import { SeverityBadge } from "@/components/monitoring/status";
import { StateMessage } from "@/components/monitoring/states";
import { RefreshButton } from "@/components/layout/refresh-button";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

const SEV_ES = { NORMAL: "NORMAL", ATTENTION: "ATENCIÓN", ALERT: "ALERTA", CRITICAL: "CRÍTICO" } as const;

export default async function AutomationPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const env = getEnv();
  const ctx = await getAppContext();
  const tz = snap.meta.timezone;
  const mock = snap.meta.mode === "mock";
  let sync: SyncLogEntry[] = [];
  try {
    sync = await ctx.source.getSyncLog(40);
  } catch {
    sync = [];
  }
  const a = snap.settings.alerts;
  const lastRun = snap.runs[snap.runs.length - 1];
  const wfStatus = (id: string) => {
    const wf = WORKFLOWS.find((w) => w.id === id)!;
    if (wf.kind === "ingestion") {
      const last = sync.find((s) => s.platform === wf.platform);
      return { label: last ? last.status : "—", at: last?.startedAt ?? null, configured: true };
    }
    if (id === "WF07") return { label: lastRun ? "SUCCESS" : "—", at: lastRun?.at ?? null, configured: Boolean(env.monitoringApiKey) || mock };
    const lastN = [...snap.state.notifications].filter((n) => (id === "WF10" ? n.kind === "RECOVERED" : id === "WF09" ? n.kind === "ESCALATED" || n.kind === "DURATION_EXCEEDED" : true)).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    return { label: lastN ? lastN.status : "—", at: lastN?.createdAt ?? null, configured: Boolean(env.n8n.alertWebhook) || mock };
  };
  const notifications = [...snap.state.notifications].filter((n) => n.channel === "whatsapp").sort((x, y) => y.createdAt.localeCompare(x.createdAt));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Automation"
        subtitle="n8n orquesta ingestas, corridas programadas, alertas, escalamientos, recuperaciones y reintentos. Netlify solo aloja la app y su API."
        actions={<RefreshButton canTrigger={snap.meta.permissions.includes("monitoring:trigger")} size="default" />}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Workflows de n8n</CardTitle>
            <CardDescription>{mock ? "MOCK MODE: las ejecuciones de monitoreo se reproducen localmente y los webhooks se simulan." : "Estado según la última ejecución registrada."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Disparador</TableHead>
                <TableHead className="min-w-[280px]">Qué hace</TableHead>
                <TableHead>Conexión con la app</TableHead>
                <TableHead>Última ejecución</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {WORKFLOWS.map((w) => {
                const st = wfStatus(w.id);
                return (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.id}</TableCell>
                    <TableCell className="text-xs font-medium">{w.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.trigger}</TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">{w.purpose}</TableCell>
                    <TableCell className="text-xs">
                      {w.appEnv ? (
                        <span className={cn("font-mono text-[11px]", (w.appEnv === "N8N_ALERT_WEBHOOK" ? env.n8n.alertWebhook : w.appEnv === "N8N_MONITORING_WEBHOOK" ? env.n8n.monitoringWebhook : env.n8n.manualSyncWebhook) ? "text-status-normal-text" : "text-muted-foreground")}>
                          {w.appEnv}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {w.appEndpoint && <span className="block font-mono text-[10px] text-muted-foreground">{w.appEndpoint}</span>}
                      {w.template && <span className="block text-[10px] text-muted-foreground">Plantilla: {w.template}</span>}
                    </TableCell>
                    <TableCell className="tabular text-xs">{st.at ? formatDateTimeInTz(st.at, tz) : "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className={cn("font-semibold", st.label === "FAILED" ? "text-status-critical-text" : st.label === "—" ? "text-muted-foreground" : "text-status-normal-text")}>{st.label}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Monitoring Runner · ejecuciones de hoy</CardTitle>
              <CardDescription>Cada corrida evalúa, agrupa incidentes y decide si notificar.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {snap.runs.length === 0 ? (
              <StateMessage kind="empty" title="Aún no hay corridas hoy" description={`La primera evaluación es a las ${hourLabel(snap.meta.slots[0])}.`} compact />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corte</TableHead>
                    <TableHead>Ejecutado</TableHead>
                    <TableHead>Estado general</TableHead>
                    <TableHead className="text-right">Anomalías</TableHead>
                    <TableHead className="text-right">Incidentes abiertos</TableHead>
                    <TableHead className="text-right">Notificaciones</TableHead>
                    <TableHead className="text-right">Duración</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...snap.runs].reverse().map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular text-xs font-medium">{hourLabel(r.cutoffHour)}</TableCell>
                      <TableCell className="tabular text-xs">{formatTimeInTz(r.at, tz)}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={r.overall} />
                      </TableCell>
                      <TableCell className="tabular text-right text-xs">{r.anomalies}</TableCell>
                      <TableCell className="tabular text-right text-xs">{r.openIncidents}</TableCell>
                      <TableCell className="tabular text-right text-xs">{r.notifications}</TableCell>
                      <TableCell className="tabular text-right text-xs text-muted-foreground">{r.durationMs} ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Política de escalamiento</CardTitle>
              <CardDescription>Anti-spam: una anomalía no genera una alerta nueva cada 2 horas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-xs">
              <li>
                <span className="font-semibold">Incidente:</span> al llegar a {SEV_ES[a.incidentMinSeverity]} o tras {a.persistRunsForIncident} evaluaciones seguidas.
              </li>
              <li>
                <span className="font-semibold">Notificar al abrir:</span> desde {SEV_ES[a.notifyMinSeverity]} (campañas pequeñas solo si son CRÍTICO).
              </li>
              <li>
                <span className="font-semibold">Escalamiento:</span> cuando sube la severidad.
              </li>
              <li>
                <span className="font-semibold">Empeora:</span> si la desviación crece {Math.round(a.worsenDeltaPts * 100)} pp desde el último aviso.
              </li>
              <li>
                <span className="font-semibold">Duración:</span> un recordatorio al superar {a.escalateAfterHours} h abierto.
              </li>
              <li>
                <span className="font-semibold">Recuperación:</span> {a.notifyRecovery ? "se avisa con inicio, normalización, duración y desviación máxima." : "desactivada."}
              </li>
              <li className="text-muted-foreground">Destinatarios activos: {snap.settings.recipients.filter((r) => r.active).length} (Settings).</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Bitácora de notificaciones WhatsApp</CardTitle>
            <CardDescription>Mensajes entregados a n8n (WF08) para envío por WhatsApp Business Cloud API. {mock && "En MOCK MODE quedan como SIMULATED."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <StateMessage kind="empty" title="Sin notificaciones" description="Aún no hay incidentes que ameriten aviso." compact />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Incidente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Severidad</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Destinatarios</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="min-w-[260px]">Mensaje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.id}</TableCell>
                    <TableCell className="tabular text-xs">{formatDateTimeInTz(n.createdAt, tz)}</TableCell>
                    <TableCell className="font-mono text-xs">{n.incidentId}</TableCell>
                    <TableCell className="text-xs">{n.kind}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={n.severity} />
                    </TableCell>
                    <TableCell className="text-xs">{PLATFORMS[n.platform].shortName}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={n.recipients.join(", ")}>
                      {n.recipientCount} · {n.recipients[0]}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{n.status}</TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">{n.text.split("\n").slice(0, 3).join(" · ")}</summary>
                        <pre className="mt-1 rounded border bg-muted/50 p-2 font-sans whitespace-pre-wrap">{n.text}</pre>
                        {n.template && <pre className="mt-1 max-h-40 overflow-auto rounded border bg-muted/50 p-2 font-mono text-[10px] whitespace-pre-wrap">{JSON.stringify(n.template, null, 2)}</pre>}
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Registro de sincronizaciones (ingesta)</CardTitle>
            <CardDescription>WF01–WF06 → BigQuery. Los errores y reintentos se gestionan en n8n.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {sync.length === 0 ? (
            <StateMessage kind="empty" title="Sin registro de sincronización" description="Configura la tabla de sync log en BIGQUERY_MAPPING para verlo aquí." compact />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Filas</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Mensaje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sync.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="tabular text-xs">{formatDateTimeInTz(s.startedAt, tz)}</TableCell>
                    <TableCell className="text-xs">{s.workflow}</TableCell>
                    <TableCell className={cn("text-xs font-semibold", s.status === "FAILED" ? "text-status-critical-text" : "text-status-normal-text")}>{s.status}</TableCell>
                    <TableCell className="tabular text-right text-xs">{s.rowsLoaded ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.finishedAt ? durationLabel(Date.parse(s.finishedAt) - Date.parse(s.startedAt)) : "—"}</TableCell>
                    <TableCell className="max-w-80 truncate text-xs text-muted-foreground" title={s.message ?? ""}>
                      {s.message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
