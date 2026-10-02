import {
  CHANNEL_LABEL,
  cpa,
  cpc,
  ctr,
  cvr,
  delta,
  roas,
  salesCpa,
  shouldServe,
  type CampaignSummary,
  type Totals,
} from "./aggregate.js";
import { CRITERIA, fmtDelta, fmtNum, fmtPct, fmtShare, type Ctx } from "./context.js";
import { conversionShortfallP, poissonLowerTail, rateDropP } from "./stats.js";
import type { WindowKey } from "./types.js";

const PAIRS: Array<[WindowKey, WindowKey, string]> = [
  ["L7", "P7", "7 vs 7 días"],
  ["L14", "P14", "14 vs 14 días"],
  ["L30", "P30", "30 vs 30 días"],
];
const CONVERSION_BIDDING = new Set(["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"]);

interface Trigger {
  code: number;
  pair: string;
  text: string;
}

/** Casos 1 a 9 del encargo para un par de ventanas de igual duración. */
export function anomalyTriggers(
  cur: Totals,
  base: Totals,
  pair: string,
  shares?: [number | null, number | null, number | null, number | null, number | null, number | null],
): Trigger[] {
  const out: Trigger[] = [];
  const t = (code: number, text: string) => out.push({ code, pair, text });
  const spendD = delta(cur.cost, base.cost),
    convD = delta(cur.conversions, base.conversions),
    clicksD = delta(cur.clicks, base.clicks),
    imprD = delta(cur.impressions, base.impressions);
  const convDropP =
    base.conversions >= CRITERIA.minConversions ? poissonLowerTail(cur.conversions, base.conversions) : null;
  const convDrop = convD !== null && convD < 0 && convDropP !== null && convDropP < CRITERIA.significance;
  if (spendD !== null && spendD >= CRITERIA.materialChange && convDrop)
    t(
      1,
      `Gasto ${fmtDelta(spendD)} y conversiones ${fmtDelta(convD)} (${fmtNum(base.conversions, 1)} → ${fmtNum(cur.conversions, 1)}; p=${convDropP!.toFixed(3)}).`,
    );
  const cpcD = delta(cpc(cur), cpc(base));
  const ctrP =
    base.impressions >= CRITERIA.minImpressions
      ? rateDropP(base.clicks, base.impressions, cur.clicks, cur.impressions)
      : null;
  if (cpcD !== null && cpcD >= CRITERIA.materialChange && ctrP !== null && ctrP < CRITERIA.significance)
    t(2, `CPC ${fmtDelta(cpcD)} y CTR ${fmtPct(ctr(base), 2)} → ${fmtPct(ctr(cur), 2)} (p=${ctrP.toFixed(3)}).`);
  if (clicksD !== null && Math.abs(clicksD) < CRITERIA.materialChange && convDrop)
    t(3, `Clics estables (${fmtDelta(clicksD)}) y conversiones ${fmtDelta(convD)} (p=${convDropP!.toFixed(3)}).`);
  if (imprD !== null && imprD <= -CRITERIA.materialChange && base.impressions >= CRITERIA.minImpressions)
    t(4, `Impresiones ${fmtDelta(imprD)} (${fmtNum(base.impressions)} → ${fmtNum(cur.impressions)}).`);
  const baseCpa = cpa(base),
    curCpa = cpa(cur);
  if (baseCpa !== null && base.conversions >= CRITERIA.minConversions && cur.cost > 0) {
    const p = conversionShortfallP(cur.conversions, cur.cost / baseCpa);
    const ratio = curCpa === null ? Infinity : curCpa / baseCpa;
    if (ratio >= CRITERIA.cpaAlertRatio && p !== null && p < CRITERIA.significance)
      t(
        6,
        `CPA ${curCpa === null ? "sin conversiones" : `×${ratio.toFixed(2)}`} (${baseCpa.toFixed(0)} → ${curCpa === null ? "s/c" : curCpa.toFixed(0)}; p=${p.toFixed(3)}).`,
      );
  }
  const cvrD = delta(cvr(cur), cvr(base));
  const cvrP =
    base.clicks >= CRITERIA.minClicks && base.conversions >= CRITERIA.minConversions
      ? rateDropP(base.conversions, base.clicks, cur.conversions, cur.clicks)
      : null;
  if (cvrD !== null && cvrD <= -CRITERIA.materialChange && cvrP !== null && cvrP < CRITERIA.significance)
    t(7, `Tasa de conversión ${fmtPct(cvr(base), 2)} → ${fmtPct(cvr(cur), 2)} (p=${cvrP.toFixed(3)}).`);
  if (shares) {
    const [isCur, isBase, rankCur, rankBase, budCur, budBase] = shares;
    if (isCur !== null && isBase !== null && isBase - isCur >= CRITERIA.sharePoints)
      t(8, `Cuota de impresiones ${fmtShare(isBase)} → ${fmtShare(isCur)}.`);
    if (rankCur !== null && rankBase !== null && rankCur - rankBase >= CRITERIA.sharePoints)
      t(9, `Cuota perdida por ranking ${fmtShare(rankBase)} → ${fmtShare(rankCur)}.`);
    if (budCur !== null && budBase !== null && budCur - budBase >= CRITERIA.sharePoints)
      t(10, `Cuota perdida por presupuesto ${fmtShare(budBase)} → ${fmtShare(budCur)}.`);
  }
  return out;
}

