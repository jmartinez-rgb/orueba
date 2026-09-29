"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { Severity } from "@/lib/types";
import { BRANDS, type BrandId } from "@/lib/brands";
import { SEVERITY_META, StatusDot } from "@/components/monitoring/status";
import { cn } from "@/lib/utils";
import { sileo } from "sileo";

export interface BrandStatus {
  brand: BrandId;
  overall: Severity | null;
  /** Incidentes críticos abiertos (se marcan en el botón de la otra marca). */
  critical: number;
}

/**
 * Cambio de marca en un clic: izzi | Sky. Cada botón muestra el estado general de su marca,
 * así se ve si la otra marca tiene algo crítico sin tener que cambiarse.
 */
export function BrandSwitch({ current, statuses }: { current: BrandId; statuses: BrandStatus[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<BrandId | null>(null);

  // El acento de la app sigue a la marca vigente (por si la cookie apuntaba a otra).
  useEffect(() => {
    document.documentElement.setAttribute("data-brand", current);
  }, [current]);

  if (statuses.length < 2) return null;

  const choose = async (brand: BrandId) => {
    if (brand === current || pending) return;
    setTarget(brand);
    const res = await fetch("/api/brand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand }) }).catch(() => null);
    if (!res?.ok) {
      setTarget(null);
      const data = await res?.json().catch(() => null);
      sileo.error({ title: "No se pudo cambiar de marca", description: data?.message ?? "Intenta de nuevo." });
      return;
    }
    document.documentElement.setAttribute("data-brand", brand);
    startTransition(() => {
      router.refresh();
      setTarget(null);
    });
  };

  const index = Math.max(
    0,
    statuses.findIndex((s) => s.brand === (target ?? current)),
  );
  return (
    <div
      role="radiogroup"
      aria-label="Marca del monitoreo"
      className="relative grid h-8 shrink-0 items-center rounded-[9px] bg-foreground/[0.06] p-0.5"
      style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }}
    >
      {/* Control segmentado: la pastilla se desliza a la marca elegida (se mueve al presionar, no al terminar de cargar). */}
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-[7px] bg-card shadow-(--shadow-control) transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 4px) / ${statuses.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {statuses.map((s) => {
        const info = BRANDS[s.brand];
        const active = s.brand === current;
        const loading = target === s.brand;
        const tone = s.overall ? SEVERITY_META[s.overall] : null;
        return (
          <button
            key={s.brand}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(s.brand)}
            disabled={pending && !loading}
            title={`${active ? "Viendo" : "Cambiar a"} ${info.name}${tone ? ` · ${tone.label}` : ""}${s.critical ? ` · ${s.critical} crítico${s.critical === 1 ? "" : "s"} abierto${s.critical === 1 ? "" : "s"}` : ""}`}
            className={cn(
              "pressable relative z-10 flex h-7 min-w-[64px] items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              active || loading ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : s.overall ? <StatusDot severity={s.overall} className="size-2" pulse={!active && s.overall === "CRITICAL"} /> : null}
            <span style={active ? { color: "var(--primary)" } : undefined}>{info.name}</span>
            {!active && s.critical > 0 && (
              <span className="absolute -top-1.5 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] leading-none font-semibold text-white shadow-[0_0_0_2px_var(--background)]">
                {s.critical}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
