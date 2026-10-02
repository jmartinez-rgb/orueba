"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ChevronRight, CircleCheck, Layers3, RefreshCw, TriangleAlert } from "lucide-react";
import type { AbsoluteTopDashboard, AbsoluteTopDomainSummary, AbsoluteTopEvaluation, AbsoluteTopState } from "@/lib/absolute-top/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EntityDetails } from "./entity-details";
import { DomainSummaryCopy } from "./domain-summary-copy";
import { campaignKey, countText, CROSS_LABELS, EMPTY_FILTERS, filterAbsoluteTopRows, measuredAtText, pointText, rateText, SEVERITY_LABELS, STATE_LABELS, type AbsoluteTopFilters } from "./presentation";

const TONES: Record<AbsoluteTopState, string> = {
  meets: "bg-status-normal/10 text-status-normal-text",
  near: "bg-status-attention/15 text-status-attention-text",
  below: "bg-status-critical/10 text-status-critical-text",
  insufficient: "bg-status-data/10 text-status-data-text",
  unclassified: "bg-status-data/10 text-status-data-text",
};

export function EntityState({ row }: { row: Pick<AbsoluteTopEvaluation, "state" | "sudden_drop" | "coverage"> }) {
  return <span className="inline-flex flex-wrap items-center gap-1"><Badge className={TONES[row.state]}>{row.state === "below" ? <TriangleAlert aria-hidden /> : row.state === "meets" ? <CircleCheck aria-hidden /> : null}{STATE_LABELS[row.state]}</Badge>{row.sudden_drop && <Badge className="bg-status-attention/15 text-status-attention-text">Deterioro</Badge>}{row.coverage !== "complete" && <Badge variant="muted">{row.coverage === "partial" ? "Cobertura parcial" : "Sin cobertura"}</Badge>}</span>;
}

