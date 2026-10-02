import { CircleAlert, CircleCheck, HeartPulse, Info, OctagonAlert } from "lucide-react";
import type { DeliveryView, HealthItem, HealthSeverity } from "@/lib/services/delivery-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformMark } from "@/components/monitoring/status";
import { cn } from "@/lib/utils";

export type DeliveryPanelState = { kind: "ready"; view: DeliveryView; demo: boolean } | { kind: "unavailable"; reason: string; configured: boolean };

const SEV: Record<HealthSeverity, { label: string; chip: string; Icon: typeof Info; tone: string }> = {
  critical: { label: "Críticas", chip: "bg-status-alert/12 text-status-alert-text", Icon: OctagonAlert, tone: "text-status-alert-text" },
  warning: { label: "Advertencias", chip: "bg-status-attention/14 text-status-attention-text", Icon: CircleAlert, tone: "text-status-attention-text" },
  info: { label: "Contexto", chip: "bg-foreground/[0.06] text-muted-foreground", Icon: Info, tone: "text-muted-foreground" },
};

/**
 * Salud de entrega que reporta cada plataforma: cuentas con problemas, campañas que no entregan,
 * limitadas por presupuesto, puja o políticas, y aprendizaje. Solo lectura.
 */
export function DeliveryHealthPanel({ state }: { state: DeliveryPanelState }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <HeartPulse className="size-4 text-muted-foreground" aria-hidden />
            Salud de entrega en las plataformas
            {state.kind === "ready" && state.demo && <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Datos de demostración</span>}
          </CardTitle>
          <CardDescription>
            Lo que Meta, Google y Microsoft reportan hoy: cuentas con problemas de pago o tope de gasto, campañas que no entregan, limitadas por presupuesto, puja o políticas, y aprendizaje. Lectura cada 5 minutos desde la API
            unificada.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {state.kind === "unavailable" ? (
          <div className="flex items-start gap-3 rounded-xl bg-foreground/[0.03] px-4 py-3 text-[13px]">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">{state.configured ? "No se pudo leer la salud de entrega" : "Conecta la API unificada para ver la salud de entrega"}</p>
              <p className="mt-0.5 text-muted-foreground">{state.reason}</p>
            </div>
          </div>
        ) : (
          <Ready view={state.view} />
        )}
      </CardContent>
    </Card>
  );
}

function Ready({ view }: { view: DeliveryView }) {
  const critical = view.items.filter((i) => i.severity === "critical");
  const warnings = view.items.filter((i) => i.severity === "warning");
  const context = view.items.filter((i) => i.severity === "info");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["critical", "warning", "info"] as const).map((s) => (
          <span key={s} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", SEV[s].chip)}>
            {view.counts[s]} {SEV[s].label.toLowerCase()}
          </span>
        ))}
        <span className="mx-1 h-4 w-px bg-(--hairline)" aria-hidden />
        {view.byPlatform.map((p) => (
          <span key={p.platform} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <PlatformMark platform={p.platform} className="size-4 rounded-[5px] text-[8px]" />
            {p.name}: {p.counts.critical + p.counts.warning}
          </span>
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {view.insights.map((i, n) => {
          const Icon = i.tone === "good" ? CircleCheck : i.tone === "warn" ? CircleAlert : Info;
          return (
            <li key={n} className="flex items-start gap-2 text-[13px]">
              <Icon className={cn("mt-0.5 size-4 shrink-0", i.tone === "good" ? "text-status-normal-text" : i.tone === "warn" ? "text-status-attention-text" : "text-muted-foreground")} aria-hidden />
              <span className="text-pretty">{i.text}</span>
            </li>
          );
        })}
      </ul>

      {critical.length > 0 && <Items items={critical} />}
      {warnings.length > 0 && (
        <details className="rounded-xl border border-status-attention/20 bg-status-attention/[0.04] px-4 py-2">
          <summary className="min-h-9 cursor-pointer rounded py-2 text-[13px] font-medium text-status-attention-text outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            Ver {warnings.length} {warnings.length === 1 ? "advertencia de entrega" : "advertencias de entrega"}
          </summary>
          <div className="mt-2"><Items items={warnings} /></div>
        </details>
      )}
      {context.length > 0 && (
        <details className="group rounded-xl bg-foreground/[0.03] px-4 py-2.5">
          <summary className="min-h-9 cursor-pointer rounded py-2 text-[13px] font-medium text-muted-foreground outline-none marker:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            {context.length} {context.length === 1 ? "señal de contexto" : "señales de contexto"} (aprendizaje, pendientes, topes con margen)
          </summary>
          <div className="mt-2">
            <Items items={context} />
          </div>
        </details>
      )}
    </div>
  );
}

function Items({ items }: { items: HealthItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-(--hairline)">
      {items.map((i) => {
        const m = SEV[i.severity];
        return (
          <li key={i.key} className="flex items-start gap-3 py-2">
            <m.Icon className={cn("mt-0.5 size-4 shrink-0", m.tone)} aria-label={m.label} />
            <PlatformMark platform={i.platform} className="mt-px size-5 text-[9px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px]">
                <span className="font-medium">{i.title}</span>
                <span className="text-muted-foreground"> · {i.entity}</span>
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground" title={i.detail ?? undefined}>
                {i.detail ? `${i.detail} · ` : ""}
                {i.account}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
