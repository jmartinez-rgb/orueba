import type { GoogleDomainConfig } from "@/lib/domains/config";
import { severityRank } from "@/lib/anomaly-engine/severity";
import { addDays, businessDate, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import type { AbsoluteTopAudit, AbsoluteTopComparison, AbsoluteTopDomainSummary, AbsoluteTopEvaluation, AbsoluteTopRow } from "./types";

export const APPROXIMATION_NOTICE = "La ponderación tasa × impresiones es un indicador aproximado: Google puede usar un denominador distinto de las impresiones publicitarias. No representa un conteo exacto de búsquedas.";
export const entityKey = (row: AbsoluteTopRow) => `${row.customer_id}/${row.campaign_id}/${row.level}/${row.ad_group_id ?? "-"}`;
const periodKey = (row: AbsoluteTopRow) => `${entityKey(row)}/${row.date}/${row.hour ?? "day"}`;
const sum = (rows: AbsoluteTopRow[], key: "impressions" | "clicks" | "spend" | "conversions") => rows.length && rows.every(row => row[key] !== null) ? rows.reduce((total, row) => total + row[key]!, 0) : null;

/** Never combine daily totals with the hours contained in those totals. */
export function weightedRate(rows: AbsoluteTopRow[]): number | null {
  if (!rows.length || rows.some(row => row.impressions === null || (row.impressions > 0 && row.absolute_top_rate === null))) return null;
  const impressions = rows.reduce((total, row) => total + row.impressions!, 0);
  return impressions > 0 ? rows.reduce((total, row) => total + (row.absolute_top_rate ?? 0) * row.impressions!, 0) / impressions : null;
}

function aggregate(rows: AbsoluteTopRow[], template: AbsoluteTopRow, date: string): AbsoluteTopRow {
  const impressions = sum(rows, "impressions"), clicks = sum(rows, "clicks"), spend = sum(rows, "spend");
  const weighted = (key: "top_of_page_rate" | "search_impression_share" | "search_lost_is_rank" | "search_lost_is_budget") => {
    if (rows.length > 1 && key !== "top_of_page_rate") return null; // Eligible-impression denominators differ; these shares are not additive.
    if (!rows.length || impressions === null || impressions === 0 || rows.some(row => row[key] === null || (key !== "top_of_page_rate" && row.share_bounds[key]))) return null;
    return rows.reduce((total, row) => total + row[key]! * row.impressions!, 0) / impressions;
  };
  return { ...template, date, hour: rows.length === 1 ? rows[0].hour : null, absolute_top_rate: weightedRate(rows), impressions, clicks, spend, conversions: sum(rows, "conversions"), ctr: impressions !== null && impressions > 0 && clicks !== null ? clicks / impressions * 100 : null, cpc: clicks !== null && clicks > 0 && spend !== null ? spend / clicks : null, top_of_page_rate: weighted("top_of_page_rate"), search_impression_share: weighted("search_impression_share"), search_lost_is_rank: weighted("search_lost_is_rank"), search_lost_is_budget: weighted("search_lost_is_budget"), share_bounds: rows.length === 1 ? rows[0].share_bounds : {}, warnings: [...new Set(rows.flatMap(row => row.warnings))] };
}

function deduplicate(audits: AbsoluteTopAudit[], granularity: AbsoluteTopAudit["granularity"], observedAt: string): AbsoluteTopRow[] {
  const periods = new Map<string, AbsoluteTopRow>();
  for (const audit of [...audits].filter(a => a.granularity === granularity && Date.parse(a.observedAt) <= Date.parse(observedAt) && a.coverage === "complete").sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.auditId.localeCompare(b.auditId))) {
    for (const row of audit.rows) periods.set(periodKey(row), row);
  }
  return [...periods.values()];
}
const compare = (current: number | null, rows: AbsoluteTopRow[]): AbsoluteTopComparison => {
  const rate = weightedRate(rows);
  return { rate, delta_pp: current !== null && rate !== null ? (current - rate) * 100 : null, samples: rows.length, approximate: rows.length > 1 };
};
const valid = (row: AbsoluteTopEvaluation) => row.coverage === "complete" && !["insufficient", "unclassified"].includes(row.state);

