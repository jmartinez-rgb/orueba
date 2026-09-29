"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { CampaignObjective, PlatformId } from "@/lib/types";
import { CAMPAIGN_OBJECTIVES, PLATFORM_IDS } from "@/lib/types";
import type { CampaignRowVM } from "@/lib/services/view-models";
import { PLATFORMS } from "@/lib/platforms/registry";
import { OBJECTIVE_LABEL } from "@/lib/metrics";
import { fmtCurrency, fmtMetric } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataStateBadge, DeltaText, isBadDataState, PlatformMark, SeverityBadge } from "./status";
import { StateMessage } from "./states";

export type CampaignSort = "drop" | "increase" | "spend" | "deviation" | "cpa" | "impact";

const SORTS: Record<CampaignSort, string> = {
  impact: "Mayor impacto",
  drop: "Mayor caída",
  increase: "Mayor incremento",
  spend: "Mayor gasto",
  deviation: "Mayor desviación",
  cpa: "Mayor CPA",
};

function sortRows(rows: CampaignRowVM[], sort: CampaignSort): CampaignRowVM[] {
  const v = (x: number | null, fallback: number) => (x === null || !Number.isFinite(x) ? fallback : x);
  const copy = [...rows];
  switch (sort) {
    case "drop":
      return copy.sort((a, b) => v(a.deviation, 99) - v(b.deviation, 99));
    case "increase":
      return copy.sort((a, b) => v(b.deviation, -99) - v(a.deviation, -99));
    case "spend":
      return copy.sort((a, b) => v(b.spend, -1) - v(a.spend, -1));
    case "deviation":
      return copy.sort((a, b) => Math.abs(v(b.deviation, 0)) - Math.abs(v(a.deviation, 0)));
    case "cpa":
      return copy.sort((a, b) => v(b.costDeviation, -99) - v(a.costDeviation, -99));
    default:
      return copy.sort((a, b) => b.impact - a.impact);
  }
}

const PAGE = 25;

