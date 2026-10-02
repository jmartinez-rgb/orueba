import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getViewContext, type AppContext } from "@/lib/services/context";
import { buildSnapshot } from "@/lib/services/snapshot";
import * as incidents from "@/lib/alerts/incident-manager";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { resetEnvCache } from "@/lib/config/env";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { invalidate } from "@/lib/data/cache";
import type { MonitoringDataSource } from "@/lib/data/source";
import { emptyAlertState } from "@/lib/alerts/types";
import { MemoryStateStore } from "@/lib/state/store";
import { BRANDS } from "@/lib/brands";
import { planFor } from "@/lib/novedades/plan";
import { googleDomainsSchema } from "@/lib/domains/config";
import { nexusSnapshot } from "./nexus-fixtures";
import { getBudgetControl } from "@/lib/services/budget";
import { emptyMetrics } from "@/lib/metrics";

const mocks = vi.hoisted(() => ({ domain: "all", combine: vi.fn(), dashboard: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "immc_domain" ? { value: mocks.domain } : undefined }) }));
vi.mock("@/lib/absolute-top/service", () => ({ getAbsoluteTopDashboard: mocks.dashboard, combineAbsoluteTopRun: mocks.combine }));

const master = googleDomainsSchema.parse({ version: 1, domains: [{ id: "one", name: "Uno", accounts: [{ customerId: "1111111111", name: "Primera" }], absoluteTopMinimum: 0.66 }, { id: "two", name: "Dos", accounts: [{ customerId: "2222222222", name: "Segunda" }], absoluteTopMinimum: 0.11 }], absoluteTop: { minImpressions: 41, warningGapPp: 4, suddenDropThresholdPp: 8, deepeningGapPp: 6, repeatAfterHours: 9, retentionDays: 80 } });
const clock = new Date("2026-10-02T18:00:00Z");
function context(): AppContext {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const raw: MonitoringDataSource = { kind: "unified", now: () => clock,
    getCatalog: async () => ({ accounts: master.domains.map(domain => ({ id: `google:${domain.accounts[0].customerId}`, name: domain.accounts[0].name, platform: "google", currency: "MXN", brand: "izzi" })), campaigns: [] }),
    getDaily: async () => [], getHourly: async () => [], getFreshness: async () => [], getBudgets: async () => [], getFxRates: async () => [], getDataQuality: async () => [], getExecutionControl: async () => [], getSyncLog: async () => [],
  };
  return { mode: "unified", settings: { ...settings, monitoredPlatforms: ["google"] }, settingsHash: "fixture-full", settingsRevision: "fixture", source: new CurrencyConvertedSource(raw, { rates: {}, accountCurrency: {} }), raw, store: new MemoryStateStore("domain-read-only-fixture"), scenario: null, mapping: null, mappingErrors: [], sheetsMapping: null, sheetsErrors: [], session: { authenticated: true, role: "manager", user: { id: "fixture", name: "Fixture", email: null, kind: "open" }, permissions: ["internal:view"], brands: ["izzi"], mode: "open", sid: null, expiresAt: null }, brand: "izzi", brandInfo: BRANDS.izzi, brands: ["izzi"], brandPlatforms: ["google"], month: "2026-10", kickoff: null, plan: planFor([], null, "2026-10-02", settings.timezone), domainConfig: master, domain: { id: "all", name: "Todos los dominios", available: true, configVersion: 1 }, scopeKey: "izzi:all:fixture" };
}
beforeEach(() => {
  vi.clearAllMocks(); invalidate();
  vi.stubEnv("DATA_SOURCE", "mock"); vi.stubEnv("RECORDS_BACKEND", "memory"); vi.stubEnv("LOG_LEVEL", "error"); resetEnvCache();
  mocks.domain = "one";
  mocks.combine.mockImplementation(run => run);
  mocks.dashboard.mockImplementation(async options => ({ brand: options.brand, selectedDomain: options.domainId, configured: true, available: false, domains: [], rows: [], summaries: [], warnings: [], policy: null, lastAuditAt: null, approximationNotice: "Fixture" }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvCache(); invalidate(); });

describe("domain preference never becomes an evaluation or access scope", () => {
  it("keeps the full context and permissions intact while building independent views", async () => {
    const full = context();
    const first = await getViewContext(full);
    mocks.domain = "two";
    const second = await getViewContext(full);
    expect((await full.source.getCatalog()).accounts).toHaveLength(2);
    expect((await first.source.getCatalog()).accounts.map(account => account.id)).toEqual(["google:1111111111"]);
    expect((await second.source.getCatalog()).accounts.map(account => account.id)).toEqual(["google:2222222222"]);
    expect(first.settingsHash).not.toBe(second.settingsHash);
    expect(first.scopeKey).not.toBe(second.scopeKey);
    expect(first.session).toBe(full.session);
    expect(first.store).toBe(full.store);
    expect(full.domain?.id).toBe("all");
  });

  it("does not widen an unavailable domain and resets a Sky view to all", async () => {
    const full = context();
    full.domainConfig = null;
    const missing = await getViewContext(full);
    expect(missing.domain).toMatchObject({ id: "one", available: false });
    expect((await missing.source.getCatalog()).accounts).toEqual([]);
    full.brand = "sky"; full.brandInfo = BRANDS.sky;
    const sky = await getViewContext(full);
    expect(sky.domain?.id).toBe("all");
    expect(sky.source).toBe(full.source);
  });

  it("recomputes a projection without reading persisted alert history, reconciling or writing", async () => {
    const full = context();
    const view = await getViewContext(full);
    const reconcile = vi.spyOn(incidents, "reconcile");
    const reads = [vi.spyOn(full.store, "loadAlertState"), vi.spyOn(full.store, "listRuns")];
    const writes = [vi.spyOn(full.store, "saveAlertState"), vi.spyOn(full.store, "saveRun"), vi.spyOn(full.store, "saveNotifications")];
    const base = nexusSnapshot(); base.state = emptyAlertState(); base.runs = [{ id: "full-brand-total" }] as typeof base.runs; base.run.anomalies = [];
    const snapshot = await buildSnapshot(view, { viewOf: base });
    expect(snapshot.meta.domain?.id).toBe("one");
    expect(snapshot.catalog.accounts.map(account => account.id)).toEqual(["google:1111111111"]);
    expect(snapshot.runs).toEqual([]);
    expect(mocks.combine).not.toHaveBeenCalled();
    expect(mocks.dashboard.mock.calls[0][0].allowedCustomerIds).toEqual(["1111111111"]);
    expect(reconcile).not.toHaveBeenCalled();
    for (const spy of [...reads, ...writes]) expect(spy).not.toHaveBeenCalled();
  });

  it("does not combine cached monthly costs from the previous FX configuration with today's new rate", async () => {
    const full = context();
    const accounts = (await full.raw.getCatalog()).accounts.map(account => ({ ...account, currency: "USD" as const }));
    const campaigns = accounts.map(account => ({ id: `${account.id}:campaign`, accountId: account.id, name: "Campaña", platform: "google" as const, status: "ACTIVE" as const, objective: "TRAFFIC" as const, conversionEvent: null }));
    full.raw.getCatalog = async () => ({ accounts, campaigns });
    full.raw.getDaily = async () => campaigns.map(campaign => ({ date: "2026-10-01", platform: "google", accountId: campaign.accountId, campaignId: campaign.id, metrics: { ...emptyMetrics(), spend: 10 } }));
    full.raw.getHourly = async () => campaigns.flatMap(campaign => Array.from({ length: 12 }, (_, hour) => ({ date: "2026-10-02", hour, platform: "google", accountId: campaign.accountId, campaignId: campaign.id, metrics: { ...emptyMetrics(), spend: 0 } })));
    const snap = nexusSnapshot(); snap.catalog = { accounts, campaigns }; snap.run.businessDate = "2026-10-02"; snap.run.cutoffHour = 12; snap.meta.cutoffHour = 12;
    snap.run.entities = []; snap.run.pacing = { google: { curveShare: 1 }, total: { curveShare: 1 } } as typeof snap.run.pacing;
    full.settingsHash = "rate-17";
    full.settings.currency = { rates: { "2026-10": 17 }, accountCurrency: {} };
    full.source = new CurrencyConvertedSource(full.raw, full.settings.currency);
    snap.currency = await full.source.currencyReport(["2026-10"]);
    expect((await getBudgetControl(full, snap)).lines.find(line => line.level === "total")?.spend).toBe(340);
    full.settingsHash = "rate-20";
    full.settings.currency = { rates: { "2026-10": 20 }, accountCurrency: {} };
    full.source = new CurrencyConvertedSource(full.raw, full.settings.currency);
    snap.currency = await full.source.currencyReport(["2026-10"]);
    expect((await getBudgetControl(full, snap)).lines.find(line => line.level === "total")?.spend).toBe(400);
  });

  it("does not mislabel the whole brand as empty when a selected domain is unavailable", async () => {
    const full = context(); full.domainConfig = null;
    const view = await getViewContext(full);
    const base = nexusSnapshot(); base.state = emptyAlertState(); base.runs = []; base.run.anomalies = []; base.meta.brandHasData = true;
    const snap = await buildSnapshot(view, { viewOf: base });
    expect(snap.catalog.accounts).toEqual([]);
    expect(snap.meta.domain?.available).toBe(false);
    expect(snap.meta.brandHasData).toBe(true);
  });
});
