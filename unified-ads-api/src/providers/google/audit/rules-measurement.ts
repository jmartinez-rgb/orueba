import { cpa, isLeadAction, isSalesAction, VALID_OFFLINE, LEAD_ACTION, SALES_ACTION } from "./aggregate.js";
import { CRITERIA, fmtDelta, fmtNum, type Ctx } from "./context.js";
import { shiftDate } from "./queries.js";
import type { AuditData, ChangeRow, ConversionActionInfo } from "./types.js";

const MICRO = new Set(["PAGE_VIEW", "ENGAGEMENT", "OUTBOUND_CLICK", "ADD_TO_CART", "BEGIN_CHECKOUT", "GET_DIRECTIONS"]);
const OFFLINE_TYPES = new Set(["UPLOAD_CLICKS", "UPLOAD_CALLS", "STORE_SALES_DIRECT_UPLOAD", "SALESFORCE"]);
const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ActionStats {
  l30: number;
  p30: number;
  l7: number;
  prev23: number;
}

/** Conversiones por acción (todas las campañas) en las ventanas que usa la revisión de seguimiento. */
export function actionStatsFor(data: AuditData): Map<string, ActionStats> {
  if (!data.end) return new Map();
  const l30 = shiftDate(data.end, -29),
    p30from = shiftDate(data.end, -59),
    l7 = shiftDate(data.end, -6);
  const out = new Map<string, ActionStats>();
  for (const a of data.actionsDaily) {
    const s = out.get(a.actionName) ?? { l30: 0, p30: 0, l7: 0, prev23: 0 };
    const n = a.conversions > 0 ? a.conversions : a.allConversions;
    if (a.date >= l30) s.l30 += n;
    else if (a.date >= p30from) s.p30 += n;
    if (a.date >= l7) s.l7 += n;
    else if (a.date >= l30) s.prev23 += n;
    out.set(a.actionName, s);
  }
  return out;
}