/** Pure evaluation; counters advance only when the immutable extraction audit changes. */
export function evaluateAbsoluteTop(audit: AbsoluteTopAudit, history: AbsoluteTopAudit[], config: GoogleDomainConfig, previous: AbsoluteTopEvaluation[] = []): AbsoluteTopEvaluation[] {
  const domain = config.domains.find(domain => domain.accounts.some(account => account.customerId === audit.customerId));
  const previousByKey = new Map(previous.map(row => [row.entity_key, row]));
  const grouped = new Map<string, AbsoluteTopRow[]>();
  for (const row of audit.rows) { const key = entityKey(row); grouped.set(key, [...(grouped.get(key) ?? []), row]); }
  // Missing rows in a failed/partial extraction remain visible as unknown, never recovered.
  for (const row of previous) if (!grouped.has(row.entity_key)) grouped.set(row.entity_key, []);
  const periods = deduplicate([...history, audit], audit.granularity, audit.observedAt);
  const evaluations: AbsoluteTopEvaluation[] = [];
  for (const [key, rows] of grouped) {
    const old = previousByKey.get(key);
    const template = rows[0] ?? old!;
    const observed = new Date(audit.observedAt);
    const maxHour = audit.granularity === "daily" ? 23 : audit.to < businessDate(observed, template.source_timezone) ? 23 : audit.to === businessDate(observed, template.source_timezone) ? zonedParts(observed, template.source_timezone).hour - 1 : -1;
    const currentRows = rows.filter(row => row.date === audit.to && (row.hour === null || row.hour <= maxHour));
    const current = aggregate(currentRows, template, audit.to);
    current.domain_id = domain?.id ?? "unclassified"; current.domain_name = domain?.name ?? "Sin clasificar";
    const target = domain?.absoluteTopMinimum ?? null;
    const eligible = Boolean(domain) && (audit.granularity !== "daily" || audit.to < businessDate(observed, template.source_timezone)) && audit.coverage === "complete" && currentRows.length === (audit.granularity === "daily" ? 1 : maxHour + 1) && currentRows.length > 0 && current.absolute_top_rate !== null && current.impressions !== null && current.impressions >= config.absoluteTop.minImpressions;
    const gap = target !== null && current.absolute_top_rate !== null ? (current.absolute_top_rate - target) * 100 : null;
    const state = !domain ? "unclassified" : !eligible ? "insufficient" : gap! >= -1e-9 ? "meets" : gap! >= -config.absoluteTop.warningGapPp - 1e-9 ? "near" : "below";
    const entityPeriods = periods.filter(row => entityKey(row) === key && row.currency === current.currency && row.source_timezone === current.source_timezone);
    const sameCut = (row: AbsoluteTopRow) => audit.granularity === "daily" || row.hour! <= maxHour;
    const yesterday = entityPeriods.filter(row => row.date === addDays(audit.to, -1) && sameCut(row));
    const last24 = entityPeriods.filter(row => audit.granularity === "daily" ? row.date === addDays(audit.to, -1) : (row.date === audit.to && row.hour! <= maxHour) || (row.date === addDays(audit.to, -1) && row.hour! > maxHour));
    const last7 = entityPeriods.filter(row => audit.granularity === "daily" ? row.date >= addDays(audit.to, -6) && row.date <= audit.to : (row.date > addDays(audit.to, -7) && row.date < audit.to) || (row.date === audit.to && sameCut(row)) || (row.date === addDays(audit.to, -7) && row.hour! > maxHour));
    const completeWindow = (points: AbsoluteTopRow[], expected: number) => {
      if (points.length !== expected) return [];
      if (audit.granularity === "hourly") {
        const times = points.map(row => zonedTimeToUtc(row.date, row.hour!, 0, row.source_timezone).getTime()).sort((a,b) => a-b);
        if (times.some((time,index) => index > 0 && time - times[index-1] !== 3600000)) return [];
      }
      return points;
    };
    const sameWindow = old && old.source_timezone === current.source_timezone && old.currency === current.currency && old.window_end_hour === (audit.granularity === "hourly" ? maxHour : null) && old.date <= audit.to;
    const previousRate = old && sameWindow ? old.last_valid_rate ?? (valid(old) ? old.absolute_top_rate : null) : null;
    const previousComparison: AbsoluteTopComparison = { rate: previousRate, delta_pp: current.absolute_top_rate !== null && previousRate !== null ? (current.absolute_top_rate - previousRate) * 100 : null, samples: previousRate === null ? 0 : 1, approximate: maxHour > 0 };
    const sudden = eligible && previousComparison.delta_pp !== null && previousComparison.delta_pp <= -config.absoluteTop.suddenDropThresholdPp + 1e-9;
    const abnormal = eligible && (state === "near" || state === "below" || sudden);
    const sameAudit = old?.audit_id === audit.auditId;
    const wasAbnormal = old?.episode_open ?? (old && valid(old) && (old.state === "near" || old.state === "below" || old.sudden_drop));
    const consecutive = !eligible ? old?.persistence.consecutive_audits ?? 0 : abnormal ? sameAudit ? old!.persistence.consecutive_audits : wasAbnormal ? old!.persistence.consecutive_audits + 1 : 1 : 0;
    const first = abnormal ? wasAbnormal ? old!.persistence.first_detected_at : audit.observedAt : eligible ? null : old?.persistence.first_detected_at ?? null;
    const historicalRates = [...(old?.evolution ?? []).filter(point => point.audit_id !== audit.auditId), { at: audit.observedAt, rate: eligible ? current.absolute_top_rate : null, impressions: current.impressions, audit_id: audit.auditId }].filter(point => Date.parse(point.at) >= Date.parse(audit.observedAt) - config.absoluteTop.retentionDays * 86400000);
    const known = historicalRates.filter(point => point.rate !== null);
    const scoreComponents = { gap: eligible ? Math.min(40, Math.max(0, -gap!) * 2) : null, volume: eligible ? Math.min(10, Math.log10(current.impressions! / config.absoluteTop.minImpressions + 1) * 5) : null, persistence: eligible ? Math.min(15, consecutive * 5) : null, sudden_drop: eligible ? sudden ? 10 : 0 : null, campaign: eligible ? current.level === "campaign" ? 5 : 0 : null, spend: null as number | null, conversions: null as number | null, group_weight: null as number | null };
    const score = Object.values(scoreComponents).reduce<number>((total, value) => total + (value ?? 0), 0);
    evaluations.push({ ...current, window_from: audit.to, window_to: audit.to, window_end_hour: audit.granularity === "hourly" ? maxHour : null, episode_open: eligible ? abnormal : old?.episode_open ?? false, last_valid_rate: eligible ? current.absolute_top_rate : old?.last_valid_rate ?? null, entity_key: key, audit_id: audit.auditId, audit_at: audit.observedAt, coverage: audit.coverage, target_rate: target, gap_pp: gap, state, severity: !abnormal ? "NORMAL" : state === "near" || state === "meets" ? "ATTENTION" : consecutive >= 3 && score >= 70 ? "CRITICAL" : "ALERT", severity_score: score, score_components: scoreComponents, group_weight: null, sudden_drop: sudden, persistence: { consecutive_audits: consecutive, label: !eligible ? "Sin evaluación" : !abnormal ? "Dentro del objetivo" : consecutive >= 3 ? "Alerta persistente" : consecutive === 2 ? "Advertencia" : "Observación", first_detected_at: first, last_detected_at: abnormal ? audit.observedAt : eligible ? null : old?.persistence.last_detected_at ?? null, hours_since_detection: first ? Math.max(0, (Date.parse(audit.observedAt) - Date.parse(first)) / 3600000) : null, worst_rate: known.length ? Math.min(...known.map(point => point.rate!)) : null, best_rate: known.length ? Math.max(...known.map(point => point.rate!)) : null, mean_rate: known.length ? known.reduce((total, point) => total + point.rate!, 0) / known.length : null, audit_id: audit.auditId }, comparison: { previous: previousComparison, previous_day: compare(current.absolute_top_rate, completeWindow(yesterday, audit.granularity === "daily" ? 1 : maxHour + 1)), last_24h: compare(current.absolute_top_rate, completeWindow(last24, audit.granularity === "daily" ? 1 : 24)), last_7d: compare(current.absolute_top_rate, completeWindow(last7, audit.granularity === "daily" ? 7 : 168)) }, evolution: historicalRates, cross_status: "unknown", diagnostics: [] });
  }
  for (const row of evaluations) {
    const campaign = evaluations.find(parent => parent.level === "campaign" && parent.campaign_id === row.campaign_id);
    if (row.level === "ad_group" && campaign?.impressions && row.impressions !== null && row.impressions <= campaign.impressions) row.group_weight = row.impressions / campaign.impressions;
    const peers = evaluations.filter(peer => peer.level === row.level && peer.currency === row.currency);
    const peerSpend = peers.reduce((total, peer) => total + (peer.spend ?? 0), 0), peerConversions = peers.reduce((total, peer) => total + (peer.conversions ?? 0), 0);
    if (valid(row)) {
      row.score_components.spend = row.spend !== null && peers.every(peer => peer.spend !== null) && peerSpend > 0 ? row.spend / peerSpend * 10 : null;
      row.score_components.conversions = row.conversions !== null && peers.every(peer => peer.conversions !== null) && peerConversions > 0 ? row.conversions / peerConversions * 5 : null;
      row.score_components.group_weight = row.group_weight !== null ? row.group_weight * 10 : null;
      row.severity_score = row.state === "meets" && !row.sudden_drop ? 0 : Math.min(100, Object.values(row.score_components).reduce<number>((total, value) => total + (value ?? 0), 0));
      if (row.state === "below" && row.persistence.consecutive_audits >= 3 && row.severity_score >= 70) row.severity = "CRITICAL";
    }
    const children = evaluations.filter(child => child.level === "ad_group" && child.campaign_id === row.campaign_id);
    const bad = children.filter(child => valid(child) && ["near", "below"].includes(child.state));
    row.cross_status = !campaign || !valid(campaign) || !children.length || children.some(child => !valid(child)) ? "unknown" : bad.length === 0 && campaign.state === "meets" ? "healthy" : bad.length && campaign.state === "meets" ? "localized" : bad.length === 1 && bad.some(child => (child.group_weight ?? 0) >= .5) ? "concentrated" : bad.length / children.length > .5 ? "generalized" : "unknown";
    if (row.state === "insufficient") row.diagnostics.push("Datos no disponibles, cobertura incompleta o volumen inferior al mínimo; no se confirma recuperación.");
    if (row.state === "unclassified") row.diagnostics.push("Cuenta sin dominio en la configuración central.");
    if (row.share_bounds.search_lost_is_rank || row.share_bounds.search_lost_is_budget) row.diagnostics.push("Cuota de impresiones censurada por Google: se conserva su límite, sin tratarlo como porcentaje exacto.");
    if (row.search_lost_is_rank !== null && row.search_lost_is_rank > 0) row.diagnostics.push("Existe pérdida de cuota por ranking. Es una señal contextual; no demuestra por sí sola la causa de Absolute Top.");
    if (row.search_lost_is_budget !== null && row.search_lost_is_budget > 0) row.diagnostics.push("Existe pérdida de cuota por presupuesto. Revisar contexto; no implica aumentar inversión automáticamente.");
    if (row.sudden_drop) row.diagnostics.push("Caída súbita frente a la auditoría anterior comparable, aunque se conserve el mínimo del dominio.");
  }
  return evaluations.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.severity_score - a.severity_score || a.entity_key.localeCompare(b.entity_key));
}

export function summarizeAbsoluteTop(rows: AbsoluteTopEvaluation[], config: GoogleDomainConfig): AbsoluteTopDomainSummary[] {
  return config.domains.map(domain => {
    const selected = rows.filter(row => row.domain_id === domain.id), eligible = selected.filter(valid);
    const campaigns = selected.filter(row => row.level === "campaign");
    const windows = new Set(campaigns.map(row => JSON.stringify([row.window_from ?? row.date, row.window_to ?? row.date, row.window_end_hour ?? row.hour, row.source_timezone])));
    return { domain_id: domain.id, domain_name: domain.name, target_rate: domain.absoluteTopMinimum, campaigns: campaigns.length, ad_groups: selected.filter(row => row.level === "ad_group").length, meets: selected.filter(row => row.state === "meets").length, near: selected.filter(row => row.state === "near").length, below: selected.filter(row => row.state === "below").length, insufficient: selected.filter(row => !valid(row)).length, compliance_rate: eligible.length ? eligible.filter(row => row.state === "meets").length / eligible.length : null, weighted_absolute_top: windows.size === 1 ? weightedRate(campaigns) : null, weighting_approximate: true, severity_score: selected.reduce((score, row) => Math.max(score, row.severity_score), 0) };
  });
}
