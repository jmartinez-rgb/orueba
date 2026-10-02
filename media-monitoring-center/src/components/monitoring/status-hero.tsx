import Link from "next/link";
import { ChevronRight, Database, ShieldCheck } from "lucide-react";
import type { PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import type { PlatformCardVM } from "@/lib/services/view-models";
import { cn } from "@/lib/utils";
import { DATA_STATE_META, isBadDataState, PlatformMark, PlatformStatusBadge, SEVERITY_META, SeverityBadge, StatusDot } from "./status";

const ORDER: Severity[] = ["CRITICAL", "ALERT", "ATTENTION", "NORMAL"];

const PLURAL: Record<Severity, [string, string]> = {
  CRITICAL: ["crítica", "críticas"],
  ALERT: ["alerta", "alertas"],
  ATTENTION: ["en atención", "en atención"],
  NORMAL: ["normal", "normales"],
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Responde en segundos: ¿está todo funcionando en este momento? Si no, ¿qué y dónde? */
export function StatusHero({ overall, cards, openIncidents, activeAlerts }: { overall: Severity; cards: Record<PlatformId, PlatformCardVM>; openIncidents: number; activeAlerts: number }) {
  const m = SEVERITY_META[overall];
  const Icon = m.Icon;
  const ids = PLATFORM_IDS.filter((p) => cards[p]);
  const problems = ids
    .filter((p) => cards[p].severity !== "NORMAL" || isBadDataState(cards[p].dataState))
    .sort((a, b) => ORDER.indexOf(cards[a].severity) - ORDER.indexOf(cards[b].severity));
  const counts = ORDER.map((s) => ({ s, n: ids.filter((p) => cards[p].severity === s && !isBadDataState(cards[p].dataState)).length }));
  const delayed = ids.filter((p) => isBadDataState(cards[p].dataState)).length;
  const evaluated = ids.length - delayed;
  const noPlatforms = ids.length === 0;
  const onlyDataIssues = problems.length > 0 && problems.every(p => isBadDataState(cards[p].dataState));
  const names = problems.map((p) => PLATFORMS[p].shortName);
  const headline =
    noPlatforms ? "Sin plataformas para evaluar" : onlyDataIssues ? "Datos pendientes de evaluación" : problems.length === 0 ? "Todo en orden" : overall === "NORMAL" ? "Rendimiento normal" : `${joinNames(names)} ${problems.length === 1 ? "requiere" : "requieren"} atención`;
  const detail =
    noPlatforms ? "No hay plataformas disponibles en la marca seleccionada." : onlyDataIssues ? "Revisa la frescura de las fuentes antes de interpretar el rendimiento. Un dato ausente no significa gasto cero." : problems.length === 0
      ? "Todas las plataformas operan dentro de lo esperado para esta hora."
      : overall === "NORMAL"
        ? "Hay fuentes con datos atrasados: no se evalúan hasta que lleguen."
        : `${problems.length} de ${ids.length} plataformas fuera de lo esperado para esta hora.`;

  return (
    <section className="surface relative grid min-w-0 gap-5 overflow-hidden border border-(--hairline) p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8 lg:p-6" aria-label="Estado general de medios">
      <div className="flex min-w-0 items-start gap-4">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", noPlatforms || onlyDataIssues ? "bg-status-data/12" : m.tint)} aria-hidden>
          {noPlatforms || onlyDataIssues ? <Database className="size-6 text-status-data-text" /> : <Icon className={cn("size-6", m.text)} strokeWidth={2.1} />}
        </span>
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Estado del monitoreo</p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.022em]">{headline}</h2>
            {noPlatforms || (onlyDataIssues && overall === "NORMAL") ? <span className="rounded-full bg-status-data/15 px-2.5 py-1 text-xs font-semibold text-status-data-text">Evaluación pendiente</span> : <SeverityBadge severity={overall} size="md" />}
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{detail}</p>
          {!noPlatforms && <div className="mt-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {counts.filter(c => c.n > 0).map(({ s, n }) => <span key={s} className={SEVERITY_META[s].dot} style={{ width: `${n / ids.length * 100}%` }} />)}
              {delayed > 0 && <span className="bg-status-data/60" style={{ width: `${delayed / ids.length * 100}%` }} />}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden />{evaluated} de {ids.length} plataformas con rendimiento evaluable</p>
          </div>}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" aria-label="Plataformas por estado">
            {counts.map(({ s, n }) => (
              <li key={s} className={cn("inline-flex items-center gap-1.5", n === 0 && "text-muted-foreground")}>
                <StatusDot severity={s} className="size-2" />
                <span className="tabular font-semibold">{n}</span>
                <span className="text-muted-foreground">{PLURAL[s][n === 1 ? 0 : 1]}</span>
              </li>
            ))}
            {delayed > 0 && (
              <li className="inline-flex items-center gap-1.5 text-status-data-text">
                <span className="size-2 rounded-full bg-status-data" aria-hidden />
                <span className="tabular font-semibold">{delayed}</span> sin datos evaluables
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {problems.length > 0 ? (
          <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.03]">
            {problems.map((p) => {
              const c = cards[p];
              const bad = isBadDataState(c.dataState);
              return (
                <li key={p}>
                  <Link href={`/platforms/${p}`} className="group flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3 transition-colors duration-150 hover:bg-foreground/[0.04] sm:flex-nowrap">
                    <PlatformMark platform={p} />
                    <span className="shrink-0 text-[13px] font-semibold">{PLATFORMS[p].shortName}</span>
                    <span className="order-3 w-full min-w-0 text-[13px] text-muted-foreground sm:order-none sm:w-auto sm:flex-1 sm:truncate">{bad ? (c.dataReason ?? DATA_STATE_META[c.dataState].label) : (c.topIssue?.title ?? "")}</span>
                    <PlatformStatusBadge severity={c.severity} dataState={c.dataState} />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl bg-foreground/[0.03] px-4 py-3 text-[13px] text-muted-foreground">Sin plataformas con problemas en la última evaluación.</p>
        )}
        <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[13px]">
          <Link href="/incidents" className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <span className="tabular font-semibold text-foreground">{openIncidents}</span> {openIncidents === 1 ? "incidente abierto" : "incidentes abiertos"}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
          <Link href="/alerts" className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <span className="tabular font-semibold text-foreground">{activeAlerts}</span> {activeAlerts === 1 ? "alerta activa" : "alertas activas"}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
