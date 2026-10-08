import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { closePostgresPools, PostgresRecordStore } from "@/lib/records/postgres";
import { FileRecordStore, getRecordStore, resetRecordStore } from "@/lib/records/store";
import { openUnifiedStore } from "@/lib/unified/store";
import { syncUnified } from "@/lib/unified/sync";
import { refreshUnified } from "@/lib/unified/refresh";
import { UnifiedDataSource } from "@/lib/unified/source";
import type { UnifiedScope } from "@/lib/unified/schema";
import { googleDomainsSchema } from "@/lib/domains/config";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import type { AbsoluteTopAudit } from "@/lib/absolute-top/types";

/**
 * Integration suite against a real PostgreSQL. It needs TEST_DATABASE_URL (a disposable database: every
 * table it uses is emptied); without it the suite is reported as skipped, never as passed.
 */
const url = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!url)("PostgreSQL storage for hosts without a persistent disk", () => {
  let admin: Pool;
  const previous = { DATABASE_URL: process.env.DATABASE_URL, RECORDS_BACKEND: process.env.RECORDS_BACKEND };
  beforeAll(() => { process.env.DATABASE_URL = url; admin = new Pool({ connectionString: url }); });
  beforeEach(async () => {
    await new PostgresRecordStore("records").list("");
    await admin.query("TRUNCATE immc_kv, immc_locks");
  });
  afterAll(async () => {
    await admin.end();
    await closePostgresPools();
    process.env.DATABASE_URL = previous.DATABASE_URL;
    process.env.RECORDS_BACKEND = previous.RECORDS_BACKEND;
    resetRecordStore();
  });

  it("round-trips the exact JSON text, lists by literal prefix and deletes", async () => {
    const store = new PostgresRecordStore("records");
    // Key order and numbers must survive: Absolute Top compares stored audits as text.
    await store.set("a/1", { z: 1, a: 1.10, n: null });
    await store.set("a/2", [1, 2]);
    await store.set("a_%/3", "literal");
    await store.set("b/1", true);
    expect(JSON.stringify(await store.get("a/1"))).toBe('{"z":1,"a":1.1,"n":null}');
    expect(await store.list("a/")).toEqual(["a/1", "a/2"]);
    expect(await store.list("a_%")).toEqual(["a_%/3"]);
    await store.delete("a/1");
    expect(await store.get("a/1")).toBeNull();
    // Namespaces never see each other's keys.
    expect(await new PostgresRecordStore("unified").list("")).toEqual([]);
  });

  it("serializes concurrent updates of one key, including an absent key", async () => {
    const stores = Array.from({ length: 4 }, () => new PostgresRecordStore("records"));
    await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % 4].update<number>("counter", current => (current ?? 0) + 1)));
    expect(await stores[0].get("counter")).toBe(24);
  });

  it("propagates a transform error unchanged and keeps the stored value", async () => {
    const store = new PostgresRecordStore("records");
    await store.set("doc", { version: 1 });
    class Domain extends Error {}
    await expect(store.update("doc", () => { throw new Domain("conflict"); })).rejects.toBeInstanceOf(Domain);
    expect(await store.get("doc")).toEqual({ version: 1 });
    expect(await store.update<{ version: number }>("doc", current => ({ version: current!.version + 1 }))).toEqual({ version: 2 });
  });

  it("re-ingesting the same Absolute Top audit is idempotent (no false AUDIT_ID_CONFLICT)", async () => {
    const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
    const customer = config.domains[0].accounts[0].customerId, at = "2026-10-02T08:00:00Z";
    const audit: AbsoluteTopAudit = { version: 1, auditId: "audit-1", customerId: customer, observedAt: at, from: "2026-10-01", to: "2026-10-01", granularity: "daily", coverage: "complete", warnings: [], rows: [{ level: "campaign", domain_id: null, domain_name: null, customer_id: customer, account_id: customer, account_name: "Cuenta ficticia", campaign_id: "c1", campaign_name: "Search fixture", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: at, absolute_top_rate: .5, top_of_page_rate: .8, search_impression_share: .0999, search_lost_is_rank: null, search_lost_is_budget: null, impressions: 1000, clicks: 100, ctr: 10, cpc: 2, spend: 200, conversions: 2, bidding_strategy: null, daily_budget: 400, share_bounds: { search_impression_share: "lt_10_percent" }, warnings: [] }] };
    const store = new AbsoluteTopStore(new PostgresRecordStore("records"));
    const now = new Date("2026-10-02T12:00:00Z");
    const first = await store.ingest(audit, config, now);
    expect(await store.ingest(audit, config, now)).toEqual(first);
    expect(await store.history(customer)).toHaveLength(1);
  });

  it("migrates local records and history once, verified, without copying scheduler state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-postgres-"));
    try {
      const records = new FileRecordStore(join(dir, "records")), unified = new FileRecordStore(join(dir, "unified"));
      await records.set("users/juan", { role: "admin", z: 1, a: 2 });
      await records.set("absolute-top/izzi/1234567890", { version: 1 });
      await unified.set("izzi/meta/1/catalog", { campaigns: [] });
      await unified.set(".metadata/google-domains", { fingerprint: "x" });
      await unified.set(".scheduler/meta/1/izzi/MXN", { nextDueAt: "2026-10-07T00:00:00Z" });
      const run = (extra: string[] = []) => promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/data-migrate-postgres.ts", "--registros", join(dir, "records"), "--unified", join(dir, "unified"), ...extra], { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: url } });
      const { stdout } = await run();
      expect(JSON.parse(stdout)).toEqual({ module: "data_migration", destination: "postgres", results: [{ label: "registros", keys: 2, verified: 2 }, { label: "unified", keys: 2, verified: 2 }] });
      expect(stdout).not.toContain("juan");
      expect(JSON.stringify(await new PostgresRecordStore("records").get("users/juan"))).toBe('{"role":"admin","z":1,"a":2}');
      expect(await new PostgresRecordStore("unified").list("")).toEqual([".metadata/google-domains", "izzi/meta/1/catalog"]);
      // A second run never overwrites data already in the database.
      const again = await run().catch((error: { stderr: string }) => error);
      expect(JSON.parse((again as { stderr: string }).stderr)).toEqual({ module: "data_migration", code: "DESTINATION_NOT_EMPTY_REGISTROS" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("selects PostgreSQL with RECORDS_BACKEND=postgres", () => {
    process.env.RECORDS_BACKEND = "postgres";
    resetRecordStore();
    expect(getRecordStore().backend).toBe("postgres");
  });

  it("leases are exclusive, released explicitly and taken over once expired", async () => {
    const store = new PostgresRecordStore("unified");
    const release = await store.lease("sync-lock");
    expect(release).not.toBeNull();
    expect(await store.lease("sync-lock")).toBeNull();
    await release!();
    const again = await store.lease("sync-lock");
    expect(again).not.toBeNull();
    await again!();
    // A holder that died leaves an expired row: it must not block the next extractor.
    await admin.query("INSERT INTO immc_locks (name, holder, expires_at) VALUES ('unified:sync-lock', 'dead', now() - interval '1 minute')");
    const takeover = await store.lease("sync-lock");
    expect(takeover).not.toBeNull();
    await takeover!();
  });

  it("a held lease is renewed past its TTL and, once released, is never recreated by a late renewal", async () => {
    const store = new PostgresRecordStore("unified");
    const release = await store.lease("renewal-lock", 1500);
    await new Promise(done => setTimeout(done, 2600));
    expect(await store.lease("renewal-lock", 1500)).toBeNull();
    await release!();
    await new Promise(done => setTimeout(done, 700));
    expect((await admin.query("SELECT count(*)::int AS n FROM immc_locks WHERE name = 'unified:renewal-lock'")).rows[0].n).toBe(0);
    const next = await store.lease("renewal-lock", 1500);
    expect(next).not.toBeNull();
    await next!();
  });

  it("keeps the direct-API history, its sync lock and the refresh scheduler in PostgreSQL", async () => {
    const snapshots = openUnifiedStore({ directory: undefined, store: "postgres" })!;
    expect(snapshots.root).toBeNull();
    const scope: UnifiedScope = { platform: "tiktok", accountId: "acct1", brand: "izzi", currency: "MXN" };
    const now = new Date("2026-09-30T18:00:00Z");
    const request: typeof fetch = async input => {
      const route = new URL(String(input)).pathname.split("/").pop();
      const data = route === "accounts" ? [{ platform: "tiktok", account_id: "acct1", account_name: "izzi", currency: "MXN", timezone: "America/Mexico_City" }]
        : route === "campaigns" ? [{ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", campaign_name: "c", campaign_status: "unknown", source_status: null, objective: null }]
        : [{ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", date: "2026-09-29", hour: new URL(String(input)).searchParams.get("granularity") === "hourly" ? 10 : null, currency: "MXN", source_timezone: "America/Mexico_City", spend: 40, impressions: 80, clicks: 4, conversions: null, cpa: null, extracted_at: now.toISOString(), raw_metrics: {} }];
      return Response.json({ data, errors: [] });
    };
    const options = { mapping: { version: 1 as const, accounts: [scope] }, store: snapshots, url: "https://api.example.test", apiKey: "private-internal-key", request, clock: () => now };
    const result = await syncUnified({ ...options, from: "2026-09-29", to: "2026-09-29", granularities: ["daily"] });
    expect(result[0]).toMatchObject({ status: "SUCCESS", rows: 1 });
    expect((await snapshots.partition(scope, "2026-09-29", "daily"))?.rows[0].spend).toBe(40);
    expect((await snapshots.catalog(scope))?.campaigns).toHaveLength(1);
    // The refresher completes missing history from this listing: only stored days of that scope and granularity.
    expect([...await snapshots.partitionDates(scope, "daily")]).toEqual(["2026-09-29"]);
    expect([...await snapshots.partitionDates(scope, "hourly")]).toEqual([]);
    expect([...await snapshots.partitionDates({ ...scope, accountId: "acct2" }, "daily")]).toEqual([]);
    // The monitor reads a month of days per account in one query, not one round trip per day.
    expect([...(await snapshots.partitions(scope, ["2026-09-28", "2026-09-29"], "daily")).keys()]).toEqual(["2026-09-29"]);
    const perKey = vi.spyOn(PostgresRecordStore.prototype, "get"), batched = vi.spyOn(PostgresRecordStore.prototype, "getMany");
    const source = new UnifiedDataSource({ store: snapshots, accounts: [scope], timezone: "America/Mexico_City", clock: () => now });
    const daily = await source.getDaily({ from: "2026-08-31", to: "2026-09-29", level: "campaign" });
    expect(daily.map(row => row.metrics.spend)).toEqual([40]);
    expect(batched).toHaveBeenCalledTimes(1);
    expect(perKey.mock.calls.filter(([key]) => String(key).includes("/daily/"))).toEqual([]);
    perKey.mockRestore(); batched.mockRestore();
    // A second extractor cannot run while the first holds the lock.
    const release = await snapshots.lock();
    await expect(snapshots.lock()).rejects.toMatchObject({ code: "SYNC_LOCKED" });
    await release();
    // The scheduler cooldown persists in the database, so a restart cannot repeat a round at once.
    const first = await refreshUnified({ ...options, intervalMs: 120 * 60_000 });
    expect(first[0].status).toBe("SUCCESS");
    const second = await refreshUnified({ ...options, intervalMs: 120 * 60_000 });
    expect(second[0].status).toBe("WAITING");
    const unlockedAgain = await snapshots.schedulerLock();
    await unlockedAgain();
  });
});
