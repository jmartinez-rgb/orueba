import type { DeliveryKind, NormalizedAccount, NormalizedDeliverySignal } from "../../types/normalized.js";
import { currencyOffset } from "./budgets.js";
import { metaObject } from "./types.js";

/**
 * Salud de entrega de Meta (contrato: SDK oficial facebook-business 26.0.2). Cuenta: account_status,
 * disable_reason, amount_spent y spend_cap (texto en unidad mínima de la moneda). Campañas y
 * conjuntos ACTIVE o WITH_ISSUES: issues_info (error_code, error_summary, level) y, en conjuntos,
 * learning_stage_info.status (LEARNING / FAIL).
 */
export const HEALTH_ACCOUNT_FIELDS = "account_status,disable_reason,amount_spent,spend_cap,currency";
export const HEALTH_CAMPAIGN_FIELDS = "id,name,effective_status,issues_info";
export const HEALTH_ADSET_FIELDS = "id,name,campaign_id,effective_status,issues_info,learning_stage_info";
export const HEALTH_STATUS_FILTER = JSON.stringify(["ACTIVE", "WITH_ISSUES"]);

const ACCOUNT_STATUS: Record<number, { code: string; severity: NormalizedDeliverySignal["severity"] }> = {
  2: { code: "DISABLED", severity: "critical" },
  3: { code: "UNSETTLED", severity: "critical" },
  7: { code: "PENDING_RISK_REVIEW", severity: "warning" },
  8: { code: "PENDING_SETTLEMENT", severity: "warning" },
  9: { code: "IN_GRACE_PERIOD", severity: "warning" },
  100: { code: "PENDING_CLOSURE", severity: "critical" },
  101: { code: "CLOSED", severity: "critical" },
  202: { code: "ANY_CLOSED", severity: "critical" },
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const minor = (v: unknown) => {
  const raw = typeof v === "number" ? String(v) : text(v);
  return raw && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
};

function issues(row: Record<string, unknown>): Array<{ code: string | null; summary: string | null }> {
  if (!Array.isArray(row.issues_info)) return [];
  return row.issues_info.filter(metaObject).map((i) => ({
    code: typeof i.error_code === "number" ? String(i.error_code) : text(i.error_type),
    summary: text(i.error_summary) ?? text(i.error_message),
  }));
}

export function normalizeMetaHealth(
  account: NormalizedAccount,
  info: Record<string, unknown>,
  campaigns: Record<string, unknown>[],
  adSets: Record<string, unknown>[],
  at: string,
): NormalizedDeliverySignal[] {
  const currency = text(info.currency) ?? account.currency;
  const offset = currencyOffset(currency);
  const base = {
    platform: "meta" as const,
    client_id: account.client_id,
    account_id: account.account_id,
    account_name: account.account_name,
    currency,
    spend_cap: null,
    amount_spent: null,
    extracted_at: at,
  };
  const out: NormalizedDeliverySignal[] = [];
  const status = typeof info.account_status === "number" ? ACCOUNT_STATUS[info.account_status] : undefined;
  if (status)
    out.push({
      ...base,
      entity_level: "account",
      campaign_id: null,
      campaign_name: null,
      entity_id: account.account_id,
      entity_name: account.account_name,
      kind: "account_status",
      severity: status.severity,
      code: status.code,
      detail:
        typeof info.disable_reason === "number" && info.disable_reason > 0
          ? `disable_reason ${info.disable_reason}`
          : null,
    });
  const cap = minor(info.spend_cap),
    spent = minor(info.amount_spent);
  // spend_cap "0" o ausente = sin tope. Con tope se informa siempre: el monitoreo calcula cuántos días alcanza.
  if (cap !== null && cap > 0 && offset !== null)
    out.push({
      ...base,
      entity_level: "account",
      campaign_id: null,
      campaign_name: null,
      entity_id: account.account_id,
      entity_name: account.account_name,
      kind: "spend_cap",
      severity: spent !== null && spent >= cap ? "critical" : "info",
      code: spent !== null && spent >= cap ? "SPEND_CAP_REACHED" : "SPEND_CAP",
      detail: null,
      spend_cap: cap / offset,
      amount_spent: spent === null ? null : spent / offset,
    });
  const names = new Map<string, string>();
  for (const c of campaigns.filter(metaObject)) {
    const id = text(c.id);
    if (!id) continue;
    const name = text(c.name) ?? id;
    names.set(id, name);
    const found = issues(c);
    if (c.effective_status === "WITH_ISSUES" || found.length)
      out.push({
        ...base,
        entity_level: "campaign",
        campaign_id: id,
        campaign_name: name,
        entity_id: id,
        entity_name: name,
        kind: "delivery_issue",
        severity: c.effective_status === "WITH_ISSUES" ? "critical" : "warning",
        code: found[0]?.code ?? text(c.effective_status),
        detail:
          found
            .map((i) => i.summary)
            .filter(Boolean)
            .join(" · ") || null,
      });
  }
  for (const a of adSets.filter(metaObject)) {
    const id = text(a.id),
      campaignId = text(a.campaign_id);
    if (!id) continue;
    const name = text(a.name) ?? id;
    const signal = (
      kind: DeliveryKind,
      severity: NormalizedDeliverySignal["severity"],
      code: string | null,
      detail: string | null,
    ) =>
      out.push({
        ...base,
        entity_level: "ad_set",
        campaign_id: campaignId,
        campaign_name: campaignId ? (names.get(campaignId) ?? null) : null,
        entity_id: id,
        entity_name: name,
        kind,
        severity,
        code,
        detail,
      });
    const found = issues(a);
    if (a.effective_status === "WITH_ISSUES" || found.length)
      signal(
        "delivery_issue",
        a.effective_status === "WITH_ISSUES" ? "critical" : "warning",
        found[0]?.code ?? text(a.effective_status),
        found
          .map((i) => i.summary)
          .filter(Boolean)
          .join(" · ") || null,
      );
    const learning = metaObject(a.learning_stage_info) ? text(a.learning_stage_info.status) : null;
    if (learning === "LEARNING") signal("learning", "info", "LEARNING", null);
    else if (learning === "FAIL") signal("learning_limited", "warning", "FAIL", null);
  }
  return out;
}