const CASE_LABEL: Record<number, string> = {
  1: "gasto ↑ y conversiones ↓",
  2: "CPC ↑ y CTR ↓",
  3: "clics estables y conversiones ↓",
  4: "impresiones ↓",
  6: "CPA ↑",
  7: "tasa de conversión ↓",
  8: "cuota de impresiones ↓",
  9: "cuota perdida por ranking ↑",
  10: "cuota perdida por presupuesto ↑",
};

function offlineShare(t: Totals): number {
  return t.conversions > 0 ? Math.min(1, (t.sales + t.leads) / t.conversions) : 0;
}

export function anomalyRules(ctx: Ctx): void {
  const { data } = ctx;
  for (const s of ctx.campaigns) {
    const c = s.info;
    // Caso 5: activa y debería entregar, pero sin gasto en los últimos días completos.
    if (shouldServe(c, data.end) && s.zeroDays >= CRITERIA.zeroSpendDays) {
      const isNew =
        !s.firstSpend &&
        c.start !== null &&
        c.start > new Date(Date.parse(data.end) - 7 * 86_400_000).toISOString().slice(0, 10);
      if (!isNew)
        ctx.add({
          section: "general",
          campaign: c.name,
          title: `Campaña activa sin gasto en los últimos ${s.zeroDays >= 90 ? "90+" : s.zeroDays} días`,
          evidence: [
            `Estado: ${c.status}; estado principal: ${c.primaryStatus ?? "s/d"}${c.reasons.length ? `; motivos: ${c.reasons.join(", ")}` : ""}.`,
            `Último día con gasto: ${s.firstSpend ? lastSpend(ctx, c.id) : "ninguno en 90 días"}. Presupuesto diario: ${ctx.money(c.budget)}.`,
          ],
          diagnosis:
            "La campaña está habilitada y dentro de fechas, pero no está entregando. Puede ser un problema de aprobación, segmentación, presupuesto agotado, facturación o una pausa a nivel de grupos o anuncios.",
          action: "Identificar el bloqueo antes de cualquier otro cambio y corregir solo la causa encontrada.",
          steps: [
            "Abrir la campaña y leer el estado principal y sus motivos (columna Estado).",
            "Revisar anuncios o grupos de recursos rechazados, grupos de anuncios en pausa y keywords con poco volumen.",
            "Confirmar facturación de la cuenta y que el presupuesto no sea compartido con otra campaña que lo consuma.",
            "Si la pausa es intencional, documentarla en Novedades del monitoreo para no alertar.",
          ],
          risk: "bajo",
          priority: "P0",
          confidence: c.primaryStatus === "ELIGIBLE" ? "alta" : "media",
          impact: "Recuperar entrega de una campaña que debería estar activa.",
          metric: "Gasto e impresiones diarias",
          observation: "24 a 48 horas después de corregir",
          rollback: "No aplica: se corrige un bloqueo, no se cambia la estrategia.",
          minutes: 20,
          when: "hoy",
          stake: s.w.P30.cost,
          rule: "RULE-GADS-001",
        });
      continue;
    }
    if (s.w.L30.cost <= 0) continue;
    reportAnomalies(ctx, s);
  }
  // Total de la cuenta: contexto para el estado general.
  const acc = ctx.account;
  const triggers = PAIRS.flatMap(([k1, k2, label]) => anomalyTriggers(acc[k1], acc[k2], label));
  if (triggers.length)
    ctx.note("general", `Cuenta total: ${triggers.map((t) => `${CASE_LABEL[t.code]} (${t.pair})`).join("; ")}.`);
}

function lastSpend(ctx: Ctx, campaignId: string): string {
  const days = ctx.data.daily
    .filter((d) => d.campaignId === campaignId && d.cost > 0)
    .map((d) => d.date)
    .sort();
  return days.at(-1) ?? "s/d";
}

