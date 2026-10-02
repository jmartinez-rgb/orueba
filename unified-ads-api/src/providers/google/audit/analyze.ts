import { cpa, delta, summarize, totals, type CampaignSummary, type Totals } from "./aggregate.js";
import { createCtx, CRITERIA, fmtDelta, fmtNum } from "./context.js";
import { anomalyRules, biddingRules, budgetRules } from "./rules-performance.js";
import {
  changeEntries,
  classifyRecommendations,
  conversionRules,
  type ChangeEntry,
  type RecommendationEntry,
} from "./rules-measurement.js";
import { searchRules } from "./rules-search.js";
import { creativeRules } from "./rules-creative.js";
import { segmentRules } from "./rules-segments.js";
import type { AuditData, Finding, HoldItem, Priority, SectionKey, WindowKey } from "./types.js";

export interface Answers {
  good: string[];
  safe: string[];
  errors: string[];
  efficiency: string[];
  today: string[];
  later: string[];
  analysis: string[];
}

export interface AccountAudit {
  data: AuditData;
  status: "ok" | "sin_acceso" | "sin_datos";
  campaigns: CampaignSummary[];
  account: Record<WindowKey, Totals>;
  findings: Finding[];
  quickWins: Finding[];
  holds: HoldItem[];
  notes: Partial<Record<SectionKey, string[]>>;
  changes: ChangeEntry[];
  recommendations: RecommendationEntry[];
  experiments: Finding[];
  answers: Answers;
}

const ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
export const byPriority = (a: Finding, b: Finding) => ORDER[a.priority] - ORDER[b.priority] || b.stake - a.stake;

export function analyzeAccount(data: AuditData): AccountAudit {
  const status: AccountAudit["status"] = !data.customer
    ? "sin_acceso"
    : data.daily.length === 0 && data.campaigns.length === 0
      ? "sin_datos"
      : "ok";
  // Sin lectura no hay ventanas: los totales quedan en cero y no se emiten hallazgos.
  const { campaigns, account } = status === "ok" ? summarize(data) : { campaigns: [], account: emptyTotals(data) };
  const ctx = createCtx(data, campaigns, account);
  let changes: ChangeEntry[] = [];
  let recommendations: RecommendationEntry[] = [];
  if (status === "ok") {
    anomalyRules(ctx);
    budgetRules(ctx);
    biddingRules(ctx);
    conversionRules(ctx);
    searchRules(ctx);
    creativeRules(ctx);
    segmentRules(ctx);
    changes = changeEntries(ctx);
    const constrained = new Set(
      ctx.findings
        .filter((f) => f.rule === "RULE-GADS-003")
        .flatMap((f) => campaigns.filter((c) => c.info.name === f.campaign).map((c) => c.info.id)),
    );
    recommendations = classifyRecommendations(ctx, constrained);
    stabilityHolds(ctx.findings, campaigns, ctx.hold.bind(ctx), ctx.money);
  }
  const suffix = data.target.id.slice(-4);
  const findings = ctx.findings
    .sort(byPriority)
    .map((f, i) => ({ ...f, id: `${suffix}-${String(i + 1).padStart(2, "0")}` }));
  const quickWins = findings
    .filter((f) => (f.priority === "P0" || f.priority === "P1") && f.risk === "bajo" && f.confidence !== "baja")
    .slice(0, 10);
  const experiments = findings.filter((f) => f.experiment);
  return {
    data,
    status,
    campaigns,
    account,
    findings,
    quickWins,
    holds: ctx.holds,
    notes: ctx.notes,
    changes,
    recommendations,
    experiments,
    answers: answers(findings, ctx.holds, data, ctx.money),
  };
}

function emptyTotals(data: AuditData): Record<WindowKey, Totals> {
  const keys: WindowKey[] = ["L7", "P7", "L14", "P14", "L30", "P30", "MTD", "PMTD", "PM", "L90", "PRE_BID"];
  return Object.fromEntries(keys.map((k) => [k, totals(data, undefined)])) as Record<WindowKey, Totals>;
}

/** Campañas estables con volumen se declaran "no tocar"; las de poco volumen, "poca información". */
function stabilityHolds(
  findings: Finding[],
  campaigns: CampaignSummary[],
  hold: (campaign: string, item: string, reason: string) => void,
  money: (n: number | null) => string,
): void {
  const flagged = new Set(findings.filter((f) => f.priority !== "P4").map((f) => f.campaign));
  for (const s of campaigns) {
    if (s.info.status !== "ENABLED" || s.w.L30.cost <= 0) continue;
    if (s.w.L30.conversions < CRITERIA.minConversions) {
      hold(
        s.info.name,
        "Estrategia y estructura",
        `Poca información: ${fmtNum(s.w.L30.conversions, 1)} conversiones en 30 días; cualquier lectura de CPA es inestable.`,
      );
      continue;
    }
    const change = delta(cpa(s.w.L30), cpa(s.w.P30));
    if (!flagged.has(s.info.name) && change !== null && Math.abs(change) < CRITERIA.materialChange)
      hold(
        s.info.name,
        "Toda la configuración",
        `Rendimiento estable: CPA ${money(cpa(s.w.L30))} (${fmtDelta(change)} vs 30 días previos) con ${fmtNum(s.w.L30.conversions, 1)} conversiones y sin hallazgos.`,
      );
  }
}

