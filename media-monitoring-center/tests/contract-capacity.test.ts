import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { FileRecordStore } from "@/lib/records/store";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import { syncAbsoluteTop } from "@/lib/absolute-top/ingest";
import type { AbsoluteTopAudit, AbsoluteTopRow } from "@/lib/absolute-top/types";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { syncUnified } from "@/lib/unified/sync";
import type { UnifiedScope } from "@/lib/unified/schema";

// Contrato de capacidad del consumidor: 25 MiB por respuesta y filas acotadas. Un exceso es un fallo
// explícito; nunca se guarda una muestra truncada ni se conserva como vigente una lectura anterior sana.
const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const customer = config.domains[0].accounts[0].customerId;
const now = new Date("2026-10-02T12:00:00Z");
const directories: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), "contract-capacity-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

/** JSON response whose body exceeds 25 MiB; counts how much the consumer actually pulled. */
function oversized() {
  const state = { chunks: 0 };
  const padding = new Uint8Array(1024 * 1024).fill(32);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.chunks === 0) controller.enqueue(new TextEncoder().encode("{\"data\":[], \"errors\":[]"));
      if (state.chunks++ < 40) controller.enqueue(padding); else { controller.enqueue(new TextEncoder().encode("}")); controller.close(); }
    },
  });
  return { state, response: new Response(stream, { headers: { "Content-Type": "application/json" } }) };
}

function row(rate: number, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return { level: "campaign", domain_id: null, domain_name: null, customer_id: customer, account_id: customer, account_name: "Cuenta ficticia", campaign_id: "c1", campaign_name: "Search ficticia", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: "2026-10-02T08:00:00Z", absolute_top_rate: rate, top_of_page_rate: null, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null, impressions: 1000, clicks: 10, ctr: 1, cpc: 1, spend: 10, conversions: 0, bidding_strategy: null, daily_budget: null, share_bounds: {}, warnings: [], ...patch };
}

describe("contrato de capacidad — Absolute Top (25 MiB por cuenta)", () => {
  it("una respuesta mayor a 25 MiB falla con RESPONSE_LIMIT, sin truncar ni dejar vigente la lectura sana anterior", async () => {
    const store = new AbsoluteTopStore(new FileRecordStore(await directory()));
    const green: AbsoluteTopAudit = { version: 1, auditId: "green", customerId: customer, observedAt: "2026-10-02T08:00:00Z", from: "2026-10-01", to: "2026-10-01", granularity: "daily", coverage: "complete", rows: [row(.9)], warnings: [] };
    await store.ingest(green, config, now);
    const request: typeof fetch = async input => new URL(String(input)).pathname.endsWith("google-domains") ? Response.json({ data: config }) : oversized().response;
    const results = await syncAbsoluteTop({ url: "http://127.0.0.1:8888", apiKey: "clave-ficticia", from: "2026-10-01", to: "2026-10-01", granularity: "daily", store, request, clock: () => now });
    expect(results.every(result => result.status === "FAILED" && result.code === "RESPONSE_LIMIT" && result.rows === 0)).toBe(true);
    const latest = await store.latest(customer);
    expect(latest[0]).toMatchObject({ state: "insufficient", coverage: "unavailable", absolute_top_rate: null });
    expect((await store.latestAudit(customer))?.rows).toEqual([]);
  });
});

describe("contrato de capacidad — fuente unified (25 MiB y filas por respuesta)", () => {
  const scope: UnifiedScope = { platform: "tiktok", accountId: "acct1", brand: "izzi", currency: "MXN" };
  const perf = (patch = {}) => ({ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", date: "2026-09-29", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", spend: 40, impressions: 80, clicks: 4, extracted_at: now.toISOString(), raw_metrics: {}, ...patch });
  const transport = (performance: () => Response): typeof fetch => async input => {
    const route = new URL(String(input)).pathname.split("/").pop();
    if (route === "accounts") return Response.json({ data: [{ platform: "tiktok", account_id: "acct1", account_name: "Cuenta ficticia", currency: "MXN", timezone: "America/Mexico_City" }], errors: [] });
    if (route === "campaigns") return Response.json({ data: [{ platform: "tiktok", account_id: "acct1", campaign_id: "camp1", campaign_name: "Campaña ficticia", campaign_status: "active", source_status: null, objective: null }], errors: [] });
    return performance();
  };
  const options = (store: UnifiedSnapshotStore, request: typeof fetch, extra = {}) => ({ mapping: { version: 1 as const, accounts: [scope] }, store, url: "https://api.example.test", apiKey: "clave-ficticia", from: "2026-09-29", to: "2026-09-29", granularities: ["daily" as const], request, clock: () => now, ...extra });

  it("una respuesta mayor a 25 MiB falla con RESPONSE_LIMIT y conserva intacta la partición anterior", async () => {
    const store = new UnifiedSnapshotStore(await directory());
    expect((await syncUnified(options(store, transport(() => Response.json({ data: [perf()], errors: [] })))))[0].status).toBe("SUCCESS");
    const before = await store.partition(scope, "2026-09-29", "daily");
    let pulled = 0;
    const result = await syncUnified(options(store, transport(() => { const big = oversized(); setTimeout(() => { pulled = big.state.chunks; }, 0); return big.response; })));
    expect(result[0]).toMatchObject({ status: "FAILED", code: "RESPONSE_LIMIT", rows: 0 });
    expect(await store.partition(scope, "2026-09-29", "daily")).toEqual(before);
    expect(pulled).toBeLessThanOrEqual(41);
  });

  it("más filas que el máximo admitido es un fallo explícito, nunca una muestra parcial", async () => {
    const store = new UnifiedSnapshotStore(await directory());
    const rows = [perf(), perf({ campaign_id: "camp1", date: "2026-09-29", spend: 1 })];
    const result = await syncUnified(options(store, transport(() => Response.json({ data: rows, errors: [] })), { maxRows: 1 }));
    expect(result[0]).toMatchObject({ status: "FAILED", rows: 0 });
    expect(await store.partition(scope, "2026-09-29", "daily")).toBeNull();
  });
});
