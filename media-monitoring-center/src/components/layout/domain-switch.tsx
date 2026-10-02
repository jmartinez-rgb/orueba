"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import type { DomainSelection } from "@/lib/domains/types";

export function DomainSwitch({ current, options, enabled = true }: { current: DomainSelection; options: Array<{ id: string; name: string }>; enabled?: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const choose = async (domain: string) => {
    if (domain === current.id || saving || pending) return;
    setSaving(true);
    const response = await fetch("/api/domain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) }).catch(() => null);
    setSaving(false);
    if (!response?.ok) { sileo.error({ title: "No se pudo cambiar de dominio", description: "Revisa la configuración de dominios e intenta de nuevo." }); return; }
    startTransition(() => router.refresh());
  };
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">Dominio Google</span>
      <select aria-label="Dominio de Google Ads" value={current.id} onChange={event => void choose(event.target.value)} disabled={saving || pending || (!enabled && current.id === "all")} className="h-11 min-w-0 max-w-full rounded-lg border border-(--hairline) bg-background px-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {!options.some(option => option.id === current.id) && <option value={current.id}>{current.name}</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {(saving || pending) && <span role="status" className="sr-only">Cambiando dominio</span>}
    </label>
  );
}
