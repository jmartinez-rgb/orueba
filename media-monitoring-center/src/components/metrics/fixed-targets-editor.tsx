"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { sileo } from "sileo";
import type { MetricId, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { METRICS } from "@/lib/metrics";
import type { TargetCheck } from "@/lib/monitoring/targets";
import { fmtMetric, fmtDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FixedTarget {
  id: string;
  platform: PlatformId;
  accountId: string | null;
  metric: MetricId;
  kind: "min" | "max";
  value: number;
  active: boolean;
  note: string;
}

const TARGET_METRICS: MetricId[] = ["spend", "conversions", "sales", "whatsapp", "leads", "purchases", "calls", "clicks", "impressions", "cpa", "cpl", "cpr", "ctr", "cpc", "cpm", "roas"];

/**
 * Objetivos fijos opcionales. No hay valores por defecto: solo los que el equipo decida (no se
 * inventan umbrales). Solo informan en Overview, la plataforma y aquí.
 */
export function FixedTargetsEditor({ targets, checks, accounts, canEdit }: { targets: FixedTarget[]; checks: TargetCheck[]; accounts: Array<{ id: string; name: string; platform: PlatformId }>; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<FixedTarget[]>(targets);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(targets);
  const set = (i: number, patch: Partial<FixedTarget>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    try {
      const clean = rows.filter((r) => Number.isFinite(r.value) && r.value >= 0).map((r) => ({ ...r, note: r.note.slice(0, 200) }));
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "fixedTargets", value: clean }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: "Métricas fijas guardadas" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Plataforma / cuenta</th>
              <th className="px-2 py-1.5 text-left font-medium">Métrica</th>
              <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
              <th className="px-2 py-1.5 text-left font-medium">Valor</th>
              <th className="px-2 py-1.5 text-left font-medium">Hoy</th>
              <th className="px-2 py-1.5 text-left font-medium">Nota</th>
              {canEdit && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">
                  Sin métricas fijas. {canEdit ? "Agrega las que el equipo quiera vigilar (p. ej. CPA máximo de Meta)." : ""}
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const check = checks.find((c) => c.id === r.id);
              return (
                <tr key={r.id} className={cn("border-t", !r.active && "opacity-50")}>
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <div className="flex flex-col gap-1">
                        <Select value={r.platform} onValueChange={(v) => set(i, { platform: v as PlatformId, accountId: null })}>
                          <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PLATFORM_IDS.map((p) => (
                              <SelectItem key={p} value={p}>
                                {PLATFORMS[p].name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={r.accountId ?? "all"} onValueChange={(v) => set(i, { accountId: v === "all" ? null : v })}>
                          <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Toda la plataforma</SelectItem>
                            {accounts
                              .filter((a) => a.platform === r.platform)
                              .map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span>
                        {PLATFORMS[r.platform].name}
                        {r.accountId && <span className="block text-muted-foreground">{accounts.find((a) => a.id === r.accountId)?.name ?? r.accountId}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <Select value={r.metric} onValueChange={(v) => set(i, { metric: v as MetricId })}>
                        <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_METRICS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m === "cpr" ? "Costo por resultado" : METRICS[m].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      METRICS[r.metric].label
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <Select value={r.kind} onValueChange={(v) => set(i, { kind: v as "min" | "max" })}>
                        <SelectTrigger size="sm" className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="min">Mínimo</SelectItem>
                          <SelectItem value="max">Máximo</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : r.kind === "min" ? (
                      "Mínimo"
                    ) : (
                      "Máximo"
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {canEdit ? <Input value={String(r.value)} onChange={(e) => set(i, { value: Number(e.target.value.replace(",", ".")) })} inputMode="decimal" className="h-7 w-24 text-xs" aria-label="Valor objetivo" /> : fmtMetric(r.metric, r.value)}
                  </td>
                  <td className="px-2 py-1">
                    {check ? (
                      <span className={cn("font-semibold", check.ok === null ? "text-muted-foreground" : check.ok ? "text-status-normal-text" : "text-status-alert-text")}>
                        {check.ok === null ? "Sin dato" : `${check.ok ? "✓" : "✕"} ${fmtMetric(r.metric, check.value)}`}
                        {check.projected && <span className="block text-[10px] font-normal text-muted-foreground">proyección del día</span>}
                        {check.gap !== null && !check.ok && <span className="block text-[10px] font-normal">{fmtDelta(check.gap)} vs objetivo</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Guardar para evaluar</span>
                    )}
                  </td>
                  <td className="px-2 py-1">{canEdit ? <Input value={r.note} onChange={(e) => set(i, { note: e.target.value })} className="h-7 text-xs" maxLength={200} aria-label="Nota" /> : r.note || "—"}</td>
                  {canEdit && (
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1">
                        <label className="flex items-center gap-1 text-[11px]">
                          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /> Activa
                        </label>
                        <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label="Eliminar">
                          <Trash2 />
                        </Button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length >= 80}
            onClick={() => setRows((cur) => [...cur, { id: `t${Date.now().toString(36)}`, platform: "meta", accountId: null, metric: "cpa", kind: "max", value: 0, active: true, note: "" }])}
          >
            <Plus /> Agregar métrica fija
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      )}
    </div>
  );
}
