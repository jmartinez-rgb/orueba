import type { BudgetRow } from "@/lib/types";
import type { Authorization } from "@/lib/alerts/types";
import { addDays, zonedTimeToUtc } from "@/lib/time/tz";
import { APPROVAL_CHANNEL_LABEL, NOVEDAD_KIND_LABEL, novedadActiveOn, type MonthKickoff, type Novedad } from "@/lib/records/novedad-model";

/**
 * Lo que el monitoreo toma en cuenta de las novedades y del arranque de mes:
 * - autorizaciones: alcances cuyos cambios de gasto no se alertan mientras estén vigentes;
 * - presupuestos: el del arranque de mes y los ajustes aprobados durante el mes.
 */
export interface DeclaredCampaign {
  status: "PAUSED" | "ENDED";
  text: string;
}

export interface MonitoringPlan {
  authorizations: Authorization[];
  /**
   * Campañas que el equipo declaró detenidas (no corren este mes, pendientes por iniciar o con pausa
   * aprobada): el motor las trata como pausadas a propósito, así que no alertan y explican la caída
   * de su cuenta o plataforma.
   */
  declaredCampaigns: Record<string, DeclaredCampaign>;
  /** Presupuestos del arranque de mes (se aplican sobre los de la hoja). */
  kickoffBudgets: BudgetRow[];
  /** Ajustes de presupuesto aprobados en novedades (mandan sobre todo lo demás). */
  novedadBudgets: BudgetRow[];
}

/** Primer día del mes siguiente (fin exclusivo de la vigencia). */
const monthEnd = (month: string) => addDays(`${month}-01`, 32).slice(0, 7) + "-01";

function scopeKey(n: Pick<Novedad, "platform" | "accountId" | "campaignId">): string | null {
  if (!n.platform) return null;
  if (n.campaignId) return `campaign:${n.platform}:${n.campaignId}`;
  if (n.accountId) return `account:${n.platform}:${n.accountId}`;
  return `platform:${n.platform}`;
}

function levelOf(n: Pick<Novedad, "accountId" | "campaignId">): Authorization["level"] {
  return n.campaignId ? "campaign" : n.accountId ? "account" : "platform";
}

export function planFor(novedades: Novedad[], kickoff: MonthKickoff | null, date: string, timezone: string): MonitoringPlan {
  const month = date.slice(0, 7);
  const authorizations: Authorization[] = [];
  const startOf = (d: string) => zonedTimeToUtc(d, 0, 0, timezone).toISOString();

  for (const n of novedades) {
    if (!n.silenceAlerts || !novedadActiveOn(n, date)) continue;
    const key = scopeKey(n);
    if (!key) continue;
    const until = n.effectiveUntil ? addDays(n.effectiveUntil, 1) : monthEnd(n.effectiveFrom.slice(0, 7));
    authorizations.push({
      id: n.id,
      fingerprint: n.alertFingerprint ?? `${key}#delivery`,
      level: levelOf(n),
      platform: n.platform!,
      accountId: n.accountId,
      accountName: n.accountName,
      campaignId: n.campaignId,
      campaignName: n.campaignName,
      family: "delivery",
      title: n.title,
      deviation: n.expectedChange,
      massStop: n.includesFullStop,
      reason: `${NOVEDAD_KIND_LABEL[n.kind]}: ${n.title} · ${n.id}, vía ${APPROVAL_CHANNEL_LABEL[n.approvalChannel]}`,
      authorizedBy: n.approvedBy,
      createdBy: n.createdBy,
      createdAt: startOf(n.effectiveFrom),
      until: startOf(until),
      revokedAt: null,
      revokedBy: null,
      incidentId: n.incidentId,
    });
  }

  const declaredCampaigns: Record<string, DeclaredCampaign> = {};
  // Arranque de mes: lo que "no corre este mes" y lo pendiente por iniciar cuenta como detenido a propósito.
  if (kickoff && kickoff.month === month) {
    for (const it of kickoff.items) {
      if (!it.campaignId) continue;
      if (it.state === "ENDED") declaredCampaigns[it.campaignId] = { status: "ENDED", text: `No corre este mes (arranque de ${month})` };
      else if (it.state === "PENDING" && !it.startedAt) declaredCampaigns[it.campaignId] = { status: "PAUSED", text: `Pendiente por iniciar${it.expectedStart ? ` el ${it.expectedStart}` : ""} (arranque de ${month})` };
    }
  }
  // Pausas aprobadas en novedades a nivel campaña.
  for (const n of novedades) {
    if (n.kind === "PAUSA" && n.campaignId && novedadActiveOn(n, date)) declaredCampaigns[n.campaignId] = { status: "PAUSED", text: `Pausa aprobada (${n.id})` };
  }

  const kickoffBudgets: BudgetRow[] =
    kickoff && kickoff.month === month
      ? kickoff.budgets.map((b) => ({ month, level: b.accountId ? "account" : "platform", platform: b.platform, accountId: b.accountId, campaignId: null, amount: b.amount, currency: "MXN" }))
      : [];

  // El ajuste más reciente de cada alcance manda.
  const latest = new Map<string, Novedad>();
  for (const n of novedades) {
    if (n.kind !== "PRESUPUESTO" || !n.budget || n.status !== "VIGENTE" || n.budget.month !== month || n.effectiveFrom > date) continue;
    const k = scopeKey(n) ?? "total";
    const cur = latest.get(k);
    if (!cur || n.effectiveFrom > cur.effectiveFrom || (n.effectiveFrom === cur.effectiveFrom && n.createdAt > cur.createdAt)) latest.set(k, n);
  }
  const novedadBudgets: BudgetRow[] = [...latest.values()].map((n) => ({
    month,
    level: n.campaignId ? "campaign" : n.accountId ? "account" : n.platform ? "platform" : "total",
    platform: n.platform,
    accountId: n.accountId,
    campaignId: n.campaignId,
    amount: n.budget!.amount,
    currency: "MXN",
  }));

  return { authorizations, declaredCampaigns, kickoffBudgets, novedadBudgets };
}

const budgetKey = (b: Pick<BudgetRow, "level" | "platform" | "accountId" | "campaignId">) => [b.level, b.platform ?? "", b.accountId ?? "", b.campaignId ?? ""].join("|");

/** Presupuestos combinados: cada capa reemplaza la fila del mismo alcance de las anteriores. */
export function mergeBudgets(...layers: BudgetRow[][]): BudgetRow[] {
  const map = new Map<string, BudgetRow>();
  for (const layer of layers) for (const b of layer) map.set(budgetKey(b), b);
  return [...map.values()];
}
