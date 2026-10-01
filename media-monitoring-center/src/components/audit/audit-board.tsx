"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sileo } from "sileo";
import { ChevronDown, CircleCheck, CircleDashed, CircleMinus, CircleX, Download } from "lucide-react";
import type { AuditVerdict, CheckStatus, IncidentAudit, AutoVerdict } from "@/lib/audit/incident-audit";
import { CHECK_LABEL } from "@/lib/audit/incident-audit";
import { PLATFORMS } from "@/lib/platforms/registry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlatformMark, SeverityBadge } from "@/components/monitoring/status";

const VERDICT: Record<AuditVerdict, { label: string; tone: string }> = {
  CUMPLE: { label: "Cumple", tone: "bg-status-normal/12 text-status-normal-text" },
  OBSERVACION: { label: "Con observación", tone: "bg-status-attention/16 text-status-attention-text" },
  NO_CUMPLE: { label: "No cumple", tone: "bg-status-critical/12 text-status-critical-text" },
};
const AUTO: Record<AutoVerdict, { label: string; tone: string }> = {
  CUMPLE: { label: "Cumple", tone: "text-status-normal-text" },
  PARCIAL: { label: "Parcial", tone: "text-status-attention-text" },
  NO_CUMPLE: { label: "No cumple", tone: "text-status-critical-text" },
  EN_CURSO: { label: "En curso", tone: "text-muted-foreground" },
};
const CHECK_ICON: Record<CheckStatus, { Icon: typeof CircleCheck; tone: string; label: string }> = {
  ok: { Icon: CircleCheck, tone: "text-status-normal-text", label: "Cumple" },
  fail: { Icon: CircleX, tone: "text-status-critical-text", label: "No cumple" },
  pending: { Icon: CircleDashed, tone: "text-muted-foreground", label: "Pendiente" },
  na: { Icon: CircleMinus, tone: "text-muted-foreground/60", label: "No aplica" },
};

type Filter = "all" | "unreviewed" | "failing" | "open";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "unreviewed", label: "Sin dictamen" },
  { id: "failing", label: "Con incumplimientos" },
  { id: "open", label: "Abiertos" },
];

