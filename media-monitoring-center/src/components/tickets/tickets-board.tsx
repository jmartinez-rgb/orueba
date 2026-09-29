"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import {
  OPEN_TICKET_STATUSES,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL,
  TICKET_CHANNEL_LABEL,
  TICKET_CHANNELS,
  TICKET_STATUS_LABEL,
  TICKET_STATUSES,
  type Ticket,
  type TicketCategory,
  type TicketChannel,
  type TicketStatus,
} from "@/lib/records/ticket-model";
import { durationLabel, formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";
import { PlatformMark, SeverityBadge } from "@/components/monitoring/status";
import { StateMessage } from "@/components/monitoring/states";
import { UserAvatar } from "@/components/users/user-avatar";

export interface IncidentOption {
  id: string;
  title: string;
  platform: PlatformId;
  severity: Severity;
  accountName: string | null;
  open: boolean;
  category: TicketCategory;
}

const STATUS_TONE: Record<TicketStatus, string> = {
  ABIERTO: "bg-status-alert/15 text-status-alert-text",
  REPORTADO: "bg-primary/15 text-primary",
  EN_SEGUIMIENTO: "bg-status-attention/15 text-status-attention-text",
  ESCALADO: "bg-status-critical/15 text-status-critical-text",
  RESUELTO: "bg-status-normal/15 text-status-normal-text",
  CERRADO: "bg-muted text-muted-foreground",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>{TICKET_STATUS_LABEL[status]}</span>;
}

type Filter = "open" | "resolved" | "all";

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function TicketsBoard({
  tickets,
  incidents,
  timezone,
  canWrite,
  canManage,
  prefillIncidentId,
  initialId,
  nowMs,
}: {
  nowMs: number;
  tickets: Ticket[];
  incidents: IncidentOption[];
  timezone: string;
  canWrite: boolean;
  canManage: boolean;
  prefillIncidentId: string | null;
  initialId: string | null;
}) {
  const router = useRouter();
  const prefill = incidents.find((i) => i.id === prefillIncidentId) ?? null;
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [creating, setCreating] = useState(Boolean(prefill) && canWrite);

  const list = useMemo(() => {
    let l = tickets;
    if (filter === "open") l = l.filter((t) => OPEN_TICKET_STATUSES.includes(t.status));
    if (filter === "resolved") l = l.filter((t) => !OPEN_TICKET_STATUSES.includes(t.status));
    if (platform !== "all") l = l.filter((t) => t.platform === platform);
    const term = q.trim().toLowerCase();
    if (term) l = l.filter((t) => [t.id, t.title, t.description, t.reportedTo, t.externalRef, t.owner, t.accountName, ...t.incidentIds].some((v) => v?.toLowerCase().includes(term)));
    return l;
  }, [tickets, filter, platform, q]);

  const openCount = tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length;
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  function exportCsv() {
    const head = ["id", "creado", "creado_por", "titulo", "severidad", "categoria", "plataforma", "cuenta", "incidentes", "reportado_a", "canal", "ref_externa", "responsable", "estado", "resuelto"];
    const lines = list.map((t) =>
      [
        t.id,
        formatDateTimeInTz(t.createdAt, timezone),
        t.createdBy,
        t.title,
        t.severity,
        TICKET_CATEGORY_LABEL[t.category],
        t.platform ? PLATFORMS[t.platform].name : "",
        t.accountName ?? "",
        t.incidentIds.join(" "),
        t.reportedTo,
        TICKET_CHANNEL_LABEL[t.channel],
        t.externalRef ?? "",
        t.owner ?? "",
        TICKET_STATUS_LABEL[t.status],
        t.resolvedAt ? formatDateTimeInTz(t.resolvedAt, timezone) : "",
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AnimatedTabs
          label="Estado de tickets"
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: "open", label: "Abiertos", count: openCount },
            { id: "resolved", label: "Resueltos", count: tickets.length - openCount },
            { id: "all", label: "Todos", count: tickets.length },
          ]}
        />
        <Select value={platform} onValueChange={(v) => setPlatform(v as PlatformId | "all")}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plataformas</SelectItem>
            {PLATFORM_IDS.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORMS[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-44 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ID, caso, responsable…" className="h-8 pl-8 text-xs" aria-label="Buscar tickets" />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!list.length}>
            <Download /> CSV
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nuevo ticket
            </Button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <StateMessage kind="empty" title={filter === "open" ? "No hay tickets abiertos" : "Sin tickets en este filtro"} description="Los tickets documentan problemas graves: a quién se reportaron, por qué canal y su número de caso." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Severidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Reportado a</TableHead>
                <TableHead>Caso</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Antigüedad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" tabIndex={0} onClick={() => setSelectedId(t.id)} onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {t.id} · {TICKET_CATEGORY_LABEL[t.category]}
                    </p>
                  </TableCell>
                  <TableCell>{t.platform ? <PlatformMark platform={t.platform} /> : <span className="text-xs text-muted-foreground">Varias</span>}</TableCell>
                  <TableCell>
                    <SeverityBadge severity={t.severity} />
                  </TableCell>
                  <TableCell>
                    <TicketStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {t.reportedTo || "—"}
                    <span className="block text-[11px] text-muted-foreground">{TICKET_CHANNEL_LABEL[t.channel]}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.externalRef ?? "—"}</TableCell>
                  <TableCell className="text-xs">{t.owner ?? "—"}</TableCell>
                  <TableCell className="tabular text-xs whitespace-nowrap">{durationLabel((t.resolvedAt ? Date.parse(t.resolvedAt) : nowMs) - Date.parse(t.createdAt))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TicketDetail ticket={selected} timezone={timezone} canWrite={canWrite} canManage={canManage} onClose={() => setSelectedId(null)} onSaved={() => router.refresh()} />
      {canWrite && (
        <NewTicketDialog
          open={creating}
          onOpenChange={(o) => {
            setCreating(o);
            if (!o && prefillIncidentId) router.replace("/tickets");
          }}
          incidents={incidents}
          prefill={prefill}
          onCreated={(t) => {
            setCreating(false);
            setSelectedId(t.id);
            router.replace("/tickets");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TicketDetail({ ticket, timezone, canWrite, canManage, onClose, onSaved }: { ticket: Ticket | null; timezone: string; canWrite: boolean; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (ticket && ticket.id !== lastId) {
    setLastId(ticket.id);
    setRef(ticket.externalRef ?? "");
    setOwner(ticket.owner ?? "");
    setText("");
  }

  async function patch(body: Record<string, unknown>, ok: string) {
    if (!ticket) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo actualizar", description: d.message });
        return;
      }
      sileo.success({ title: ok, description: ticket.id });
      setText("");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={ticket !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {ticket && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
                <SeverityBadge severity={ticket.severity} />
                <TicketStatusBadge status={ticket.status} />
              </div>
              <SheetTitle>{ticket.title}</SheetTitle>
              <SheetDescription>
                {ticket.platform ? PLATFORMS[ticket.platform].name : "Varias plataformas"}
                {ticket.accountName ? ` · ${ticket.accountName}` : ""} · {TICKET_CATEGORY_LABEL[ticket.category]}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs whitespace-pre-wrap">{ticket.description}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Creado" value={`${formatDateTimeInTz(ticket.createdAt, timezone)} · ${ticket.createdBy}`} />
                <Info label="Reportado a" value={`${ticket.reportedTo || "—"} (${TICKET_CHANNEL_LABEL[ticket.channel]})`} />
                <Info label="Número de caso" value={ticket.externalRef ?? "—"} />
                <Info label="Resuelto" value={ticket.resolvedAt ? formatDateTimeInTz(ticket.resolvedAt, timezone) : "Pendiente"} />
              </div>
              {ticket.incidentIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Incidentes:</span>
                  {ticket.incidentIds.map((id) => (
                    <Link key={id} href={`/incidents?id=${id}`} className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted">
                      {id}
                    </Link>
                  ))}
                </div>
              )}
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Histórico del reporte</p>
                <ol className="relative space-y-3 border-l pl-4">
                  {ticket.updates.map((u, i) => (
                    <li key={i} className="relative text-xs">
                      <span className="absolute top-1 -left-[21px] size-2.5 rounded-full bg-brand-teal ring-2 ring-card" />
                      <p className="flex flex-wrap items-center gap-1.5">
                        <UserAvatar name={u.by} size={18} />
                        <span className="font-semibold">{u.by}</span>
                        <span className="tabular text-muted-foreground">{formatDateTimeInTz(u.at, timezone)}</span>
                        {u.status && <TicketStatusBadge status={u.status} />}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">{u.text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {canWrite ? (
              <div className="space-y-2 border-t px-5 py-3">
                {canManage && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Número de caso / folio" className="h-8 text-xs" aria-label="Número de caso" />
                      <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Responsable" className="h-8 text-xs" aria-label="Responsable" />
                    </div>
                    <Button size="sm" variant="outline" disabled={busy || (ref === (ticket.externalRef ?? "") && owner === (ticket.owner ?? ""))} onClick={() => patch({ externalRef: ref || null, owner: owner || null }, "Datos de seguimiento guardados")}>
                      Guardar caso y responsable
                    </Button>
                  </>
                )}
                <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Agregar actualización (qué respondió la plataforma, siguiente paso…)" className="text-xs" aria-label="Actualización" />
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={busy || !text.trim()} onClick={() => patch({ text }, "Actualización agregada")}>
                    Agregar actualización
                  </Button>
                  {canManage &&
                    TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
                      <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => patch({ status: s, text: text.trim() || undefined }, `Estado: ${TICKET_STATUS_LABEL[s]}`)}>
                        {TICKET_STATUS_LABEL[s]}
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
  );
}

function NewTicketDialog({
  open,
  onOpenChange,
  incidents,
  prefill,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  incidents: IncidentOption[];
  prefill: IncidentOption | null;
  onCreated: (t: Ticket) => void;
}) {
  const [title, setTitle] = useState(prefill ? `${PLATFORMS[prefill.platform].shortName}: ${prefill.title}` : "");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>(prefill?.severity ?? "ALERT");
  const [category, setCategory] = useState<TicketCategory>(prefill?.category ?? "DELIVERY");
  const [platform, setPlatform] = useState<PlatformId | "none">(prefill?.platform ?? "none");
  const [incidentIds, setIncidentIds] = useState<string[]>(prefill ? [prefill.id] : []);
  const [reportedTo, setReportedTo] = useState("");
  const [channel, setChannel] = useState<TicketChannel>("WHATSAPP");
  const [externalRef, setExternalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          severity,
          category,
          platform: platform === "none" ? null : platform,
          accountName: prefill?.accountName ?? null,
          incidentIds,
          reportedTo,
          channel,
          externalRef: externalRef || null,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; ticket?: Ticket };
      if (!res.ok || !d.ok || !d.ticket) {
        setError(d.message ?? "No se pudo crear el ticket.");
        return;
      }
      sileo.success({ title: `Ticket ${d.ticket.id} creado`, description: d.ticket.title });
      onCreated(d.ticket);
    } finally {
      setBusy(false);
    }
  }

  const openIncidents = incidents.filter((i) => i.open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo ticket de reporte</DialogTitle>
          <DialogDescription>Registro interno para dar seguimiento a un problema grave. No abre casos ni cambia nada en las plataformas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tk-title">Título</Label>
            <Input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tk-desc">Qué pasa y qué se revisó</Label>
            <Textarea id="tk-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Severidad</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRITICAL">Crítico</SelectItem>
                  <SelectItem value="ALERT">Alerta</SelectItem>
                  <SelectItem value="ATTENTION">Atención</SelectItem>
                  <SelectItem value="NORMAL">Informativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TICKET_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label>Plataforma</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as PlatformId | "none")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Varias / ninguna</SelectItem>
                  {PLATFORM_IDS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORMS[p].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tk-to">Reportado a</Label>
              <Input id="tk-to" value={reportedTo} onChange={(e) => setReportedTo(e.target.value)} placeholder="Soporte Meta, líder, cliente…" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as TicketChannel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TICKET_CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tk-ref">Número de caso / folio (opcional)</Label>
            <Input id="tk-ref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} maxLength={80} />
          </div>
          {openIncidents.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Incidentes relacionados</legend>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                {openIncidents.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={incidentIds.includes(i.id)} onChange={(e) => setIncidentIds((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))} />
                    <span className="font-mono text-muted-foreground">{i.id}</span>
                    <span className="truncate">
                      {PLATFORMS[i.platform].shortName} · {i.title}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-xs font-medium text-status-critical-text">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || title.trim().length < 5 || description.trim().length < 10}>
            {busy ? "Creando…" : "Crear ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
