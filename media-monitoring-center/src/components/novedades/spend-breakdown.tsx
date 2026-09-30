import type { BreakdownKind, SpendBreakdown } from "@/lib/monitoring/types";
import type { Alert } from "@/lib/alerts/types";
import type { NovedadKind } from "@/lib/records/novedad-model";
import { cn } from "@/lib/utils";
import type { NovedadPrefill } from "./novedad-form";

const KIND_LABEL: Record<BreakdownKind, string> = { paused: "Pausada", stopped: "Sin gasto", down: "Bajó", up: "Subió", new: "Nueva", steady: "Normal" };
const GROUP_LABEL: Record<BreakdownKind, string> = {
  paused: "Pausadas en la plataforma",
  stopped: "Dejaron de gastar",
  down: "Activas que bajaron",
  up: "Activas que subieron",
  new: "Campañas nuevas",
  steady: "Activas sin cambio",
};
const ORDER: BreakdownKind[] = ["paused", "stopped", "down", "up", "new", "steady"];
const money = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(Math.round(v)).toLocaleString("es-MX")}`;
const plain = (v: number) => `$${Math.round(v).toLocaleString("es-MX")}`;

/**
 * ¿Qué pasó? Cómo se reparte la diferencia entre el gasto esperado y el actual: campañas apagadas,
 * las que bajaron o subieron y las nuevas. Una barra por grupo, proporcional a su aporte.
 */
export function SpendBreakdownView({ breakdown: b }: { breakdown: SpendBreakdown }) {
  const rows = ORDER.map((k) => ({ k, g: b.groups[k], delta: b.groups[k].current - b.groups[k].expected })).filter((r) => r.g.count > 0 && Math.abs(r.delta) >= 1);
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-[13px] font-semibold">¿Qué pasó?</p>
        <p className="text-[13px] leading-snug">{b.summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {b.window === "recent" ? "Últimas horas" : "Acumulado del día"}: {plain(b.current)} de {plain(b.expected)} esperados en {b.campaigns} campañas.
        </p>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1.5" aria-label="Aporte de cada grupo a la diferencia de gasto">
          {rows.map(({ k, g, delta }) => (
            <li key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">
                {GROUP_LABEL[k]} <span className="tabular">({g.count})</span>
              </span>
              <span className="relative h-2 rounded-full bg-foreground/[0.05]" aria-hidden>
                <span className={cn("absolute inset-y-0 left-0 rounded-full", delta < 0 ? "bg-foreground/45" : "bg-primary/70")} style={{ width: `${Math.max(3, (Math.abs(delta) / scale) * 100)}%` }} />
              </span>
              <span className="tabular text-right font-medium">{money(delta)}</span>
            </li>
          ))}
        </ul>
      )}
      {b.top.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Campañas que más movieron el gasto</p>
          <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.03]">
            {b.top.map((t) => (
              <li key={t.campaignId} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-[2px] text-[10px] font-semibold",
                    t.kind === "paused" || t.kind === "stopped" ? "bg-foreground/[0.08] text-foreground" : t.kind === "new" || t.kind === "up" ? "bg-primary/12 text-primary" : "bg-foreground/[0.05] text-muted-foreground",
                  )}
                >
                  {KIND_LABEL[t.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate" title={t.statusText ? `${t.campaignName} · ${t.statusText}` : t.campaignName}>
                  {t.campaignName}
                </span>
                <span className="shrink-0 tabular text-muted-foreground">
                  {plain(t.current)} / {plain(t.expected)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Datos para registrar una alerta como novedad aprobada (alcance fijo, cambio esperado = el de hoy). */
export function novedadPrefillFromAlert(a: Pick<Alert, "title" | "platform" | "accountId" | "accountName" | "campaignId" | "campaignName" | "deviation" | "fingerprint" | "family" | "type" | "breakdown">, incidentId: string | null): NovedadPrefill {
  const v = a.breakdown?.verdict;
  const kind: NovedadKind = a.type === "OVERSPEND" ? (v === "launch" ? "ACTIVACION" : "PRESUPUESTO") : v === "rotation" ? "ESTRATEGIA" : a.family === "delivery" ? "PAUSA" : "OTRO";
  return {
    kind,
    title: a.title,
    platform: a.platform,
    accountId: a.accountId,
    accountName: a.accountName,
    campaignId: a.campaignId,
    campaignName: a.campaignName,
    expectedChange: a.deviation,
    includesFullStop: v === "mass_stop",
    incidentId,
    alertFingerprint: a.fingerprint,
  };
}
