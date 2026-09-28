import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { getAppContext } from "@/lib/services/context";
import { getBudgetControl } from "@/lib/services/budget";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { MONTHS_ES } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { BudgetTable } from "@/components/monitoring/budget-table";
import { DeltaText, SeverityBadge } from "@/components/monitoring/status";
import { ErrorPanel } from "@/components/monitoring/error-panel";

export const metadata: Metadata = { title: "Budget Control" };
export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const ctx = await getAppContext();
  const bc = await getBudgetControl(ctx, snap);
  const total = bc.lines.find((l) => l.level === "total");
  const [y, m] = bc.month.split("-").map(Number);
  const b = snap.settings.budget;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Budget Control"
        subtitle={`${MONTHS_ES[m - 1]} ${y} · día ${bc.elapsedDays + 1} de ${bc.daysInMonth}. Forecast = gasto del mes + resto de hoy (curva horaria) + días restantes al ritmo reciente del mismo día de la semana.`}
      />
      {total && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Presupuesto mensual" value={fmtCurrency(total.budget)} />
          <Tile label="Gasto del mes" value={fmtCurrency(total.spend)} sub={`Hoy ${fmtCurrency(total.todaySpend)}`} />
          <Tile label="Restante" value={fmtCurrency(total.remaining)} />
          <Tile label="Usado" value={fmtPercent(total.usedPct, 1)} sub={`Esperado ${fmtPercent(total.expectedPct, 1)}`} />
          <Tile
            label="Forecast de cierre"
            value={fmtCurrency(total.forecast)}
            sub={
              <>
                vs presupuesto <DeltaText value={total.forecastVsBudget} attention={b.overspendAttention} />
              </>
            }
          />
          <div className="flex flex-col justify-center gap-1 rounded-lg border bg-card px-3 py-2">
            <span className="text-[11px] text-muted-foreground">Estado del mes</span>
            <SeverityBadge severity={total.status} size="md" />
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Presupuesto por plataforma, cuenta y campaña</CardTitle>
            <CardDescription>
              Estado por forecast: sobreejercicio ≥ {Math.round(b.overspendAttention * 100)}% atención, ≥ {Math.round(b.overspendAlert * 100)}% alerta, ≥ {Math.round(b.overspendCritical * 100)}% crítico; subejercicio ≥{" "}
              {Math.round(b.underspendAttention * 100)}% atención. Configurable en Settings.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <BudgetTable lines={bc.lines} month={bc.month} canEdit={snap.meta.permissions.includes("budgets:write")} />
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-lg leading-tight font-bold">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
