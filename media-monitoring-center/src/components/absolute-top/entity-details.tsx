"use client";
import { useState } from "react";
import { Copy, TriangleAlert } from "lucide-react";
import type { AbsoluteTopEvaluation } from "@/lib/absolute-top/types";
import { buildAbsoluteTopAlertText } from "@/lib/absolute-top/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countText, CROSS_LABELS, ctrText, measuredAtText, moneyText, pointText, rateText, shareText, windowText } from "./presentation";

function AuditTrend({ row }: { row: AbsoluteTopEvaluation }) {
  const entries = [...row.evolution].sort((a, b) => a.at.localeCompare(b.at));
  const finite = entries.filter((point) => point.rate !== null && Number.isFinite(point.rate) && point.rate >= 0 && point.rate <= 1);
  if (!finite.length) return <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Sin mediciones válidas para dibujar una evolución. N/D no se convierte en cero.</p>;
  const min = Math.min(...entries.map((point) => Date.parse(point.at)).filter(Number.isFinite));
  const max = Math.max(...entries.map((point) => Date.parse(point.at)).filter(Number.isFinite));
  const x = (at: string) => max > min ? 32 + (Date.parse(at) - min) / (max - min) * 596 : 330;
  const y = (rate: number) => 168 - rate * 132;
  const segments: Array<Array<{ at: string; rate: number }>> = [];
  let segment: Array<{ at: string; rate: number }> = [];
  for (const point of entries) {
    if (point.rate === null || !Number.isFinite(point.rate) || point.rate < 0 || point.rate > 1 || !Number.isFinite(Date.parse(point.at))) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push({ at: point.at, rate: point.rate });
  }
  if (segment.length) segments.push(segment);
  return (
    <figure className="min-w-0">
      <svg viewBox="0 0 660 190" role="img" aria-label={`Evolución de Abs. Top de ${row.ad_group_name ?? row.campaign_name}. ${finite.length} mediciones válidas. Objetivo ${rateText(row.target_rate)}.`} className="w-full rounded-xl bg-muted/40">
        {[0, 0.5, 1].map((rate) => <g key={rate}><line x1="32" x2="628" y1={y(rate)} y2={y(rate)} stroke="var(--hairline)" /><text x="4" y={y(rate) + 4} fontSize="10" fill="var(--muted-foreground)">{Math.round(rate * 100)}%</text></g>)}
        {row.target_rate !== null && <><line x1="32" x2="628" y1={y(row.target_rate)} y2={y(row.target_rate)} stroke="var(--status-attention-text)" strokeDasharray="6 4" /><text x="620" y={y(row.target_rate) - 5} textAnchor="end" fontSize="10" fill="var(--foreground)">Objetivo {rateText(row.target_rate)}</text></>}
        {segments.map((points, index) => <polyline key={index} fill="none" stroke="var(--primary)" strokeWidth="2.5" points={points.map((point) => `${x(point.at)},${y(point.rate)}`).join(" ")} />)}
        {segments.flat().map((point, index) => <circle key={index} cx={x(point.at)} cy={y(point.rate)} r="3.5" fill="var(--primary)"><title>{`${measuredAtText(point.at, row.source_timezone)} · ${rateText(point.rate)}`}</title></circle>)}
      </svg>
      <figcaption className="mt-2 text-xs text-muted-foreground">Evolución entre auditorías almacenadas. Los huecos N/D quedan separados; la línea no estima datos ausentes. Las ventanas de reporte pueden solaparse.</figcaption>
    </figure>
  );
}

