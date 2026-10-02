import type { CampaignSummary, Totals } from "./aggregate.js";
import type { SourceId } from "./sources.js";
import type { AuditData, Finding, HoldItem, SectionKey, WindowKey } from "./types.js";

/**
 * Criterios de revisión de la auditoría. Los marcados "encargo" vienen del brief; "Google", de la
 * documentación oficial; el resto son criterios de auditoría explícitos y configurables, no metas.
 */
export const CRITERIA = {
  /** Cambio relativo que se considera material (gasto, impresiones, CPC). */
  materialChange: 0.2,
  /** p-valor máximo para aceptar una caída como real y no ruido. */
  significance: 0.05,
  minImpressions: 1000,
  minClicks: 100,
  minConversions: 10,
  /** Encargo: CPA reciente > CPA base × 1.30. */
  cpaAlertRatio: 1.3,
  /** Encargo: cuota perdida por presupuesto > 25%. */
  lostBudgetAlert: 0.25,
  /** Cambio de cuota de impresiones que amerita revisión (puntos porcentuales). */
  sharePoints: 0.1,
  /** Días completos recientes sin gasto para una campaña que debería entregar. */
  zeroSpendDays: 3,
  /** Uso de presupuesto por debajo del cual se considera presupuesto sin utilizar. */
  underuseRatio: 0.6,
  /** Paso de presupuesto recomendado (gradual). */
  budgetStepPct: 15,
  /** Paso de objetivo (Google sugiere ~20% y esperar una semana; Demand Gen ±15%). */
  targetStepPct: 15,
} as const;

export type FindingInput = Omit<Finding, "id" | "accountId" | "sources"> & { sources?: SourceId[] };

export interface Ctx {
  data: AuditData;
  campaigns: CampaignSummary[];
  account: Record<WindowKey, Totals>;
  currency: string;
  findings: Finding[];
  holds: HoldItem[];
  notes: Partial<Record<SectionKey, string[]>>;
  add(f: FindingInput): void;
  hold(campaign: string, item: string, reason: string): void;
  note(section: SectionKey, text: string): void;
  name(campaignId: string): string;
  summary(campaignId: string): CampaignSummary | undefined;
  money(n: number | null): string;
}

export function createCtx(data: AuditData, campaigns: CampaignSummary[], account: Record<WindowKey, Totals>): Ctx {
  const currency = data.customer?.currency || "MXN";
  const byId = new Map(campaigns.map((c) => [c.info.id, c]));
  const ctx: Ctx = {
    data,
    campaigns,
    account,
    currency,
    findings: [],
    holds: [],
    notes: {},
    add(f) {
      ctx.findings.push({ ...f, id: "", accountId: data.target.id, sources: f.sources ?? [] });
    },
    hold(campaign, item, reason) {
      if (!ctx.holds.some((h) => h.campaign === campaign && h.item === item))
        ctx.holds.push({ campaign, item, reason });
    },
    note(section, text) {
      (ctx.notes[section] ??= []).push(text);
    },
    name: (id) => byId.get(id)?.info.name ?? `Campaña ${id}`,
    summary: (id) => byId.get(id),
    money: (n) => fmtMoney(n, currency),
  };
  return ctx;
}

export function fmtMoney(n: number | null, currency = "MXN"): string {
  if (n === null || !Number.isFinite(n)) return "s/d";
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}
export const fmtNum = (n: number | null, digits = 0) =>
  n === null || !Number.isFinite(n)
    ? "s/d"
    : n.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (n: number | null, digits = 1) =>
  n === null || !Number.isFinite(n)
    ? "s/d"
    : `${(n * 100).toLocaleString("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
export const fmtDelta = (n: number | null) =>
  n === null || !Number.isFinite(n)
    ? "s/d"
    : `${n >= 0 ? "+" : ""}${(n * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
/** "1 término" / "3 términos": concuerda el conteo con el texto. */
export const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;
/** Cuota de impresiones con los topes que reporta Google (<10% y >90%). */
export function fmtShare(n: number | null): string {
  if (n === null) return "s/d";
  if (Math.abs(n - 0.0999) < 1e-6) return "<10%";
  if (Math.abs(n - 0.9001) < 1e-6) return ">90%";
  return fmtPct(n, 0);
}
