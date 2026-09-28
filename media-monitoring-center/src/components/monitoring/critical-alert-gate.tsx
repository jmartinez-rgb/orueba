"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Siren } from "lucide-react";
import { sileo } from "sileo";
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
const REPORT_SUGGESTIONS = ["Líder de la plataforma", "Equipo Paid Media", "Soporte de la plataforma", "Cliente izzi", "Equipo de datos"];

function pct(v: number | null) {
  return v === null ? "s/d" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

/**
 * Alerta crítica a pantalla completa. Mientras haya incidentes CRÍTICOS abiertos que la persona
 * no haya acusado, bloquea la pantalla hasta que escriba qué revisó y a quién lo va a reportar.
 * Un solo acuse cubre todos los pendientes; queda en cada incidente, en la bitácora y
 * (opcional) en un ticket de reporte.
 */
export function CriticalAlertGate({ userName, canTicket }: { userName: string; canTicket: boolean }) {
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/critical", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { ok: boolean; pending?: PendingCritical[] };
      if (d.ok && d.pending) setPending(d.pending);
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  }, []);

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
  const ids = pending.map((p) => p.id).join(",");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    const f = setTimeout(() => textRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(f);
    };
  }, [open, ids]);

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
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:items-center sm:p-6" role="alertdialog" aria-modal="true" aria-labelledby="critical-title" aria-describedby="critical-list">
      <form onSubmit={submit} className="immc-critical-pulse my-auto w-full max-w-2xl overflow-hidden rounded-xl border-2 border-status-critical bg-card shadow-2xl">
        <div className="flex items-start gap-3 bg-status-critical px-5 py-4 text-white">
          <Siren className="mt-0.5 size-7 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase opacity-90">Alerta crítica · acción requerida</p>
            <h2 id="critical-title" className="text-lg leading-snug font-extrabold sm:text-xl">
              {pending.length === 1 ? `${pending[0].platformName}: ${pending[0].title}` : `${pending.length} incidentes críticos sin revisar`}
            </h2>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <ul id="critical-list" className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {pending.map((p) => (
              <li key={p.id} className="rounded-md border border-status-critical/30 bg-status-critical/5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <PlatformMark platform={p.platform} />
                  <span className="font-semibold">{p.title}</span>
                  <span className="tabular ml-auto text-xs font-bold text-status-critical-text">{pct(p.deviation)}</span>
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
              <Label>Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as TicketChannel)}>
                <SelectTrigger className="w-full">
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
          <label className="flex items-start gap-2 rounded-md border border-status-critical/40 bg-status-critical/5 p-2.5 text-sm font-medium">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--status-critical)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />
            <span>Yo, {userName}, revisé {pending.length === 1 ? "esta alerta" : "estas alertas"} y lo voy a reportar.</span>
          </label>
          {error && (
            <p role="alert" className="text-xs font-medium text-status-critical-text">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-5 py-3">
          <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <LogOut className="size-3.5" /> Cerrar sesión
          </button>
          <Button type="submit" disabled={!valid || busy} className="bg-status-critical text-white hover:bg-status-critical/90">
            {busy ? "Registrando…" : "Registrar acuse y continuar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