export function CampaignsTable({
  rows,
  attention = 0.15,
  fixedPlatform,
  initialSort = "impact",
  weeks,
}: {
  rows: CampaignRowVM[];
  attention?: number;
  fixedPlatform?: PlatformId;
  initialSort?: CampaignSort;
  weeks: number;
}) {
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<"all" | PlatformId>(fixedPlatform ?? "all");
  const [objective, setObjective] = useState<"all" | CampaignObjective>("all");
  const [status, setStatus] = useState<"ACTIVE" | "all" | "PAUSED">("ACTIVE");
  const [alert, setAlert] = useState<"all" | "with" | "without">("all");
  const [sort, setSort] = useState<CampaignSort>(initialSort);
  // Se muestran por páginas: dibujar cientos de filas de golpe hace lenta la página. Al cambiar un filtro vuelve a la primera.
  const signature = [q, platform, objective, status, alert, sort].join("|");
  const [page, setPage] = useState({ signature, shown: PAGE });
  const shown = page.signature === signature ? page.shown : PAGE;

  const filtered = useMemo(() => {
    let l = rows;
    if (platform !== "all") l = l.filter((r) => r.platform === platform);
    if (objective !== "all") l = l.filter((r) => r.objective === objective);
    if (status === "ACTIVE") l = l.filter((r) => r.status === "ACTIVE");
    else if (status === "PAUSED") l = l.filter((r) => r.status !== "ACTIVE");
    if (alert === "with") l = l.filter((r) => r.alertSeverity !== null);
    else if (alert === "without") l = l.filter((r) => r.alertSeverity === null);
    if (q.trim()) {
      const t = q.toLowerCase();
      l = l.filter((r) => [r.name, r.accountName, r.id].some((x) => x.toLowerCase().includes(t)));
    }
    return sortRows(l, sort);
  }, [rows, platform, objective, status, alert, q, sort]);

  const totals = useMemo(() => {
    const spend = filtered.reduce((a, r) => a + (r.spend ?? 0), 0);
    const expected = filtered.reduce((a, r) => a + (r.expected ?? 0), 0);
    return { spend, expected, deviation: expected > 0 ? (spend - expected) / expected : null };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campaña o cuenta…" className="h-8 pl-8 text-xs" aria-label="Buscar campaña" />
        </div>
        {!fixedPlatform && (
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
        )}
        <Select value={objective} onValueChange={(v) => setObjective(v as typeof objective)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Objetivo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo objetivo</SelectItem>
            {CAMPAIGN_OBJECTIVES.map((o) => (
              <SelectItem key={o} value={o}>
                {OBJECTIVE_LABEL[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger size="sm" className="w-32" aria-label="Estado de campaña">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Activas</SelectItem>
            <SelectItem value="PAUSED">Pausadas / fin</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={alert} onValueChange={(v) => setAlert(v as typeof alert)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Alertas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Con y sin alerta</SelectItem>
            <SelectItem value="with">Con alerta</SelectItem>
            <SelectItem value="without">Sin alerta</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ordenar</span>
          <Select value={sort} onValueChange={(v) => setSort(v as CampaignSort)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORTS) as CampaignSort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORTS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>
          <span className="tabular font-semibold text-foreground">{filtered.length}</span> campañas
        </span>
        <span>
          Gasto <span className="tabular font-semibold text-foreground">{fmtCurrency(totals.spend)}</span> vs esperado{" "}
          <span className="tabular font-semibold text-foreground">{fmtCurrency(totals.expected)}</span> <DeltaText value={totals.deviation} attention={attention} />
        </span>
      </div>
      {filtered.length === 0 ? (
        <StateMessage kind="empty" title="Sin campañas con estos filtros" compact />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Campaña</TableHead>
              <TableHead>Cuenta</TableHead>
              {!fixedPlatform && <TableHead>Plataforma</TableHead>}
              <TableHead>Objetivo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead className="text-right">Desv.</TableHead>
              <TableHead className="text-right">Resultados</TableHead>
              <TableHead className="text-right">CPA / CPL</TableHead>
              <TableHead className="text-right" title={`Resultados vs promedio ${weeks} semanas`}>
                Desv. histórica
              </TableHead>
              <TableHead>Alerta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, shown).map((r) => {
              const bad = isBadDataState(r.dataState);
              return (
                <TableRow key={r.id} className={cn(r.status !== "ACTIVE" && "opacity-60")}>
                  <TableCell className="max-w-[300px]">
                    <p className="truncate text-xs font-medium" title={r.name}>
                      {r.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.id}
                      {r.share !== null && ` · ${(r.share * 100).toFixed(1)}% del gasto esperado`}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-36 truncate text-xs text-muted-foreground">{r.accountName}</TableCell>
                  {!fixedPlatform && (
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <PlatformMark platform={r.platform} className="size-5 text-[9px]" />
                        <span className="text-xs">{PLATFORMS[r.platform].shortName}</span>
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-xs">{OBJECTIVE_LABEL[r.objective]}</TableCell>
                  <TableCell className="text-xs">{bad ? <DataStateBadge state={r.dataState} /> : r.status === "ACTIVE" ? "Activa" : r.status === "PAUSED" ? "Pausada" : "Finalizada"}</TableCell>
                  <TableCell className="text-right text-xs font-medium">{bad ? "—" : fmtCurrency(r.spend)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{fmtCurrency(r.expected)}</TableCell>
                  <TableCell className="text-right text-xs">
                    <DeltaText value={bad ? null : r.deviation} attention={attention} />
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="font-medium">{bad ? "—" : fmtMetric(r.resultMetric, r.results, { compact: true })}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {r.resultLabel}
                      {r.resultLagging && " · con retraso"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="font-medium">{bad ? "—" : fmtMetric("cpr", r.cost)}</span> <DeltaText value={bad ? null : r.costDeviation} bad={r.resultLagging ? "none" : "up"} attention={attention} className="text-[11px]" />
                    <span className="block text-[10px] text-muted-foreground">{r.costLabel}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <DeltaText value={bad ? null : r.histDeviation} bad={r.resultLagging ? "none" : "down"} attention={attention} />
                  </TableCell>
                  <TableCell>
                    {r.alertSeverity ? (
                      <Link href="/alerts" className="flex flex-col items-start gap-0.5" title={r.grouped ? "Agrupada bajo el incidente de su plataforma" : undefined}>
                        <SeverityBadge severity={r.alertSeverity} />
                        <span className="text-[10px] text-muted-foreground">
                          {r.alertType}
                          {r.grouped ? " · agrupada" : ""}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {filtered.length > shown && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button variant="secondary" size="sm" className="rounded-full" onClick={() => setPage({ signature, shown: shown + PAGE })}>
            Mostrar {Math.min(PAGE, filtered.length - shown)} más
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => setPage({ signature, shown: filtered.length })}>
            Ver las {filtered.length}
          </Button>
        </div>
      )}
    </div>
  );
}