export function conversionRules(ctx: Ctx): void {
  const { data } = ctx;
  const customer = data.customer;
  const stake = ctx.account.L30.cost;
  if (customer?.autoTagging === false)
    ctx.add({
      section: "conversions",
      campaign: "Cuenta",
      title: "Etiquetado automático (GCLID) desactivado",
      evidence: ["customer.auto_tagging_enabled = false."],
      diagnosis:
        "Las conversiones offline por clic (MCC_Offline_Purchase y MCC_Offline_Lead_Contact) dependen del GCLID en la URL; sin etiquetado automático la importación pierde coincidencias.",
      action:
        "Activar el etiquetado automático en la configuración de la cuenta y confirmar que las páginas conservan el parámetro gclid.",
      steps: [
        "Configuración de la cuenta > Etiquetado automático > activar.",
        "Abrir una página de destino desde un anuncio de prueba y confirmar que conserva gclid tras redirecciones.",
        "Avisar al equipo que carga las conversiones offline.",
      ],
      risk: "bajo",
      priority: "P0",
      confidence: "alta",
      impact: "Recuperar la atribución de ventas y leads offline.",
      metric: "Conversiones offline importadas y tasa de coincidencia",
      observation: "7 días (por el retraso de carga)",
      rollback: "Desactivar de nuevo si alguna página falla con el parámetro.",
      minutes: 15,
      when: "hoy",
      stake,
      rule: null,
    });
  if (customer?.trackingStatus === "NOT_CONVERSION_TRACKED")
    ctx.add({
      section: "conversions",
      campaign: "Cuenta",
      title: "La cuenta no registra seguimiento de conversiones",
      evidence: ["conversion_tracking_status = NOT_CONVERSION_TRACKED."],
      diagnosis: "Sin seguimiento, Smart Bidding no tiene señal y los reportes no muestran ventas.",
      action:
        "Confirmar con medición si el seguimiento vive en el MCC o falta configurarlo; no cambiar estrategias hasta resolverlo.",
      steps: ["Revisar Herramientas > Conversiones en la cuenta y en el MCC.", "Escalar a medición con este hallazgo."],
      risk: "bajo",
      priority: "P0",
      confidence: "alta",
      impact: "Base de medición para todas las decisiones.",
      metric: "Conversiones registradas",
      observation: "Inmediato",
      rollback: "No aplica.",
      minutes: 20,
      when: "hoy",
      stake,
      rule: null,
    });
  if (
    customer?.trackingStatus === "CONVERSION_TRACKING_MANAGED_BY_ANOTHER_MANAGER" ||
    customer?.trackingStatus === "CONVERSION_TRACKING_MANAGED_BY_THIS_MANAGER"
  )
    ctx.note(
      "conversions",
      "El seguimiento de conversiones se administra desde un MCC (seguimiento entre cuentas): los cambios de acciones se hacen en el administrador, no en esta cuenta.",
    );
  if (customer && customer.enhancedLeads === false)
    ctx.note(
      "conversions",
      `Conversiones avanzadas para clientes potenciales: desactivadas${customer.acceptedTerms === false ? "; términos de datos del cliente no aceptados" : ""}. Validar con medición si aplica al flujo de carga offline (no es un cambio rápido).`,
    );

  const stats = actionStatsFor(data);
  const enabled = data.conversionActions.filter((a) => a.status === "ENABLED");
  const primary = enabled.filter((a) => a.primary === true || a.included === true);
  const seenNames = new Set([...enabled.map((a) => a.name), ...stats.keys()]);
  for (const name of VALID_OFFLINE)
    if (![...seenNames].some((n) => n.trim().toLowerCase() === name.toLowerCase()))
      ctx.note("conversions", `No se encontró la acción ${name} ni conversiones con ese nombre en 90 días.`);

  // Duplicadas por nombre normalizado entre acciones primarias.
  const byName = new Map<string, ConversionActionInfo[]>();
  for (const a of primary) byName.set(normalizeName(a.name), [...(byName.get(normalizeName(a.name)) ?? []), a]);
  for (const group of byName.values())
    if (group.length > 1)
      ctx.add({
        section: "conversions",
        campaign: "Cuenta",
        title: `Acciones de conversión primarias con el mismo nombre: ${group[0]!.name}`,
        evidence: group.map(
          (a) =>
            `${a.name} · ${a.type} · ${a.category ?? "s/d"} · ID ${a.id} · 30 días: ${fmtNum(stats.get(a.name)?.l30 ?? 0, 1)}`,
        ),
        diagnosis:
          "Dos acciones primarias equivalentes pueden contar la misma conversión dos veces y distorsionar la puja.",
        action: "Validar con medición cuál es la fuente correcta antes de tocar; el cambio de objetivo es estructural.",
        steps: [
          "Comparar las conversiones de ambas acciones por día.",
          "Definir con medición cuál queda primaria.",
          "Programar el cambio fuera de periodos críticos.",
        ],
        risk: "alto",
        priority: "P0",
        confidence: "media",
        impact: "Señal de puja limpia y CPA real.",
        metric: "Conversiones y CPA",
        observation: "14 días después del cambio",
        rollback: "Restaurar la acción como primaria.",
        minutes: 60,
        when: "no_ejecutar",
        stake,
        rule: null,
        sources: ["goals", "goalChanges"],
      });

  const isValid = (name: string) => VALID_OFFLINE.some((v) => v.toLowerCase() === name.trim().toLowerCase());
  for (const a of primary) {
    const s = stats.get(a.name);
    if (OFFLINE_TYPES.has(a.type) && !isValid(a.name))
      ctx.add({
        section: "conversions",
        campaign: "Cuenta",
        title: `Evento offline primario fuera de los dos válidos: ${a.name}`,
        evidence: [
          `Tipo ${a.type}, categoría ${a.category ?? "s/d"}, primaria; conversiones 30 días ${fmtNum(s?.l30 ?? 0, 1)}.`,
        ],
        diagnosis: `La regla de la cuenta reconoce solo ${SALES_ACTION} y ${LEAD_ACTION} como eventos offline; otro evento primario puede desviar la puja.`,
        action: "Validar con el equipo de medición antes de cualquier cambio.",
        steps: [
          "Confirmar el origen y uso de la acción.",
          "Si no corresponde, pasarla a secundaria en una ventana planeada.",
        ],
        risk: "alto",
        priority: "P4",
        confidence: "media",
        impact: "Puja alineada a ventas.",
        metric: "Conversiones y CPA de venta",
        observation: "14 días después del cambio",
        rollback: "Restaurar como primaria.",
        minutes: 30,
        when: "no_ejecutar",
        stake,
        rule: null,
        sources: ["goals", "goalChanges"],
      });
    if (a.category && MICRO.has(a.category) && (s?.l30 ?? 0) > 0)
      ctx.add({
        section: "conversions",
        campaign: "Cuenta",
        title: `Microconversión marcada como primaria: ${a.name}`,
        evidence: [`Categoría ${a.category}; tipo ${a.type}; conversiones 30 días ${fmtNum(s!.l30, 1)}.`],
        diagnosis:
          "Una microconversión primaria se suma a la columna Conversiones y la puja la persigue igual que una venta.",
        action: "Validar si es intencional; si no, pasarla a secundaria en una ventana planeada (cambio estructural).",
        steps: [
          "Revisar qué campañas usan la meta de esa categoría.",
          "Decidir con negocio y medición.",
          "Aplicar con control de cambios.",
        ],
        risk: "alto",
        priority: "P4",
        confidence: "media",
        impact: "Optimización hacia ventas en lugar de señales intermedias.",
        metric: "Ventas y CPA de venta",
        observation: "14 días",
        rollback: "Restaurar como primaria.",
        minutes: 30,
        when: "no_ejecutar",
        stake,
        rule: null,
        sources: ["goals"],
      });
    // Seguimiento posiblemente roto: tenía volumen y dejó de registrar.
    if (
      s &&
      ((s.p30 >= CRITERIA.minConversions && s.l30 === 0) || (s.prev23 >= CRITERIA.minConversions && s.l7 === 0))
    ) {
      const offline = OFFLINE_TYPES.has(a.type) || isValid(a.name);
      ctx.add({
        section: "conversions",
        campaign: "Cuenta",
        title: `La acción ${a.name} dejó de registrar conversiones`,
        evidence: [
          `30 días anteriores: ${fmtNum(s.p30, 1)}; últimos 30: ${fmtNum(s.l30, 1)}; últimos 7: ${fmtNum(s.l7, 1)} (23 días previos: ${fmtNum(s.prev23, 1)}).`,
        ],
        diagnosis: offline
          ? "Es una importación offline: puede ser retraso de carga o una carga interrumpida."
          : "Una acción primaria que pasa de tener volumen a cero suele indicar etiqueta rota o un cambio en el sitio.",
        action: offline
          ? "Confirmar con el equipo de carga la fecha de la última importación."
          : "Revisar el diagnóstico de la etiqueta y la página donde se dispara.",
        steps: offline
          ? [
              "Revisar Herramientas > Conversiones > Cargas.",
              "Confirmar errores de coincidencia de GCLID.",
              "Recargar si faltan días.",
            ]
          : [
              "Abrir el diagnóstico de la acción en Google Ads.",
              "Probar la conversión en el sitio con Tag Assistant.",
              "Corregir y vigilar 48 horas.",
            ],
        risk: "bajo",
        priority: offline && s.l30 > 0 ? "P1" : "P0",
        confidence: offline && s.l30 > 0 ? "baja" : "media",
        impact: "Evitar que Smart Bidding optimice sin señal.",
        metric: `Conversiones diarias de ${a.name}`,
        observation: "48 horas después de corregir",
        rollback: "No aplica.",
        minutes: 30,
        when: "hoy",
        stake,
        rule: "RULE-GADS-005",
      });
    }
  }
  const primaryNames = primary.map((a) => a.name);
  if (primaryNames.some(isSalesAction) && primaryNames.some(isLeadAction))
    ctx.add({
      section: "conversions",
      campaign: "Cuenta",
      title: "La columna Conversiones suma leads y ventas",
      evidence: [
        `${SALES_ACTION} y ${LEAD_ACTION} son primarias; conversiones 30 días: ventas ${fmtNum(ctx.account.L30.sales, 1)}, leads ${fmtNum(ctx.account.L30.leads, 1)}.`,
      ],
      diagnosis:
        "La puja optimiza a la suma de leads y ventas. La regla de decisión de la cuenta es ventas y CPA de venta, así que el CPA de la columna Conversiones no es el CPA de negocio.",
      action:
        "Reportar siempre ventas y CPA de venta por separado. Cambiar la meta de puja es una decisión estructural de negocio.",
      steps: [
        "Usar CPA de venta en reportes y en este análisis.",
        "Si se quiere pujar solo por ventas, plantearlo como experimento con medición.",
      ],
      risk: "alto",
      priority: "P4",
      confidence: "alta",
      impact: "Lectura correcta del rendimiento.",
      metric: "CPA de venta",
      observation: "No aplica",
      rollback: "No aplica.",
      minutes: null,
      when: "no_ejecutar",
      stake,
      rule: null,
      sources: ["goals", "defaultGoals"],
    });

  // Objetivos específicos por campaña y diferencias entre campañas del mismo tipo.
  const specific = data.goalConfigs.filter((g) => g.level === "CAMPAIGN");
  if (specific.length) {
    const biddable = (id: string) =>
      data.campaignGoals
        .filter((g) => g.campaignId === id && g.biddable)
        .map((g) => `${g.category}/${g.origin}`)
        .sort()
        .join(", ");
    const byChannel = new Map<string, Map<string, string[]>>();
    for (const s of ctx.campaigns.filter((x) => x.info.status === "ENABLED")) {
      const goals = specific.some((g) => g.campaignId === s.info.id)
        ? biddable(s.info.id) || "(personalizado)"
        : "(objetivos de la cuenta)";
      const m = byChannel.get(s.info.channel) ?? new Map<string, string[]>();
      m.set(goals, [...(m.get(goals) ?? []), s.info.name]);
      byChannel.set(s.info.channel, m);
    }
    for (const [channel, groups] of byChannel)
      if (groups.size > 1)
        ctx.add({
          section: "conversions",
          campaign: `Campañas ${channel}`,
          title: "Campañas del mismo tipo optimizan hacia objetivos distintos",
          evidence: [...groups.entries()].map(
            ([goals, names]) =>
              `${goals}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` y ${names.length - 5} más` : ""}`,
          ),
          diagnosis:
            "Google recomienda en general usar los objetivos de la cuenta para que las campañas aprendan entre sí; las diferencias pueden ser intencionales (p. ej., campañas de leads).",
          action: "Validar con negocio que cada diferencia sea intencional; no unificar como cambio rápido.",
          steps: ["Revisar la lista con el equipo.", "Documentar las excepciones intencionales."],
          risk: "alto",
          priority: "P4",
          confidence: "media",
          impact: "Coherencia de la señal de puja.",
          metric: "CPA de venta por campaña",
          observation: "No aplica",
          rollback: "No aplica.",
          minutes: 30,
          when: "no_ejecutar",
          stake,
          rule: null,
          sources: ["defaultGoals", "campaignGoals"],
        });
  }
  const goals = data.customerGoals.filter((g) => g.biddable).map((g) => `${g.category}/${g.origin}`);
  if (goals.length) ctx.note("conversions", `Objetivos de la cuenta usados para pujar: ${goals.join(", ")}.`);
  ctx.hold(
    "Cuenta",
    "Objetivos y acciones de conversión",
    "Cambiar acciones primarias u objetivos es estructural (reinicia aprendizaje): solo con plan, validación de medición y control de cambios.",
  );
}