export function DomainCard({ summary, rows = [] }: { summary: AbsoluteTopDomainSummary; rows?: AbsoluteTopEvaluation[] }) {
  const total = summary.campaigns + summary.ad_groups;
  return (
    <Card className={cn("overflow-hidden border-t-[3px]", summary.below > 0 ? "border-t-status-critical" : summary.insufficient > 0 || !total ? "border-t-status-data" : summary.near > 0 ? "border-t-status-attention" : "border-t-status-normal")}>
      <CardHeader><div><CardTitle>{summary.domain_name}</CardTitle><CardDescription>Objetivo mínimo {rateText(summary.target_rate)}</CardDescription></div><Layers3 className="size-5 shrink-0 text-muted-foreground" aria-hidden /></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-muted-foreground">Abs. Top ponderado · indicador aproximado</p><p className="mt-1 tabular text-3xl font-semibold">{rateText(summary.weighted_absolute_top)}</p></div><div className="text-right text-xs text-muted-foreground"><p>{summary.campaigns} campañas</p><p>{summary.ad_groups} grupos</p></div></div>
        {summary.weighted_absolute_top === null && total > 0 && <p className="text-xs text-muted-foreground">Indicador N/D: revisa cobertura, volumen y coincidencia de ventanas de las cuentas.</p>}
        <dl className="grid grid-cols-2 gap-2 text-xs">{[["Cumplen", summary.meets, "text-status-normal-text"], ["Cerca", summary.near, "text-status-attention-text"], ["Fuera", summary.below, "text-status-critical-text"], ["Insuficientes", summary.insufficient, "text-status-data-text"]].map(([label, count, tone]) => <div key={label} className="rounded-lg bg-muted/40 p-2"><dt className={String(tone)}>{label}</dt><dd className="mt-0.5 tabular text-lg font-semibold">{count}</dd></div>)}</dl>
        <p className="text-xs text-muted-foreground">Cumplimiento entre entidades evaluables: <span className="font-semibold text-foreground">{rateText(summary.compliance_rate)}</span>. Campañas y grupos se cuentan como entidades distintas.</p>
        {summary.below > 0 && <p className="rounded-lg bg-status-critical/10 p-2 text-xs font-medium text-status-critical-text">{summary.below} entidades fuera del objetivo permanecen visibles, aunque el indicador agregado cumpla.</p>}
        {!total && <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">Sin entidades de Search evaluadas para este dominio. Revisa la cobertura de las cuentas.</p>}
        <p className="text-[11px] text-muted-foreground">El ponderado usa campañas, sin sumar otra vez sus grupos. Se evalúa cada entidad de forma independiente.</p>
        <DomainSummaryCopy summary={summary} rows={rows} />
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="flex min-w-0 flex-col gap-1 text-xs font-medium"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 rounded-md border border-(--hairline) bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function StructureTree({ rows, allRows, onSelect }: { rows: AbsoluteTopEvaluation[]; allRows: AbsoluteTopEvaluation[]; onSelect?: (key: string) => void }) {
  const domains = [...new Set(rows.map((row) => row.domain_id))];
  return <div className="space-y-3">{domains.map((domain) => {
    const domainRows = rows.filter((row) => row.domain_id === domain);
    const accounts = [...new Set(domainRows.map((row) => row.customer_id))];
    return <details key={domain ?? "unclassified"} open className="rounded-xl border border-(--hairline) p-3"><summary className="cursor-pointer rounded text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{domainRows[0].domain_name ?? "Sin clasificar"}</summary><div className="mt-3 space-y-2 pl-2 sm:pl-4">{accounts.map((account) => {
      const accountRows = domainRows.filter((row) => row.customer_id === account);
      const campaigns = [...new Set(accountRows.map(campaignKey))];
      return <details key={account} className="rounded-lg bg-muted/30 p-3"><summary className="cursor-pointer rounded text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-medium">{accountRows[0].account_name}</span><span className="ml-2 text-xs text-muted-foreground">{account} · {campaigns.length} campañas visibles</span></summary><div className="mt-3 space-y-2">{campaigns.map((key) => {
        const visible = accountRows.filter((row) => campaignKey(row) === key);
        const parent = allRows.find((row) => row.level === "campaign" && campaignKey(row) === key);
        const groups = allRows.filter((row) => row.level === "ad_group" && campaignKey(row) === key);
        const affected = groups.filter((row) => row.state === "below").length;
        return <details key={key} className="rounded-lg border border-(--hairline) p-3"><summary className="cursor-pointer rounded text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="break-words font-medium">{visible[0].campaign_name}</span><span className="mt-1 flex flex-wrap items-center gap-2">{parent ? <EntityState row={parent} /> : <Badge variant="muted">Campaña N/D</Badge>}{affected > 0 && <Badge className="bg-status-critical/10 text-status-critical-text">{affected} grupos fuera del objetivo</Badge>}<span className="text-xs text-muted-foreground">{parent ? CROSS_LABELS[parent.cross_status] : "Diagnóstico cruzado no disponible"}</span></span></summary><div className="mt-3 space-y-2">{visible.map((row) => <button key={row.entity_key} type="button" aria-controls="absolute-top-details" onClick={() => onSelect?.(row.entity_key)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-card p-3 text-left shadow-(--shadow-control) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 break-words text-xs"><span className="font-medium">{row.level === "campaign" ? "Campaña agregada" : row.ad_group_name}</span><span className="mt-1 block text-muted-foreground">Abs. Top {rateText(row.absolute_top_rate)} · objetivo {rateText(row.target_rate)} · gap {pointText(row.gap_pp)}{row.level === "ad_group" ? ` · peso ${rateText(row.group_weight)}` : ""}</span></span><EntityState row={row} /></button>)}</div></details>;
      })}</div></details>;
    })}</div></details>;
  })}</div>;
}

