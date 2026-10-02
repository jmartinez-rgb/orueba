"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Search, Ticket, UserRound, UserRoundPlus } from "lucide-react";
import { sileo } from "sileo";
import type { Alert, Incident, NotificationRecord } from "@/lib/alerts/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { ANOMALY_LABEL } from "@/lib/anomaly-engine/anomaly-engine";
import { fmtDelta, fmtMetric } from "@/lib/format";
import { METRICS } from "@/lib/metrics";
import { durationLabel, formatDateTimeInTz, formatTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DeltaText, PlatformMark, SeverityBadge, SEVERITY_META } from "./status";
import { AlertStatusBadge, ExplainedChip } from "./alerts-table";
import { NovedadForm } from "@/components/novedades/novedad-form";
import { novedadPrefillFromAlert, SpendBreakdownView } from "@/components/novedades/spend-breakdown";
import { StateMessage } from "./states";
import { assignedTo, type IncidentAssignee } from "@/lib/alerts/assignment";

const STATUS_LABEL: Record<Incident["status"], string> = { OPEN: "Abierto", ACKNOWLEDGED: "Reconocido", INVESTIGATING: "En revisión", RESOLVED: "Resuelto" };
const KIND_LABEL: Record<string, string> = {
  OPENED: "Apertura",
  UPDATED: "Actualización",
  ESCALATED: "Escalamiento",
  DEESCALATED: "Baja de severidad",
  WORSENED: "Empeora",
  DURATION_EXCEEDED: "Duración excedida",
  RECOVERED: "Recuperación",
  GROUPED: "Agrupado",
  STATUS: "Cambio de estado",
  NOTE: "Nota",
};

const NOTIFICATION_KIND: Record<NotificationRecord["kind"], string> = {
  OPENED: "Apertura",
  ESCALATED: "Escalamiento",
  WORSENED: "Empeora",
  DURATION_EXCEEDED: "Duración excedida",
  RECOVERED: "Recuperación",
};
const NOTIFICATION_STATUS: Record<NotificationRecord["status"], string> = {
  SENT: "Enviado",
  SIMULATED: "Simulado (demo)",
  FAILED: "Falló",
  SKIPPED: "No enviado",
  PENDING: "Pendiente",
};
const SEVERITY_RANK = ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"];

/** Alertas que forman el incidente: la principal primero y luego las agrupadas bajo ella, de la más grave a la menos. */
function incidentAlerts(inc: Incident, alerts: Alert[]): Alert[] {
  const own = alerts.filter((a) => a.id === inc.alertId || a.incidentId === inc.id || inc.childAlertIds.includes(a.id));
  return own.sort(
    (a, b) =>
      Number(b.id === inc.alertId) - Number(a.id === inc.alertId) ||
      SEVERITY_RANK.indexOf(b.maxSeverity) - SEVERITY_RANK.indexOf(a.maxSeverity) ||
      Math.abs(b.maxDeviation ?? 0) - Math.abs(a.maxDeviation ?? 0),
  );
}

