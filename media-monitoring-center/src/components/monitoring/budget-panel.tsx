"use client";
import { CircleAlert, CircleCheck, Info, Wallet } from "lucide-react";
import type { BudgetGroup, BudgetOverview, Insight, Pace, PlatformBudgetView } from "@/lib/services/platform-budgets";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformMark } from "@/components/monitoring/status";
import { cn } from "@/lib/utils";

const PACE: Record<Pace, { label: string; chip: string; bar: string }> = {
  on: { label: "En ritmo", chip: "bg-status-normal/12 text-status-normal-text", bar: "bg-status-normal" },
  below: { label: "Por debajo", chip: "bg-status-attention/14 text-status-attention-text", bar: "bg-status-attention" },
  above: { label: "Por encima", chip: "bg-status-alert/12 text-status-alert-text", bar: "bg-status-alert" },
  unknown: { label: "Sin curva", chip: "bg-foreground/[0.06] text-muted-foreground", bar: "bg-primary/70" },
};

const INSIGHT: Record<Insight["tone"], { Icon: typeof Info; tone: string }> = {
  good: { Icon: CircleCheck, tone: "text-status-normal-text" },
  warn: { Icon: CircleAlert, tone: "text-status-attention-text" },
  info: { Icon: Info, tone: "text-muted-foreground" },
};

export type BudgetPanelState = { kind: "ready"; overview: BudgetOverview; demo: boolean } | { kind: "unavailable"; reason: string; configured: boolean };

/**
 * Presupuesto diario vigente por plataforma y por estrategia, contra el gasto de hoy y lo esperado a
 * esta hora según la curva histórica de cada plataforma. Solo lectura de la configuración.
 */
export function BudgetPanel({ state }: { state: BudgetPanelState }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" aria-hidden />
            Presupuesto diario por plataforma
            {state.kind === "ready" && state.demo && <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Datos de demostración</span>}
          </CardTitle>
          <CardDescription>
            Lo que cada plataforma tiene configurado hoy en campañas activas (Meta, Google, TikTok y Microsoft), por estrategia con el mismo clasificador del monitoreo, contra el gasto de hoy. Los presupuestos totales
            cuentan con un diario estimado y los compartidos se cuentan una vez. Lectura cada 5 minutos desde la API unificada; la app no cambia nada en las plataformas.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>{state.kind === "unavailable" ? <Unavailable reason={state.reason} configured={state.configured} /> : <Ready overview={state.overview} />}</CardContent>
    </Card>
  );
}

