import type { BrandId } from "@/lib/brands";
import { brandOfCampaign } from "@/lib/brands";
import type { UnifiedBudget, UnifiedDeliverySignal } from "@/lib/integrations/unified-api";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";

/**
 * Salud de entrega por plataforma: lo que la plataforma reporta hoy (cuentas con problemas, campañas
 * que no entregan, limitadas por presupuesto, puja o políticas, aprendizaje). El tope de gasto de
 * Meta se cruza con el presupuesto diario vigente de la cuenta para saber cuántos días alcanza.
 */

export type HealthSeverity = "critical" | "warning" | "info";

export interface HealthItem {
  key: string;
  platform: PlatformId;
  severity: HealthSeverity;
  kind: string;
  title: string;
  entity: string;
  account: string;
  detail: string | null;
}

export interface DeliveryView {
  counts: Record<HealthSeverity, number>;
  byPlatform: Array<{ platform: PlatformId; name: string; counts: Record<HealthSeverity, number> }>;
  items: HealthItem[];
  insights: Array<{ tone: "good" | "warn" | "info"; text: string }>;
  extractedAt: string | null;
}

export interface DeliveryInput {
  signals: UnifiedDeliverySignal[];
  brand: BrandId;
  platforms: PlatformId[];
  /** Presupuestos vigentes (para el alcance del tope de gasto); vacío si no hay. */
  budgets: UnifiedBudget[];
  /** Días que faltan del mes después de hoy. */
  daysLeft: number;
  /** Direct source: keys are platform:account_id; this map is authoritative. */
  directAccounts?: Map<string, BrandId>;
}

const KIND_TITLE: Record<string, string> = {
  account_status: "Cuenta con problema",
  spend_cap: "Tope de gasto de la cuenta",
  delivery_issue: "Problema de entrega",
  policy: "Anuncios rechazados o limitados por políticas",
  budget_limited: "Limitada por presupuesto",
  bidding_limited: "Limitada por la estrategia de puja",
  paused_by_budget: "Pausada por presupuesto",
  learning: "En aprendizaje",
  learning_limited: "Aprendizaje limitado",
  pending: "Pendiente de iniciar",
};

const CODE_LABEL: Record<string, string> = {
  DISABLED: "deshabilitada",
  UNSETTLED: "con saldo pendiente",
  PENDING_RISK_REVIEW: "en revisión de riesgo",
  PENDING_SETTLEMENT: "liquidación pendiente",
  IN_GRACE_PERIOD: "en periodo de gracia",
  PENDING_CLOSURE: "cierre pendiente",
  CLOSED: "cerrada",
  ANY_CLOSED: "cerrada",
  NOT_ELIGIBLE: "no elegible",
  MISCONFIGURED: "mal configurada",
  HAS_ADS_DISAPPROVED: "anuncios rechazados",
  HAS_ADS_LIMITED_BY_POLICY: "anuncios limitados por políticas",
  MOST_ADS_UNDER_REVIEW: "anuncios en revisión",
  HAS_ASSET_GROUPS_DISAPPROVED: "grupos de recursos rechazados",
  BIDDING_STRATEGY_LIMITED: "estrategia de puja limitada",
  BIDDING_STRATEGY_CONSTRAINED: "estrategia de puja restringida",
  BIDDING_STRATEGY_MISCONFIGURED: "estrategia de puja mal configurada",
  BudgetPaused: "detenida al agotar presupuesto",
  BudgetAndManualPaused: "detenida por presupuesto y pausada a mano",
  Suspended: "suspendida por Microsoft",
  WITH_ISSUES: "con problemas",
  FAIL: "no sale de aprendizaje",
};

