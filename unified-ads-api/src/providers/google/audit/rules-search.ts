import { cpa, shouldServe } from "./aggregate.js";
import { CRITERIA, fmtNum, fmtPct, type Ctx, plural } from "./context.js";
import { conversionShortfallP } from "./stats.js";
import type { AuditData, Confidence, KeywordRow } from "./types.js";

/** Minúsculas y sin acentos, para comparar términos con las listas de intención. */
export const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export interface IntentCategory {
  key: string;
  label: string;
  confidence: Confidence;
  re: RegExp;
  why: string;
}

/**
 * Intenciones sin valor comercial para campañas de adquisición. Son configurables y se aplican solo a
 * términos con gasto, sin conversiones y que no coinciden con una keyword activa.
 */
export const INTENT_CATEGORIES: IntentCategory[] = [
  {
    key: "empleo",
    label: "Búsqueda de empleo",
    confidence: "alta",
    re: /\b(empleos?|vacantes?|bolsa de trabajo|trabajar en|trabajo en|sueldos?|salarios?|reclutamiento|solicitud de empleo)\b/,
    why: "Quien busca empleo no contrata el servicio.",
  },
  {
    key: "soporte",
    label: "Cliente actual o soporte",
    confidence: "media",
    re: /\b(pagar|pago de|recibo|estado de cuenta|facturas?|facturacion|cancelar|cancelacion|dar de baja|fallas?|sin servicio|sin internet|sin senal|no funciona|reportar|reporte de falla|mi cuenta|iniciar sesion|login|contrasena|soporte tecnico|atencion a clientes|servicio al cliente)\b/,
    why: "Intención de un cliente actual (pago, soporte, cancelación); rara vez es una venta nueva.",
  },
  {
    key: "gratis",
    label: "Gratis o piratería",
    confidence: "media",
    re: /\b(gratis|gratuito|pirata|hackear|crack|apk mod|descargar gratis)\b/,
    why: "Busca contenido sin pago o ilegal.",
  },
];

/** Competencia y marcas relacionadas; la marca propia de la cuenta se excluye. */
export function competitionPattern(accountName: string): RegExp {
  const own = plain(accountName);
  const brands = [
    "telmex",
    "totalplay",
    "megacable",
    "dish",
    "axtel",
    "starlink",
    "netflix",
    "disney",
    "hbo",
    "prime video",
    "vix",
    "sky",
    "izzi",
  ].filter((b) => !own.includes(b));
  return new RegExp(`\\b(${brands.join("|")})\\b`);
}

export function searchRules(ctx: Ctx): void {
  networkRules(ctx);
  termRules(ctx);
  keywordRules(ctx);
  qualityRules(ctx);
}

