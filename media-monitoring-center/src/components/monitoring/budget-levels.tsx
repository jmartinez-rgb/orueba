"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { sileo } from "sileo";
import type { AccountBudgetLevel } from "@/lib/services/budget";
import { fmtCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformMark } from "./status";

const DETECTED: Record<AccountBudgetLevel["detected"], { label: string; tone: string }> = {
  account: { label: "Nivel cuenta", tone: "bg-muted text-foreground" },
  campaign: { label: "Por campaña", tone: "bg-muted text-foreground" },
  mixed: { label: "Ambos niveles", tone: "bg-status-attention/15 text-status-attention-text" },
  none: { label: "Sin presupuesto", tone: "text-muted-foreground" },
};

/**
 * Nivel de presupuesto por cuenta: algunas cuentas tienen un presupuesto único y otras un
 * presupuesto por campaña. Aquí se confirma cuál aplica para medir el pacing (dato interno).
 */
export function BudgetLevels({ accounts, canEdit }: { accounts: AccountBudgetLevel[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = accounts.filter((a) => a.detected !== "none" || a.confirmed);
  const pending = rows.filter((a) => a.detected === "mixed" && !a.confirmed);

  async function confirm(accountId: string, level: "account" | "campaign" | null) {
    setBusy(accountId);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `budgetLevels.${accountId}`, value: level }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !d.ok) {
        sileo.error({ title: "No se pudo guardar", description: d.message });
        return;
      }
      sileo.success({ title: level ? `Nivel confirmado: ${level === "account" ? "cuenta" : "campaña"}` : "Confirmación quitada" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {pending.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-status-attention/40 bg-status-attention/10 px-3 py-2 text-xs text-status-attention-text">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {pending.length} cuenta(s) tienen presupuesto a nivel cuenta y por campaña: confirma cuál aplica para que el pacing no se duplique.
        </p>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Detectado</TableHead>
              <TableHead className="text-right">Presupuesto cuenta</TableHead>
              <TableHead className="text-right">Suma de campañas</TableHead>
              <TableHead>Se mide a nivel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.accountId}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <PlatformMark platform={a.platform} className="size-5 text-[9px]" />
                    <span className="text-xs font-medium">{a.accountName}</span>
                    {a.currency === "USD" && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">USD</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", DETECTED[a.detected].tone)}>{DETECTED[a.detected].label}</span>
                </TableCell>
                <TableCell className="text-right text-xs">{fmtCurrency(a.accountBudget)}</TableCell>
                <TableCell className="text-right text-xs">{a.campaignBudgetSum === null ? "—" : `${fmtCurrency(a.campaignBudgetSum)} (${a.campaignBudgets})`}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={`Nivel de presupuesto de ${a.accountName}`}>
                      {(["account", "campaign"] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          role="radio"
                          aria-checked={a.effective === lvl}
                          disabled={busy === a.accountId}
                          onClick={() => confirm(a.accountId, a.confirmed === lvl ? null : lvl)}
                          className={cn(
                            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                            a.effective === lvl ? (a.confirmed === lvl ? "bg-primary text-primary-foreground" : "bg-muted text-foreground") : "text-muted-foreground hover:text-foreground",
                          )}
                          title={a.confirmed === lvl ? "Confirmado (clic para quitar)" : a.effective === lvl ? "Detectado automáticamente (clic para confirmar)" : "Confirmar este nivel"}
                        >
                          {lvl === "account" ? "Cuenta" : "Campaña"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs">{a.effective === "account" ? "Cuenta" : a.effective === "campaign" ? "Campaña" : "Por confirmar"}</span>
                  )}
                  {a.confirmed && <span className="ml-1.5 text-[10px] text-muted-foreground">confirmado</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