function IncidentAlertItem({ alert: a, main, timezone, attention }: { alert: Alert; main: boolean; timezone: string; attention: number }) {
  const scope = a.adGroupName ? `${a.domain_name ?? "Sin clasificar"} · ${a.campaignName} → ${a.adGroupName}` : a.campaignName ?? (a.accountName ? `Cuenta: ${a.accountName}` : `Toda ${PLATFORMS[a.platform].shortName}`);
  const metricLabel = METRICS[a.metric]?.label ?? a.metric;
  return (
    <li>
      <details className="group rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs open:bg-foreground/[0.05]">
        <summary className="flex cursor-pointer list-none flex-col gap-1 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={a.resolvedAt ? a.maxSeverity : a.severity} />
            {main && <span className="rounded-full bg-foreground/[0.07] px-2 py-[3px] text-[11px] font-semibold">Principal</span>}
            <AlertStatusBadge status={a.status} />
            <span className="ml-auto tabular text-[11px] text-muted-foreground">{formatTimeInTz(a.detectedAt, timezone)}</span>
          </span>
          <span className="font-semibold text-foreground">{a.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <span className="max-w-full truncate">{scope}</span>
            <span aria-hidden>·</span>
            <span>{ANOMALY_LABEL[a.type]}</span>
            {a.currentValue !== null && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {metricLabel} <span className="tabular font-medium text-foreground">{fmtMetric(a.metric, a.currentValue, { compact: true })}</span>
                  {a.expectedValue !== null && <> vs {fmtMetric(a.metric, a.expectedValue, { compact: true })}</>}
                </span>
              </>
            )}
            {a.deviation !== null && <DeltaText value={a.deviation} unit={a.metric === "absolute_top_rate" ? "pp" : "%"} attention={attention} />}
          </span>
        </summary>
        <div className="mt-2 space-y-1.5 border-t border-(--hairline) pt-2 text-muted-foreground">
          <p className="text-foreground">{a.diagnosis}</p>
          {a.adjustments.map((t, i) => (
            <p key={i}>· {t}</p>
          ))}
          <p className="text-[11px]">
            {a.id} · {a.consecutiveRuns} {a.consecutiveRuns === 1 ? "evaluación" : "evaluaciones"} · desviación máxima {fmtDelta(a.maxDeviation, 1, a.metric === "absolute_top_rate" ? "pp" : "%")}
            {a.resolvedAt ? ` · se normalizó ${formatTimeInTz(a.resolvedAt, timezone)}` : ""}
          </p>
        </div>
      </details>
    </li>
  );
}