function Unavailable({ reason, configured }: { reason: string; configured: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-foreground/[0.03] px-4 py-3 text-[13px]">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">{configured ? "No se pudieron leer los presupuestos" : "Conecta la API unificada para ver los presupuestos de las plataformas"}</p>
        <p className="mt-0.5 text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

function Ready({ overview }: { overview: BudgetOverview }) {
  if (!overview.total.campaigns) return <p className="text-[13px] text-muted-foreground">No hay campañas activas con presupuesto para esta marca.</p>;
  return (
    <Tabs defaultValue="all">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="all">Todas</TabsTrigger>
        {overview.platforms.map((p) => (
          <TabsTrigger key={p.platform} value={p.platform}>
            <PlatformMark platform={p.platform} className="size-4 rounded-[5px] text-[8px]" />
            {p.name}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="all" className="flex flex-col gap-5">
        <Stats group={overview.total} />
        <Bars title="Por plataforma" groups={overview.platforms.map((p) => ({ ...p.total, label: p.name }))} marks={overview.platforms.map((p) => p.platform)} />
        <Insights items={overview.insights} />
      </TabsContent>
      {overview.platforms.map((p) => (
        <TabsContent key={p.platform} value={p.platform} className="flex flex-col gap-5">
          <PlatformDetail view={p} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function PlatformDetail({ view }: { view: PlatformBudgetView }) {
  const s = view.structure;
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const parts = [
    s.adSetLevel ? n(s.adSetLevel, "con presupuesto por conjunto", "con presupuesto por conjunto") : null,
    s.shared ? n(s.shared, "compartido", "compartidos") : null,
    s.lifetime ? n(s.lifetime, "total", "totales") : null,
  ].filter(Boolean);
  return (
    <>
      <Stats group={view.total} structure={parts.join(" · ")} />
      <Bars title="Por estrategia" groups={view.strategies} />
      <Insights items={view.insights} />
      <section aria-label="Presupuestos más altos">
        <h4 className="mb-2 text-[13px] font-semibold">Presupuestos diarios más altos</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Campaña</th>
                <th className="py-1.5 pr-3 font-medium">Estrategia</th>
                <th className="py-1.5 pr-3 font-medium">Nivel</th>
                <th className="py-1.5 pr-3 text-right font-medium">Presupuesto</th>
                <th className="py-1.5 pr-3 text-right font-medium">Gastado hoy</th>
                <th className="py-1.5 text-right font-medium">Usado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--hairline)">
              {view.units.slice(0, 10).map((u) => (
                <tr key={u.key}>
                  <td className="max-w-[320px] truncate py-1.5 pr-3" title={u.name}>
                    {u.name}
                    <span className="block truncate text-[11px] text-muted-foreground">{u.account}</span>
                  </td>
                  <td className="py-1.5 pr-3">{u.strategy}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {u.level === "campaign" ? "Campaña" : u.level === "ad_set" ? "Conjuntos" : "Compartido"}
                    {u.type !== "daily" && " · total"}
                    {u.limited && <span className="ml-1 rounded-full bg-status-attention/14 px-1.5 py-px text-[10.5px] font-semibold text-status-attention-text">Limitada</span>}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right">{fmtCurrency(u.budget)}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{fmtCurrency(u.spend)}</td>
                  <td className="tabular py-1.5 text-right">{u.usedPct === null ? "—" : fmtPercent(u.usedPct, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stats({ group: g, structure }: { group: BudgetGroup; structure?: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Stat label="Presupuesto diario activo" value={fmtCurrency(g.total)} sub={[`${g.campaigns} ${g.campaigns === 1 ? "campaña" : "campañas"}`, structure].filter(Boolean).join(" · ")} />
      <Stat label="Gastado hoy" value={fmtCurrency(g.spend)} sub={g.usedPct === null ? "—" : `${fmtPercent(g.usedPct, 0)} del diario`} />
      <Stat label="Esperado a esta hora" value={g.expectedNow === null ? "—" : fmtCurrency(g.expectedNow)} sub={g.pace === null ? "Sin curva histórica" : <PaceChip pace={g.paceLabel} value={g.pace} />} />
      <Stat label="Sin gasto hoy" value={`${g.idle}`} sub={g.idle ? `${fmtCurrency(g.idleBudget)} de presupuesto sin entregar` : "Todas las campañas ya gastan"} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-foreground/[0.03] px-4 py-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="tabular text-lg leading-tight font-semibold">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function PaceChip({ pace, value }: { pace: Pace; value: number | null }) {
  const m = PACE[pace];
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-semibold whitespace-nowrap", m.chip)}>
      {m.label}
      {value !== null && ` · ${fmtPercent(value, 0)}`}
    </span>
  );
}

function Insights({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Lectura del presupuesto" className="rounded-xl bg-foreground/[0.03] px-4 py-3">
      <h4 className="mb-1.5 text-[13px] font-semibold">Lectura</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((i, n) => {
          const m = INSIGHT[i.tone];
          return (
            <li key={n} className="flex items-start gap-2 text-[13px]">
              <m.Icon className={cn("mt-0.5 size-4 shrink-0", m.tone)} aria-hidden />
              <span className="text-pretty">{i.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Bars({ title, groups, marks }: { title: string; groups: BudgetGroup[]; marks?: Parameters<typeof PlatformMark>[0]["platform"][] }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="flex h-2 w-5 overflow-hidden rounded-full" aria-hidden>
              <span className="flex-1 bg-status-normal" />
              <span className="flex-1 bg-status-attention" />
              <span className="flex-1 bg-status-alert" />
            </span>
            Gastado hoy, color según ritmo
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-0.5 rounded-full bg-foreground/60" aria-hidden /> Esperado a esta hora
          </span>
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-(--hairline)">
        {groups.map((g, i) => (
          <BarRow key={g.label} group={g} mark={marks?.[i]} />
        ))}
      </ul>
    </section>
  );
}

function BarRow({ group: g, mark }: { group: BudgetGroup; mark?: Parameters<typeof PlatformMark>[0]["platform"] }) {
  const used = g.usedPct === null ? 0 : Math.min(1, g.usedPct);
  const expected = g.expectedNow !== null && g.total > 0 ? Math.min(1, g.expectedNow / g.total) : null;
  const m = PACE[g.paceLabel];
  const label = `${g.label}: ${fmtCurrency(g.spend)} gastado de ${fmtCurrency(g.total)} de presupuesto diario${g.pace !== null ? `, ${fmtPercent(g.pace, 0)} de lo esperado a esta hora` : ""}`;
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        {mark && <PlatformMark platform={mark} className="size-5 text-[9px]" />}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{g.label}</p>
          <p className="tabular truncate text-[11px] text-muted-foreground">
            {fmtCurrency(g.total)} · {fmtPercent(g.share, 0)} · {g.campaigns} {g.campaigns === 1 ? "campaña" : "campañas"}
            {g.estimated > 0 && " · con estimado"}
          </p>
        </div>
      </div>
      <div className="relative h-2.5 rounded-full bg-foreground/[0.06]" role="img" aria-label={label}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", m.bar)} style={{ width: `${Math.max(used > 0 ? 1.5 : 0, used * 100)}%` }} />
        {expected !== null && <span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/60" style={{ left: `${expected * 100}%` }} aria-hidden />}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <span className="tabular text-[12px] text-muted-foreground">{fmtCurrency(g.spend)}</span>
        <PaceChip pace={g.paceLabel} value={g.pace} />
      </div>
    </li>
  );
}
