import "server-only";
import type { BrandId } from "@/lib/brands";
import type { GoogleDomainConfig } from "@/lib/domains/config";
import { getEnv } from "@/lib/config/env";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { maxSeverity } from "@/lib/anomaly-engine/severity";
import type { Anomaly, MonitoringRun } from "@/lib/monitoring/types";
import { APPROXIMATION_NOTICE, summarizeAbsoluteTop } from "./engine";
import { buildAbsoluteTopAlertText } from "./format";
import { AbsoluteTopStore } from "./store";
import type { AbsoluteTopDashboard, AbsoluteTopEvaluation } from "./types";

export const absoluteTopFingerprint = (row: AbsoluteTopEvaluation) => `google:${row.entity_key}:absolute_top`;
export async function getAbsoluteTopDashboard(options: { brand: BrandId; domainId?: string; config?: GoogleDomainConfig | null; now?: Date; allowedCustomerIds?: string[]; store?: AbsoluteTopStore }): Promise<AbsoluteTopDashboard> {
  let config = options.config;
  const warnings: string[] = [];
  if (config === undefined) {
    const directory = getEnv().unifiedData.directory;
    try { config = directory ? await new UnifiedSnapshotStore(directory).domainConfig() : null; }
    catch { config = null; warnings.push("No se pudo leer la configuración central guardada."); }
  }
  const selectedDomain = options.domainId ?? "all";
  const empty: AbsoluteTopDashboard = { brand: options.brand, selectedDomain, configured: Boolean(config), available: false, lastAuditAt: null, domains: config?.domains ?? [], policy: config?.absoluteTop ?? null, rows: [], summaries: [], warnings, approximationNotice: APPROXIMATION_NOTICE };
  if (options.brand !== "izzi" || !config) return empty;
  const store = options.store ?? new AbsoluteTopStore();
  const now = options.now ?? new Date();
  const completeFreshCustomers = new Set<string>();
  const auditDates: string[] = [];
  let storedCompleteAudit = false;
  const accounts = new Set(config.domains.flatMap(domain => domain.accounts.map(account => account.customerId)));
  try { for (const customer of await store.customers()) if (options.allowedCustomerIds?.includes(customer)) accounts.add(customer); } catch { warnings.push("No se pudo enumerar el historial de auditorías."); }
  const rows: AbsoluteTopEvaluation[] = [];
  for (const account of accounts) {
    if (options.allowedCustomerIds && !options.allowedCustomerIds.includes(account)) continue;
    const accountDomain = config.domains.find(domain => domain.accounts.some(candidate => candidate.customerId === account));
    if (selectedDomain !== "all" && (accountDomain?.id ?? "unclassified") !== selectedDomain) continue;
    try {
      const { rows: saved, matchesConfig: matches, latestAudit } = await store.checkpoint(account, config);
      const accountLabel = `${accountDomain?.name ?? "Sin clasificar"} · cuenta ${account}`;
      if (!latestAudit) {
        warnings.push(`${accountLabel}: no hay una extracción completa almacenada. El agregado del dominio permanece N/D.`);
      } else {
        auditDates.push(latestAudit.observedAt);
        const coherent = saved.every(row => row.audit_id === latestAudit.auditId);
        const complete = latestAudit.coverage === "complete" && matches && coherent;
        const age = now.getTime() - Date.parse(latestAudit.observedAt);
        if (complete) storedCompleteAudit = true;
        else warnings.push(`${accountLabel}: la última extracción está incompleta, no coincide con la política central o se está actualizando. El agregado del dominio permanece N/D.`);
        if (age > config.absoluteTop.repeatAfterHours * 3600000) warnings.push(`${accountLabel}: auditoría antigua (${latestAudit.observedAt}); supera ${config.absoluteTop.repeatAfterHours} h sin una lectura nueva. Se conserva el estado histórico y no se confirma recuperación.`);
        else if (age < -60000) warnings.push(`${accountLabel}: la fecha de auditoría está por delante del reloj de evaluación; el agregado permanece N/D.`);
        else if (complete) completeFreshCustomers.add(account);
      }
      rows.push(...saved.map(row => {
        if (matches) return row;
        const domain = config.domains.find(item => item.accounts.some(candidate => candidate.customerId === row.customer_id));
        return { ...row, domain_id: domain?.id ?? "unclassified", domain_name: domain?.name ?? "Sin clasificar", target_rate: domain?.absoluteTopMinimum ?? null, gap_pp: null, state: "insufficient" as const, severity: "NORMAL" as const, severity_score: 0, coverage: "unavailable" as const, warnings: [...row.warnings, "DOMAIN_POLICY_CHANGED_REQUIRES_NEW_AUDIT"] };
      }));
    }
    catch { warnings.push(`Auditoría no disponible para la cuenta ${account}.`); }
  }
  const selected = rows.filter(row => selectedDomain === "all" || row.domain_id === selectedDomain);
  const dates = [...auditDates, ...selected.map(row => row.audit_at)].sort((a,b) => Date.parse(a)-Date.parse(b));
  const summaries = summarizeAbsoluteTop(selected, config).filter(summary => selectedDomain === "all" || summary.domain_id === selectedDomain).map(summary => {
    const expected = config.domains.find(domain => domain.id === summary.domain_id)!.accounts.filter(account => !options.allowedCustomerIds || options.allowedCustomerIds.includes(account.customerId));
    return expected.some(account => !completeFreshCustomers.has(account.customerId)) ? { ...summary, weighted_absolute_top: null } : summary;
  });
  return { ...empty, available: selected.length > 0 || storedCompleteAudit, lastAuditAt: dates.at(-1) ?? null, rows: selected, summaries, warnings: [...warnings, ...new Set(selected.flatMap(row => row.warnings))] };
}

