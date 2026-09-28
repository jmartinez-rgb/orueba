"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** ACTUALIZAR AHORA: dispara el workflow de sincronización/monitoreo (n8n) y recalcula la vista. */
export function RefreshButton({ canTrigger, size = "sm", compact }: { canTrigger: boolean; size?: "sm" | "default"; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/monitoring/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "manual" }) });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setMsg({ ok: res.ok && data.ok, text: data.message ?? (res.ok ? "Evaluación actualizada" : "No se pudo actualizar") });
      startTransition(() => router.refresh());
    } catch {
      setMsg({ ok: false, text: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  const spinning = busy || pending;
  return (
    <div className="relative flex items-center">
      <Button size={size} onClick={run} aria-label="Actualizar ahora" disabled={!canTrigger || spinning} title={canTrigger ? "Consultar de nuevo y disparar el workflow de monitoreo" : "Tu rol no puede disparar evaluaciones"}>
        <RefreshCw className={cn(spinning && "animate-spin")} />
        {!compact && <span className="hidden sm:inline">{spinning ? "Actualizando…" : "Actualizar ahora"}</span>}
      </Button>
      {msg && (
        <div role="status" className={cn("absolute top-full right-0 z-50 mt-2 w-72 rounded-md border bg-popover p-2.5 text-xs shadow-lg", msg.ok ? "text-foreground" : "text-status-critical-text")}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
