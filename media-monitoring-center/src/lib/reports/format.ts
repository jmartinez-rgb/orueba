import type { ReportData, ReportOptions, ReportStatus } from "./types";
import { STATUS_EMOJI } from "./types";

/**
 * Arma el mensaje de monitoreo con el formato que usa el equipo en WhatsApp.
 * Es texto plano: se revisa, se edita si hace falta y se envía manualmente.
 */

export function joinEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** "izzi - móvil - mxn" → "móvil - mxn" (en los párrafos se usan nombres cortos). */
export function shortAccount(name: string): string {
  return name.replace(/^izzi\s*[–-]\s*/i, "").replace(/^izzi\s+/i, "").trim() || name;
}

const fmtInt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

export function statusOf(key: string, auto: ReportStatus, options: ReportOptions): ReportStatus {
  return options.overrides[key] ?? auto;
}

export function buildReportMessage(data: ReportData, options: ReportOptions): string {
  const e = (s: ReportStatus) => STATUS_EMOJI[s];
  const selected = data.platforms.filter((p) => options.platforms.includes(p.platform));
  const out: string[] = [];
  out.push(`${data.greeting} equipo, comparto el monitoreo:`, "");
  out.push(`${e(statusOf("budget", data.budget.status, options))}Presupuesto y Línea de crédito`);
  out.push(`${e(statusOf("problems", data.platformProblems.status, options))}Problemas con Plataformas`);
  for (const p of selected) {
    out.push(`${e(statusOf(`active:${p.platform}`, p.activeStatus, options))}Campañas activas en ${p.name}`);
    out.push(`${e(statusOf(`conv:${p.platform}`, p.conversionStatus, options))}Fluctuación de Conversiones en ${p.name}`);
  }
  for (const p of selected.filter((x) => data.accountBreakdown.includes(x.platform))) {
    for (const a of p.conversionsByAccount) {
      out.push(`👥 ${p.metricLabel} en ${p.name} al momento en ${a.account}: ${a.value === null ? "sin dato" : fmtInt.format(Math.round(a.value))}`);
    }
  }
  for (const c of data.manualChecks) out.push(`${e(statusOf(`manual:${c.id}`, "ok", options))}${c.label}`);
  if (options.includeConfidence) out.push(`🛡️ Confianza de los datos: ${data.confidence}%`);

  // Detalle de lo que no está en verde.
  const detail: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (statusOf("budget", data.budget.status, options) !== "ok" && data.budget.details.length) {
    detail.push("", "", `${e(statusOf("budget", data.budget.status, options))} Presupuesto y Línea de crédito`, "");
    for (const d of data.budget.details) detail.push(`* ${d}`);
  }
  if (statusOf("problems", data.platformProblems.status, options) !== "ok" && data.platformProblems.details.length) {
    detail.push("", "", `${e(statusOf("problems", data.platformProblems.status, options))} Problemas con Plataformas`, "");
    for (const d of data.platformProblems.details) detail.push(`* ${d}`);
  }
  for (const p of selected) {
    const st = statusOf(`active:${p.platform}`, p.activeStatus, options);
    if (st !== "ok") {
      const lines: string[] = [];
      if (p.dataIssue) lines.push(`* Datos atrasados: ${p.dataIssue} No se evalúa el gasto hasta que se actualice.`);
      for (const inc of p.criticalIncidents) lines.push(`* Incidente crítico: ${inc}.`);
      if (p.spendLowerVsLastWeek.length) {
        const names = joinEs(p.spendLowerVsLastWeek.map(shortAccount));
        lines.push(p.spendLowerVsLastWeek.length === 1 ? `* La cuenta ${names} presenta una disminución en el gasto frente a la semana pasada.` : `* Las cuentas ${names} presentan una disminución en el gasto frente a la semana pasada.`);
      }
      if (p.spendHigherVsLastWeek.length) lines.push(`* Respecto a la semana pasada se presenta un incremento fuerte en gasto para ${joinEs(p.spendHigherVsLastWeek.map(shortAccount))}.`);
      if (p.spendLowerVsYesterday.length) {
        const names = joinEs(p.spendLowerVsYesterday.map(shortAccount));
        lines.push(p.spendLowerVsYesterday.length === 1 ? `* La cuenta ${names} presenta una disminución fuerte de gasto en comparación con el día de ayer.` : `* Las cuentas ${names} presentan una disminución fuerte de gasto en comparación con el día de ayer.`);
      }
      const zeroByAccount = new Map<string, string[]>();
      for (const z of p.zeroSpend) zeroByAccount.set(z.account, [...(zeroByAccount.get(z.account) ?? []), z.campaign]);
      for (const [account, camps] of zeroByAccount) {
        lines.push(camps.length === 1 ? `En la cuenta de ${shortAccount(account)}, la campaña ${camps[0]} no presenta gasto de momento.` : `En la cuenta de ${shortAccount(account)}, las campañas ${joinEs(camps)} no presentan gasto de momento.`);
      }
      if (p.campaignsHigherVsYesterday.length) {
        lines.push("Las campañas/cuentas que presentan un mayor gasto respecto al día de ayer:");
        for (const g of p.campaignsHigherVsYesterday) lines.push(`* - ${g.campaigns.join(", ")} de ${g.account}`);
      }
      if (!lines.length && p.engineSeverity !== "NORMAL") lines.push("* El monitoreo marca variaciones en esta plataforma; revisar el detalle en el Monitoring Center.");
      detail.push("", "", `${e(st)} Campañas activas en ${p.name}`, "", ...lines);
      if (p.campaignsHigherVsYesterday.length && data.closingNote.trim()) detail.push("", data.closingNote.replace("{umbral}", pct(data.thresholds.spendIncreaseVsYesterday)));
    }
    const cst = statusOf(`conv:${p.platform}`, p.conversionStatus, options);
    if (cst !== "ok") {
      const both = p.conversionDropVsLastWeek.filter((a) => p.conversionDropVsYesterday.includes(a));
      const onlyLW = p.conversionDropVsLastWeek.filter((a) => !both.includes(a));
      const onlyY = p.conversionDropVsYesterday.filter((a) => !both.includes(a));
      const lines: string[] = [];
      const label = p.metricLabel.toLowerCase();
      if (both.length) lines.push(`Respecto al ${data.lastWeekDay} pasado y al día de ayer, se presenta una disminución fuerte en ${label} para ${joinEs(both.map(shortAccount))}.`);
      if (onlyLW.length) lines.push(`Respecto al ${data.lastWeekDay} pasado, se presenta una disminución fuerte en ${label} para ${joinEs(onlyLW.map(shortAccount))}.`);
      if (onlyY.length) lines.push(`Respecto al día de ayer, se presenta una disminución fuerte en ${label} para ${joinEs(onlyY.map(shortAccount))}.`);
      if (!lines.length) lines.push(`Se detecta un problema de medición en ${p.name}: revisar el tracking de conversiones.`);
      detail.push("", "", `${e(cst)}Fluctuación de Conversiones en ${p.name}`, "", ...lines);
    }
  }
  return [...out, ...detail].join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

/** Enlace para abrir WhatsApp con el mensaje (el envío lo hace la persona, no la app). */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