const rank: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
const zero = (): Record<HealthSeverity, number> => ({ critical: 0, warning: 0, info: 0 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function brandOf(s: UnifiedDeliverySignal): BrandId {
  return brandOfCampaign(s.account_name, s.campaign_name ?? s.entity_name);
}

export function buildDeliveryView(input: DeliveryInput): DeliveryView {
  const scopedSignals = input.signals.filter(s => input.platforms.includes(s.platform as PlatformId) &&
    (input.directAccounts ? input.directAccounts.get(`${s.platform}:${s.account_id}`) : brandOf(s)) === input.brand);
  const dailyByAccount = new Map<string, number>();
  for (const b of input.budgets) {
    if (b.platform !== "meta") continue;
    if (input.directAccounts && input.directAccounts.get(`${b.platform}:${b.account_id}`) !== input.brand) continue;
    // An unknown daily amount is not zero: the account's daily total becomes unknown (NaN), never understated.
    const daily = b.daily_budget ?? b.daily_estimate ?? Number.NaN;
    dailyByAccount.set(b.account_id, (dailyByAccount.get(b.account_id) ?? 0) + daily);
  }
  const items: HealthItem[] = [];
  for (const s of scopedSignals) {
    const platform = s.platform as PlatformId;
    let severity: HealthSeverity = s.severity;
    let detail = s.detail ?? (s.code && CODE_LABEL[s.code] ? CODE_LABEL[s.code]! : null);
    if (s.kind === "spend_cap" && s.spend_cap !== null && s.amount_spent !== null) {
      // Cuánto alcanza el tope con el presupuesto diario vigente de la cuenta (misma moneda).
      const remaining = Math.max(0, s.spend_cap - s.amount_spent);
      const daily = dailyByAccount.get(s.account_id) ?? 0;
      const days = Number.isFinite(daily) && daily > 0 ? remaining / daily : null;
      if (severity !== "critical" && days !== null) severity = days < 1 ? "critical" : days < input.daysLeft + 1 ? "warning" : "info";
      detail = `Quedan ${remaining.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${s.currency ?? ""} de ${s.spend_cap.toLocaleString("es-MX", { maximumFractionDigits: 0 })}${
        days !== null ? `: alcanza para ${days < 1 ? "menos de un día" : plural(Math.floor(days), "día", "días")} al diario actual` : ""
      }.`;
      if (severity === "info" && days !== null && days >= input.daysLeft + 1) continue; // alcanza el resto del mes: sin ruido
    }
    items.push({
      key: `${s.platform}:${s.entity_level}:${s.entity_id}:${s.kind}:${s.code ?? ""}`,
      platform,
      severity,
      kind: s.kind,
      title: KIND_TITLE[s.kind] ?? s.kind,
      entity: s.entity_level === "account" ? s.account_name : s.entity_name,
      account: s.account_name,
      detail,
    });
  }
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.platform.localeCompare(b.platform) || a.entity.localeCompare(b.entity));

  const counts = zero();
  const per = new Map<PlatformId, Record<HealthSeverity, number>>();
  for (const i of items) {
    counts[i.severity]++;
    const c = per.get(i.platform) ?? zero();
    c[i.severity]++;
    per.set(i.platform, c);
  }
  const byPlatform = input.platforms.filter((p) => per.has(p)).map((p) => ({ platform: p, name: PLATFORMS[p].name, counts: per.get(p)! }));

  const insights: DeliveryView["insights"] = [];
  const count = (kind: string, sev?: HealthSeverity) => items.filter((i) => i.kind === kind && (!sev || i.severity === sev)).length;
  if (counts.critical) insights.push({ tone: "warn", text: `${plural(counts.critical, "señal crítica", "señales críticas")}: cuentas o campañas que no entregan o están por dejar de hacerlo.` });
  const accounts = count("account_status");
  if (accounts) insights.push({ tone: "warn", text: `${plural(accounts, "cuenta reporta", "cuentas reportan")} un problema de estado (pago, revisión o cierre).` });
  const caps = items.filter((i) => i.kind === "spend_cap" && i.severity !== "info");
  if (caps.length) insights.push({ tone: "warn", text: `${plural(caps.length, "tope de gasto de Meta no alcanza", "topes de gasto de Meta no alcanzan")} para el resto del mes al diario actual.` });
  const policy = count("policy");
  if (policy) insights.push({ tone: "warn", text: `${plural(policy, "campaña tiene", "campañas tienen")} anuncios rechazados, limitados o en revisión.` });
  const limited = count("budget_limited");
  if (limited) insights.push({ tone: "info", text: `${plural(limited, "campaña de Google está limitada", "campañas de Google están limitadas")} por presupuesto.` });
  const paused = count("paused_by_budget");
  if (paused) insights.push({ tone: "info", text: `${plural(paused, "campaña de Microsoft se detuvo", "campañas de Microsoft se detuvieron")} al agotar su presupuesto.` });
  const learning = count("learning") + count("learning_limited");
  if (learning) insights.push({ tone: "info", text: `${plural(learning, "elemento está", "elementos están")} en aprendizaje: sus variaciones de entrega son esperadas.` });
  if (!items.length) insights.push({ tone: "good", text: "Ninguna plataforma reporta problemas de entrega para esta marca." });

  const extractedAt = scopedSignals.reduce<string | null>((max, s) => (max === null || s.extracted_at > max ? s.extracted_at : max), null);
  return { counts, byPlatform, items, insights, extractedAt };
}
