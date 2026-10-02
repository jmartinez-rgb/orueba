import { shouldServe } from "./aggregate.js";
import { fmtNum, fmtPct, type Ctx, plural } from "./context.js";
import { plain } from "./rules-search.js";
import type { AdRow, AssetGroupRow, AssetLink } from "./types.js";

const CTA =
  /\b(contrata|contratalo|llama|llamanos|cotiza|solicita|aprovecha|compra|conoce|obten|pide|visita|descubre|suscribete|activa|elige|cambiate|ahorra|disfruta|consulta|registrate|adquiere)\b/;
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function creativeRules(ctx: Ctx): void {
  rsaRules(ctx);
  assetRules(ctx);
  pmaxRules(ctx);
}

function rsaRules(ctx: Ctx): void {
  const { data } = ctx;
  const searchIds = new Set(
    ctx.campaigns.filter((s) => s.info.channel === "SEARCH" && shouldServe(s.info, data.end)).map((s) => s.info.id),
  );
  const rsas = data.ads.filter((a) => a.type === "RESPONSIVE_SEARCH_AD" && searchIds.has(a.campaignId));
  // Rechazos de política en cualquier anuncio activo.
  const disapproved = data.ads.filter((a) => a.approval === "DISAPPROVED");
  if (disapproved.length) {
    const approvedByGroup = new Set(
      data.ads.filter((a) => a.approval === "APPROVED" || a.approval === "APPROVED_LIMITED").map((a) => a.adGroupId),
    );
    const blocking = disapproved.filter((a) => !approvedByGroup.has(a.adGroupId));
    ctx.add({
      section: "creatives",
      campaign: [...new Set(disapproved.map((a) => ctx.name(a.campaignId)))].slice(0, 3).join(", "),
      title: `${plural(disapproved.length, "anuncio activo rechazado", "anuncios activos rechazados")}${blocking.length ? ` (${plural(new Set(blocking.map((a) => a.adGroupId)).size, "grupo sin ningún anuncio aprobado", "grupos sin ningún anuncio aprobado")})` : ""}`,
      evidence: disapproved
        .slice(0, 10)
        .map(
          (a) =>
            `${ctx.name(a.campaignId)} · ${a.adGroup} · anuncio ${a.adId} · ${a.topics.join(", ") || "motivo s/d"}`,
        ),
      diagnosis: blocking.length
        ? "Hay grupos de anuncios que no pueden entregar porque su único anuncio está rechazado."
        : "Los anuncios rechazados no entregan; el grupo depende de los demás anuncios.",
      action:
        "Corregir el texto o la URL según el motivo de política y solicitar revisión; no eliminar los anuncios aprobados.",
      steps: [
        "Filtrar anuncios por estado Rechazado.",
        "Leer el tema de política de cada uno.",
        "Editar o crear una versión corregida y pedir revisión.",
      ],
      risk: "bajo",
      priority: blocking.length ? "P0" : "P1",
      confidence: "alta",
      impact: "Recuperar entrega y combinaciones de anuncio.",
      metric: "Estado de aprobación e impresiones del grupo",
      observation: "48 horas",
      rollback: "No aplica.",
      minutes: 30,
      when: "hoy",
      stake: disapproved.reduce((s, a) => s + a.cost, 0),
      rule: "RULE-GADS-004",
    });
  }
  const limited = data.ads.filter((a) => a.approval === "APPROVED_LIMITED");
  if (limited.length)
    ctx.note(
      "creatives",
      `${limited.length} anuncios aprobados con limitaciones (temas: ${[...new Set(limited.flatMap((a) => a.topics))].slice(0, 6).join(", ") || "s/d"}).`,
    );
  if (!rsas.length) return;
  const avg = (f: (a: AdRow) => number) => rsas.reduce((s, a) => s + f(a), 0) / rsas.length;
  ctx.note(
    "creatives",
    `RSA activos en Search: ${rsas.length}; promedio ${fmtNum(
      avg((a) => a.headlines.length),
      1,
    )} títulos y ${fmtNum(
      avg((a) => a.descriptions.length),
      1,
    )} descripciones; Ad Strength: ${strengthMix(rsas.map((a) => a.strength))}.`,
  );
  const incomplete = rsas.filter((a) => a.headlines.length < 15 || a.descriptions.length < 4);
  const weak = rsas.filter((a) => a.strength === "POOR" || a.strength === "AVERAGE");
  const targets = [...new Map([...incomplete, ...weak].map((a) => [a.adId, a])).values()].sort(
    (a, b) => b.cost - a.cost,
  );
  if (targets.length) {
    const dupCount = (a: AdRow) => a.headlines.length - new Set(a.headlines.map((h) => plain(h.text))).size;
    ctx.add({
      section: "creatives",
      campaign: [...new Set(targets.map((a) => ctx.name(a.campaignId)))].slice(0, 3).join(", "),
      title: `${targets.length} RSA con recursos incompletos o Ad Strength Deficiente/Promedio`,
      evidence: [
        `Con menos de 15 títulos o 4 descripciones: ${incomplete.length}; Ad Strength Deficiente o Promedio: ${weak.length}.`,
        `Gasto 30 días de esos anuncios: ${ctx.money(targets.reduce((s, a) => s + a.cost, 0))}.`,
        ...targets
          .slice(0, 8)
          .map(
            (a) =>
              `${ctx.name(a.campaignId)} · ${a.adGroup} · ${a.headlines.length} títulos / ${a.descriptions.length} descripciones · ${a.strength ?? "s/d"}${dupCount(a) ? ` · ${dupCount(a)} títulos repetidos` : ""} · ${ctx.money(a.cost)}`,
          ),
      ],
      diagnosis:
        "Google combina hasta 15 títulos y 4 descripciones; con menos recursos únicos hay menos combinaciones para cada búsqueda.",
      action:
        "Agregar títulos y descripciones únicos (beneficio, oferta vigente, prueba social, llamada a la acción) hasta completar 15 y 4, sin eliminar los recursos con buen rendimiento.",
      steps: [
        "Empezar por los anuncios con más gasto de la lista.",
        "Agregar títulos distintos entre sí (no variaciones mínimas) y al menos una descripción con llamada a la acción.",
        "No quitar recursos con etiqueta Mejor o Bueno; revisar Ad Strength y CTR a 14 días.",
      ],
      risk: "bajo",
      priority: "P1",
      confidence: "alta",
      impact:
        "Más combinaciones relevantes y mejor Ad Strength; Google reporta más clics y conversiones al pasar de Deficiente a Excelente.",
      metric: "Ad Strength, CTR y tasa de conversión del anuncio",
      observation: "14 días",
      rollback: "Quitar los recursos agregados.",
      minutes: Math.min(240, 15 * new Set(targets.map((a) => a.adGroupId)).size),
      when: "hoy",
      stake: targets.reduce((s, a) => s + a.cost, 0),
      rule: null,
      sources: ["rsa", "adStrength", "rsaBest"],
    });
  }
  const pinned = rsas.filter(
    (a) => a.headlines.length > 0 && a.headlines.filter((h) => h.pinned).length / a.headlines.length >= 0.5,
  );
  if (pinned.length)
    ctx.add({
      section: "creatives",
      campaign: [...new Set(pinned.map((a) => ctx.name(a.campaignId)))].slice(0, 3).join(", "),
      title: `${pinned.length} RSA con la mitad o más de sus títulos fijados`,
      evidence: pinned
        .slice(0, 6)
        .map(
          (a) => `${a.adGroup}: ${a.headlines.filter((h) => h.pinned).length} de ${a.headlines.length} títulos fijados`,
        ),
      diagnosis:
        "Fijar reduce las combinaciones disponibles; Google no lo recomienda para la mayoría de los anunciantes salvo textos obligatorios.",
      action:
        "Dejar fijado solo el texto obligatorio (marca o aviso legal) y, si se fija, poner 2 o 3 opciones por posición.",
      steps: [
        "Confirmar qué fijados son obligatorios por marca o legal.",
        "Desfijar el resto en un anuncio de prueba primero.",
      ],
      risk: "bajo",
      priority: "P3",
      confidence: "media",
      impact: "Más combinaciones para el sistema.",
      metric: "CTR y Ad Strength",
      observation: "14 días",
      rollback: "Volver a fijar.",
      minutes: 20,
      when: "semana",
      stake: pinned.reduce((s, a) => s + a.cost, 0),
      rule: null,
      sources: ["rsa"],
    });
  const noCta = rsas.filter(
    (a) =>
      a.descriptions.length &&
      !a.descriptions.some((d) => CTA.test(plain(d.text))) &&
      !a.headlines.some((h) => CTA.test(plain(h.text))),
  );
  if (noCta.length)
    ctx.note(
      "creatives",
      `${noCta.length} RSA sin una llamada a la acción reconocible en títulos o descripciones (p. ej., ${noCta
        .slice(0, 3)
        .map((a) => a.adGroup)
        .join(", ")}).`,
    );
  const low = rsas.filter((a) => [...a.headlines, ...a.descriptions].some((x) => x.label === "LOW"));
  if (low.length)
    ctx.note(
      "creatives",
      `${low.length} RSA tienen recursos con etiqueta de rendimiento Bajo: reemplazarlos agregando primero la alternativa y luego quitando el recurso Bajo.`,
    );
}

