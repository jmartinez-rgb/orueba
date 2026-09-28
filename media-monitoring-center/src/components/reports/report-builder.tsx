"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardCopy, History, MessageCircle, RotateCcw, Save, Settings2 } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { ReportData, ReportStatus } from "@/lib/reports/types";
import { STATUS_EMOJI } from "@/lib/reports/types";
import { buildReportMessage, statusOf, whatsappLink } from "@/lib/reports/format";
import { formatDateTimeInTz, hourLabel } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";
import { PlatformMark } from "@/components/monitoring/status";
import { UserAvatar } from "@/components/users/user-avatar";

export interface SavedReportView {
  id: string;
  at: string;
  by: string;
  text: string;
  summary: string;
  cutoffHour: number;
}

const STATUS_LABEL: Record<ReportStatus, string> = { ok: "Bien", warn: "Observaciones", bad: "Problema" };

function StatusToggle({ value, auto, onChange, label }: { value: ReportStatus; auto: ReportStatus | null; onChange: (s: ReportStatus | null) => void; label: string }) {
  return (
    <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={label}>
      {(["ok", "warn", "bad"] as ReportStatus[]).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          title={`${STATUS_LABEL[s]}${auto === s ? " (automático)" : ""}`}
          onClick={() => onChange(auto === s ? null : s)}
          className={cn("rounded px-1.5 py-0.5 text-sm leading-none transition-colors", value === s ? "bg-muted ring-1 ring-foreground/20" : "opacity-50 hover:opacity-100")}
        >
          {STATUS_EMOJI[s]}
        </button>
      ))}
    </div>
  );
}

