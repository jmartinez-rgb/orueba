"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellOff, Download, Plus, Search } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { APPROVAL_CHANNEL_LABEL, NOVEDAD_KIND_LABEL, novedadActiveOn, novedadScopeLabel, type Novedad, type NovedadKind } from "@/lib/records/novedad-model";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformMark } from "@/components/monitoring/status";
import { StateMessage } from "@/components/monitoring/states";
import { NovedadForm, type ScopeCatalog } from "./novedad-form";

type Filter = "active" | "all" | "closed";

const KIND_TONE: Record<NovedadKind, string> = {
  PRESUPUESTO: "bg-primary/12 text-primary",
  PAUSA: "bg-status-attention/14 text-status-attention-text",
  ACTIVACION: "bg-status-normal/12 text-status-normal-text",
  PLATAFORMA: "bg-foreground/[0.07] text-foreground",
  ESTRATEGIA: "bg-foreground/[0.07] text-foreground",
  ARRANQUE: "bg-primary/12 text-primary",
  OTRO: "bg-foreground/[0.07] text-muted-foreground",
};

export function KindBadge({ kind }: { kind: NovedadKind }) {
  return <span className={cn("inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap", KIND_TONE[kind])}>{NOVEDAD_KIND_LABEL[kind]}</span>;
}

