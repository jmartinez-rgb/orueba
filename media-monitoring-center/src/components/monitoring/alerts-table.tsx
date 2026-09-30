"use client";
import { sileo } from "sileo";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { AlertRowVM } from "@/lib/services/view-models";
import type { AlertStatus } from "@/lib/alerts/types";
import { ALERT_STATUSES } from "@/lib/alerts/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { fmtMetric } from "@/lib/format";
import { durationLabel, formatDateTimeInTz, formatTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DeltaText, PlatformMark, SeverityBadge } from "./status";
import { StateMessage } from "./states";
import { NovedadForm } from "@/components/novedades/novedad-form";
import { novedadPrefillFromAlert, SpendBreakdownView } from "@/components/novedades/spend-breakdown";
import type { ExplainedBy } from "@/lib/monitoring/types";

/** Por qué una alerta se considera un cambio esperado (no abre incidente por persistir). */
export const EXPLAINED_LABEL: Record<ExplainedBy, string> = {
  planned_stop: "Pausas confirmadas en la plataforma",
  rotation: "Rotación de campañas",
  reallocation: "Presupuesto movido entre cuentas",
  sustained: "Nuevo nivel de gasto (varios días)",
  launch: "Campañas nuevas",
};

export function ExplainedChip({ by, className }: { by: ExplainedBy; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-foreground/[0.06] px-2 py-[3px] text-[11px] font-medium text-muted-foreground", className)} title={EXPLAINED_LABEL[by]}>
      Explicada · {EXPLAINED_LABEL[by]}
    </span>
  );
}

function businessToday(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  NEW: "Nueva",
  ACKNOWLEDGED: "Reconocida",
  INVESTIGATING: "En revisión",
  RESOLVED: "Resuelta",
  FALSE_POSITIVE: "Falso positivo",
};