function answers(
  findings: Finding[],
  holds: HoldItem[],
  data: AuditData,
  money: (n: number | null) => string,
): Answers {
  const line = (f: Finding) => `${f.id} · ${f.campaign}: ${f.title}`;
  const stable = holds.filter((h) => h.reason.startsWith("Rendimiento estable"));
  return {
    good: stable.length
      ? stable.map((h) => `${h.campaign}: ${h.reason}`)
      : [
          "No hay campañas con volumen suficiente y sin hallazgos para declararlas intocables; ver la sección No tocar todavía.",
        ],
    safe: findings.filter((f) => f.risk === "bajo" && f.priority !== "P0" && f.priority !== "P4").map(line),
    errors: findings.filter((f) => f.priority === "P0").map(line),
    efficiency: findings
      .filter((f) => (f.waste ?? 0) > 0)
      .sort((a, b) => (b.waste ?? 0) - (a.waste ?? 0))
      .slice(0, 8)
      .map((f) => `${line(f)} (gasto recuperable estimado ${money(f.waste ?? 0)} en 30 días)`),
    today: findings.filter((f) => f.when === "hoy").map(line),
    later: findings.filter((f) => f.priority === "P3" || f.experiment).map(line),
    analysis: [
      ...findings.filter((f) => f.priority === "P4" || f.confidence === "baja").map(line),
      ...data.unavailable.map((u) => `Sección sin datos: ${u.section} (${u.reason}).`),
    ],
  };
}

export interface GlobalSummary {
  opportunities: Finding[];
  quickWins: Finding[];
  errors: Finding[];
  risks: string[];
  holds: string[];
  rules: Array<{ id: string; rule: string; accounts: string[] }>;
}

export const MONITORING_RULES: Array<{ id: string; rule: string }> = [
  {
    id: "RULE-GADS-001",
    rule: "Campaña habilitada y dentro de fechas con gasto = 0 durante 6 horas en horario de entrega (en la auditoría: 3 días completos) → alerta.",
  },
  {
    id: "RULE-GADS-002",
    rule: "CPA últimos 3 días > CPA últimos 14 días × 1.30 y conversiones de la base ≥ 10 → alerta (no aplicar en días con carga offline pendiente).",
  },
  {
    id: "RULE-GADS-003",
    rule: "Cuota perdida por presupuesto > 25% y CPA dentro del objetivo → revisar presupuesto (paso de 15%).",
  },
  {
    id: "RULE-GADS-004",
    rule: "Anuncio, keyword, recurso o grupo de recursos nuevo con estado Rechazado → alerta el mismo día.",
  },
  {
    id: "RULE-GADS-005",
    rule: "Acción de conversión primaria sin conversiones 3 días seguidos cuando su promedio de 14 días es ≥ 1 al día → alerta de seguimiento.",
  },
  { id: "RULE-GADS-006", rule: "URL final con respuesta 4xx/5xx en la revisión diaria → alerta crítica." },
  {
    id: "RULE-GADS-007",
    rule: "Estrategia en aprendizaje o cambio de presupuesto/puja en los últimos 7 días → silenciar alertas de CPA de esa campaña y marcar 'no tocar'.",
  },
  {
    id: "RULE-GADS-008",
    rule: "Término de búsqueda de empleo o soporte con gasto en el día y sin conversión → sugerir negativa.",
  },
  {
    id: "RULE-GADS-009",
    rule: "Cuota perdida por ranking sube ≥ 10 puntos semana contra semana → revisar subasta y calidad.",
  },
  {
    id: "RULE-GADS-010",
    rule: "tCPA ≥ 1.30 × CPA real y CPA subiendo tras el cambio de pujas de Google → revisar objetivo.",
  },
];

const PRIORITY_WEIGHT: Record<Priority, number> = { P0: 1, P1: 1, P2: 0.8, P3: 0.5, P4: 0.2 };
const CONFIDENCE_WEIGHT = { alta: 1, media: 0.7, baja: 0.4 } as const;
export const opportunityScore = (f: Finding) =>
  (f.waste ?? f.stake) * PRIORITY_WEIGHT[f.priority] * CONFIDENCE_WEIGHT[f.confidence];

export function globalSummary(audits: AccountAudit[]): GlobalSummary {
  const all = audits.flatMap((a) => a.findings);
  const holdCounts = new Map<string, number>();
  for (const a of audits)
    for (const h of a.holds)
      holdCounts.set(
        `${h.item}: ${h.reason.split(":")[0]}`,
        (holdCounts.get(`${h.item}: ${h.reason.split(":")[0]}`) ?? 0) + 1,
      );
  return {
    // Valor ponderado: gasto relacionado (o recuperable) por prioridad y confianza.
    opportunities: all
      .filter((f) => f.priority !== "P0" && f.priority !== "P4")
      .sort((a, b) => opportunityScore(b) - opportunityScore(a))
      .slice(0, 10),

    quickWins: audits
      .flatMap((a) => a.quickWins)
      .sort(byPriority)
      .slice(0, 10),
    errors: all.filter((f) => f.priority === "P0").sort(byPriority),
    risks: [
      ...all.filter((f) => f.priority === "P4").map((f) => `${f.id} · ${f.campaign}: ${f.title}`),
      ...all
        .filter((f) => f.title.startsWith("Anomalía") && f.confidence === "alta")
        .map((f) => `${f.id} · ${f.campaign}: ${f.title}`),
      ...audits
        .filter((a) => a.status !== "ok")
        .map((a) => `${a.data.target.name}: sin lectura (${a.data.unavailable[0]?.reason ?? "s/d"}).`),
    ],
    holds: [...holdCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([text, n]) => `${text} (${n} ${n === 1 ? "caso" : "casos"})`),
    rules: MONITORING_RULES.map((r) => ({
      ...r,
      accounts: [
        ...new Set(audits.filter((a) => a.findings.some((f) => f.rule === r.id)).map((a) => a.data.target.name)),
      ],
    })),
  };
}
