import type { AbsoluteTopDomainSummary, AbsoluteTopEvaluation } from "./types";
import { ABSOLUTE_TOP_COVERAGE_LABEL, ABSOLUTE_TOP_STATE_LABEL } from "./format";
import { businessDate } from "@/lib/time/tz";

const text = (value: string | null | undefined) => value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "N/D";
const rate = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(1)}%` : "N/D";
const gap = (value: number | null) => value !== null && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)} pp` : "N/D";
const score = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100 ? `${value.toFixed(1)}/100` : "N/D";
const instant = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "N/D";

function window(row: AbsoluteTopEvaluation) {
  const period = `${text(row.window_from ?? row.date)} a ${text(row.window_to ?? row.date)}`;
  let cut: string;
  if (row.window_end_hour !== null && row.window_end_hour !== undefined) cut = `acumulado [00:00, ${String(row.window_end_hour + 1).padStart(2, "0")}:00) del último día`;
  else if (row.hour !== null) cut = `hora [${String(row.hour).padStart(2, "0")}:00, ${String(row.hour + 1).padStart(2, "0")}:00)`;
  else {
    try { cut = (row.window_to ?? row.date) < businessDate(new Date(row.audit_at), row.source_timezone) ? "días cerrados" : "día en curso; corte N/D"; }
    catch { cut = "corte N/D"; }
  }
  return `${period} · ${cut} · ${text(row.source_timezone)}`;
}

function counts(rows: AbsoluteTopEvaluation[]) {
  const count = (state: AbsoluteTopEvaluation["state"]) => rows.filter(row => row.state === state).length;
  return `${rows.length} analizadas · ${count("meets")} cumplen · ${count("near")} cerca · ${count("below")} fuera · ${count("insufficient") + count("unclassified")} insuficientes/sin clasificar`;
}

/** Stored entity states are quoted, never recalculated. Campaigns and groups remain separate. */
export function buildAbsoluteTopDomainText(summary: AbsoluteTopDomainSummary, rows: AbsoluteTopEvaluation[]): string {
  const selected = rows.filter(row => row.domain_id === summary.domain_id);
  const campaigns = selected.filter(row => row.level === "campaign");
  const groups = selected.filter(row => row.level === "ad_group");
  const sameScope = summary.campaigns === campaigns.length && summary.ad_groups === groups.length;
  const contexts = new Map<string, { name: string; measurements: Map<string, AbsoluteTopEvaluation> }>();
  for (const row of selected) {
    const account = contexts.get(row.customer_id) ?? { name: row.account_name, measurements: new Map() };
    account.measurements.set(`${row.audit_id}|${row.audit_at}|${window(row)}|${row.coverage}`, row);
    contexts.set(row.customer_id, account);
  }
  const windows = new Set(selected.map(window));
  const campaignWindows = new Set(campaigns.map(window));
  const auditTimes = new Set(selected.map(row => row.audit_at));
  const mixedWindows = windows.size > 1;
  const coverage = ["complete", "partial", "unavailable"].map(status => `${selected.filter(row => row.coverage === status).length} ${ABSOLUTE_TOP_COVERAGE_LABEL[status as AbsoluteTopEvaluation["coverage"]].toLowerCase()}`).join(" · ");
  const affected = (items: AbsoluteTopEvaluation[]) => items.filter(row => row.state === "below" || row.state === "near" || row.sudden_drop).sort((a, b) => b.severity_score - a.severity_score || (a.gap_pp ?? Infinity) - (b.gap_pp ?? Infinity) || a.entity_key.localeCompare(b.entity_key));
  const principal = (items: AbsoluteTopEvaluation[], level: string): string[] => {
    const list = affected(items);
    return list.length ? [level, ...list.slice(0, 5).map(row => `- ${text(row.level === "campaign" ? row.campaign_name : row.ad_group_name)}${row.level === "ad_group" ? ` → ${text(row.campaign_name)}` : ""} · ${text(row.account_name)} (${text(row.customer_id)}) · Abs. Top ${rate(row.absolute_top_rate)} · objetivo ${rate(row.target_rate)} · brecha ${gap(row.gap_pp)} · prioridad ${score(row.severity_score)} · ${ABSOLUTE_TOP_STATE_LABEL[row.state]}${row.sudden_drop ? " · deterioro preventivo" : ""}`), ...(list.length > 5 ? [`Se muestran 5 de ${list.length} afectaciones de este nivel, por prioridad.`] : [])] : [`${level}: sin afectaciones evaluadas en el detalle disponible.`];
  };
  return [
    "Google Ads · izzi · Resumen Absolute Top",
    text(summary.domain_name),
    `Objetivo mínimo del dominio: ${rate(summary.target_rate)}`,
    `Campañas: ${counts(campaigns)}`,
    `Grupos de anuncios: ${counts(groups)}`,
    ...(!selected.length ? ["No hay detalle de auditorías para este dominio. Los estados y la cobertura permanecen N/D; no significa cumplimiento."] : []),
    ...(!sameScope ? ["El detalle no coincide con el alcance del resumen agregado. Los conteos anteriores corresponden únicamente al detalle disponible."] : []),
    `Cobertura por entidad: ${selected.length ? coverage : "N/D"}`,
    `Métrica Absolute Top N/D: ${selected.filter(row => rate(row.absolute_top_rate) === "N/D").length} entidades. Datos ausentes nunca se convierten en cero.`,
    `Abs. Top ponderado del dominio: ${campaignWindows.size > 1 || !selected.length || !sameScope ? "N/D" : rate(summary.weighted_absolute_top)} · indicador aproximado por impresiones de campañas; no se vuelven a sumar sus grupos.`,
    ...(mixedWindows ? ["Hay ventanas o cortes distintos entre las mediciones. Consulta el contexto por cuenta antes de compararlas."] : []),
    ...(campaignWindows.size > 1 ? ["Las campañas no corresponden a una ventana común: el ponderado del dominio permanece N/D."] : []),
    `Cumplimiento entre entidades evaluables del resumen: ${selected.length && sameScope ? rate(summary.compliance_rate) : "N/D"}. Campañas y grupos se evalúan por separado; un agregado favorable no oculta entidades fuera del objetivo.`,
    "",
    "Contexto de lectura por cuenta:",
    ...[...contexts.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, account]) => [
      `- ${text(account.name)} (${text(id)})`,
      ...[...account.measurements.values()].map(row => `  Ventana: ${window(row)} · auditoría ${text(row.audit_id)} · ${instant(row.audit_at)} · cobertura ${ABSOLUTE_TOP_COVERAGE_LABEL[row.coverage].toLowerCase()}`),
    ]),
    ...(!contexts.size ? ["N/D: no existe una lectura por cuenta en el detalle."] : []),
    ...(contexts.size > 1 && auditTimes.size > 1 ? ["Las cuentas tienen instantes de auditoría distintos, incluso si comparten la fecha final del reporte. Este resumen reúne lecturas almacenadas y no confirma una medición simultánea."] : []),
    "",
    ...principal(campaigns, "Principales campañas afectadas (hasta 5)"),
    ...principal(groups, "Principales grupos afectados (hasta 5)"),
    "",
    "Texto para revisión y envío manual. No envía mensajes a WhatsApp ni Slack ni modifica campañas o presupuestos.",
  ].join("\n");
}
