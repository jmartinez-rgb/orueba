import Link from "next/link";
import type { PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import type { PlatformCardVM } from "@/lib/services/view-models";
import { cn } from "@/lib/utils";
import { DATA_STATE_META, isBadDataState, PlatformStatusBadge, SEVERITY_META, StatusDot } from "./status";

const ORDER: Severity[] = ["CRITICAL", "ALERT", "ATTENTION", "NORMAL"];

/** Responde en segundos: ¿está todo izzi funcionando correctamente en este momento? */
export function StatusHero({ overall, cards, openIncidents, activeAlerts }: { overall: Severity; cards: Record<PlatformId, PlatformCardVM>; openIncidents: number; activeAlerts: number }) {
  const m = SEVERITY_META[overall];
  const Icon = m.Icon;
  const problems = PLATFORM_IDS.filter((p) => cards[p].severity !== "NORMAL" || isBadDataState(cards[p].dataState)).sort(
    (a, b) => ORDER.indexOf(cards[a].severity) - ORDER.indexOf(cards[b].severity),
  );
  const counts = ORDER.map((s) => ({ s, n: PLATFORM_IDS.filter((p) => cards[p].severity === s && !isBadDataState(cards[p].dataState)).length }));
  const delayed = PLATFORM_IDS.filter((p) => isBadDataState(cards[p].dataState)).length;
  const answer =
    overall === "NORMAL" && delayed === 0
      ? "Sí. Todas las plataformas operan dentro de parámetros."
      : overall === "NORMAL"
        ? "Rendimiento normal, pero hay fuentes con datos atrasados."
        : `No. ${problems.length} plataforma${problems.length === 1 ? "" : "s"} requiere${problems.length === 1 ? "" : "n"} atención.`;
  return (
    <section className={cn("grid min-w-0 gap-3 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(260px,340px)_1fr]", m.border)} aria-label="Estado general de medios">
      <div className={cn("flex items-center gap-3 rounded-md p-3", m.tint)}>
        <Icon className={cn("size-10 shrink-0", m.text)} aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Estado general de medios</p>
          <p className={cn("text-3xl leading-none font-extrabold tracking-tight", m.text)}>{m.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{answer}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {counts.map(({ s, n }) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1">
              <StatusDot severity={s} />
              <span className="tabular font-semibold">{n}</span>
              <span className="text-muted-foreground">{SEVERITY_META[s].label.toLowerCase()}</span>
            </span>
          ))}
          {delayed > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-status-data/50 px-2 py-1 text-status-data-text">
              <span className="tabular font-semibold">{delayed}</span> con datos atrasados
            </span>
          )}
          <span className="ml-auto flex gap-3 text-muted-foreground">
            <Link href="/incidents" className="hover:text-foreground">
              <span className="tabular font-semibold text-foreground">{openIncidents}</span> incidentes abiertos
            </Link>
            <Link href="/alerts" className="hover:text-foreground">
              <span className="tabular font-semibold text-foreground">{activeAlerts}</span> alertas activas
            </Link>
          </span>
        </div>
        {problems.length > 0 ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {problems.map((p) => {
              const c = cards[p];
              const bad = isBadDataState(c.dataState);
              return (
                <li key={p} className="min-w-0">
                  <Link href={`/platforms/${p}`} className="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
                    <PlatformStatusBadge severity={c.severity} dataState={c.dataState} />
                    <span className="shrink-0 font-semibold">{PLATFORMS[p].shortName}</span>
                    <span className="truncate text-muted-foreground">{bad ? (c.dataReason ?? DATA_STATE_META[c.dataState].label) : (c.topIssue?.title ?? "")}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sin plataformas con problemas en la última evaluación.</p>
        )}
      </div>
    </section>
  );
}