function fmt(iso: string | null, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function csv(rows: IncidentAudit[]) {
  const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const head = ["Incidente", "Plataforma", "Severidad máx.", "Inicio", "Resuelto", "Responsable", "Min. a la atención", "Cumplimiento %", "Evaluación automática", ...Object.values(CHECK_LABEL), "Dictamen", "Comentario", "Auditor", "Fecha dictamen"];
  const lines = rows.map((r) =>
    [
      r.incidentId,
      PLATFORMS[r.platform].name,
      r.maxSeverity,
      r.startedAt,
      r.resolvedAt ?? "",
      r.owner ?? "",
      r.minutesToAttention ?? "",
      r.score ?? "",
      AUTO[r.auto].label,
      ...(Object.keys(CHECK_LABEL) as Array<keyof typeof CHECK_LABEL>).map((id) => CHECK_ICON[r.checks.find((c) => c.id === id)?.status ?? "na"].label),
      r.review ? VERDICT[r.review.verdict].label : "",
      r.review?.comment ?? "",
      r.review?.by ?? "",
      r.review?.at ?? "",
    ]
      .map(q)
      .join(","),
  );
  return "﻿" + [head.map(q).join(","), ...lines].join("\r\n");
}

export function AuditBoard({ rows, canWrite, timezone, days }: { rows: IncidentAudit[]; canWrite: boolean; timezone: string; days: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === "unreviewed" ? !r.review : filter === "failing" ? r.checks.some((c) => c.status === "fail") : filter === "open" ? r.open : true,
      ),
    [rows, filter],
  );

  function download() {
    const blob = new Blob([csv(shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-incidencias-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar incidentes">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id ? "bg-foreground text-background" : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.08]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={download} disabled={!shown.length}>
          <Download className="size-4" aria-hidden /> Exportar CSV
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl bg-foreground/[0.03] px-4 py-6 text-center text-[13px] text-muted-foreground">No hay incidentes con este filtro en el periodo.</p>
      ) : (
        <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.02] ring-1 ring-(--hairline)">
          {shown.map((r) => (
            <li key={r.incidentId}>
              <button
                type="button"
                onClick={() => setOpen(open === r.incidentId ? null : r.incidentId)}
                aria-expanded={open === r.incidentId}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-foreground/[0.03]"
              >
                <PlatformMark platform={r.platform} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[13px] font-medium">{r.title}</span>
                    <SeverityBadge severity={r.maxSeverity} />
                    {r.open && <span className="rounded-full bg-foreground/[0.06] px-1.5 py-[1px] text-[10px] font-semibold">Abierto</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.incidentId} · {fmt(r.startedAt, timezone)} · {r.owner ? `Responsable: ${r.owner}` : "Sin responsable"}
                    {r.campaignName || r.accountName ? ` · ${r.campaignName ?? r.accountName}` : ""}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-label="Verificaciones">
                  {r.checks.map((c) => {
                    const m = CHECK_ICON[c.status];
                    return <m.Icon key={c.id} className={cn("size-4", m.tone)} aria-label={`${CHECK_LABEL[c.id]}: ${m.label}`} />;
                  })}
                </span>
                <span className="w-24 shrink-0 text-right">
                  <span className={cn("block text-[13px] font-semibold tabular", AUTO[r.auto].tone)}>{r.score === null ? "—" : `${r.score}%`}</span>
                  {r.review ? (
                    <span className={cn("inline-block rounded-full px-1.5 py-[1px] text-[10px] font-semibold", VERDICT[r.review.verdict].tone)}>{VERDICT[r.review.verdict].label}</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Sin dictamen</span>
                  )}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open === r.incidentId && "rotate-180")} aria-hidden />
              </button>
              {open === r.incidentId && <AuditDetail row={r} canWrite={canWrite} timezone={timezone} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditDetail({ row, canWrite, timezone }: { row: IncidentAudit; canWrite: boolean; timezone: string }) {
  return (
    <div className="grid gap-4 border-t border-(--hairline) bg-background/60 px-3.5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Verificaciones del proceso</p>
          <ul className="flex flex-col gap-1.5">
            {row.checks.map((c) => {
              const m = CHECK_ICON[c.status];
              return (
                <li key={c.id} className="flex items-start gap-2 text-[13px]">
                  <m.Icon className={cn("mt-0.5 size-4 shrink-0", m.tone)} aria-hidden />
                  <span>
                    <span className="font-medium">{CHECK_LABEL[c.id]}</span>
                    <span className="text-muted-foreground"> · {m.label}. {c.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Qué hizo el equipo</p>
          {row.actions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Sin acciones registradas.</p>
          ) : (
            <ol className="flex flex-col gap-1 border-l border-(--hairline) pl-3">
              {row.actions.map((a, i) => (
                <li key={`${a.at}-${i}`} className="text-[13px]">
                  <span className="tabular text-muted-foreground">{fmt(a.at, timezone)}</span> · <span className="font-medium">{a.by}</span> · {a.what}
                </li>
              ))}
            </ol>
          )}
          <Link href={`/incidents?id=${row.incidentId}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            Abrir el incidente
          </Link>
        </div>
      </div>
      <ReviewForm row={row} canWrite={canWrite} timezone={timezone} />
    </div>
  );
}

function ReviewForm({ row, canWrite, timezone }: { row: IncidentAudit; canWrite: boolean; timezone: string }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<AuditVerdict | null>(row.review?.verdict ?? null);
  const [comment, setComment] = useState(row.review?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!verdict) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/incidents/${encodeURIComponent(row.incidentId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, comment }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        setError(d.message ?? "No se pudo guardar el dictamen.");
        return;
      }
      sileo.success({ title: `Dictamen guardado: ${VERDICT[verdict].label}`, description: row.incidentId });
      router.refresh();
    } catch {
      setError("Sin conexión con el servidor. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-foreground/[0.03] p-3">
      <p className="text-xs font-medium text-muted-foreground">Dictamen de auditoría</p>
      {row.review && (
        <p className="text-[13px]">
          <span className={cn("rounded-full px-1.5 py-[1px] text-[11px] font-semibold", VERDICT[row.review.verdict].tone)}>{VERDICT[row.review.verdict].label}</span>{" "}
          <span className="text-muted-foreground">
            por {row.review.by} · {fmt(row.review.at, timezone)}
          </span>
          {row.review.comment && <span className="mt-1 block">{row.review.comment}</span>}
        </p>
      )}
      {canWrite ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Dictamen">
            {(Object.keys(VERDICT) as AuditVerdict[]).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={verdict === v}
                onClick={() => setVerdict(v)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-(--hairline)", verdict === v ? VERDICT[v].tone + " ring-transparent" : "text-muted-foreground hover:bg-foreground/[0.05]")}
              >
                {VERDICT[v].label}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted-foreground" htmlFor={`comment-${row.incidentId}`}>
            Comentario {verdict && verdict !== "CUMPLE" ? "(obligatorio)" : "(opcional)"}
          </label>
          <textarea
            id={`comment-${row.incidentId}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full resize-y rounded-lg bg-background px-3 py-2 text-[13px] ring-1 ring-(--hairline) outline-none focus-visible:ring-2 focus-visible:ring-primary"
            placeholder="Qué se revisó y qué falta corregir en el proceso."
          />
          {error && <p className="text-xs text-status-critical-text">{error}</p>}
          <Button size="sm" onClick={save} disabled={!verdict || busy || (verdict !== "CUMPLE" && comment.trim().length < 5)}>
            {busy ? "Guardando…" : row.review ? "Actualizar dictamen" : "Guardar dictamen"}
          </Button>
          <p className="text-[11px] text-muted-foreground">Cada dictamen queda en la bitácora y en el historial del incidente.</p>
        </>
      ) : (
        !row.review && <p className="text-[13px] text-muted-foreground">Lo dictamina el equipo de auditoría.</p>
      )}
    </div>
  );
}
