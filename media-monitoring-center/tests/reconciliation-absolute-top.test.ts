import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { googleDomainsSchema } from "@/lib/domains/config";
import { FileRecordStore } from "@/lib/records/store";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import type { AbsoluteTopAudit, AbsoluteTopRow } from "@/lib/absolute-top/types";
import { buildAbsoluteTopReconciliation, parseAtReference, parseCell, selectAudit, type AtReference } from "@/lib/reconciliation/absolute-top";
import { decodeExport, importAtExport, parseDelimited, type AtImportOptions } from "@/lib/reconciliation/absolute-top-import";
import { absoluteTopReconciliationCsv, writeAbsoluteTopReconciliation } from "@/lib/reconciliation/absolute-top-output";

const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const customer = config.domains[0].accounts[0].customerId;
const day = "2026-10-01";
const mature = "2026-10-04T12:00:00Z";
const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function tmp() { const d = await mkdtemp(join(tmpdir(), "at-reconcile-")); dirs.push(d); return d; }

function row(patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return { level: "campaign", domain_id: "primer_dominio", domain_name: "Primer Dominio", customer_id: customer, account_id: customer, account_name: "Cuenta secreta", campaign_id: "111", campaign_name: "Nombre de campaña secreto", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null, date: day, hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: mature, absolute_top_rate: .45674, top_of_page_rate: .8, search_impression_share: null, search_lost_is_rank: .12, search_lost_is_budget: null, impressions: 1234, clicks: 56, ctr: 4.5, cpc: 2, spend: 1234.564, conversions: 1, bidding_strategy: null, daily_budget: 500, share_bounds: { search_impression_share: "lt_10_percent" }, warnings: [], ...patch };
}
const group = (patch: Partial<AbsoluteTopRow> = {}) => row({ level: "ad_group", ad_group_id: "222", ad_group_name: "Grupo secreto", ad_group_status: "active", daily_budget: null, search_lost_is_budget: null, ...patch });
function audit(rows: AbsoluteTopRow[], patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit {
  return { version: 1, auditId: "audit-mature", customerId: customer, observedAt: mature, from: day, to: day, granularity: "daily", coverage: "complete", rows, warnings: [], ...patch };
}
function reference(rows: AtReference["rows"], patch: Partial<Record<keyof AtReference, unknown>> = {}) {
  return { version: 1, origin: "GOOGLE_ADS_UI_EXPORT", exportedAt: mature, customerId: "877-953-6058", level: "campaign", date: day, timezone: "America/Mexico_City", currency: "MXN", network: "GOOGLE_SEARCH_ONLY", networkEvidence: "SEGMENT_COLUMN", numberFormat: { decimal: ".", thousands: "," }, rows, ...patch };
}
const cells = (patch: Record<string, string> = {}) => ({ absolute_top_rate: "45.67%", top_of_page_rate: "80.00%", search_impression_share: "< 10%", search_lost_is_rank: "12.00%", search_lost_is_budget: "--", impressions: "1,234", clicks: "56", spend: "1,234.56", ...patch });
const now = new Date("2026-10-05T00:00:00Z");
const reconcile = (refs: unknown[], history: AbsoluteTopAudit[], extra: { auditId?: string; now?: Date } = {}) => buildAbsoluteTopReconciliation({ references: refs, history: async () => history, now, ...extra });

describe("Absolute Top reference cells", () => {
  const dot = { decimal: "." as const, thousands: "," as const }, comma = { decimal: "," as const, thousands: "." as const };
  it("parses the declared locale without guessing and keeps the displayed precision", () => {
    expect(parseCell("absolute_top_rate", "45.67%", dot)).toEqual({ value: 45.67, decimals: 2, bound: null });
    expect(parseCell("absolute_top_rate", "45,67 %", comma)).toEqual({ value: 45.67, decimals: 2, bound: null });
    expect(parseCell("impressions", "12.345", comma)).toEqual({ value: 12345, decimals: 0, bound: null });
    expect(parseCell("spend", "1,234.5", dot)).toEqual({ value: 1234.5, decimals: 1, bound: null });
    expect(() => parseCell("absolute_top_rate", "45,67%", dot)).toThrow(/INVALID_AT_CELL/);
  });
  it("keeps unknown cells as null instead of zero and zero as a known value", () => {
    expect(parseCell("absolute_top_rate", "--", dot).value).toBeNull();
    expect(parseCell("absolute_top_rate", "", dot).value).toBeNull();
    expect(parseCell("absolute_top_rate", "0.00%", dot).value).toBe(0);
  });
  it("accepts only Google's published censoring and rejects it on the rate", () => {
    expect(parseCell("search_impression_share", "< 10%", dot)).toMatchObject({ value: null, bound: "lt_10_percent" });
    expect(parseCell("search_lost_is_rank", "> 90%", dot)).toMatchObject({ value: null, bound: "gt_90_percent" });
    for (const [metric, text] of [["absolute_top_rate", "< 10%"], ["search_impression_share", "> 90%"], ["search_lost_is_rank", "< 10%"], ["search_impression_share", "< 20%"]] as const) expect(() => parseCell(metric, text, dot)).toThrow(/INVALID_AT_CELL/);
  });
  it("rejects currency symbols, fractional counts, missing percent signs and impossible rates", () => {
    for (const [metric, text] of [["spend", "$1,234.56"], ["impressions", "12.5"], ["absolute_top_rate", "45.67"], ["absolute_top_rate", "120%"], ["clicks", "abc"]] as const) expect(() => parseCell(metric, text, dot)).toThrow(/INVALID_AT_CELL/);
  });
});

describe("Absolute Top reconciliation against an independent UI export", () => {
  it("matches native values within half of the displayed digit and counts exactly", async () => {
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }])], [audit([row()])]);
    const entity = report.partitions[0].entities[0];
    expect(entity.comparisons.absolute_top_rate).toMatchObject({ code: "MATCH", source: expect.closeTo(45.674, 9), reference: 45.67 });
    expect(entity.comparisons.search_impression_share.code).toBe("BOUND_MATCH");
    expect(entity.comparisons.search_lost_is_budget).toMatchObject({ code: "UNKNOWN_METRIC", reason: "SOURCE_UNKNOWN" });
    expect(entity.comparisons.impressions.code).toBe("MATCH");
    expect(entity.comparisons.spend.code).toBe("MATCH");
    expect(report.policy).toMatchObject({ primaryMetric: "metrics.absolute_top_impression_percentage", notSearchAbsoluteTopImpressionShare: true, domainAggregateCompared: false });
    expect(report.primary).toMatchObject({ compared: 1, matched: 1, differences: 0 });
    expect(report.exitCode).toBe(2); // the unknown budget lost IS keeps the partition pending
    const withoutBudget: Record<string, string> = cells();
    delete withoutBudget.search_lost_is_budget;
    const clean = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: withoutBudget }])], [audit([row()])]);
    expect(clean.exitCode).toBe(0);
    expect(clean.certifiesV1).toBe(false);
  });
  it("reports a difference beyond rounding and never matches an unknown source rate", async () => {
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells({ absolute_top_rate: "45.66%", impressions: "1,235" }) }])], [audit([row()])]);
    const c = report.partitions[0].entities[0].comparisons;
    expect(c.absolute_top_rate.code).toBe("DIFFERENCE");
    expect(c.impressions).toMatchObject({ code: "DIFFERENCE", delta: -1 });
    const unknown = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells({ absolute_top_rate: "0.00%" }) }])], [audit([row({ absolute_top_rate: null })])]);
    expect(unknown.partitions[0].entities[0].comparisons.absolute_top_rate).toMatchObject({ code: "UNKNOWN_METRIC", reason: "SOURCE_UNKNOWN" });
    expect(unknown.exitCode).toBe(2);
    const zero = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: { absolute_top_rate: "0.00%" } }])], [audit([row({ absolute_top_rate: 0 })])]);
    expect(zero.partitions[0].entities[0].comparisons.absolute_top_rate.code).toBe("MATCH");
  });
  it("treats a censored source against an exact export, or the reverse, as a difference", async () => {
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: { absolute_top_rate: "45.67%", search_impression_share: "8.50%" } }])], [audit([row()])]);
    expect(report.partitions[0].entities[0].comparisons.search_impression_share).toMatchObject({ code: "DIFFERENCE", reason: "REFERENCE_NOT_CENSORED" });
  });
  it("lists entities missing on either side without inventing zeros", async () => {
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }, { campaignId: "999", adGroupId: null, cells: cells() }])], [audit([row(), row({ campaign_id: "333" })])]);
    const byId = Object.fromEntries(report.partitions[0].entities.map(e => [e.campaignId, e.codes]));
    expect(byId["999"]).toEqual(["MISSING_SOURCE"]);
    expect(byId["333"]).toEqual(["MISSING_REFERENCE"]);
    expect(report.exitCode).toBe(2);
  });
  it("compares campaign and ad group levels independently, never across levels", async () => {
    const history = [audit([row(), group({ absolute_top_rate: .3 })])];
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: "222", cells: { absolute_top_rate: "30.00%" } }], { level: "ad_group" })], history);
    expect(report.partitions[0].entities).toHaveLength(1);
    expect(report.partitions[0].entities[0]).toMatchObject({ level: "ad_group", adGroupId: "222", codes: ["MATCH"] });
    expect(() => parseAtReference(reference([{ campaignId: "111", adGroupId: "222", cells: { absolute_top_rate: "30%", search_lost_is_budget: "--" } }], { level: "ad_group" }))).toThrow(/INVALID_AT_REFERENCE/);
  });
  it("blocks different clocks or currencies instead of converting them", async () => {
    const clock = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }], { timezone: "America/Bogota" })], [audit([row()])]);
    expect(clock.partitions[0].entities[0].codes).toEqual(["INCOMPATIBLE_CLOCK"]);
    const currency = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }], { currency: "USD" })], [audit([row()])]);
    expect(currency.partitions[0].entities[0].codes).toEqual(["INCOMPATIBLE_CURRENCY"]);
  });
  it("keeps an immature extraction or export pending even when every value matches", async () => {
    const early = "2026-10-02T12:00:00Z";
    const source = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: { absolute_top_rate: "45.67%" } }])], [audit([row({ extracted_at: early })], { observedAt: early })]);
    expect(source.partitions[0]).toMatchObject({ sourceMature: false, referenceMature: true });
    expect(source.partitions[0].reasons).toContain("SOURCE_MATURITY_PENDING");
    expect(source.exitCode).toBe(2);
    const exported = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: { absolute_top_rate: "45.67%" } }], { exportedAt: "2026-10-02T15:00:00Z" })], [audit([row()])]);
    expect(exported.partitions[0].referenceMature).toBe(false);
    expect(exported.exitCode).toBe(2);
  });
  it("rejects intraday or future exports and duplicate partitions", async () => {
    await expect(reconcile([reference([], { exportedAt: "2026-10-01T23:00:00-06:00" })], [])).rejects.toThrow(/INVALID_AT_REFERENCE_TIME/);
    await expect(reconcile([reference([], { exportedAt: "2026-10-06T00:00:00Z" })], [])).rejects.toThrow(/INVALID_AT_REFERENCE_TIME/);
    await expect(reconcile([reference([]), reference([])], [])).rejects.toThrow(/DUPLICATE_AT_REFERENCE/);
    expect(() => parseAtReference({ ...reference([]), origin: "TEMPLATE" })).toThrow(/INVALID_AT_REFERENCE/);
    expect(() => parseAtReference(reference([{ campaignId: "111", adGroupId: null, cells: {} }, { campaignId: "111", adGroupId: null, cells: {} }]))).toThrow(/INVALID_AT_REFERENCE/);
  });
  it("uses the latest complete daily audit and flags a newer unavailable one", async () => {
    const old = audit([row({ absolute_top_rate: .2 })], { auditId: "old", observedAt: "2026-10-03T12:00:00Z" });
    const good = audit([row()], { auditId: "good", observedAt: mature });
    const failed = audit([], { auditId: "failed", observedAt: "2026-10-04T13:00:00Z", coverage: "unavailable" });
    const hourly = audit([row({ hour: 3 })], { auditId: "hourly", observedAt: "2026-10-04T14:00:00Z", granularity: "hourly" });
    const picked = selectAudit([old, good, failed, hourly], day);
    expect(picked.audit?.auditId).toBe("good");
    expect(picked.reasons).toEqual(["NEWER_AUDIT_NOT_COMPLETE"]);
    expect(selectAudit([old, good], day, "old").audit?.auditId).toBe("old");
    expect(selectAudit([hourly], day, "hourly")).toEqual({ audit: null, reasons: ["AUDIT_NOT_COMPARABLE"] });
    const none = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }])], [failed]);
    expect(none.partitions[0].reasons).toContain("NO_COMPLETE_DAILY_AUDIT");
    expect(none.partitions[0].entities[0].codes).toEqual(["MISSING_SOURCE"]);
  });
});

