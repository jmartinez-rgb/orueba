import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleDomainsSchema, domainMetadata, normalizeGoogleCustomerId } from "@/lib/domains/config";
import { selectDomain, scopedBudgets } from "@/lib/domains/scope";
import { DomainScopedSource } from "@/lib/data/domain-source";
import { fetchGoogleDomainConfig } from "@/lib/domains/api";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { UnifiedDataSource } from "@/lib/unified/source";
import { syncUnified } from "@/lib/unified/sync";
import { FileRecordStore } from "@/lib/records/store";
import { emptyMetrics } from "@/lib/metrics";
import type { MonitoringDataSource } from "@/lib/data/source";
import type { Catalog, DailyRow, HourlyRow } from "@/lib/types";
import { emptyAlertState, type AlertState } from "@/lib/alerts/types";
import { projectDomainState } from "@/lib/services/snapshot";
import { annotateDomainRun } from "@/lib/domains/run";
import type { MonitoringRun } from "@/lib/monitoring/types";

// Synthetic scopes deliberately differ from the API's production account map.
const master = googleDomainsSchema.parse({ version: 1, domains: [{ id: "alpha", name: "Dominio de prueba", accounts: [{ customerId: "1111111111", name: "Cuenta uno" }, { customerId: "2222222222", name: "Cuenta dos" }], absoluteTopMinimum: 0.66 }, { id: "beta", name: "Otro dominio", accounts: [{ customerId: "3333333333", name: "Cuenta tres" }], absoluteTopMinimum: 0.12 }], absoluteTop: { minImpressions: 41, warningGapPp: 4, suddenDropThresholdPp: 8, deepeningGapPp: 6, repeatAfterHours: 9, retentionDays: 80 } });
const clock = new Date("2026-09-30T18:00:00Z");
const catalog: Catalog = { accounts: ["1111111111", "2222222222", "3333333333"].map((id, index) => ({ id: `google:${id}`, platform: "google", name: `Cuenta ${index + 1}`, brand: "izzi", currency: "MXN" })), campaigns: ["1111111111", "2222222222", "3333333333"].map(id => ({ id: `google:${id}:campaign`, accountId: `google:${id}`, platform: "google", name: "Campaña homónima", status: "ACTIVE", objective: "TRAFFIC", conversionEvent: null })) };
const daily = (id: string, spend: number): DailyRow => ({ date: "2026-09-29", platform: "google", accountId: `google:${id}`, campaignId: `google:${id}:campaign`, metrics: { ...emptyMetrics(), spend, clicks: 1, impressions: 10 } });
const hourly = (id: string, spend: number, hour = 11): HourlyRow => ({ ...daily(id, spend), date: "2026-09-30", hour });
function fixture(rows: DailyRow[] = [daily("1111111111", 10), daily("2222222222", 20), daily("3333333333", 300)], hours: HourlyRow[] = [hourly("1111111111", 10), hourly("2222222222", 20), hourly("3333333333", 300)]): MonitoringDataSource {
  return { kind: "unified", now: () => clock, getCatalog: async () => catalog, getDaily: async () => rows, getHourly: async () => hours, getFreshness: async () => [{ platform: "google", accountId: null, lastDataAt: clock.toISOString(), lastSyncAt: clock.toISOString(), lastSyncStatus: "SUCCESS", lastError: null }, { platform: "google", accountId: "google:1111111111", lastDataAt: clock.toISOString(), lastSyncAt: clock.toISOString(), lastSyncStatus: "SUCCESS", lastError: null }], getBudgets: async () => [], getFxRates: async () => [], getDataQuality: async () => [{ platform: "google", date: "2026-09-30", duplicateRows: 99, nullSpendRows: 99, lastHourRows: 99, expectedLastHourRows: 99 }], getExecutionControl: async () => [{ id: "one", accountId: "google:1111111111", step: "Carga seleccionada", platform: "google", source: "api", status: "OK", lastRunAt: clock.toISOString(), rows: 1, message: null, expectedEveryMinutes: 60 }, { id: "foreign", accountId: "google:3333333333", step: "Carga ajena", platform: "google", source: "api", status: "ERROR", lastRunAt: clock.toISOString(), rows: 1, message: null, expectedEveryMinutes: 60 }], getSyncLog: async () => [] };
}
const source = (inner = fixture(), id = "alpha", config = master) => new DomainScopedSource(inner, selectDomain(id, "izzi", config), config, "izzi", "America/Mexico_City");
let directory: string | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe("API-owned domain master", () => {
  it.each(["1111111111", "111-111-1111", "google:1111111111", "google:111-111-1111"])("normalizes the explicit Google customer ID %s", id => expect(normalizeGoogleCustomerId(id)).toBe("1111111111"));
  it.each(["meta:1111111111", "111111111", "account 1111111111", "../1111111111", "1e11111111", "1111111111extra"])("rejects ambiguous ID %s", id => expect(normalizeGoogleCustomerId(id)).toBeNull());
  it("classifies only Google accounts from izzi; absence remains unknown", () => {
    expect(domainMetadata(master, "google", "111-111-1111", "Nombre leído", "izzi")).toMatchObject({ domain_id: "alpha", customer_id: "1111111111", account_name: "Nombre leído" });
    expect(domainMetadata(master, "google", "9999999999", "Otra", "izzi").domain_id).toBe("unclassified");
    expect(domainMetadata(null, "google", "1111111111", "Uno", "izzi").domain_id).toBeNull();
    expect(domainMetadata(master, "meta", "1111111111", "Meta", "izzi").domain_id).toBeNull();
    expect(domainMetadata(master, "google", "1111111111", "Sky", "sky").domain_id).toBeNull();
  });
  it("accepts future domains without adding a hardcoded enum and rejects duplicate accounts", () => {
    const future = googleDomainsSchema.parse({ ...master, domains: [...master.domains, { id: "future_fourth", name: "Cuarto", accounts: [{ customerId: "4444444444", name: "Cuatro" }], absoluteTopMinimum: 0.2 }] });
    expect(selectDomain("future_fourth", "izzi", future)).toMatchObject({ id: "future_fourth", available: true });
    expect(googleDomainsSchema.safeParse({ ...master, domains: [...master.domains, { ...master.domains[0], id: "duplicate" }] }).success).toBe(false);
    expect(googleDomainsSchema.safeParse({ ...master, token: "unexpected" }).success).toBe(false);
  });
  it("blocks a missing master without widening scope and resets Sky to all", () => {
    expect(selectDomain("alpha", "izzi", null)).toMatchObject({ id: "alpha", available: false });
    expect(selectDomain("unknown", "izzi", master).available).toBe(false);
    expect(selectDomain("alpha", "sky", master).id).toBe("all");
  });
  it("fetches the public contract with bounded body and safe request options", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ data: master, request_id: "fixture" }));
    expect(await fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", request })).toEqual(master);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    await expect(fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", request: async () => new Response("x".repeat(66000), { headers: { "Content-Type": "application/json" } }) })).rejects.toThrow("DOMAIN_CONFIGURATION_LIMIT");
    await expect(fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", request: async () => Response.json({ data: { ...master, secret: "fixture" } }) })).rejects.toThrow();
  });
  it("enforces an overall deadline even if a transport or response stream ignores abort", async () => {
    await expect(fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", timeoutMs: 5, request: () => new Promise(() => {}) })).rejects.toThrow("DOMAIN_CONFIGURATION_TIMEOUT");
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); }, cancel });
    await expect(fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", timeoutMs: 5, request: async () => new Response(stream, { headers: { "Content-Type": "application/json" } }) })).rejects.toThrow("DOMAIN_CONFIGURATION_TIMEOUT");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not accept an HTML error page as the master contract", async () => {
    await expect(fetchGoogleDomainConfig({ base: "https://fixture.test", apiKey: "fixture-key", request: async () => new Response("<html>fixture</html>", { headers: { "Content-Type": "text/html" } }) })).rejects.toThrow("DOMAIN_CONFIGURATION_UNAVAILABLE");
  });
});

