"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { BudgetLevel } from "@/lib/types";
import type { BudgetLine } from "@/lib/services/budget";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataStateBadge, DeltaText, isBadDataState, PlatformMark, SeverityBadge } from "./status";

function UsageBar({ used, expected }: { used: number | null; expected: number | null }) {
  if (used === null) return <span className="text-xs text-muted-foreground">Sin presupuesto</span>;
  const u = Math.min(1.2, used);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 rounded-full bg-muted" aria-hidden>
        <div className={cn("absolute inset-y-0 left-0 rounded-full", used > (expected ?? 1) * 1.05 ? "bg-status-alert" : "bg-[var(--series-today)]")} style={{ width: `${(u / 1.2) * 100}%` }} />
        {expected !== null && <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground/60" style={{ left: `${(Math.min(1.2, expected) / 1.2) * 100}%` }} />}
      </div>
      <span className="tabular text-xs">{fmtPercent(used, 1)}</span>
    </div>
  );
}

export function BudgetTable({ lines, month, canEdit }: { lines: BudgetLine[]; month: string; canEdit: boolean }) {
  const router = useRouter();
  const [level, setLevel] = useState<BudgetLevel>("platform");
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => lines.filter((l) => l.level === level), [lines, level]);

  async function save() {
    if (!editing) return;
    const value = Number(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, level: editing.level, platform: editing.platform, accountId: editing.accountId, campaignId: editing.campaignId, amount: value }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "No se pudo guardar.");
      return;
    }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={level} onValueChange={(v) => setLevel(v as BudgetLevel)}>
        <TabsList>
          <TabsTrigger value="platform">Plataforma</TabsTrigger>
          <TabsTrigger value="account">Cuenta</TabsTrigger>
          <TabsTrigger value="campaign">Campaña</TabsTrigger>
        </TabsList>
      </Tabs>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">{level === "platform" ? "Plataforma" : level === "account" ? "Cuenta" : "Campaña"}</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>Used %</TableHead>
            <TableHead className="text-right">Expected %</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="text-right">Forecast</TableHead>
            <TableHead className="text-right">vs budget</TableHead>
            <TableHead>Estado</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((l) => (
            <TableRow key={l.key}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {l.platform && <PlatformMark platform={l.platform} className="size-5 text-[9px]" />}
                  <span className="min-w-0">
                    <span className="block max-w-72 truncate text-xs font-medium" title={l.name}>
                      {l.name}
                    </span>
                    {l.parentName && <span className="block text-[10px] text-muted-foreground">{l.parentName}</span>}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right text-xs font-medium">{fmtCurrency(l.budget)}</TableCell>
              <TableCell className="text-right text-xs">{fmtCurrency(l.spend)}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{fmtCurrency(l.remaining)}</TableCell>
              <TableCell>
                <UsageBar used={l.usedPct} expected={l.expectedPct} />
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{fmtPercent(l.expectedPct, 1)}</TableCell>
              <TableCell className="text-right text-xs">
                {l.variance === null ? "—" : <span className={cn("tabular", Math.abs(l.variance) >= 0.05 ? "font-semibold" : "text-muted-foreground")}>{`${l.variance > 0 ? "+" : "−"}${Math.abs(l.variance * 100).toFixed(1)} pp`}</span>}
              </TableCell>
              <TableCell className="text-right text-xs font-medium">{fmtCurrency(l.forecast)}</TableCell>
              <TableCell className="text-right text-xs">
                <DeltaText value={l.forecastVsBudget} attention={0.05} />
              </TableCell>
              <TableCell>{isBadDataState(l.dataState) ? <DataStateBadge state={l.dataState} /> : <SeverityBadge severity={l.status} />}</TableCell>
              {canEdit && (
                <TableCell>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Editar presupuesto de ${l.name}`}
                    onClick={() => {
                      setEditing(l);
                      setAmount(l.budget ? String(Math.round(l.budget)) : "");
                      setError(null);
                    }}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Presupuesto mensual</DialogTitle>
            <DialogDescription>
              {editing?.name} · {month}. El cambio se guarda en el almacén de la app (BigQuery en producción).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Monto (MXN)</Label>
            <Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            {error && <p className="text-xs text-status-critical-text">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
