"use client";
import { sileo } from "sileo";
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { CampaignObjective, PlatformId, Severity, DataMode } from "@/lib/types";
import { CAMPAIGN_OBJECTIVES, PLATFORM_IDS } from "@/lib/types";
import type { MonitoringSettings, Recipient } from "@/lib/config/settings";
import { PLATFORMS } from "@/lib/platforms/registry";
import { OBJECTIVE_LABEL } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformMark } from "./status";

const TIMEZONES = ["America/Mexico_City", "America/Monterrey", "America/Merida", "America/Cancun", "America/Chihuahua", "America/Hermosillo", "America/Tijuana", "America/Bogota", "UTC"];
const SEVERITIES: Severity[] = ["ATTENTION", "ALERT", "CRITICAL"];
const SEV_ES: Record<Severity, string> = { NORMAL: "Normal", ATTENTION: "Atención", ALERT: "Alerta", CRITICAL: "Crítico" };

type Path = (string | number)[];

function setIn<T>(obj: T, path: Path, value: unknown): T {
  const clone = structuredClone(obj) as Record<string | number, unknown>;
  let cur = clone as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string | number, unknown>;
  cur[path[path.length - 1]] = value;
  return clone as T;
}

function Num({
  label,
  value,
  onChange,
  suffix,
  percent,
  min,
  max,
  step,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  percent?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const shown = percent ? Math.round(value * 1000) / 10 : value;
  const description = [(suffix || percent) && `${id}-unit`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          aria-describedby={description}
          value={Number.isFinite(shown) ? shown : 0}
          min={min}
          max={max}
          step={step ?? (percent ? 1 : 1)}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(percent ? n / 100 : n);
          }}
          className="h-8 w-28 text-xs"
        />
        {(suffix || percent) && <span id={`${id}-unit`} className="text-xs text-muted-foreground">{percent ? "%" : suffix}</span>}
      </div>
      {hint && <p id={`${id}-hint`} className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SevSelect({ value, onChange, disabled, id, label }: { value: Severity; onChange: (s: Severity) => void; disabled?: boolean; id?: string; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Severity)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEVERITIES.map((s) => (
          <SelectItem key={s} value={s}>
            {SEV_ES[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-4">{children}</CardContent>
    </Card>
  );
}

export function SettingsForm({
  initial,
  revision,
  canEdit,
  mode,
  campaigns,
}: {
  initial: MonitoringSettings;
  revision: string;
  canEdit: boolean;
  mode: DataMode;
  campaigns: Array<{ id: string; name: string; platform: PlatformId; objective: CampaignObjective }>;
}) {
  const formId = useId();
  const router = useRouter();
  const [s, setS] = useState<MonitoringSettings>(initial);
  const [baseline, setBaseline] = useState(initial);
  const [formRevision, setFormRevision] = useState(revision);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState("");
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(baseline), [s, baseline]);
  const set = (path: Path) => (v: unknown) => setS((cur) => setIn(cur, path, v));
  const d = !canEdit || saving;
  const slots = useMemo(() => {
    const out: number[] = [];
    for (let h = s.schedule.startHour; h <= s.schedule.endHour; h += Math.max(1, s.schedule.intervalHours)) out.push(h);
    return out;
  }, [s.schedule]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": formRevision }, body: JSON.stringify(s) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; revision?: string };
      if (!res.ok) {
        setConflicted(res.status === 412 || res.status === 428);
        throw new Error(data.message ?? "No se pudo guardar.");
      }
      setBaseline(s);
      if (data.revision) setFormRevision(data.revision);
      setConflicted(false);
      setMsg({ ok: true, text: mode === "bigquery" ? "Guardado en BigQuery para todo el equipo." : "Guardado para todo el equipo." });
      sileo.success({ title: "Configuración guardada", description: "Aplica para todo el equipo. No cambia nada en las plataformas." });
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "No se pudo guardar.";
      setMsg({ ok: false, text });
      sileo.error({ title: "No se pudo guardar", description: text });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "DELETE", headers: { "If-Match": formRevision } });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setConflicted(res.status === 412 || res.status === 428);
        throw new Error(data.message ?? "No se pudo restablecer la configuración.");
      }
      setMsg({ ok: true, text: "Se restauraron los valores por defecto." });
      sileo.success({ title: "Valores por defecto restaurados" });
      try { await reloadValues(); }
      catch {
        const text = "Se restableció la configuración, pero no se pudo recargar. Vuelve a cargar los valores vigentes.";
        setMsg({ ok: false, text });
        setConflicted(true);
        sileo.error({ title: "Configuración restablecida; recarga pendiente", description: text });
      }
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "No se pudo restablecer la configuración.";
      setMsg({ ok: false, text });
      sileo.error({ title: "No se pudo restablecer", description: text });
    } finally {
      setSaving(false);
    }
  }

  async function reloadValues() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings");
      const data = (await res.json()) as { settings?: MonitoringSettings; revision?: string; message?: string };
      if (!res.ok || !data.settings || !data.revision) throw new Error(data.message ?? "No se pudieron cargar los valores vigentes.");
      setS(data.settings);
      setBaseline(data.settings);
      setFormRevision(data.revision);
      setConflicted(false);
    } finally { setSaving(false); }
  }

  const updateRecipient = (i: number, patch: Partial<Recipient>) => setS((cur) => ({ ...cur, recipients: cur.recipients.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const filteredCampaigns = campaigns.filter((c) => !campaignFilter || c.name.toLowerCase().includes(campaignFilter.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {conflicted && <div className="rounded-md border p-3 text-sm">La configuración cambió mientras editabas. Tus cambios siguen en esta pantalla. Recargar reemplaza estos cambios por los valores guardados. <Button variant="outline" size="sm" disabled={saving} onClick={() => reloadValues().catch(error => sileo.error({ title: "No se pudo recargar", description: error instanceof Error ? error.message : undefined }))}>Recargar valores vigentes</Button></div>}
      {!canEdit && <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Solo un Admin puede modificar la configuración. Estás viendo los valores vigentes.</p>}

      <Section title="Semáforos" description="Desviación contra el valor esperado (mismo día y franja). Se combinan con volumen, variabilidad, hora y peso en el gasto.">
        <Num label="🟡 Atención desde" value={s.thresholds.attention} onChange={set(["thresholds", "attention"])} percent disabled={d} />
        <Num label="🟠 Alerta desde" value={s.thresholds.alert} onChange={set(["thresholds", "alert"])} percent disabled={d} />
        <Num label="🔴 Crítico mayor a" value={s.thresholds.critical} onChange={set(["thresholds", "critical"])} percent disabled={d} />
      </Section>

      <Section title="Frecuencia de monitoreo" description={`Corridas: ${slots.map((h) => `${String(h).padStart(2, "0")}:00`).join(" · ")}. El cron de n8n (WF07) debe coincidir.`}>
        <Num label="Cada (horas)" value={s.schedule.intervalHours} onChange={set(["schedule", "intervalHours"])} min={1} max={12} disabled={d} />
        <Num label="Primera corrida" value={s.schedule.startHour} onChange={set(["schedule", "startHour"])} min={0} max={23} suffix="h" disabled={d} />
        <Num label="Última corrida" value={s.schedule.endHour} onChange={set(["schedule", "endHour"])} min={0} max={23} suffix="h" disabled={d} />
      </Section>

      <Section title="Periodo histórico" description="Semanas del mismo día de la semana que forman la referencia.">
        <div className="space-y-1">
          <Label htmlFor={`${formId}-weeks`} className="text-[11px] text-muted-foreground">Semanas de referencia</Label>
          <div className="flex gap-1" role="group" aria-label="Semanas de referencia">
            {[4, 8, 12].map((w) => (
              <button key={w} type="button" disabled={d} aria-label={`${w} semanas de referencia`} aria-pressed={s.history.weeks === w} onClick={() => set(["history", "weeks"])(w)} className={cn("h-8 rounded-md border px-3 text-xs font-medium", s.history.weeks === w ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}>
                {w}
              </button>
            ))}
            <Input id={`${formId}-weeks`} type="number" min={1} max={12} value={s.history.weeks} disabled={d} onChange={(e) => set(["history", "weeks"])(Math.max(1, Math.min(12, Number(e.target.value) || 4)))} className="h-8 w-16 text-xs" aria-label="Semanas de referencia personalizadas" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-baseline`} className="text-[11px] text-muted-foreground">Valor esperado</Label>
          <Select value={s.history.baseline} onValueChange={(v) => set(["history", "baseline"])(v)} disabled={d}>
            <SelectTrigger id={`${formId}-baseline`} size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mean">Promedio</SelectItem>
              <SelectItem value="median">Mediana (robusta)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Num label="Mínimo de semanas con dato" value={s.history.minSamples} onChange={set(["history", "minSamples"])} min={1} max={12} disabled={d} />
      </Section>

      <Section title="Zona horaria de negocio" description="Todas las comparaciones (lunes vs lunes, hora vs hora) usan esta zona. Nunca se mezcla con UTC.">
        <Select value={s.timezone} onValueChange={(v) => set(["timezone"])(v)} disabled={d}>
          <SelectTrigger size="sm" className="w-56" aria-label="Zona horaria de negocio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([s.timezone, ...TIMEZONES])].map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Frescura de datos" description="Una fuente atrasada se marca como datos atrasados y no se evalúa su rendimiento.">
        <Num label="Datos atrasados después de" value={s.freshness.delayedAfterMinutes} onChange={set(["freshness", "delayedAfterMinutes"])} suffix="min" disabled={d} />
        <Num label="Atraso crítico después de" value={s.freshness.criticalAfterMinutes} onChange={set(["freshness", "criticalAfterMinutes"])} suffix="min" disabled={d} />
        <Num label="Tolerancia de hora completa" value={s.freshness.cutoffToleranceMinutes} onChange={set(["freshness", "cutoffToleranceMinutes"])} suffix="min" disabled={d} hint="Un dato a las 11:54 cuenta como corte 12:00." />
      </Section>

      <Section title="Volumen mínimo" description="Evita alertas por variaciones sin relevancia estadística.">
        <Num label="Gasto mínimo por campaña" value={s.volume.minCampaignSpend} onChange={set(["volume", "minCampaignSpend"])} suffix="MXN" disabled={d} />
        <Num label="Resultados mínimos por campaña" value={s.volume.minCampaignResults} onChange={set(["volume", "minCampaignResults"])} disabled={d} />
        <Num label="Gasto mínimo por plataforma" value={s.volume.minPlatformSpend} onChange={set(["volume", "minPlatformSpend"])} suffix="MXN" disabled={d} />
        <Num label="Resultados mínimos por plataforma" value={s.volume.minPlatformResults} onChange={set(["volume", "minPlatformResults"])} disabled={d} />
      </Section>

      <Section title="Detección" description="Reglas que ajustan la severidad y detectan patrones.">
        <Num label="Horas tempranas (baja 1 nivel antes de)" value={s.detection.earlyHour} onChange={set(["detection", "earlyHour"])} suffix="h" min={0} max={23} disabled={d} />
        <Num label="z mínimo (variabilidad)" value={s.detection.zScoreFloor} onChange={set(["detection", "zScoreFloor"])} step={0.1} disabled={d} />
        <Num label="Campaña material desde" value={s.detection.materialShare} onChange={set(["detection", "materialShare"])} percent disabled={d} hint="Del gasto esperado de su plataforma." />
        <Num label="Incidente de plataforma: campañas" value={s.detection.platformIncidentMinCampaigns} onChange={set(["detection", "platformIncidentMinCampaigns"])} min={2} disabled={d} />
        <Num label="…y participación mínima" value={s.detection.platformIncidentMinShare} onChange={set(["detection", "platformIncidentMinShare"])} percent disabled={d} />
        <Num label="“Dejó de gastar” (ventana reciente)" value={s.detection.stoppedSpendDrop} onChange={set(["detection", "stoppedSpendDrop"])} percent disabled={d} />
        <Num label="Cambio sostenido: días seguidos" value={s.detection.sustainedDays} onChange={set(["detection", "sustainedDays"])} min={2} max={7} suffix="días" disabled={d} hint="Si el gasto lleva estos días en otro nivel, la severidad se mide contra ese nivel nuevo." />
      </Section>

      <Section title="Alertas y escalamiento" description="Anti-spam: una alerta por anomalía; se notifica solo al abrir, escalar, empeorar, superar la duración o recuperarse.">
        <div className="space-y-1">
          <Label htmlFor={`${formId}-incident-severity`} className="text-[11px] text-muted-foreground">Incidente inmediato desde</Label>
          <SevSelect id={`${formId}-incident-severity`} label="Incidente inmediato desde" value={s.alerts.incidentMinSeverity} onChange={set(["alerts", "incidentMinSeverity"])} disabled={d} />
        </div>
        <Num label="…o tras N evaluaciones" value={s.alerts.persistRunsForIncident} onChange={set(["alerts", "persistRunsForIncident"])} min={1} max={12} disabled={d} />
        <div className="space-y-1">
          <Label htmlFor={`${formId}-notify-severity`} className="text-[11px] text-muted-foreground">Notificar desde</Label>
          <SevSelect id={`${formId}-notify-severity`} label="Notificar desde" value={s.alerts.notifyMinSeverity} onChange={set(["alerts", "notifyMinSeverity"])} disabled={d} />
        </div>
        <Num label="Re-notificar si empeora" value={s.alerts.worsenDeltaPts} onChange={set(["alerts", "worsenDeltaPts"])} percent disabled={d} hint="Puntos porcentuales de desviación." />
        <Num label="Escalar tras" value={s.alerts.escalateAfterHours} onChange={set(["alerts", "escalateAfterHours"])} suffix="h" disabled={d} />
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch id={`${formId}-recovery`} checked={s.alerts.notifyRecovery} onCheckedChange={set(["alerts", "notifyRecovery"])} disabled={d} />
          <Label htmlFor={`${formId}-recovery`} className="text-xs font-normal">
            Notificar recuperación
          </Label>
        </div>
      </Section>

      <Section title="Budget Control" description="Estado según el forecast de cierre del mes vs presupuesto.">
        <Num label="Sobreejercicio: atención" value={s.budget.overspendAttention} onChange={set(["budget", "overspendAttention"])} percent disabled={d} />
        <Num label="Sobreejercicio: alerta" value={s.budget.overspendAlert} onChange={set(["budget", "overspendAlert"])} percent disabled={d} />
        <Num label="Sobreejercicio: crítico" value={s.budget.overspendCritical} onChange={set(["budget", "overspendCritical"])} percent disabled={d} />
        <Num label="Subejercicio: atención" value={s.budget.underspendAttention} onChange={set(["budget", "underspendAttention"])} percent disabled={d} />
        <Num label="Subejercicio: alerta" value={s.budget.underspendAlert} onChange={set(["budget", "underspendAlert"])} percent disabled={d} />
      </Section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Destinatarios</CardTitle>
            <CardDescription>Se envían a n8n junto con cada notificación (servidor a servidor). En pantalla, los números se muestran enmascarados para roles sin permiso.</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={d}
            onClick={() => setS((cur) => ({ ...cur, recipients: [...cur.recipients, { id: `rcp-${Date.now()}`, name: "Nuevo destinatario", channel: "whatsapp", address: "+52 ", minSeverity: "ALERT", platforms: "all", active: true }] }))}
          >
            <Plus /> Agregar
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Severidad mínima</TableHead>
                <TableHead>Plataformas</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.recipients.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Input value={r.name} disabled={d} onChange={(e) => updateRecipient(i, { name: e.target.value })} className="h-8 w-44 text-xs" aria-label={`Nombre del destinatario ${i + 1}`} />
                  </TableCell>
                  <TableCell>
                    <Select value={r.channel} onValueChange={(v) => updateRecipient(i, { channel: v as Recipient["channel"] })} disabled={d}>
                      <SelectTrigger size="sm" className="w-28" aria-label={`Canal del destinatario ${i + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input value={r.address} disabled={d} onChange={(e) => updateRecipient(i, { address: e.target.value })} className="h-8 w-48 text-xs" aria-label={`Dirección del destinatario ${i + 1}`} />
                  </TableCell>
                  <TableCell>
                    <SevSelect label={`Severidad mínima del destinatario ${i + 1}`} value={r.minSeverity} onChange={(v) => updateRecipient(i, { minSeverity: v })} disabled={d} />
                  </TableCell>
                  <TableCell>
                    <Select value={r.platforms === "all" ? "all" : r.platforms[0] ?? "all"} onValueChange={(v) => updateRecipient(i, { platforms: v === "all" ? "all" : [v as PlatformId] })} disabled={d}>
                      <SelectTrigger size="sm" className="w-36" aria-label={`Plataformas del destinatario ${i + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {PLATFORM_IDS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PLATFORMS[p].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch checked={r.active} onCheckedChange={(v) => updateRecipient(i, { active: v })} disabled={d} aria-label={`Destinatario ${i + 1} activo`} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon-sm" variant="ghost" disabled={d} aria-label={`Quitar destinatario ${i + 1}`} onClick={() => setS((cur) => ({ ...cur, recipients: cur.recipients.filter((_, idx) => idx !== i) }))}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Objetivos de campaña</CardTitle>
            <CardDescription>El objetivo define el KPI con el que se evalúa cada campaña (Sales → ventas y CPA, Leads → leads y CPL, WhatsApp → conversaciones…).</CardDescription>
          </div>
          <Input value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} placeholder="Filtrar campañas…" className="h-8 w-52 text-xs" aria-label="Filtrar campañas" />
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaña</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Detectado</TableHead>
                  <TableHead>Objetivo asignado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCampaigns.map((c) => {
                  const override = s.objectiveOverrides[c.id];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-80 truncate text-xs font-medium" title={c.name}>
                        {c.name}
                      </TableCell>
                      <TableCell>
                        <PlatformMark platform={c.platform} className="size-5 text-[9px]" />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{OBJECTIVE_LABEL[c.objective]}</TableCell>
                      <TableCell>
                        <Select
                          value={override ?? "auto"}
                          disabled={d}
                          onValueChange={(v) =>
                            setS((cur) => {
                              const next = { ...cur.objectiveOverrides };
                              if (v === "auto") delete next[c.id];
                              else next[c.id] = v as CampaignObjective;
                              return { ...cur, objectiveOverrides: next };
                            })
                          }
                        >
                          <SelectTrigger size="sm" className="w-40" aria-label={`Objetivo asignado a ${c.name} (${c.id})`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Automático ({OBJECTIVE_LABEL[c.objective]})</SelectItem>
                            {CAMPAIGN_OBJECTIVES.map((o) => (
                              <SelectItem key={o} value={o}>
                                {OBJECTIVE_LABEL[o]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="sticky bottom-0 z-30 -mx-3 border-t bg-background/90 px-4 py-2.5 backdrop-blur sm:-mx-5 lg:-mx-6">
          <div className="mx-auto flex max-w-[1680px] items-center justify-end gap-2">
            {msg && <span className={cn("mr-auto text-xs", msg.ok ? "text-status-normal-text" : "text-status-critical-text")}>{msg.text}</span>}
            {dirty && !msg && <span className="mr-auto text-xs text-muted-foreground">Cambios sin guardar</span>}
            <Button variant="outline" size="sm" onClick={reset} disabled={saving}>
              <RotateCcw /> Valores por defecto
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              <Save /> {saving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