function toAnomaly(row: AbsoluteTopEvaluation): Anomaly {
  return { key: row.entity_key, level: row.level, platform: "google", accountId: `google:${row.customer_id}`, accountName: row.account_name, campaignId: `google:${row.customer_id}:${row.campaign_id}`, campaignName: row.campaign_name, adGroupId: row.ad_group_id, adGroupName: row.ad_group_name, domain_id: row.domain_id, domain_name: row.domain_name, customer_id: row.customer_id, account_name: row.account_name, fingerprint: absoluteTopFingerprint(row), type: row.state === "meets" && row.sudden_drop ? "ABSOLUTE_TOP_DROP" : "ABSOLUTE_TOP_BELOW", family: "absolute_top", severity: row.severity, rawSeverity: row.severity, metric: "absolute_top_rate", current: row.absolute_top_rate, expected: row.target_rate, deviation: row.gap_pp === null ? null : row.gap_pp / 100, title: row.state === "meets" ? "Absolute Top: caída súbita" : "Absolute Top debajo del mínimo del dominio", diagnosis: buildAbsoluteTopAlertText(row), adjustments: row.diagnostics, evidence: [{ metric: "absolute_top_rate", label: "Absolute Top", current: row.absolute_top_rate, expected: row.target_rate, prevWeek: row.comparison.last_7d.rate, deviation: row.gap_pp === null ? null : row.gap_pp / 100 }], objective: "AWARENESS", expectedSpendShare: row.score_components.spend === null ? null : row.score_components.spend / 10, cutoffHour: row.window_end_hour === null || row.window_end_hour === undefined ? 24 : row.window_end_hour + 1, groupedUnder: null, absoluteTop: row };
}

/** Combine only with a full run; a dashboard view or isolated extraction cannot reconcile general alerts. */
export function combineAbsoluteTopRun(run: MonitoringRun, dashboard: AbsoluteTopDashboard): MonitoringRun {
  if (dashboard.selectedDomain !== "all") return { ...run, absoluteTopCoverage: {} };
  const coverage: NonNullable<MonitoringRun["absoluteTopCoverage"]> = {};
  const anomalies: Anomaly[] = [];
  for (const row of dashboard.rows) {
    const age = Date.parse(run.runAt) - Date.parse(row.audit_at);
    if (!dashboard.policy || age < -60000 || age > dashboard.policy.repeatAfterHours * 3600000 || row.coverage !== "complete" || ["insufficient", "unclassified"].includes(row.state)) continue;
    coverage[absoluteTopFingerprint(row)] = { auditId: row.audit_id, observedAt: row.audit_at, evaluation: row };
    if (row.state !== "meets" || row.sudden_drop) anomalies.push(toAnomaly(row));
  }
  const combined = [...run.anomalies.filter(anomaly => anomaly.family !== "absolute_top"), ...anomalies];
  return { ...run, anomalies: combined, absoluteTopCoverage: coverage, absoluteTopPolicy: dashboard.policy ?? undefined, overall: maxSeverity(run.overall, ...anomalies.map(anomaly => anomaly.severity)) };
}