const STATUS_TONE: Record<AlertStatus, string> = {
  NEW: "bg-primary/12 text-primary",
  ACKNOWLEDGED: "bg-muted text-foreground",
  INVESTIGATING: "bg-status-attention/12 text-status-attention-text border-status-attention/40",
  RESOLVED: "bg-status-normal/10 text-status-normal-text border-status-normal/40",
  FALSE_POSITIVE: "bg-muted text-muted-foreground line-through",
};

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  return <span className={cn("inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>{ALERT_STATUS_LABEL[status]}</span>;
}

const SEVERITIES: Severity[] = ["CRITICAL", "ALERT", "ATTENTION"];

export function AlertsTable({
  rows,
  timezone,
  canWrite,
  compact,
  attention = 0.15,
  whatsappPreview = {},
  limit,
  canNovedad = false,
}: {
  rows: AlertRowVM[];
  timezone: string;
  canWrite: boolean;
  /** Puede registrar la alerta como novedad aprobada (el monitoreo deja de alertarla). */
  canNovedad?: boolean;
  compact?: boolean;
  attention?: number;
  whatsappPreview?: Record<string, string>;
  limit?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [platform, setPlatform] = useState<"all" | PlatformId>("all");
  const [status, setStatus] = useState<"active" | "all" | AlertStatus>("active");
  const [type, setType] = useState<string>("all");
  const [showGrouped, setShowGrouped] = useState(false);
  const [selected, setSelected] = useState<AlertRowVM | null>(null);
  const [novedadFor, setNovedadFor] = useState<AlertRowVM | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const types = useMemo(() => [...new Set(rows.map((r) => r.typeLabel))].sort(), [rows]);
  const filtered = useMemo(() => {
    let list = rows;
    if (compact) list = list.filter((r) => r.resolvedAt === null && !r.groupedUnder && r.status !== "FALSE_POSITIVE");
    else {
      if (!showGrouped) list = list.filter((r) => !r.groupedUnder);
      if (status === "active") list = list.filter((r) => r.resolvedAt === null && r.status !== "FALSE_POSITIVE");
      else if (status !== "all") list = list.filter((r) => r.status === status);
      if (sev !== "all") list = list.filter((r) => r.severity === sev);
      if (platform !== "all") list = list.filter((r) => r.platform === platform);
      if (type !== "all") list = list.filter((r) => r.typeLabel === type);
      if (q.trim()) {
        const t = q.toLowerCase();
        list = list.filter((r) => [r.id, r.title, r.campaignName, r.accountName, PLATFORMS[r.platform].name, r.typeLabel].some((v) => v?.toLowerCase().includes(t)));
      }
    }
    return limit ? list.slice(0, limit) : list;
  }, [rows, compact, showGrouped, status, sev, platform, type, q, limit]);

  async function changeStatus(id: string, next: AlertStatus) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? "No se pudo actualizar la alerta.");
        sileo.error({ title: "No se pudo actualizar la alerta", description: d.message });
      } else {
        setSelected((s) => (s ? { ...s, status: next } : s));
        sileo.success({ title: `Alerta ${id}: ${next}` });
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const grouped = selected ? rows.filter((r) => r.groupedUnder === selected.fingerprint && r.resolvedAt === null) : [];

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alerta, campaña, cuenta…" className="h-8 pl-8 text-xs" aria-label="Buscar" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="all">Todas (36 h)</SelectItem>
              {ALERT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ALERT_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sev} onValueChange={(v) => setSev(v as typeof sev)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Severidad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda severidad</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "CRITICAL" ? "Crítico" : s === "ALERT" ? "Alerta" : "Atención"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Plataforma">
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
          <Select value={type} onValueChange={setType}>
            <SelectTrigger size="sm" className="w-40" aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo tipo</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 pl-1">
            <Switch id="grouped" checked={showGrouped} onCheckedChange={setShowGrouped} />
            <Label htmlFor="grouped" className="text-xs font-normal text-muted-foreground">
              Mostrar agrupadas
            </Label>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} alertas</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <StateMessage kind="no-alerts" title="Sin alertas activas" description="Todas las métricas están dentro de los parámetros configurados." compact />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Severidad</TableHead>
              <TableHead>Plataforma</TableHead>
              <TableHead>Campaña / alcance</TableHead>
              <TableHead>Tipo</TableHead>
              {!compact && <TableHead className="text-right">Actual</TableHead>}
              {!compact && <TableHead className="text-right">Esperado</TableHead>}
              <TableHead className="text-right">Desv.</TableHead>
              <TableHead>Detectado</TableHead>
              {!compact && <TableHead>Última act.</TableHead>}
              <TableHead>Duración</TableHead>
              {!compact && <TableHead>Estado</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className={cn("cursor-pointer", r.resolvedAt && "opacity-70")} onClick={() => setSelected(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(r)}>
                <TableCell className="font-mono text-xs">{r.id}</TableCell>
                <TableCell>
                  <SeverityBadge severity={r.severity} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <PlatformMark platform={r.platform} className="size-5 text-[9px]" />
                    {!compact && <span className="text-xs">{PLATFORMS[r.platform].shortName}</span>}
                  </span>
                </TableCell>
                <TableCell className="max-w-64 text-xs" title={r.title}>
                  <span className="block truncate font-medium">{r.campaignName ?? (r.level === "account" ? `Cuenta: ${r.accountName}` : "Toda la plataforma")}</span>
                  {!compact && (r.campaignName || r.groupedUnderId || r.explained) && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {r.campaignName ? r.accountName : ""}
                      {r.groupedUnderId ? `${r.campaignName ? " · " : ""}↳ agrupada en ${r.groupedUnderId}` : ""}
                      {r.explained ? `${r.campaignName || r.groupedUnderId ? " · " : ""}Explicada: ${EXPLAINED_LABEL[r.explained].toLowerCase()}` : ""}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <span className="block">{r.typeLabel}</span>
                  {!compact && <span className="block text-[10px] text-muted-foreground">{r.metricLabel}</span>}
                </TableCell>
                {!compact && <TableCell className="text-right text-xs font-medium">{r.type === "DATA_ISSUE" ? "Datos atrasados" : fmtMetric(r.metric, r.currentValue, { compact: true })}</TableCell>}
                {!compact && <TableCell className="text-right text-xs text-muted-foreground">{r.type === "DATA_ISSUE" ? "—" : fmtMetric(r.metric, r.expectedValue, { compact: true })}</TableCell>}
                <TableCell className="text-right text-xs">
                  <DeltaText value={r.deviation} attention={attention} />
                </TableCell>
                <TableCell className="tabular text-xs">{formatTimeInTz(r.detectedAt, timezone)}</TableCell>
                {!compact && <TableCell className="tabular text-xs text-muted-foreground">{formatTimeInTz(r.lastUpdateAt, timezone)}</TableCell>}
                <TableCell className="text-xs text-muted-foreground">{durationLabel(r.durationMs)}</TableCell>
                {!compact && (
                  <TableCell>
                    <AlertStatusBadge status={r.status} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{selected.id}</span>
                  <SeverityBadge severity={selected.severity} />
                  <AlertStatusBadge status={selected.status} />
                  {selected.incidentId && (
                    <Link href={`/incidents?id=${selected.incidentId}`} className="text-xs text-primary hover:underline">
                      {selected.incidentId}
                    </Link>
                  )}
                </div>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>
                  {PLATFORMS[selected.platform].name}
                  {selected.accountName ? ` · ${selected.accountName}` : ""}
                  {selected.campaignName ? ` · ${selected.campaignName}` : ""} · {selected.typeLabel}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
                {selected.explained && <ExplainedChip by={selected.explained} />}
                <p className="text-sm leading-relaxed">{selected.diagnosis}</p>
                {selected.breakdown && (
                  <div className="rounded-xl bg-foreground/[0.03] p-3.5">
                    <SpendBreakdownView breakdown={selected.breakdown} />
                  </div>
                )}
                {canNovedad && selected.resolvedAt === null && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.03] px-3.5 py-3 text-xs">
                    <div>
                      <p className="font-semibold">¿Fue un cambio aprobado?</p>
                      <p className="text-muted-foreground">Regístralo como novedad: queda quién lo aprobó y el monitoreo deja de alertarlo.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setNovedadFor(selected)}>
                      Registrar novedad
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Info label="Detectado" value={formatDateTimeInTz(selected.detectedAt, timezone)} />
                  <Info label="Última actualización" value={formatDateTimeInTz(selected.lastUpdateAt, timezone)} />
                  <Info label="Duración" value={durationLabel(selected.durationMs)} />
                  <Info label="Evaluaciones" value={String(selected.consecutiveRuns)} />
                </div>
                {selected.evidence.length > 0 && (
                  <div>
                    <p className="mb-1 text-[13px] font-semibold text-foreground">Evidencia · mismo día y franja ({`00:00–${String(selected.cutoffHour).padStart(2, "0")}:00`})</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Métrica</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead className="text-right">Esperado</TableHead>
                          <TableHead className="text-right">Sem. ant.</TableHead>
                          <TableHead className="text-right">Desv.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.evidence.map((e) => (
                          <TableRow key={e.metric}>
                            <TableCell className="text-xs">{e.label}</TableCell>
                            <TableCell className="text-right text-xs font-medium">{fmtMetric(e.metric, e.current)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(e.metric, e.expected)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(e.metric, e.prevWeek)}</TableCell>
                            <TableCell className="text-right text-xs">
                              <DeltaText value={e.deviation} bad={e.metric === "spend" ? "both" : ["cpr", "cpa", "cpl", "cpc", "cpm"].includes(e.metric) ? "up" : "down"} attention={attention} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {selected.adjustments.length > 0 && (
                  <div className="rounded-xl bg-foreground/[0.03] p-3 text-xs">
                    <p className="mb-1 font-semibold">Ajustes para evitar falsas alarmas</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {selected.adjustments.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {grouped.length > 0 && (
                  <div className="text-xs">
                    <p className="mb-1 font-semibold">Alertas agrupadas ({grouped.length}) · no generan notificaciones propias</p>
                    <ul className="space-y-1">
                      {grouped.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                          <span className="truncate">
                            <span className="font-mono text-muted-foreground">{g.id}</span> {g.campaignName ?? g.accountName}
                          </span>
                          <DeltaText value={g.deviation} attention={attention} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.incidentId && whatsappPreview[selected.incidentId] && (
                  <div>
                    <p className="mb-1 text-[13px] font-semibold text-foreground">Último mensaje de WhatsApp (vía n8n)</p>
                    <pre className="rounded-md border bg-muted/50 p-3 font-sans text-xs whitespace-pre-wrap">{whatsappPreview[selected.incidentId]}</pre>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
                {canWrite ? (
                  (["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"] as AlertStatus[]).map((s) => (
                    <Button key={s} size="sm" variant={s === selected.status ? "secondary" : "outline"} disabled={saving || s === selected.status} onClick={() => changeStatus(selected.id, s)}>
                      {ALERT_STATUS_LABEL[s]}
                    </Button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">Tu rol es de solo lectura.</p>
                )}
                {error && <p className="w-full text-xs text-status-critical-text">{error}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {novedadFor && (
        <NovedadForm
          open
          onOpenChange={(o) => !o && setNovedadFor(null)}
          today={businessToday(timezone)}
          prefill={novedadPrefillFromAlert(novedadFor, novedadFor.incidentId)}
          onCreated={() => {
            setNovedadFor(null);
            setSelected(null);
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
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="tabular font-medium">{value}</p>
    </div>
  );
}