export function AbsoluteTopDashboardView({ initial }: { initial: AbsoluteTopDashboard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<AbsoluteTopFilters>({ ...EMPTY_FILTERS });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "tree">("table");
  const visible = filterAbsoluteTopRows(initial.rows, filters);
  const selectedRow = visible.find((row) => row.entity_key === selected) ?? visible[0];
  const accounts = [...new Map(initial.rows.map((row) => [row.customer_id, { value: row.customer_id, label: `${row.account_name} · ${row.customer_id}` }])).values()];
  const accountRows = initial.rows.filter((row) => filters.account === "all" || row.customer_id === filters.account);
  const campaigns = [...new Map(accountRows.map((row) => [campaignKey(row), { value: campaignKey(row), label: `${row.campaign_name} · ${row.account_name}` }])).values()];
  const groups = accountRows.filter((row) => row.level === "ad_group" && (filters.campaign === "all" || campaignKey(row) === filters.campaign)).map((row) => ({ value: row.entity_key, label: `${row.ad_group_name} · ${row.campaign_name}` }));
  const selectedDomain = initial.domains.find((domain) => domain.id === initial.selectedDomain);
  const localFilters = Object.values(filters).some((value) => value !== "all");
  const selectEntity = (key: string) => {
    setSelected(key);
    requestAnimationFrame(() => {
      const panel = document.getElementById("absolute-top-details");
      const topbar = document.querySelector<HTMLElement>("[data-monitoring-topbar]");
      if (panel) panel.style.scrollMarginTop = `${Math.max(0, topbar?.getBoundingClientRect().bottom ?? 0) + 16}px`;
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };
  const setFilter = (field: keyof AbsoluteTopFilters, value: string) => setFilters((current) => ({ ...current, [field]: value, ...(field === "account" ? { campaign: "all", adGroup: "all" } : field === "campaign" ? { adGroup: "all" } : {}) }));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-(--hairline) bg-card px-4 py-3"><div className="min-w-0 text-sm"><p className="font-semibold">Google Ads · izzi · {selectedDomain?.name ?? (initial.selectedDomain === "all" ? "Todos los dominios" : "Dominio no disponible")}</p><p className="mt-1 text-xs text-muted-foreground">El filtro de dominio de la barra superior se aplica a todo el monitoreo compatible.</p><p className="mt-1 text-xs text-muted-foreground">Última auditoría: {measuredAtText(initial.lastAuditAt, "UTC")}{initial.lastAuditAt ? " UTC" : ""}. Releer no crea una auditoría ni consulta Google Ads.</p></div><Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden className={pending ? "animate-spin" : ""} />{pending ? "Releyendo…" : "Releer auditoría"}</Button></div>
      {!initial.configured && <div role="status" className="rounded-xl border border-status-data/30 bg-status-data/10 p-4"><p className="text-sm font-semibold">Configuración maestra de dominios no disponible</p><p className="mt-1 text-xs text-muted-foreground">No se calculan objetivos ni se clasifican cuentas sin la configuración central. Revisa la sincronización de la API unificada.</p></div>}
      {initial.warnings.length > 0 && <div role="status" className="rounded-xl border border-status-data/30 bg-status-data/10 p-4"><p className="text-sm font-semibold">Cobertura y calidad de datos</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{initial.warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul></div>}
      <div className="grid gap-4 lg:grid-cols-3">{initial.summaries.map((summary) => <DomainCard key={summary.domain_id} summary={summary} rows={initial.rows.filter(row => row.domain_id === summary.domain_id)} />)}</div>
      {initial.summaries.length > 0 && <p className="text-xs text-muted-foreground">{initial.approximationNotice} Los resúmenes muestran el dominio seleccionado completo; los filtros locales siguientes solo cambian el listado y su detalle.</p>}
      {initial.policy && <details className="rounded-xl border border-(--hairline) bg-muted/20 p-3"><summary className="cursor-pointer rounded text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Política central aplicada</summary><p className="mt-2 text-xs text-muted-foreground">Mínimo de impresiones: {initial.policy.minImpressions}. Cerca del límite: hasta {initial.policy.warningGapPp} pp debajo. Deterioro preventivo: caída de {initial.policy.suddenDropThresholdPp} pp. Conservación: {initial.policy.retentionDays} días. La evaluación usa exclusivamente metrics.absolute_top_impression_percentage; Impression Share y Top of Page aportan contexto.</p></details>}
      {!initial.available ? <Card><CardContent className="pt-5"><p className="text-sm font-semibold">Sin auditorías de Absolute Top almacenadas</p><p className="mt-2 text-sm text-muted-foreground">No significa que las campañas cumplan. Ejecuta la lectura acotada de Absolute Top desde el proceso autorizado y luego relee esta vista. Abrir el dashboard no extrae datos ni modifica Google Ads.</p></CardContent></Card> : <>
        <Card><CardHeader><div><CardTitle>Campañas y grupos de anuncios</CardTitle><CardDescription>Evaluación independiente. Orden inicial: mayor severidad a menor severidad.</CardDescription></div><ArrowDownWideNarrow className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <FilterSelect label="Cuenta" value={filters.account} options={accounts} onChange={(value) => setFilter("account", value)} />
          <FilterSelect label="Campaña" value={filters.campaign} options={campaigns} onChange={(value) => setFilter("campaign", value)} />
          <FilterSelect label="Grupo de anuncios" value={filters.adGroup} options={groups} onChange={(value) => setFilter("adGroup", value)} />
          <FilterSelect label="Nivel" value={filters.level} options={[{ value: "campaign", label: "Campaña" }, { value: "ad_group", label: "Grupo de anuncios" }]} onChange={(value) => setFilter("level", value)} />
          <FilterSelect label="Estado" value={filters.state} options={Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => setFilter("state", value)} />
          <FilterSelect label="Severidad" value={filters.severity} options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => setFilter("severity", value)} />
        </div><div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-muted-foreground">{visible.length} de {initial.rows.length} entidades visibles · prioridad descendente</p><Button variant="ghost" size="sm" disabled={!localFilters} onClick={() => { setFilters({ ...EMPTY_FILTERS }); setSelected(null); }}>Limpiar filtros locales</Button></div><div className="flex flex-wrap gap-2" role="group" aria-label="Presentación del análisis"><Button variant={view === "table" ? "secondary" : "ghost"} size="sm" aria-pressed={view === "table"} onClick={() => setView("table")}>Tabla</Button><Button variant={view === "tree" ? "secondary" : "ghost"} size="sm" className="h-auto min-h-8 max-w-full whitespace-normal text-left" aria-pressed={view === "tree"} onClick={() => setView("tree")}>Dominio → Cuenta → Campaña → Grupo</Button></div>
          {!visible.length ? <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No hay entidades que coincidan con estos filtros. No se interpreta como cumplimiento.</p> : view === "tree" ? <StructureTree rows={visible} allRows={initial.rows} onSelect={selectEntity} /> : <><div className="hidden md:block"><Table><caption className="sr-only">Absolute Top por dominio, cuenta, campaña y grupo, ordenado por severidad. Los datos ausentes se muestran como N/D.</caption><TableHeader><TableRow>{["Dominio / Cuenta", "Nivel / Campaña / Grupo", "Abs. Top", "Objetivo", "Gap", "Impresiones", "Peso", "Estado", "Prioridad", "Detalle"].map((head) => <TableHead key={head}>{head}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={row.entity_key} data-state={selectedRow?.entity_key === row.entity_key ? "selected" : undefined}><TableCell className="max-w-64 whitespace-normal text-xs"><span className="font-medium">{row.domain_name ?? "Sin clasificar"}</span><span className="mt-1 block break-words text-muted-foreground">{row.account_name}</span></TableCell><TableCell className="max-w-72 whitespace-normal text-xs"><span className="font-medium">{row.campaign_name}</span>{row.ad_group_name && <span className="mt-1 block text-muted-foreground">↳ {row.ad_group_name}</span>}<span className="mt-1 block text-[11px] text-muted-foreground">{row.level === "campaign" ? "Campaña" : "Grupo de anuncios"}</span></TableCell><TableCell className="font-semibold">{rateText(row.absolute_top_rate)}</TableCell><TableCell>{rateText(row.target_rate)}</TableCell><TableCell className={row.gap_pp !== null && row.gap_pp < 0 ? "text-status-critical-text" : ""}>{pointText(row.gap_pp)}</TableCell><TableCell>{countText(row.impressions)}</TableCell><TableCell>{row.level === "ad_group" ? rateText(row.group_weight) : "No aplica"}</TableCell><TableCell><EntityState row={row} /></TableCell><TableCell><span className="font-medium">{countText(row.severity_score)}</span><span className="block text-[11px] text-muted-foreground">{SEVERITY_LABELS[row.severity]}</span></TableCell><TableCell><Button variant="ghost" size="xs" onClick={() => selectEntity(row.entity_key)} aria-controls="absolute-top-details" aria-label={`Ver detalle de ${row.ad_group_name ?? row.campaign_name}`}>Ver<ChevronRight aria-hidden /></Button></TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-3 md:hidden">{visible.map((row) => <div key={row.entity_key} className="rounded-xl border border-(--hairline) p-3"><p className="break-words text-xs text-muted-foreground">{row.domain_name ?? "Sin clasificar"} · {row.account_name}</p><p className="mt-1 break-words text-sm font-semibold">{row.ad_group_name ?? row.campaign_name}</p>{row.ad_group_name && <p className="mt-1 break-words text-xs text-muted-foreground">Campaña: {row.campaign_name}</p>}<div className="mt-2"><EntityState row={row} /></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{[["Abs. Top", rateText(row.absolute_top_rate)], ["Objetivo", rateText(row.target_rate)], ["Gap", pointText(row.gap_pp)], ["Impresiones", countText(row.impressions)], ["Peso", row.level === "ad_group" ? rateText(row.group_weight) : "No aplica"], ["Prioridad", `${countText(row.severity_score)} · ${SEVERITY_LABELS[row.severity]}`]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="tabular font-medium">{value}</dd></div>)}</dl><Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => selectEntity(row.entity_key)} aria-controls="absolute-top-details">Ver detalle</Button></div>)}</div></>}
        </CardContent></Card>
        {selectedRow && <EntityDetails key={selectedRow.entity_key} row={selectedRow} />}
      </>}
    </div>
  );
}