function strengthMix(values: Array<string | null>): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v ?? "s/d", (counts.get(v ?? "s/d") ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
}

/** Recursos elegibles del tipo para la campaña: campaña, si no cuenta; los de grupo se informan aparte. */
function effective(assets: AssetLink[], campaignId: string, field: string) {
  const ok = (a: AssetLink) =>
    a.fieldType === field &&
    a.approval !== "DISAPPROVED" &&
    a.primaryStatus !== "NOT_ELIGIBLE" &&
    a.primaryStatus !== "REMOVED";
  const campaign = assets.filter((a) => a.level === "campaign" && a.campaignId === campaignId && ok(a)).length;
  const account = assets.filter((a) => a.level === "account" && ok(a)).length;
  const adGroup = assets.filter((a) => a.level === "ad_group" && a.campaignId === campaignId && ok(a)).length;
  return {
    count: campaign || account,
    level: campaign ? "campaña" : account ? "cuenta" : adGroup ? "grupo" : "ninguno",
    adGroup,
  };
}

const ASSET_CHECKS: Array<{
  field: string;
  label: string;
  min: number;
  priority: "P1" | "P3";
  source: "sitelinks" | "callouts" | "snippets" | "assetTypes";
  why: string;
}> = [
  {
    field: "SITELINK",
    label: "sitelinks",
    min: 4,
    priority: "P1",
    source: "sitelinks",
    why: "Google recomienda al menos 4 sitelinks (6 en campañas de alto volumen).",
  },
  {
    field: "CALLOUT",
    label: "textos destacados",
    min: 4,
    priority: "P1",
    source: "callouts",
    why: "Google recomienda al menos 4 textos destacados para que se muestren con más frecuencia.",
  },
  {
    field: "STRUCTURED_SNIPPET",
    label: "fragmentos estructurados",
    min: 1,
    priority: "P1",
    source: "snippets",
    why: "Agregan detalle de planes o servicios y ocupan más espacio en el anuncio.",
  },
  {
    field: "AD_IMAGE",
    label: "imágenes",
    min: 1,
    priority: "P3",
    source: "assetTypes",
    why: "Google sugiere usar 4 o más tipos de recursos, incluidas imágenes.",
  },
  {
    field: "BUSINESS_LOGO",
    label: "logotipo de la empresa",
    min: 1,
    priority: "P3",
    source: "assetTypes",
    why: "Refuerza la marca en el anuncio.",
  },
];