describe("Google Ads UI export import", () => {
  const columns = { version: 1, level: "campaign", columns: { campaignId: "Campaign ID", adGroupId: null, network: "Network (with search partners)", currency: "Currency code", date: null, absolute_top_rate: "Impr. (Abs. Top) %", top_of_page_rate: "Impr. (Top) %", search_impression_share: "Search impr. share", search_lost_is_rank: "Search lost IS (rank)", search_lost_is_budget: "Search lost IS (budget)", impressions: "Impr.", clicks: "Clicks", spend: "Cost" } };
  const options: AtImportOptions = { customerId: "877-953-6058", level: "campaign", date: day, timezone: "America/Mexico_City", currency: "MXN", exportedAt: mature, decimal: ".", thousands: ",", delimiter: ",", networkLabel: "Google search" };
  const csv = [
    "Campaign report", "\"October 1, 2026\"",
    "Campaign,Campaign ID,Network (with search partners),Currency code,Impr. (Abs. Top) %,Impr. (Top) %,Search impr. share,Search lost IS (rank),Search lost IS (budget),Impr.,Clicks,Cost",
    "\"Nombre, con coma\",111,Google search,MXN,45.67%,80.00%,< 10%,12.00%,--,\"1,234\",56,\"1,234.56\"",
    "\"Nombre, con coma\",111,Search partners,MXN,--,--,--,--,--,10,1,2.00",
    "Total: Account,--,,MXN,45.67%,80.00%,--,--,--,\"1,244\",57,\"1,236.56\"",
  ].join("\r\n");
  it("keeps only the declared network rows, skips totals and preserves raw cells", () => {
    const ref = importAtExport(csv, columns, options);
    expect(ref).toMatchObject({ customerId: customer, networkEvidence: "SEGMENT_COLUMN", rows: [{ campaignId: "111", adGroupId: null, cells: { absolute_top_rate: "45.67%", impressions: "1,234", search_lost_is_budget: "--" } }] });
  });
  it("decodes UTF-16 tab exports with comma decimals", () => {
    const tab = ["Campaign ID\tImpr. (Abs. Top) %\tImpr.", "111\t45,67 %\t1.234"].join("\n");
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tab, "utf16le")]);
    const minimal = { version: 1, level: "campaign", columns: { ...Object.fromEntries(Object.keys(columns.columns).map(k => [k, null])), campaignId: "Campaign ID", absolute_top_rate: "Impr. (Abs. Top) %", impressions: "Impr." } };
    const ref = importAtExport(decodeExport(bytes), minimal, { ...options, delimiter: "\t", decimal: ",", thousands: ".", networkLabel: undefined, networkFilteredInUi: true });
    expect(ref).toMatchObject({ networkEvidence: "FILTERED_IN_UI", numberFormat: { decimal: ",", thousands: "." }, rows: [{ cells: { absolute_top_rate: "45,67 %", impressions: "1.234" } }] });
  });
  it("rejects ambiguous network declarations, rows without IDs, other currencies and bad cells", () => {
    expect(() => importAtExport(csv, columns, { ...options, networkLabel: undefined })).toThrow(/INVALID_AT_NETWORK_DECLARATION/);
    expect(() => importAtExport(csv, columns, { ...options, networkFilteredInUi: true })).toThrow(/INVALID_AT_NETWORK_DECLARATION/);
    expect(() => importAtExport(csv.replace("\"Nombre, con coma\",111,Google", "Otra fila,,Google"), columns, options)).toThrow(/AT_EXPORT_ROW_WITHOUT_ID_4/);
    expect(() => importAtExport(csv.replace("Google search,MXN", "Google search,USD"), columns, options)).toThrow(/AT_EXPORT_CURRENCY_MISMATCH_4/);
    expect(() => importAtExport(csv.replace("45.67%,80.00%,< 10%", "45.67%,80.00%,> 90%"), columns, options)).toThrow(/AT_EXPORT_INVALID_CELL_4/);
    expect(() => importAtExport(csv, { ...columns, columns: { ...columns.columns, absolute_top_rate: "Impr. (Abs. Top) % nueva" } }, options)).toThrow(/AT_EXPORT_HEADERS_NOT_FOUND/);
    for (const wrong of ["Search abs. top IS", "Cuota de impr. de búsqueda en la parte sup. abs.", "Search absolute top impression share"]) expect(() => importAtExport(csv, { ...columns, columns: { ...columns.columns, absolute_top_rate: wrong } }, options)).toThrow(/INVALID_AT_COLUMNS/);
    expect(() => importAtExport(csv, { ...columns, level: "ad_group" }, { ...options, level: "ad_group" })).toThrow(/INVALID_AT_COLUMNS/);
  });
  it("refuses broken quoting instead of repairing it", () => {
    expect(() => parseDelimited('a,b"c\n', ",")).toThrow(/INVALID_AT_EXPORT_CSV/);
    expect(() => parseDelimited('"abierto,1\n', ",")).toThrow(/INVALID_AT_EXPORT_CSV/);
    expect(parseDelimited('"x ""y""",2\r\n', ",")).toEqual([['x "y"', "2"]]);
  });
});

