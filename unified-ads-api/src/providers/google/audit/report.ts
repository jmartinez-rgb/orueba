import { BIDDING_LABEL, CHANNEL_LABEL, cpa, cpc, ctr, cvr, delta, salesCpa, type Totals } from "./aggregate.js";
import { byPriority, globalSummary, type AccountAudit } from "./analyze.js";
import { CRITERIA, fmtDelta, fmtMoney, fmtNum, fmtPct, fmtShare } from "./context.js";
import { bySegment } from "./rules-segments.js";
import { CONSULTED_ON, SOURCES, type SourceId } from "./sources.js";
import type { Finding, Risk, SectionKey, WindowKey } from "./types.js";

/**
 * Informe Markdown de la auditoría en el formato del encargo: 22 secciones por cuenta, en orden de
 * prioridad, y el resumen general al final. Sin emojis; montos en la moneda de cada cuenta.
 */

export const formatCustomerId = (id: string) => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
const RISK_LABEL: Record<Risk, string> = { bajo: "BAJO RIESGO", moderado: "RIESGO MODERADO", alto: "ALTO RIESGO" };
const RISK_SHORT: Record<Risk, string> = { bajo: "Bajo", moderado: "Medio", alto: "Alto" };
const WHEN_LABEL = {
  hoy: "Hoy",
  "48h": "Próximas 48 horas",
  semana: "Esta semana",
  no_ejecutar: "No ejecutar todavía",
} as const;
export const SECTION_LABEL: Record<SectionKey, string> = {
  general: "Rendimiento",
  search: "Search",
  pmax: "Performance Max",
  video: "Demand Gen/Video",
  budget: "Presupuesto",
  bidding: "Smart Bidding",
  conversions: "Conversiones",
  terms: "Términos",
  keywords: "Keywords",
  creatives: "Creativos",
  assets: "Assets",
  geo: "Geografía",
  devices: "Dispositivos",
  schedule: "Horarios",
  urls: "URLs",
  changes: "Cambios",
};
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "";
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function sourceLinks(ids: SourceId[]): string {
  return ids.map((id) => `[${SOURCES[id].title}](${SOURCES[id].url})`).join("; ");
}

export function findingBlock(f: Finding): string {
  const lines = [
    `#### HALLAZGO ${f.id}: ${f.title}`,
    "",
    `**CUENTA:** ${formatCustomerId(f.accountId)}  `,
    `**CAMPAÑA:** ${f.campaign}  `,
    `**PRIORIDAD:** ${f.priority} · **CLASIFICACIÓN:** ${RISK_LABEL[f.risk]} · **CONFIANZA:** ${f.confidence} · **CUÁNDO:** ${WHEN_LABEL[f.when]}`,
    "",
    "**EVIDENCIA**",
    ...f.evidence.map((e) => `- ${e}`),
    "",
    `**DIAGNÓSTICO:** ${f.diagnosis}`,
    "",
    `**ACCIÓN RECOMENDADA:** ${f.action}`,
    "",
    "**PASOS**",
    ...f.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `**IMPACTO ESPERADO:** ${f.impact}  `,
    `**RIESGO:** ${RISK_SHORT[f.risk]}  `,
    `**MÉTRICA A MONITOREAR:** ${f.metric}  `,
    `**PERIODO DE OBSERVACIÓN:** ${f.observation}  `,
    `**ROLLBACK:** ${f.rollback}`,
  ];
  if (f.minutes) lines.push("", `**TIEMPO ESTIMADO:** ${f.minutes} min`);
  if (f.rule) lines.push("", `**REGLA DE MONITOREO:** ${f.rule}`);
  if (f.sources.length)
    lines.push("", `**FUENTES** (consultadas el ${CONSULTED_ON}): ${sourceLinks(f.sources as SourceId[])}`);
  return lines.join("\n");
}

const trendRow = (label: string, t: Totals, money: (n: number | null) => string) => [
  label,
  money(t.cost),
  fmtNum(t.impressions),
  fmtNum(t.clicks),
  fmtPct(ctr(t), 2),
  money(cpc(t)),
  fmtNum(t.conversions, 1),
  fmtPct(cvr(t), 2),
  money(cpa(t)),
  fmtNum(t.sales, 1),
  money(salesCpa(t)),
];

