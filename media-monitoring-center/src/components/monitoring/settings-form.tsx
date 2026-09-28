"use client";
import { sileo } from "sileo";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { CampaignObjective, PlatformId, Severity } from "@/lib/types";
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
  const shown = percent ? Math.round(value * 1000) / 10 : value;
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
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
        {(suffix || percent) && <span className="text-xs text-muted-foreground">{percent ? "%" : suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SevSelect({ value, onChange, disabled }: { value: Severity; onChange: (s: Severity) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Severity)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-32">
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
  canEdit,
  mode,
  campaigns,
}: {
  initial: MonitoringSettings;
  canEdit: boolean;
  mode: "mock" | "bigquery";
  campaigns: Array<{ id: string; name: string; platform: PlatformId; objective: CampaignObjective }>;
}) {
  const router = useRouter();
  const [s, setS] = useState<MonitoringSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [campaignFilter, setCampaignFilter] = useState("");
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(initial), [s, initial]);
  const set = (path: Path) => (v: unknown) => setS((cur) => setIn(cur, path, v));
  const d = !canEdit;
  const slots = useMemo(() => {
    const out: number[] = [];
    for (let h = s.schedule.startHour; h <= s.schedule.endHour; h += Math.max(1, s.schedule.intervalHours)) out.push(h);
    return out;
  }, [s.schedule]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.message ?? "No se pudo guardar." });
      sileo.error({ title: "No se pudo guardar", description: data.message });
    } else {
      setMsg({ ok: true, text: mode === "mock" ? "Guardado para todo el equipo." : "Guardado en BigQuery para todo el equipo." });
      sileo.success({ title: "Configuración guardada", description: "Aplica para todo el equipo. No cambia nada en las plataformas." });
      router.refresh();
    }
  }

  async function reset() {
    setSaving(true);
    await fetch("/api/settings", { method: "DELETE" });
    setSaving(false);
    setMsg({ ok: true, text: "Se restauraron los valores por defecto." });
    sileo.success({ title: "Valores por defecto restaurados" });
    router.refresh();
  }

  const updateRecipient = (i: number, patch: Partial<Recipient>) => setS((cur) => ({ ...cur, recipients: cur.recipients.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const filteredCampaigns = campaigns.filter((c) => !campaignFilter || c.name.toLowerCase().includes(campaignFilter.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
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
          <Label className="text-[11px] text-muted-foreground">Semanas de referencia</Label>
          <div className="flex gap-1">
            {[4, 8, 12].map((w) => (
              <button key={w} type="button" disabled={d} onClick={() => set(["history", "weeks"])(w)} className={cn("h-8 rounded-md border px-3 text-xs font-medium", s.history.weeks === w ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}>
                {w}
              </button>
            ))}
            <Input type="number" min={1} max={12} value={s.history.weeks} disabled={d} onChange={(e) => set(["history", "weeks"])(Math.max(1, Math.min(12, Number(e.target.value) || 4)))} className="h-8 w-16 text-xs" aria-label="Semanas personalizadas" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Valor esperado</Label>
          <Select value={s.history.baseline} onValueChange={(v) => set(["history", "baseline"])(v)} disabled={d}>
            <SelectTrigger size="sm" className="w-44">
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
          <SelectTrigger size="sm" className="w-56">
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

      <Section title="Frescura de datos" description="Una fuente atrasada muestra DATA DELAYED y no se evalúa su rendimiento.">
        <Num label="DATA DELAYED después de" value={s.freshness.delayedAfterMinutes} onChange={set(["freshness", "delayedAfterMinutes"])} suffix="min" disabled={d} />
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
      </Section>

      <Section title="Alertas y escalamiento" description="Anti-spam: una alerta por anomalía; se notifica solo al abrir, escalar, empeorar, superar la duración o recuperarse.">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Incidente inmediato desde</Label>
          <SevSelect value={s.alerts.incidentMinSeverity} onChange={set(["alerts", "incidentMinSeverity"])} disabled={d} />
        </div>
        <Num label="…o tras N evaluaciones" value={s.alerts.persistRunsForIncident} onChange={set(["alerts", "persistRunsForIncident"])} min={1} max={12} disabled={d} />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Notificar desde</Label>
          <SevSelect value={s.alerts.notifyMinSeverity} onChange={set(["alerts", "notifyMinSeverity"])} disabled={d} />
        </div>
        <Num label="Re-notificar si empeora" value={s.alerts.worsenDeltaPts} onChange={set(["alerts", "worsenDeltaPts"])} percent disabled={d} hint="Puntos porcentuales de desviación." />
        <Num label="Escalar tras" value={s.alerts.escalateAfterHours} onChange={set(["alerts", "escalateAfterHours"])} suffix="h" disabled={d} />
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch id="recovery" checked={s.alerts.notifyRecovery} onCheckedChange={set(["alerts", "notifyRecovery"])} disabled={d} />
          <Label htmlFor="recovery" className="text-xs font-normal">
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
                    <Input value={r.name} disabled={d} onChange={(e) => updateRecipient(i, { name: e.target.value })} className="h-8 w-44 text-xs" aria-label="Nombre" />
                  </TableCell>
                  <TableCell>
                    <Select value={r.channel} onValueChange={(v) => updateRecipient(i, { channel: v as Recipient["channel"] })} disabled={d}>
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input value={r.address} disabled={d} onChange={(e) => updateRecipient(i, { address: e.target.value })} className="h-8 w-48 text-xs" aria-label="Dirección" />
                  </TableCell>
                  <TableCell>
                    <SevSelect value={r.minSeverity} onChange={(v) => updateRecipient(i, { minSeverity: v })} disabled={d} />
                  </TableCell>
                  <TableCell>
                    <Select value={r.platforms === "all" ? "all" : r.platforms[0] ?? "all"} onValueChange={(v) => updateRecipient(i, { platforms: v === "all" ? "all" : [v as PlatformId] })} disabled={d}>
                      <SelectTrigger size="sm" className="w-36">
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
                    <Switch checked={r.active} onCheckedChange={(v) => updateRecipient(i, { active: v })} disabled={d} aria-label="Activo" />
                  </TableCell>
                  <TableCell>
                    <Button size="icon-sm" variant="ghost" disabled={d} aria-label="Quitar" onClick={() => setS((cur) => ({ ...cur, recipients: cur.recipients.filter((_, idx) => idx !== i) }))}>
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
                          <SelectTrigger size="sm" className="w-40">
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