describe("domain view aggregation and data quality", () => {
  it("filters before aggregating and retains both expected accounts of the selected domain", async () => {
    const view = source();
    expect((await view.getCatalog()).accounts.map(account => account.id)).toEqual(["google:1111111111", "google:2222222222"]);
    expect((await view.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0]).toMatchObject({ accountId: null, campaignId: null, domain_id: "alpha", metrics: { spend: 30 } });
    expect((await view.getHourly({ dates: ["2026-09-30"], level: "account" })).map(row => row.customer_id)).toEqual(["1111111111", "2222222222"]);
  });
  it("an expected member without rows preserves null instead of a present-account subtotal", async () => {
    const view = source(fixture([daily("1111111111", 0), daily("3333333333", 300)]));
    const rows = await view.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "account" });
    expect(rows.find(row => row.accountId === "google:1111111111")?.metrics.spend).toBe(0);
    expect(rows.find(row => row.accountId === "google:2222222222")).toMatchObject({ account_name: "Cuenta 2", customer_id: "2222222222", metrics: { spend: null } });
    expect((await view.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].metrics.spend).toBeNull();
  });
  it("recomputes scoped duplicate counts and the last completed business hour", async () => {
    const view = source(fixture([], [hourly("1111111111", 10), hourly("1111111111", 10), hourly("2222222222", 20, 10), hourly("3333333333", 300)]));
    expect((await view.getDataQuality("2026-09-30"))[0]).toMatchObject({ duplicateRows: 1, lastHourRows: 2, expectedLastHourRows: 2 });
  });
  it("does not borrow freshness or execution from a foreign or missing account", async () => {
    const view = source();
    expect((await view.getFreshness(clock)).find(row => row.accountId === "google:2222222222")).toMatchObject({ lastDataAt: null, lastSyncStatus: "UNKNOWN" });
    expect((await view.getExecutionControl(clock)).map(row => row.id)).toEqual(["one"]);
  });
  it("unavailable configuration yields no scope and no invented budget allocation", async () => {
    const view = new DomainScopedSource(fixture(), selectDomain("alpha", "izzi", null), null, "izzi");
    expect((await view.getCatalog()).accounts).toEqual([]);
    expect(await view.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" })).toEqual([]);
    const selected = await source().getCatalog();
    const budget = (level: "total" | "platform" | "account", accountId: string | null) => ({ month: "2026-09", level, platform: "google" as const, accountId, campaignId: null, amount: 100 });
    expect(scopedBudgets([budget("total", null), budget("platform", null), budget("account", "google:1111111111"), budget("account", "google:3333333333")], selected, true).map(row => row.accountId)).toEqual(["google:1111111111"]);
  });
  it("projects only attributed alerts without modifying persisted state or retaining a foreign parent", async () => {
    const state = emptyAlertState();
    state.alerts = [{ id: "one", accountId: "google:1111111111", accountName: "Uno", platform: "google", groupedUnder: "global" }, { id: "foreign", accountId: "google:3333333333", platform: "google" }, { id: "global", accountId: null, platform: "google" }] as unknown as AlertState["alerts"];
    const projected = projectDomainState(state, await source().getCatalog());
    expect(projected.alerts).toHaveLength(1);
    expect(projected.alerts[0]).toMatchObject({ id: "one", domain_id: "alpha", groupedUnder: null });
    expect(state.alerts[0].groupedUnder).toBe("global");
    expect(state.alerts).toHaveLength(3);
  });
  it("removes cross-domain incident references from the view while preserving stored grouping", async () => {
    const state = emptyAlertState();
    state.alerts = [{ id: "one", incidentId: "foreign-incident", accountId: "google:1111111111", platform: "google", groupedUnder: "global" }] as unknown as AlertState["alerts"];
    state.incidents = [{ id: "selected", accountId: "google:1111111111", platform: "google", childAlertIds: ["one", "foreign"] }, { id: "foreign-incident", accountId: "google:3333333333", platform: "google", childAlertIds: ["foreign"] }] as unknown as AlertState["incidents"];
    const projected = projectDomainState(state, await source().getCatalog());
    expect(projected.alerts[0].incidentId).toBeNull();
    expect(projected.incidents[0].childAlertIds).toEqual(["one"]);
    expect(state.incidents[0].childAlertIds).toEqual(["one", "foreign"]);
  });
  it("attributes generic observations before persistence without assigning a platform subtotal to one domain", () => {
    const observations = [{ platform: "google", accountId: "google:1111111111", accountName: "Cuenta leída" }, { platform: "google", accountId: null, accountName: null, domain_id: "stale" }, { platform: "meta", accountId: "1111111111", accountName: "Meta" }];
    const run = { entities: observations, anomalies: observations } as unknown as MonitoringRun;
    const tagged = annotateDomainRun(run, master, "izzi");
    expect(tagged.entities[0]).toMatchObject({ domain_id: "alpha", customer_id: "1111111111", account_name: "Cuenta leída" });
    expect(tagged.anomalies[0].domain_id).toBe("alpha");
    expect(tagged.entities[1]).toMatchObject({ domain_id: null, customer_id: null, account_name: null });
    expect(tagged.entities[2].domain_id).toBeNull();
    expect(run.entities[0].domain_id).toBeUndefined();
  });
});