export interface ChangeEntry {
  date: string;
  campaign: string;
  element: string;
  change: string;
  before: string;
  after: string;
  conclusion: string;
}

/** Cambios de presupuesto, puja y estado cruzados con rendimiento 7 días antes y después. */
export function changeEntries(ctx: Ctx): ChangeEntry[] {
  const { data } = ctx;
  const relevant = data.changes.filter(
    (c) => c.campaignId && Object.keys(c.after).length + Object.keys(c.before).length > 0,
  );
  const entries: ChangeEntry[] = [];
  const seen = new Set<string>();
  for (const c of relevant) {
    const key = `${c.at.slice(0, 10)}~${c.campaignId}~${Object.keys(c.after).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(changeEntry(ctx, c));
    if (entries.length >= 25) break;
  }
  const byType = new Map<string, number>();
  for (const c of data.changes) byType.set(c.resourceType, (byType.get(c.resourceType) ?? 0) + 1);
  if (data.changes.length)
    ctx.note(
      "changes",
      `Cambios en 30 días: ${data.changes.length} (${[...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")}). Clientes: ${[...new Set(data.changes.map((c) => c.client ?? "s/d"))].join(", ")}.`,
    );
  return entries;
}

function changeEntry(ctx: Ctx, c: ChangeRow): ChangeEntry {
  const { data } = ctx;
  const day = c.at.slice(0, 10);
  const sum = (from: string, to: string) => {
    let cost = 0,
      conv = 0;
    for (const d of data.daily)
      if (d.campaignId === c.campaignId && d.date >= from && d.date <= to) {
        cost += d.cost;
        conv += d.conversions;
      }
    return { cost, conversions: conv };
  };
  const beforeM = sum(shiftDate(day, -7), shiftDate(day, -1));
  const afterTo = shiftDate(day, 6) < data.end ? shiftDate(day, 6) : data.end;
  const afterM = sum(day, afterTo);
  const afterDays = Math.round((Date.parse(afterTo) - Date.parse(day)) / 86_400_000) + 1;
  const fmt = (v: string | number | boolean | null, k: string) =>
    v === null
      ? "s/d"
      : typeof v === "number" && (k === "presupuesto" || k.startsWith("tCPA"))
        ? ctx.money(v)
        : String(v);
  const keys = [...new Set([...Object.keys(c.before), ...Object.keys(c.after)])];
  const perDay = (m: { cost: number; conversions: number }, days: number) =>
    `${ctx.money(m.cost / days)} diarios, ${fmtNum(m.conversions / days, 1)} conv./día, CPA ${ctx.money(cpa(m))}`;
  const cpaD = fmtDelta(cpa(afterM) !== null && cpa(beforeM) !== null ? cpa(afterM)! / cpa(beforeM)! - 1 : null);
  return {
    date: day,
    campaign: ctx.name(c.campaignId!),
    element: c.resourceType,
    change: keys.map((k) => `${k}: ${fmt(c.before[k] ?? null, k)} → ${fmt(c.after[k] ?? null, k)}`).join("; "),
    before: perDay(beforeM, 7),
    after: perDay(afterM, afterDays),
    conclusion:
      afterDays < 7
        ? `Muy reciente para evaluar: solo ${afterDays} día(s) posteriores.`
        : `CPA ${cpaD} en los ${afterDays} días posteriores. Correlación temporal; no demuestra causalidad.`,
  };
}

export interface RecommendationEntry {
  type: string;
  count: number;
  campaigns: string;
  verdict: "Aplicable" | "Validar" | "No recomendable" | "No aplica";
  reason: string;
}

const REC: Record<string, [RecommendationEntry["verdict"], string]> = {
  SITELINK_ASSET: ["Aplicable", "Bajo riesgo; revisar que los textos y URLs sean vigentes."],
  CALLOUT_ASSET: ["Aplicable", "Bajo riesgo; redactar con beneficios reales de la oferta."],
  CALL_ASSET: ["Validar", "Aplica si la venta telefónica está habilitada para esa campaña y horario."],
  LEAD_FORM_ASSET: ["Validar", "Cambia el flujo de captación; acordar con el equipo comercial."],
  RESPONSIVE_SEARCH_AD: ["Aplicable", "Agregar un RSA donde falte es de bajo riesgo."],
  RESPONSIVE_SEARCH_AD_ASSET: ["Aplicable", "Agregar títulos o descripciones sin eliminar los que funcionan."],
  RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: ["Aplicable", "Mejorar Ad Strength agregando recursos únicos."],
  IMPROVE_PERFORMANCE_MAX_AD_STRENGTH: [
    "Aplicable",
    "Completar recursos del grupo; no eliminar los que tienen buen rendimiento.",
  ],
  IMPROVE_DEMAND_GEN_AD_STRENGTH: ["Aplicable", "Completar formatos y recursos."],
  IMPROVE_GOOGLE_TAG_COVERAGE: ["Aplicable", "Mejora de medición; coordinar con quien administra la etiqueta."],
  REFRESH_CUSTOMER_MATCH_LIST: ["Aplicable", "Actualizar listas mejora las señales sin cambiar la estrategia."],
  OPTIMIZE_AD_ROTATION: ["Validar", "Cambia la rotación de anuncios; confirmar que no haya pruebas A/B en curso."],
  CAMPAIGN_BUDGET: ["Validar", "Solo si la campaña está limitada por presupuesto con buen CPA, y en pasos graduales."],
  FORECASTING_CAMPAIGN_BUDGET: ["Validar", "Pronóstico estacional; contrastar con el plan de inversión."],
  MARGINAL_ROI_CAMPAIGN_BUDGET: ["Validar", "Contrastar con el CPA de venta antes de mover inversión."],
  MOVE_UNUSED_BUDGET: ["Validar", "Útil si la campaña receptora tiene buen CPA; mover en pasos graduales."],
  KEYWORD: ["Validar", "Revisar intención de cada keyword sugerida contra los términos de búsqueda."],
  KEYWORD_MATCH_TYPE: ["Validar", "Ampliar concordancias cambia el tráfico; preferir experimento."],
  USE_BROAD_MATCH_KEYWORD: ["Validar", "Solo con Smart Bidding estable y como experimento controlado."],
  SEARCH_PARTNERS_OPT_IN: ["Validar", "Medir primero el rendimiento por red en campañas similares."],
  DISPLAY_EXPANSION_OPT_IN: [
    "No recomendable",
    "Mezcla tráfico de Display en Search y diluye la lectura de rendimiento.",
  ],
  DYNAMIC_IMAGE_EXTENSION_OPT_IN: ["Validar", "Revisar que las imágenes del sitio sean adecuadas para la marca."],
  CUSTOM_AUDIENCE_OPT_IN: ["Validar", "Cambia segmentación; probar con experimento."],
  PERFORMANCE_MAX_FINAL_URL_OPT_IN: ["Validar", "Activar con exclusiones de URL (empleo, ayuda, legales) definidas."],
  TARGET_CPA_OPT_IN: ["Validar", "Cambio de estrategia: alto riesgo; solo con experimento."],
  MAXIMIZE_CONVERSIONS_OPT_IN: ["Validar", "Cambio de estrategia: alto riesgo; solo con experimento."],
  MAXIMIZE_CONVERSION_VALUE_OPT_IN: ["Validar", "Requiere valores de conversión confiables; alto riesgo."],
  TARGET_ROAS_OPT_IN: ["Validar", "Requiere valores de conversión confiables; alto riesgo."],
  SET_TARGET_CPA: ["Validar", "Fijar objetivo cambia la entrega; comparar con el CPA real y con ventas."],
  SET_TARGET_ROAS: ["Validar", "Fijar objetivo cambia la entrega."],
  FORECASTING_SET_TARGET_CPA: ["Validar", "Comparar con el CPA real antes de aplicar."],
  FORECASTING_SET_TARGET_ROAS: ["Validar", "Comparar con el ROAS real antes de aplicar."],
  RAISE_TARGET_CPA: ["Validar", "Sube el CPA; decidir según el valor de una venta adicional."],
  RAISE_TARGET_CPA_BID_TOO_LOW: ["Validar", "Indica objetivo restrictivo; preferir experimento con +15%."],
  RAISE_TARGET_CPA_PERFORMANCE_BID_TOO_LOW: ["Validar", "Indica objetivo restrictivo; preferir experimento con +15%."],
  LOWER_TARGET_ROAS: ["Validar", "Baja la exigencia de retorno; decidir con negocio."],
  LOWER_TARGET_ROAS_PERFORMANCE_BID_TOO_LOW: ["Validar", "Baja la exigencia de retorno; decidir con negocio."],
  ENHANCED_CPC_OPT_IN: ["No recomendable", "Estrategia heredada; no aporta frente a Smart Bidding."],
  MAXIMIZE_CLICKS_OPT_IN: ["No recomendable", "Optimiza clics, no ventas."],
  TEXT_AD: ["No recomendable", "Formato heredado."],
  PERFORMANCE_MAX_OPT_IN: ["No recomendable", "Cambio estructural; no se aplica desde una recomendación."],
  MIGRATE_DYNAMIC_SEARCH_ADS_CAMPAIGN_TO_PERFORMANCE_MAX: [
    "No recomendable",
    "Cambio estructural; evaluar con experimento.",
  ],
  UPGRADE_LOCAL_CAMPAIGN_TO_PERFORMANCE_MAX: ["No recomendable", "Cambio estructural."],
  UPGRADE_SMART_SHOPPING_CAMPAIGN_TO_PERFORMANCE_MAX: ["No aplica", "La cuenta no tiene Shopping."],
  CAMPAIGN_SPECIFIC_APP_GOAL: ["No aplica", "Recomendación para apps."],
};

/** Las recomendaciones de Google se analizan, no se aplican a ciegas. */
export function classifyRecommendations(ctx: Ctx, constrainedEfficient: Set<string>): RecommendationEntry[] {
  const groups = new Map<string, { count: number; campaigns: Set<string> }>();
  for (const r of ctx.data.recommendations) {
    if (r.dismissed) continue;
    const g = groups.get(r.type) ?? { count: 0, campaigns: new Set<string>() };
    g.count++;
    if (r.campaignId) g.campaigns.add(r.campaignId);
    groups.set(r.type, g);
  }
  return [...groups.entries()]
    .map(([type, g]) => {
      let [verdict, reason] =
        REC[type] ??
        (type.startsWith("SHOPPING_")
          ? (["No aplica", "La cuenta no usa Merchant Center."] as const)
          : (["Validar", "Sin criterio predefinido; revisar caso por caso."] as const));
      const names = [...g.campaigns].map((id) => ctx.name(id));
      if (
        (type === "CAMPAIGN_BUDGET" || type === "MOVE_UNUSED_BUDGET") &&
        [...g.campaigns].some((id) => constrainedEfficient.has(id))
      ) {
        verdict = "Aplicable";
        reason =
          "Coincide con una campaña limitada por presupuesto con buen CPA; aplicar en pasos de 15% (ver hallazgo de presupuesto).";
      }
      return {
        type,
        count: g.count,
        campaigns: names.slice(0, 4).join(", ") + (names.length > 4 ? ` y ${names.length - 4} más` : ""),
        verdict,
        reason,
      };
    })
    .sort((a, b) => b.count - a.count);
}