function reportAnomalies(ctx: Ctx, s: CampaignSummary): void {
  const triggers: Trigger[] = [];
  for (const [k1, k2, label] of PAIRS) {
    const a = s.shares[k1],
      b = s.shares[k2];
    triggers.push(
      ...anomalyTriggers(
        s.w[k1],
        s.w[k2],
        label,
        a && b ? [a.impressionShare, b.impressionShare, a.lostRank, b.lostRank, a.lostBudget, b.lostBudget] : undefined,
      ),
    );
  }
  if (!triggers.length) return;
  const codes = [...new Set(triggers.map((t) => t.code))].sort((x, y) => x - y);
  const pairsPerCode = (code: number) => new Set(triggers.filter((t) => t.code === code).map((t) => t.pair)).size;
  const robust = codes.some((code) => pairsPerCode(code) >= 2);
  const conversionCases = codes.filter((c) => [1, 3, 6, 7].includes(c));
  const onlyRecent = triggers.every((t) => t.pair === PAIRS[0]![2]);
  const lagProne = offlineShare(s.w.L30) >= 0.5;
  const confidence = robust ? "alta" : onlyRecent && conversionCases.length && lagProne ? "baja" : "media";
  const strongest =
    triggers.find((t) => t.pair === PAIRS[2]![2]) ?? triggers.find((t) => t.pair === PAIRS[1]![2]) ?? triggers[0]!;
  const window = strongest.pair === PAIRS[0]![2] ? "L7" : strongest.pair === PAIRS[1]![2] ? "L14" : "L30";
  const from = ctx.data.windows.find((w) => w.key === window)?.from ?? "";
  const changes = ctx.data.changes.filter((c) => c.campaignId === s.info.id && c.at.slice(0, 10) >= from);
  const evidence = triggers.map((t) => `${t.pair} · caso ${t.code} (${CASE_LABEL[t.code]}): ${t.text}`);
  if (s.w.L30.sales > 0 || s.w.P30.sales > 0)
    evidence.push(
      `Ventas (MCC_Offline_Purchase) 30 vs 30: ${fmtNum(s.w.P30.sales, 1)} → ${fmtNum(s.w.L30.sales, 1)}; CPA de venta ${ctx.money(salesCpa(s.w.P30))} → ${ctx.money(salesCpa(s.w.L30))}.`,
    );
  if (changes.length)
    evidence.push(
      `Cambios en la ventana (correlación, no causalidad): ${changes
        .slice(0, 4)
        .map(
          (c) =>
            `${c.at.slice(0, 10)} ${c.resourceType}${Object.keys(c.after).length ? ` (${Object.keys(c.after).join(", ")})` : ""}`,
        )
        .join("; ")}${changes.length > 4 ? ` y ${changes.length - 4} más` : ""}.`,
    );
  if (lagProne && conversionCases.length)
    evidence.push(
      "Más de la mitad de las conversiones son importaciones offline: los últimos días pueden estar incompletos por retraso de carga.",
    );
  const isSearch = s.info.channel === "SEARCH";
  ctx.add({
    section: "general",
    campaign: s.info.name,
    title: `Anomalía de rendimiento: ${codes.map((c) => CASE_LABEL[c]).join(", ")}`,
    evidence,
    diagnosis: robust
      ? "El deterioro aparece en más de una ventana: no es una fluctuación de pocos días."
      : "Señal en una sola ventana; puede ser ruido o retraso de conversiones. Se investiga antes de actuar.",
    action: "Investigar la causa antes de tocar presupuesto, puja u objetivo (regla de no sobreoptimización).",
    steps: [
      "Revisar el historial de cambios de la campaña en la ventana señalada.",
      isSearch
        ? "Revisar términos de búsqueda nuevos con gasto y sin conversión, y la subasta (Estadísticas de subastas)."
        : "Revisar los grupos de recursos o anuncios con más gasto y cambios de creativos.",
      "Confirmar que la importación de conversiones offline (MCC_Offline_*) esté al día antes de concluir.",
      "Definir la acción solo cuando haya una causa identificada; documentar antes y después.",
    ],
    risk: "bajo",
    priority: "P2",
    confidence,
    impact: "Detectar a tiempo una pérdida de eficiencia sin reaccionar a ruido.",
    metric: conversionCases.length ? "CPA y conversiones (y ventas)" : "CTR, CPC e impresiones",
    observation: "7 días con datos de conversión completos",
    rollback: "No aplica: es una investigación; cualquier cambio posterior lleva su propio control.",
    minutes: 45,
    when: confidence === "baja" ? "semana" : "48h",
    stake: s.w.L30.cost,
    rule: codes.includes(6) ? "RULE-GADS-002" : codes.includes(9) ? "RULE-GADS-009" : null,
    // Costo por encima de lo que habría costado el mismo volumen con el CPA de los 30 días previos.
    waste: (() => {
      const base = cpa(s.w.P30);
      const excess = base === null ? 0 : s.w.L30.cost - s.w.L30.conversions * base;
      return conversionCases.length && excess > 0 ? excess : undefined;
    })(),
  });
}