describe("durable master and historical metadata", () => {
  it("validates the cached fingerprint and retains the old exact master after an update", async () => {
    directory = await mkdtemp(join(tmpdir(), "domain-master-"));
    const store = new UnifiedSnapshotStore(directory);
    const fingerprint = await store.saveDomainConfig(master, clock.toISOString());
    expect(await new UnifiedSnapshotStore(directory).domainConfig()).toEqual(master);
    const records = new FileRecordStore(directory);
    expect(await records.get(`.metadata/google-domains-history/${fingerprint}`)).toMatchObject({ config: master });
    await records.set(".metadata/google-domains", { config: master, fingerprint: "0".repeat(64), extractedAt: clock.toISOString() });
    await expect(store.domainConfig()).rejects.toMatchObject({ code: "INVALID_DOMAIN_CONFIGURATION" });
  });
  it("does not publish a changed master when its reproduction history cannot be written", async () => {
    directory = await mkdtemp(join(tmpdir(), "domain-history-"));
    const store = new UnifiedSnapshotStore(directory);
    await store.saveDomainConfig(master, clock.toISOString());
    const original = FileRecordStore.prototype.set;
    vi.spyOn(FileRecordStore.prototype, "set").mockImplementation(function (this: FileRecordStore, key, value) {
      if (key.startsWith(".metadata/google-domains-history/")) return Promise.reject(new Error("Fixture storage error"));
      return original.call(this, key, value);
    });
    await expect(store.saveDomainConfig({ ...master, absoluteTop: { ...master.absoluteTop, warningGapPp: 3 } }, clock.toISOString())).rejects.toThrow("Fixture storage error");
    expect(await store.domainConfig()).toEqual(master);
  });
  it("syncs the master once, stores domain metadata, and preserves it offline without printing credentials", async () => {
    directory = await mkdtemp(join(tmpdir(), "domain-sync-"));
    const store = new UnifiedSnapshotStore(directory);
    await new FileRecordStore(directory).set(".metadata/google-domains", { config: master, fingerprint: "0".repeat(64), extractedAt: clock.toISOString() });
    const scope = { platform: "google" as const, accountId: "1111111111", brand: "izzi" as const, currency: "MXN" as const };
    const request = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname;
      const data = path.endsWith("google-domains") ? master : path.endsWith("accounts") ? [{ platform: "google", account_id: scope.accountId, account_name: "Nombre vivo", currency: "MXN", timezone: "America/Mexico_City" }] : path.endsWith("campaigns") ? [{ platform: "google", account_id: scope.accountId, campaign_id: "campaign", campaign_name: "Search", campaign_status: "active", source_status: null, objective: "SEARCH" }] : [{ platform: "google", account_id: scope.accountId, campaign_id: "campaign", date: "2026-09-29", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", spend: 10, impressions: 100, clicks: 4, extracted_at: clock.toISOString(), raw_metrics: {} }];
      return Response.json({ data, request_id: "fixture", errors: [] });
    });
    const options = { mapping: { version: 1 as const, accounts: [scope] }, store, url: "https://fixture.test", apiKey: "fixture-key", from: "2026-09-29", to: "2026-09-29", granularities: ["daily" as const], clock: () => clock, request };
    expect((await syncUnified(options))[0].status).toBe("SUCCESS");
    expect(request.mock.calls.filter(([input]) => String(input).includes("google-domains"))).toHaveLength(1);
    expect((await store.partition(scope, "2026-09-29", "daily"))?.rows[0]).toMatchObject({ domain_id: "alpha", customer_id: scope.accountId, account_name: "Nombre vivo", domain_config_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const offline = new UnifiedDataSource({ store, accounts: [scope], timezone: "America/Mexico_City", clock: () => clock });
    expect((await offline.getCatalog()).accounts[0]).toMatchObject({ domain_id: "alpha", name: "Nombre vivo" });
    expect((await offline.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "platform" }))[0].domain_id).toBeNull();
    await expect(offline.getCatalog()).resolves.toMatchObject({ campaigns: [{ domain_id: "alpha" }] });
    const changed = googleDomainsSchema.parse({ ...master, domains: [{ ...master.domains[0], accounts: [master.domains[0].accounts[1]] }, { ...master.domains[1], accounts: [...master.domains[1].accounts, master.domains[0].accounts[0]] }] });
    await store.saveDomainConfig(changed, clock.toISOString());
    const reclassified = new UnifiedDataSource({ store, accounts: [scope], timezone: "America/Mexico_City", clock: () => clock });
    expect((await reclassified.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "account" }))[0].domain_id).toBe("beta");
    expect((await store.partition(scope, "2026-09-29", "daily"))?.rows[0]).toMatchObject({ domain_id: "alpha", domain_config_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await new FileRecordStore(directory).set(".metadata/google-domains", { config: changed, fingerprint: "0".repeat(64), extractedAt: clock.toISOString() });
    const unavailable = new UnifiedDataSource({ store, accounts: [scope], timezone: "America/Mexico_City", clock: () => clock });
    expect((await unavailable.getCatalog()).accounts[0].domain_id).toBeNull();
    expect((await unavailable.getDaily({ from: "2026-09-29", to: "2026-09-29", level: "account" }))[0]).toMatchObject({ domain_id: null, metrics: { spend: 10 } });
  });
});
