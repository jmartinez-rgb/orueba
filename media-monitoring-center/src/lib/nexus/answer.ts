import { PLATFORMS } from "@/lib/platforms/registry";
import type { PlatformId } from "@/lib/types";
import type { NexusAnswer, NexusData, NexusEntity, NexusLink } from "./types";
import { NEXUS_SUGGESTIONS } from "./suggestions";

const STATES = { OK: "Al día", PARTIAL: "Datos parciales", DELAYED: "Datos atrasados", ERROR: "Error de datos", NO_DATA: "Sin datos" };
const STATUSES: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", ENDED: "Finalizada", UNKNOWN: "Sin estado confirmado" };
const SEVERITIES: Record<string, string> = { NORMAL: "Normal", ATTENTION: "Atención", ALERT: "Alerta", CRITICAL: "Crítica" };
const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const source = (label: string, href: string): NexusLink => ({ label, href });

function base(data: NexusData, title: string, kind: NexusAnswer["kind"]): NexusAnswer {
  return { kind, title, context: data.context, paragraphs: [], facts: [], items: [], sources: [], suggestions: NEXUS_SUGGESTIONS };
}

function platformsOf(question: string): PlatformId[] {
  const patterns: Array<[PlatformId, RegExp]> = [
    ["google", /\bgoogle\b/], ["meta", /\b(meta|facebook|instagram)\b/], ["tiktok", /\b(tiktok|tik tok)\b/],
    ["microsoft", /\b(microsoft|bing)\b/], ["spotify", /\bspotify\b/], ["x", /\b(x ads|twitter|x)\b/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(question)).map(([id]) => id);
}

function asksAnotherWindow(question: string, data: NexusData): boolean {
  // Month/year labels often belong to a campaign name, not to a requested report window.
  // Strip only exact full names and complete IDs; a separate "ayer" or date remains a request.
  let remaining = question;
  const labels = [...data.campaigns, ...data.accounts].flatMap(entity => [normalize(entity.name), normalize(entity.id)]).filter(label => label.length >= 4).sort((a, b) => b.length - a.length);
  for (const label of labels) remaining = remaining.replaceAll(label, " ");
  return /\b(ayer|anteayer|manana|anoche|semana|mes|septiembre|octubre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|noviembre|diciembre)\b/.test(remaining)
    || /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]20\d{2}\b/.test(remaining)
    || /\b(ultimos?|ultimas?|hace)\s+\d+\s+(dias?|horas?)\b/.test(remaining)
    || /\b(hasta|desde|a las|corte|hora)\b[^?!.]{0,20}\b\d{1,2}:\d{2}\b/.test(remaining);
}

