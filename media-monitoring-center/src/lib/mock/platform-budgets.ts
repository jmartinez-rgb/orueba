import type { UnifiedBudget } from "@/lib/integrations/unified-api";
import type { Snapshot } from "@/lib/services/snapshot";
import type { PlatformId } from "@/lib/types";

/**
 * Presupuestos de demostración para el modo demo (sin API unificada): se derivan del gasto típico
 * de cada campaña activa del catálogo de ejemplo e imitan las formas reales de cada plataforma
 * (presupuesto por conjunto en Meta, compartido y limitado en Google, total en TikTok y Microsoft).
 * Nunca se usan con datos reales.
 */
const SUPPORTED: PlatformId[] = ["meta", "google", "tiktok", "microsoft"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
const round50 = (v: number) => Math.max(50, Math.round(v / 50) * 50);

export function demoBudgets(snap: Snapshot, fxRate: number | null): UnifiedBudget[] {
  const accounts = new Map(snap.catalog.accounts.map((a) => [a.id, a]));
  const campaigns = new Map(snap.catalog.campaigns.map((c) => [c.id, c]));
  const at = snap.meta.generatedAt;
  const out: UnifiedBudget[] = [];
  // Dos campañas de Google comparten un presupuesto (llega repetido en cada una, como en la API).
  let shared: { count: number; amount: number } = { count: 0, amount: 0 };
  for (const e of snap.run.entities) {
    if (e.level !== "campaign" || !SUPPORTED.includes(e.platform) || !e.campaignId) continue;
    const campaign = campaigns.get(e.campaignId);
    const account = accounts.get(campaign?.accountId ?? e.accountId ?? "");
    if (!campaign || !account || campaign.status !== "ACTIVE") continue;
    if (account.currency === "USD" && !fxRate) continue;
    const expected = e.cumulative.spend?.expected ?? 0;
    const dayShare = e.dayShare && e.dayShare > 0.05 ? e.dayShare : 0.5;
    const fullDay = expected / dayShare;
    if (!(fullDay > 0)) continue;
    const r = hash(campaign.id);
    // El gasto del monitoreo está en MXN; las cuentas en USD guardan su presupuesto en USD.
    const toCurrency = account.currency === "USD" ? 1 / fxRate! : 1;
    const daily = round50(fullDay * (0.9 + r * 0.45) * toCurrency);
    const base: UnifiedBudget = {
      platform: e.platform,
      account_id: account.id,
      account_name: account.name,
      currency: account.currency,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      objective: campaign.sourceType ?? null,
      budget_level: "campaign",
      ad_set_id: null,
      ad_set_name: null,
      budget_type: "daily",
      daily_budget: daily,
      lifetime_budget: null,
      budget_remaining: null,
      daily_estimate: null,
      shared_budget_id: null,
      limited_by_budget: null,
      recommended_daily_budget: null,
      end_time: null,
      extracted_at: at,
    };
    if (e.platform === "meta" && r < 0.25) {
      const first = round50(daily * 0.6);
      out.push({ ...base, budget_level: "ad_set", ad_set_id: `${campaign.id}-a`, ad_set_name: "Conjunto A", daily_budget: first });
      out.push({ ...base, budget_level: "ad_set", ad_set_id: `${campaign.id}-b`, ad_set_name: "Conjunto B", daily_budget: Math.max(50, daily - first) });
    } else if ((e.platform === "tiktok" || e.platform === "meta") && r > 0.88) {
      out.push({ ...base, budget_type: "lifetime", daily_budget: null, lifetime_budget: daily * 30, budget_remaining: daily * 14, daily_estimate: daily });
    } else if (e.platform === "google") {
      const limited = r > 0.7;
      const inShared = shared.count < 2 && r < 0.35;
      if (inShared) shared = { count: shared.count + 1, amount: shared.amount || daily * 2 };
      out.push({
        ...base,
        daily_budget: inShared ? shared.amount : daily,
        limited_by_budget: limited,
        recommended_daily_budget: limited ? round50(daily * 1.3) : null,
        shared_budget_id: inShared ? "demo-shared-1" : null,
      });
    } else out.push(base);
  }
  return out;
}
