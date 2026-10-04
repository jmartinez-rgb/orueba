"use client";
import { useMemo, useState } from "react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { APPROVAL_CHANNEL_LABEL, APPROVAL_CHANNELS, NOVEDAD_KIND_LABEL, NOVEDAD_KINDS, type ApprovalChannel, type Novedad, type NovedadKind } from "@/lib/records/novedad-model";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { PlatformMark } from "@/components/monitoring/status";

export interface ScopeCatalog {
  platforms: PlatformId[];
  accounts: Array<{ id: string; name: string; platform: PlatformId }>;
  campaigns: Array<{ id: string; name: string; platform: PlatformId; accountId: string }>;
}

export interface NovedadPrefill {
  kind: NovedadKind;
  title: string;
  detail?: string;
  platform: PlatformId | null;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Desviación actual (fracción): se propone como cambio esperado. */
  expectedChange: number | null;
  includesFullStop?: boolean;
  incidentId: string | null;
  alertFingerprint: string | null;
}

const ALL = "__all";
const SILENCE_BY_DEFAULT: NovedadKind[] = ["PRESUPUESTO", "PAUSA", "ACTIVACION", "PLATAFORMA", "ESTRATEGIA"];

function addDaysIso(d: string, n: number) {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * Registro de una novedad: qué se ajustó, en qué alcance, quién lo aprobó, por qué medio y desde
 * cuándo. Desde una alerta llega con el alcance ya fijo.
 */
export function NovedadForm({
  open,
  onOpenChange,
  today,
  catalog,
  prefill,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  today: string;
  catalog?: ScopeCatalog;
  prefill?: NovedadPrefill | null;
  onCreated?: (n: Novedad) => void;
}) {
  const locked = Boolean(prefill);
  const [kind, setKind] = useState<NovedadKind>(prefill?.kind ?? "PRESUPUESTO");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [detail, setDetail] = useState(prefill?.detail ?? "");
  const [platform, setPlatform] = useState<PlatformId | null>(prefill?.platform ?? null);
  const [accountId, setAccountId] = useState<string | null>(prefill?.accountId ?? null);
  const [campaignText, setCampaignText] = useState(prefill?.campaignName ?? "");
  const [approvedBy, setApprovedBy] = useState("");
  const [channel, setChannel] = useState<ApprovalChannel>("WHATSAPP");
  const [approvalRef, setApprovalRef] = useState("");
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState(prefill ? addDaysIso(today, 7) : "");
  const [budget, setBudget] = useState("");
  const [change, setChange] = useState(prefill?.expectedChange !== null && prefill?.expectedChange !== undefined ? String(Math.round(prefill.expectedChange * 100)) : "");
  const [fullStop, setFullStop] = useState(Boolean(prefill?.includesFullStop));
  const [silence, setSilence] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = useMemo(() => (catalog?.accounts ?? []).filter((a) => !platform || a.platform === platform), [catalog, platform]);
  const campaigns = useMemo(() => (catalog?.campaigns ?? []).filter((c) => (!platform || c.platform === platform) && (!accountId || c.accountId === accountId)), [catalog, platform, accountId]);
  const campaign = locked ? (prefill?.campaignId ? { id: prefill.campaignId, name: prefill.campaignName ?? prefill.campaignId } : null) : (campaigns.find((c) => c.name === campaignText.trim()) ?? null);
  const accountName = locked ? prefill!.accountName : (accounts.find((a) => a.id === accountId)?.name ?? null);

  function pickKind(k: NovedadKind) {
    setKind(k);
    setSilence(SILENCE_BY_DEFAULT.includes(k));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const budgetAmount = Number(budget.replace(/[^\d.]/g, ""));
      const changeNum = change.trim() === "" ? null : Number(change) / 100;
      const res = await fetch("/api/novedades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title,
          detail,
          platform,
          accountId: locked ? prefill!.accountId : accountId,
          accountName,
          campaignId: campaign?.id ?? null,
          campaignName: campaign?.name ?? (campaignText.trim() || null),
          approvedBy,
          approvalChannel: channel,
          approvalRef: approvalRef || null,
          effectiveFrom: from,
          effectiveUntil: until || null,
          budget: kind === "PRESUPUESTO" && budgetAmount > 0 ? { month: from.slice(0, 7), amount: budgetAmount } : null,
          expectedChange: changeNum !== null && Number.isFinite(changeNum) ? changeNum : null,
          includesFullStop: fullStop,
          silenceAlerts: silence,
          incidentId: prefill?.incidentId ?? null,
          alertFingerprint: prefill?.alertFingerprint ?? null,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; novedad?: Novedad };
      if (!res.ok || !d.ok || !d.novedad) {
        setError(d.message ?? "No se pudo registrar la novedad.");
        return;
      }
      sileo.success({ title: `Novedad ${d.novedad.id} registrada`, description: silence ? "El monitoreo la toma en cuenta desde ahora." : d.novedad.title });
      onCreated?.(d.novedad);
      onOpenChange(false);
    } catch {
      setError("Sin conexión con el servidor. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const needsBudget = kind === "PRESUPUESTO";
  const valid = title.trim().length >= 5 && approvedBy.trim().length >= 2 && (!needsBudget || Number(budget.replace(/[^\d.]/g, "")) > 0) && (!silence || platform !== null) && (!until || until >= from);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{locked ? "Registrar como novedad aprobada" : "Nueva novedad"}</DialogTitle>
          <DialogDescription>Queda en el historial con quién lo aprobó y por qué medio. El monitoreo lo toma en cuenta; no cambia nada en las plataformas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo de ajuste</Label>
              <Select value={kind} onValueChange={(v) => pickKind(v as NovedadKind)}>
                <SelectTrigger aria-label="Tipo de ajuste" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOVEDAD_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {NOVEDAD_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-title">Título</Label>
              <Input id="nv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Pausa de campañas de septiembre en MXN 1" />
            </div>
          </div>

          <fieldset className="grid gap-3 rounded-xl bg-foreground/[0.03] p-3">
            <legend className="sr-only">Alcance</legend>
            <p className="text-[13px] font-medium">Alcance</p>
            {locked ? (
              <p className="flex items-center gap-2 text-[13px]">
                {platform && <PlatformMark platform={platform} className="size-5 text-[9px]" />}
                <span>
                  {platform ? PLATFORMS[platform].name : "Toda la marca"}
                  {prefill?.accountName ? ` · Cuenta ${prefill.accountName}` : ""}
                  {prefill?.campaignName ? ` · ${prefill.campaignName}` : ""}
                </span>
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Plataforma</Label>
                  <Select
                    value={platform ?? ALL}
                    onValueChange={(v) => {
                      setPlatform(v === ALL ? null : (v as PlatformId));
                      setAccountId(null);
                      setCampaignText("");
                    }}
                  >
                    <SelectTrigger aria-label="Plataforma" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Toda la marca</SelectItem>
                      {(catalog?.platforms ?? []).map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLATFORMS[p].name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cuenta</Label>
                  <Select
                    value={accountId ?? ALL}
                    disabled={!platform}
                    onValueChange={(v) => {
                      setAccountId(v === ALL ? null : v);
                      setCampaignText("");
                    }}
                  >
                    <SelectTrigger aria-label="Cuenta" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nv-camp">Campaña (opcional)</Label>
                  <Input id="nv-camp" list="nv-camp-list" value={campaignText} disabled={!platform} onChange={(e) => setCampaignText(e.target.value)} placeholder="Todas" />
                  <datalist id="nv-camp-list">
                    {campaigns.slice(0, 300).map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="nv-by">Quién lo aprobó</Label>
              <Input id="nv-by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} maxLength={120} placeholder="Nombre y área" />
            </div>
            <div className="space-y-1.5">
              <Label>Medio de aprobación</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as ApprovalChannel)}>
                <SelectTrigger aria-label="Medio de aprobación" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPROVAL_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {APPROVAL_CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-ref">Referencia (opcional)</Label>
              <Input id="nv-ref" value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} maxLength={160} placeholder="Correo del 3 oct, chat…" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="nv-from">Aplica desde</Label>
              <Input id="nv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-until">Hasta</Label>
              <Input id="nv-until" type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Vacío = todo el mes.</p>
            </div>
            {needsBudget ? (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="nv-budget">Nuevo presupuesto mensual (MXN)</Label>
                <Input id="nv-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="1,200,000" />
                <p className="text-[11px] text-muted-foreground">Reemplaza el presupuesto del alcance para {from.slice(0, 7)}; el pacing lo usa desde hoy.</p>
              </div>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="nv-change">Cambio esperado en el gasto (%)</Label>
                <Input id="nv-change" inputMode="numeric" value={change} onChange={(e) => setChange(e.target.value)} placeholder="-80" />
                <p className="text-[11px] text-muted-foreground">Si el gasto cae más de 10 puntos por debajo de esto, vuelve a alertar.</p>
              </div>
            )}
          </div>

          <div className="grid gap-2 rounded-xl bg-foreground/[0.03] p-3">
            <label className="flex items-start justify-between gap-3 text-[13px]">
              <span>
                <span className="font-medium">El monitoreo lo toma en cuenta</span>
                <span className="block text-xs text-muted-foreground">Mientras esté vigente, los cambios de gasto de este alcance no generan alertas ni incidentes.</span>
              </span>
              <Switch checked={silence} onCheckedChange={setSilence} aria-label="El monitoreo lo toma en cuenta" />
            </label>
            {silence && (kind === "PAUSA" || kind === "PLATAFORMA") && (
              <label className="flex items-start justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium">Incluye apagar todo el alcance</span>
                  <span className="block text-xs text-muted-foreground">Si no se marca, un apagado total de este alcance vuelve a alertar como crítico.</span>
                </span>
                <Switch checked={fullStop} onCheckedChange={setFullStop} aria-label="Incluye apagar todo el alcance" />
              </label>
            )}
            {silence && !platform && <p className="text-xs text-status-attention-text">Elige la plataforma para que el monitoreo pueda tomarla en cuenta.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nv-detail">Detalle (opcional)</Label>
            <Textarea id="nv-detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={4000} placeholder="Qué se ajustó, por qué y qué se espera." />
          </div>
          {error && (
            <p role="alert" className="text-xs font-medium text-status-critical-text">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            {busy ? "Registrando…" : "Registrar novedad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