function guide(question: string, data: NexusData): NexusAnswer | null {
  let paragraphs: string[] = [];
  let link = source("Guía del monitoreo", "/guia");
  let title = "Cómo usar el monitoreo";
  if (/\b(deleg|asign|responsable)/.test(question) && /\b(como|puedo|donde|quien)/.test(question)) {
    title = "Delegar y atender incidentes";
    paragraphs = ["Abre Incidentes, elige un incidente y utiliza la asignación de responsable. La lista contiene usuarios activos con acceso a la misma marca y permiso para atenderlo.", "Asignar requiere el permiso de delegación; responder y agregar seguimiento requiere los permisos operativos. Nexus solo consulta: la asignación y el cierre se hacen en la pantalla del incidente."];
    link = source("Incidentes y responsables", "/incidents");
  } else if (/\b(tipo de cambio|tasas|usd|mxn|monedas|dolares)\b/.test(question)) {
    title = "Tipos de cambio y costos";
    paragraphs = ["El equipo captura el tipo de cambio USD→MXN por mes en Tipo de cambio. Sin una tasa disponible el costo convertido queda sin dato; no equivale a cero. Si se usa una tasa anterior, el monitoreo muestra el aviso.", "Nexus no inventa tasas ni consolida importes con monedas incompatibles."];
    link = source("Tipo de cambio mensual", "/tipo-de-cambio");
  } else if (/\b(cpa|conversion|conversiones|compra|compras|ventas|roas|offline|capi)\b/.test(question)) {
    title = "Medición de resultados y CPA";
    paragraphs = ["CPA = suma de costo ÷ suma de conversiones de la misma definición y periodo. No se promedian CPAs. Nexus no ofrece un CPA cuando el evento o las conversiones no están confirmados.", "Meta: CAPI WhatsApp se analiza con On-Facebook Purchase; las demás campañas con Compras Offline Web (Inbound). Se separan en el análisis y solo se suman para reportar ventas totales.", "Google: los eventos offline válidos son MCC_Offline_Lead_Contact y MCC_Offline_Purchase. Las decisiones pendientes de eventos principales no se sustituyen por suposiciones."];
    link = source("Métricas y reglas de medición", "/metricas");
  } else if (/\b(presupuesto|presupuestos|pacing|arranque)\b/.test(question)) {
    title = "Presupuestos de referencia";
    paragraphs = ["Presupuestos muestra referencias capturadas para el mes y el ritmo de gasto. Arranque de mes registra lo aprobado y qué campañas están activas o pendientes.", "Son registros del monitoreo: esta aplicación y Nexus no cambian presupuestos ni campañas en las plataformas publicitarias."];
    link = source("Presupuestos y ritmo de gasto", "/budget");
  } else if (/\b(como|donde)\b.*\b(usar|uso|funciona|empiezo)\b|\b(ayuda|guia|que puedes|que haces)\b/.test(question)) {
    paragraphs = ["Empieza en Resumen: revisa el estado de datos y luego las alertas. Campañas permite buscar por nombre o ID; Incidentes concentra la atención y el seguimiento.", "Pregúntame por una campaña, las cuentas, alertas o frescura de la marca seleccionada. Respondo a partir de datos disponibles y una guía local, con enlaces para comprobar la información. No ejecuto acciones ni modifico campañas."];
  }
  if (!paragraphs.length && /\b(que es|que significa|como se calcula)\b/.test(question) && /\b(cpc|cpm|ctr)\b/.test(question)) {
    title = "Métricas de costo y tráfico";
    paragraphs = ["CPC = costo ÷ clics; CPM = costo ÷ impresiones × 1,000; CTR = clics ÷ impresiones × 100. Se recalculan desde los totales de la misma ventana, sin promediar razones.", "Si falta un componente o el denominador es cero, el resultado queda sin dato."];
    link = source("Métricas", "/metricas");
  }
  if (!paragraphs.length) return null;
  return { ...base(data, title, "guide"), paragraphs, sources: [link] };
}

function matches(question: string, entities: NexusEntity[], platform: PlatformId | null): NexusEntity[] {
  const pool = entities.filter(entity => !platform || entity.platform === platform);
  const idTokens = new Set(question.split(/[^a-z0-9_:-]+/).map(token => token.replace(/^:+|:+$/g, "")));
  const ids = pool.filter(entity => idTokens.has(normalize(entity.id)));
  if (ids.length) return ids;
  // The unified catalog prefixes raw IDs with provider/account; preserve exact compound IDs,
  // while a raw platform ID can match several accounts and must remain an explicit ambiguity.
  const rawIds = pool.filter(entity => idTokens.has(normalize(entity.id.split(":").at(-1) ?? entity.id)));
  if (rawIds.length) return rawIds;
  const full = pool.filter(entity => { const name = normalize(entity.name); return name.length >= 4 && question.includes(name); });
  if (full.length) return full;
  // Search only meaningful name tokens, never treat a platform/brand word as a unique campaign.
  const ignored = new Set(["izzi", "sky", "google", "meta", "facebook", "tiktok", "microsoft", "spotify", "ads", "campana", "campanas", "cuenta", "cuentas", "abcw", "como", "esta", "estan", "gasto", "clics", "cuanto", "dime", "sobre", "tiene", "nombre", "estado", "activo", "activa", "para", "del", "las", "los", "que", "hoy"]);
  const tokens = question.split(/[^a-z0-9]+/).filter(token => token.length >= 4 && !ignored.has(token));
  if (!tokens.length) return [];
  return pool.filter(entity => {
    const name = normalize(entity.name);
    return tokens.every(token => name.includes(token));
  });
}