export function budgetRules(ctx: Ctx): void {
  const { data } = ctx;
  const accountCpa = cpa(ctx.account.L30);
  const constrainedGood: CampaignSummary[] = [];
  for (const s of ctx.campaigns) {
    const c = s.info;
    if (!shouldServe(c, data.end) || s.w.L30.cost <= 0) continue;
    const lost14 = s.shares.L14?.lostBudget ?? null;
    const googleSays = c.reasons.includes("BUDGET_CONSTRAINED") || c.biddingStatus === "LIMITED_BY_BUDGET";
    const limited = googleSays || (lost14 !== null && lost14 > CRITERIA.lostBudgetAlert);
    const campaignCpa = cpa(s.w.L30);
    if (limited && c.budget !== null) {
      const efficient =
        s.w.L30.conversions >= CRITERIA.minConversions &&
        campaignCpa !== null &&
        (c.targetCpa !== null ? campaignCpa <= c.targetCpa : accountCpa !== null && campaignCpa <= accountCpa);
      const evidence = [
        `Presupuesto diario ${ctx.money(c.budget)}${c.budgetShared ? " (compartido)" : ""}; gasto promedio 7 días ${ctx.money(s.avg7)} (${fmtPct(s.avg7 / c.budget, 0)} del presupuesto).`,
        `Google: ${googleSays ? "limitada por presupuesto" : "sin estado de limitación"}; cuota perdida por presupuesto 14 días ${fmtShare(lost14)}, 30 días ${fmtShare(s.shares.L30?.lostBudget ?? null)}.`,
        `CPA 30 días ${ctx.money(campaignCpa)} vs ${c.targetCpa !== null ? `tCPA ${ctx.money(c.targetCpa)}` : `CPA de la cuenta ${ctx.money(accountCpa)}`}; conversiones ${fmtNum(s.w.L30.conversions, 1)}; ventas ${fmtNum(s.w.L30.sales, 1)}.`,
      ];
      if (c.recommendedBudget)
        evidence.push(
          `Presupuesto recomendado por Google: ${ctx.money(c.recommendedBudget)} (referencia, no instrucción).`,
        );
      if (efficient) {
        constrainedGood.push(s);
        const next = c.budget * (1 + CRITERIA.budgetStepPct / 100);
        const wait = pendingStability(s);
        ctx.add({
          section: "budget",
          campaign: c.name,
          title: "Presupuesto limita una campaña con buena eficiencia",
          evidence,
          diagnosis:
            "La campaña deja de mostrarse por presupuesto mientras su CPA está dentro del objetivo o mejor que el de la cuenta. Desde el 17 de agosto de 2026 Google estabiliza las estrategias con objetivo ante aumentos de presupuesto.",
          action: `${wait ? `Esperar ${wait}; después, subir` : "Subir"} el presupuesto diario ${CRITERIA.budgetStepPct}% (de ${ctx.money(c.budget)} a ${ctx.money(next)}) y no volver a moverlo en 7 días.`,
          steps: [
            ...(wait ? [`No hacer el ajuste antes de ${wait}.`] : []),
            "Registrar en el control de cambios: presupuesto actual, CPA y conversiones de los últimos 14 días.",
            `Cambiar el presupuesto a ${ctx.money(next)}${c.budgetShared ? " (es compartido: el aumento se reparte entre sus campañas)" : ""}.`,
            `A los 7 días comparar CPA y ventas contra la base; repetir el paso solo si el CPA no supera la base × ${CRITERIA.cpaAlertRatio}.`,
          ],
          risk: "moderado",
          priority: "P2",
          confidence: googleSays && lost14 !== null && lost14 > CRITERIA.lostBudgetAlert ? "alta" : "media",
          impact: "Más conversiones al CPA actual en lugar de perder subastas por presupuesto.",
          metric: "Conversiones, ventas y CPA de la campaña",
          observation: "7 días (1 a 2 ciclos de conversión)",
          rollback: `Regresar el presupuesto a ${ctx.money(c.budget)}.`,
          minutes: 10,
          when: wait ? "semana" : "48h",
          stake: s.w.L30.cost,
          rule: "RULE-GADS-003",
          sources: ["limitedBudget", "targetUpdate"],
        });
      } else
        ctx.hold(
          c.name,
          "Presupuesto",
          `Limitada por presupuesto, pero ${s.w.L30.conversions < CRITERIA.minConversions ? `con poco volumen (${fmtNum(s.w.L30.conversions, 1)} conversiones en 30 días)` : `con CPA ${ctx.money(campaignCpa)} por encima de la referencia`}: no subir hasta revisar eficiencia.`,
        );
    }
    // Presupuesto asignado que no se usa.
    if (
      !limited &&
      c.budget !== null &&
      s.firstSpend &&
      s.firstSpend <= shift(data.end, -13) &&
      s.avg14 < c.budget * CRITERIA.underuseRatio &&
      s.zeroDays < CRITERIA.zeroSpendDays
    )
      ctx.note(
        "budget",
        `${c.name}: usa ${fmtPct(s.avg14 / c.budget, 0)} de su presupuesto (${ctx.money(s.avg14)} de ${ctx.money(c.budget)} diarios en 14 días). Presupuesto disponible sin uso: ${ctx.money(c.budget - s.avg14)} diarios.`,
      );
    // Gasto relevante sin conversiones en una estrategia que puja por conversiones.
    if (
      c.bidding &&
      CONVERSION_BIDDING.has(c.bidding) &&
      s.w.L30.conversions === 0 &&
      s.w.L30.sales === 0 &&
      s.share30 >= 0.05
    )
      ctx.add({
        section: "budget",
        campaign: c.name,
        title: "Gasto relevante sin conversiones en 30 días con puja por conversiones",
        evidence: [
          `Gasto 30 días ${ctx.money(s.w.L30.cost)} (${fmtPct(s.share30, 0)} de la cuenta); conversiones 0; todas las conversiones ${fmtNum(s.w.L30.allConversions, 1)}.`,
          `Estrategia: ${c.bidding}; estado de la estrategia: ${c.biddingStatus ?? "s/d"}.`,
        ],
        diagnosis:
          "Una estrategia que optimiza por conversiones sin registrar ninguna suele indicar objetivos mal asignados, seguimiento roto o una campaña que no aporta. Se investiga antes de pausar.",
        action:
          "Verificar qué objetivo de conversión usa la campaña y si su seguimiento registra datos; no pausar sin esa revisión.",
        steps: [
          "Revisar en la campaña la configuración de objetivos (de cuenta o específicos).",
          "Comparar con las acciones de conversión que sí registran datos en la cuenta.",
          "Si el seguimiento está bien y la campaña no aporta, proponer la pausa como cambio documentado.",
        ],
        risk: "bajo",
        priority: "P2",
        confidence: "media",
        impact: "Evitar gasto sin señal de optimización.",
        metric: "Conversiones y todas las conversiones",
        observation: "7 días después de corregir el objetivo",
        rollback: "No aplica: diagnóstico.",
        minutes: 30,
        when: "48h",
        stake: s.w.L30.cost,
        rule: "RULE-GADS-005",
        waste: s.w.L30.cost,
      });
  }
  // Concentración y ritmo del mes.
  const top = [...ctx.campaigns].sort((a, b) => b.w.L30.cost - a.w.L30.cost)[0];
  if (top && top.share30 >= 0.5)
    ctx.note("budget", `Concentración: ${top.info.name} concentra ${fmtPct(top.share30, 0)} del gasto de 30 días.`);
  const dailyBudgets = ctx.campaigns.filter((s) => shouldServe(s.info, data.end) && s.info.budget !== null);
  const sharedSeen = new Set<string>();
  const totalDaily = dailyBudgets.reduce((sum, s) => {
    if (s.info.budgetShared && s.info.budgetId) {
      if (sharedSeen.has(s.info.budgetId)) return sum;
      sharedSeen.add(s.info.budgetId);
    }
    return sum + (s.info.budget ?? 0);
  }, 0);
  if (totalDaily > 0)
    ctx.note(
      "budget",
      `Presupuesto diario vigente (campañas que deberían entregar, compartidos una sola vez): ${ctx.money(totalDaily)}; gasto promedio 7 días ${ctx.money(ctx.account.L7.cost / 7)} (${fmtPct(ctx.account.L7.cost / 7 / totalDaily, 0)}).`,
    );
  if (constrainedGood.length)
    ctx.note(
      "budget",
      `Campañas limitadas por presupuesto con buena eficiencia: ${constrainedGood.map((s) => s.info.name).join(", ")}. Si existe presupuesto sin uso en otras campañas, reasignarlo de forma gradual es preferible a aumentar el total.`,
    );
}

