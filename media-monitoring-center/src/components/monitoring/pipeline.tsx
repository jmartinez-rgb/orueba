"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, CircleDashed, CircleX, Clock3, Database, FileSpreadsheet, Plug, Radar, ScrollText } from "lucide-react";
import { sileo } from "sileo";
import type { IngestionMode, PlatformId } from "@/lib/types";
import type { ExecutionSummary } from "@/lib/monitoring/confidence";
import { PLATFORMS } from "@/lib/platforms/registry";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformMark } from "./status";

const STATUS = {
  OK: { label: "Listo", tone: "text-status-normal-text", Icon: CircleCheck },
  PARCIAL: { label: "Parcial", tone: "text-status-attention-text", Icon: CircleCheck },
  PENDIENTE: { label: "Pendiente", tone: "text-status-attention-text", Icon: Clock3 },
  EJECUTANDO: { label: "Ejecutando", tone: "text-primary", Icon: Clock3 },
  ERROR: { label: "Error", tone: "text-status-critical-text", Icon: CircleX },
} as const;

/** Diagrama del flujo: lectura directa de la hoja de Dataslayer, o API/Sheets → BigQuery. */
export function PipelineDiagram({ mode = "bigquery" }: { mode?: "mock" | "sheets" | "bigquery" | "unified" }) {
  const step = (Icon: typeof Plug, title: string, sub: string, tone = "border-border") => (
    <div className={cn("flex min-w-[130px] flex-1 flex-col gap-1 surface rounded-xl px-4 py-3", tone)}>
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="size-3.5 text-brand-teal" /> {title}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{sub}</span>
    </div>
  );
  const arrow = <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground md:block" aria-hidden />;
  if (mode === "unified") return <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">{step(Radar, "Plataformas", "Cuentas autorizadas de cada marca")}{arrow}{step(Plug, "APIs directas", "Lecturas diarias y horarias")}{arrow}{step(Database, "Histórico guardado", "Conserva la última lectura válida; muestra los fallos de actualización.")}{arrow}{step(ScrollText, "Monitoring Center", "Lee el histórico y evalúa datos recibidos.")}</div>;
  if (mode === "sheets") {
    return (
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        {step(Radar, "Plataformas", "Google, Meta, TikTok, Bing y Spotify")}
        {arrow}
        {step(FileSpreadsheet, "Dataslayer", "Actualiza la hoja cada 2 horas (tarda 5–10 minutos).", "border-primary/40")}
        {arrow}
        {step(FileSpreadsheet, "Google Sheets", "Una pestaña por plataforma + DataslayerQueries (hora y estado de cada actualización).")}
        {arrow}
        {step(ScrollText, "Monitoring Center", "Solo lee la hoja: evalúa, alerta y reporta.")}
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        {step(Radar, "Plataformas", "Google, Meta, TikTok, Microsoft, Spotify, X")}
        {arrow}
        {step(Plug, "1 · API directa (n8n)", "Opción preferida: WF01–WF06 leen la API de cada plataforma.", "border-primary/40")}
        {arrow}
        {step(Database, "BigQuery", "Fuente única de verdad (izzi-485718).")}
        {arrow}
        {step(ScrollText, "Monitoring Center", "Solo lee: evalúa, alerta y reporta.")}
      </div>
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        {step(Radar, "Plataformas", "Si no hay conexión directa…")}
        {arrow}
        {step(FileSpreadsheet, "2 · Dataslayer → Sheets", "Respaldo: Dataslayer actualiza la hoja de cada plataforma.", "border-dashed")}
        {arrow}
        {step(ScrollText, "Apps Script", "Query/upload de las hojas a BigQuery.", "border-dashed")}
        {arrow}
        {step(FileSpreadsheet, "Hoja de control", "Confirma si ya se ejecutó todo o qué falta ejecutar.", "border-dashed")}
      </div>
    </div>
  );
}

export function ExecutionTable({
  execution,
  ingestion,
  timezone,
  canEdit,
  fixedSource,
}: {
  execution: ExecutionSummary;
  ingestion: Partial<Record<PlatformId, IngestionMode>>;
  timezone: string;
  canEdit: boolean;
  /** Conexión fija de la fuente (hoja de Dataslayer → Sheets; APIs directas → API): no se elige por plataforma. */
  fixedSource?: IngestionMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<PlatformId | null>(null);

  async function setMode(p: PlatformId, mode: IngestionMode) {
    setBusy(p);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `ingestion.${p}`, value: mode }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: `${PLATFORMS[p].name}: ${mode === "api" ? "API directa" : "Google Sheets (Dataslayer)"}` });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!execution.rows.length) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        <CircleDashed className="size-4" /> No hay hoja/tabla de control configurada. Declárala en el mapeo de BigQuery (<code className="font-mono">executionControl</code>) para ver aquí si ya se
        ejecutó Dataslayer / Apps Script.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Paso</TableHead>
            <TableHead>Conexión</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Última ejecución</TableHead>
            <TableHead className="text-right">Filas</TableHead>
            <TableHead>Detalle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {execution.rows.map((r) => {
            const st = r.stale && r.status !== "ERROR" && r.status !== "PENDIENTE" ? { label: "Vencido", tone: "text-status-attention-text", Icon: Clock3 } : STATUS[r.status];
            const mode = r.platform ? (fixedSource ?? ingestion[r.platform] ?? "sheets") : null;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="flex items-center gap-2 text-xs font-medium">
                    {r.platform && <PlatformMark platform={r.platform} className="size-5 text-[9px]" />}
                    {r.step}
                  </span>
                </TableCell>
                <TableCell>
                  {r.platform && mode ? (
                    canEdit && !fixedSource ? (
                      <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={`Conexión de ${PLATFORMS[r.platform].name}`}>
                        {(["api", "sheets"] as IngestionMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={mode === m}
                            disabled={busy === r.platform}
                            onClick={() => mode !== m && setMode(r.platform!, m)}
                            className={cn("rounded px-2 py-0.5 text-[11px] font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                          >
                            {m === "api" ? "API directa" : "Sheets"}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs">{mode === "api" ? "API directa" : "Google Sheets"}</span>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", st.tone)}>
                    <st.Icon className="size-3.5" /> {st.label}
                  </span>
                </TableCell>
                <TableCell className="tabular text-xs">{formatDateTimeInTz(r.lastRunAt, timezone)}</TableCell>
                <TableCell className="tabular text-right text-xs">{r.rows ?? "—"}</TableCell>
                <TableCell className="max-w-[320px] text-xs text-muted-foreground">{r.message ?? (r.stale ? "No ha corrido en el horario esperado." : "—")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
