"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TestConnectionButton({ target, enabled }: { target: "bigquery" | "sheets" | "n8n"; enabled: boolean }) {
  const [state, setState] = useState<{ ok: boolean; message: string; technical?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
      setState(await res.json());
    } catch {
      setState({ ok: false, message: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5">
      <Button size="xs" variant="outline" onClick={run} disabled={!enabled || busy}>
        {busy ? "Probando…" : "Probar conexión"}
      </Button>
      {state && (
        <div className={cn("text-[11px]", state.ok ? "text-status-normal-text" : "text-status-critical-text")}>
          {state.message}
          {state.technical && (
            <>
              {" "}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)}>
                {open ? "Ocultar detalles técnicos" : "Ver detalles técnicos"}
              </button>
              {open && <pre className="mt-1 max-h-28 overflow-auto rounded border bg-muted p-1.5 font-mono whitespace-pre-wrap text-muted-foreground">{state.technical}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