export function IncidentStatusBadge({ status }: { status: Incident["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap",
        status === "RESOLVED" ? "bg-status-normal/12 text-status-normal-text" : status === "OPEN" ? "bg-primary/12 text-primary" : status === "INVESTIGATING" ? "bg-status-attention/12 text-status-attention-text" : "bg-muted text-foreground",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function IncidentsTable({
  incidents,
  alerts = [],
  notifications,
  timezone,
  asOf,
  canWrite,
  initialId,
  compact,
  attention = 0.15,
  initialTab = "open",
  canNovedad = false,
  canAssign = false,
  currentUserId = null,
}: {
  /** Puede registrar el incidente como novedad aprobada (el monitoreo deja de alertarlo). */
  canNovedad?: boolean;
  canAssign?: boolean;
  currentUserId?: string | null;
  incidents: Incident[];
  /** Alertas ligadas a incidentes: el panel muestra las que formaron cada uno. */
  alerts?: Alert[];
  notifications: NotificationRecord[];
  timezone: string;
  asOf: string;
  canWrite: boolean;
  initialId?: string | null;
  compact?: boolean;
  attention?: number;
  initialTab?: "open" | "resolved" | "all" | "mine" | "unassigned";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "resolved" | "all" | "mine" | "unassigned">(initialTab);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const selectedTrigger = useRef<HTMLTableRowElement | null>(null);
  const [ownerDraft, setOwnerDraft] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<IncidentAssignee[]>([]);
  const [assignmentError, setAssignmentError] = useState(false);
  useEffect(() => {
    if (!canAssign || !selectedId) return;
    let current = true;
    fetch("/api/incidents/assignees", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("UNAVAILABLE");
      const data = await response.json() as { assignees: IncidentAssignee[] };
      if (current) { setAssignees(data.assignees); setAssignmentError(false); }
    }).catch(() => { if (current) { setAssignees([]); setAssignmentError(true); } });
    return () => { current = false; };
  }, [canAssign, selectedId]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const now = Date.parse(asOf);

  const list = useMemo(() => {
    const rank = (i: Incident) => ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"].indexOf(i.resolvedAt ? "NORMAL" : i.severity);
    let l = [...incidents].sort((a, b) => rank(b) - rank(a) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (compact || tab === "open") l = l.filter((i) => i.resolvedAt === null);
    else if (tab === "resolved") l = l.filter((i) => i.resolvedAt !== null);
    else if (tab === "mine") l = l.filter(i => i.resolvedAt === null && assignedTo(i, currentUserId));
    else if (tab === "unassigned") l = l.filter(i => i.resolvedAt === null && !i.ownerId);
    if (q.trim()) {
      const t = q.toLowerCase();
      l = l.filter((i) => [i.id, i.title, i.domain_name, i.adGroupName, i.campaignName, i.accountName, PLATFORMS[i.platform].name, i.owner].some((v) => v?.toLowerCase().includes(t)));
    }
    return l;
  }, [incidents, tab, q, compact, currentUserId]);

  const selected = incidents.find((i) => i.id === selectedId) ?? null;
  const selNotifications = selected ? notifications.filter((n) => n.incidentId === selected.id) : [];
  const selAlerts = selected ? incidentAlerts(selected, alerts) : [];
  const mainAlert = selected ? (selAlerts.find((a) => a.id === selected.alertId) ?? null) : null;
  const [novedadOpen, setNovedadOpen] = useState(false);

  async function patch(body: Record<string, unknown>) {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/incidents/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: body.note ? "Nota guardada" : body.ownerId !== undefined ? "Responsable asignado" : "Estado actualizado", description: selected.id });
      setNote("");
      setOwnerDraft(null);
      router.refresh();
    } catch {
      sileo.error({ title: "No se pudo guardar", description: "Revisa la conexión y vuelve a intentarlo." });
    } finally {
      setSaving(false);
    }
  }

  const duration = (i: Incident) => (i.resolvedAt ? Date.parse(i.resolvedAt) : now) - Date.parse(i.startedAt);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!compact && (
        <div className="space-y-3 rounded-xl bg-foreground/[0.025] p-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-w-0">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0" aria-label="Filtrar incidentes">
              <TabsTrigger value="open" className="h-8 text-xs">Abiertos <span className="tabular rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px]">{incidents.filter((i) => i.resolvedAt === null).length}</span></TabsTrigger>
              <TabsTrigger value="resolved" className="h-8 text-xs">Resueltos <span className="tabular rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px]">{incidents.filter((i) => i.resolvedAt !== null).length}</span></TabsTrigger>
              <TabsTrigger value="all" className="h-8 text-xs">Todos</TabsTrigger>
              {currentUserId && <TabsTrigger value="mine" className="h-8 text-xs">Mis pendientes <span className="tabular rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px]">{incidents.filter(i => !i.resolvedAt && assignedTo(i, currentUserId)).length}</span></TabsTrigger>}
              {canAssign && <TabsTrigger value="unassigned" className="h-8 text-xs">Sin delegar <span className="tabular rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px]">{incidents.filter(i => !i.resolvedAt && !i.ownerId).length}</span></TabsTrigger>}
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--hairline) pt-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar caso, cuenta o responsable…" className="h-9 bg-background pl-9 text-xs" aria-label="Buscar incidente, cuenta o responsable" />
          </div>
          <span className="text-xs text-muted-foreground" aria-live="polite"><strong className="tabular font-semibold text-foreground">{list.length}</strong> {list.length === 1 ? "caso visible" : "casos visibles"}</span>
          </div>
        </div>
      )}
      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--hairline) bg-foreground/[0.015] px-4 py-4">
          <StateMessage kind={q.trim() ? "empty" : "no-incidents"} title={q.trim() ? "No hay incidentes con esta búsqueda" : tab === "mine" ? "No tienes incidentes pendientes asignados" : tab === "unassigned" ? "No hay incidentes sin delegar" : tab === "resolved" ? "Sin incidentes resueltos" : tab === "all" ? "Sin incidentes registrados" : "Sin incidentes abiertos"} description={q.trim() ? "Busca por ID, cuenta, campaña o responsable, o borra la búsqueda para ver los casos de esta sección." : "Una anomalía persistente o grave se convierte en incidente y se actualiza en cada evaluación."} compact />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incidente</TableHead>
              <TableHead>Severidad</TableHead>
              <TableHead>Plataforma</TableHead>
              {!compact && <TableHead>Cuenta</TableHead>}
              {!compact && <TableHead>Campaña / alcance</TableHead>}
              {!compact && <TableHead>Inicio</TableHead>}
              {!compact && <TableHead>Resuelto</TableHead>}
              <TableHead>Duración</TableHead>
              <TableHead className="text-right">Desv. máx.</TableHead>
              {!compact && <TableHead className="text-right">Desv. actual</TableHead>}
              {!compact && <TableHead>Estado</TableHead>}
              {!compact && <TableHead>Responsable</TableHead>}
              {!compact && (
                <TableHead className="text-center">
                  <BellRing className="inline size-3.5" aria-label="Notificaciones" />
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((i) => (
              <TableRow key={i.id} className="cursor-pointer focus-visible:bg-primary/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" aria-label={`Abrir incidente ${i.id}: ${i.title}`} onClick={(e) => { selectedTrigger.current = e.currentTarget; setSelectedId(i.id); setOwnerDraft(null); }} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectedTrigger.current = e.currentTarget; setSelectedId(i.id); setOwnerDraft(null); } }}>
                <TableCell>
                  <p className="font-mono text-[11px] text-muted-foreground">{i.id}</p>
                  <p className={cn("truncate text-[11px] text-muted-foreground", compact ? "max-w-48" : "max-w-56")} title={i.title}>
                    {ANOMALY_LABEL[i.type]} · {i.title}
                  </p>
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={i.resolvedAt ? i.maxSeverity : i.severity} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <PlatformMark platform={i.platform} className="size-5 text-[9px]" />
                    {!compact && <span className="text-xs">{PLATFORMS[i.platform].shortName}</span>}
                  </span>
                </TableCell>
                {!compact && <TableCell className="max-w-40 truncate text-xs text-muted-foreground">{i.accountName ?? "—"}</TableCell>}
                {!compact && (
                  <TableCell className="max-w-52 truncate text-xs">
                    {i.adGroupName ?? i.campaignName ?? (i.level === "account" ? `Cuenta: ${i.accountName}` : "Toda la plataforma")}
                    {i.childAlertIds.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">(+{i.childAlertIds.length} agrupadas)</span>}
                  </TableCell>
                )}
                {!compact && <TableCell className="tabular text-xs">{formatDateTimeInTz(i.startedAt, timezone)}</TableCell>}
                {!compact && <TableCell className="tabular text-xs text-muted-foreground">{i.resolvedAt ? formatDateTimeInTz(i.resolvedAt, timezone) : "—"}</TableCell>}
                <TableCell className="text-xs">{durationLabel(duration(i))}</TableCell>
                <TableCell className="text-right text-xs">
                  <DeltaText value={i.maxDeviation} unit={i.metric === "absolute_top_rate" ? "pp" : "%"} attention={attention} digits={0} />
                </TableCell>
                {!compact && (
                  <TableCell className="text-right text-xs">
                    <DeltaText value={i.resolvedAt ? null : i.currentDeviation} unit={i.metric === "absolute_top_rate" ? "pp" : "%"} attention={attention} digits={0} />
                  </TableCell>
                )}
                {!compact && (
                  <TableCell>
                    <IncidentStatusBadge status={i.status} />
                  </TableCell>
                )}
                {!compact && <TableCell className="max-w-40 text-xs"><span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1", i.owner ? "bg-foreground/[0.04] text-foreground" : "bg-status-attention/10 text-status-attention-text")} title={i.owner ?? "Sin asignar"}>{i.owner ? <UserRound className="size-3 shrink-0" aria-hidden /> : <UserRoundPlus className="size-3 shrink-0" aria-hidden />}<span className="truncate">{i.owner ?? "Sin asignar"}</span></span></TableCell>}
                {!compact && <TableCell className="tabular text-center text-xs">{i.notification.count}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) { setSelectedId(null); setOwnerDraft(null); } }}>
        <SheetContent onCloseAutoFocus={(event) => { if (selectedTrigger.current?.isConnected) { event.preventDefault(); selectedTrigger.current.focus(); } }}>
          {selected && (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{selected.id}</span>
                  <SeverityBadge severity={selected.resolvedAt ? selected.maxSeverity : selected.severity} />
                  <IncidentStatusBadge status={selected.status} />
                </div>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>
                  {PLATFORMS[selected.platform].name}
                  {selected.accountName ? ` · ${selected.accountName}` : ""}
                  {selected.domain_name ? ` · ${selected.domain_name}` : ""}{selected.campaignName ? ` · ${selected.campaignName}` : ""}{selected.adGroupName ? ` → ${selected.adGroupName}` : ""} · {ANOMALY_LABEL[selected.type]}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <Info label="Inicio" value={formatDateTimeInTz(selected.startedAt, timezone)} />
                  <Info label="Resuelto" value={selected.resolvedAt ? formatDateTimeInTz(selected.resolvedAt, timezone) : "Abierto"} />
                  <Info label="Duración" value={durationLabel(duration(selected))} />
                  <Info label="Desviación máxima" value={fmtDelta(selected.maxDeviation, 1, selected.metric === "absolute_top_rate" ? "pp" : "%")} />
                  <Info label="Desviación actual" value={selected.resolvedAt ? "—" : fmtDelta(selected.currentDeviation, 1, selected.metric === "absolute_top_rate" ? "pp" : "%")} />
                  <Info label="Notificaciones" value={String(selected.notification.count)} />
                  <Info label="Responsable" value={selected.owner ?? "Sin asignar"} />
                </div>

                {mainAlert?.explained && <ExplainedChip by={mainAlert.explained} />}
                {mainAlert?.breakdown && (
                  <div className="rounded-xl bg-foreground/[0.03] p-3.5">
                    <SpendBreakdownView breakdown={mainAlert.breakdown} />
                  </div>
                )}
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-foreground">
                    Alertas del incidente <span className="font-normal text-muted-foreground">({selAlerts.length})</span>
                  </p>
                  {selAlerts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Las alertas de este incidente ya no están en el registro (se depuran un tiempo después de normalizarse).</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selAlerts.map((a) => (
                        <IncidentAlertItem key={a.id} alert={a} main={a.id === selected.alertId} timezone={timezone} attention={attention} />
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-[13px] font-semibold text-foreground">Línea de tiempo</p>
                  <ol className="relative space-y-3 border-l pl-4">
                    {selected.timeline.map((e, idx) => (
                      <li key={idx} className="relative text-xs">
                        <span className={cn("absolute top-1 -left-[21px] size-2.5 rounded-full ring-2 ring-card", e.kind === "RECOVERED" ? "bg-status-normal" : SEVERITY_META[e.severity].dot)} />
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular font-semibold">{formatTimeInTz(e.at, timezone)}</span>
                          <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                          {e.deviation !== null && <DeltaText value={e.deviation} unit={selected.metric === "absolute_top_rate" ? "pp" : "%"} attention={attention} />}
                          {e.notified && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                              <BellRing className="size-2.5" /> notificado
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground">{e.message}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                {selNotifications.length > 0 && (
                  <div>
                    <p className="mb-2 text-[13px] font-semibold text-foreground">Notificaciones por WhatsApp</p>
                    <div className="space-y-1.5">
                      {selNotifications
                        .filter((n) => n.channel === "whatsapp")
                        .map((n) => (
                          <details key={n.id} className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs">
                            <summary className="cursor-pointer">
                              <span className="font-mono">{n.id}</span> · {NOTIFICATION_KIND[n.kind] ?? n.kind} · {formatTimeInTz(n.createdAt, timezone)} · <span className="text-muted-foreground">{NOTIFICATION_STATUS[n.status] ?? n.status}</span>
                            </summary>
                            {n.detail && <p className="mt-2 text-[11px] text-muted-foreground">{n.detail}</p>}
                            <pre className="mt-2 font-sans whitespace-pre-wrap">{n.text}</pre>
                            <p className="mt-1 text-[11px] text-muted-foreground">Para: {n.recipients.join(", ") || "sin destinatarios"}</p>
                          </details>
                        ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-[13px] font-semibold text-foreground">Notas</p>
                  {selected.notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin notas.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selected.notes.map((n, idx) => (
                        <li key={idx} className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs">
                          <p>{n.text}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {n.author} · {formatDateTimeInTz(n.at, timezone)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canNovedad && selected.resolvedAt === null && mainAlert && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2.5">
                    <div className="text-xs">
                      <p className="font-semibold">¿Fue un cambio aprobado?</p>
                      <p className="text-muted-foreground">Regístralo como novedad: queda quién lo aprobó y por qué medio, y el incidente se cierra.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setNovedadOpen(true)}>
                      Registrar novedad
                    </Button>
                  </div>
                )}
                {canWrite && <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2.5">
                  <div className="text-xs">
                    <p className="font-semibold">¿El problema es grave?</p>
                    <p className="text-muted-foreground">Documenta a quién se reportó y el número de caso en un ticket.</p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/tickets?new=${selected.id}`}>
                      <Ticket /> Crear ticket
                    </Link>
                  </Button>
                </div>}
              </div>
              {canWrite ? (
                <div className="space-y-2 border-t px-5 py-3">
                  {canAssign && <div className="space-y-1">
                    <div className="flex gap-2">
                      <select value={ownerDraft ?? selected.ownerId ?? ""} onChange={e => setOwnerDraft(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" aria-label="Usuario responsable" disabled={saving || assignmentError}>
                        <option value="">Sin asignar</option>
                        {selected.ownerId && !assignees.some(a => a.id === selected.ownerId) && <option value={selected.ownerId}>{selected.owner} (revisar acceso)</option>}
                        {assignees.map(a => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
                      </select>
                      <Button size="sm" variant="outline" disabled={saving || assignmentError || ownerDraft === null} onClick={() => patch({ ownerId: ownerDraft || null })}>Delegar</Button>
                    </div>
                    {assignmentError ? <p className="text-xs text-destructive">No se pudo consultar a los usuarios. La asignación no cambió.</p> : <p className="text-xs text-muted-foreground">El responsable lo verá en Mis pendientes. La asignación queda en la bitácora.</p>}
                  </div>}
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agregar nota…" className="text-xs" aria-label="Nota" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={saving || !note.trim()} onClick={() => patch({ note })}>
                      Guardar nota
                    </Button>
                    {selected.resolvedAt === null && <Button size="sm" variant="outline" disabled={saving || !note.trim()} onClick={() => patch({ status: "RESOLVED", note })}>Resolver con nota</Button>}
                    {selected.resolvedAt === null &&
                      (["ACKNOWLEDGED", "INVESTIGATING"] as const).map((s) => (
                        <Button key={s} size="sm" variant="outline" disabled={saving || selected.status === s} onClick={() => patch({ status: s })}>
                          {s === "ACKNOWLEDGED" ? "Marcar reconocido" : "Marcar en revisión"}
                        </Button>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">Tu rol es de solo lectura.</p>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      {novedadOpen && selected && mainAlert && (
        <NovedadForm
          open
          onOpenChange={setNovedadOpen}
          today={new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
          prefill={novedadPrefillFromAlert(mainAlert, selected.id)}
          onCreated={() => {
            setNovedadOpen(false);
            setSelectedId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular font-medium">{value}</p>
    </div>
  );
}
