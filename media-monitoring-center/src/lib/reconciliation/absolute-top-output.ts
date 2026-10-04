import { randomBytes } from "node:crypto";
import { AT_METRICS, type AtReconciliationReport } from "./absolute-top";
import { outputPath, writeExclusivePrivateFiles } from "./output";

function csv(value: unknown, forceText = false): string {
  if (value === null || value === undefined) return "null";
  let text = String(value);
  if (forceText || /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One line per entity and exported metric. IDs stay protected text; names are never written. */
export function absoluteTopReconciliationCsv(report: AtReconciliationReport): string {
  const headers = ["customer_id_text", "level", "campaign_id_text", "ad_group_id_text", "reference_origin", "join_by", "reference_row", "join_reason", "date", "timezone", "currency", "source_audit_id", "source_extracted_at_from", "reference_exported_at", "source_mature", "reference_mature", "partition_reasons", "metric", "code", "reason", "source", "source_bound", "reference_text", "reference", "reference_bound", "delta", "tolerance"];
  const lines: string[] = [];
  for (const p of report.partitions) for (const e of p.entities) for (const metric of AT_METRICS) {
    const c = e.comparisons[metric];
    if (c.code === "NOT_EXPORTED") continue;
    const fields: unknown[] = [e.customerId, e.level, e.campaignId, e.adGroupId, p.origin, p.joinBy, e.referenceRow, e.joinReason, e.date, p.timezone, p.currency, p.sourceAuditId, p.sourceExtractedAtFrom, p.referenceExportedAt, p.sourceMature, p.referenceMature, p.reasons.join("|"), metric, c.code, c.reason, c.source, c.sourceBound, c.referenceText, c.reference, c.referenceBound, c.delta, c.tolerance];
    lines.push(fields.map((f, i) => csv(f, i === 0 || i === 2 || i === 3)).join(","));
  }
  return `${headers.join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
}

export async function writeAbsoluteTopReconciliation(report: AtReconciliationReport, output?: string): Promise<{ json: string; csv: string }> {
  const json = outputPath(output ?? `reportes/conciliacion-absolute-top-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.json`);
  const files = { json, csv: json.replace(/\.json$/, ".csv") };
  await writeExclusivePrivateFiles([files.json, files.csv], [JSON.stringify(report, null, 2) + "\n", absoluteTopReconciliationCsv(report)]);
  return files;
}
