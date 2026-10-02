import type { Cell, XlsxSheet } from "../../../utils/xlsx.js";
import { cpa, delta, salesCpa } from "./aggregate.js";
import type { AccountAudit } from "./analyze.js";
import { actionStatsFor } from "./rules-measurement.js";
import { intentCandidates, plain } from "./rules-search.js";
import { bySegment } from "./rules-segments.js";
import { formatCustomerId, SECTION_LABEL } from "./report.js";
import type { WindowKey } from "./types.js";

/** Libro de evidencia: lo que respalda cada hallazgo, para filtrar y compartir. */
export function auditWorkbook(audits: AccountAudit[], meta: { generatedAt: string; version: string }): XlsxSheet[] {
  const name = (a: AccountAudit) => a.data.target.name;
  const tone = (n: number | null, goodWhenUp: boolean): Cell =>
    n === null ? null : { value: n, pct: true, tone: n === 0 ? undefined : n > 0 === goodWhenUp ? "good" : "bad" };
  const priorityTone = (p: string): Cell => ({ value: p, tone: p === "P0" ? "bad" : p === "P1" ? "warn" : undefined });
  return [
    {
      name: "Resumen",
      columns: [
        { header: "Cuenta", width: 34 },
        { header: "Customer ID", width: 14 },
        { header: "Prioridad", width: 10 },
        { header: "Lectura", width: 12 },
        { header: "Moneda", width: 8 },
        { header: "Gasto 30d", width: 14 },
        { header: "Δ gasto", width: 10, pct: true },
        { header: "Conversiones 30d", width: 14 },
        { header: "CPA 30d", width: 12 },
        { header: "Δ CPA", width: 10, pct: true },
        { header: "Ventas 30d", width: 12 },
        { header: "CPA venta", width: 12 },
        { header: "P0", width: 6 },
        { header: "P1", width: 6 },
        { header: "P2", width: 6 },
        { header: "P3", width: 6 },
        { header: "P4", width: 6 },
        { header: "Quick wins", width: 10 },
        { header: "Secciones sin datos", width: 40 },
      ],
      rows: [
        ...audits.map((a): Cell[] => {
          const t = a.account;
          const count = (p: string) => a.findings.filter((f) => f.priority === p).length;
          return [
            name(a),
            formatCustomerId(a.data.target.id),
            a.data.target.priority === 1 ? "Máxima" : "Segunda",
            a.status,
            a.data.customer?.currency ?? "",
            t?.L30.cost ?? null,
            t ? tone(delta(t.L30.cost, t.P30.cost), true) : null,
            t?.L30.conversions ?? null,
            t ? cpa(t.L30) : null,
            t ? tone(delta(cpa(t.L30), cpa(t.P30)), false) : null,
            t?.L30.sales ?? null,
            t ? salesCpa(t.L30) : null,
            count("P0"),
            count("P1"),
            count("P2"),
            count("P3"),
            count("P4"),
            a.quickWins.length,
            a.data.unavailable.map((u) => u.section).join(", "),
          ];
        }),
        [],
        [`Generado ${meta.generatedAt} · Google Ads API ${meta.version} · solo lectura`],
      ],
    },
    {
      name: "Hallazgos",
      columns: [
        { header: "ID", width: 9 },
        { header: "Cuenta", width: 28 },
        { header: "Campaña", width: 30 },
        { header: "Área", width: 12 },
        { header: "Prioridad", width: 9 },
        { header: "Riesgo", width: 10 },
        { header: "Confianza", width: 10 },
        { header: "Cuándo", width: 12 },
        { header: "Hallazgo", width: 50 },
        { header: "Acción", width: 60 },
        { header: "Impacto", width: 40 },
        { header: "Métrica", width: 30 },
        { header: "Observación", width: 18 },
        { header: "Rollback", width: 30 },
        { header: "Gasto relacionado 30d", width: 16 },
        { header: "Gasto recuperable estimado 30d", width: 18 },
        { header: "Regla", width: 14 },
        { header: "Evidencia", width: 80 },
      ],
      rows: audits.flatMap((a) =>
        a.findings.map((f): Cell[] => [
          f.id,
          name(a),
          f.campaign,
          SECTION_LABEL[f.section],
          priorityTone(f.priority),
          f.risk,
          f.confidence,
          f.when,
          f.title,
          f.action,
          f.impact,
          f.metric,
          f.observation,
          f.rollback,
          f.stake || null,
          f.waste ?? null,
          f.rule ?? "",
          f.evidence.join(" | "),
        ]),
      ),
    },
    {
      name: "Campañas",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Campaña", width: 36 },
        { header: "ID", width: 14 },
        { header: "Tipo", width: 14 },
        { header: "Estado", width: 10 },
        { header: "Estado principal", width: 14 },
        { header: "Motivos", width: 30 },
        { header: "Estrategia", width: 22 },
        { header: "Estado estrategia", width: 20 },
        { header: "tCPA", width: 10 },
        { header: "Presupuesto/día", width: 12 },
        { header: "Gasto 30d", width: 12 },
        { header: "Δ gasto", width: 9, pct: true },
        { header: "Conv. 30d", width: 10 },
        { header: "CPA 30d", width: 10 },
        { header: "Δ CPA", width: 9, pct: true },
        { header: "Ventas 30d", width: 10 },
        { header: "CPA venta", width: 10 },
        { header: "Cuota impr. 30d", width: 10, pct: true },
        { header: "Perdida presupuesto", width: 10, pct: true },
        { header: "Perdida ranking", width: 10, pct: true },
        { header: "Días sin gasto", width: 9 },
      ],
      rows: audits.flatMap((a) =>
        a.campaigns
          .filter((c) => c.info.status === "ENABLED" || c.w.L30.cost > 0)
          .map((c): Cell[] => [
            name(a),
            c.info.name,
            c.info.id,
            c.info.channel,
            c.info.status,
            c.info.primaryStatus ?? "",
            c.info.reasons.join(", "),
            c.info.bidding ?? "",
            c.info.biddingStatus ?? "",
            c.info.targetCpa,
            c.info.budget,
            c.w.L30.cost,
            tone(delta(c.w.L30.cost, c.w.P30.cost), true),
            c.w.L30.conversions,
            cpa(c.w.L30),
            tone(delta(cpa(c.w.L30), cpa(c.w.P30)), false),
            c.w.L30.sales,
            salesCpa(c.w.L30),
            c.shares.L30?.impressionShare ?? null,
            c.shares.L30?.lostBudget ?? null,
            c.shares.L30?.lostRank ?? null,
            c.zeroDays,
          ]),
      ),
    },
    {
      name: "Tendencia",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Ventana", width: 30 },
        { header: "Desde", width: 11 },
        { header: "Hasta", width: 11 },
        { header: "Gasto", width: 12 },
        { header: "Impresiones", width: 12 },
        { header: "Clics", width: 10 },
        { header: "Conversiones", width: 12 },
        { header: "CPA", width: 10 },
        { header: "Ventas", width: 10 },
        { header: "Leads", width: 10 },
        { header: "CPA venta", width: 10 },
      ],
      rows: audits.flatMap((a) =>
        a.data.windows.map((w): Cell[] => {
          const t = a.account[w.key as WindowKey];
          return [
            name(a),
            w.label,
            w.from,
            w.to,
            t.cost,
            t.impressions,
            t.clicks,
            t.conversions,
            cpa(t),
            t.sales,
            t.leads,
            salesCpa(t),
          ];
        }),
      ),
    },
    {
      name: "Términos candidatos",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Campaña", width: 32 },
        { header: "Término", width: 40 },
        { header: "Categoría", width: 22 },
        { header: "Confianza", width: 10 },
        { header: "Gasto 30d", width: 12 },
        { header: "Clics", width: 8 },
        { header: "Impresiones", width: 12 },
      ],
      rows: audits.flatMap((a) =>
        intentCandidates(a.data)
          .sort((x, y) => y.cost - x.cost)
          .map((t): Cell[] => [
            name(a),
            a.campaigns.find((c) => c.info.id === t.campaignId)?.info.name ?? t.campaignId,
            t.term,
            t.category.label,
            t.category.confidence,
            t.cost,
            t.clicks,
            t.impressions,
          ]),
      ),
    },
    {
      name: "RSA",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Campaña", width: 30 },
        { header: "Grupo", width: 30 },
        { header: "Anuncio", width: 14 },
        { header: "Títulos", width: 8 },
        { header: "Descripciones", width: 12 },
        { header: "Títulos fijados", width: 12 },
        { header: "Títulos repetidos", width: 12 },
        { header: "Ad Strength", width: 12 },
        { header: "Aprobación", width: 14 },
        { header: "Gasto 30d", width: 12 },
        { header: "Conv. 30d", width: 10 },
      ],
      rows: audits.flatMap((a) =>
        a.data.ads
          .filter((ad) => ad.type === "RESPONSIVE_SEARCH_AD")
          .sort((x, y) => y.cost - x.cost)
          .map((ad): Cell[] => [
            name(a),
            a.campaigns.find((c) => c.info.id === ad.campaignId)?.info.name ?? ad.campaignId,
            ad.adGroup,
            ad.adId,
            ad.headlines.length,
            ad.descriptions.length,
            ad.headlines.filter((h) => h.pinned).length,
            ad.headlines.length - new Set(ad.headlines.map((h) => plain(h.text))).size,
            ad.strength ?? "",
            ad.approval ?? "",
            ad.cost,
            ad.conversions,
          ]),
      ),
    },
    {
      name: "Conversiones",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Acción", width: 36 },
        { header: "Estado", width: 10 },
        { header: "Tipo", width: 20 },
        { header: "Categoría", width: 18 },
        { header: "Origen", width: 14 },
        { header: "Primaria", width: 9 },
        { header: "En Conversiones", width: 12 },
        { header: "Conteo", width: 16 },
        { header: "Ventana clic (días)", width: 12 },
        { header: "Atribución", width: 22 },
        { header: "Dueño", width: 9 },
        { header: "Conv. 30d", width: 10 },
        { header: "Conv. 30d previos", width: 12 },
      ],
      rows: audits.flatMap((a) => {
        const stats = actionStatsFor(a.data);
        return a.data.conversionActions.map((c): Cell[] => [
          name(a),
          c.name,
          c.status,
          c.type,
          c.category ?? "",
          c.origin ?? "",
          c.primary === null ? "" : c.primary ? "Sí" : "No",
          c.included === null ? "" : c.included ? "Sí" : "No",
          c.counting ?? "",
          c.clickWindowDays,
          c.attribution ?? "",
          c.owner === "manager" ? "MCC" : "Cuenta",
          stats.get(c.name)?.l30 ?? 0,
          stats.get(c.name)?.p30 ?? 0,
        ]);
      }),
    },
    {
      name: "Geografía",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Región", width: 28 },
        { header: "Gasto 30d", width: 12 },
        { header: "Clics", width: 10 },
        { header: "Conversiones", width: 12 },
        { header: "CPA", width: 10 },
      ],
      rows: audits.flatMap((a) =>
        bySegment(a.data.geo).map((g): Cell[] => [name(a), g.key, g.cost, g.clicks, g.conversions, cpa(g)]),
      ),
    },
    {
      name: "Cambios",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Fecha", width: 11 },
        { header: "Campaña", width: 30 },
        { header: "Elemento", width: 16 },
        { header: "Cambio", width: 50 },
        { header: "Antes (7 días)", width: 40 },
        { header: "Después", width: 40 },
        { header: "Conclusión", width: 40 },
      ],
      rows: audits.flatMap((a) =>
        a.changes.map((c): Cell[] => [
          name(a),
          c.date,
          c.campaign,
          c.element,
          c.change,
          c.before,
          c.after,
          c.conclusion,
        ]),
      ),
    },
    {
      name: "Recomendaciones Google",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Tipo", width: 36 },
        { header: "Cantidad", width: 9 },
        { header: "Campañas", width: 40 },
        { header: "Veredicto", width: 16 },
        { header: "Motivo", width: 60 },
      ],
      rows: audits.flatMap((a) =>
        a.recommendations.map((r): Cell[] => [
          name(a),
          r.type,
          r.count,
          r.campaigns,
          {
            value: r.verdict,
            tone: r.verdict === "Aplicable" ? "good" : r.verdict === "No recomendable" ? "bad" : undefined,
          },
          r.reason,
        ]),
      ),
    },
    {
      name: "No tocar",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Campaña", width: 32 },
        { header: "Qué no tocar", width: 30 },
        { header: "Motivo", width: 80 },
      ],
      rows: audits.flatMap((a) => a.holds.map((h): Cell[] => [name(a), h.campaign, h.item, h.reason])),
    },
    {
      name: "URLs",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "URL", width: 70 },
        { header: "Resultado", width: 14 },
        { header: "HTTP", width: 8 },
        { header: "Redirige a", width: 50 },
      ],
      rows: audits.flatMap((a) =>
        a.data.urlChecks.map((u): Cell[] => [
          name(a),
          u.url,
          { value: u.outcome, tone: u.outcome === "error" ? "bad" : u.outcome === "redirect" ? "warn" : undefined },
          u.status,
          u.location ?? "",
        ]),
      ),
    },
    {
      name: "Sin datos",
      columns: [
        { header: "Cuenta", width: 28 },
        { header: "Sección", width: 40 },
        { header: "Motivo", width: 60 },
      ],
      rows: audits.flatMap((a) => [
        ...a.data.unavailable.map((u): Cell[] => [name(a), u.section, u.reason]),
        ...a.data.truncated.map((t): Cell[] => [
          name(a),
          t,
          "Recortado al límite de filas: se analizaron los de mayor gasto.",
        ]),
      ]),
    },
  ];
}
