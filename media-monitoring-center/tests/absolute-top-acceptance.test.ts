import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleDomainsSchema, domainMetadata, normalizeGoogleCustomerId } from "@/lib/domains/config";
import { evaluateAbsoluteTop, summarizeAbsoluteTop } from "@/lib/absolute-top/engine";
import type { AbsoluteTopAudit, AbsoluteTopEvaluation, AbsoluteTopRow } from "@/lib/absolute-top/types";
import { absoluteTopRowSchema } from "@/lib/absolute-top/schema";

// Read the production master. Test fixtures do not introduce another account/target map.
const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const first = config.domains[0].accounts[0].customerId;
const second = config.domains[1].accounts[0].customerId;
const third = config.domains[2].accounts[0].customerId;

function row(rate: number | null, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return {
    level: "campaign", domain_id: null, domain_name: null, customer_id: first,
    account_id: first, account_name: "Cuenta de prueba", campaign_id: "c1", campaign_name: "Search | Paquetes",
    campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null,
    date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City",
    extracted_at: "2026-10-02T06:00:00Z", absolute_top_rate: rate, top_of_page_rate: null,
    search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null,
    impressions: 1000, clicks: 100, ctr: 10, cpc: 5, spend: 500, conversions: 4,
    bidding_strategy: "TARGET_CPA", daily_budget: 1000, share_bounds: {}, warnings: [], ...patch,
  };
}
function group(id: string, rate: number | null, impressions = 200): AbsoluteTopRow {
  return row(rate, { level: "ad_group", ad_group_id: id, ad_group_name: `Grupo ${id}`, ad_group_status: "active", impressions });
}
function audit(rows: AbsoluteTopRow[], patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit {
  return { version: 1, auditId: "audit-1", customerId: rows[0]?.customer_id ?? first, observedAt: "2026-10-02T06:00:00Z", from: "2026-10-01", to: "2026-10-01", granularity: "daily", coverage: "complete", rows, warnings: [], ...patch };
}
function evaluated(rate: number | null, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopEvaluation {
  return evaluateAbsoluteTop(audit([row(rate, patch)]), [], config)[0];
}

describe("Absolute Top — acceptance cases requested by the business", () => {
  it.each([
    [first, .72, "meets", 2], [first, .68, "near", -2], [first, .50, "below", -20],
    [second, .12, "meets", 2], [second, .08, "near", -2],
    [third, .28, "meets", 3], [third, .20, "near", -5],
  ])("applies the central target: customer %s, rate %s → %s", (customer, rate, state, gap) => {
    const actual = evaluated(rate as number, { customer_id: customer as string, account_id: customer as string });
    expect(actual.state).toBe(state);
    expect(actual.gap_pp).toBeCloseTo(gap as number);
    expect(actual.domain_id).toBe(config.domains.find(d => d.accounts.some(a => a.customerId === customer))?.id);
  });

  it("retains an affected group when the parent campaign meets the target", () => {
    const result = evaluateAbsoluteTop(audit([row(.73), group("good", .8, 800), group("bad", .45, 200)]), [], config);
    expect(result.find(r => r.level === "campaign")?.state).toBe("meets");
    expect(result.find(r => r.ad_group_id === "bad")).toMatchObject({ state: "below", cross_status: "localized", group_weight: .2 });
  });

  it("recognizes a generalized failure without inheriting the campaign percentage", () => {
    const result = evaluateAbsoluteTop(audit([row(.65), group("a", .55, 500), group("b", .6, 500)]), [], config);
    expect(result.find(r => r.level === "campaign")?.state).toBe("near");
    expect(result.filter(r => r.level === "ad_group").map(r => r.state)).toEqual(["below", "below"]);
    expect(result.every(r => r.cross_status === "generalized")).toBe(true);
  });

  it("does not generate a critical alert with insufficient volume", () => {
    expect(evaluated(.01, { impressions: config.absoluteTop.minImpressions - 1 })).toMatchObject({ state: "insufficient", severity: "NORMAL", severity_score: 0 });
  });
  it("preserves an unavailable rate as N/D instead of zero", () => {
    expect(evaluated(null)).toMatchObject({ absolute_top_rate: null, gap_pp: null, state: "insufficient" });
  });
  it("detects a sudden fall while the domain target is still met", () => {
    const before = audit([row(.9)]);
    const old = evaluateAbsoluteTop(before, [], config);
    const result = evaluateAbsoluteTop(audit([row(.8)], { auditId: "audit-2", observedAt: "2026-10-02T07:00:00Z" }), [before], config, old)[0];
    expect(result).toMatchObject({ state: "meets", sudden_drop: true, severity: "ATTENTION" });
    expect(result.comparison.previous.delta_pp).toBeCloseTo(-10);
  });
  it("records recovery only after a valid above-target observation", () => {
    const before = audit([row(.5)]), old = evaluateAbsoluteTop(before, [], config);
    const result = evaluateAbsoluteTop(audit([row(.74)], { auditId: "audit-2", observedAt: "2026-10-02T07:00:00Z" }), [before], config, old)[0];
    expect(result).toMatchObject({ state: "meets", severity: "NORMAL", sudden_drop: false });
    expect(result.persistence.consecutive_audits).toBe(0);
  });
  it("records a relapse as a new episode after recovery", () => {
    const a = audit([row(.5)]), b = audit([row(.8)], { auditId: "audit-2", observedAt: "2026-10-02T07:00:00Z" });
    const recovered = evaluateAbsoluteTop(b, [a], config, evaluateAbsoluteTop(a, [], config));
    const result = evaluateAbsoluteTop(audit([row(.5)], { auditId: "audit-3", observedAt: "2026-10-02T08:00:00Z" }), [a, b], config, recovered)[0];
    expect(result.persistence).toMatchObject({ consecutive_audits: 1, label: "Observación", first_detected_at: "2026-10-02T08:00:00Z" });
  });
  it("identifies concentrated impact in one group and calculates its impression weight", () => {
    const result = evaluateAbsoluteTop(audit([row(.6), group("heavy", .5, 800), group("light", .9, 200)]), [], config);
    expect(result.find(r => r.ad_group_id === "heavy")).toMatchObject({ group_weight: .8, cross_status: "concentrated" });
  });
  it("keeps multiple domain failures visible when the weighted campaign indicator is healthy", () => {
    const result = evaluateAbsoluteTop(audit([row(.9, { impressions: 9000 }), row(.5, { campaign_id: "c2", impressions: 1000 }), group("bad", .4, 500)]), [], config);
    const summary = summarizeAbsoluteTop(result, config)[0];
    expect(summary.weighted_absolute_top).toBeCloseTo(.86);
    expect(summary.below).toBe(2);
    expect(result.filter(r => r.state === "below")).toHaveLength(2);
  });
  it.each(config.domains.flatMap(d => d.accounts))("normalizes customer $customerId, preserving the master assignment", account => {
    const hyphenated = `${account.customerId.slice(0, 3)}-${account.customerId.slice(3, 6)}-${account.customerId.slice(6)}`;
    expect(normalizeGoogleCustomerId(hyphenated)).toBe(account.customerId);
    expect(domainMetadata(config, "google", hyphenated, account.name, "izzi")).toEqual(domainMetadata(config, "google", account.customerId, account.name, "izzi"));
  });
  it("raises a technical classification warning without assigning an unknown account by name", () => {
    const actual = evaluated(.5, { customer_id: "9999999999", account_id: "9999999999", account_name: config.domains[0].accounts[0].name });
    expect(actual).toMatchObject({ domain_id: "unclassified", domain_name: "Sin clasificar", target_rate: null, state: "unclassified" });
    expect(actual.diagnostics.join(" ")).toMatch(/sin dominio/i);
  });
});

describe("Absolute Top — independent precision, completeness and comparison checks", () => {
  it("does not consolidate accounts reporting different native windows into one domain rate", () => {
    const other = config.domains[0].accounts[1].customerId;
    const yesterday = evaluateAbsoluteTop(audit([row(.9, { customer_id: other, account_id: other, date: "2026-09-30" })], { customerId: other, from: "2026-09-30", to: "2026-09-30" }), [], config)[0];
    const actual = summarizeAbsoluteTop([evaluated(.8), yesterday], config)[0];
    expect(actual).toMatchObject({ campaigns: 2, meets: 2, weighted_absolute_top: null });
  });
  it("preserves a segmented CTR greater than 100 while retaining the primary ratio bounds", () => {
    expect(absoluteTopRowSchema.parse(row(.8, { ctr: 120 })).ctr).toBe(120);
    expect(absoluteTopRowSchema.safeParse(row(1.2)).success).toBe(false);
  });
  it("accepts the API's omitted censoring metadata without inventing a metric", () => {
    const actual = absoluteTopRowSchema.parse({ ...row(null), share_bounds: undefined });
    expect(actual.share_bounds).toEqual({});
    expect(actual.absolute_top_rate).toBeNull();
    expect(actual.search_impression_share).toBeNull();
  });
  it.each([.65, .7, .64999])("handles the first-domain boundary %s without floating point misclassification", rate => {
    expect(evaluated(rate).state).toBe(rate >= .7 ? "meets" : rate >= .65 ? "near" : "below");
  });
  it("does not count campaign impressions a second time through their groups", () => {
    const result = evaluateAbsoluteTop(audit([row(.72), group("a", .9, 800), group("b", .45, 200)]), [], config);
    expect(summarizeAbsoluteTop(result, config)[0]).toMatchObject({ campaigns: 1, ad_groups: 2, weighted_absolute_top: .72, weighting_approximate: true });
  });
  it("does not turn an absent parent into a weight or a healthy cross diagnosis", () => {
    expect(evaluateAbsoluteTop(audit([group("a", .5)]), [], config)[0]).toMatchObject({ group_weight: null, cross_status: "unknown" });
  });
  it("does not claim recovery when extraction is partial even if a returned rate meets", () => {
    const before = audit([row(.5)]);
    const old = evaluateAbsoluteTop(before, [], config);
    const result = evaluateAbsoluteTop(audit([row(.9)], { auditId: "partial", coverage: "partial" }), [before], config, old)[0];
    expect(result.state).toBe("insufficient");
    expect(result.persistence.first_detected_at).toBe(old[0].persistence.first_detected_at);
  });
  it("does not compare differing hourly cutoffs as a sudden drop", () => {
    const before = audit(Array.from({ length: 9 }, (_, hour) => row(.9, { hour })), { granularity: "hourly", observedAt: "2026-10-01T15:00:00Z" });
    const old = evaluateAbsoluteTop(before, [], config);
    expect(old[0].state).toBe("meets");
    const current = audit(Array.from({ length: 13 }, (_, hour) => row(.7, { hour })), { auditId: "audit-2", granularity: "hourly", observedAt: "2026-10-01T19:00:00Z" });
    const result = evaluateAbsoluteTop(current, [before], config, old)[0];
    expect(result.state).toBe("meets");
    expect(result.comparison.previous.rate).toBeNull();
    expect(result.sudden_drop).toBe(false);
  });
  it("does not compare daily partial totals before the source day closes", () => {
    const current = audit([row(.9)], { observedAt: "2026-10-01T15:00:00Z" });
    expect(evaluateAbsoluteTop(current, [], config)[0]).toMatchObject({ state: "insufficient", severity: "NORMAL" });
  });
  it("keeps Search IS unknown rather than averaging incompatible eligible denominators", () => {
    const current = audit(Array.from({ length: 9 }, (_, hour) => row(.8, { hour, search_impression_share: .8, search_lost_is_rank: .1 })), { granularity: "hourly", observedAt: "2026-10-01T15:00:00Z" });
    expect(evaluateAbsoluteTop(current, [], config)[0]).toMatchObject({ state: "meets", search_impression_share: null, search_lost_is_rank: null, ctr: 10 });
  });
  it("keeps a parent's compliance separate when a majority of children fail", () => {
    const result = evaluateAbsoluteTop(audit([row(.73), group("a", .45, 400), group("b", .5, 400), group("c", .9, 200)]), [], config);
    expect(result.every(r => r.cross_status === "localized")).toBe(true);
  });
  it("does not compare history in another currency or source timezone", () => {
    const before = audit([row(.9, { date: "2026-09-30", currency: "USD", source_timezone: "America/New_York" })], { from: "2026-09-30", to: "2026-09-30" });
    const result = evaluateAbsoluteTop(audit([row(.8)]), [before], config, evaluateAbsoluteTop(before, [], config))[0];
    expect(result.comparison.previous.rate).toBeNull();
    expect(result.comparison.previous_day.rate).toBeNull();
  });
  it("deduplicates cumulative refreshes instead of adding the same date twice", () => {
    const a = audit([row(.5, { date: "2026-09-30" })], { from: "2026-09-30", to: "2026-09-30" });
    const b = audit([row(.8, { date: "2026-09-30" })], { from: "2026-09-30", to: "2026-09-30", auditId: "refresh", observedAt: "2026-10-02T07:00:00Z" });
    const current = audit([row(.9)], { auditId: "today", observedAt: "2026-10-02T08:00:00Z" });
    const result = evaluateAbsoluteTop(current, [a, b], config)[0];
    expect(result.comparison.previous_day).toMatchObject({ samples: 1, rate: .8 });
  });
  it("excludes another account's observations from comparisons", () => {
    const history = audit([row(.1, { customer_id: second, account_id: second })]);
    const result = evaluateAbsoluteTop(audit([row(.8)]), [history], config)[0];
    expect(result.comparison.previous_day.rate).toBeNull();
  });
  it("does not label a partial three-day history as a complete seven-day comparison", () => {
    const history = [0, 1, 2].map((n) => audit([row(.8, { date: `2026-09-${28 + n}` })], { auditId: `d${n}`, from: `2026-09-${28 + n}`, to: `2026-09-${28 + n}` }));
    expect(evaluateAbsoluteTop(audit([row(.8)]), history, config)[0].comparison.last_7d.rate).toBeNull();
  });
});
