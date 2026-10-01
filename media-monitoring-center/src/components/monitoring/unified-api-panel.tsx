import { CircleCheck, CircleDashed, CircleX, KeyRound, ShieldAlert, TriangleAlert, Wrench } from "lucide-react";
import type { UnifiedState, UnifiedStatus } from "@/lib/integrations/unified-api";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TestConnectionButton } from "./test-connection";

const STATE: Record<UnifiedState, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  connected: { label: "Conectada", tone: "bg-status-normal/12 text-status-normal-text", Icon: CircleCheck },
  degraded: { label: "Degradada", tone: "bg-status-attention/16 text-status-attention-text", Icon: TriangleAlert },
  access_required: { label: "Requiere aprobación", tone: "bg-status-attention/16 text-status-attention-text", Icon: KeyRound },
  permission_denied: { label: "Sin permiso", tone: "bg-status-alert/14 text-status-alert-text", Icon: ShieldAlert },
  error: { label: "Error", tone: "bg-status-critical/12 text-status-critical-text", Icon: CircleX },
  not_configured: { label: "Sin credenciales", tone: "bg-foreground/[0.06] text-muted-foreground", Icon: CircleDashed },
  not_implemented: { label: "Pendiente de integrar", tone: "bg-foreground/[0.06] text-muted-foreground", Icon: Wrench },
};

/** Estado de conexión directa de cada plataforma según la API unificada (sin secretos). */
export function UnifiedApiPanel({ status, timezone, canTest }: { status: UnifiedStatus; timezone: string; canTest: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        {!status.ok ? (
          <div className="flex flex-col gap-1 text-[13px]">
            <p className="font-medium">{status.configured ? "La API unificada no está disponible" : "API unificada sin configurar"}</p>
            <p className="text-muted-foreground">{status.reason}</p>
            {!status.configured && (
              <p className="text-xs text-muted-foreground">
                La API unificada (carpeta <code>unified-ads-api</code>) conecta directo con Google Ads, Meta, TikTok, Microsoft, Spotify y X Ads. Define su URL y una llave interna en las variables privadas del monitoreo para ver aquí el estado de cada conexión.
              </p>
            )}
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {status.providers.map((p) => {
              // Una plataforma sin integración programada es "pendiente" aunque también le falten credenciales.
              const s = STATE[p.implemented ? p.status.state : "not_implemented"];
              return (
                <li key={p.id} className="flex flex-col gap-1.5 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-(--hairline)">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>
                      <s.Icon className="size-3" aria-hidden /> {s.label}
                    </span>
                  </div>
                  {p.status.last_error && p.status.state !== "connected" && <p className="text-xs text-muted-foreground">{p.status.last_error.message}</p>}
                  {p.implemented && p.status.missing_config.length > 0 && <p className="text-xs text-muted-foreground">Falta: {p.status.missing_config.join(", ")}</p>}
                  <p className="text-[11px] text-muted-foreground tabular">
                    {p.status.last_successful_sync ? `Última lectura correcta: ${formatDateTimeInTz(p.status.last_successful_sync, timezone)}` : "Sin lecturas correctas registradas"}
                    {p.status.latency_ms !== null && p.status.state === "connected" ? ` · ${p.status.latency_ms} ms` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Consultado: {formatDateTimeInTz(status.checkedAt, timezone)} · se actualiza cada minuto. La llave nunca sale del servidor.</p>
          <TestConnectionButton target="unified" enabled={canTest} />
        </div>
      </CardContent>
    </Card>
  );
}