/** Si hubo un cambio reciente o la estrategia aprende, el siguiente ajuste espera. */
function pendingStability(s: CampaignSummary): string | null {
  if (LEARNING.has(s.info.biddingStatus ?? "") || s.info.reasons.includes("BIDDING_STRATEGY_LEARNING"))
    return "a que la estrategia salga de aprendizaje";
  if (s.changes7 > 0 && s.lastBudgetBidChange)
    return `al ${shift(s.lastBudgetBidChange, 7)} (7 días después del cambio del ${s.lastBudgetBidChange})`;
  return null;
}

const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

const MISCONFIGURED: Record<string, string> = {
  MISCONFIGURED_ZERO_ELIGIBILITY: "la estrategia no tiene tráfico elegible",
  MISCONFIGURED_CONVERSION_TYPES: "optimiza hacia tipos de conversión sin datos o inválidos",
  MISCONFIGURED_CONVERSION_SETTINGS: "la configuración de conversiones impide optimizar",
  MISCONFIGURED_SHARED_BUDGET: "el presupuesto compartido no es compatible con la estrategia",
  MISCONFIGURED_STRATEGY_TYPE: "el tipo de estrategia no es compatible con la campaña",
  MULTIPLE_MISCONFIGURED: "varias configuraciones incorrectas",
};
const LEARNING = new Set([
  "LEARNING_NEW",
  "LEARNING_SETTING_CHANGE",
  "LEARNING_BUDGET_CHANGE",
  "LEARNING_COMPOSITION_CHANGE",
  "LEARNING_CONVERSION_TYPE_CHANGE",
  "LEARNING_CONVERSION_SETTING_CHANGE",
  "MULTIPLE_LEARNING",
]);

