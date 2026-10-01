import type { NormalizedAccount, NormalizedBudget } from "../../types/normalized.js";
import { metaObject } from "./types.js";

/**
 * Presupuestos vigentes de Meta. La plataforma guarda los montos como texto en la unidad mínima de
 * la moneda de la cuenta (centavos para MXN y USD). Solo se leen campañas y conjuntos con estado
 * efectivo ACTIVE y sin fecha de fin vencida; un conjunto con la campaña pausada aparece como
 * CAMPAIGN_PAUSED y queda fuera. Lo programado para iniciar después tampoco cuenta: hoy no gasta.
 */

export const BUDGET_CAMPAIGN_FIELDS =
  "id,name,objective,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,bid_strategy";
export const BUDGET_ADSET_FIELDS =
  "id,name,campaign_id,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,bid_strategy";
export const ACTIVE_FILTER = JSON.stringify(["ACTIVE"]);

/** Monedas que Meta maneja sin decimales (factor 1); el resto usa centésimos (factor 100). */
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export function currencyOffset(currency: string | null): number | null {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return ZERO_DECIMAL.has(currency) ? 1 : 100;
}

const DAY = 86_400_000;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Monto positivo en unidad mínima; "0", vacío o inválido = sin presupuesto en ese nivel. */
function minor(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : text(value);
  return raw && /^\d{1,15}$/.test(raw) && raw !== "0" ? Number(raw) : null;
}
const amount = (units: number | null, offset: number | null) =>
  units === null || offset === null ? null : units / offset;

function ended(time: string | null, now: number): boolean {
  const at = time ? Date.parse(time) : Number.NaN;
  return Number.isFinite(at) && at <= now;
}

function future(time: string | null, now: number): boolean {
  const at = time ? Date.parse(time) : Number.NaN;
  return Number.isFinite(at) && at > now;
}

function dailyEstimate(remaining: number | null, end: string | null, now: number): number | null {
  const at = end ? Date.parse(end) : Number.NaN;
  if (remaining === null || !Number.isFinite(at) || at <= now) return null;
  return remaining / Math.max(1, Math.ceil((at - now) / DAY));
}

interface Level {
  /** Hay presupuesto aunque no se pueda convertir (moneda desconocida). */
  hasDaily: boolean;
  hasLifetime: boolean;
  daily: number | null;
  lifetime: number | null;
  remaining: number | null;
  rawDaily: unknown;
  rawLifetime: unknown;
}
function level(row: Record<string, unknown>, offset: number | null): Level {
  const daily = minor(row.daily_budget),
    lifetime = minor(row.lifetime_budget);
  return {
    hasDaily: daily !== null,
    hasLifetime: lifetime !== null,
    daily: amount(daily, offset),
    lifetime: amount(lifetime, offset),
    remaining: amount(minor(row.budget_remaining), offset),
    rawDaily: row.daily_budget ?? null,
    rawLifetime: row.lifetime_budget ?? null,
  };
}
const hasBudget = (l: Level) => l.hasDaily || l.hasLifetime;

/** Los conjuntos solo se consultan si alguna campaña activa no tiene presupuesto propio (ABO). */
export function needsAdSets(campaigns: Record<string, unknown>[]): boolean {
  return campaigns.some((c) => metaObject(c) && !hasBudget(level(c, 100)));
}

export function normalizeBudgets(
  account: NormalizedAccount,
  campaigns: Record<string, unknown>[],
  adSets: Record<string, unknown>[],
  at: string,
  now = Date.parse(at),
): NormalizedBudget[] {
  const offset = currencyOffset(account.currency);
  const out: NormalizedBudget[] = [];
  // Activo hoy: estado ACTIVE, ya inició y no ha terminado (lo programado no gasta hoy).
  const running = (row: Record<string, unknown>, endField: string) =>
    row.effective_status === "ACTIVE" && !ended(text(row[endField]), now) && !future(text(row.start_time), now);
  const byCampaign = new Map<string, Record<string, unknown>[]>();
  for (const set of adSets.filter(metaObject)) {
    const id = text(set.campaign_id);
    if (!id || !running(set, "end_time")) continue;
    byCampaign.set(id, [...(byCampaign.get(id) ?? []), set]);
  }
  for (const campaign of campaigns.filter(metaObject)) {
    const campaignId = text(campaign.id);
    if (!campaignId || !running(campaign, "stop_time")) continue;
    const base = {
      platform: "meta" as const,
      client_id: account.client_id,
      account_id: account.account_id,
      account_name: account.account_name,
      currency: account.currency,
      campaign_id: campaignId,
      campaign_name: text(campaign.name) ?? campaignId,
      objective: text(campaign.objective),
      extracted_at: at,
    };
    const own = level(campaign, offset);
    const row = (
      l: Level,
      source: Record<string, unknown>,
      endField: string,
      adSet: Record<string, unknown> | null,
    ) => {
      const end = text(source[endField]) ?? (adSet ? text(campaign.stop_time) : null);
      return {
        ...base,
        budget_level: adSet ? ("ad_set" as const) : ("campaign" as const),
        ad_set_id: adSet ? text(adSet.id) : null,
        ad_set_name: adSet ? (text(adSet.name) ?? text(adSet.id)) : null,
        budget_type: l.hasDaily ? ("daily" as const) : ("lifetime" as const),
        daily_budget: l.daily,
        lifetime_budget: l.lifetime,
        budget_remaining: l.remaining,
        daily_estimate: l.hasDaily ? null : dailyEstimate(l.remaining, end, now),
        shared_budget_id: null,
        limited_by_budget: null,
        recommended_daily_budget: null,
        start_time: text(source.start_time),
        end_time: end,
        raw_metrics: {
          daily_budget_minor_units: l.rawDaily,
          lifetime_budget_minor_units: l.rawLifetime,
          currency_offset: offset,
          estimate_method: l.hasDaily ? null : "remaining_over_days_left",
          bid_strategy: text(source.bid_strategy) ?? text(campaign.bid_strategy),
          effective_status: source.effective_status ?? null,
        },
      };
    };
    if (hasBudget(own)) {
      out.push(row(own, campaign, "stop_time", null));
      continue;
    }
    // Sin presupuesto en la campaña: lo tiene cada conjunto activo (ABO).
    for (const set of byCampaign.get(campaignId) ?? []) {
      const l = level(set, offset);
      if (hasBudget(l)) out.push(row(l, set, "end_time", set));
    }
  }
  return out;
}