describe("private outputs and offline CLI", () => {
  it("writes 0600 files with IDs as text and without account, campaign or group names", async () => {
    const report = await reconcile([reference([{ campaignId: "111", adGroupId: null, cells: cells() }])], [audit([row()])]);
    const dir = await tmp();
    const files = await writeAbsoluteTopReconciliation(report, join(dir, "out", "at.json"));
    for (const file of Object.values(files)) {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const body = await readFile(file, "utf8");
      for (const secret of ["secreta", "secreto"]) expect(body).not.toContain(secret);
    }
    expect(absoluteTopReconciliationCsv(report)).toContain(`"'${customer}"`);
    await expect(writeAbsoluteTopReconciliation(report, join(dir, "out", "at.json"))).rejects.toThrow(/OUTPUT_EXISTS/);
  });
  it("imports and compares from saved audits without network, printing only counts", async () => {
    const dir = await tmp();
    const records = join(dir, "records");
    // The CLI uses the real clock: build a closed, mature day relative to it.
    const cliDay = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const cliMature = new Date(Date.parse(`${cliDay}T12:00:00Z`) + 3 * 86400000).toISOString();
    await new AbsoluteTopStore(new FileRecordStore(records)).ingest(audit([row({ date: cliDay, extracted_at: cliMature })], { from: cliDay, to: cliDay, observedAt: cliMature }), config, new Date(cliMature));
    const columns = { version: 1, level: "campaign", columns: { campaignId: "ID de campaña", adGroupId: null, network: null, currency: null, date: null, absolute_top_rate: "% de impr. (parte sup. abs.)", top_of_page_rate: null, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null, impressions: "Impr.", clicks: null, spend: null } };
    await writeFile(join(dir, "columnas.json"), JSON.stringify(columns));
    await writeFile(join(dir, "export.csv"), "ID de campaña;% de impr. (parte sup. abs.);Impr.\n111;45,67 %;1.234\n");
    const guard = join(dir, "offline-guard.mjs");
    await writeFile(guard, 'globalThis.fetch = async () => { throw new Error("Network prohibited in offline CLI test"); };\n');
    const env = { ...process.env, RECORDS_BACKEND: "file", RECORDS_DIR: records };
    const cli = async (args: string[]) => {
      try { const r = await run(process.execPath, ["--import", guard, "--conditions=react-server", "--import", "tsx", "scripts/reconcile-absolute-top.ts", ...args], { cwd: process.cwd(), env }); return { ...r, exitCode: 0 }; }
      catch (error) { const r = error as Error & { code: number; stdout: string; stderr: string }; return { stdout: r.stdout, stderr: r.stderr, exitCode: r.code }; }
    };
    const imported = await cli(["importar", "--csv", join(dir, "export.csv"), "--columnas", join(dir, "columnas.json"), "--cuenta", "877-953-6058", "--nivel", "campaign", "--fecha", cliDay, "--zona", "America/Mexico_City", "--moneda", "MXN", "--exportado", cliMature, "--decimal", ",", "--miles", ".", "--separador", "punto-y-coma", "--red-filtrada-en-ui", "--output", join(dir, "ref.json")]);
    expect(imported.exitCode).toBe(0);
    expect((await stat(join(dir, "ref.json"))).mode & 0o777).toBe(0o600);
    const compared = await cli(["comparar", "--referencia", join(dir, "ref.json"), "--output", join(dir, "conciliacion.json")]);
    expect(compared.exitCode).toBe(0);
    expect(JSON.parse(compared.stdout)).toMatchObject({ partitions: 1, primary: { compared: 1, matched: 1 }, exitCode: 0 });
    expect(compared.stdout).not.toContain("45");
    const bad = await cli(["comparar", "--referencia", join(dir, "columnas.json")]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("INVALID_AT_REFERENCE");
    expect(bad.stderr).not.toContain("ID de campa");
  }, 30000);
});