function networkRules(ctx: Ctx): void {
  const byCampaign = new Map<string, Map<string, { cost: number; conversions: number }>>();
  for (const n of ctx.data.networks) {
    const m = byCampaign.get(n.campaignId) ?? new Map();
    const cur = m.get(n.key) ?? { cost: 0, conversions: 0 };
    cur.cost += n.cost;
    cur.conversions += n.conversions;
    m.set(n.key, cur);
    byCampaign.set(n.campaignId, m);
  }
  for (const [id, nets] of byCampaign) {
    const search = nets.get("SEARCH");
    const total = [...nets.values()].reduce((s, x) => s + x.cost, 0);
    const searchCpa = search ? cpa(search) : null;
    if (!search || searchCpa === null || search.conversions < CRITERIA.minConversions || total <= 0) continue;
    for (const [network, m] of nets) {
      if (network === "SEARCH" || m.cost < total * 0.1) continue;
      const p = conversionShortfallP(m.conversions, m.cost / searchCpa);
      const netCpa = cpa(m);
      if (p === null || p >= CRITERIA.significance || (netCpa !== null && netCpa < searchCpa * CRITERIA.cpaAlertRatio))
        continue;
      const label =
        network === "SEARCH_PARTNERS"
          ? "socios de búsqueda"
          : network === "CONTENT"
            ? "Display (Display Select)"
            : network;
      ctx.add({
        section: "search",
        campaign: ctx.name(id),
        title: `La red de ${label} convierte peor que Search`,
        evidence: [
          `Search: ${ctx.money(search.cost)}, ${fmtNum(search.conversions, 1)} conv., CPA ${ctx.money(searchCpa)}.`,
          `${label}: ${ctx.money(m.cost)} (${fmtPct(m.cost / total, 0)} del gasto), ${fmtNum(m.conversions, 1)} conv., CPA ${ctx.money(netCpa)} (p=${p.toFixed(3)}).`,
        ],
        diagnosis: "La diferencia es estadísticamente significativa con el volumen de 30 días.",
        action: `Desactivar ${label} en la configuración de redes de la campaña, o primero probarlo con un experimento si la campaña es crítica.`,
        steps: [
          "Registrar gasto y CPA por red.",
          `Configuración > Redes: desactivar ${label}.`,
          "Comparar CPA y conversiones totales a 14 días.",
        ],
        risk: "moderado",
        priority: "P2",
        confidence: "alta",
        impact: `Reasignar hasta ${ctx.money(m.cost)} al mes hacia Search, que convierte mejor.`,
        metric: "Conversiones totales y CPA de la campaña",
        observation: "14 días",
        rollback: `Reactivar ${label}.`,
        minutes: 5,
        when: "semana",
        stake: m.cost,
        rule: null,
        waste: m.cost,
      });
    }
  }
}

export interface TermAgg {
  campaignId: string;
  term: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  excluded: boolean;
  added: boolean;
  match: Set<string>;
}

/** Términos sumados por campaña (un término aparece por grupo y concordancia en el informe). */
export function aggregateTerms(data: AuditData): TermAgg[] {
  const agg = new Map<string, TermAgg>();
  for (const t of data.searchTerms) {
    const key = `${t.campaignId}~${plain(t.term)}`;
    const a = agg.get(key) ?? {
      campaignId: t.campaignId,
      term: t.term,
      cost: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      excluded: false,
      added: false,
      match: new Set<string>(),
    };
    a.cost += t.cost;
    a.clicks += t.clicks;
    a.impressions += t.impressions;
    a.conversions += t.conversions;
    if (t.status === "EXCLUDED" || t.status === "ADDED_EXCLUDED") a.excluded = true;
    if (t.status === "ADDED" || t.status === "ADDED_EXCLUDED") a.added = true;
    if (t.matchType) a.match.add(t.matchType);
    agg.set(key, a);
  }
  return [...agg.values()];
}

/** Candidatos a negativa: con gasto, sin conversiones, no excluidos ni iguales a una keyword activa. */
export function intentCandidates(
  data: AuditData,
  terms = aggregateTerms(data),
): Array<TermAgg & { category: IntentCategory }> {
  const keywordTexts = new Set(data.keywords.map((k) => plain(k.text)));
  return terms.flatMap((t) => {
    if (t.cost <= 0 || t.conversions > 0 || t.excluded || keywordTexts.has(plain(t.term))) return [];
    const category = INTENT_CATEGORIES.find((c) => c.re.test(plain(t.term)));
    return category ? [{ ...t, category }] : [];
  });
}