function assetRules(ctx: Ctx): void {
  const { data } = ctx;
  const search = ctx.campaigns.filter(
    (s) => s.info.channel === "SEARCH" && shouldServe(s.info, data.end) && s.w.L30.cost > 0,
  );
  // Sin la lectura de assets no se puede afirmar que falten: se omite la revisión de cobertura.
  const assetsRead = !data.unavailable.some(
    (u) => u.section === "Assets de la cuenta" || u.section === "Assets de campaña",
  );
  if (!assetsRead) ctx.note("assets", "No se pudo leer la cobertura de assets; la revisión de faltantes se omitió.");
  for (const check of assetsRead ? ASSET_CHECKS : []) {
    const short = search
      .map((s) => ({ s, e: effective(data.assets, s.info.id, check.field) }))
      .filter(({ e }) => e.count < check.min && !(e.level === "grupo" && check.field !== "SITELINK"));
    if (!short.length) continue;
    ctx.add({
      section: "assets",
      campaign: short.length === 1 ? short[0]!.s.info.name : `${short.length} campañas Search`,
      title:
        check.min === 1
          ? `Sin ${check.label} en ${plural(short.length, "campaña Search", "campañas Search")}`
          : `${check.label[0]!.toUpperCase()}${check.label.slice(1)} por debajo de ${check.min} en ${plural(short.length, "campaña Search", "campañas Search")}`,
      evidence: short
        .sort((a, b) => b.s.w.L30.cost - a.s.w.L30.cost)
        .slice(0, 10)
        .map(
          ({ s, e }) =>
            `${s.info.name}: ${e.count} (${e.level}${e.adGroup ? `; ${e.adGroup} a nivel grupo` : ""}) · gasto 30 días ${ctx.money(s.w.L30.cost)}`,
        ),
      diagnosis: check.why,
      action:
        check.min === 1
          ? `Agregar ${check.label} a nivel campaña (o cuenta, si aplica a todas).`
          : `Agregar ${check.label} vigentes hasta tener al menos ${check.min} a nivel campaña (o cuenta, si aplican a todas).`,
      steps: [
        "Redactar con ofertas y beneficios vigentes (sin fechas vencidas).",
        "Agregar a nivel campaña en las de mayor gasto primero.",
        "Confirmar aprobación a las 24 horas.",
      ],
      risk: "bajo",
      priority: check.priority,
      confidence: "alta",
      impact: "Anuncios más grandes y con más información, sin afectar la puja.",
      metric: "CTR de la campaña e impresiones con recursos",
      observation: "14 días",
      rollback: "Pausar los recursos agregados.",
      minutes: 10 * short.length,
      when: check.priority === "P1" ? "hoy" : "semana",
      stake: short.reduce((sum, { s }) => sum + s.w.L30.cost, 0),
      rule: null,
      sources: [check.source],
    });
  }
  const bad = data.assets.filter((a) => a.approval === "DISAPPROVED" || a.primaryStatus === "NOT_ELIGIBLE");
  if (bad.length)
    ctx.add({
      section: "assets",
      campaign: "Varias",
      title: plural(bad.length, "recurso rechazado o no elegible", "recursos rechazados o no elegibles"),
      evidence: bad
        .slice(0, 10)
        .map(
          (a) =>
            `${a.fieldType} · ${a.level}${a.campaignId ? ` · ${ctx.name(a.campaignId)}` : ""} · ${a.text ?? `recurso ${a.assetId}`}`,
        ),
      diagnosis: "Los recursos rechazados no se muestran y pueden dejar campañas sin sitelinks o textos destacados.",
      action: "Corregir el texto o la URL del recurso según la política y pedir revisión.",
      steps: ["Filtrar recursos por estado.", "Leer el motivo.", "Corregir o reemplazar."],
      risk: "bajo",
      priority: "P1",
      confidence: "alta",
      impact: "Recuperar cobertura de recursos.",
      metric: "Estado de aprobación",
      observation: "48 horas",
      rollback: "No aplica.",
      minutes: 20,
      when: "hoy",
      stake: 0,
      rule: "RULE-GADS-004",
    });
  const year = Number(data.end.slice(0, 4)),
    month = Number(data.end.slice(5, 7)) - 1;
  const allowed = new Set([MONTHS[month]!, MONTHS[(month + 1) % 12]!]);
  const stale = data.assets.filter((a) => {
    if (a.endDate && a.endDate.slice(0, 10) < data.end) return true;
    const t = a.text ? plain(a.text) : "";
    const years = [...t.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
    return MONTHS.some((m) => new RegExp(`\\b${m}\\b`).test(t) && !allowed.has(m)) || years.some((y) => y < year);
  });
  if (stale.length)
    ctx.add({
      section: "assets",
      campaign: "Varias",
      title: plural(
        stale.length,
        "recurso vencido o con fechas que parecen desactualizadas",
        "recursos vencidos o con fechas que parecen desactualizadas",
      ),
      evidence: stale
        .slice(0, 10)
        .map((a) => `${a.fieldType} · ${a.text ?? `recurso ${a.assetId}`}${a.endDate ? ` · fin ${a.endDate}` : ""}`),
      diagnosis:
        "Un recurso con fecha de fin pasada ya no se muestra; uno que menciona un mes o año anterior puede comunicar una oferta vencida.",
      action: "Reemplazar por textos vigentes; validar con el equipo comercial las ofertas actuales.",
      steps: ["Revisar la lista con comercial.", "Crear el recurso vigente antes de pausar el anterior."],
      risk: "bajo",
      priority: "P1",
      confidence: "media",
      impact: "Mensajes vigentes y coherentes con la oferta.",
      metric: "Cobertura de recursos y CTR",
      observation: "14 días",
      rollback: "Reactivar el recurso anterior.",
      minutes: 20,
      when: "48h",
      stake: 0,
      rule: null,
    });
}

const PMAX_RECOMMENDED: Array<{ field: string; label: string; target: number }> = [
  { field: "HEADLINE", label: "títulos", target: 15 },
  { field: "LONG_HEADLINE", label: "títulos largos", target: 5 },
  { field: "DESCRIPTION", label: "descripciones", target: 5 },
];
const PMAX_FORMATS: Array<{ field: string; label: string }> = [
  { field: "MARKETING_IMAGE", label: "imagen horizontal" },
  { field: "SQUARE_MARKETING_IMAGE", label: "imagen cuadrada" },
  { field: "PORTRAIT_MARKETING_IMAGE", label: "imagen vertical" },
  { field: "LOGO", label: "logotipo" },
  { field: "BUSINESS_NAME", label: "nombre de la empresa" },
  { field: "YOUTUBE_VIDEO", label: "video propio" },
];
const IRRELEVANT_PATH =
  /\/(empleo|empleos|vacantes|bolsa-de-trabajo|trabaja-con-nosotros|ayuda|soporte|faq|preguntas-frecuentes|aviso-de-privacidad|privacidad|terminos|legal|blog|factura|pago|pagos|mi-cuenta)(\/|$|\?)/i;

function pmaxRules(ctx: Ctx): void {
  const { data } = ctx;
  const pmax = ctx.campaigns.filter((s) => s.info.channel === "PERFORMANCE_MAX" && shouldServe(s.info, data.end));
  if (!pmax.length) return;
  if (pmax.every((s) => !s.info.merchantId))
    ctx.note("pmax", "Sin feed de Merchant Center vinculado: Listing Groups y productos no aplican.");
  for (const s of pmax)
    ctx.note(
      "pmax",
      `${s.info.name}: expansión de URL final ${s.info.finalUrlExpansion === null ? "s/d" : s.info.finalUrlExpansion ? "activada" : "desactivada"}; gasto 30 días ${ctx.money(s.w.L30.cost)}; ${fmtNum(s.w.L30.conversions, 1)} conv.; ventas ${fmtNum(s.w.L30.sales, 1)}.`,
    );
  const ids = new Set(pmax.map((s) => s.info.id));
  const groups = data.assetGroups.filter((g) => ids.has(g.campaignId) && g.status === "ENABLED");
  const blocked = groups.filter(
    (g) => g.primaryStatus === "NOT_ELIGIBLE" || g.reasons.includes("ASSET_GROUP_DISAPPROVED"),
  );
  if (blocked.length)
    ctx.add({
      section: "pmax",
      campaign: [...new Set(blocked.map((g) => ctx.name(g.campaignId)))].join(", "),
      title: plural(
        blocked.length,
        "grupo de recursos no elegible o rechazado",
        "grupos de recursos no elegibles o rechazados",
      ),
      evidence: blocked.map((g) => `${g.name}: ${g.primaryStatus ?? "s/d"} (${g.reasons.join(", ") || "s/d"})`),
      diagnosis: "El grupo no entrega hasta corregir el rechazo.",
      action: "Corregir los recursos rechazados del grupo y pedir revisión.",
      steps: ["Abrir el grupo y filtrar recursos rechazados.", "Reemplazar o corregir.", "Pedir revisión."],
      risk: "bajo",
      priority: "P0",
      confidence: "alta",
      impact: "Recuperar entrega del grupo.",
      metric: "Estado del grupo e impresiones",
      observation: "48 horas",
      rollback: "No aplica.",
      minutes: 30,
      when: "hoy",
      stake: blocked.reduce((sum, g) => sum + g.cost, 0),
      rule: "RULE-GADS-004",
    });
  const gaps = (data.assetGroupAssets.length ? groups : [])
    .map((g) => ({ g, gaps: groupGaps(ctx, g) }))
    .filter((x) => x.gaps.length || x.g.strength === "POOR" || x.g.strength === "AVERAGE")
    .sort((a, b) => b.g.cost - a.g.cost);
  if (gaps.length)
    ctx.add({
      section: "pmax",
      campaign: [...new Set(gaps.map((x) => ctx.name(x.g.campaignId)))].slice(0, 3).join(", "),
      title: plural(
        gaps.length,
        "grupo de recursos con textos o formatos faltantes",
        "grupos de recursos con textos o formatos faltantes",
      ),
      evidence: gaps
        .slice(0, 10)
        .map(
          ({ g, gaps: list }) =>
            `${g.name} · Ad Strength ${g.strength ?? "s/d"} · ${ctx.money(g.cost)} · falta: ${list.join(", ") || "mejorar calidad de recursos"}`,
        ),
      diagnosis:
        "Google recomienda hasta 15 títulos, 5 títulos largos, 5 descripciones, imágenes en las tres orientaciones y videos propios; sin video propio, Google genera videos automáticamente.",
      action:
        "Completar textos y formatos faltantes empezando por los grupos con más gasto, sin quitar recursos con buen rendimiento.",
      steps: [
        "Agregar primero textos (inmediato).",
        "Solicitar a diseño las imágenes y videos faltantes por orientación.",
        "Revisar Ad Strength y conversiones a 14 días.",
      ],
      risk: "bajo",
      priority: "P1",
      confidence: "alta",
      impact: "Más inventario y combinaciones de calidad en todos los canales.",
      metric: "Ad Strength y conversiones del grupo",
      observation: "14 días",
      rollback: "Pausar los recursos agregados.",
      minutes: 20 * gaps.length,
      when: "hoy",
      stake: gaps.reduce((sum, x) => sum + x.g.cost, 0),
      rule: null,
      sources: ["pmaxSpecs", "pmaxCreative", "pmaxAdStrength"],
    });
  const rejectedAssets = data.assetGroupAssets.filter(
    (a) => groups.some((g) => g.id === a.assetGroupId) && a.approval === "DISAPPROVED",
  );
  if (rejectedAssets.length)
    ctx.note("pmax", `${rejectedAssets.length} recursos rechazados dentro de grupos de recursos activos.`);
  const noThemes = groups.filter((g) => !data.signals.some((x) => x.assetGroupId === g.id && x.searchTheme));
  const noAudience = groups.filter((g) => !data.signals.some((x) => x.assetGroupId === g.id && x.audience));
  if (noThemes.length || noAudience.length)
    ctx.add({
      section: "pmax",
      campaign: [...new Set([...noThemes, ...noAudience].map((g) => ctx.name(g.campaignId)))].slice(0, 3).join(", "),
      title: `Señales incompletas: ${plural(noThemes.length, "grupo", "grupos")} sin temas de búsqueda y ${plural(noAudience.length, "grupo", "grupos")} sin señal de audiencia`,
      evidence: [
        ...noThemes.slice(0, 5).map((g) => `Sin temas de búsqueda: ${g.name}`),
        ...noAudience.slice(0, 5).map((g) => `Sin señal de audiencia: ${g.name}`),
      ],
      diagnosis:
        "Los temas de búsqueda (hasta 50 por grupo) y las señales de audiencia orientan el aprendizaje; no restringen la entrega.",
      action: "Agregar temas con los términos que ya venden en Search y una señal con listas de clientes o visitantes.",
      steps: [
        "Tomar los términos con conversiones del informe de Search.",
        "Agregarlos como temas del grupo correspondiente.",
        "Agregar una señal de audiencia con datos propios.",
      ],
      risk: "bajo",
      priority: "P3",
      confidence: "media",
      impact: "Aprendizaje más rápido hacia búsquedas de alto valor.",
      metric: "Conversiones y CPA del grupo",
      observation: "14 a 28 días",
      rollback: "Quitar las señales agregadas.",
      minutes: 30,
      when: "semana",
      stake: [...new Set([...noThemes, ...noAudience])].reduce((sum, g) => sum + g.cost, 0),
      rule: null,
      sources: ["searchThemes"],
    });
  if (pmax.some((s) => s.info.finalUrlExpansion)) {
    const pages = data.landing.filter((l) => l.cost > 0 && IRRELEVANT_PATH.test(l.url));
    if (pages.length)
      ctx.add({
        section: "pmax",
        campaign: pmax
          .filter((s) => s.info.finalUrlExpansion)
          .map((s) => s.info.name)
          .join(", "),
        title: `${plural(pages.length, "página sin intención de compra recibe", "páginas sin intención de compra reciben")} gasto con la expansión de URL activa`,
        evidence: pages
          .slice(0, 10)
          .map(
            (l) => `${l.url} · ${ctx.money(l.cost)} · ${fmtNum(l.clicks)} clics · ${fmtNum(l.conversions, 1)} conv.`,
          ),
        diagnosis: "La expansión de URL puede llevar tráfico a páginas de ayuda, empleo o legales que no convierten.",
        action: "Agregar exclusiones de URL para esas rutas manteniendo la expansión activa, como recomienda Google.",
        steps: [
          "Configuración de la campaña > Expansión de URL > Exclusiones.",
          "Agregar las rutas de la lista.",
          "Revisar el informe de páginas de destino a 14 días.",
        ],
        risk: "bajo",
        priority: "P1",
        confidence: "media",
        impact: `Redirigir alrededor de ${ctx.money(pages.reduce((s, l) => s + l.cost, 0))} al mes a páginas que venden.`,
        metric: "Gasto en páginas excluidas y conversiones de la campaña",
        observation: "14 días",
        rollback: "Quitar las exclusiones.",
        minutes: 15,
        when: "hoy",
        stake: pages.reduce((s, l) => s + l.cost, 0),
        waste: pages.reduce((s, l) => s + l.cost, 0),
        rule: null,
        sources: ["finalUrlExpansion"],
      });
  }
  for (const s of pmax) {
    const own = groups.filter((g) => g.campaignId === s.info.id);
    const total = own.reduce((sum, g) => sum + g.cost, 0);
    const idle = own.filter((g) => total > 0 && g.cost / total >= 0.2 && g.conversions === 0);
    if (idle.length)
      ctx.note(
        "pmax",
        `${s.info.name}: ${idle.map((g) => `${g.name} (${fmtPct(g.cost / total, 0)} del gasto, 0 conv.)`).join(", ")} — investigar antes de pausar.`,
      );
  }
}

function groupGaps(ctx: Ctx, g: AssetGroupRow): string[] {
  const own = ctx.data.assetGroupAssets.filter((a) => a.assetGroupId === g.id && a.approval !== "DISAPPROVED");
  const count = (field: string, advertiserOnly = true) =>
    own.filter((a) => a.fieldType === field && (!advertiserOnly || a.source !== "AUTOMATICALLY_CREATED")).length;
  const gaps: string[] = [];
  for (const r of PMAX_RECOMMENDED) {
    const n = count(r.field);
    if (n < r.target) gaps.push(`${r.target - n} ${r.label}`);
  }
  for (const f of PMAX_FORMATS) if (!count(f.field)) gaps.push(f.label);
  return gaps;
}
