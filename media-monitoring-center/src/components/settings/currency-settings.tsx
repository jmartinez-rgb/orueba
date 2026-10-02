"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import type { Currency, PlatformId } from "@/lib/types";
import { MONTHS_ES } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformMark } from "@/components/monitoring/status";
import { rateLookup } from "@/lib/data/currency";

export interface CurrencyAccount {
  id: string;
  name: string;
  platform: PlatformId;
  /** Moneda que reporta la fuente (sin la corrección de Settings). */
  sourceCurrency: Currency;
}

class SettingsChangedError extends Error {}

async function patch(path: string, value: unknown, expectedValue: unknown) {
  const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, value, expectedValue }) });
  const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok || !d.ok) throw (res.status === 412 || res.status === 428) ? new SettingsChangedError(d.message ?? "La configuración cambió.") : new Error(d.message ?? "No se pudo guardar");
}

/**
 * Tipo de cambio mensual (1 USD = N MXN) y moneda de cada cuenta. Todo se reporta en MXN: el
 * gasto de las cuentas en USD se multiplica por la tasa del mes de cada fecha.
 */
export function CurrencySettings({
  months,
  settingsRates,
  sourceRates,
  accounts,
  accountCurrency,
  canEdit,
  editAccountCurrency = true,
}: {
  months: string[];
  settingsRates: Record<string, number>;
  sourceRates: Record<string, number>;
  accounts: CurrencyAccount[];
  accountCurrency: Record<string, Currency>;
  canEdit: boolean;
  editAccountCurrency?: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // Keep each draft and the value seen when editing started, even after another
  // month saves and refreshes server props. Untouched months use the latest props.
  const [drafts, setDrafts] = useState<Record<string, { value: string; expectedValue: number | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const busyNow = busy !== null || refreshing;
  const lookup = rateLookup(new Map(Object.entries({ ...sourceRates, ...settingsRates })));

  async function saveRate(month: string) {
    const raw = (drafts[month]?.value ?? String(settingsRates[month] ?? "")).replace(",", ".").trim();
    const expected = drafts[month] ? drafts[month].expectedValue : settingsRates[month] ?? null;
    const n = Number(raw);
    setBusy(month);
    try {
      if (!raw) await patch(`currency.rates.${month}`, null, expected);
      else {
        if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error("Escribe una tasa válida (p. ej. 18.45).");
        await patch(`currency.rates.${month}`, Math.round(n * 10000) / 10000, expected);
      }
      setDrafts(current => { const next = { ...current }; delete next[month]; return next; });
      sileo.success({ title: raw ? `Tasa de ${month} guardada` : `Tasa de ${month} quitada` });
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof SettingsChangedError) setConflicted(true);
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function setCurrency(a: CurrencyAccount, c: Currency) {
    setBusy(a.id);
    try {
      await patch(`currency.accountCurrency.${a.id}`, c === a.sourceCurrency ? null : c, accountCurrency[a.id] ?? null);
      sileo.success({ title: `${a.name}: ${c}` });
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof SettingsChangedError) setConflicted(true);
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {conflicted && <p className="lg:col-span-2 text-xs text-muted-foreground">El valor guardado cambió. Recargar reemplaza tus borradores por las tasas vigentes. <Button size="xs" variant="outline" disabled={busyNow} onClick={() => { setDrafts({}); setConflicted(false); startRefresh(() => router.refresh()); }}>Recargar valores vigentes</Button></p>}
      <div className="min-w-0 space-y-2">
        <p className="text-[13px] font-semibold text-foreground">Tipo de cambio por mes (1 USD = MXN)</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Mes</th>
                <th className="px-2 py-1.5 text-left font-medium">Tasa capturada</th>
                <th className="px-2 py-1.5 text-left font-medium">Se usa</th>
                {canEdit && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const [y, mo] = m.split("-").map(Number);
                const { rate: used, usedMonth } = lookup(m);
                return (
                  <tr key={m} className="border-t">
                    <td className="px-2 py-1 font-medium">
                      {MONTHS_ES[mo - 1]} {y}
                    </td>
                    <td className="px-2 py-1">
                      {canEdit ? (
                        <Input value={drafts[m]?.value ?? String(settingsRates[m] ?? "")} disabled={busyNow} onChange={(e) => setDrafts(current => ({ ...current, [m]: { value: e.target.value, expectedValue: current[m] ? current[m].expectedValue : settingsRates[m] ?? null } }))} inputMode="decimal" placeholder={sourceRates[m] ? String(sourceRates[m]) : "18.45"} className="h-7 w-28 text-xs" aria-label={`Tasa de ${m}`} />
                      ) : (
                        (settingsRates[m] ?? "—")
                      )}
                    </td>
                    <td className="tabular px-2 py-1">
                      {used === null ? (
                        <span className="font-semibold text-status-attention-text">Falta</span>
                      ) : (
                        <span>
                          {used.toFixed(4)} <span className="text-muted-foreground">({usedMonth && settingsRates[usedMonth] ? "capturada" : "fuente"})</span>
                          {usedMonth !== m && <span className="block text-status-attention-text">Provisional: tasa de {usedMonth}</span>}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <Button size="xs" variant="outline" disabled={busyNow} onClick={() => saveRate(m)}>
                          Guardar
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">Sin tasa de un mes se usa la del mes anterior más cercano y baja la confianza de datos; si no hay ninguna, el gasto en USD queda pendiente. Vaciar una tasa y guardar la elimina.</p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-[13px] font-semibold text-foreground">Moneda de cada cuenta</p>
        <div className="max-h-[420px] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <tbody>
              {accounts.map((a) => {
                const current = accountCurrency[a.id] ?? a.sourceCurrency;
                return (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <PlatformMark platform={a.platform} className="size-5 text-[9px]" />
                        <span className="font-medium">{a.name}</span>
                        {accountCurrency[a.id] && <span className="text-[10px] text-muted-foreground">corregida</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {editAccountCurrency ? <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={`Moneda de ${a.name}`}>
                        {(["MXN", "USD"] as Currency[]).map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={current === c}
                            disabled={!canEdit || busyNow}
                            onClick={() => current !== c && setCurrency(a, c)}
                            className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", current === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground")}
                          >
                            {c}
                          </button>
                        ))}
                      </div> : <span className="font-semibold">{current}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
