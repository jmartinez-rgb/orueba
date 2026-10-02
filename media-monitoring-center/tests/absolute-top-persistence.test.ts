import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { FileRecordStore, type RecordStore } from "@/lib/records/store";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import { evaluateAbsoluteTop } from "@/lib/absolute-top/engine";
import { absoluteTopAuditSchema } from "@/lib/absolute-top/schema";
import { getAbsoluteTopDashboard, combineAbsoluteTopRun } from "@/lib/absolute-top/service";
import { syncAbsoluteTop } from "@/lib/absolute-top/ingest";
import { buildAbsoluteTopAlertText } from "@/lib/absolute-top/format";
import { reconcile } from "@/lib/alerts/incident-manager";
import { emptyAlertState } from "@/lib/alerts/types";
import type { AbsoluteTopAudit, AbsoluteTopEvaluation, AbsoluteTopRow } from "@/lib/absolute-top/types";
import type { MonitoringRun } from "@/lib/monitoring/types";

const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const customer = config.domains[0].accounts[0].customerId;
const at = "2026-10-02T08:00:00Z";
const now = new Date("2026-10-02T12:00:00Z");
function row(rate: number | null = .5, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return { level: "campaign", domain_id: null, domain_name: null, customer_id: customer, account_id: customer, account_name: "Cuenta ficticia", campaign_id: "c1", campaign_name: "Search fixture", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: at, absolute_top_rate: rate, top_of_page_rate: .8, search_impression_share: .0999, search_lost_is_rank: null, search_lost_is_budget: null, impressions: 1000, clicks: 100, ctr: 10, cpc: 2, spend: 200, conversions: 2, bidding_strategy: null, daily_budget: 400, share_bounds: { search_impression_share: "lt_10_percent" }, warnings: [], ...patch };
}
function audit(id = "audit-1", rate: number | null = .5, patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit {
  return { version: 1, auditId: id, customerId: customer, observedAt: at, from: "2026-10-01", to: "2026-10-01", granularity: "daily", coverage: "complete", rows: [row(rate)], warnings: [], ...patch };
}
function run(rows: AbsoluteTopEvaluation[], runAt = "2026-10-02T09:00:00Z") {
  const base: MonitoringRun = { runAt, timezone: "America/Mexico_City", businessDate: "2026-10-02", cutoffHour: 3, intervalHours: 2, comparisonDates: [], historyWeeks: 4, baseline: "mean", entities: [], anomalies: [], platformStatus: {} as MonitoringRun["platformStatus"], overall: "NORMAL", pacing: {} as MonitoringRun["pacing"], curves: {} as MonitoringRun["curves"], dataHealth: {} as MonitoringRun["dataHealth"], totalIncludes: [], totalCutoffHour: 3, platforms: ["google"] };
  return combineAbsoluteTopRun(base, { brand: "izzi", selectedDomain: "all", configured: true, available: true, lastAuditAt: rows[0]?.audit_at ?? null, domains: config.domains, policy: config.absoluteTop, rows, summaries: [], warnings: [], approximationNotice: "Aproximado" });
}
const opts = { settings: DEFAULT_SETTINGS, notify: true, whatsapp: { templateAlert: "fixture", templateRecovery: "fixture", templateLanguage: "es_MX" } };
const directories: string[] = [];
async function store() { const dir = await mkdtemp(join(tmpdir(), "absolute-top-fixture-")); directories.push(dir); return { dir, value: new AbsoluteTopStore(new FileRecordStore(dir)) }; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("Absolute Top immutable history and operational episodes", () => {
  it("persists a private atomic document and reads it after recreation", async () => {
    const { dir, value } = await store();
    await value.ingest(audit(), config, now);
    const restored = new AbsoluteTopStore(new FileRecordStore(dir));
    expect(await restored.latest(customer)).toHaveLength(1);
    expect(await restored.history(customer)).toHaveLength(1);
    expect((await stat(join(dir, "absolute-top", "izzi", `${customer}.json`))).mode & 0o777).toBe(0o600);
  });
  it("deduplicates simultaneous retries of the same immutable audit", async () => {
    const { value } = await store();
    await Promise.all(Array.from({ length: 8 }, () => value.ingest(audit(), config, now)));
    expect(await value.history(customer)).toHaveLength(1);
    expect((await value.latest(customer))[0].persistence.consecutive_audits).toBe(1);
  });
  it("serializes concurrent distinct audits without losing history or counters", async () => {
    const { value } = await store();
    await Promise.all([value.ingest(audit(), config, now), value.ingest(audit("audit-2", .5, { observedAt: "2026-10-02T10:00:00Z" }), config, now)]);
    expect(await value.history(customer)).toHaveLength(2);
    expect((await value.latest(customer))[0].persistence.consecutive_audits).toBe(2);
  });
  it("rejects reuse of an audit ID for another payload without overwriting", async () => {
    const { value } = await store(); await value.ingest(audit(), config, now);
    await expect(value.ingest(audit("audit-1", .9), config, now)).rejects.toMatchObject({ code: "AUDIT_ID_CONFLICT" });
    expect((await value.latest(customer))[0].absolute_top_rate).toBe(.5);
  });
  it("stores late historical extractions without moving the live checkpoint backwards", async () => {
    const { value } = await store(); await value.ingest(audit(), config, now);
    await value.ingest(audit("older", .9, { observedAt: "2026-10-02T07:00:00Z" }), config, now);
    expect(await value.history(customer)).toHaveLength(2);
    expect((await value.latest(customer))[0].audit_id).toBe("audit-1");
  });
  it("orders equivalent offset timestamps chronologically", async () => {
    const { value } = await store(); await value.ingest(audit("later", .5, { observedAt: "2026-10-02T03:00:00-06:00" }), config, now);
    await value.ingest(audit("earlier", .9), config, now);
    expect((await value.latest(customer))[0].audit_id).toBe("later");
  });
  it("prunes raw history using the central retention and preserves active detection metadata", async () => {
    const { value } = await store();
    const older = audit("older", .5, { observedAt: "2026-07-01T08:00:00Z", from: "2026-06-30", to: "2026-06-30", rows: [row(.5, { date: "2026-06-30", extracted_at: "2026-07-01T08:00:00Z" })] });
    await value.ingest(older, config, new Date(older.observedAt)); await value.ingest(audit(), config, now);
    expect((await value.history(customer)).map(item => item.auditId)).toEqual(["audit-1"]);
    expect((await value.latest(customer))[0].persistence.first_detected_at).toBe(older.observedAt);
    expect((await value.latest(customer))[0].evolution).toHaveLength(1);
  });
  it.each([["FUTURE_AUDIT", "2026-10-03T12:00:00Z"], ["EXPIRED_AUDIT", "2025-10-02T12:00:00Z"]])("rejects %s", async (code, observedAt) => {
    const { value } = await store(); await expect(value.ingest(audit("invalid", .5, { observedAt }), config, now)).rejects.toMatchObject({ code });
    expect(await value.history(customer)).toEqual([]);
  });
  it("rejects duplicate periods, invalid hierarchy and a range longer than seven days", () => {
    expect(absoluteTopAuditSchema.safeParse(audit("duplicate", .5, { rows: [row(), row()] })).success).toBe(false);
    expect(absoluteTopAuditSchema.safeParse(audit("bad-group", .5, { rows: [row(.5, { level: "ad_group" })] })).success).toBe(false);
    expect(absoluteTopAuditSchema.safeParse(audit("long", .5, { from: "2026-09-24" })).success).toBe(false);
  });
  it("requires a fresh extraction after master policy changes, without rewriting history", async () => {
    const { value } = await store(); await value.ingest(audit(), config, now);
    const changed = structuredClone(config); changed.domains[0].absoluteTopMinimum = .9;
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config: changed, store: value, allowedCustomerIds: [customer] });
    expect(dashboard.rows[0]).toMatchObject({ state: "insufficient", coverage: "unavailable", target_rate: .9, gap_pp: null });
    expect((await value.history(customer))[0].rows[0].absolute_top_rate).toBe(.5);
  });
  it("does not mix older rows with a newer policy receipt during a concurrent checkpoint update", async () => {
    const changed = structuredClone(config); changed.domains[0].absoluteTopMinimum = .9;
    const oldAudit = audit("old-policy", .8), nextAudit = audit("new-policy", .8, { observedAt: "2026-10-02T09:00:00Z" });
    const oldRows = evaluateAbsoluteTop(oldAudit, [], config), newRows = evaluateAbsoluteTop(nextAudit, [], changed);
    const oldState = { version: 1, audits: [oldAudit], latest: oldRows, latestAudit: oldAudit, configFingerprint: createHash("sha256").update(JSON.stringify(config)).digest("hex") };
    const newState = { version: 1, audits: [oldAudit, nextAudit], latest: newRows, latestAudit: nextAudit, configFingerprint: createHash("sha256").update(JSON.stringify(changed)).digest("hex") };
    let reads = 0;
    const records: RecordStore = {
      backend: "memory",
      get: async <T,>() => structuredClone(++reads === 1 ? oldState : newState) as T,
      list: async () => [`absolute-top/izzi/${customer}`],
      set: async () => { throw new Error("Read-only fixture"); },
      update: async () => { throw new Error("Read-only fixture"); },
      delete: async () => { throw new Error("Read-only fixture"); },
    };
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config: changed, store: new AbsoluteTopStore(records), now, allowedCustomerIds: [customer] });
    expect(reads).toBe(1);
    expect(dashboard.rows[0]).toMatchObject({ audit_id: "old-policy", target_rate: .9, state: "insufficient", coverage: "unavailable" });
    expect(combineAbsoluteTopRun(run([]), dashboard).absoluteTopCoverage).toEqual({});
    expect(dashboard.summaries[0].weighted_absolute_top).toBeNull();
  });
  it("filters stored account history by the authorized current brand scope", async () => {
    const { value } = await store(); await value.ingest(audit(), config, now);
    expect((await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, allowedCustomerIds: [] })).rows).toEqual([]);
    expect((await getAbsoluteTopDashboard({ brand: "sky", config, store: value })).rows).toEqual([]);
  });
  it("marks the domain aggregate N/D when an authorized sibling account has no extraction", async () => {
    const { value } = await store(); await value.ingest(audit("healthy", .8), config, now);
    const sibling = config.domains[0].accounts[1].customerId;
    const before = await value.latest(customer);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, allowedCustomerIds: [customer, sibling] });
    expect(dashboard.rows[0].state).toBe("meets");
    expect(dashboard.summaries.find(summary => summary.domain_id === config.domains[0].id)?.weighted_absolute_top).toBeNull();
    expect(dashboard.warnings.some(warning => warning.includes(sibling) && warning.includes("no hay una extracción completa"))).toBe(true);
    expect(await value.latest(customer)).toEqual(before);
  });
  it("computes a domain aggregate only after every expected authorized account has a complete fresh extraction", async () => {
    const { value } = await store(); await value.ingest(audit("healthy", .8), config, now);
    const sibling = config.domains[0].accounts[1].customerId;
    await value.ingest(audit("sibling", .6, { customerId: sibling, rows: [row(.6, { customer_id: sibling, account_id: sibling })] }), config, now);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, allowedCustomerIds: [customer, sibling] });
    expect(dashboard.summaries.find(summary => summary.domain_id === config.domains[0].id)?.weighted_absolute_top).toBeCloseTo(.7);
    expect(dashboard.warnings).toEqual([]);
  });
  it("warns about stale checkpoints without rewriting historical state or confirming recovery", async () => {
    const { value } = await store(); const old = await value.ingest(audit(), config, now);
    const later = new Date(Date.parse(at) + (config.absoluteTop.repeatAfterHours + 1) * 3600000);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now: later, allowedCustomerIds: [customer] });
    expect(dashboard.rows).toEqual(old);
    expect(dashboard.warnings.some(warning => warning.includes(customer) && warning.includes("auditoría antigua") && warning.includes("no se confirma recuperación"))).toBe(true);
    expect(dashboard.summaries[0].weighted_absolute_top).toBeNull();
    const initial = reconcile(emptyAlertState(), run(old), opts);
    const stale = combineAbsoluteTopRun(run([], later.toISOString()), dashboard);
    expect(stale.absoluteTopCoverage).toEqual({});
    expect(reconcile(initial.state, stale, opts).state.incidents[0].resolvedAt).toBeNull();
    expect(await value.latest(customer)).toEqual(old);
  });
  it("distinguishes a complete empty account from an absent extraction without inventing rows", async () => {
    const { value } = await store(); await value.ingest(audit("healthy", .8), config, now);
    const sibling = config.domains[0].accounts[1].customerId;
    await value.ingest(audit("empty", null, { customerId: sibling, rows: [] }), config, now);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, allowedCustomerIds: [customer, sibling] });
    expect(dashboard.rows).toHaveLength(1);
    expect(dashboard.summaries[0].weighted_absolute_top).toBe(.8);
    expect(dashboard.warnings).toEqual([]);
    const emptyOnly = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, allowedCustomerIds: [sibling] });
    expect(emptyOnly).toMatchObject({ available: true, lastAuditAt: at, rows: [], warnings: [] });
  });
  it("requires complete coverage for a stored failed account even when the other account is healthy", async () => {
    const { value } = await store(); await value.ingest(audit("healthy", .8), config, now);
    const sibling = config.domains[0].accounts[1].customerId;
    await value.ingest(audit("failed", null, { customerId: sibling, coverage: "unavailable", rows: [], warnings: ["API_TRANSPORT_ERROR"] }), config, now);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, allowedCustomerIds: [customer, sibling] });
    expect(dashboard.summaries[0].weighted_absolute_top).toBeNull();
    expect(dashboard.warnings.some(warning => warning.includes(sibling) && warning.includes("incompleta"))).toBe(true);
    expect(dashboard.rows).toHaveLength(1);
  });
  it("does not count or warn about accounts outside the allowed brand and selected domain", async () => {
    const { value } = await store(); await value.ingest(audit("healthy", .8), config, now);
    const outside = config.domains[1].accounts[0].customerId;
    await value.ingest(audit("outside", null, { customerId: outside, coverage: "unavailable", rows: [] }), config, now);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store: value, now, domainId: config.domains[0].id, allowedCustomerIds: [customer, outside] });
    expect(dashboard.rows).toHaveLength(1);
    expect(dashboard.summaries).toHaveLength(1);
    expect(dashboard.summaries[0].weighted_absolute_top).toBe(.8);
    expect(dashboard.warnings).toEqual([]);
  });
  it("does not recover or advance an incident when coverage is missing or an audit is replayed", () => {
    const rows = evaluateAbsoluteTop(audit(), [], config);
    const created = reconcile(emptyAlertState(), run(rows), opts);
    expect(created.state.incidents).toHaveLength(1);
    const first = created.state.incidents[0];
    expect(first.accountId).toBe(`google:${customer}`);
    expect(first.campaignId).toBe(`google:${customer}:c1`);
    const replay = reconcile(created.state, run(rows, "2026-10-02T11:00:00Z"), opts);
    expect(replay.state.incidents[0]).toEqual(first);
    const missing = reconcile(replay.state, run([], "2026-10-02T12:00:00Z"), opts);
    expect(missing.state.incidents[0].resolvedAt).toBeNull();
    expect(missing.notifications).toEqual([]);
  });
  it("recovers only with a new valid audit and creates a new episode on relapse", () => {
    const before = audit(), old = evaluateAbsoluteTop(before, [], config);
    const first = reconcile(emptyAlertState(), run(old), opts);
    const greenAudit = audit("green", .8, { observedAt: "2026-10-02T10:00:00Z" });
    const green = evaluateAbsoluteTop(greenAudit, [before], config, old);
    const recovered = reconcile(first.state, run(green, "2026-10-02T10:00:00Z"), opts);
    expect(recovered.state.incidents[0].status).toBe("RESOLVED");
    const again = evaluateAbsoluteTop(audit("relapse", .5, { observedAt: "2026-10-02T11:00:00Z" }), [before, greenAudit], config, green);
    const relapse = reconcile(recovered.state, run(again, "2026-10-02T11:00:00Z"), opts);
    expect(relapse.state.incidents).toHaveLength(2);
    expect(relapse.state.alerts.at(-1)?.consecutiveRuns).toBe(1);
    expect(relapse.notifications).toEqual([]);
  });
  it("records worsening and central repeat intervals without fictitious escalations or sends", () => {
    const a = audit("first", .64), old = evaluateAbsoluteTop(a, [], config);
    const initial = reconcile(emptyAlertState(), run(old), opts);
    const nextAudit = audit("next", .58, { observedAt: "2026-10-02T10:00:00Z" }), next = evaluateAbsoluteTop(nextAudit, [a], config, old);
    const worsened = reconcile(initial.state, run(next, nextAudit.observedAt), opts);
    expect(worsened.state.incidents[0].timeline.at(-1)?.kind).toBe("WORSENED");
    const repeatedAudit = audit("later", .58, { observedAt: "2026-10-02T15:00:00Z" }), repeated = evaluateAbsoluteTop(repeatedAudit, [a, nextAudit], config, next);
    const reminder = reconcile(worsened.state, run(repeated, repeatedAudit.observedAt), opts);
    expect(reminder.state.incidents[0].timeline.at(-1)?.kind).toBe("DURATION_EXCEEDED");
    expect(reminder.state.incidents[0].timeline.some(event => event.kind === "ESCALATED")).toBe(false);
    expect(reminder.notifications).toEqual([]);
  });
  it("does not let a selected-domain view reconcile general alert state", () => {
    const base = run([]), rows = evaluateAbsoluteTop(audit(), [], config);
    const scoped = combineAbsoluteTopRun(base, { brand: "izzi", selectedDomain: config.domains[0].id, configured: true, available: true, lastAuditAt: at, domains: config.domains, policy: config.absoluteTop, rows, summaries: [], warnings: [], approximationNotice: "" });
    expect(scoped.anomalies).toEqual(base.anomalies); expect(scoped.absoluteTopCoverage).toEqual({});
  });
  it("formats bounded shares, percentage points, exact window and platform conversions without CPA", () => {
    const text = buildAbsoluteTopAlertText(evaluateAbsoluteTop(audit(), [], config)[0]);
    expect(text).toContain("<10%"); expect(text).toContain("-20.00 pp"); expect(text).toContain("America/Mexico_City"); expect(text).toContain("conversiones de plataforma"); expect(text).not.toContain("CPA");
  });
});

