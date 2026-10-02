"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Bot, ExternalLink, LoaderCircle, MessageSquareText, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { BrandId } from "@/lib/brands";
import type { NexusAnswer } from "@/lib/nexus/types";
import { NEXUS_SUGGESTIONS } from "@/lib/nexus/suggestions";

interface Exchange { id: number; question: string; answer?: NexusAnswer; error?: string }

/** Ephemeral conversation: no localStorage, server-side history or external model. */
export function NexusAssistant({ brandId, brandName, domainId = "all", domainName = "Todos los dominios" }: { brandId: BrandId; brandName: string; domainId?: string; domainName?: string }) {
  // A new scope mounts a new conversation and cancels requests from the previous scope.
  return <NexusConversation key={`${brandId}:${domainId}`} brandId={brandId} brandName={brandName} domainId={domainId} domainName={domainName} />;
}

function NexusConversation({ brandId, brandName, domainId, domainName }: { brandId: BrandId; brandName: string; domainId: string; domainName: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  useEffect(() => () => { const controller = pending.current; pending.current = null; controller?.abort(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [exchanges, loading, open]);
  const suggestions = exchanges.at(-1)?.answer?.suggestions.length ? exchanges.at(-1)!.answer!.suggestions : NEXUS_SUGGESTIONS;

  async function ask(value: string) {
    const text = value.trim();
    if (!text || text.length > 500 || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const id = ++sequence.current;
    setQuestion("");
    setLoading(true);
    setExchanges(previous => [...previous, { id, question: text }].slice(-8));
    let timedOut = false;
    let responseMessage: string | null = null;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    try {
      const response = await fetch("/api/nexus", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, brand: brandId, domain: domainId }), signal: controller.signal,
      });
      const result = await response.json() as { ok: boolean; answer?: NexusAnswer; message?: string };
      if (!response.ok || !result.ok || !result.answer) {
        responseMessage = typeof result.message === "string" ? result.message.slice(0, 300) : null;
        throw new Error("Nexus request failed");
      }
      if (controller.signal.aborted) return;
      const answer = result.answer;
      if (answer.context.brand !== brandId || (answer.context.domain?.id ?? "all") !== domainId) {
        responseMessage = "El alcance de la respuesta cambió. Actualiza la página antes de consultar Nexus.";
        throw new Error("Nexus scope changed");
      }
      setExchanges(previous => previous.map(exchange => exchange.id === id ? { ...exchange, answer } : exchange));
    } catch {
      if (!controller.signal.aborted || timedOut) setExchanges(previous => previous.map(exchange => exchange.id === id ? { ...exchange, error: timedOut ? "La consulta tardó demasiado. Intenta nuevamente o revisa Integraciones." : responseMessage ?? "No pude consultar Nexus. Comprueba la conexión y vuelve a intentarlo." } : exchange));
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }

  function cancel() {
    const controller = pending.current;
    if (!controller) return;
    pending.current = null;
    controller.abort();
    setLoading(false);
    const id = sequence.current;
    setExchanges(previous => previous.map(exchange => exchange.id === id ? { ...exchange, error: "Consulta cancelada. Puedes volver a intentarlo." } : exchange));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="fixed right-4 bottom-5 z-40 h-12 gap-2 rounded-full px-5 shadow-lg sm:right-6" aria-label="Abrir Nexus, asistente del monitoreo">
          <MessageSquareText className="size-5" aria-hidden="true" /><span>Nexus</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-[480px]" onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" aria-hidden="true" />Nexus <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{brandName}</span></SheetTitle>
          <SheetDescription>Tu guía para entender campañas y el monitoreo.{domainId !== "all" && ` Alcance: ${domainName}.`}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3 text-xs text-muted-foreground">
          <span>Respuestas a partir de datos disponibles. Solo consulta.</span>
          <Button size="icon-sm" variant="ghost" aria-label="Limpiar conversación de Nexus" disabled={loading || !exchanges.length} onClick={() => setExchanges([])}><RotateCcw className="size-3.5" aria-hidden="true" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversación con Nexus" aria-busy={loading}>
          {!exchanges.length && <div className="mb-5 space-y-3 rounded-2xl border bg-muted/40 p-5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="size-6" aria-hidden="true" /></div>
            <h3 className="font-semibold">¿Qué necesitas revisar?</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">Pregunta por una campaña usando su nombre o ID, revisa las alertas o descubre cómo atender un incidente. Consulto la marca {brandName}{domainId !== "all" && `, ${domainName},`} seleccionada.</p>
          </div>}
          <div className="space-y-6">
            {exchanges.map(exchange => <div key={exchange.id} className="space-y-3">
              <div className="ml-8 rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground break-words [overflow-wrap:anywhere]"><span className="sr-only">Tu pregunta: </span>{exchange.question}</div>
              {exchange.answer && <AnswerCard answer={exchange.answer} onNavigate={() => setOpen(false)} />}
              {exchange.error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
                <p className="text-sm">{exchange.error}</p><Button className="mt-2" size="sm" variant="outline" disabled={loading} onClick={() => void ask(exchange.question)}>Reintentar</Button>
              </div>}
            </div>)}
          </div>
          {loading && <div className="mt-4 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Consultando el monitoreo…</div><Button size="sm" variant="ghost" onClick={cancel}>Cancelar</Button></div>}
          <div ref={endRef} />
        </div>
        <div className="border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Preguntas sugeridas">{suggestions.slice(0, 4).map(suggestion => <button type="button" key={suggestion} disabled={loading} onClick={() => void ask(suggestion)} className="rounded-full border bg-muted/30 px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{suggestion}</button>)}</div>
          <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="rounded-xl border bg-muted/20 p-2 focus-within:ring-2 focus-within:ring-ring/40">
            <label htmlFor="nexus-question" className="sr-only">Pregunta para Nexus</label>
            <textarea id="nexus-question" ref={inputRef} rows={2} maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ej. ¿Cómo está la campaña 12345?" className="w-full resize-none bg-transparent p-2 text-sm outline-none" aria-describedby="nexus-input-help" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); } }} />
            <div className="flex items-center justify-between gap-2 px-2 pb-1"><span id="nexus-input-help" className="text-[11px] text-muted-foreground">Enter para enviar · {question.length}/500</span><Button type="submit" size="icon-sm" disabled={loading || !question.trim()} aria-label="Enviar pregunta a Nexus"><ArrowUp className="size-4" aria-hidden="true" /></Button></div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AnswerCard({ answer, onNavigate }: { answer: NexusAnswer; onNavigate: () => void }) {
  return <div className="space-y-3 rounded-2xl rounded-bl-md border bg-card p-4 text-sm break-words [overflow-wrap:anywhere]">
    <h3 className="font-semibold">{answer.title}</h3>
    <div className="space-y-2 leading-relaxed text-muted-foreground">{answer.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    {!!answer.facts.length && <dl className="grid grid-cols-2 gap-2">{answer.facts.map(fact => <div key={fact.label} className="min-w-0 rounded-lg bg-muted/50 p-2.5"><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="mt-1 font-medium tabular-nums break-words [overflow-wrap:anywhere]">{fact.value}</dd></div>)}</dl>}
    {!!answer.items.length && <ul className="divide-y rounded-lg border">{answer.items.map((item, index) => <li key={index} className="p-3"><div className="font-medium break-words">{item.title}</div><p className="mt-1 text-xs text-muted-foreground break-words">{item.detail}</p>{item.href && <Link href={item.href} onClick={onNavigate} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Abrir detalle <ExternalLink className="size-3" aria-hidden="true" /></Link>}</li>)}</ul>}
    {!!answer.sources.length && <div className="flex flex-wrap gap-2 border-t pt-3">{answer.sources.map(source => <Link key={source.href} href={source.href} onClick={onNavigate} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.label}<ExternalLink className="size-3" aria-hidden="true" /></Link>)}</div>}
    <p className="border-t pt-2 text-[11px] text-muted-foreground">{answer.context.brandName}{answer.context.domain && answer.context.domain.id !== "all" ? ` · ${answer.context.domain.name}` : ""} · {answer.context.date} · corte {answer.context.cutoffHour}:00 · {answer.context.timezone}{answer.context.mode === "mock" ? " · Datos simulados" : ""}</p>
  </div>;
}
