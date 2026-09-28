"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { DEFAULT_CLASSIFIERS, type ClassifierConfig, type ClassifierRule } from "@/lib/classifiers/defaults";
import { classify, unreachableRules } from "@/lib/classifiers/classify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";

const FALLBACK_LABEL = { label: "Texto fijo", secondary: "Campo secundario", objective: "Objetivo de la campaña" } as const;

function toFormula(config: ClassifierConfig, platform: PlatformId): string {
  const nameCol = platform === "google" ? "D2" : "C2";
  const secCol = platform === "google" ? "L2" : "D2";
  const fb = config.fallback.type === "secondary" ? secCol : config.fallback.type === "objective" ? "OBJETIVO" : `"${config.fallback.label}"`;
  return config.rules.reduceRight((acc, r) => `IF(ISNUMBER(SEARCH("${r.contains}";${r.field === "campaign" ? nameCol : secCol}));"${r.label}";${acc})`, fb).replace(/^/, "=");
}

/**
 * Reglas de estrategia por nombre de campaña (réplica de las fórmulas de la hoja). En orden: gana la
 * primera coincidencia. Incluye probador y detección de reglas que nunca se aplican.
 */
export function ClassifierEditor({ initial, canEdit, initialPlatform = "meta" }: { initial: Partial<Record<PlatformId, ClassifierConfig>>; canEdit: boolean; initialPlatform?: PlatformId }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformId>(initialPlatform);
  const [drafts, setDrafts] = useState<Record<PlatformId, ClassifierConfig>>(() => Object.fromEntries(PLATFORM_IDS.map((p) => [p, structuredClone(initial[p] ?? DEFAULT_CLASSIFIERS[p])])) as Record<PlatformId, ClassifierConfig>);
  const [testName, setTestName] = useState("Performance 2024 | Nuevos Artes | Hogar");
  const [testSecondary, setTestSecondary] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const config = drafts[platform];
  const dirty = JSON.stringify(config) !== JSON.stringify(initial[platform] ?? DEFAULT_CLASSIFIERS[platform]);
  const unreachable = useMemo(() => new Map(unreachableRules(config).map((u) => [u.index, u.shadowedBy])), [config]);
  const result = classify(config, { campaign: testName, secondary: testSecondary, objective: "Objetivo" });

  const update = (fn: (c: ClassifierConfig) => void) =>
    setDrafts((cur) => {
      const next = structuredClone(cur);
      fn(next[platform]);
      return next;
    });
  const setRule = (i: number, patch: Partial<ClassifierRule>) => update((c) => (c.rules[i] = { ...c.rules[i], ...patch }));
  const move = (i: number, d: -1 | 1) =>
    update((c) => {
      const j = i + d;
      if (j < 0 || j >= c.rules.length) return;
      [c.rules[i], c.rules[j]] = [c.rules[j], c.rules[i]];
    });

  async function save(value: ClassifierConfig, message: string) {
    setBusy(true);
    try {
      const clean = { ...value, rules: value.rules.filter((r) => r.contains.trim() && r.label.trim()).map((r) => ({ ...r, contains: r.contains.trim(), label: r.label.trim() })) };
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `classifiers.${platform}`, value: clean }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: message, description: PLATFORMS[platform].name });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <AnimatedTabs label="Plataforma del clasificador" active={platform} onChange={setPlatform} tabs={PLATFORM_IDS.map((p) => ({ id: p, label: PLATFORMS[p].shortName, count: drafts[p].rules.length || undefined }))} />
      <p className="text-xs text-muted-foreground">
        Se evalúan en orden y gana la primera que coincide (igual que SI(ESNUMERO(HALLAR(…))) en la hoja). La búsqueda no distingue mayúsculas pero sí acentos: “gené” no encuentra “Genericas”. Campo
        secundario de {PLATFORMS[platform].shortName}: {config.secondaryLabel}.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left font-medium">#</th>
              <th className="px-2 py-1.5 text-left font-medium">Si contiene</th>
              <th className="px-2 py-1.5 text-left font-medium">En</th>
              <th className="px-2 py-1.5 text-left font-medium">Asignar estrategia</th>
              {canEdit && <th className="w-24 px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {config.rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">
                  Sin reglas: se usa el respaldo.
                </td>
              </tr>
            )}
            {config.rules.map((r, i) => {
              const shadow = unreachable.get(i + 1);
              const hit = result.ruleIndex === i + 1;
              return (
                <tr key={r.id} className={cn("border-t", hit && "bg-primary/10")}>
                  <td className="tabular px-2 py-1 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1">
                    {canEdit ? <Input value={r.contains} onChange={(e) => setRule(i, { contains: e.target.value })} className="h-7 text-xs" aria-label={`Texto de la regla ${i + 1}`} /> : <code className="font-mono">{r.contains}</code>}
                    {shadow && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-status-attention-text">
                        <TriangleAlert className="size-3" /> Nunca se aplica: la regla {shadow} ya la cubre.
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {canEdit ? (
                      <Select value={r.field} onValueChange={(v) => setRule(i, { field: v as ClassifierRule["field"] })}>
                        <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="campaign">Nombre de campaña</SelectItem>
                          <SelectItem value="secondary">Campo secundario</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : r.field === "campaign" ? (
                      "Nombre de campaña"
                    ) : (
                      "Campo secundario"
                    )}
                  </td>
                  <td className="px-2 py-1">{canEdit ? <Input value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} className="h-7 text-xs" aria-label={`Estrategia de la regla ${i + 1}`} /> : <span className="font-medium">{r.label}</span>}</td>
                  {canEdit && (
                    <td className="px-1 py-1">
                      <span className="flex justify-end gap-0.5">
                        <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
                          <ArrowUp />
                        </Button>
                        <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => move(i, 1)} disabled={i === config.rules.length - 1} aria-label="Bajar">
                          <ArrowDown />
                        </Button>
                        <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => update((c) => c.rules.splice(i, 1))} aria-label="Eliminar">
                          <Trash2 />
                        </Button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className={cn("border-t bg-muted/30", result.ruleIndex === null && "bg-primary/10")}>
              <td className="px-2 py-1 text-muted-foreground">—</td>
              <td className="px-2 py-1" colSpan={2}>
                Si ninguna coincide →{" "}
                {canEdit ? (
                  <Select value={config.fallback.type} onValueChange={(v) => update((c) => (c.fallback.type = v as ClassifierConfig["fallback"]["type"]))}>
                    <SelectTrigger size="sm" className="ml-1 inline-flex h-7 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FALLBACK_LABEL) as Array<keyof typeof FALLBACK_LABEL>).map((k) => (
                        <SelectItem key={k} value={k}>
                          {FALLBACK_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  FALLBACK_LABEL[config.fallback.type]
                )}
              </td>
              <td className="px-2 py-1" colSpan={canEdit ? 2 : 1}>
                {config.fallback.type === "label" ? (
                  canEdit ? (
                    <Input value={config.fallback.label} onChange={(e) => update((c) => (c.fallback.label = e.target.value))} className="h-7 text-xs" aria-label="Estrategia de respaldo" />
                  ) : (
                    <span className="font-medium">{config.fallback.label}</span>
                  )
                ) : (
                  <span className="text-muted-foreground">{config.fallback.type === "secondary" ? "Valor del campo secundario" : "Objetivo de la campaña"}</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => update((c) => c.rules.push({ id: `r${Date.now().toString(36)}`, contains: "", field: "campaign", label: "" }))} disabled={config.rules.length >= 60}>
            <Plus /> Agregar regla
          </Button>
          <Button size="sm" onClick={() => save(config, "Clasificador guardado")} disabled={busy || !dirty}>
            {busy ? "Guardando…" : "Guardar reglas"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDrafts((cur) => ({ ...cur, [platform]: structuredClone(DEFAULT_CLASSIFIERS[platform]) }));
              void save(DEFAULT_CLASSIFIERS[platform], "Fórmula original restablecida");
            }}
            disabled={busy}
          >
            <RotateCcw /> Restablecer fórmula original
          </Button>
        </div>
      )}
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="cls-name" className="text-xs">
            Probar con un nombre de campaña
          </Label>
          <Input id="cls-name" value={testName} onChange={(e) => setTestName(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cls-sec" className="text-xs">
            Campo secundario (opcional)
          </Label>
          <Input id="cls-sec" value={testSecondary} onChange={(e) => setTestSecondary(e.target.value)} placeholder={platform === "google" ? "SEARCH / PERFORMANCE_MAX…" : "OUTCOME_LEADS…"} className="h-8 text-xs" />
        </div>
        <div className="rounded-md border bg-card px-3 py-1.5 text-xs">
          <p className="text-muted-foreground">Resultado</p>
          <p className="font-semibold">{result.label}</p>
          <p className="text-[10px] text-muted-foreground">{result.ruleIndex ? `Regla ${result.ruleIndex}: “${result.rule?.contains}”` : "Respaldo"}</p>
        </div>
      </div>
      <div>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowFormula((v) => !v)}>
          {showFormula ? "Ocultar fórmula equivalente" : "Ver fórmula equivalente para Google Sheets"}
        </button>
        {showFormula && <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{toFormula(config, platform)}</pre>}
      </div>
    </div>
  );
}
