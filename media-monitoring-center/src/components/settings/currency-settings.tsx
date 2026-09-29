"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import type { Currency, PlatformId } from "@/lib/types";
import { MONTHS_ES } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformMark } from "@/components/monitoring/status";

export interface CurrencyAccount {
  id: string;
  name: string;
  platform: PlatformId;
  /** Moneda que reporta la fuente (sin la corrección de Settings). */
  sourceCurrency: Currency;
}

async function patch(path: string, value: unknown) {
  const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, value }) });
  const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok || !d.ok) throw new Error(d.message ?? "No se pudo guardar");
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
}: {
  months: string[];
  settingsRates: Record<string, number>;
  sourceRates: Record<string, number>;
  accounts: CurrencyAccount[];
  accountCurrency: Record<string, Currency>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(months.map((m) => [m, settingsRates[m] ? String(settingsRates[m]) : ""])));
  const [busy, setBusy] = useState<string | null>(null);

  async function saveRate(month: string) {
    const raw = values[month]?.replace(",", ".").trim();
    const n = Number(raw);
    setBusy(month);
    try {
      if (!raw) await patch(`currency.rates.${month}`, null);
      else {
        if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error("Escribe una tasa válida (p. ej. 18.45).");
        await patch(`currency.rates.${month}`, Math.round(n * 10000) / 10000);
      }
      sileo.success({ title: raw ? `Tasa de ${month} guardada` : `Tasa de ${month} quitada` });
      router.refresh();
    } catch (err) {
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function setCurrency(a: CurrencyAccount, c: Currency) {
    setBusy(a.id);
    try {
      await patch(`currency.accountCurrency.${a.id}`, c === a.sourceCurrency ? null : c);
      sileo.success({ title: `${a.name}: ${c}` });
      router.refresh();
    } catch (err) {
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
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
                const used = settingsRates[m] ?? sourceRates[m] ?? null;
                return (
                  <tr key={m} className="border-t">
                    <td className="px-2 py-1 font-medium">
                      {MONTHS_ES[mo - 1]} {y}
                    </td>
                    <td className="px-2 py-1">
                      {canEdit ? (
                        <Input value={values[m] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [m]: e.target.value }))} inputMode="decimal" placeholder={sourceRates[m] ? String(sourceRates[m]) : "18.45"} className="h-7 w-28 text-xs" aria-label={`Tasa de ${m}`} />
                      ) : (
                        (settingsRates[m] ?? "—")
                      )}
                    </td>
                    <td className="tabular px-2 py-1">
                      {used === null ? (
                        <span className="font-semibold text-status-attention-text">Falta</span>
                      ) : (
                        <span>
                          {used.toFixed(4)} <span className="text-muted-foreground">({settingsRates[m] ? "Settings" : "fuente"})</span>
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <Button size="xs" variant="outline" disabled={busy === m} onClick={() => saveRate(m)}>
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
        <p className="text-[11px] text-muted-foreground">Sin tasa de un mes se usa la del mes anterior y baja la confianza de datos; si no hay ninguna, el gasto en USD queda NULL (nunca se inventa).</p>
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
                      <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={`Moneda de ${a.name}`}>
                        {(["MXN", "USD"] as Currency[]).map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={current === c}
                            disabled={!canEdit || busy === a.id}
                            onClick={() => current !== c && setCurrency(a, c)}
                            className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", current === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground")}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
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
