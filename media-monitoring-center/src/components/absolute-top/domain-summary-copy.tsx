"use client";
import { useId, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildAbsoluteTopDomainText } from "@/lib/absolute-top/domain-format";
import type { AbsoluteTopDomainSummary, AbsoluteTopEvaluation } from "@/lib/absolute-top/types";

export function DomainSummaryCopy({ summary, rows }: { summary: AbsoluteTopDomainSummary; rows: AbsoluteTopEvaluation[] }) {
  const message = buildAbsoluteTopDomainText(summary, rows);
  const [outcome, setOutcome] = useState<{ message: string; state: "copied" | "manual" } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const state = outcome?.message === message ? outcome.state : "idle";
  return <div className="min-w-0 space-y-2 border-t border-(--hairline) pt-3">
    <Button variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal" aria-label={`Copiar resumen de ${summary.domain_name}`} aria-controls={textId} onClick={async () => {
      try { await navigator.clipboard.writeText(message); setOutcome({ message, state: "copied" }); }
      catch {
        setOutcome({ message, state: "manual" }); setExpanded(true);
        requestAnimationFrame(() => { textRef.current?.focus(); textRef.current?.select(); });
      }
    }}><Copy aria-hidden />Copiar resumen</Button>
    <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">{state === "copied" ? "Resumen copiado. El envío queda a tu criterio." : state === "manual" ? "El navegador no permitió copiar. Selecciona el resumen manual." : "Resumen del dominio completo para revisión y copia manual; no se envía desde aquí."}</p>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="min-w-0">
      <summary aria-label={`Ver resumen manual de ${summary.domain_name}`} className="cursor-pointer rounded text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">Resumen de dominio para copiar manualmente</summary>
      <label className="sr-only" htmlFor={textId}>{`Resumen manual de ${summary.domain_name}`}</label>
      <textarea id={textId} ref={textRef} readOnly value={message} rows={12} wrap="soft" className="mt-2 block w-full min-w-0 max-w-full resize-y rounded-lg border border-(--hairline) bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-words outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring" />
    </details>
  </div>;
}