function sectionBody(a: AccountAudit, key: SectionKey, extra = ""): string {
  const notes = a.notes[key] ?? [];
  const own = a.findings.filter((f) => f.section === key);
  const top = own.filter((f) => f.priority === "P0" || f.priority === "P1");
  const rest = own.filter((f) => f.priority !== "P0" && f.priority !== "P1");
  const parts: string[] = [];
  if (notes.length) parts.push(notes.map((n) => `- ${n}`).join("\n"));
  if (extra) parts.push(extra);
  if (top.length)
    parts.push(`Hallazgos de esta área ya detallados arriba: ${top.map((f) => `${f.id} (${f.priority})`).join(", ")}.`);
  parts.push(...rest.map(findingBlock));
  if (!parts.length) parts.push("Sin hallazgos en esta área con los datos disponibles.");
  return parts.join("\n\n");
}

export function accountMarkdown(a: AccountAudit): string {
  const { data } = a;
  const id = formatCustomerId(data.target.id);
  const money = (n: number | null) => fmtMoney(n, data.customer?.currency || "MXN");
  const out: string[] = [`# ${data.target.name}`, "", `Customer ID: ${id}`, ""];
  if (a.status !== "ok") {
    out.push(
      `**Sin lectura de la cuenta.** Motivo: ${data.unavailable.map((u) => `${u.section}: ${u.reason}`).join("; ") || "Google no devolvió datos"}.`,
      "",
      "Qué revisar: que la cuenta esté vinculada al MCC configurado en GOOGLE_ADS_LOGIN_CUSTOMER_ID, que el usuario autorizado tenga acceso y que el ID sea correcto. Sin datos no se emiten recomendaciones.",
    );
    return out.join("\n");
  }
  const w = (k: WindowKey) => data.windows.find((x) => x.key === k);
  const acc = a.account;
  const active = a.campaigns.filter((c) => c.info.status === "ENABLED");
  const types = new Map<string, number>();
  for (const c of active)
    types.set(
      CHANNEL_LABEL[c.info.channel] ?? c.info.channel,
      (types.get(CHANNEL_LABEL[c.info.channel] ?? c.info.channel) ?? 0) + 1,
    );
  const counts = (["P0", "P1", "P2", "P3", "P4"] as const)
    .map((p) => `${p} ${a.findings.filter((f) => f.priority === p).length}`)
    .join(", ");
  out.push(
    `Moneda: ${data.customer?.currency} · Zona horaria: ${data.customer?.timeZone ?? "s/d"} · Prioridad del encargo: ${data.target.priority === 1 ? "máxima" : "segunda"} · Último día analizado: ${data.end} · Extracción: ${data.extractedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    "## 1. Estado general",
    "",
    `En los últimos 30 días la cuenta invirtió ${money(acc.L30.cost)} (${fmtDelta(delta(acc.L30.cost, acc.P30.cost))} contra los 30 días previos), con ${fmtNum(acc.L30.conversions, 1)} conversiones (${fmtDelta(delta(acc.L30.conversions, acc.P30.conversions))}) y CPA de ${money(cpa(acc.L30))} (${fmtDelta(delta(cpa(acc.L30), cpa(acc.P30)))}). Ventas (${"MCC_Offline_Purchase"}): ${fmtNum(acc.L30.sales, 1)} (${fmtDelta(delta(acc.L30.sales, acc.P30.sales))}), CPA de venta ${money(salesCpa(acc.L30))}. Campañas habilitadas: ${active.length} (${[...types.entries()].map(([t, n]) => `${t} ${n}`).join(", ") || "ninguna"}). Hallazgos: ${counts}.${data.customer?.optimizationScore !== null && data.customer?.optimizationScore !== undefined ? ` Nivel de optimización de Google: ${fmtPct(data.customer.optimizationScore, 0)} (referencia; las recomendaciones se analizan en la sección 22).` : ""}`,
    "",
    "**Tendencia (WoW, MoM y 7/14/30/90 días).** CPA = suma de costo ÷ suma de conversiones. Ventas = acción MCC_Offline_Purchase.",
    "",
    table(
      ["Ventana", "Gasto", "Impr.", "Clics", "CTR", "CPC", "Conv.", "CVR", "CPA", "Ventas", "CPA venta"],
      (["L7", "P7", "L14", "P14", "L30", "P30", "MTD", "PMTD", "PM", "L90"] as WindowKey[])
        .filter((k) => w(k))
        .map((k) => trendRow(`${w(k)!.label} (${w(k)!.from} a ${w(k)!.to})`, acc[k], money)),
    ),
    "",
    `WoW: gasto ${fmtDelta(delta(acc.L7.cost, acc.P7.cost))}, conversiones ${fmtDelta(delta(acc.L7.conversions, acc.P7.conversions))}, CPA ${fmtDelta(delta(cpa(acc.L7), cpa(acc.P7)))}. MoM (mismos días): gasto ${fmtDelta(delta(acc.MTD.cost, acc.PMTD.cost))}, conversiones ${fmtDelta(delta(acc.MTD.conversions, acc.PMTD.conversions))}.${acc.MTD.days < 7 ? ` El mes actual lleva ${acc.MTD.days} día(s): la comparación mensual aún no es concluyente.` : ""} Las importaciones offline pueden completar los últimos días con retraso.`,
    "",
    "**Mapa de salud de campañas** (habilitadas o con gasto en 30 días)",
    "",
    table(
      [
        "Campaña",
        "Tipo",
        "Estado",
        "Estado principal y motivos",
        "Estrategia (estado)",
        "Presupuesto/día",
        "Gasto 30d",
        "Conv.",
        "CPA",
        "Ventas",
        "Cuota impr. 30d",
      ],
      a.campaigns
        .filter((c) => c.info.status === "ENABLED" || c.w.L30.cost > 0)
        .sort((x, y) => y.w.L30.cost - x.w.L30.cost)
        .map((c) => [
          c.info.name,
          CHANNEL_LABEL[c.info.channel] ?? c.info.channel,
          c.info.status,
          `${c.info.primaryStatus ?? "s/d"}${c.info.reasons.length ? ` (${c.info.reasons.join(", ")})` : ""}`,
          `${BIDDING_LABEL[c.info.bidding ?? ""] ?? c.info.bidding ?? "s/d"}${c.info.targetCpa ? ` tCPA ${money(c.info.targetCpa)}` : ""}${c.info.biddingStatus ? ` (${c.info.biddingStatus})` : ""}`,
          c.info.budget !== null
            ? money(c.info.budget)
            : c.info.budgetTotal !== null
              ? `${money(c.info.budgetTotal)} total`
              : "s/d",
          money(c.w.L30.cost),
          fmtNum(c.w.L30.conversions, 1),
          money(cpa(c.w.L30)),
          fmtNum(c.w.L30.sales, 1),
          c.info.channel === "SEARCH" ? fmtShare(c.shares.L30?.impressionShare ?? null) : "n/a",
        ]),
    ),
  );
  if (a.notes.general?.length) out.push("", ...a.notes.general.map((n) => `- ${n}`));
  if (data.unavailable.length || data.truncated.length)
    out.push(
      "",
      `**Datos no disponibles:** ${[...data.unavailable.map((u) => `${u.section} (${u.reason})`), ...data.truncated.map((t) => `${t} (recortado al límite de filas)`)].join("; ")}.`,
    );

  const main = [...a.findings].sort(byPriority).slice(0, 6);
  out.push(
    "",
    "## 2. Principales hallazgos",
    "",
    main.length
      ? main
          .map(
            (f) =>
              `- **${f.id}** (${f.priority}, ${RISK_SHORT[f.risk].toLowerCase()} riesgo, confianza ${f.confidence}) · ${f.campaign}: ${f.title}.`,
          )
          .join("\n")
      : "Sin hallazgos con los datos disponibles.",
  );
  const general = a.findings.filter((f) => f.section === "general" && f.priority !== "P0" && f.priority !== "P1");
  if (general.length) out.push("", ...general.map(findingBlock));
  const p0 = a.findings.filter((f) => f.priority === "P0");
  out.push(
    "",
    "## 3. P0 — Errores críticos",
    "",
    p0.length ? p0.map(findingBlock).join("\n\n") : "Sin errores críticos detectados.",
  );
  out.push(
    "",
    "## 4. P1 — Quick Wins",
    "",
    "Hasta 10 acciones de bajo riesgo y evidencia suficiente (incluye los errores P0 que se corrigen rápido).",
    "",
    a.quickWins.length
      ? table(
          ["#", "Prioridad", "Campaña", "Problema", "Evidencia", "Acción", "Riesgo", "Tiempo", "Métrica a vigilar"],
          a.quickWins.map((f, i) => [
            String(i + 1),
            f.priority,
            f.campaign,
            `${f.id}: ${f.title}`,
            f.evidence[0] ?? "",
            f.action,
            RISK_SHORT[f.risk],
            f.minutes ? `${f.minutes} min` : "s/d",
            f.metric,
          ]),
        )
      : "Sin quick wins que cumplan bajo riesgo y evidencia suficiente.",
  );
  const p1 = a.findings.filter((f) => f.priority === "P1");
  if (p1.length) out.push("", ...p1.map(findingBlock));

  const conversionsTable = table(
    ["Acción", "Tipo", "Categoría", "Primaria", "Conteo", "Ventana clic", "Atribución", "Dueño"],
    data.conversionActions
      .filter((c) => c.status === "ENABLED")
      .map((c) => [
        c.name,
        c.type,
        c.category ?? "s/d",
        c.primary === null ? "s/d" : c.primary ? "Sí" : "No",
        c.counting ?? "s/d",
        c.clickWindowDays ? `${c.clickWindowDays} días` : "s/d",
        c.attribution ?? "s/d",
        c.owner === "manager" ? "MCC" : "Cuenta",
      ]),
  );
  const geo = bySegment(data.geo).slice(0, 15);
  const geoTotal = data.geo.reduce((s, g) => s + g.cost, 0);
  const geoTable = table(
    ["Región", "Gasto", "% gasto", "Conv.", "CPA"],
    geo.map((g) => [
      g.key,
      money(g.cost),
      fmtPct(geoTotal > 0 ? g.cost / geoTotal : null, 0),
      fmtNum(g.conversions, 1),
      money(cpa(g)),
    ]),
  );
  const devTable = table(
    ["Dispositivo", "Gasto", "CTR", "CPC", "CVR", "CPA", "Conv."],
    bySegment(data.devices).map((d) => [
      d.key,
      money(d.cost),
      fmtPct(ctr(d), 2),
      money(cpc(d)),
      fmtPct(cvr(d), 2),
      money(cpa(d)),
      fmtNum(d.conversions, 1),
    ]),
  );
  const urlTable = table(
    ["URL", "Resultado", "HTTP", "Redirige a"],
    data.urlChecks
      .filter((u) => u.outcome !== "ok")
      .map((u) => [u.url, u.outcome, String(u.status ?? "s/d"), u.location ?? ""]),
  );
  const changeBlocks = a.changes
    .map((c) =>
      [
        `**Cambio detectado**`,
        `- Fecha: ${c.date}`,
        `- Elemento: ${c.element} · ${c.campaign}`,
        `- Cambio: ${c.change}`,
        `- Performance antes (7 días): ${c.before}`,
        `- Performance después: ${c.after}`,
        `- Conclusión: ${c.conclusion}`,
      ].join("\n"),
    )
    .join("\n\n");
  const sections: Array<[string, SectionKey, string]> = [
    ["5. Search", "search", ""],
    ["6. Performance Max", "pmax", ""],
    ["7. Demand Gen / Display / Video", "video", ""],
    ["8. Presupuesto", "budget", ""],
    ["9. Smart Bidding", "bidding", ""],
    [
      "10. Conversiones",
      "conversions",
      conversionsTable ? `**Acciones de conversión habilitadas**\n\n${conversionsTable}` : "",
    ],
    ["11. Search Terms", "terms", ""],
    ["12. Keywords", "keywords", ""],
    ["13. Creativos", "creatives", ""],
    ["14. Assets", "assets", ""],
    ["15. Geografía", "geo", geoTable ? `**Ubicación física, 30 días (principales regiones)**\n\n${geoTable}` : ""],
    ["16. Dispositivos", "devices", devTable ? `**Dispositivos, 30 días**\n\n${devTable}` : ""],
    ["17. Horarios", "schedule", ""],
    ["18. URLs / Landing Pages", "urls", urlTable ? `**URLs con observaciones**\n\n${urlTable}` : ""],
    ["19. Cambios recientes", "changes", changeBlocks],
  ];
  for (const [title, key, extra] of sections) out.push("", `## ${title}`, "", sectionBody(a, key, extra));

  out.push(
    "",
    "## 20. No tocar todavía",
    "",
    table(
      ["Campaña", "Qué no tocar", "Motivo"],
      a.holds.map((h) => [h.campaign, h.item, h.reason]),
    ) || "Sin restricciones adicionales.",
    "",
    "## 21. Experimentos recomendados",
    "",
    a.experiments.length
      ? table(
          ["Hallazgo", "Campaña", "Hipótesis", "Diseño", "Duración", "Métrica"],
          a.experiments.map((f) => [
            f.id,
            f.campaign,
            f.experiment!.hypothesis,
            f.experiment!.design,
            f.experiment!.duration,
            f.metric,
          ]),
        )
      : "Sin experimentos propuestos: primero se ejecutan las correcciones y quick wins.",
    "",
    "## 22. Plan de acción",
    "",
    table(
      ["Prioridad", "Campaña", "Área", "Hallazgo", "Acción", "Riesgo", "Impacto", "Confianza", "Tiempo"],
      a.findings.map((f) => [
        f.priority,
        f.campaign,
        SECTION_LABEL[f.section],
        `${f.id}: ${f.title}`,
        f.action,
        RISK_SHORT[f.risk],
        f.impact,
        f.confidence,
        f.minutes ? `${f.minutes} min` : "s/d",
      ]),
    ) || "Sin acciones.",
    "",
    "### Orden de ejecución",
  );
  for (const when of ["hoy", "48h", "semana", "no_ejecutar"] as const) {
    const list = a.findings.filter((f) => f.when === when);
    out.push(
      "",
      `**${WHEN_LABEL[when].toUpperCase()}**`,
      "",
      list.length ? list.map((f) => `- ${f.id} · ${f.campaign}: ${f.action}`).join("\n") : "- Nada en esta ventana.",
    );
  }
  out.push(
    "",
    "Regla de no sobreoptimización: un cambio de riesgo moderado por campaña a la vez, documentado con antes, cambio, fecha, motivo, base, resultado esperado y ventana de evaluación.",
  );
  if (a.recommendations.length)
    out.push(
      "",
      "### Recomendaciones de Google (analizadas, no aplicadas a ciegas)",
      "",
      table(
        ["Tipo", "Cantidad", "Campañas", "Veredicto", "Motivo"],
        a.recommendations.map((r) => [r.type, String(r.count), r.campaigns || "Cuenta", r.verdict, r.reason]),
      ),
    );
  const q = a.answers;
  const list = (items: string[], empty: string) =>
    items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
  out.push(
    "",
    "### Respuesta final",
    "",
    "**¿Qué está bien y no debemos tocar?**",
    list(q.good, "s/d"),
    "",
    "**¿Qué podemos mejorar de forma segura?**",
    list(q.safe, "Nada adicional con evidencia suficiente."),
    "",
    "**¿Qué error debemos corregir?**",
    list(q.errors, "Sin errores críticos."),
    "",
    "**¿Dónde estamos perdiendo eficiencia?**",
    list(q.efficiency, "Sin pérdidas cuantificables con los datos disponibles."),
    "",
    "**¿Qué podemos ejecutar hoy?**",
    list(q.today, "Nada urgente."),
    "",
    "**¿Qué debemos probar después?**",
    list(q.later, "Sin pruebas propuestas."),
    "",
    "**¿Qué requiere mayor análisis antes de tocarlo?**",
    list(q.analysis, "Nada pendiente de análisis."),
  );
  return out.join("\n");
}

export function auditMarkdown(audits: AccountAudit[], meta: { generatedAt: string; version: string }): string {
  const g = globalSummary(audits);
  const line = (f: Finding) =>
    `${f.id} · ${audits.find((a) => a.data.target.id === f.accountId)?.data.target.name ?? f.accountId} · ${f.campaign}: ${f.title}`;
  const money = (f: Finding) =>
    fmtMoney(f.stake, audits.find((a) => a.data.target.id === f.accountId)?.data.customer?.currency || "MXN");
  const parts = [
    "# Auditoría de Google Ads — cuenta por cuenta",
    "",
    `Generado: ${meta.generatedAt} · Google Ads API ${meta.version} · Modalidad: SOLO LECTURA (no se modificó nada en las cuentas).`,
    "",
    "Orden: máxima prioridad (Performance AO, Performance AO 2, Ofertas, Paquetes 2do Dominio) y después segunda prioridad (Apple TV, campañas, Universal+, Sky). Cada cuenta se diagnostica por separado; el resumen general va al final.",
    "",
    "Clasificación de riesgo: BAJO RIESGO (no afecta el aprendizaje), RIESGO MODERADO (puede mover la entrega), ALTO RIESGO (estructural). Prioridades: P0 error crítico, P1 quick win, P2 optimización, P3 prueba, P4 estructural.",
    "",
    ...audits.flatMap((a) => [accountMarkdown(a), "", "---", ""]),
    "# GOOGLE ADS AUDIT — RESUMEN GENERAL",
    "",
    "## TOP 10 OPORTUNIDADES",
    "",
    g.opportunities.length
      ? g.opportunities.map((f, i) => `${i + 1}. ${line(f)} (gasto relacionado ${money(f)})`).join("\n")
      : "Sin oportunidades con evidencia suficiente.",
    "",
    "## TOP 10 QUICK WINS",
    "",
    g.quickWins.length ? g.quickWins.map((f, i) => `${i + 1}. ${line(f)} → ${f.action}`).join("\n") : "Sin quick wins.",
    "",
    "## PRINCIPALES ERRORES",
    "",
    g.errors.length ? g.errors.map((f) => `- ${line(f)}`).join("\n") : "- Sin errores críticos.",
    "",
    "## PRINCIPALES RIESGOS",
    "",
    g.risks.length ? g.risks.map((r) => `- ${r}`).join("\n") : "- Sin riesgos estructurales identificados.",
    "",
    "## CAMBIOS QUE NO DEBEMOS REALIZAR TODAVÍA",
    "",
    g.holds.length ? g.holds.map((h) => `- ${h}`).join("\n") : "- Sin restricciones.",
    "",
    "## Reglas propuestas para el sistema de monitoreo",
    "",
    table(
      ["Regla", "Condición → acción", "Cuentas donde ya aplica"],
      g.rules.map((r) => [r.id, r.rule, r.accounts.join(", ") || "—"]),
    ),
    "",
    "## Criterios de revisión",
    "",
    `- Cambio material: ${fmtPct(CRITERIA.materialChange, 0)}; significancia estadística p < ${CRITERIA.significance} (Poisson para conversiones, prueba de proporciones para CTR y CVR, con corrección por comparaciones múltiples en geografía y horarios).`,
    `- Volumen mínimo para concluir: ${CRITERIA.minImpressions} impresiones, ${CRITERIA.minClicks} clics o ${CRITERIA.minConversions} conversiones en la ventana base.`,
    `- Del encargo: CPA × ${CRITERIA.cpaAlertRatio} y cuota perdida por presupuesto > ${fmtPct(CRITERIA.lostBudgetAlert, 0)}. Pasos graduales: presupuesto ${CRITERIA.budgetStepPct}%, objetivo ${CRITERIA.targetStepPct}%.`,
    "- Reglas de la cuenta: CPA = suma/suma; ventas = MCC_Offline_Purchase; eventos offline válidos solo MCC_Offline_Lead_Contact y MCC_Offline_Purchase; no se eligen acciones primarias.",
    "",
    "## Fuentes oficiales",
    "",
    `Consultadas el ${CONSULTED_ON}. Las páginas de ayuda se consultaron por búsqueda restringida a dominios de Google porque la salida directa estaba bloqueada en el entorno de desarrollo; el documento de descubrimiento v25 se leyó completo.`,
    "",
    ...Object.values(SOURCES).map((s) => `- [${s.title}](${s.url}) · ${s.type} · consulta ${s.method}`),
  ];
  return parts.join("\n") + "\n";
}