export function biddingRules(ctx: Ctx): void {
  const { data } = ctx;
  for (const s of ctx.campaigns) {
    const c = s.info;
    if (!shouldServe(c, data.end)) continue;
    const status = c.biddingStatus ?? "";
    if (MISCONFIGURED[status] || c.reasons.includes("BIDDING_STRATEGY_MISCONFIGURED"))
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: "Estrategia de puja mal configurada según Google",
        evidence: [
          `Estado de la estrategia: ${status || "s/d"}; motivos de la campaña: ${c.reasons.join(", ") || "s/d"}.`,
        ],
        diagnosis: `Google reporta que ${MISCONFIGURED[status] ?? "la estrategia está mal configurada"}; la campaña no puede optimizar correctamente.`,
        action:
          "Leer el detalle del estado en la columna Estado de la estrategia y corregir exactamente lo que Google indica.",
        steps: [
          "Abrir el detalle del estado de la estrategia en la interfaz.",
          "Corregir la configuración indicada (objetivos de conversión, presupuesto compartido o tipo).",
          "Documentar el cambio: modificar objetivos de conversión es estructural y reinicia aprendizaje.",
        ],
        risk: "moderado",
        priority: "P0",
        confidence: "alta",
        impact: "Recuperar la capacidad de optimización de la campaña.",
        metric: "Estado de la estrategia y conversiones",
        observation: "7 a 14 días (aprendizaje)",
        rollback: "Revertir la configuración documentada.",
        minutes: 30,
        when: "hoy",
        stake: s.w.L30.cost,
        rule: null,
        sources: ["smartBidding", "goalChanges"],
      });
    if (status === "LIMITED_BY_CPC_BID_CEILING" || status === "LIMITED_BY_CPC_BID_FLOOR")
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: `Estrategia limitada por el ${status.endsWith("CEILING") ? "límite máximo" : "límite mínimo"} de CPC`,
        evidence: [`Estado de la estrategia: ${status}. CPC promedio 30 días ${ctx.money(cpc(s.w.L30))}.`],
        diagnosis: "Un límite de puja de la estrategia de cartera impide que Smart Bidding puje lo necesario.",
        action:
          "Revisar el límite de CPC de la estrategia de cartera y ajustarlo 15% como máximo por paso, o retirarlo si no tiene justificación de negocio.",
        steps: ["Abrir la estrategia de cartera y anotar el límite actual.", "Ajustar un paso y observar 7 días."],
        risk: "moderado",
        priority: "P2",
        confidence: "alta",
        impact: "Acceso a subastas que hoy se pierden por el límite.",
        metric: "Impresiones, CPC y CPA",
        observation: "7 días",
        rollback: "Restaurar el límite anterior.",
        minutes: 10,
        when: "semana",
        stake: s.w.L30.cost,
        rule: null,
      });
    if (status === "LIMITED_BY_LOW_QUALITY")
      ctx.note("bidding", `${c.name}: la estrategia está limitada por baja calidad (ver Quality Score y anuncios).`);
    if (status === "LIMITED_BY_DATA")
      ctx.hold(
        c.name,
        "Estrategia y objetivo",
        "Google indica datos insuficientes para la estrategia: dejar acumular conversiones antes de mover el objetivo.",
      );
    if (LEARNING.has(status) || c.reasons.includes("BIDDING_STRATEGY_LEARNING"))
      ctx.hold(
        c.name,
        "Presupuesto, objetivo y estrategia",
        `En aprendizaje (${status || "BIDDING_STRATEGY_LEARNING"}): no modificar hasta que se estabilice.`,
      );
    if (s.changes7 > 0)
      ctx.hold(
        c.name,
        "Presupuesto y puja",
        `Tuvo ${s.changes7} cambio(s) de presupuesto o puja en los últimos 7 días: esperar al menos una semana completa.`,
      );
    if (s.biddingChanges30 >= 3)
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: `Cambios frecuentes de estrategia u objetivo (${s.biddingChanges30} en 30 días)`,
        evidence: [`Historial: ${s.biddingChanges30} cambios de objetivo o tipo de estrategia en los últimos 30 días.`],
        diagnosis:
          "Cambiar el objetivo con frecuencia impide que la estrategia se estabilice; Google recomienda cambios pequeños y espaciados.",
        action: "Congelar cambios de objetivo y estrategia al menos dos semanas y evaluar con datos completos.",
        steps: ["Comunicar la pausa de cambios al equipo.", "Evaluar al cierre de la ventana con CPA y ventas."],
        risk: "bajo",
        priority: "P2",
        confidence: "alta",
        impact: "Estabilidad del aprendizaje.",
        metric: "Variación diaria del CPA",
        observation: "14 días",
        rollback: "No aplica.",
        minutes: 5,
        when: "hoy",
        stake: s.w.L30.cost,
        rule: null,
        sources: ["targetChanges", "smartBidding"],
      });
    targetRules(ctx, s);
    // Estrategias sin Smart Bidding con volumen suficiente para probarla.
    if (
      (c.bidding === "MANUAL_CPC" || c.bidding === "TARGET_SPEND") &&
      s.w.L30.conversions >= CRITERIA.minConversions * 3
    )
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: `${c.bidding === "MANUAL_CPC" ? "CPC manual" : "Maximizar clics"} con volumen para probar Smart Bidding`,
        evidence: [`${fmtNum(s.w.L30.conversions, 1)} conversiones en 30 días; CPA ${ctx.money(cpa(s.w.L30))}.`],
        diagnosis:
          "La campaña tiene volumen de conversiones suficiente para evaluar una estrategia por conversiones, pero cambiarla es estructural.",
        action: "No cambiar directamente: proponer un experimento 50/50 con Maximizar conversiones.",
        steps: [
          "Crear experimento de campaña 50/50.",
          "Correr 4 semanas o hasta 30–50 conversiones por brazo.",
          "Decidir por CPA de venta.",
        ],
        risk: "alto",
        priority: "P4",
        confidence: "media",
        impact: "Posible mejora de eficiencia con menor trabajo manual.",
        metric: "CPA de venta y ventas",
        observation: "4 semanas",
        rollback: "Terminar el experimento sin aplicar.",
        minutes: 30,
        when: "no_ejecutar",
        stake: s.w.L30.cost,
        rule: null,
        experiment: {
          hypothesis: "Smart Bidding obtiene más ventas al mismo CPA que la puja actual.",
          design: "Experimento de campaña 50/50, sin otros cambios simultáneos.",
          duration: "4 semanas o 30–50 conversiones por brazo",
        },
      });
    if (c.channel === "DEMAND_GEN" && c.targetCpa !== null && c.budget !== null && c.budget < c.targetCpa * 10)
      ctx.add({
        section: "video",
        campaign: c.name,
        title: "Presupuesto de Demand Gen menor a 10 veces el CPA objetivo",
        evidence: [
          `Presupuesto diario ${ctx.money(c.budget)}; tCPA ${ctx.money(c.targetCpa)} (10× = ${ctx.money(c.targetCpa * 10)}).`,
        ],
        diagnosis:
          "Google indica que un presupuesto bajo frente al tCPA es la primera causa de bajo rendimiento en Demand Gen.",
        action:
          "Antes de juzgar la campaña, evaluar llevar el presupuesto hacia 10× tCPA en pasos de 15% o consolidar presupuesto con otra campaña Demand Gen.",
        steps: ["Validar con negocio la inversión disponible.", "Aplicar un paso y observar hasta 30–50 conversiones."],
        risk: "moderado",
        priority: "P3",
        confidence: "media",
        impact: "Aprendizaje más estable en Demand Gen.",
        metric: "Conversiones y CPA",
        observation: "Hasta 30–50 conversiones",
        rollback: "Regresar al presupuesto anterior.",
        minutes: 10,
        when: "semana",
        stake: s.w.L30.cost,
        rule: null,
        sources: ["demandGen"],
      });
  }
}