function metricFacts(entity: NexusEntity): NexusAnswer["facts"] {
  const finite = (value: number | null) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const spend = finite(entity.metrics.spend), impressions = finite(entity.metrics.impressions), clicks = finite(entity.metrics.clicks);
  const cpc = spend === null || clicks === null || clicks <= 0 ? null : finite(spend / clicks);
  const ctr = clicks === null || impressions === null || impressions <= 0 ? null : finite(clicks / impressions * 100);
  return [
    { label: "Gasto disponible (MXN)", value: spend === null ? "Sin dato" : money.format(spend) },
    { label: "Impresiones", value: impressions === null ? "Sin dato" : number.format(impressions) },
    { label: "Clics", value: clicks === null ? "Sin dato" : number.format(clicks) },
    { label: "CPC", value: cpc === null ? "Sin dato" : money.format(cpc) },
    { label: "CTR", value: ctr === null ? "Sin dato" : `${number.format(ctr)}%` },
  ];
}

function entityAnswer(entity: NexusEntity, data: NexusData, kind: "campaign" | "account"): NexusAnswer {
  const response = base(data, entity.name, kind);
  response.paragraphs = [`${PLATFORMS[entity.platform].name} · ID ${entity.id}. ${kind === "campaign" ? `Estado del catálogo: ${STATUSES[entity.status] ?? "Sin estado confirmado"}. ` : ""}Datos: ${STATES[entity.dataState]}.`, `Ventana de consulta: ${data.context.date}, de 00:00 a ${entity.cutoffHour ?? data.context.cutoffHour}:00 (${data.context.timezone}); no es un total de día completo salvo corte a las 24:00.`];
  if (entity.dataState !== "OK") response.paragraphs.push("Los valores disponibles pueden ser parciales o anteriores. No puedo afirmar que la campaña opere normalmente ni que un dato ausente sea cero.");
  if (data.missingFx || data.fallbackFx) response.paragraphs.push("La marca tiene avisos de tipo de cambio. Comprueba las tasas y el alcance antes de consolidar costos.");
  response.facts = metricFacts(entity);
  response.sources = [source(kind === "campaign" ? "Campañas de la marca" : "Plataforma y cuentas", kind === "campaign" ? `/campaigns?search=${encodeURIComponent(entity.id)}&platform=${entity.platform}` : `/platforms/${entity.platform}`)];
  response.suggestions = [`¿Los datos de ${PLATFORMS[entity.platform].shortName} están actualizados?`, "¿Qué alertas están abiertas?", "¿Cómo se calcula el CPA?"];
  return response;
}

