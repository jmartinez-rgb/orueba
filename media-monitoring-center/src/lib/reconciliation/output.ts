import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { METRIC_DEFINITIONS, METRICS, ReconciliationError, type ReconciliationReport } from "./reconcile";

/** CSV is a human inspection aid; canonical JSON preserves full string identifiers. */
function csv(value: unknown, forceText = false): string {
  if (value === null || value === undefined) return "null";
  let text = String(value);
  if (forceText || /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reconciliationCsv(report: ReconciliationReport): string {
  const headers = ["brand", "platform", "account_id_text", "date", "granularity", "currency", "source_timezone", "coverage", "expected_campaigns", "observed_campaigns", "source_extracted_at", "metric_extracted_at_from", "metric_extracted_at_to", "catalog_extracted_at", "reference_exported_at", "codes", "reasons", ...METRICS.flatMap(metric => [`${metric}_source_total`, `${metric}_observed_subtotal`, `${metric}_reference`, `${metric}_delta`, `${metric}_relative_delta`, `${metric}_finding`])];
  const lines = report.rows.map(row => {
    const fields: unknown[] = [row.brand, row.platform, row.accountId, row.date, row.granularity, row.currency, row.timezone, row.coverage, row.expectedCampaigns, row.observedCampaigns, row.sourceExtractedAt, row.metricExtractedAtFrom, row.metricExtractedAtTo, row.catalogExtractedAt, report.reference?.exportedAt ?? null, row.codes.join("|"), row.reasons.join("|")];
    for (const metric of METRICS) {
      const c = row.comparisons[metric];
      fields.push(row.sourceMetrics[metric], row.observedSubtotal[metric], c.reference, c.delta, c.relativeDelta, c.code);
    }
    return fields.map((field, i) => csv(field, i === 2)).join(",");
  });
  return `${headers.join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

/** Must be populated from an independent UI export, never from API observations. */
export function referenceTemplate(report: ReconciliationReport) {
  return {
    version: 1, origin: "TEMPLATE" as const, exportedAt: null, scope: "ALL_CAMPAIGNS" as const,
    from: report.from, to: report.to,
    rows: report.rows.map(row => ({ brand: row.brand, platform: row.platform, accountId: row.accountId, date: row.date, granularity: row.granularity, currency: row.currency, timezone: row.timezone, metricDefinitions: METRIC_DEFINITIONS, spend: null, impressions: null, clicks: null })),
  };
}

export function outputPath(value?: string): string {
  const path = value ?? `reportes/conciliacion-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.json`;
  if (!path.endsWith(".json") || /[\u0000-\u001f?#]/.test(path) || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) throw new ReconciliationError("INVALID_OUTPUT_PATH");
  return resolve(path);
}

/** Exclusive files, private permissions, no following output symlinks or overwriting data. */
export async function writeExclusivePrivateFiles(paths: string[], bodies: string[]): Promise<void> {
  try {
    for (const path of paths) {
      try { await lstat(path); throw new ReconciliationError("OUTPUT_EXISTS"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await mkdir(dirname(paths[0]), { recursive: true, mode: 0o700 });
  } catch (error) { throw error instanceof ReconciliationError ? error : new ReconciliationError("OUTPUT_FAILED"); }
  const created: { path: string; ino: number; dev: number }[] = [];
  try {
    for (let i = 0; i < paths.length; i++) {
      const file = await open(paths[i], constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        const stat = await file.stat();
        created.push({ path: paths[i], ino: stat.ino, dev: stat.dev });
        await file.chmod(0o600);
        await file.writeFile(bodies[i], "utf8");
        await file.sync();
      } finally { await file.close(); }
    }
  } catch (error) {
    // Roll back only the files created by this invocation, preserving concurrent replacements.
    for (const item of created) {
      try { const stat = await lstat(item.path); if (stat.ino === item.ino && stat.dev === item.dev) await unlink(item.path); } catch { /* Preserve the original safe error. */ }
    }
    throw new ReconciliationError((error as NodeJS.ErrnoException).code === "EEXIST" ? "OUTPUT_EXISTS" : "OUTPUT_FAILED");
  }
}

export async function writeReconciliationArtifacts(report: ReconciliationReport, output?: string): Promise<{ json: string; csv: string; template: string }> {
  const json = outputPath(output);
  const files = { json, csv: json.replace(/\.json$/, ".csv"), template: json.replace(/\.json$/, ".reference-template.json") };
  await writeExclusivePrivateFiles([files.json, files.csv, files.template], [JSON.stringify(report, null, 2) + "\n", reconciliationCsv(report), JSON.stringify(referenceTemplate(report), null, 2) + "\n"]);
  return files;
}

/** Bounded regular files only, never through a symlink. Errors never disclose file bodies. */
export async function readPrivateInputFile(path: string, extension: ".json" | ".csv", code: string): Promise<Buffer> {
  if (!path.endsWith(extension) || /[\u0000-\u001f?#]/.test(path) || /(^|[\/\\])\.env(?:\.|$)/.test(path) || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) throw new ReconciliationError(code);
  const maxBytes = 8 * 1024 * 1024;
  try {
    const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw new ReconciliationError(code);
      const bytes = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, null);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      if (size > maxBytes) throw new ReconciliationError(code);
      return bytes.subarray(0, size);
    } finally { await file.close(); }
  } catch { throw new ReconciliationError(code); }
}

/** Bounded regular JSON files only. Errors never disclose JSON bodies or parser excerpts. */
export async function readReferenceFile(path: string): Promise<unknown> {
  const bytes = await readPrivateInputFile(path, ".json", "INVALID_REFERENCE_FILE");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new ReconciliationError("INVALID_REFERENCE_FILE"); }
}