function targetRules(ctx: Ctx, s: CampaignSummary): void {
  const c = s.info;
  const actual = cpa(s.w.L30);
  if (c.targetCpa !== null && actual !== null && s.w.L30.conversions >= CRITERIA.minConversions) {
    const ratio = actual / c.targetCpa;
    ctx.note(
      "bidding",
      `${c.name} (${CHANNEL_LABEL[c.channel] ?? c.channel}): tCPA ${ctx.money(c.targetCpa)}; CPA real 30 días ${ctx.money(actual)} (×${ratio.toFixed(2)}).`,
    );
    const pre = s.w.PRE_BID;
    const preCpa = pre ? cpa(pre) : null;
    // Desde el 17 de agosto, una campaña con objetivo holgado entrega más cerca del objetivo.
    if (
      pre &&
      preCpa !== null &&
      pre.conversions >= CRITERIA.minConversions &&
      c.targetCpa >= preCpa * CRITERIA.cpaAlertRatio &&
      actual >= preCpa * (1 + CRITERIA.materialChange)
    ) {
      const salesUp = pre.sales > 0 && s.w.L30.sales / pre.sales >= s.w.L30.cost / Math.max(pre.cost, 1);
      const next = c.targetCpa * (1 - CRITERIA.targetStepPct / 100);
      const wait = pendingStability(s);
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: "El CPA subió hacia un tCPA holgado después del cambio de pujas de Google (17 ago)",
        evidence: [
          `tCPA ${ctx.money(c.targetCpa)}; CPA en los 30 días previos al 17 ago ${ctx.money(preCpa)}; CPA últimos 30 días ${ctx.money(actual)}.`,
          `Ventas: ${fmtNum(pre.sales, 1)} → ${fmtNum(s.w.L30.sales, 1)}; gasto ${ctx.money(pre.cost)} → ${ctx.money(s.w.L30.cost)}.`,
        ],
        diagnosis: salesUp
          ? "Google ahora entrega más cerca del objetivo configurado. Las ventas crecieron en proporción al gasto: el mayor CPA compró volumen."
          : "Google ahora entrega más cerca del objetivo configurado; el CPA subió sin un aumento proporcional de ventas.",
        action: salesUp
          ? "No tocar mientras el volumen adicional sea deseado; revisar con negocio si el CPA actual es aceptable."
          : `${wait ? `Esperar ${wait}; después, bajar` : "Bajar"} el tCPA ${CRITERIA.targetStepPct}% (de ${ctx.money(c.targetCpa)} a ${ctx.money(next)}) y esperar una semana antes de otro paso.`,
        steps: salesUp
          ? [
              "Presentar a negocio el intercambio volumen/CPA con estos datos.",
              "Mantener el objetivo hasta tener decisión.",
            ]
          : [
              "Registrar CPA, conversiones y ventas de los últimos 14 días.",
              `Cambiar el tCPA a ${ctx.money(next)}.`,
              "Evaluar a los 7 días; repetir solo si el volumen se sostiene.",
            ],
        risk: salesUp ? "bajo" : "moderado",
        priority: salesUp ? "P3" : "P2",
        confidence: "media",
        impact: salesUp
          ? "Decisión informada de volumen contra eficiencia."
          : "Recuperar el CPA previo sin cambiar la estrategia.",
        metric: "CPA de venta y ventas",
        observation: "7 días por paso",
        rollback: `Restaurar el tCPA a ${ctx.money(c.targetCpa)}.`,
        minutes: 10,
        when: salesUp || wait ? "semana" : "48h",
        stake: s.w.L30.cost,
        rule: "RULE-GADS-010",
        sources: ["targetUpdate", "targetUpdateFaq", "targetChanges"],
      });
    } else if (
      ratio >= CRITERIA.cpaAlertRatio &&
      (c.reasons.some((r) => r === "BIDDING_STRATEGY_CONSTRAINED" || r === "BIDDING_STRATEGY_LIMITED") ||
        (s.shares.L14?.lostRank ?? 0) >= 0.5)
    )
      ctx.add({
        section: "bidding",
        campaign: c.name,
        title: "tCPA por debajo de lo que la campaña logra",
        evidence: [
          `tCPA ${ctx.money(c.targetCpa)}; CPA real 30 días ${ctx.money(actual)} (×${ratio.toFixed(2)}).`,
          `Motivos: ${c.reasons.join(", ") || "s/d"}; cuota perdida por ranking 14 días ${fmtShare(s.shares.L14?.lostRank ?? null)}.`,
        ],
        diagnosis: "Un objetivo muy por debajo del CPA alcanzable restringe la entrega.",
        action: "No mover directamente: si se busca volumen, probar un tCPA 15% más alto en un experimento.",
        steps: [
          "Crear experimento 50/50 con tCPA +15%.",
          "Correr 2 a 4 semanas.",
          "Decidir por ventas y CPA de venta.",
        ],
        risk: "moderado",
        priority: "P3",
        confidence: "media",
        impact: "Más volumen si el negocio acepta el CPA.",
        metric: "Ventas y CPA de venta",
        observation: "2 a 4 semanas",
        rollback: "Terminar el experimento sin aplicar.",
        minutes: 20,
        when: "semana",
        stake: s.w.L30.cost,
        rule: null,
        sources: ["targetChanges"],
        experiment: {
          hypothesis: "Un tCPA 15% más alto aumenta ventas con CPA aceptable.",
          design: "Experimento de campaña 50/50 cambiando solo el tCPA.",
          duration: "2 a 4 semanas",
        },
      });
  }
  const actualRoas = roas(s.w.L30);
  if (c.targetRoas !== null && actualRoas !== null)
    ctx.note("bidding", `${c.name}: tROAS ${fmtPct(c.targetRoas, 0)}; ROAS real 30 días ${fmtPct(actualRoas, 0)}.`);
}