export function answerNexus(question: string, data: NexusData): NexusAnswer {
  const q = normalize(question.trim());
  const help = guide(q, data);
  if (help) return help;
  if (data.context.domain && data.context.domain.id !== "all" && !data.context.domain.available) {
    return { ...base(data, "Alcance no disponible", "unavailable"), paragraphs: ["La clasificación del dominio seleccionado no está disponible. No puedo atribuir cuentas, alertas ni métricas a ese dominio. Revisa el alcance antes de interpretar los datos."], sources: [source("Estado de datos e integraciones", "/integrations")] };
  }
  const platforms = platformsOf(q);
  const platform = platforms.length === 1 ? platforms[0] : null;
  if (asksAnotherWindow(q, data)) {
    return { ...base(data, "Consulta de otro periodo", "unavailable"), paragraphs: ["Esta versión de Nexus consulta el corte actual del monitoreo. No extrapolo sus valores a otro día ni a un mes. Utiliza Histórico o Comparar para elegir el periodo."], sources: [source("Histórico", "/historical"), source("Comparar periodos", "/compare")] };
  }
  if (/\b(alerta|alertas|incidente|incidentes|critico|critica|criticas|criticos)\b/.test(q)) {
    const alerts = data.alerts.filter(row => !platform || row.platform === platform);
    const incidents = data.incidents.filter(row => !platform || row.platform === platform);
    const response = base(data, "Alertas e incidentes abiertos", "alerts");
    response.paragraphs = [alerts.length ? `Hay ${alerts.length} alerta(s) activa(s) y ${incidents.length} incidente(s) abierto(s) en el alcance consultado.` : "No hay alertas activas registradas en este alcance. Esto por sí solo no confirma normalidad: revisa también la frescura de los datos."];
    const incidentStatus: Record<string, string> = { OPEN: "Abierto", ACKNOWLEDGED: "Atendido", INVESTIGATING: "En investigación", RESOLVED: "Resuelto" };
    response.items = incidents.slice(0, 8).map(row => ({ title: `${row.id} · ${PLATFORMS[row.platform].shortName}`, detail: `${SEVERITIES[row.severity] ?? row.severity} · ${incidentStatus[row.status] ?? "Sin estado confirmado"}`, href: `/incidents?id=${encodeURIComponent(row.id)}` }));
    if (incidents.length > 8) response.paragraphs.push(`Muestro 8 de ${incidents.length} incidentes; abre Incidentes para ver el resto.`);
    response.sources = [source("Alertas", "/alerts"), source("Incidentes", "/incidents")];
    return response;
  }
  if (/\b(frescura|actualizado|actualizados|actualizada|actualizadas|atraso|atrasados|sincronizacion|sincronizado|sincronizados|datos)\b/.test(q)) {
    const response = base(data, "Frescura de los datos", "freshness");
    const platforms = data.platforms.filter(row => !platform || row.id === platform);
    response.paragraphs = platforms.length ? ["La frescura indica si los valores sirven para evaluar el corte actual; un estado con datos faltantes no significa gasto cero."] : ["No hay cuentas configuradas de esta plataforma para la marca seleccionada."];
    response.items = platforms.map(row => ({ title: PLATFORMS[row.id].name, detail: `${STATES[row.state]} · Último dato: ${row.lastDataAt ?? "sin fecha disponible"}`, href: `/platforms/${row.id}` }));
    response.sources = [source("Estado de datos e integraciones", "/integrations")];
    return response;
  }
  const accountQuestion = /\b(cuenta|cuentas)\b/.test(q) && !/\b(campana|campanas)\b/.test(q);
  const selected = matches(q, accountQuestion ? data.accounts : data.campaigns, platform);
  if (selected.length === 1) return entityAnswer(selected[0], data, accountQuestion ? "account" : "campaign");
  if (selected.length > 1 || /\b(campana|campanas|cuenta|cuentas)\b/.test(q)) {
    let pool = selected.length ? selected : (accountQuestion ? data.accounts : data.campaigns).filter(entity => !platform || entity.platform === platform);
    if (!accountQuestion) {
      if (/\b(activas|activos|activa|activo)\b/.test(q)) pool = pool.filter(entity => entity.status === "ACTIVE");
      else if (/\b(pausadas|pausados|pausada|pausado)\b/.test(q)) pool = pool.filter(entity => entity.status === "PAUSED");
      else if (/\b(finalizadas|terminadas)\b/.test(q)) pool = pool.filter(entity => entity.status === "ENDED");
    }
    const response = base(data, selected.length > 1 ? "Hay varias coincidencias" : "Busca por nombre o ID", "clarify");
    const listRequest = /\b(cuales|lista|listar|muestra|mostrar|tenemos|hay|activas|pausadas|finalizadas)\b/.test(q);
    response.paragraphs = [pool.length ? selected.length > 1 || listRequest ? `Hay ${pool.length} ${accountQuestion ? "cuenta(s)" : "campaña(s)"} en este alcance. Indica el ID para una lectura concreta.` : "No encontré una coincidencia específica. Estas son algunas opciones del catálogo autorizado; copia su ID para consultar sus datos." : "No encontré cuentas o campañas de este alcance en el catálogo de la marca seleccionada."];
    response.items = pool.slice(0, 6).map(entity => ({ title: entity.name, detail: `${PLATFORMS[entity.platform].shortName} · ID ${entity.id}`, href: accountQuestion ? `/platforms/${entity.platform}` : `/campaigns?search=${encodeURIComponent(entity.id)}&platform=${entity.platform}` }));
    response.suggestions = pool.slice(0, 3).map(entity => `¿Cómo está ${accountQuestion ? "la cuenta" : "la campaña"} ${entity.id}?`);
    response.sources = [source("Catálogo de campañas", "/campaigns")];
    return response;
  }
  if (platforms.length > 1) {
    return { ...base(data, "Elige una plataforma para consultar", "clarify"), paragraphs: ["La consulta menciona varias plataformas. Indica una plataforma o el ID completo de la campaña para delimitar sus datos; no asumiré un alcance distinto."], suggestions: platforms.map(id => `¿Cómo está ${PLATFORMS[id].shortName}?`), sources: [source("Plataformas", "/platforms")] };
  }
  if (/\b(gasto|gastado|gastando|costo|clics|clicks|impresiones|cpc|cpm|ctr)\b/.test(q)) {
    const accounts = data.accounts.filter(account => !platform || account.platform === platform);
    const response = base(data, platform ? `Métricas de ${PLATFORMS[platform].shortName}` : "Métricas del corte actual", "metrics");
    response.paragraphs = accounts.length ? [`Acumulado de ${accounts.length} cuenta(s) del catálogo entre 00:00 y ${data.context.cutoffHour}:00 de ${data.context.date} (${data.context.timezone}). Si una cuenta no tiene una métrica disponible, su total consolidado se muestra sin dato.`] : ["No hay cuentas configuradas en este alcance; no puedo calcular métricas."];
    if (accounts.some(account => account.dataState !== "OK")) response.paragraphs.push("Hay cuentas con datos parciales, atrasados o faltantes: estos valores no confirman el rendimiento actual.");
    if (accounts.length) {
      const sameWindow = accounts.every(account => account.cutoffHour === data.context.cutoffHour);
      if (!sameWindow) response.paragraphs.push("Las cuentas no comparten la misma hora de corte; no sumo ventanas distintas.");
      const complete = (metric: keyof NexusEntity["metrics"]) => {
        if (!sameWindow || accounts.some(account => account.dataState !== "OK" || account.metrics[metric] === null)) return null;
        const value = accounts.reduce((total, account) => total + account.metrics[metric]!, 0);
        return Number.isFinite(value) ? value : null;
      };
      response.facts = metricFacts({ ...accounts[0], metrics: { spend: complete("spend"), impressions: complete("impressions"), clicks: complete("clicks") } });
    }
    if (data.missingFx || data.fallbackFx) response.paragraphs.push("Hay avisos de tipo de cambio en la marca; comprueba las tasas antes de consolidar costos.");
    response.sources = [source("Métricas y alcance", "/metricas")];
    return response;
  }
  if (/\b(estado|resumen|monitoreo|panorama|situacion|salud)\b/.test(q) || /\b(hola|buenos dias|buenas|como esta|como va|que pasa|que tal|que ocurre)\b/.test(q)) {
    const accounts = data.accounts.filter(row => !platform || row.platform === platform);
    const campaigns = data.campaigns.filter(row => !platform || row.platform === platform);
    const incidents = data.incidents.filter(row => !platform || row.platform === platform);
    const response = base(data, platform ? `${PLATFORMS[platform].shortName} en ${data.context.brandName}` : `Monitoreo de ${data.context.brandName}`, "overview");
    response.paragraphs = [accounts.length ? `${accounts.length} cuenta(s), ${campaigns.length} campaña(s) en el catálogo y ${incidents.length} incidente(s) abierto(s) en este alcance. Consulta cada plataforma antes de interpretar el rendimiento.` : "No hay cuentas configuradas en este alcance de la marca seleccionada. No puedo afirmar normalidad ni inventar métricas."];
    response.items = data.platforms.filter(row => !platform || row.id === platform).map(row => ({ title: PLATFORMS[row.id].name, detail: STATES[row.state], href: `/platforms/${row.id}` }));
    if (data.missingFx) response.paragraphs.push(`${data.missingFx} aviso(s) de tipo de cambio faltante; los costos afectados no están consolidados en MXN.`);
    if (data.fallbackFx) response.paragraphs.push(`${data.fallbackFx} aviso(s) de uso de una tasa anterior; revisa el mes de las tasas.`);
    response.sources = [source("Resumen del monitoreo", "/"), source("Tipo de cambio", "/tipo-de-cambio")];
    return response;
  }
  return { ...base(data, "Necesito una consulta más concreta", "unavailable"), paragraphs: ["Puedo explicar el uso del monitoreo o consultar campañas por nombre o ID, cuentas, alertas y frescura del corte actual. No tengo información para responder esa pregunta y no inventaré una respuesta."], sources: [source("Guía del monitoreo", "/guia")] };
}
