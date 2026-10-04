import { randomBytes } from "node:crypto";
import { AT_METRICS, type AtReconciliationReport } from "./absolute-top";
import { outputPath, writeExclusivePrivateFiles } from "./output";

function csv(value: unknown, forceText = false): string {
  if (value === null || value === undefined) return "null";
  let text = String(value);
  if (forceText || /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Counts-only summary for stdout: codes per top rate and per partition, the largest primary delta and
 * why entities are missing (source impressions N/D, zero or positive; unresolved name joins). No names.
 */
export function absoluteTopSummary(report: AtReconciliationReport) {
  const entities = report.partitions.flatMap(p => p.entities);
  const codes = (metric: "absolute_top_rate" | "top_of_page_rate") => Object.fromEntries(Object.entries(entities.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.comparisons[metric].code]: (acc[e.comparisons[metric].code] ?? 0) + 1 }), {})).sort());
  const missingRef = entities.filter(e => e.codes.includes("MISSING_REFERENCE")).map(e => e.comparisons.impressions.source);
  const positive = missingRef.filter((v): v is number => v !== null && v > 0);
  const missingSource = entities.filter(e => e.codes.includes("MISSING_SOURCE"));
  return {
    metrics: { absolute_top_rate: codes("absolute_top_rate"), top_of_page_rate: codes("top_of_page_rate") },
    maxAbsDeltaPp: report.primary.maxAbsDeltaPp,
    missingReference: { total: missingRef.length, sourceImpressionsUnknown: missingRef.filter(v => v === null).length, sourceImpressionsZero: missingRef.filter(v => v === 0).length, sourceImpressionsPositive: positive.length, maxSourceImpressions: positive.length ? Math.max(...positive) : null },
    missingSource: { total: missingSource.length, nameNotFound: missingSource.filter(e => e.joinReason === "NAME_NOT_FOUND").length, nameAmbiguous: missingSource.filter(e => e.joinReason === "NAME_AMBIGUOUS").length },
    byPartition: report.partitions.map(p => ({ customerId: p.customerId, level: p.level, entities: p.entities.length, absMatch: p.entities.filter(e => e.comparisons.absolute_top_rate.code === "MATCH").length, absDifference: p.entities.filter(e => e.comparisons.absolute_top_rate.code === "DIFFERENCE").length, missingReference: p.entities.filter(e => e.codes.includes("MISSING_REFERENCE")).length, missingSource: p.entities.filter(e => e.codes.includes("MISSING_SOURCE")).length, reasons: p.reasons })),
  };
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