export function EntityDetails({ row }: { row: AbsoluteTopEvaluation }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const message = buildAbsoluteTopAlertText(row);
  const metrics = [
    ["Abs. Top of Page", rateText(row.absolute_top_rate)], ["Objetivo", rateText(row.target_rate)], ["Gap", pointText(row.gap_pp)],
    ["Top of Page (complementaria)", rateText(row.top_of_page_rate)], ["Search Impression Share", shareText(row.search_impression_share, row.share_bounds.search_impression_share)],
    ["Lost IS Rank", shareText(row.search_lost_is_rank, row.share_bounds.search_lost_is_rank)], ["Lost IS Budget", shareText(row.search_lost_is_budget, row.share_bounds.search_lost_is_budget)],
    ["Impresiones", countText(row.impressions)], ["Clics", countText(row.clicks)], ["CTR", ctrText(row.ctr)], ["CPC", moneyText(row.cpc, row.currency)],
    ["Gasto", moneyText(row.spend, row.currency)], ["Conversiones (total Google)", countText(row.conversions)], ["Presupuesto diario", moneyText(row.daily_budget, row.currency)],
    ["Peso en la campaña", row.level === "campaign" ? "No aplica" : rateText(row.group_weight)], ["Estrategia de puja", row.bidding_strategy ?? "N/D"],
  ];
  const comparisons = [["Auditoría anterior", row.comparison.previous], ["Mismo periodo del día anterior", row.comparison.previous_day], ["Últimas 24 horas", row.comparison.last_24h], ["Últimos 7 días", row.comparison.last_7d]] as const;
  return (
    <Card id="absolute-top-details" role="region" tabIndex={-1} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Detalle de ${row.ad_group_name ?? row.campaign_name}`}>
      <CardHeader className="flex-wrap">
        <div className="min-w-0"><CardTitle className="break-words">{row.ad_group_name ?? row.campaign_name}</CardTitle><CardDescription className="break-words">{row.domain_name ?? "Sin clasificar"} → {row.account_name} → {row.campaign_name}{row.ad_group_name ? ` → ${row.ad_group_name}` : ""}</CardDescription></div>
        <Button variant="outline" size="sm" onClick={async () => {
          try { await navigator.clipboard.writeText(message); setCopyState("copied"); } catch { setCopyState("manual"); }
        }}><Copy aria-hidden />Copiar alerta</Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p role="status" className="text-xs text-muted-foreground">{copyState === "copied" ? "Texto copiado. El envío queda a tu criterio." : copyState === "manual" ? "El navegador no permitió copiar. Selecciona el texto en «Mensaje para copiar manualmente»." : "Texto para revisión y envío manual; no se envía a WhatsApp ni Slack desde aquí."}</p>
        <div className="rounded-xl border border-(--hairline) bg-muted/30 p-3 text-xs leading-relaxed">
          Customer ID: {row.customer_id} · Campaign ID: {row.campaign_id}{row.ad_group_id ? ` · Ad Group ID: ${row.ad_group_id}` : ""}<br />
          Estado en Google: activa{row.level === "ad_group" ? " · grupo activo" : ""} · Ventana: {windowText(row)} · Zona horaria: {row.source_timezone}<br />
          Extracción: {measuredAtText(row.extracted_at, row.source_timezone)} · Auditoría: {measuredAtText(row.audit_at, row.source_timezone)} · Cobertura: {row.coverage === "complete" ? "completa" : row.coverage === "partial" ? "parcial" : "no disponible"}
        </div>
        {row.sudden_drop && <div className="flex gap-2 rounded-lg border border-status-attention-text/25 bg-status-attention/10 p-3 text-sm text-status-attention-text"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><p>Deterioro preventivo de Absolute Top: la caída merece revisión aunque la entidad todavía cumpla su objetivo.</p></div>}
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-lg bg-muted/40 px-3 py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 tabular text-sm font-semibold">{value}</dd></div>)}</dl>
        <p className="text-xs text-muted-foreground">Las conversiones son el total de plataforma de Google, no un evento offline principal validado para negocio. Las métricas IS acotadas se muestran como &lt;10% o &gt;90%, nunca como porcentajes exactos. La métrica Top of Page no determina el cumplimiento.</p>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="min-w-0" aria-label="Comparativas temporales"><h3 className="mb-2 text-sm font-semibold">Comparativas temporales</h3><Table><TableHeader><TableRow><TableHead>Referencia</TableHead><TableHead>Abs. Top</TableHead><TableHead>Cambio</TableHead><TableHead>Muestras</TableHead></TableRow></TableHeader><TableBody>{comparisons.map(([label, value]) => <TableRow key={label}><TableCell className="text-xs">{label}{value.approximate && <span className="block text-muted-foreground">Indicador aproximado</span>}</TableCell><TableCell>{rateText(value.rate)}</TableCell><TableCell>{pointText(value.delta_pp)}</TableCell><TableCell>{value.samples}</TableCell></TableRow>)}</TableBody></Table><p className="mt-2 text-xs text-muted-foreground">El cambio se expresa en puntos porcentuales frente a cada referencia. N/D indica que no existe una muestra comparable.</p></section>
          <section className="min-w-0" aria-label="Persistencia"><h3 className="mb-2 text-sm font-semibold">Persistencia · {row.persistence.label}</h3><dl className="grid grid-cols-2 gap-2 text-sm">{[["Auditorías consecutivas fuera", countText(row.persistence.consecutive_audits)], ["Horas desde detección", countText(row.persistence.hours_since_detection)], ["Primera detección", measuredAtText(row.persistence.first_detected_at, row.source_timezone)], ["Última detección", measuredAtText(row.persistence.last_detected_at, row.source_timezone)], ["Peor valor", rateText(row.persistence.worst_rate)], ["Mejor valor", rateText(row.persistence.best_rate)], ["Promedio entre auditorías", rateText(row.persistence.mean_rate)], ["Prioridad", countText(row.severity_score)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="tabular">{value}</dd></div>)}</dl><p className="mt-2 text-xs text-muted-foreground">Son auditorías, no horas continuas comprobadas ni una media temporal de Google Ads.</p></section>
        </div>
        <section className="min-w-0" aria-label="Evolución"><h3 className="mb-2 text-sm font-semibold">Evolución de Abs. Top</h3><AuditTrend row={row} /><details className="mt-3"><summary className="cursor-pointer rounded text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver mediciones de la evolución</summary><Table><TableHeader><TableRow><TableHead>Auditoría</TableHead><TableHead>Abs. Top</TableHead><TableHead>Impresiones</TableHead></TableRow></TableHeader><TableBody>{[...row.evolution].reverse().map((point, index) => <TableRow key={`${point.audit_id}:${index}`}><TableCell>{measuredAtText(point.at, row.source_timezone)}</TableCell><TableCell>{rateText(point.rate)}</TableCell><TableCell>{countText(point.impressions)}</TableCell></TableRow>)}</TableBody></Table></details></section>
        <section className="min-w-0" aria-label="Diagnóstico"><h3 className="mb-2 text-sm font-semibold">{CROSS_LABELS[row.cross_status]}</h3>{row.diagnostics.length ? <ul className="list-disc space-y-2 pl-4 text-sm">{row.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic}</li>)}</ul> : <p className="text-sm text-muted-foreground">Sin evidencia suficiente para un diagnóstico asociado.</p>}<p className="mt-2 text-xs text-muted-foreground">Las asociaciones orientan la revisión; no prueban causalidad ni recomiendan aumentar presupuesto automáticamente.</p></section>
        {row.warnings.length > 0 && <div className="rounded-lg border border-status-data-text/25 bg-status-data/10 p-3 text-sm"><p className="font-medium">Limitaciones de esta medición</p><ul className="mt-1 list-disc pl-4">{row.warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul></div>}
        <details><summary className="cursor-pointer rounded text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">Mensaje para copiar manualmente</summary><pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-words">{message}</pre></details>
      </CardContent>
    </Card>
  );
}