describe("Absolute Top bounded extraction with offline transport fixtures", () => {
  function transport(handler: (customer: string) => Response | Promise<Response>): typeof fetch {
    return async input => { const url = new URL(String(input)); return url.pathname.endsWith("google-domains") ? Response.json({ data: config }) : handler(url.searchParams.get("account_id")!); };
  }
  const options = { url: "http://127.0.0.1:8888", apiKey: "fictitious-key", from: "2026-10-01", to: "2026-10-01", granularity: "daily" as const, clock: () => now };
  it("reads each centrally configured account and never calls another provider", async () => {
    const { value } = await store(), seen: string[] = [];
    const results = await syncAbsoluteTop({ ...options, store: value, request: transport(id => { seen.push(id); return Response.json({ data: [row(.5, { customer_id: id, account_id: id })], errors: [] }); }) });
    expect(seen).toEqual(config.domains.flatMap(domain => domain.accounts.map(account => account.customerId)));
    expect(results.every(item => item.status === "SUCCESS")).toBe(true);
    expect(await value.history(customer)).toHaveLength(1);
  });
  it("dry-run validates duplicate periods without writing success or failure checkpoints", async () => {
    const { value } = await store();
    const result = await syncAbsoluteTop({ ...options, dryRun: true, store: value, request: transport(id => Response.json({ data: [row(.5, { customer_id: id, account_id: id }), row(.5, { customer_id: id, account_id: id })] })) });
    expect(result.every(item => item.status === "FAILED" && item.code === "INVALID_AUDIT")).toBe(true);
    expect(await value.history(customer)).toEqual([]);
  });
  it("a provider error prevents partial rows from confirming recovery", async () => {
    const { value } = await store(); await value.ingest(audit(), config, now);
    const result = await syncAbsoluteTop({ ...options, store: value, request: transport(id => Response.json({ data: [row(.9, { customer_id: id, account_id: id })], errors: [{ error: { message: "private upstream detail" } }] })) });
    expect(result[0]).toMatchObject({ status: "FAILED", code: "PARTIAL_RESPONSE" });
    expect((await value.latest(customer))[0]).toMatchObject({ state: "insufficient", coverage: "unavailable" });
    expect(JSON.stringify(await value.history(customer))).not.toContain("private upstream detail");
  });
  it.each([[401, "API_AUTH_ERROR"], [403, "API_ACCESS_DENIED"], [429, "API_RATE_LIMITED"], [503, "API_RESPONSE_ERROR"]])("maps HTTP %s safely", async (status, code) => {
    const result = await syncAbsoluteTop({ ...options, dryRun: true, request: transport(() => new Response("do not persist this body", { status })) });
    expect(result.every(item => item.code === code)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("do not persist");
  });
  it("rejects invalid transport/range before any fetch", async () => {
    await expect(syncAbsoluteTop({ ...options, url: "http://external.invalid", dryRun: true })).rejects.toMatchObject({ code: "API_CONFIGURATION_MISSING" });
    await expect(syncAbsoluteTop({ ...options, from: "2026-09-20", dryRun: true })).rejects.toMatchObject({ code: "INVALID_RANGE" });
  });
});
