import { ApiError } from "../../utils/errors.js";
import type { MetaConfig } from "./config.js";

export interface MetaPrimaryRule {
  account_id: string;
  action: string;
  campaign_id?: string;
  campaign_name_contains?: string;
  campaign_name_not_contains?: string;
}

/** Literal matches, no user-supplied regex. Account IDs are normalized by the config reader. */
export function parsePrimaryRules(value: string): MetaPrimaryRule[] {
  const raw: unknown = JSON.parse(value);
  if (!Array.isArray(raw) || raw.length > 200) throw new Error("Reglas inválidas.");
  const conditions = ["campaign_id", "campaign_name_contains", "campaign_name_not_contains"] as const;
  return raw.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Regla inválida.");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["account_id", "action", ...conditions].includes(key))) throw new Error();
    const account = typeof row.account_id === "string" ? row.account_id.replace(/^act_/, "") : "";
    if (!/^\d{1,30}$/.test(account) || typeof row.action !== "string" || !/^[\w.:-]{1,200}$/.test(row.action))
      throw new Error();
    const keys = conditions.filter((key) => Object.hasOwn(row, key));
    if (keys.length !== 1) throw new Error();
    const key = keys[0]!,
      match = row[key];
    if (typeof match !== "string" || !match.trim() || match.length > 200 || /[\r\n]/.test(match)) throw new Error();
    if (key === "campaign_id" && !/^\d{1,30}$/.test(match)) throw new Error();
    return { account_id: account, action: row.action, [key]: match.trim() };
  });
}

/** Rules for an account are fail-closed: an unmatched campaign does not inherit a global action. */
export function primaryForCampaign(config: MetaConfig, accountId: string, campaignId: string, name?: string | null) {
  const rules = config.primaryRules.filter((rule) => rule.account_id === accountId);
  if (rules.length) {
    const matches = rules.filter((rule) => {
      if (rule.campaign_id !== undefined) return rule.campaign_id === campaignId;
      if (!name?.trim()) return false;
      const lower = name.toLocaleLowerCase("en");
      return rule.campaign_name_contains !== undefined
        ? lower.includes(rule.campaign_name_contains.toLocaleLowerCase("en"))
        : !lower.includes(rule.campaign_name_not_contains!.toLocaleLowerCase("en"));
    });
    const actions = [...new Set(matches.map((rule) => rule.action))];
    if (actions.length > 1)
      throw new ApiError("NOT_CONFIGURED", "Las reglas principales de Meta se contradicen para esta campaña.");
    return { action: actions[0], scope: actions.length ? "campaign_rule" : "unmatched_rule" };
  }
  return config.primaryActions[accountId]
    ? { action: config.primaryActions[accountId], scope: "account" }
    : { action: config.primaryAction, scope: config.primaryAction ? "global" : "none" };
}
