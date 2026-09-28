"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock, SlidersHorizontal } from "lucide-react";
import { sileo } from "sileo";
import type { BaseMetric, MetricId, PlatformId } from "@/lib/types";
import { METRICS } from "@/lib/metrics";
import { PLATFORMS } from "@/lib/platforms/registry";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MAX_PINNED = 3;

/** Métricas que se pueden fijar en la tarjeta según lo que reporta la plataforma. */
export function pinnableMetrics(platform: PlatformId): MetricId[] {
  const s = new Set(PLATFORMS[platform].supportedMetrics);
  const out: MetricId[] = ["cpr"];
  if (s.has("conversions")) out.push("cpa");
  if (s.has("leads")) out.push("cpl");
  out.push("ctr", "cpc", "cpm");
  if (s.has("revenue")) out.push("roas");
  for (const m of ["impressions", "clicks", "conversions", "sales", "whatsapp", "leads", "calls", "purchases", "revenue"] as BaseMetric[]) if (s.has(m)) out.push(m);
  return out;
}

/**
 * Selector de la métrica monitoreada de cada plataforma (define su semáforo junto con el gasto)
 * y de las métricas fijas que siempre se muestran. Solo administradores y co-administradores.
 */
export function MetricPicker({
  platform,
  primary,
  choices,
  pinned,
  canEdit,
}: {
  platform: PlatformId;
  primary: BaseMetric;
  choices: Array<{ metric: BaseMetric; label: string }>;
  pinned: MetricId[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const current = choices.find((c) => c.metric === primary)?.label ?? METRICS[primary].label;

  async function save(next: { primary: BaseMetric; pinned: MetricId[] }, message: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `platformMetrics.${platform}`, value: next }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: message, description: `${PLATFORMS[platform].name} · aplica para todo el equipo` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> Métrica: <span className="font-semibold text-foreground">{current}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>Solo administradores y co-administradores cambian la métrica monitoreada.</TooltipContent>
      </Tooltip>
    );
  }

  const options = pinnableMetrics(platform).filter((m) => m !== primary);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 outline-none disabled:opacity-60"
          aria-label={`Métrica monitoreada de ${PLATFORMS[platform].name}: ${current}. Cambiar`}
        >
          <SlidersHorizontal className="size-3" /> <span className="font-semibold text-foreground">{current}</span> <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Métrica monitoreada</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={primary} onValueChange={(v) => save({ primary: v as BaseMetric, pinned: pinned.filter((m) => m !== v) }, "Métrica monitoreada actualizada")}>
          {choices.map((c) => (
            <DropdownMenuRadioItem key={c.metric} value={c.metric}>
              {c.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Métricas fijas en la tarjeta (máx. {MAX_PINNED})</DropdownMenuLabel>
        <div className="max-h-56 overflow-y-auto">
          {options.map((m) => {
            const checked = pinned.includes(m);
            return (
              <DropdownMenuCheckboxItem
                key={m}
                checked={checked}
                disabled={!checked && pinned.length >= MAX_PINNED}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(v) => save({ primary, pinned: v ? [...pinned, m].slice(0, MAX_PINNED) : pinned.filter((x) => x !== m) }, v ? `${METRICS[m].label} fijada` : `${METRICS[m].label} quitada`)}
              >
                {m === "cpr" ? "Costo por resultado" : METRICS[m].label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
