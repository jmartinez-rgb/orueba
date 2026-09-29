"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { sileo } from "sileo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** ACTUALIZAR AHORA: vuelve a consultar los datos (y dispara la sincronización en n8n si está configurada). */
export function RefreshButton({ canTrigger, size = "sm", compact }: { canTrigger: boolean; size?: "sm" | "default"; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await sileo.promise(
        (async () => {
          const res = await fetch("/api/monitoring/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "manual" }) });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
          if (!res.ok || !data.ok) throw new Error(data.message ?? "No se pudo actualizar");
          startTransition(() => router.refresh());
          return data.message ?? "Evaluación actualizada";
        })(),
        {
          loading: { title: "Actualizando monitoreo…" },
          success: (message) => ({ title: "Monitoreo actualizado", description: String(message) }),
          error: (err) => ({ title: "No se pudo actualizar", description: err instanceof Error ? err.message : "No se pudo contactar al servidor." }),
        },
      );
    } catch {
      /* el toast ya muestra el error */
    } finally {
      setBusy(false);
    }
  }

  const spinning = busy || pending;
  return (
    <Button variant="secondary" size={size} className="rounded-full" onClick={run} aria-label="Actualizar ahora" disabled={!canTrigger || spinning} title={canTrigger ? "Consultar de nuevo y disparar la sincronización" : "Tu rol no puede disparar evaluaciones"}>
      <RefreshCw className={cn("text-primary", spinning && "animate-spin")} />
      {!compact && <span className="hidden sm:inline">{spinning ? "Actualizando…" : "Actualizar"}</span>}
    </Button>
  );
}
