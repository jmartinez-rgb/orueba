"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Search, Ticket } from "lucide-react";
import { sileo } from "sileo";
import type { Incident, NotificationRecord } from "@/lib/alerts/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { ANOMALY_LABEL } from "@/lib/anomaly-engine/anomaly-engine";
import { fmtDelta } from "@/lib/format";
import { durationLabel, formatDateTimeInTz, formatTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DeltaText, PlatformMark, SeverityBadge, SEVERITY_META } from "./status";
import { StateMessage } from "./states";

const STATUS_LABEL: Record<Incident["status"], string> = { OPEN: "OPEN", ACKNOWLEDGED: "ACKNOWLEDGED", INVESTIGATING: "INVESTIGATING", RESOLVED: "RESOLVED" };
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

export function IncidentStatusBadge({ status }: { status: Incident["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold",
        status === "RESOLVED" ? "border-status-normal/40 bg-status-normal/10 text-status-normal-text" : status === "OPEN" ? "border-primary/30 bg-primary/15 text-primary" : "bg-muted",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function IncidentsTable({
  incidents,
  notifications,
  timezone,
  asOf,
  canWrite,
  initialId,
  compact,
  attention = 0.15,
  initialTab = "open",
}: {
  incidents: Incident[];
  notifications: NotificationRecord[];
  timezone: string;
  asOf: string;
  canWrite: boolean;
  initialId?: string | null;
  compact?: boolean;
  attention?: number;
  initialTab?: "open" | "resolved" | "all";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "resolved" | "all">(initialTab);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const now = Date.parse(asOf);

  const list = useMemo(() => {
    const rank = (i: Incident) => ["NORMAL", "ATTENTION", "ALERT", "CRITICAL"].indexOf(i.resolvedAt ? "NORMAL" : i.severity);
    let l = [...incidents].sort((a, b) => rank(b) - rank(a) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (compact || tab === "open") l = l.filter((i) => i.resolvedAt === null);
    else if (tab === "resolved") l = l.filter((i) => i.resolvedAt !== null);
    if (q.trim()) {
      const t = q.toLowerCase();
      l = l.filter((i) => [i.id, i.title, i.campaignName, i.accountName, PLATFORMS[i.platform].name, i.owner].some((v) => v?.toLowerCase().includes(t)));
    }
    return l;
  }, [incidents, tab, q, compact]);

  const selected = incidents.find((i) => i.id === selectedId) ?? null;
  const selNotifications = selected ? notifications.filter((n) => n.incidentId === selected.id) : [];

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
      sileo.success({ title: body.note ? "Nota guardada" : body.owner !== undefined ? "Responsable asignado" : "Estado actualizado", description: selected.id });
      setNote("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const duration = (i: Incident) => (i.resolvedAt ? Date.parse(i.resolvedAt) : now) - Date.parse(i.startedAt);

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="open">Abiertos ({incidents.filter((i) => i.resolvedAt === null).length})</TabsTrigger>
              <TabsTrigger value="resolved">Resueltos ({incidents.filter((i) => i.resolvedAt !== null).length})</TabsTrigger>
              <TabsTrigger value="all">Todos</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar incidente…" className="h-8 pl-8 text-xs" aria-label="Buscar incidente" />
          </div>
        </div>
      )}
      {list.length === 0 ? (
        <StateMessage kind="no-incidents" title={tab === "resolved" ? "Sin incidentes resueltos" : "Sin incidentes abiertos"} description="Una anomalía persistente o grave se convierte en incidente y se actualiza en cada evaluación." compact />
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
              {!compact && <TableHead>Owner</TableHead>}
              {!compact && (
                <TableHead className="text-center">
                  <BellRing className="inline size-3.5" aria-label="Notificaciones" />
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((i) => (
              <TableRow key={i.id} className="cursor-pointer" onClick={() => { setSelectedId(i.id); setOwner(i.owner ?? ""); }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelectedId(i.id)}>
                <TableCell>
                  <p className="font-mono text-xs">{i.id}</p>
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
                    {i.campaignName ?? (i.level === "account" ? `Cuenta: ${i.accountName}` : "Toda la plataforma")}
                    {i.childAlertIds.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">(+{i.childAlertIds.length} agrupadas)</span>}
                  </TableCell>
                )}
                {!compact && <TableCell className="tabular text-xs">{formatDateTimeInTz(i.startedAt, timezone)}</TableCell>}
                {!compact && <TableCell className="tabular text-xs text-muted-foreground">{i.resolvedAt ? formatDateTimeInTz(i.resolvedAt, timezone) : "—"}</TableCell>}
                <TableCell className="text-xs">{durationLabel(duration(i))}</TableCell>
                <TableCell className="text-right text-xs">
                  <DeltaText value={i.maxDeviation} attention={attention} digits={0} />
                </TableCell>
                {!compact && (
                  <TableCell className="text-right text-xs">
                    <DeltaText value={i.resolvedAt ? null : i.currentDeviation} attention={attention} digits={0} />
                  </TableCell>
                )}
                {!compact && (
                  <TableCell>
                    <IncidentStatusBadge status={i.status} />
                  </TableCell>
                )}
                {!compact && <TableCell className="max-w-32 truncate text-xs text-muted-foreground">{i.owner ?? "Sin asignar"}</TableCell>}
                {!compact && <TableCell className="tabular text-center text-xs">{i.notification.count}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent>
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
                  {selected.campaignName ? ` · ${selected.campaignName}` : ""} · {ANOMALY_LABEL[selected.type]}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <Info label="Inicio" value={formatDateTimeInTz(selected.startedAt, timezone)} />
                  <Info label="Resuelto" value={selected.resolvedAt ? formatDateTimeInTz(selected.resolvedAt, timezone) : "Abierto"} />
                  <Info label="Duración" value={durationLabel(duration(selected))} />
                  <Info label="Desviación máxima" value={fmtDelta(selected.maxDeviation)} />
                  <Info label="Desviación actual" value={selected.resolvedAt ? "—" : fmtDelta(selected.currentDeviation)} />
                  <Info label="Notificaciones" value={String(selected.notification.count)} />
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
                          {e.deviation !== null && <DeltaText value={e.deviation} attention={attention} />}
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
                    <p className="mb-2 text-[13px] font-semibold text-foreground">Notificaciones enviadas vía n8n</p>
                    <div className="space-y-2">
                      {selNotifications
                        .filter((n) => n.channel === "whatsapp")
                        .map((n) => (
                          <details key={n.id} className="rounded-md border p-2 text-xs">
                            <summary className="cursor-pointer">
                              <span className="font-mono">{n.id}</span> · {n.kind} · {formatTimeInTz(n.createdAt, timezone)} · <span className="text-muted-foreground">{n.status}</span>
                            </summary>
                            <pre className="mt-2 font-sans whitespace-pre-wrap">{n.text}</pre>
                            <p className="mt-1 text-[11px] text-muted-foreground">Para: {n.recipients.join(", ")}</p>
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
                        <li key={idx} className="rounded-md border px-2.5 py-1.5 text-xs">
                          <p>{n.text}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {n.author} · {formatDateTimeInTz(n.at, timezone)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5">
                  <div className="text-xs">
                    <p className="font-semibold">¿El problema es grave?</p>
                    <p className="text-muted-foreground">Documenta a quién se reportó y el número de caso en un ticket.</p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/tickets?new=${selected.id}`}>
                      <Ticket /> Crear ticket
                    </Link>
                  </Button>
                </div>
              </div>
              {canWrite ? (
                <div className="space-y-2 border-t px-5 py-3">
                  <div className="flex gap-2">
                    <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner (p. ej. Paid Media · Meta)" className="h-8 text-xs" aria-label="Owner" />
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => patch({ owner: owner || null })}>
                      Asignar
                    </Button>
                  </div>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agregar nota…" className="text-xs" aria-label="Nota" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={saving || !note.trim()} onClick={() => patch({ note })}>
                      Guardar nota
                    </Button>
                    {selected.resolvedAt === null &&
                      (["ACKNOWLEDGED", "INVESTIGATING"] as const).map((s) => (
                        <Button key={s} size="sm" variant="outline" disabled={saving || selected.status === s} onClick={() => patch({ status: s })}>
                          {s}
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
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="tabular font-medium">{value}</p>
    </div>
  );
}
