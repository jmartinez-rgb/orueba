"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { sileo } from "sileo";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { KICKOFF_STATE_LABEL, type KickoffBudget, type KickoffItem, type KickoffState } from "@/lib/records/novedad-model";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformMark } from "@/components/monitoring/status";

export interface KickoffCampaign {
  id: string;
  name: string;
  platform: PlatformId;
  accountName: string | null;
  statusText: string | null;
  spentRecently: boolean;
  suggested: KickoffState;
}

const STATES: KickoffState[] = ["ACTIVE", "PENDING", "ENDED"];
const STATE_SHORT: Record<KickoffState, string> = { ACTIVE: "Activa", PENDING: "Pendiente", ENDED: "No corre" };
const parseAmount = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
const money = (v: number) => `$${Math.round(v).toLocaleString("es-MX")}`;

/**
 * Arranque de mes: presupuestos (obligatorios) y qué campañas están activas, pendientes por iniciar
 * o no corren. Lo pendiente no se alerta como "sin gasto" y se avisa a diario hasta que inicie.
 */
export function KickoffWizard({
  month,
  monthLabel,
  platforms,
  accounts,
  campaigns,
  initialBudgets,
  initialItems,
  sheetBudgets,
}: {
  month: string;
  monthLabel: string;
  platforms: PlatformId[];
  accounts: Array<{ id: string; name: string; platform: PlatformId }>;
  campaigns: KickoffCampaign[];
  initialBudgets: KickoffBudget[];
  initialItems: KickoffItem[];
  /** Presupuesto por plataforma que ya trae la hoja (sugerencia). */
  sheetBudgets: Partial<Record<PlatformId, number>>;
}) {
  const router = useRouter();
  const [platformBudget, setPlatformBudget] = useState<Record<string, string>>(() =>
    Object.fromEntries(platforms.map((p) => [p, String(initialBudgets.find((b) => b.platform === p && !b.accountId)?.amount ?? sheetBudgets[p] ?? "")])),
  );
  const [accountBudgets, setAccountBudgets] = useState<Array<{ accountId: string; amount: string }>>(() =>
    initialBudgets.filter((b) => b.accountId).map((b) => ({ accountId: b.accountId!, amount: String(b.amount) })),
  );
  const [states, setStates] = useState<Record<string, { state: KickoffState; expectedStart: string }>>(() => {
    const out: Record<string, { state: KickoffState; expectedStart: string }> = {};
    for (const c of campaigns) {
      const prev = initialItems.find((i) => i.campaignId === c.id);
      out[c.id] = { state: prev?.state ?? c.suggested, expectedStart: prev?.expectedStart ?? "" };
    }
    return out;
  });
  const [manual, setManual] = useState<KickoffItem[]>(() => initialItems.filter((i) => i.key.startsWith("pend:")));
  const [filterPlatform, setFilterPlatform] = useState<PlatformId | "all">("all");
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [newPlatform, setNewPlatform] = useState<PlatformId>(platforms[0] ?? "meta");
  const [newAccount, setNewAccount] = useState("");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return campaigns.filter((c) => (filterPlatform === "all" || c.platform === filterPlatform) && (!t || c.name.toLowerCase().includes(t) || (c.accountName ?? "").toLowerCase().includes(t)));
  }, [campaigns, filterPlatform, q]);
  const count = (s: KickoffState) => campaigns.filter((c) => states[c.id]?.state === s).length + manual.filter((m) => m.state === s).length;
  const missing = platforms.filter((p) => parseAmount(platformBudget[p] ?? "") <= 0 && !accountBudgets.some((b) => accounts.find((a) => a.id === b.accountId)?.platform === p && parseAmount(b.amount) > 0));
  const total = platforms.reduce((a, p) => a + parseAmount(platformBudget[p] ?? ""), 0);

  function setState(id: string, state: KickoffState) {
    setStates((cur) => ({ ...cur, [id]: { ...cur[id], state } }));
  }

  function addManual() {
    if (newName.trim().length < 2) return;
    setManual((cur) => [
      ...cur,
      { key: `pend:${Date.now().toString(36)}`, platform: newPlatform, accountName: newAccount.trim() || null, campaignId: null, name: newName.trim(), state: "PENDING", expectedStart: newDate || null, note: null, startedAt: null },
    ]);
    setNewName("");
    setNewAccount("");
    setNewDate("");
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const budgets: KickoffBudget[] = [
        ...platforms.filter((p) => parseAmount(platformBudget[p] ?? "") > 0).map((p) => ({ platform: p, accountId: null, accountName: null, amount: parseAmount(platformBudget[p]) })),
        ...accountBudgets
          .filter((b) => b.accountId && parseAmount(b.amount) > 0)
          .map((b) => {
            const acc = accounts.find((a) => a.id === b.accountId)!;
            return { platform: acc.platform, accountId: acc.id, accountName: acc.name, amount: parseAmount(b.amount) };
          }),
      ];
      const items: KickoffItem[] = [
        ...campaigns.map((c) => ({
          key: c.id,
          platform: c.platform,
          accountName: c.accountName,
          campaignId: c.id,
          name: c.name,
          state: states[c.id].state,
          expectedStart: states[c.id].state === "PENDING" ? states[c.id].expectedStart || null : null,
          note: null,
          startedAt: initialItems.find((i) => i.campaignId === c.id)?.startedAt ?? null,
        })),
        ...manual,
      ];
      const res = await fetch("/api/kickoff", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, budgets, items }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        setError(d.message ?? "No se pudo guardar el arranque.");
        return;
      }
      sileo.success({ title: `Arranque de ${monthLabel} confirmado`, description: "Queda en Novedades. El monitoreo ya usa estos presupuestos." });
      router.push("/novedades");
      router.refresh();
    } catch {
      setError("Sin conexión con el servidor. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="surface p-5">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">1. Presupuestos de {monthLabel}</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">Obligatorio para cada plataforma. Monto mensual en MXN. Si la hoja ya trae un presupuesto, aparece como sugerencia.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {platforms.map((p) => (
            <div key={p} className={cn("rounded-xl bg-foreground/[0.03] p-3", missing.includes(p) && "ring-1 ring-status-attention/50")}>
              <Label htmlFor={`kb-${p}`} className="mb-1.5 flex items-center gap-2">
                <PlatformMark platform={p} className="size-5 text-[9px]" /> {PLATFORMS[p].name}
              </Label>
              <Input id={`kb-${p}`} inputMode="decimal" value={platformBudget[p] ?? ""} onChange={(e) => setPlatformBudget((cur) => ({ ...cur, [p]: e.target.value }))} placeholder="0" className="tabular" />
              {sheetBudgets[p] !== undefined && <p className="mt-1 text-[11px] text-muted-foreground">En la hoja: {money(sheetBudgets[p]!)}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-[13px] font-medium">Presupuesto por cuenta (opcional)</p>
          {accountBudgets.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select value={b.accountId} onValueChange={(v) => setAccountBudgets((cur) => cur.map((x, j) => (j === i ? { ...x, accountId: v } : x)))}>
                <SelectTrigger className="w-72" aria-label="Cuenta">
                  <SelectValue placeholder="Elige la cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {PLATFORMS[a.platform].shortName} · {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input inputMode="decimal" value={b.amount} onChange={(e) => setAccountBudgets((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="Monto MXN" className="w-40 tabular" aria-label="Monto" />
              <Button variant="ghost" size="icon" onClick={() => setAccountBudgets((cur) => cur.filter((_, j) => j !== i))} aria-label="Quitar">
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setAccountBudgets((cur) => [...cur, { accountId: "", amount: "" }])}>
            <Plus /> Agregar presupuesto por cuenta
          </Button>
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">2. Qué está activo y qué falta por iniciar</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Lo <b>pendiente por iniciar</b> no se alerta como campaña sin gasto y se recuerda una vez al día hasta que empiece a gastar (se detecta solo). Lo que <b>no corre este mes</b> tampoco se alerta.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={filterPlatform} onValueChange={(v) => setFilterPlatform(v as PlatformId | "all")}>
            <SelectTrigger size="sm" className="w-40" aria-label="Plataforma">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {platforms.map((p) => (
                <SelectItem key={p} value={p}>
                  {PLATFORMS[p].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campaña o cuenta…" className="h-8 pl-8 text-xs" aria-label="Buscar campaña" />
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setStates((cur) => ({ ...cur, ...Object.fromEntries(visible.map((c) => [c.id, { ...cur[c.id], state: "ACTIVE" as const }])) }))}>
            Marcar visibles como activas
          </Button>
        </div>
        <ul className="divide-y divide-(--hairline) overflow-hidden rounded-xl bg-foreground/[0.03]">
          {visible.map((c) => {
            const st = states[c.id];
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <PlatformMark platform={c.platform} className="size-5 text-[9px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium" title={c.name}>
                    {c.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.accountName ?? ""}
                    {c.statusText ? ` · ${c.statusText}` : ""}
                    {c.spentRecently ? " · gastó esta semana" : " · sin gasto reciente"}
                  </span>
                </span>
                <div role="radiogroup" aria-label={`Estado de ${c.name}`} className="flex rounded-full bg-foreground/[0.06] p-0.5 text-[12px]">
                  {STATES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={st.state === s}
                      onClick={() => setState(c.id, s)}
                      className={cn("pressable rounded-full px-2.5 py-1 font-medium transition-colors", st.state === s ? "bg-card text-foreground shadow-(--shadow-control)" : "text-muted-foreground hover:text-foreground")}
                    >
                      {STATE_SHORT[s]}
                    </button>
                  ))}
                </div>
                {st.state === "PENDING" && (
                  <Input type="date" value={st.expectedStart} min={`${month}-01`} onChange={(e) => setStates((cur) => ({ ...cur, [c.id]: { ...cur[c.id], expectedStart: e.target.value } }))} className="h-8 w-36 text-xs" aria-label="Fecha esperada de inicio" />
                )}
              </li>
            );
          })}
          {!visible.length && <li className="px-3.5 py-3 text-[13px] text-muted-foreground">Sin campañas con este filtro.</li>}
        </ul>

        <div className="mt-4 rounded-xl bg-foreground/[0.03] p-3">
          <p className="mb-2 text-[13px] font-medium">Campañas pendientes que aún no aparecen en la hoja</p>
          {manual.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {manual.map((m) => (
                <li key={m.key} className="flex items-center gap-2 text-[13px]">
                  <PlatformMark platform={m.platform} className="size-5 text-[9px]" />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.accountName ? ` · ${m.accountName}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground tabular">{m.startedAt ? "Ya inició" : m.expectedStart ? `Inicia ${m.expectedStart}` : "Sin fecha"}</span>
                  <Button variant="ghost" size="icon" onClick={() => setManual((cur) => cur.filter((x) => x.key !== m.key))} aria-label="Quitar">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="km-name" className="text-[11px]">
                Nombre de la campaña (como se llamará en la plataforma)
              </Label>
              <Input id="km-name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-xs" />
            </div>
            <Select value={newPlatform} onValueChange={(v) => setNewPlatform(v as PlatformId)}>
              <SelectTrigger size="sm" className="w-36" aria-label="Plataforma de la campaña pendiente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {platforms.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORMS[p].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Cuenta (opcional)" className="h-8 w-44 text-xs" aria-label="Cuenta" />
            <Input type="date" value={newDate} min={`${month}-01`} onChange={(e) => setNewDate(e.target.value)} className="h-8 w-36 text-xs" aria-label="Fecha esperada" />
            <Button size="sm" variant="outline" onClick={addManual} disabled={newName.trim().length < 2}>
              <Plus /> Agregar
            </Button>
          </div>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 rounded-2xl bg-popover/95 px-4 py-3 shadow-(--shadow-pop) ring-1 ring-(--hairline) backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <span>
            Presupuesto total <b className="tabular">{money(total)}</b>
          </span>
          <span className="text-muted-foreground">
            {count("ACTIVE")} {KICKOFF_STATE_LABEL.ACTIVE.toLowerCase()}s · {count("PENDING")} pendientes · {count("ENDED")} no corren
          </span>
          {missing.length > 0 && <span className="text-status-attention-text">Falta presupuesto: {missing.map((p) => PLATFORMS[p].shortName).join(", ")}</span>}
          {error && (
            <span role="alert" className="font-medium text-status-critical-text">
              {error}
            </span>
          )}
          <Button className="ml-auto" onClick={confirm} disabled={busy || missing.length > 0}>
            {busy ? "Guardando…" : `Confirmar arranque de ${monthLabel}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