function termRules(ctx: Ctx): void {
  const { data } = ctx;
  if (!data.searchTerms.length) return;
  const keywordTexts = new Set(data.keywords.map((k) => plain(k.text)));
  const terms = aggregateTerms(data);
  const totalTermCost = terms.reduce((s, t) => s + t.cost, 0);
  ctx.note(
    "terms",
    `Términos con impresiones en 30 días: ${fmtNum(terms.length)}; gasto cubierto ${ctx.money(totalTermCost)}.${data.truncated.includes("Términos de búsqueda") ? " Lista recortada al límite de filas: se analizaron los de mayor gasto." : ""}`,
  );
  if (terms.some((t) => t.match.has("AI_MAX")))
    ctx.note(
      "terms",
      "Hay tráfico de AI Max: Google aconseja usar negativas con moderación en AI Max y solo ante bajo rendimiento sostenido.",
    );

  const candidates = intentCandidates(data, terms);
  for (const cat of INTENT_CATEGORIES) {
    const hits = candidates.filter((t) => t.category.key === cat.key).sort((a, b) => b.cost - a.cost);
    if (!hits.length) continue;
    const cost = hits.reduce((s, t) => s + t.cost, 0);
    const campaigns = [...new Set(hits.map((t) => ctx.name(t.campaignId)))];
    ctx.add({
      section: "terms",
      campaign: campaigns.length === 1 ? campaigns[0]! : `${campaigns.length} campañas`,
      title: `${plural(hits.length, "término", "términos")} de "${cat.label}" con gasto y sin conversiones`,
      evidence: [
        `Gasto total 30 días: ${ctx.money(cost)}; clics ${fmtNum(hits.reduce((s, t) => s + t.clicks, 0))}; conversiones 0.`,
        ...hits
          .slice(0, 10)
          .map((t) => `"${t.term}" · ${ctx.name(t.campaignId)} · ${ctx.money(t.cost)} · ${fmtNum(t.clicks)} clics`),
        ...(hits.length > 10 ? [`y ${hits.length - 10} términos más (lista completa en el Excel).`] : []),
      ],
      diagnosis: `${cat.why} Ninguno coincide con una keyword activa ni está excluido.`,
      action: `Agregar estos términos como negativas de concordancia exacta en sus campañas (o en una lista de negativas compartida de "${cat.label}").`,
      steps: [
        "Revisar la lista completa en el Excel (hoja Términos candidatos) y quitar cualquier término con intención de compra.",
        "Agregarlos como negativas exactas desde el informe de términos de búsqueda.",
        "Confirmar que ninguna negativa bloquea una keyword activa (diagnóstico de conflictos de negativas).",
      ],
      risk: "bajo",
      priority: "P1",
      confidence: cat.confidence,
      impact: `Evitar alrededor de ${ctx.money(cost)} al mes en búsquedas sin valor comercial.`,
      metric: "Gasto en términos irrelevantes y conversiones totales (no deben bajar)",
      observation: "14 días",
      rollback: "Eliminar las negativas agregadas.",
      minutes: 20,
      when: cat.confidence === "alta" ? "hoy" : "48h",
      stake: cost,
      waste: cost,
      rule: "RULE-GADS-008",
      sources: ["negatives", "negativeConflicts"],
    });
  }

  // Términos que convierten y no están agregados como keyword.
  const winners = terms
    .filter((t) => {
      const campaignCpa = cpa(ctx.summary(t.campaignId)?.w.L30 ?? { cost: 0, conversions: 0 });
      return (
        t.conversions >= 3 &&
        !t.added &&
        !keywordTexts.has(plain(t.term)) &&
        campaignCpa !== null &&
        t.cost / t.conversions <= campaignCpa
      );
    })
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 15);
  if (winners.length)
    ctx.add({
      section: "terms",
      campaign: [...new Set(winners.map((t) => ctx.name(t.campaignId)))].slice(0, 3).join(", "),
      title: plural(
        winners.length,
        "término que convierte mejor que su campaña y no es keyword",
        "términos que convierten mejor que su campaña y no son keyword",
      ),
      evidence: winners.map(
        (t) =>
          `"${t.term}" · ${ctx.name(t.campaignId)} · ${fmtNum(t.conversions, 1)} conv. · CPA ${ctx.money(t.cost / t.conversions)}`,
      ),
      diagnosis:
        "Son búsquedas probadas que hoy llegan por concordancias amplias; agregarlas da control sin quitar tráfico.",
      action: "Agregarlos como keywords de concordancia exacta en el mismo grupo de anuncios donde ya convierten.",
      steps: [
        "Validar la intención de cada término.",
        "Agregar como exacta en el grupo de origen.",
        "No pausar las keywords que los capturaban.",
      ],
      risk: "bajo",
      priority: "P3",
      confidence: "media",
      impact: "Más control y relevancia en búsquedas que ya venden.",
      metric: "Conversiones y CPA de esos términos",
      observation: "14 días",
      rollback: "Pausar las keywords agregadas.",
      minutes: 20,
      when: "semana",
      stake: winners.reduce((s, t) => s + t.cost, 0),
      rule: null,
    });

  const categorized = (t: { term: string }) => INTENT_CATEGORIES.some((c) => c.re.test(plain(t.term)));
  const review = terms
    .filter((t) => t.conversions === 0 && t.clicks >= 20 && !t.excluded && !categorized(t))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
  if (review.length)
    ctx.note(
      "terms",
      `Términos con más gasto sin conversiones y sin intención irrelevante evidente (revisar a mano; no se proponen negativas automáticas): ${review.map((t) => `"${t.term}" ${ctx.money(t.cost)}`).join("; ")}.`,
    );
  const competitionRe = competitionPattern(data.target.name);
  const competition = terms.filter((t) => competitionRe.test(plain(t.term)) && t.cost > 0);
  if (competition.length)
    ctx.note(
      "terms",
      `Búsquedas de competencia o marcas relacionadas: ${competition.length} términos, ${ctx.money(competition.reduce((s, t) => s + t.cost, 0))}, ${fmtNum(
        competition.reduce((s, t) => s + t.conversions, 0),
        1,
      )} conv. Validar la intención; no se proponen negativas.`,
    );
  if (data.pmaxTerms.length) {
    const flagged = data.pmaxTerms.filter(
      (t) => INTENT_CATEGORIES.some((c) => c.re.test(plain(t.term))) && t.conversions === 0,
    );
    ctx.note(
      "terms",
      `Performance Max: ${fmtNum(data.pmaxTerms.length)} términos con impresiones.${
        flagged.length
          ? ` ${flagged.length} con intención irrelevante y sin conversiones (p. ej., ${flagged
              .slice(0, 5)
              .map((t) => `"${t.term}"`)
              .join(", ")}); evaluar negativas de campaña o de cuenta para PMax.`
          : ""
      }`,
    );
  }
}

