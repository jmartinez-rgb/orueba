import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { getAppContext } from "@/lib/services/context";
import { getBudgetControl } from "@/lib/services/budget";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { MONTHS_ES } from "@/lib/time/tz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { BudgetTable } from "@/components/monitoring/budget-table";
import { BudgetLevels } from "@/components/monitoring/budget-levels";
import { DeltaText, SeverityBadge } from "@/components/monitoring/status";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { BudgetPanel, type BudgetPanelState } from "@/components/monitoring/budget-panel";
import { unifiedBudgets } from "@/lib/integrations/unified-api";
import { demoBudgets } from "@/lib/mock/platform-budgets";
import { buildBudgetOverview } from "@/lib/services/platform-budgets";
import { DEFAULT_CLASSIFIERS } from "@/lib/classifiers/defaults";
import type { Snapshot } from "@/lib/services/snapshot";
import { demoPreviousSnapshot, detectBudgetChanges, snapshotFrom, type BudgetChanges } from "@/lib/services/budget-changes";
import { latestSnapshotBefore, saveBudgetSnapshot } from "@/lib/records/budget-snapshots";
import { addDays } from "@/lib/time/tz";

export const metadata: Metadata = { title: "Presupuestos" };
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
  const budgets = await budgetState(snap, bc);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Presupuestos"
        subtitle={`${MONTHS_ES[m - 1]} ${y} · día ${bc.elapsedDays + 1} de ${bc.daysInMonth}. Proyección = gasto del mes + resto de hoy (curva horaria) + días restantes al ritmo reciente del mismo día de la semana. Presupuestos de referencia: la app no modifica nada en las plataformas.`}
      />
      {snap.meta.mode === "unified" && bc.lines.some(l => l.spend === null || l.forecast === null) && (
        <p className="rounded-md border border-status-attention/40 bg-status-attention/10 p-3 text-xs text-status-attention-text">Hay días, horas o tasas de cambio pendientes. El gasto incompleto y el pronóstico sin suficiente historial se muestran sin valor.</p>
      )}
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
          <div className="flex flex-col justify-center gap-1 surface rounded-xl px-4 py-3">
            <span className="text-[11px] text-muted-foreground">Estado del mes</span>
            <SeverityBadge severity={total.status} size="md" />
          </div>
        </div>
      )}
      <BudgetPanel state={budgets} />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Nivel de presupuesto por cuenta</CardTitle>
            <CardDescription>
              Hay cuentas con un presupuesto único y cuentas con presupuesto por campaña. Confirma cuál aplica para medir el pacing (dato interno de seguimiento).
              {bc.fxRate !== null && ` Montos en MXN; las cuentas en USD usan la tasa de ${MONTHS_ES[m - 1]}: 1 USD = ${bc.fxRate.toFixed(2)} MXN.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <BudgetLevels accounts={bc.accounts} canEdit={snap.meta.permissions.includes("settings:write")} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Presupuesto por plataforma, cuenta y campaña</CardTitle>
            <CardDescription>
              Estado por forecast: sobreejercicio ≥ {Math.round(b.overspendAttention * 100)}% atención, ≥ {Math.round(b.overspendAlert * 100)}% alerta, ≥ {Math.round(b.overspendCritical * 100)}% crítico; subejercicio ≥{" "}
              {Math.round(b.underspendAttention * 100)}% atención. Configurable en Configuración.
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

/** Presupuestos vigentes: API unificada con datos reales; derivados del catálogo en modo demo. */
async function budgetState(snap: Snapshot, bc: Awaited<ReturnType<typeof getBudgetControl>>): Promise<BudgetPanelState> {
  const fxRate = bc.fxRate;
  const demo = snap.meta.mode === "mock";
  const source = demo ? { ok: true as const, budgets: demoBudgets(snap, fxRate), warnings: [] as string[] } : await unifiedBudgets();
  if (!source.ok) return { kind: "unavailable", reason: source.reason, configured: source.configured };
  const direct = snap.meta.mode === "unified";
  const directAccounts = direct ? new Map(snap.catalog.accounts.map(a => [a.id, a.brand ?? snap.meta.brand.id])) : undefined;
  const localId = (platform: string, id: string) => direct && id.startsWith(`${platform}:`) ? id.slice(platform.length + 1) : id;
  const spendToday = new Map<string, number | null>();
  for (const e of snap.run.entities)
    if (e.level === "campaign" && e.campaignId) spendToday.set(`${e.platform}:${localId(e.platform!, e.campaignId)}`, e.cumulative.spend?.current ?? (direct ? null : 0));
  const overview = buildBudgetOverview({
    budgets: direct ? source.budgets.map(b => ({ ...b, campaign_id: `${b.account_id}:${b.campaign_id}`, shared_budget_id: b.shared_budget_id ? `${b.account_id}:${b.shared_budget_id}` : null })) : source.budgets,
    directAccounts,
    brand: snap.meta.brand.id,
    platforms: snap.run.platforms,
    classifiers: { ...DEFAULT_CLASSIFIERS, ...snap.settings.classifiers },
    campaigns: new Map(snap.catalog.campaigns.map((c) => [`${c.platform}:${localId(c.platform, c.id)}`, c])),
    spendToday,
    curveShare: Object.fromEntries(snap.run.platforms.map((p) => [p, snap.run.pacing[p]?.curveShare ?? null])),
    fxRate,
    thresholds: snap.settings.thresholds,
    budgetThresholds: snap.settings.budget,
    month: {
      daysInMonth: bc.daysInMonth,
      elapsedDays: bc.elapsedDays,
      lines: Object.fromEntries(
        bc.lines.filter((l) => l.level === "total" || l.level === "platform").map((l) => [l.level === "total" ? "total" : l.platform!, { budget: l.budget, spend: l.spend }]),
      ),
    },
  });
  if (source.warnings.length)
    overview.insights.push({ tone: "warn", text: `${source.warnings.length === 1 ? "Una lectura de presupuestos falló" : `${source.warnings.length} lecturas de presupuestos fallaron`}: ${source.warnings[0]}` });
  // Cambios contra el último día guardado. En modo demo, una foto "de ayer" de ejemplo y sin escribir.
  let changes: BudgetChanges | null = null;
  const today = snap.meta.businessDate;
  const current = snapshotFrom(overview, today, snap.meta.generatedAt);
  try {
    const prev = demo ? demoPreviousSnapshot(current, addDays(today, -1)) : await latestSnapshotBefore(snap.meta.brand.id, today);
    if (!demo && Object.keys(current.units).length) await saveBudgetSnapshot(snap.meta.brand.id, current);
    if (prev) changes = detectBudgetChanges(prev, current, snap.settings.thresholds.attention);
  } catch {
    // Sin almacén disponible el panel sigue sin la comparación.
  }
  return { kind: "ready", overview, demo, changes, canNovedad: snap.meta.permissions.includes("novedades:write") };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 surface rounded-xl px-4 py-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-lg leading-tight font-semibold">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