const money = (v: number) => `$${Math.round(v).toLocaleString("es-MX")}`;
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
const vigencia = (n: Novedad) => `${fmtDate(n.effectiveFrom)} – ${n.effectiveUntil ? fmtDate(n.effectiveUntil) : "fin de mes"}`;

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function NovedadesBoard({
  novedades,
  today,
  timezone,
  catalog,
  canWrite,
  applying,
  initialId,
}: {
  novedades: Novedad[];
  today: string;
  timezone: string;
  catalog: ScopeCatalog;
  canWrite: boolean;
  /** Alertas que cada novedad está silenciando hoy. */
  applying: Record<string, number>;
  initialId: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => {
    let l = novedades;
    if (filter === "active") l = l.filter((n) => n.status === "VIGENTE" && (n.effectiveUntil ?? `${n.effectiveFrom.slice(0, 7)}-31`) >= today);
    if (filter === "closed") l = l.filter((n) => n.status === "CERRADA" || (n.effectiveUntil ?? `${n.effectiveFrom.slice(0, 7)}-31`) < today);
    if (platform !== "all") l = l.filter((n) => n.platform === platform);
    const t = q.trim().toLowerCase();
    if (t) l = l.filter((n) => [n.id, n.title, n.detail, n.approvedBy, n.approvalRef, n.accountName, n.campaignName].some((v) => v?.toLowerCase().includes(t)));
    return l;
  }, [novedades, filter, platform, q, today]);
  const activeCount = novedades.filter((n) => n.status === "VIGENTE" && (n.effectiveUntil ?? `${n.effectiveFrom.slice(0, 7)}-31`) >= today).length;
  const selected = novedades.find((n) => n.id === selectedId) ?? null;

  async function patch(body: Record<string, unknown>, done: string) {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/novedades/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: done, description: selected.id });
      setNote("");
      setUntil("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const head = ["folio", "registrada", "registro", "tipo", "titulo", "plataforma", "cuenta", "campana", "aprobo", "medio", "referencia", "desde", "hasta", "presupuesto", "cambio_esperado", "silencia_alertas", "estado", "detalle"];
    const lines = list.map((n) =>
      [
        n.id,
        formatDateTimeInTz(n.createdAt, timezone),
        n.createdBy,
        NOVEDAD_KIND_LABEL[n.kind],
        n.title,
        n.platform ? PLATFORMS[n.platform].name : "Toda la marca",
        n.accountName ?? "",
        n.campaignName ?? "",
        n.approvedBy,
        APPROVAL_CHANNEL_LABEL[n.approvalChannel],
        n.approvalRef ?? "",
        n.effectiveFrom,
        n.effectiveUntil ?? "",
        n.budget ? String(n.budget.amount) : "",
        n.expectedChange !== null ? `${Math.round(n.expectedChange * 100)}%` : "",
        n.silenceAlerts ? "sí" : "no",
        n.status === "VIGENTE" ? "Vigente" : "Cerrada",
        n.detail,
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novedades-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Vigentes ({activeCount})</TabsTrigger>
            <TabsTrigger value="all">Todas ({novedades.length})</TabsTrigger>
            <TabsTrigger value="closed">Cerradas o vencidas</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={platform} onValueChange={(v) => setPlatform(v as PlatformId | "all")}>
          <SelectTrigger size="sm" className="w-40" aria-label="Plataforma">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plataformas</SelectItem>
            {catalog.platforms.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORMS[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar novedad…" className="h-8 pl-8 text-xs" aria-label="Buscar novedad" />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!list.length}>
            <Download /> CSV
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nueva novedad
            </Button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <StateMessage
          kind="empty"
          title={filter === "active" ? "Sin novedades vigentes" : "Sin novedades"}
          description="Registra aquí cada ajuste aprobado durante el mes (presupuesto, pausas, activaciones, cambios de plataforma). Queda en el historial y el monitoreo lo toma en cuenta."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Novedad</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Alcance</TableHead>
              <TableHead>Aprobó</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((n) => {
              const on = novedadActiveOn(n, today);
              return (
                <TableRow key={n.id} className="cursor-pointer" onClick={() => setSelectedId(n.id)}>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-[13px] font-medium" title={n.title}>
                      {n.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-mono">{n.id}</span> · {formatDateTimeInTz(n.createdAt, timezone)} · {n.createdBy}
                    </p>
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={n.kind} />
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs">
                      {n.platform && <PlatformMark platform={n.platform} className="size-5 text-[9px]" />}
                      <span className="truncate">{novedadScopeLabel(n, n.platform ? PLATFORMS[n.platform].name : undefined)}</span>
                    </span>
                    {n.budget && <p className="text-[11px] text-muted-foreground">Presupuesto {money(n.budget.amount)}</p>}
                  </TableCell>
                  <TableCell className="text-xs">
                    <p className="font-medium">{n.approvedBy}</p>
                    <p className="text-muted-foreground">vía {APPROVAL_CHANNEL_LABEL[n.approvalChannel]}</p>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap tabular">{vigencia(n)}</TableCell>
                  <TableCell className="text-xs">
                    {n.status === "CERRADA" ? (
                      <span className="text-muted-foreground">Cerrada</span>
                    ) : on ? (
                      <span className="inline-flex flex-col">
                        <span className="font-medium text-status-normal-text">Aplicando hoy</span>
                        {n.silenceAlerts && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <BellOff className="size-3" aria-hidden /> {applying[n.id] ? `${applying[n.id]} alerta(s) en silencio` : "sin alertas que silenciar"}
                          </span>
                        )}
                      </span>
                    ) : n.effectiveFrom > today ? (
                      <span className="text-muted-foreground">Programada</span>
                    ) : (
                      <span className="text-muted-foreground">Vencida</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
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
                  <KindBadge kind={selected.kind} />
                  <span className={cn("inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold", selected.status === "VIGENTE" ? "bg-status-normal/12 text-status-normal-text" : "bg-muted text-muted-foreground")}>
                    {selected.status === "VIGENTE" ? "Vigente" : "Cerrada"}
                  </span>
                </div>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>{novedadScopeLabel(selected, selected.platform ? PLATFORMS[selected.platform].name : undefined)}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Info label="Aprobó" value={selected.approvedBy} />
                  <Info label="Medio" value={`${APPROVAL_CHANNEL_LABEL[selected.approvalChannel]}${selected.approvalRef ? ` · ${selected.approvalRef}` : ""}`} />
                  <Info label="Vigencia" value={vigencia(selected)} />
                  <Info label="Registró" value={`${selected.createdBy} · ${formatDateTimeInTz(selected.createdAt, timezone)}`} />
                  {selected.budget && <Info label={`Presupuesto ${selected.budget.month}`} value={`${money(selected.budget.amount)} MXN`} />}
                  {selected.expectedChange !== null && <Info label="Cambio esperado del gasto" value={`${selected.expectedChange > 0 ? "+" : ""}${Math.round(selected.expectedChange * 100)}%`} />}
                  <Info label="Monitoreo" value={selected.silenceAlerts ? `No alerta este alcance${selected.includesFullStop ? " (incluye apagado total)" : ""}` : "Solo registro"} />
                  {selected.incidentId && (
                    <div className="rounded-xl bg-foreground/[0.03] px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">Incidente</p>
                      <Link href={`/incidents?id=${selected.incidentId}`} className="font-medium text-primary hover:underline">
                        {selected.incidentId}
                      </Link>
                    </div>
                  )}
                </div>
                {selected.detail && <p className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-[13px] whitespace-pre-wrap">{selected.detail}</p>}
                <div>
                  <p className="mb-2 text-[13px] font-semibold">Seguimiento</p>
                  <ol className="relative space-y-3 border-l pl-4">
                    {selected.updates.map((u, i) => (
                      <li key={i} className="relative text-xs">
                        <span className="absolute top-1 -left-[21px] size-2.5 rounded-full bg-primary ring-2 ring-card" />
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">{u.by}</span> · {formatDateTimeInTz(u.at, timezone)}
                        </p>
                        <p>{u.text}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              {canWrite ? (
                <div className="space-y-2 border-t px-5 py-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agregar seguimiento…" className="text-xs" aria-label="Seguimiento" />
                  <div className="flex flex-wrap items-end gap-2">
                    <Button size="sm" disabled={saving || !note.trim()} onClick={() => patch({ text: note }, "Seguimiento guardado")}>
                      Guardar
                    </Button>
                    <div className="flex items-end gap-1.5">
                      <div className="space-y-1">
                        <Label htmlFor="nv-new-until" className="text-[11px]">
                          Nueva fecha final
                        </Label>
                        <Input id="nv-new-until" type="date" value={until} min={selected.effectiveFrom} onChange={(e) => setUntil(e.target.value)} className="h-8 w-36 text-xs" />
                      </div>
                      <Button size="sm" variant="outline" disabled={saving || !until} onClick={() => patch({ effectiveUntil: until }, "Vigencia actualizada")}>
                        Cambiar
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={saving}
                      onClick={() => patch({ status: selected.status === "VIGENTE" ? "CERRADA" : "VIGENTE", text: note || undefined }, selected.status === "VIGENTE" ? "Novedad cerrada" : "Novedad reabierta")}
                    >
                      {selected.status === "VIGENTE" ? "Cerrar" : "Reabrir"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">Tu rol es de solo lectura.</p>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {canWrite && <NovedadForm key={creating ? "open" : "closed"} open={creating} onOpenChange={setCreating} today={today} catalog={catalog} onCreated={() => router.refresh()} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