function keywordRules(ctx: Ctx): void {
  const { data } = ctx;
  if (!data.keywords.length) return;
  const byMatch = new Map<string, { n: number; cost: number }>();
  for (const k of data.keywords) {
    const m = byMatch.get(k.matchType) ?? { n: 0, cost: 0 };
    m.n++;
    m.cost += k.cost;
    byMatch.set(k.matchType, m);
  }
  ctx.note(
    "keywords",
    `Keywords activas: ${fmtNum(data.keywords.length)} (${[...byMatch.entries()].map(([t, m]) => `${t} ${m.n}, ${ctx.money(m.cost)}`).join("; ")}).`,
  );
  const rare = data.keywords.filter((k) => k.servingStatus === "RARELY_SERVED");
  if (rare.length) {
    ctx.note("keywords", `${rare.length} keywords con poco volumen de búsqueda (RARELY_SERVED).`);
    ctx.hold(
      "Varias",
      "Keywords con poco volumen",
      "Google las reactiva si el volumen sube; eliminarlas no mejora el rendimiento.",
    );
  }
  const disapproved = data.keywords.filter((k) => k.approval === "DISAPPROVED");
  if (disapproved.length)
    ctx.add({
      section: "keywords",
      campaign: [...new Set(disapproved.map((k) => ctx.name(k.campaignId)))].slice(0, 3).join(", "),
      title: plural(disapproved.length, "keyword rechazada", "keywords rechazadas"),
      evidence: disapproved.slice(0, 10).map((k) => `[${k.matchType}] ${k.text} · ${k.adGroup}`),
      diagnosis: "Las keywords rechazadas no participan en subastas.",
      action: "Revisar el motivo de política de cada una y corregir o reemplazar el texto.",
      steps: ["Filtrar keywords por estado Rechazada.", "Leer el motivo.", "Corregir o pedir revisión."],
      risk: "bajo",
      priority: "P1",
      confidence: "alta",
      impact: "Recuperar cobertura de búsquedas.",
      metric: "Estado de aprobación",
      observation: "48 horas",
      rollback: "No aplica.",
      minutes: 15,
      when: "hoy",
      stake: 0,
      rule: "RULE-GADS-004",
    });
  // Duplicadas en la misma campaña (mismo texto y concordancia en varios grupos).
  const dup = new Map<string, KeywordRow[]>();
  for (const k of data.keywords) {
    const key = `${k.campaignId}~${plain(k.text)}~${k.matchType}`;
    dup.set(key, [...(dup.get(key) ?? []), k]);
  }
  const dups = [...dup.values()]
    .filter((g) => new Set(g.map((k) => k.adGroupId)).size > 1)
    .sort((a, b) => sumCost(b) - sumCost(a));
  if (dups.length)
    ctx.add({
      section: "keywords",
      campaign: [...new Set(dups.map((g) => ctx.name(g[0]!.campaignId)))].slice(0, 3).join(", "),
      title: `${plural(dups.length, "keyword duplicada", "keywords duplicadas")} entre grupos de la misma campaña`,
      evidence: dups
        .slice(0, 8)
        .map(
          (g) =>
            `[${g[0]!.matchType}] ${g[0]!.text}: ${g.map((k) => `${k.adGroup} (${ctx.money(k.cost)}, ${fmtNum(k.conversions, 1)} conv.)`).join(" | ")}`,
        ),
      diagnosis: "La misma keyword en varios grupos compite consigo misma y reparte el aprendizaje del anuncio.",
      action: "Conservar la versión con más conversiones y pausar las demás, una campaña a la vez.",
      steps: [
        "Elegir la versión que conserva (más conversiones y mejor anuncio).",
        "Pausar las duplicadas (no eliminarlas).",
        "Vigilar volumen 14 días.",
      ],
      risk: "moderado",
      priority: "P3",
      confidence: "media",
      impact: "Menos canibalización y lectura más clara.",
      metric: "Impresiones y conversiones de la keyword conservada",
      observation: "14 días",
      rollback: "Reactivar las keywords pausadas.",
      minutes: 30,
      when: "semana",
      stake: dups.reduce((s, g) => s + sumCost(g), 0),
      rule: null,
    });
  // Keywords con gasto alto y sin conversiones.
  const costly = data.keywords
    .filter((k) => {
      const campaignCpa = cpa(ctx.summary(k.campaignId)?.w.L30 ?? { cost: 0, conversions: 0 });
      return k.conversions === 0 && campaignCpa !== null && k.cost >= 2 * campaignCpa && k.clicks >= 30;
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
  if (costly.length)
    ctx.add({
      section: "keywords",
      campaign: [...new Set(costly.map((k) => ctx.name(k.campaignId)))].slice(0, 3).join(", "),
      title: `${plural(costly.length, "keyword gasta", "keywords gastan")} más de 2 veces el CPA de su campaña sin convertir`,
      evidence: costly.map(
        (k) => `[${k.matchType}] ${k.text} · ${k.adGroup} · ${ctx.money(k.cost)} · ${fmtNum(k.clicks)} clics`,
      ),
      diagnosis:
        "Con Smart Bidding no se ajusta la puja por keyword; antes de pausar hay que ver qué búsquedas activan esas keywords.",
      action:
        "Revisar sus términos de búsqueda: negativizar los irrelevantes y solo después evaluar pausar la keyword.",
      steps: [
        "Filtrar el informe de términos por cada keyword.",
        "Agregar negativas a términos sin intención.",
        "Pausar la keyword si sigue sin convertir 14 días más.",
      ],
      risk: "moderado",
      priority: "P3",
      confidence: "media",
      impact: `Reducir hasta ${ctx.money(costly.reduce((s, k) => s + k.cost, 0))} al mes sin señal de venta.`,
      metric: "Gasto y conversiones de esas keywords",
      observation: "14 días",
      rollback: "Reactivar la keyword o quitar las negativas.",
      minutes: 30,
      when: "semana",
      stake: costly.reduce((s, k) => s + k.cost, 0),
      waste: costly.reduce((s, k) => s + k.cost, 0),
      rule: null,
    });
}

const sumCost = (g: KeywordRow[]) => g.reduce((s, k) => s + k.cost, 0);

const COMPONENTS: Array<{
  field: "expectedCtr" | "adRelevance" | "landingExperience";
  label: string;
  action: string;
  steps: string[];
}> = [
  {
    field: "expectedCtr",
    label: "CTR esperado",
    action:
      "Reescribir títulos con un beneficio concreto de la oferta y una llamada a la acción clara, sin eliminar los títulos con buen rendimiento.",
    steps: [
      "Identificar los grupos con más gasto afectado.",
      "Agregar 3 a 5 títulos nuevos con beneficio y precio u oferta vigente.",
      "Revisar CTR a 14 días.",
    ],
  },
  {
    field: "adRelevance",
    label: "relevancia del anuncio",
    action:
      "Usar en los títulos el lenguaje de la keyword y, si el grupo mezcla intenciones, separar las keywords en un grupo propio.",
    steps: [
      "Comparar keywords y títulos del grupo.",
      "Agregar títulos con la keyword principal.",
      "Separar el grupo solo si mezcla intenciones distintas.",
    ],
  },
  {
    field: "landingExperience",
    label: "experiencia en la página de destino",
    action: "Alinear el mensaje de la página con el anuncio y revisar velocidad móvil de esas URLs (ver sección URLs).",
    steps: [
      "Abrir la página de cada grupo afectado en móvil.",
      "Confirmar que la oferta del anuncio aparece arriba.",
      "Escalar al equipo web los problemas de velocidad.",
    ],
  },
];

function qualityRules(ctx: Ctx): void {
  const scored = ctx.data.keywords.filter((k) => k.qualityScore !== null && k.impressions > 0);
  if (!scored.length) return;
  const cost = scored.reduce((s, k) => s + k.cost, 0);
  const weighted = cost > 0 ? scored.reduce((s, k) => s + (k.qualityScore ?? 0) * k.cost, 0) / cost : null;
  ctx.note(
    "keywords",
    `Quality Score ponderado por gasto: ${fmtNum(weighted, 1)} (sobre ${fmtNum(scored.length)} keywords con impresiones).`,
  );
  const searchCost = ctx.campaigns
    .filter((s) => s.info.channel === "SEARCH" && shouldServe(s.info, ctx.data.end))
    .reduce((s, c) => s + c.w.L30.cost, 0);
  for (const comp of COMPONENTS) {
    const weak = scored.filter((k) => k[comp.field] === "BELOW_AVERAGE").sort((a, b) => b.cost - a.cost);
    const weakCost = weak.reduce((s, k) => s + k.cost, 0);
    if (weak.length < 3 || weakCost < searchCost * 0.05) continue;
    ctx.add({
      section: "keywords",
      campaign: [...new Set(weak.map((k) => ctx.name(k.campaignId)))].slice(0, 3).join(", "),
      title: `${plural(weak.length, "keyword", "keywords")} con ${comp.label} inferior al promedio`,
      evidence: [
        `Gasto afectado 30 días: ${ctx.money(weakCost)} (${fmtPct(searchCost > 0 ? weakCost / searchCost : null, 0)} del gasto de Search).`,
        ...weak
          .slice(0, 8)
          .map((k) => `[${k.matchType}] ${k.text} · ${k.adGroup} · QS ${k.qualityScore} · ${ctx.money(k.cost)}`),
      ],
      diagnosis: `El componente débil es ${comp.label}; Google lo señala como "Inferior al promedio" frente a otros anunciantes.`,
      action: comp.action,
      steps: comp.steps,
      risk: "bajo",
      priority: "P2",
      confidence: "alta",
      impact: "Mejor Ad Rank al mismo costo y menor cuota perdida por ranking.",
      metric: `${comp.label} y CPC promedio de esas keywords`,
      observation: "14 a 28 días (el Quality Score se actualiza con nuevos datos)",
      rollback: "Pausar los textos nuevos; no se elimina nada existente.",
      minutes: 60,
      when: "semana",
      stake: weakCost,
      rule: null,
      sources: ["qualityScore", "qualityScoreUse"],
    });
  }
}
