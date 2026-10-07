"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlatformMark } from "@/components/monitoring/status";

interface Status {
  ok: boolean;
  brand: string;
  month: string;
  today: string;
  confirmed: boolean;
  required: boolean;
  missingBudgets: PlatformId[];
  pending: Array<{ key: string; name: string; platform: PlatformId; accountName: string | null; expectedStart: string | null; overdue: boolean }>;
  justStarted: string[];
}

/** The wizard fires it after a confirmed save: the gate stops blocking at once and re-reads the status. */
export const KICKOFF_SAVED_EVENT = "immc:kickoff-saved";

async function fetchKickoffStatus(): Promise<Status | null> {
  const r = await fetch("/api/kickoff", { cache: "no-store" });
  if (!r.ok) return null;
  const d = (await r.json()) as Status;
  return d?.ok ? d : null;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Sin almacenamiento local (modo privado): el recordatorio puede repetirse; no pasa nada.
  }
}

/**
 * Arranque de mes obligatorio y recordatorio diario:
 * - Administradores y co-administradores: si el mes no tiene arranque confirmado, un aviso que no se
 *   puede cerrar los lleva a capturarlo (presupuestos + activo / pendiente por iniciar).
 * - Todos: una vez al día, lo que sigue pendiente por iniciar (y avisa cuando algo inicia).
 */
export function MonthGate({ canKickoff, userId, suspended = false }: { canKickoff: boolean; userId: string; suspended?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchKickoffStatus()
      .then((d) => {
        if (!alive || !d) return;
        setStatus(d);
        for (const name of d.justStarted) sileo.success({ title: "Inició una campaña pendiente", description: name });
        const month = MONTHS[Number(d.month.slice(5, 7)) - 1];
        if (d.required && !canKickoff) {
          const k = `immc:kickoff-notice:${d.brand}:${d.today}:${userId}`;
          if (!readFlag(k)) {
            writeFlag(k);
            sileo.error({ title: `Arranque de ${month} pendiente`, description: "Lo completa un administrador o co-administrador. Mientras tanto no hay pacing contra presupuesto." });
          }
        }
        const rk = `immc:pending-reminder:${d.brand}:${d.today}:${userId}`;
        if (d.pending.length && !readFlag(rk)) {
          setReminderOpen(true);
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            new Notification(`Pendientes por iniciar · ${d.pending.length}`, { body: d.pending.slice(0, 3).map((p) => p.name).join(" · "), tag: rk });
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Una consulta por marca y por carga de la app; el recordatorio es una vez al día.
  }, [canKickoff, userId]);

  // The status above is read once per load. Without these two refreshes a confirmed kickoff kept the stale
  // "required" answer and the gate sent the administrator back to the wizard after every save.
  const required = useRef(false);
  useEffect(() => {
    required.current = Boolean(status?.required);
  }, [status]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setStatus((current) => (current ? { ...current, required: false, confirmed: true } : current));
      fetchKickoffStatus().then((d) => { if (alive && d) setStatus(d); }).catch(() => undefined);
    };
    window.addEventListener(KICKOFF_SAVED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(KICKOFF_SAVED_EVENT, refresh);
    };
  }, []);
  // Another tab (or another administrator) may have confirmed it: re-read while it still blocks.
  useEffect(() => {
    if (!required.current || pathname.startsWith("/novedades/arranque")) return;
    let alive = true;
    fetchKickoffStatus().then((d) => { if (alive && d) setStatus(d); }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pathname]);

  if (!status) return null;
  const month = MONTHS[Number(status.month.slice(5, 7)) - 1];
  const blocking = status.required && canKickoff && !pathname.startsWith("/novedades/arranque");

  function closeReminder() {
    writeFlag(`immc:pending-reminder:${status!.brand}:${status!.today}:${userId}`);
    setReminderOpen(false);
  }

  return (
    <>
      <Dialog open={!suspended && blocking}>
        <DialogContent hideClose onCloseAutoFocus={(e) => suspended && e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="sm:max-w-lg">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-full bg-primary/12" aria-hidden>
              <CalendarPlus className="size-5 text-primary" />
            </span>
            <DialogTitle>Arranque de {month}: obligatorio</DialogTitle>
            <DialogDescription>
              Para monitorear el mes hace falta capturar los presupuestos y marcar qué campañas están activas y cuáles están pendientes por iniciar. Toma un par de minutos y queda registrado en Novedades.
            </DialogDescription>
          </DialogHeader>
          {status.missingBudgets.length > 0 && (
            <p className="rounded-xl bg-status-attention/10 px-3 py-2 text-[13px] text-status-attention-text">Sin presupuesto: {status.missingBudgets.map((p) => PLATFORMS[p].name).join(", ")}.</p>
          )}
          <DialogFooter>
            <Button onClick={() => router.push("/novedades/arranque")}>Completar arranque de {month}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!suspended && reminderOpen && !blocking} onOpenChange={(o) => !o && !suspended && closeReminder()}>
        <DialogContent onCloseAutoFocus={(e) => suspended && e.preventDefault()} className="sm:max-w-lg">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-full bg-status-attention/14" aria-hidden>
              <CalendarClock className="size-5 text-status-attention-text" />
            </span>
            <DialogTitle>Pendientes por iniciar ({status.pending.length})</DialogTitle>
            <DialogDescription>Recordatorio del día. Cuando una campaña empiece a gastar se marca sola como iniciada.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 divide-y divide-(--hairline) overflow-y-auto rounded-xl bg-foreground/[0.03]">
            {status.pending.map((p) => (
              <li key={p.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                <PlatformMark platform={p.platform} className="size-5 text-[9px]" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className={cn("shrink-0 text-xs tabular", p.overdue ? "font-semibold text-status-alert-text" : "text-muted-foreground")}>
                  {p.expectedStart ? `${p.overdue ? "Debía iniciar" : "Inicia"} ${p.expectedStart}` : "Sin fecha"}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                closeReminder();
                router.push("/novedades");
              }}
            >
              Ver en Novedades
            </Button>
            <Button onClick={closeReminder}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
