"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, LogOut, Siren } from "lucide-react";
import { sileo } from "sileo";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { PendingCritical } from "@/lib/services/critical";
import { TICKET_CHANNEL_LABEL, TICKET_CHANNELS, type TicketChannel } from "@/lib/records/ticket-model";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/users/user-avatar";
import { PlatformMark } from "./status";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;
const MIN_TEXT = 20;
const REPORT_SUGGESTIONS = ["Líder de la plataforma", "Equipo Paid Media", "Soporte de la plataforma", "Cliente", "Equipo de datos"];

function pct(v: number | null) {
  return v === null ? "s/d" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

/**
 * Alerta crítica a pantalla completa. Mientras haya incidentes CRÍTICOS abiertos que la persona
 * no haya acusado, bloquea la pantalla hasta que escriba qué revisó y a quién lo va a reportar.
 * Un solo acuse cubre todos los pendientes; queda en cada incidente, en la bitácora y
 * (opcional) en un ticket de reporte.
 */
export function CriticalAlertGate({ userName, canTicket, onPendingChange }: { userName: string; canTicket: boolean; onPendingChange?: (pending: boolean) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingCritical[]>([]);
  const [text, setText] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [channel, setChannel] = useState<TicketChannel>("WHATSAPP");
  const [ticket, setTicket] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">("unsupported");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/critical", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { ok: boolean; pending?: PendingCritical[] };
      if (!d.ok || !d.pending) return;
      // Aviso de escritorio solo para críticos nuevos y con la pestaña en segundo plano (la pantalla ya bloquea cuando está a la vista).
      const known = seen.current;
      if (known && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        for (const p of d.pending.filter((x) => !known.has(x.id))) {
          const n = new Notification(`Incidente crítico · ${p.platformName}`, { body: p.title, tag: p.id });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      }
      seen.current = new Set(d.pending.map((p) => p.id));
      // El coordinador suspende otros modales en el mismo lote que abre el crítico.
      onPendingChange?.(d.pending.length > 0);
      setPending(d.pending);
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  }, [onPendingChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el permiso de avisos solo existe en el navegador
    setNotify(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  // Contador en el título de la pestaña mientras haya críticos sin acusar (se ve aunque la pestaña esté atrás).
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = pending.length ? `(${pending.length}) ${base}` : base;
  }, [pending.length]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    setNotify(await Notification.requestPermission());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y sondeo periódico de incidentes críticos
    void load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const open = pending.length > 0;
  if (!open) return null;

  const valid = text.trim().length >= MIN_TEXT && reportTo.trim().length >= 2 && confirmed;
  const existingTicket = pending.find((p) => p.ticketId)?.ticketId ?? null;
  const ackedBy = [...new Set(pending.flatMap((p) => p.ackedBy))];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/critical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentIds: pending.map((p) => p.id), text: text.trim(), reportTo: reportTo.trim(), channel, createTicket: canTicket && ticket, confirmed: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; ticketId?: string | null };
      if (!res.ok || !d.ok) {
        setError(d.message ?? "No se pudo registrar el acuse.");
        if (res.status === 404) void load();
        return;
      }
      sileo.success({ title: "Acuse registrado", description: d.ticketId ? `Ticket ${d.ticketId} listo para seguimiento.` : "Quedó documentado en los incidentes." });
      setText("");
      setReportTo("");
      setConfirmed(false);
      setTicket(true);
      onPendingChange?.(false);
      setPending([]);
      router.refresh();
    } catch {
      setError("No se pudo contactar al servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-md" />
        <DialogPrimitive.Content
          role="alertdialog"
          className="immc-critical-pulse fixed top-1/2 left-1/2 z-[100] max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[22px] bg-popover text-popover-foreground shadow-(--shadow-pop) outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            textRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected) previousFocus.current.focus();
          }}
        >
      <form onSubmit={submit}>
        <div className="flex items-start gap-4 px-6 pt-6 pb-2">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-status-critical/14 text-status-critical-text" aria-hidden>
            <Siren className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-[19px] leading-snug font-semibold tracking-[-0.02em]">
              {pending.length === 1 ? `${pending[0].platformName}: ${pending[0].title}` : `${pending.length} incidentes críticos sin revisar`}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-[13px] text-muted-foreground">Acción requerida: escribe qué revisaste y a quién lo reportas para continuar.</DialogPrimitive.Description>
          </div>
        </div>

        <div className="space-y-4 px-6 py-4">
          <ul id="critical-list" className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {pending.map((p) => (
              <li key={p.id} className="rounded-xl bg-status-critical/[0.07] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <PlatformMark platform={p.platform} />
                  <span className="font-semibold">{p.title}</span>
                  <span className="tabular ml-auto text-xs font-semibold text-status-critical-text">{pct(p.deviation)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{p.id}</span> · {p.type} · {p.entity}
                </p>
                {p.diagnosis && pending.length <= 2 && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.diagnosis}</p>}
              </li>
            ))}
          </ul>
          {ackedBy.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex -space-x-2">
                {ackedBy.slice(0, 5).map((n) => (
                  <UserAvatar key={n} name={n} size={22} className="ring-2 ring-card" />
                ))}
              </span>
              Ya lo revisaron: {ackedBy.join(", ")}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ack-text">¿Qué revisaste? (obligatorio)</Label>
            <Textarea
              id="ack-text"
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ej. Revisé Ads Manager: las campañas de WhatsApp siguen activas pero con presupuesto agotado. Lo reporto al líder de Meta."
            />
            <p className={cn("text-[11px]", text.trim().length >= MIN_TEXT ? "text-status-normal-text" : "text-muted-foreground")}>
              {text.trim().length}/{MIN_TEXT} caracteres mínimos
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
            <div className="space-y-1.5">
              <Label htmlFor="ack-to">¿A quién lo vas a reportar?</Label>
              <Input id="ack-to" list="ack-to-list" value={reportTo} onChange={(e) => setReportTo(e.target.value)} maxLength={120} placeholder="Líder de la plataforma" />
              <datalist id="ack-to-list">
                {REPORT_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ack-channel">Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as TicketChannel)}>
                <SelectTrigger id="ack-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[110]">
                  {TICKET_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TICKET_CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canTicket && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={ticket} onChange={(e) => setTicket(e.target.checked)} />
              <span>
                {existingTicket ? (
                  <>
                    Vincular al ticket abierto <strong>{existingTicket}</strong> (o crear uno nuevo si no cubre todos)
                  </>
                ) : (
                  "Crear ticket de reporte para dar seguimiento (queda en el histórico)"
                )}
              </span>
            </label>
          )}
          <label className="flex items-start gap-2.5 rounded-xl bg-status-critical/[0.07] p-3 text-sm font-medium">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--status-critical)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />
            <span>Yo, {userName}, revisé {pending.length === 1 ? "esta alerta" : "estas alertas"} y lo voy a reportar.</span>
          </label>
          {error && (
            <p role="alert" className="text-xs font-medium text-status-critical-text">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--hairline) px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={logout} className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <LogOut className="size-3.5" /> Cerrar sesión
            </button>
            {notify === "default" && (
              <button type="button" onClick={enableNotifications} className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                <BellRing className="size-3.5" /> Avisarme en el escritorio
              </button>
            )}
          </div>
          <Button type="submit" disabled={!valid || busy} className="h-10 rounded-full bg-status-critical px-5 text-white hover:bg-status-critical/90">
            {busy ? "Registrando…" : "Registrar acuse y continuar"}
          </Button>
        </div>
      </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
