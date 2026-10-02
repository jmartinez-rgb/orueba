import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildReconciliation, parseReference, type ReconciliationReport } from "@/lib/reconciliation/reconcile";
import { outputPath, readReferenceFile, reconciliationCsv, referenceTemplate, writeReconciliationArtifacts } from "@/lib/reconciliation/output";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { type UnifiedScope } from "@/lib/unified/schema";

const run = promisify(execFile);
const scope: UnifiedScope = { brand: "izzi", platform: "google", accountId: "7338571937913978882", currency: "USD" };
const extractedAt = "2026-10-01T12:00:00Z";
const from = "2026-09-30";
let directory: string;
let report: ReconciliationReport;
let store: UnifiedSnapshotStore;
async function cli(args: string[]) {
  const guard = join(directory, "offline-guard.mjs");
  await writeFile(guard, 'globalThis.fetch = async () => { throw new Error("Network prohibited in offline CLI test"); };\n');
  const options = { cwd: process.cwd(), env: { ...process.env, UNIFIED_ADS_DATA_DIR: store.root, UNIFIED_ADS_MAPPING: JSON.stringify({ version: 1, accounts: [scope] }) } };
  try { const result = await run(process.execPath, ["--import", guard, "--conditions=react-server", "--import", "tsx", "scripts/reconcile.ts", ...args], options); return { ...result, exitCode: 0 }; }
  catch (error) { const result = error as Error & { code: number; stdout: string; stderr: string }; return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }; }
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "reconcile-private-"));
  store = new UnifiedSnapshotStore(join(directory, "snapshots"));
  await store.saveCatalog({ version: 1, scope, extractedAt, account: { platform: "google", account_id: scope.accountId, account_name: "Name must not be exported", currency: "USD", timezone: "America/Mexico_City" }, campaigns: [{ platform: "google", account_id: scope.accountId, campaign_id: "c1", campaign_name: "Campaign name must not be exported", campaign_status: "active", source_status: null, objective: null }] });
  await store.savePartition({ version: 1, scope, date: from, granularity: "daily", extractedAt, rows: [{ platform: "google", account_id: scope.accountId, campaign_id: "c1", date: from, hour: null, currency: "USD", source_timezone: "America/Mexico_City", spend: 0, impressions: 100, clicks: null, extracted_at: extractedAt, raw_metrics: {} }] });
  report = await buildReconciliation({ mapping: { version: 1, accounts: [scope] }, store, from, to: from, now: new Date("2026-10-02T12:00:00Z") });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("private offline reconciliation artifacts", () => {
  it("creates three fresh files with 0600 and no account/campaign names", async () => {
    const paths = await writeReconciliationArtifacts(report, join(directory, "reports", "first.json"));
    for (const file of Object.values(paths)) {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const bytes = await readFile(file, "utf8");
      expect(bytes).not.toContain("Name must not");
      expect(bytes).not.toContain("Campaign name must not");
    }
    expect((await stat(join(directory, "reports"))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(paths.json, "utf8"))).toMatchObject({ origin: "RECONCILIATION", certifiesV1: false, rows: [{ accountId: scope.accountId, currency: "USD", sourceMetrics: { spend: 0, clicks: null } }] });
  });
  it("template contains only unknown expected values and cannot be accepted as a real reference", () => {
    const template = referenceTemplate(report);
    expect(template).toMatchObject({ origin: "TEMPLATE", exportedAt: null, rows: [{ spend: null, impressions: null, clicks: null }] });
    expect(() => parseReference(template)).toThrow(/INVALID_REFERENCE/);
  });
  it("CSV keeps null distinct from zero and preserves long account IDs as protected text", () => {
    const csv = reconciliationCsv(report);
    const lines = csv.trim().split("\r\n");
    const headers = lines[0].split(",");
    const fields = lines[1].split(",");
    expect(fields[headers.indexOf("spend_source_total")]).toBe('"0"');
    expect(fields[headers.indexOf("clicks_source_total")]).toBe("null");
    expect(fields[headers.indexOf("account_id_text")]).toBe(`"'${scope.accountId}"`);
  });
  it("escapes CSV quotes, commas and lines while neutralizing formula prefixes", () => {
    const row = report.rows[0];
    row.accountId = "=formula";
    row.reasons = ['reason, "quoted"\r\nnext'];
    expect(reconciliationCsv(report)).toContain('"\'=formula"');
    expect(reconciliationCsv(report)).toContain('"reason, ""quoted""\r\nnext"');
  });
  it.each(["json", "csv", "template"] as const)("never overwrites an existing %s artifact or creates its siblings", async kind => {
    const output = join(directory, "exists.json");
    const paths = { json: output, csv: output.replace(".json", ".csv"), template: output.replace(".json", ".reference-template.json") };
    await writeFile(paths[kind], "preserve-existing");
    await expect(writeReconciliationArtifacts(report, output)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await readFile(paths[kind], "utf8")).toBe("preserve-existing");
    expect((await readdir(directory)).filter(name => name.startsWith("exists"))).toHaveLength(1);
  });
  it("rejects symlink outputs without touching the target", async () => {
    const target = join(directory, "target.json");
    await writeFile(target, "preserve-target");
    const output = join(directory, "linked.json");
    await symlink(target, output);
    await expect(writeReconciliationArtifacts(report, output)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await readFile(target, "utf8")).toBe("preserve-target");
  });
  it("two concurrent writers reserve one complete report and preserve all its files", async () => {
    const output = join(directory, "concurrent.json");
    const results = await Promise.allSettled([writeReconciliationArtifacts(report, output), writeReconciliationArtifacts(report, output)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    for (const path of [output, output.replace(".json", ".csv"), output.replace(".json", ".reference-template.json")]) expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ origin: "RECONCILIATION" });
  });
  it.each(["report.csv", "https://example.test/report.json", "report.json\nprivate", "report.json?token=hidden"])("rejects invalid/URL output without disclosure: %s", path => {
    expect(() => outputPath(path)).toThrow(/INVALID_OUTPUT_PATH/);
  });
  it("reads a bounded regular JSON reference only", async () => {
    const path = join(directory, "reference.json");
    await writeFile(path, '{"version":1}');
    expect(await readReferenceFile(path)).toEqual({ version: 1 });
    await expect(readReferenceFile(directory + ".json")).rejects.toMatchObject({ code: "INVALID_REFERENCE_FILE" });
  });
  it("malformed JSON errors do not contain body or parser excerpts", async () => {
    const path = join(directory, "malformed.json");
    await writeFile(path, '{secret-body-must-not-leak');
    await expect(readReferenceFile(path)).rejects.toThrow(/^Conciliación no disponible \(INVALID_REFERENCE_FILE\)\.$/);
  });
  it("rejects oversized files, input symlinks, secret env filenames and URLs", async () => {
    const path = join(directory, "oversized.json");
    await writeFile(path, " ".repeat(8 * 1024 * 1024 + 1));
    await expect(readReferenceFile(path)).rejects.toMatchObject({ code: "INVALID_REFERENCE_FILE" });
    const link = join(directory, "link.json");
    await symlink(path, link);
    for (const name of [link, join(directory, ".env.json"), "https://example.test/secret.json"]) await expect(readReferenceFile(name)).rejects.toMatchObject({ code: "INVALID_REFERENCE_FILE" });
  });
  it("CLI help works without API credentials or reading injected secret bodies", async () => {
    const { stdout, stderr } = await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/reconcile.ts", "--ayuda"], { cwd: process.cwd(), env: { ...process.env, UNIFIED_ADS_API_KEY: "secret-fixture-not-for-output" } });
    expect(stdout).toContain("Sin API, secretos");
    expect(stdout + stderr).not.toContain("secret-fixture-not-for-output");
  });
  it("CLI requires dates and returns only a safe failure code", async () => {
    try {
      await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/reconcile.ts"], { cwd: process.cwd() });
      throw new Error("Command unexpectedly succeeded");
    } catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({ code: "INVALID_OPTIONS" });
    }
  });
  it("CLI exports the private native-currency matrix offline and exits 2 without a reference", async () => {
    const output = join(directory, "cli-no-reference.json");
    const result = await cli(["--from", from, "--to", from, "--output", output]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ rows: 1, counts: { MISSING_REFERENCE: 1 }, exitCode: 2 });
    const saved = JSON.parse(await readFile(output, "utf8"));
    expect(saved).toMatchObject({ reference: null, rows: [{ currency: "USD", sourceMetrics: { spend: 0, clicks: null } }] });
  });
  it("CLI compares a declared complete reference offline, returns 0, and retains its timestamps", async () => {
    const partition = (await store.partition(scope, from, "daily"))!;
    partition.rows[0].clicks = 0;
    await store.savePartition(partition);
    const template = referenceTemplate(report);
    const reference = { ...template, origin: "ADS_MANAGER", exportedAt: extractedAt, rows: [{ ...template.rows[0], spend: 0, impressions: 100, clicks: 0 }] };
    const referenceFile = join(directory, "ads-manager.json");
    await writeFile(referenceFile, JSON.stringify(reference));
    const output = join(directory, "cli-match.json");
    const result = await cli(["--from", from, "--to", from, "--reference", referenceFile, "--output", output]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ rows: 1, counts: { MATCH: 1 }, exitCode: 0 });
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ certifiesV1: false, reference: { origin: "ADS_MANAGER", exportedAt: extractedAt }, rows: [{ sourceExtractedAt: extractedAt }] });
  });
  it("CLI rejects a reference template before writing files, with only the error code", async () => {
    const referenceFile = join(directory, "template.json");
    await writeFile(referenceFile, JSON.stringify(referenceTemplate(report)));
    const output = join(directory, "must-not-exist.json");
    const result = await cli(["--from", from, "--to", from, "--reference", referenceFile, "--output", output]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({ code: "INVALID_REFERENCE" });
    expect(await readdir(directory)).not.toContain("must-not-exist.json");
  });
});
