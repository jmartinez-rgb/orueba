import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { FileRecordStore, type RecordStore } from "@/lib/records/store";
import { ABSOLUTE_TOP_HISTORY_MAX_BYTES, AbsoluteTopStore } from "@/lib/absolute-top/store";
import { syncAbsoluteTop } from "@/lib/absolute-top/ingest";
import type { AbsoluteTopAudit, AbsoluteTopRow } from "@/lib/absolute-top/types";

// The customer document is rewritten whole on each ingestion: an unbounded history (for example
// hourly reads several times a day for 90 days) would exhaust memory instead of failing cleanly.
const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const customer = config.domains[0].accounts[0].customerId;
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function dir() { const d = await mkdtemp(join(tmpdir(), "at-capacity-")); dirs.push(d); return d; }
const row = (i: number, date: string, at: string): AbsoluteTopRow => ({ level: "campaign", domain_id: null, domain_name: null, customer_id: customer, account_id: customer, account_name: "Cuenta ficticia", campaign_id: `c${i}`, campaign_name: "Search ficticia", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date, hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: at, absolute_top_rate: .8, top_of_page_rate: null, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null, impressions: 1000, clicks: 10, ctr: 1, cpc: 1, spend: 10, conversions: 0, bidding_strategy: null, daily_budget: null, share_bounds: {}, warnings: [] });
const audit = (id: string, date: string, at: string, rows = 20, patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit => ({ version: 1, auditId: id, customerId: customer, observedAt: at, from: date, to: date, granularity: "daily", coverage: "complete", rows: Array.from({ length: rows }, (_, i) => row(i, date, at)), warnings: [], ...patch });

describe("capacidad del historial de Absolute Top", () => {
  it("el presupuesto por omisión admite 90 días de lectura diaria y está documentado", () => {
    expect(ABSOLUTE_TOP_HISTORY_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
  it("una auditoría con filas que excede el presupuesto falla explícitamente y deja intacto el documento", async () => {
    const d = await dir();
    const store = new AbsoluteTopStore(new FileRecordStore(d), 40_000);
    await store.ingest(audit("a1", "2026-09-29", "2026-09-30T08:00:00Z"), config, new Date("2026-09-30T12:00:00Z"));
    const file = join(d, "absolute-top", "izzi", `${customer}.json`);
    const before = await readFile(file, "utf8");
    await expect(store.ingest(audit("a2", "2026-09-30", "2026-10-01T08:00:00Z", 60), config, new Date("2026-10-01T12:00:00Z"))).rejects.toThrow(/HISTORY_BYTES_CAPACITY/);
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await store.history(customer)).map(a => a.auditId)).toEqual(["a1"]);
  });
  it("una marca vacía de extracción fallida siempre se guarda para no dejar vigente una lectura sana anterior", async () => {
    const first = audit("a1", "2026-09-29", "2026-09-30T08:00:00Z");
    // Budget just above the first audit: the ~300-byte marker pushes it over and is still accepted.
    const store = new AbsoluteTopStore(new FileRecordStore(await dir()), JSON.stringify(first).length + 10);
    await store.ingest(first, config, new Date("2026-09-30T12:00:00Z"));
    await store.ingest(audit("a2", "2026-09-30", "2026-10-01T08:00:00Z", 0, { coverage: "unavailable", warnings: ["API_TRANSPORT_ERROR"] }), config, new Date("2026-10-01T12:00:00Z"));
    expect((await store.latestAudit(customer))?.auditId).toBe("a2");
    expect((await store.latest(customer)).every(r => r.state === "insufficient")).toBe(true);
  });
  it("si una cuenta no puede guardar nada, la extracción la reporta y continúa con las demás", async () => {
    const failing: RecordStore = new FileRecordStore(await dir());
    const broken = Object.assign(Object.create(Object.getPrototypeOf(failing)), failing, { update: async () => { throw new Error("disco lleno"); } }) as RecordStore;
    const store = new AbsoluteTopStore(broken);
    const accounts = config.domains.flatMap(domain => domain.accounts.map(a => a.customerId));
    const now = new Date("2026-10-02T12:00:00Z");
    const request: typeof fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("google-domains")) return Response.json({ data: config });
      const id = url.searchParams.get("account_id")!;
      return Response.json({ data: [{ ...row(1, "2026-10-01", now.toISOString()), customer_id: id, account_id: id }], errors: [] });
    };
    const results = await syncAbsoluteTop({ url: "http://127.0.0.1:8888", apiKey: "clave-ficticia", from: "2026-10-01", to: "2026-10-01", granularity: "daily", store, request, clock: () => now });
    expect(results.map(r => r.customerId)).toEqual(accounts);
    expect(results.every(r => r.status === "FAILED" && r.code === "EXTRACTION_FAILED" && r.markerCode === "STORE_FAILED")).toBe(true);
  });
});