export function ReportBuilder({ data, history, canSave, canConfigure, timezone }: { data: ReportData; history: SavedReportView[]; canSave: boolean; canConfigure: boolean; timezone: string }) {
  const router = useRouter();
  const [platforms, setPlatforms] = useState<PlatformId[]>(data.platforms.filter((p) => ["google", "meta"].includes(p.platform)).map((p) => p.platform));
  const [overrides, setOverrides] = useState<Record<string, ReportStatus>>({});
  const [includeConfidence, setIncludeConfidence] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "edit">("preview");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const options = useMemo(() => ({ overrides, includeConfidence, platforms }), [overrides, includeConfidence, platforms]);
  const generated = useMemo(() => buildReportMessage(data, options), [data, options]);
  const text = edited ?? generated;

  const setOverride = (key: string, s: ReportStatus | null) =>
    setOverrides((cur) => {
      const next = { ...cur };
      if (s === null) delete next[key];
      else next[key] = s;
      return next;
    });

  async function copy(value = text) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      sileo.success({ title: "Mensaje copiado", description: "Pégalo en el grupo de WhatsApp." });
    } catch {
      sileo.error({ title: "No se pudo copiar", description: "Selecciona el texto y cópialo manualmente." });
    }
  }

  async function save() {
    setSaving(true);
    try {
      const summary = [
        `${STATUS_EMOJI[statusOf("budget", data.budget.status, options)]} presupuesto`,
        ...data.platforms.filter((p) => platforms.includes(p.platform)).map((p) => `${STATUS_EMOJI[statusOf(`active:${p.platform}`, p.activeStatus, options)]}${STATUS_EMOJI[statusOf(`conv:${p.platform}`, p.conversionStatus, options)]} ${p.name}`),
      ].join(" · ");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, businessDate: data.businessDate, cutoffHour: data.cutoffHour, platforms, summary }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; report?: { id: string } };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: "Guardado en el historial", description: d.report?.id });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<{ key: string; label: string; auto: ReportStatus | null; hint?: string }> = [
    { key: "budget", label: "Presupuesto y Línea de crédito", auto: data.budget.status, hint: data.budget.details.join(" · ") || "Forecast de cierre dentro de rango. La línea de crédito se confirma manualmente." },
    { key: "problems", label: "Problemas con Plataformas", auto: data.platformProblems.status, hint: data.platformProblems.details.join(" · ") || "Datos al día y cargas ejecutadas." },
    ...data.platforms
      .filter((p) => platforms.includes(p.platform))
      .flatMap((p) => [
        {
          key: `active:${p.platform}`,
          label: `Campañas activas en ${p.name}`,
          auto: p.activeStatus,
          hint:
            [
              p.zeroSpend.length && `${p.zeroSpend.length} campaña(s) sin gasto`,
              p.campaignsHigherVsYesterday.length && `${p.campaignsHigherVsYesterday.reduce((a, g) => a + g.campaigns.length, 0)} campaña(s) con más gasto que ayer`,
              p.spendLowerVsLastWeek.length && `${p.spendLowerVsLastWeek.length} cuenta(s) con menos gasto que la semana pasada`,
              p.spendHigherVsLastWeek.length && `${p.spendHigherVsLastWeek.length} cuenta(s) con más gasto que la semana pasada`,
              p.criticalIncidents.length && `${p.criticalIncidents.length} incidente(s) crítico(s)`,
            ]
              .filter(Boolean)
              .join(" · ") || "Sin variaciones relevantes.",
        },
        {
          key: `conv:${p.platform}`,
          label: `Fluctuación de Conversiones en ${p.name}`,
          auto: p.conversionStatus,
          hint: [p.conversionDropVsLastWeek.length && `${p.conversionDropVsLastWeek.length} cuenta(s) caen vs semana pasada`, p.conversionDropVsYesterday.length && `${p.conversionDropVsYesterday.length} vs ayer`].filter(Boolean).join(" · ") || `${p.metricLabel} estables.`,
        },
      ]),
    ...data.manualChecks.map((c) => ({ key: `manual:${c.id}`, label: c.label, auto: null, hint: "Revisión manual: marca el estado después de revisarlo." })),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-4 xl:col-span-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Plataformas del mensaje</CardTitle>
              <CardDescription>Corte {hourLabel(data.cutoffHour)} · hoy vs ayer y vs el {data.lastWeekDay} pasado (misma franja).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PLATFORM_IDS.map((p) => {
              const on = platforms.includes(p);
              const d = data.platforms.find((x) => x.platform === p)!;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPlatforms((cur) => (on ? cur.filter((x) => x !== p) : PLATFORM_IDS.filter((x) => cur.includes(x) || x === p)));
                    setEdited(null);
                  }}
                  className={cn("inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-medium transition-colors", on ? "border-primary/50 bg-primary/10" : "text-muted-foreground hover:text-foreground")}
                >
                  <PlatformMark platform={p} className="size-5 text-[9px]" /> {d.name}
                  {on && <Check className="size-3 text-primary" />}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Semáforos</CardTitle>
              <CardDescription>Se calculan solos; puedes corregirlos. Las revisiones manuales (Zapier) se marcan aquí.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {rows.map((r) => {
              const value = overrides[r.key] ?? r.auto ?? "ok";
              return (
                <div key={r.key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {r.label}
                      {overrides[r.key] && r.auto && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">corregido</span>}
                    </p>
                    {r.hint && <p className="text-[11px] text-muted-foreground">{r.hint}</p>}
                  </div>
                  <StatusToggle
                    label={r.label}
                    value={value}
                    auto={r.auto ?? "ok"}
                    onChange={(s) => {
                      setOverride(r.key, s);
                      setEdited(null);
                    }}
                  />
                </div>
              );
            })}
            <label className="flex items-center gap-2 border-t pt-2.5 text-xs">
              <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={includeConfidence} onChange={(e) => (setIncludeConfidence(e.target.checked), setEdited(null))} />
              Incluir la confianza de los datos ({data.confidence}%)
            </label>
          </CardContent>
        </Card>
        {canConfigure && <ReportConfig data={data} />}
      </div>

      <div className="flex flex-col gap-4 xl:col-span-7">
        <Card>
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle>Mensaje para WhatsApp</CardTitle>
              <CardDescription>Revisa, edita si hace falta y envíalo tú. La app no envía mensajes.</CardDescription>
            </div>
            <AnimatedTabs
              label="Vista del mensaje"
              active={view}
              onChange={setView}
              tabs={[
                { id: "preview", label: "Vista WhatsApp" },
                { id: "edit", label: "Editar texto" },
              ]}
            />
          </CardHeader>
          <CardContent className="space-y-3">
            {edited !== null && (
              <p className="flex items-center justify-between gap-2 rounded-md border border-status-attention/40 bg-status-attention/10 px-3 py-1.5 text-xs text-status-attention-text">
                Editaste el texto: los cambios de semáforos ya no se aplican solos.
                <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setEdited(null)}>
                  Volver al generado
                </button>
              </p>
            )}
            {view === "preview" ? (
              <div className="rounded-lg bg-[#0b141a] p-3 sm:p-4">
                <div className="ml-auto max-w-[560px] rounded-lg rounded-tr-none bg-[#005c4b] px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#e9edef] shadow">{text}</div>
              </div>
            ) : (
              <Textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={22} className="font-mono text-xs leading-relaxed" aria-label="Texto del mensaje" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => copy()}>{copied ? <Check /> : <ClipboardCopy />} {copied ? "Copiado" : "Copiar mensaje"}</Button>
              <Button variant="outline" asChild>
                <a href={whatsappLink(text)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> Abrir en WhatsApp
                </a>
              </Button>
              {canSave && (
                <Button variant="outline" onClick={save} disabled={saving}>
                  <Save /> {saving ? "Guardando…" : "Guardar en historial"}
                </Button>
              )}
              <Button variant="ghost" onClick={() => (setEdited(null), setOverrides({}), router.refresh())}>
                <RotateCcw /> Recalcular
              </Button>
              <span className="ml-auto text-[11px] text-muted-foreground">{text.length.toLocaleString("es-MX")} caracteres</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Historial de monitoreos
              </CardTitle>
              <CardDescription>Mensajes guardados en los últimos 30 días.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Aún no hay mensajes guardados.</p>
            ) : (
              <ul className="divide-y">
                {history.map((h) => (
                  <li key={h.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <UserAvatar name={h.by} size={20} />
                      <span className="font-medium">{h.by}</span>
                      <span className="tabular text-muted-foreground">
                        {formatDateTimeInTz(h.at, timezone)} · corte {hourLabel(h.cutoffHour)}
                      </span>
                      <span className="truncate text-muted-foreground">{h.summary}</span>
                      <span className="ml-auto flex gap-1">
                        <Button size="xs" variant="ghost" onClick={() => setOpenHistory(openHistory === h.id ? null : h.id)}>
                          {openHistory === h.id ? "Ocultar" : "Ver"}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => copy(h.text)}>
                          Copiar
                        </Button>
                      </span>
                    </div>
                    {openHistory === h.id && <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/60 p-2 font-sans text-xs whitespace-pre-wrap">{h.text}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReportConfig({ data }: { data: ReportData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inc, setInc] = useState(String(Math.round(data.thresholds.spendIncreaseVsYesterday * 100)));
  const [lw, setLw] = useState(String(Math.round(data.thresholds.spendChangeVsLastWeek * 100)));
  const [conv, setConv] = useState(String(Math.round(data.thresholds.conversionDrop * 100)));
  const [checks, setChecks] = useState(data.manualChecks.map((c) => c.label).join("\n"));
  const [note, setNote] = useState(data.closingNote);
  const [busy, setBusy] = useState(false);

  async function patch(path: string, value: unknown) {
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, value }) });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !d.ok) throw new Error(d.message ?? "No se pudo guardar");
  }

  async function save() {
    setBusy(true);
    try {
      const n = (v: string) => Math.min(300, Math.max(5, Number(v) || 0)) / 100;
      await patch("report.spendIncreaseVsYesterday", n(inc));
      await patch("report.spendChangeVsLastWeek", n(lw));
      await patch("report.conversionDrop", Math.min(1, n(conv)));
      await patch(
        "report.manualChecks",
        checks
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 12)
          .map((label, i) => ({ id: `check-${i + 1}`, label: label.slice(0, 80) })),
      );
      await patch("report.closingNote", note.slice(0, 400));
      sileo.success({ title: "Configuración del mensaje guardada" });
      router.refresh();
    } catch (err) {
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-4" /> Configurar mensaje
          </CardTitle>
          <CardDescription>Umbrales y revisiones manuales (administradores).</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Cerrar" : "Editar"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="rc-inc" className="text-xs">
                Más gasto que ayer (%)
              </Label>
              <Input id="rc-inc" inputMode="numeric" value={inc} onChange={(e) => setInc(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-lw" className="text-xs">
                Variación vs semana pasada (%)
              </Label>
              <Input id="rc-lw" inputMode="numeric" value={lw} onChange={(e) => setLw(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-conv" className="text-xs">
                Caída de conversiones (%)
              </Label>
              <Input id="rc-conv" inputMode="numeric" value={conv} onChange={(e) => setConv(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rc-checks" className="text-xs">
              Revisiones manuales (una por línea)
            </Label>
            <Textarea id="rc-checks" value={checks} onChange={(e) => setChecks(e.target.value)} rows={3} className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rc-note" className="text-xs">
              Nota de cierre ({"{umbral}"} = porcentaje de más gasto que ayer)
            </Label>
            <Textarea id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-xs" />
          </div>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Guardando…" : "Guardar configuración"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
