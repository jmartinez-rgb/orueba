import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { FileRecordStore } from "@/lib/records/store";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import { STALE_PERIOD_WARNING } from "@/lib/absolute-top/engine";
import type { AbsoluteTopAudit, AbsoluteTopRow } from "@/lib/absolute-top/types";

const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const customer = config.domains[0].accounts[0].customerId;
const directories: string[] = [];
async function store() { const dir = await mkdtemp(join(tmpdir(), "integrity-at-")); directories.push(dir); return new AbsoluteTopStore(new FileRecordStore(dir)); }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function row(date: string, extractedAt: string, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return { level: "campaign", domain_id: null, domain_name: null, customer_id: customer, account_id: customer, account_name: "Cuenta ficticia", campaign_id: "c1", campaign_name: "Search ficticia", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date, hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: extractedAt, absolute_top_rate: .9, top_of_page_rate: null, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null, impressions: 5000, clicks: 10, ctr: .2, cpc: 1, spend: 10, conversions: 0, bidding_strategy: null, daily_budget: null, share_bounds: {}, warnings: [], ...patch };
}
function audit(auditId: string, date: string, observedAt: string, patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit {
  return { version: 1, auditId, customerId: customer, observedAt, from: date, to: date, granularity: "daily", coverage: "complete", rows: [row(date, observedAt)], warnings: [], ...patch };
}

describe("Absolute Top: un backfill no reemplaza la lectura vigente", () => {
  it("una auditoría de una ventana anterior al checkpoint entra al historial sin avanzar latest", async () => {
    const s = await store();
    await s.ingest(audit("a-current", "2026-10-01", "2026-10-02T08:00:00Z"), config, new Date("2026-10-02T12:00:00Z"));
    const before = await s.checkpoint(customer, config);
    expect(before.rows[0]).toMatchObject({ window_to: "2026-10-01" });
    expect(before.rows[0].state).not.toBe("insufficient");

    // Backfill posterior (observado después) de una ventana más antigua.
    const returned = await s.ingest(audit("b-backfill", "2026-09-28", "2026-10-02T09:00:00Z"), config, new Date("2026-10-02T12:00:00Z"));
    const after = await s.checkpoint(customer, config);
    expect((await s.history(customer)).map(a => a.auditId)).toEqual(["a-current", "b-backfill"]);
    expect(after.latestAudit?.auditId).toBe("a-current");
    expect(after.rows).toEqual(before.rows);
    expect(returned).toEqual(before.rows);
    expect(after.rows.some(r => r.warnings.includes(STALE_PERIOD_WARNING))).toBe(false);
    expect(after.matchesConfig).toBe(true);

    // Un fallo de extracción de la ventana antigua tampoco reemplaza la lectura vigente.
    await s.ingest(audit("c-backfill-failed", "2026-09-27", "2026-10-02T10:00:00Z", { coverage: "unavailable", rows: [], warnings: ["API_TRANSPORT_ERROR"] }), config, new Date("2026-10-02T12:00:00Z"));
    expect((await s.checkpoint(customer, config)).latestAudit?.auditId).toBe("a-current");

    // La siguiente ventana vigente sí avanza y usa el backfill como historia comparable.
    await s.ingest(audit("d-next", "2026-10-02", "2026-10-03T08:00:00Z"), config, new Date("2026-10-03T12:00:00Z"));
    const next = await s.checkpoint(customer, config);
    expect(next.latestAudit?.auditId).toBe("d-next");
    expect(next.rows[0]).toMatchObject({ window_to: "2026-10-02" });
  });

  it("una auditoría fallida de la ventana vigente sí reemplaza la lectura sana (no se conserva verde)", async () => {
    const s = await store();
    await s.ingest(audit("a-current", "2026-10-01", "2026-10-02T08:00:00Z"), config, new Date("2026-10-02T12:00:00Z"));
    await s.ingest(audit("b-failed", "2026-10-02", "2026-10-03T08:00:00Z", { coverage: "unavailable", rows: [], warnings: ["API_TRANSPORT_ERROR"] }), config, new Date("2026-10-03T12:00:00Z"));
    const after = await s.checkpoint(customer, config);
    expect(after.latestAudit?.auditId).toBe("b-failed");
    expect(after.rows.every(r => r.state === "insufficient")).toBe(true);
  });
});
