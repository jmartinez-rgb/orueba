/* ---- motor 5.5 · validación previa ----
   Corre DESPUÉS de responder al navegador (el proxy de Netlify corta a los 26 s):
   el rechazo llega por el sondeo de estado, no por esta respuesta. */
const b = $('Recibir').first().json.body || {};
const f = b.filas || {};
const problemas = [];

const camps  = f.campaigns || [];
const adsets = f.adsets || [];
const ads    = f.ads || [];
const assets = f.assets || [];
/* Campañas existentes: una por conjunto (campaign_id en la fila) o la global. */
const idsExistentes = [];
adsets.forEach(a => { if (a.campaign_id && idsExistentes.indexOf(String(a.campaign_id)) < 0) idsExistentes.push(String(a.campaign_id)); });
ads.forEach(a => { if (a.campaign_id && idsExistentes.indexOf(String(a.campaign_id)) < 0) idsExistentes.push(String(a.campaign_id)); });
/* Anuncios sobre conjuntos existentes: no hay conjuntos nuevos en el plan. */
const sobreConjuntos = ads.length > 0 && ads.every(a => a.adset_id);
if (b.campaign_id && idsExistentes.indexOf(String(b.campaign_id)) < 0) idsExistentes.push(String(b.campaign_id));
const usaExistente = idsExistentes.length > 0;

if (!camps.length && !usaExistente) problemas.push('El plan no trae ninguna campaña.');
if (!adsets.length && !ads.some(a => a.adset_id)) problemas.push('El plan no trae ningún conjunto.');
if (!ads.length)    problemas.push('El plan no trae ningún anuncio.');

/* Tope duro por corrida (D4-06). Ajustar según el tier de Marketing API. */
const TOPE_ADS = Number($vars.TOPE_ADS_POR_CORRIDA || 200);
if (ads.length > TOPE_ADS) {
  problemas.push('El plan trae ' + ads.length + ' anuncios y el tope por corrida es ' + TOPE_ADS
    + '. Divídelo en varias cargas.');
}

/* ---- la cuenta sigue asignada al system user (paginación completa) ---- */
let cuenta = null;
try {
  const crudas = await todasLasCuentas('account_id,name,currency,timezone_name,'
    + 'account_status,min_daily_budget');
  const a = resolverCuenta(crudas, b.cuenta_id, b.client_key);
  if (a) cuenta = {
    act: 'act_' + String(a.account_id).replace(/^act_/, ''),
    currency: a.currency,
    tz: a.timezone_name || 'UTC',
    minDiario: aMayor(a.min_daily_budget, a.currency),
  };
} catch (e) {
  problemas.push('No pude confirmar la cuenta en Meta: ' + explicar(e));
}
if (!cuenta && !problemas.length) {
  problemas.push('El system user ya no tiene acceso a la cuenta "'
    + (b.cuenta_id || b.client_key) + '".');
}

/* ---- destino WhatsApp (v3.4): permitido; se valida por conjunto más abajo ---- */
const esWhatsApp = a => String(a.destination_type || '').toUpperCase() === 'WHATSAPP';
const esFormulario = a => String(a.destination_type || '').toUpperCase() === 'ON_AD';

/* ---- campañas: nuevas y existentes conviven en el mismo plan (v3) ---- */
let campExistente = null;
let categoriasVigentes = [];        /* unión, para mensajes generales */
const catsPorCampana = {};          /* campaign_key → [categorías] */
const objetivoPorCampana = {};      /* campaign_key → objetivo real */
let estrategiaCampana = '';
const nombresExistentes = [];
const CON_IMPORTE = ['LOWEST_COST_WITH_BID_CAP','COST_CAP','TARGET_COST','LOWEST_COST_WITH_MIN_ROAS'];

camps.forEach(c => {
  catsPorCampana[c.campaign_key] = lista(c.special_ad_categories).map(x => String(x).toUpperCase()).filter(x => x && x !== 'NONE');
  catsPorCampana[c.campaign_key].forEach(x => { if (categoriasVigentes.indexOf(x) < 0) categoriasVigentes.push(x); });
});

if (usaExistente && cuenta) {
  for (const cid of idsExistentes) {
    const key = 'existente_' + cid;
    const mios = adsets.filter(a => String(a.campaign_id) === String(cid));
    try {
      const c = await gGet(base + cid + '?fields=id,name,objective,effective_status,'
        + 'daily_budget,lifetime_budget,account_id,special_ad_categories,bid_strategy');
      if (!campExistente) campExistente = c;
      nombresExistentes.push(c.name);
      catsPorCampana[key] = (c.special_ad_categories || []).filter(x => x && x !== 'NONE');
      objetivoPorCampana[key] = String(c.objective || '').toUpperCase();
      catsPorCampana[key].forEach(x => { if (categoriasVigentes.indexOf(x) < 0) categoriasVigentes.push(x); });
      if (String(c.account_id) !== cuenta.act.replace('act_','')) {
        problemas.push('La campaña "' + c.name + '" pertenece a otra cuenta publicitaria.');
      }
      if (['DELETED','ARCHIVED'].indexOf(c.effective_status) >= 0) {
        problemas.push('La campaña "' + c.name + '" está ' + c.effective_status + ' y no admite cambios.');
      }
      const cbo = !!(c.daily_budget || c.lifetime_budget);
      const conPresupuestoPropio = mios.some(a => Number(a.daily_budget) || Number(a.lifetime_budget));
      if (mios.length && cbo && conPresupuestoPropio) {
        problemas.push('La campaña "' + c.name + '" administra el presupuesto a nivel campaña: sus conjuntos nuevos no pueden traer monto.');
      }
      if (mios.length && !cbo && !mios.every(a => Number(a.daily_budget) || Number(a.lifetime_budget))) {
        problemas.push('La campaña "' + c.name + '" no tiene presupuesto propio: cada conjunto nuevo necesita el suyo.');
      }
      /* Estrategias con tope exigen bid_amount en cada conjunto (error 100/1815857). */
      const estr = String(c.bid_strategy || '').toUpperCase();
      if (mios.length && CON_IMPORTE.indexOf(estr) >= 0) {
        estrategiaCampana = estr;
        if (!mios.every(a => Number(a.bid_amount))) {
          problemas.push('La campaña "' + c.name + '" usa la estrategia de puja ' + estr
            + ', que obliga a fijar un importe por conjunto. Cambia la campaña a costo más bajo en Ads Manager '
            + 'o crea una campaña nueva desde aquí.');
        }
      }
    } catch (e) {
      problemas.push('No pude leer la campaña ' + cid + ': ' + explicar(e));
    }
  }
}

/* ---- campañas nuevas con puja con tope: cada conjunto nuevo necesita su importe (5.3) ---- */
camps.forEach(c => {
  const estr = String(c.bid_strategy || '').toUpperCase();
  if (CON_IMPORTE.indexOf(estr) < 0) return;
  adsets.filter(a => a.campaign_key === c.campaign_key && !a.clonar_conjunto_de && !Number(a.bid_amount))
    .forEach(a => problemas.push('El conjunto "' + a.name + '" está en una campaña con puja ' + estr + ' y no trae importe de puja. Captura el importe o usa costo más bajo.'));
});

/* ---- conjuntos existentes: siguen vivos y son de las campañas elegidas ---- */
if (ads.some(a => a.adset_id) && cuenta) {
  /* Una sola llamada por cada 50 conjuntos (?ids=) en vez de una por conjunto:
     el envío pasa por el proxy de Netlify, que corta las peticiones largas. */
  const idsConj = ads.filter(a => a.adset_id).map(a => String(a.adset_id));
  try {
    const leidos = await porIds(idsConj, 'id,name,campaign_id,effective_status');
    [...new Set(idsConj)].forEach(id => {
      const s = leidos[id];
      if (!s) { problemas.push('El conjunto ' + id + ' ya no existe o el token no tiene acceso.'); return; }
      if (['DELETED','ARCHIVED'].indexOf(s.effective_status) >= 0) problemas.push('El conjunto "' + s.name + '" está ' + s.effective_status + ' y no admite anuncios nuevos.');
      if (idsExistentes.length && idsExistentes.indexOf(String(s.campaign_id)) < 0) problemas.push('El conjunto "' + s.name + '" no pertenece a las campañas elegidas.');
    });
  } catch (e) {
    problemas.push('No pude leer los conjuntos existentes: ' + explicar(e));
  }
}

/* ---- referencias a clonar: existen y están en esta cuenta ---- */
const refs = [...new Set(adsets.map(a => a.clonar_conjunto_de).filter(Boolean).concat(camps.map(c => c.clonar_campana_de).filter(Boolean)).concat(camps.map(c => c.referencia_conjunto).filter(Boolean)))];
if (refs.length && cuenta) {
  try {
    const leidos = await porIds(refs, 'id,name,account_id,effective_status');
    refs.forEach(id => {
      const x = leidos[id];
      if (!x) problemas.push('No pude leer el objeto de referencia ' + id + ' para clonarlo: puede haberse borrado o el token no tiene acceso.');
      else if (String(x.account_id || '').replace('act_', '') && String(x.account_id).replace('act_', '') !== cuenta.act.replace('act_', '')
               && (adsets.some(a => a.clonar_conjunto_de === id) || camps.some(c => c.clonar_campana_de === id)))
        problemas.push('"' + x.name + '" está en otra cuenta publicitaria: Meta solo clona dentro de la misma cuenta. Elige una referencia de esta cuenta.');
      else if (['DELETED'].indexOf(x.effective_status) >= 0) problemas.push('"' + x.name + '" está borrado y no se puede clonar.');
    });
  } catch (e) { problemas.push('No pude verificar las referencias a clonar: ' + explicar(e)); }
}

/* ---- audiencias guardadas de la cuenta: existen y son legibles ---- */
const segGuardada = {};
for (const a of adsets) {
  if (!a.saved_audience_id) continue;
  if (segGuardada[a.saved_audience_id] !== undefined) continue;
  try {
    const sa = await gGet(base + a.saved_audience_id + '?fields=id,name,targeting');
    segGuardada[a.saved_audience_id] = sa.targeting || {};
    if (!sa.targeting) problemas.push('La audiencia guardada "' + (sa.name || a.saved_audience_id) + '" no trae segmentación legible.');
  } catch (e) {
    segGuardada[a.saved_audience_id] = null;
    problemas.push('No pude leer la audiencia guardada del conjunto "' + a.name + '": ' + explicar(e));
  }
}

/* ---- categoría especial: por campaña, y el navegador no es la última palabra (D3-01) ---- */
const paisPorCampana = {};
camps.forEach(c => {
  const cats = catsPorCampana[c.campaign_key] || [];
  if (!cats.length) return;
  const paises = [];
  adsets.filter(a => a.campaign_key === c.campaign_key).forEach(a => {
    let ps = lista(a.countries);
    if (!ps.length && a.targeting_json) { try { ps = ((JSON.parse(a.targeting_json).geo_locations || {}).countries) || []; } catch (e) {} }
    ps.forEach(p => { const v = String(p).toUpperCase(); if (v && paises.indexOf(v) < 0) paises.push(v); });
  });
  if (!paises.length) problemas.push('La campaña "' + c.name + '" tiene categoría especial y ningún conjunto suyo trae país. Selecciona el país.');
  if (paises.length > 1) problemas.push('La campaña "' + c.name + '" tiene categoría especial y solo admite un país; sus conjuntos traen: ' + paises.join(', ') + '.');
  if (paises.length === 1) paisPorCampana[c.campaign_key] = paises[0];
});
adsets.forEach(a => {
  const cats = catsPorCampana[a.campaign_key] || [];
  if (!cats.length) return;
  const et = 'El conjunto "' + a.name + '"';
  if (a.saved_audience_id || a.targeting_json) {
    let t = null;
    if (a.saved_audience_id) t = segGuardada[a.saved_audience_id];
    else { try { t = JSON.parse(a.targeting_json); } catch (e) { problemas.push(et + ': la segmentación copiada no es legible.'); } }
    if (t) {
      if (Number(t.age_min) && Number(t.age_min) !== 18) problemas.push(et + ' usa una audiencia guardada con edad mínima ' + t.age_min + '; con categoría especial debe ser 18.');
      if (Number(t.age_max) && Number(t.age_max) < 65) problemas.push(et + ' usa una audiencia guardada con edad máxima ' + t.age_max + '; con categoría especial debe llegar a 65.');
      if (t.genders && t.genders.length) problemas.push(et + ' usa una audiencia guardada con género; con categoría especial no se permite.');
      const fl = t.flexible_spec || [];
      if (t.interests || t.behaviors || fl.some(x => x.interests || x.behaviors)) problemas.push(et + ' usa una audiencia guardada con intereses o comportamientos; con categoría especial no se permite.');
      if (t.excluded_custom_audiences || t.exclusions) problemas.push(et + ' usa una audiencia guardada con exclusiones; con categoría especial no se permite.');
    }
    return;
  }
  if (Number(a.age_min) && Number(a.age_min) !== 18) problemas.push(et + ' debe empezar en 18 años con categoría especial; Meta no permite acotar la edad.');
  if (Number(a.age_max) && Number(a.age_max) < 65) problemas.push(et + ' debe llegar hasta 65 años con categoría especial.');
  if (String(a.genders || 'ALL').toUpperCase() !== 'ALL') problemas.push(et + ' no puede segmentar por género con categoría especial.');
  if (lista(a.interest_ids).length) problemas.push(et + ' no puede usar intereses con categoría especial.');
  if (lista(a.behavior_ids).length || lista(a.demographic_ids).length) problemas.push(et + ' no puede usar comportamientos ni datos demográficos con categoría especial.');
  if (lista(a.excluded_audience_ids).length) problemas.push(et + ' no puede excluir audiencias con categoría especial.');
  if (lista(a.zips).length) problemas.push(et + ' no puede segmentar por código postal con categoría especial.');
});

/* ---- la página existe y sigue asociada ---- */
let pageId = String(b.page_id || '');
if (cuenta) {
  /* Mismas tres fuentes que el buscador: perfil, Business y, al final, la
     cuenta publicitaria. Si no logro enumerar ninguna, NO bloqueo: dejo que
     Meta decida al crear el anuncio, en vez de rechazar un plan válido. */
  const ids = {};
  const sumar = (arr) => (arr || []).forEach(x => { if (x && x.id) ids[String(x.id)] = true; });
  try { const r1 = await gGet(base + 'me/accounts?fields=id&limit=100'); sumar(r1.data); } catch (e) {}
  try {
    const info = await gGet(base + cuenta.act + '?fields=business{id}');
    const bid = info.business && info.business.id;
    if (bid) {
      try { const r2 = await gGet(base + bid + '/owned_pages?fields=id&limit=100');  sumar(r2.data); } catch (e) {}
      try { const r3 = await gGet(base + bid + '/client_pages?fields=id&limit=100'); sumar(r3.data); } catch (e) {}
    }
  } catch (e) {}
  try { const r4 = await gGet(base + cuenta.act + '/promote_pages?fields=id&limit=100'); sumar(r4.data); } catch (e) {}

  const disponibles = Object.keys(ids);
  if (!pageId && disponibles.length === 1) {
    pageId = disponibles[0];
  } else if (!pageId && disponibles.length > 1) {
    problemas.push('Hay ' + disponibles.length + ' páginas disponibles. Elige cuál usar antes de publicar.');
  } else if (!pageId) {
    problemas.push('No hay página de Facebook seleccionada y no encontré ninguna accesible con este token.');
  } else if (disponibles.length && disponibles.indexOf(pageId) < 0) {
    /* Cada lista trae como máximo 100 páginas: una agencia con más páginas no las ve todas.
       Antes de bloquear se lee la página directamente; si el token la ve, decide Meta al crear. */
    let visible = false;
    try { const pg = await gGet(base + pageId + '?fields=id,name'); visible = !!(pg && pg.id); } catch (e) {}
    if (!visible) problemas.push('La página elegida ya no está accesible con este token.');
  }
}

/* ---- presupuestos sobre el mínimo real ---- */
if (cuenta) {
  const min = cuenta.minDiario || 0;
  const revisa = (etiqueta, fila) => {
    const d = Number(fila.daily_budget || 0);
    const t = Number(fila.lifetime_budget || 0);
    if (d && t) problemas.push(etiqueta + ' tiene presupuesto diario y total a la vez. Solo uno de los dos.');
    if (d && min && d < min) {
      problemas.push(etiqueta + ' tiene ' + d + ' ' + cuenta.currency
        + ' al día y el mínimo de la cuenta es ' + min + '.');
    }
    if (t && !fila.stop_time && !fila.end_time) {
      problemas.push(etiqueta + ' usa presupuesto total, así que necesita fecha de fin.');
    }
  };
  camps.forEach(c => revisa('La campaña "' + c.name + '"', c));
  adsets.forEach(a => revisa('El conjunto "' + a.name + '"', a));
}

/* ---- combinaciones que Meta rechaza o que esta herramienta no cubre ---- */
const PERMITIDAS = {
  OUTCOME_SALES:      ['OFFSITE_CONVERSIONS','VALUE','LANDING_PAGE_VIEWS','LINK_CLICKS'],
  OUTCOME_LEADS:      ['OFFSITE_CONVERSIONS','LANDING_PAGE_VIEWS','LINK_CLICKS'],
  OUTCOME_TRAFFIC:    ['LANDING_PAGE_VIEWS','LINK_CLICKS','REACH','IMPRESSIONS'],
  OUTCOME_ENGAGEMENT: ['POST_ENGAGEMENT','THRUPLAY'],
  OUTCOME_AWARENESS:  ['REACH','IMPRESSIONS','THRUPLAY'],
};
/* Nombres legibles para los mensajes. */
const NOMBRE_META = { LEAD_GENERATION:'Clientes potenciales', QUALITY_LEAD:'Clientes potenciales de conversión', MESSAGING_PURCHASE_CONVERSION:'Compras por mensajes', CONVERSATIONS:'Conversaciones', OFFSITE_CONVERSIONS:'Conversiones del sitio web',
  LINK_CLICKS:'Clics', LANDING_PAGE_VIEWS:'Vistas de página', IMPRESSIONS:'Impresiones', REACH:'Alcance', POST_ENGAGEMENT:'Interacción con la publicación', THRUPLAY:'Reproducciones', VALUE:'Valor de compra' };
const NOMBRE_OBJ = { OUTCOME_SALES:'Ventas', OUTCOME_ENGAGEMENT:'Interacción', OUTCOME_TRAFFIC:'Tráfico', OUTCOME_LEADS:'Clientes potenciales', OUTCOME_AWARENESS:'Reconocimiento' };
const nm = x => NOMBRE_META[x] || x, no = x => NOMBRE_OBJ[x] || x;
/* Click to WhatsApp: combinaciones admitidas según la documentación de Meta. */
const PERMITIDAS_WA = {
  /* Compras por mensajes con WhatsApp: objetivo Interacción (así lo crea Ads Manager;
     con Ventas Meta responde 100/2490408). */
  OUTCOME_SALES:      ['CONVERSATIONS','OFFSITE_CONVERSIONS','LINK_CLICKS','IMPRESSIONS','REACH'],
  OUTCOME_ENGAGEMENT: ['MESSAGING_PURCHASE_CONVERSION','CONVERSATIONS','LINK_CLICKS'],
  OUTCOME_TRAFFIC:    ['CONVERSATIONS','LANDING_PAGE_VIEWS','LINK_CLICKS','IMPRESSIONS','REACH','POST_ENGAGEMENT'],
  OUTCOME_LEADS:      ['CONVERSATIONS'],
};
/* Estas exigen activos que el formulario no captura (formularios instantáneos,
   destinos de mensajería, anuncios de me gusta). Se crean desde Ads Manager. */
const NO_CUBIERTAS = {
  CONVERSATIONS:   'un destino de mensajería (Messenger, WhatsApp o Instagram)',
  PAGE_LIKES:      'un anuncio de me gusta a la página',
  QUALITY_CALL:    'llamadas',
};
/* Formulario instantáneo (5.0): objetivo Clientes potenciales, destino ON_AD. */
const METAS_FORMULARIO = ['LEAD_GENERATION', 'QUALITY_LEAD'];
const objetivoDe = Object.assign({}, objetivoPorCampana);
camps.forEach(c => objetivoDe[c.campaign_key] = String(c.objective || '').toUpperCase());
const adsPorConjunto = {};
ads.forEach(a => { (adsPorConjunto[a.adset_key] = adsPorConjunto[a.adset_key] || []).push(a); });

adsets.forEach(a => {
  const et = 'El conjunto "' + a.name + '"';
  const meta = String(a.optimization_goal || '').toUpperCase();
  const obj = objetivoDe[a.campaign_key] || '';
  if (a.clonar_conjunto_de) {
    /* Se clona con /copies un conjunto que Meta ya aceptó: no aplica la tabla. */
  } else if (esWhatsApp(a) && a.config_json) {
    /* Copia de un conjunto que Meta ya aceptó en esta cuenta: no se aplica la tabla. */
    try { const cfg = JSON.parse(a.config_json); if (!cfg.optimization_goal) problemas.push(et + ': la configuración copiada no trae optimización.'); }
    catch (e) { problemas.push(et + ': la configuración copiada no es legible.'); }
  } else if (esFormulario(a)) {
    if (obj && obj !== 'OUTCOME_LEADS') problemas.push(et + ' usa formulario instantáneo y su campaña tiene objetivo ' + no(obj) + '. Los formularios solo funcionan con Clientes potenciales.');
    if (METAS_FORMULARIO.indexOf(meta) < 0) problemas.push(et + ' usa formulario instantáneo y optimiza por "' + nm(meta) + '". Elige Clientes potenciales o Clientes potenciales de conversión.');
  } else if (METAS_FORMULARIO.indexOf(meta) >= 0) {
    problemas.push(et + ' optimiza por clientes potenciales con formulario, pero el conjunto no usa formulario instantáneo. Cambia su destino a Formulario.');
  } else if (esWhatsApp(a)) {
    const permit = PERMITIDAS_WA[obj];
    if (obj && !permit) problemas.push(et + ' va a WhatsApp, y el objetivo ' + no(obj) + ' no admite ese destino. Usa Ventas, Interacción, Tráfico o Clientes potenciales.');
    else if (obj && permit.indexOf(meta) < 0) problemas.push(et + ' va a WhatsApp y optimiza por "' + nm(meta) + '", que Meta no admite con el objetivo ' + no(obj)
      + (meta === 'MESSAGING_PURCHASE_CONVERSION' ? '. Con WhatsApp, las compras por mensajes se crean con objetivo Interacción.' : '.'));
    if (meta === 'MESSAGING_PURCHASE_CONVERSION' && !a.whatsapp_phone_number) problemas.push(et + ' optimiza por compras en WhatsApp y no tiene número de WhatsApp seleccionado.');
    if (meta === 'OFFSITE_CONVERSIONS' && !a.pixel_id && !a.messaging_dataset_id) problemas.push(et + ' va a WhatsApp y optimiza por conversiones, pero no tiene conjunto de datos: elige el de WhatsApp (CAPI) en la campaña.');
    if (a.whatsapp_phone_number && !/^\+?\d{10,15}$/.test(String(a.whatsapp_phone_number).replace(/[\s\-().]/g, ''))) {
      problemas.push(et + ': el número de WhatsApp "' + a.whatsapp_phone_number + '" no tiene un formato válido. Escríbelo con código de país, por ejemplo +52 81 1454 0207.');
    }
  } else if (NO_CUBIERTAS[meta]) {
    problemas.push(et + ' optimiza por ' + meta + ', que necesita ' + NO_CUBIERTAS[meta]
      + '. Esta herramienta no lo captura: crea esa campaña desde Ads Manager.');
  } else if (obj && PERMITIDAS[obj] && PERMITIDAS[obj].indexOf(meta) < 0) {
    problemas.push(et + ' optimiza por "' + nm(meta) + '", que Meta no admite con el objetivo ' + no(obj) + '.');
  }
  if (!esWhatsApp(a) && ['OFFSITE_CONVERSIONS','VALUE'].indexOf(meta) >= 0) {
    if (!a.pixel_id) problemas.push(et + ' optimiza por conversiones y la cuenta no tiene píxel. Sin píxel, elige clics o vistas de página.');
    if (!a.custom_event_type) problemas.push(et + ' optimiza por conversiones y no indica el evento.');
    if (meta === 'VALUE' && String(a.custom_event_type || '').toUpperCase() !== 'PURCHASE') {
      problemas.push(et + ' optimiza por valor, que solo funciona con el evento PURCHASE.');
    }
  }
  if (meta === 'THRUPLAY') {
    const noVideo = (adsPorConjunto[a.adset_key] || []).filter(x => String(x.creative_type).toUpperCase() !== 'VIDEO');
    if (noVideo.length) problemas.push(et + ' optimiza por reproducciones (ThruPlay) pero tiene '
      + noVideo.length + ' anuncio(s) con imagen. ThruPlay solo admite video.');
  }
  /* Presupuesto total: al menos el mínimo diario por cada día de vigencia y 24 h de duración. */
  const t = Number(a.lifetime_budget || 0);
  if (t && a.end_time && cuenta && cuenta.minDiario) {
    const ini = a.start_time ? Date.parse(String(a.start_time).replace(' ','T')) : Date.now();
    const fin = Date.parse(String(a.end_time).replace(' ','T'));
    if (!isNaN(ini) && !isNaN(fin)) {
      const dias = Math.max(1, Math.ceil((fin - ini) / 86400000));
      if (fin - ini < 86400000) problemas.push(et + ' necesita al menos 24 horas entre inicio y fin.');
      if (t < cuenta.minDiario * dias) problemas.push(et + ' tiene presupuesto total de ' + t + ' '
        + cuenta.currency + ' para ' + dias + ' día(s); el mínimo es ' + (cuenta.minDiario * dias) + '.');
    }
  }
});
camps.forEach(c => {
  const t = Number(c.lifetime_budget || 0);
  if (t && c.stop_time && cuenta && cuenta.minDiario) {
    const ini = c.start_time ? Date.parse(String(c.start_time).replace(' ','T')) : Date.now();
    const fin = Date.parse(String(c.stop_time).replace(' ','T'));
    if (!isNaN(ini) && !isNaN(fin)) {
      const dias = Math.max(1, Math.ceil((fin - ini) / 86400000));
      if (fin - ini < 86400000) problemas.push('La campaña "' + c.name + '" necesita al menos 24 horas entre inicio y fin.');
      if (t < cuenta.minDiario * dias) problemas.push('La campaña "' + c.name + '" tiene presupuesto total de ' + t + ' '
        + cuenta.currency + ' para ' + dias + ' día(s); el mínimo es ' + (cuenta.minDiario * dias) + '.');
    }
  }
});
/* Botón de WhatsApp con destino web: Meta lo rechaza. */
ads.forEach(a => {
  if (String(a.cta_type || '').toUpperCase() === 'WHATSAPP_MESSAGE' && String(a.destino || '').toUpperCase() !== 'WHATSAPP') {
    problemas.push('El anuncio "' + a.name + '" usa el botón "Enviar WhatsApp" en un conjunto que va al sitio web.');
  }
});

/* ---- integridad de llaves ---- */
const kCamp = {}, kAdset = {};
camps.forEach(c => kCamp[c.campaign_key] = true);
adsets.forEach(a => {
  kAdset[a.adset_key] = true;
  if (!usaExistente && !kCamp[a.campaign_key]) {
    problemas.push('El conjunto "' + a.name + '" apunta a una campaña que no existe.');
  }
  if (!a.saved_audience_id && !a.targeting_json && !a.countries && !a.region_keys && !a.city_keys) {
    problemas.push('El conjunto "' + a.name + '" no tiene ninguna geografía.');
  }
});
const refAssets = {};
assets.forEach(a => refAssets[a.asset_ref] = a);
ads.forEach(a => {
  if (!a.adset_id && !kAdset[a.adset_key]) problemas.push('El anuncio "' + a.name + '" apunta a un conjunto que no existe.');
  if ((a.creative_type === 'IMAGE' || a.creative_type === 'VIDEO') && !refAssets[a.asset_ref]) {
    problemas.push('El anuncio "' + a.name + '" no tiene creativo cargado.');
  }
  if (!a.link_url && a.creative_type !== 'EXISTING_POST' && ['WHATSAPP','FORMULARIO'].indexOf(String(a.destino || '').toUpperCase()) < 0) {
    problemas.push('El anuncio "' + a.name + '" no tiene enlace de destino.');
  }
});

/* ---- formularios instantáneos: cada anuncio trae uno, activo y de la página elegida ---- */
const adsConForm = ads.filter(a => String(a.destino || '').toUpperCase() === 'FORMULARIO');
if (adsConForm.length) {
  adsConForm.filter(a => !a.lead_form_id).forEach(a => problemas.push('El anuncio "' + a.name + '" va a un conjunto con formulario instantáneo y no tiene formulario elegido.'));
  const CTAS_FORM = ['SIGN_UP','LEARN_MORE','APPLY_NOW','GET_QUOTE','SUBSCRIBE','DOWNLOAD','BOOK_TRAVEL','GET_OFFER','CONTACT_US'];
  adsConForm.filter(a => a.cta_type && CTAS_FORM.indexOf(String(a.cta_type).toUpperCase()) < 0)
    .forEach(a => problemas.push('El anuncio "' + a.name + '" usa el botón ' + a.cta_type + ', que Meta no admite con formularios. Usa Registrarse, Más información, Solicitar o Cotizar.'));
  const pedidos = [...new Set(adsConForm.map(a => String(a.lead_form_id || '')).filter(Boolean))];
  if (pedidos.length && pageId) {
    try {
      const tk = await tokenPagina(pageId);
      const deLaPagina = {};
      let u = base + pageId + '/leadgen_forms?fields=id,name,status&limit=100';
      for (let i = 0; i < 20 && u; i++) { const r = await gGet(u, tk); (r.data || []).forEach(x => { deLaPagina[String(x.id)] = x; }); u = r.paging && r.paging.next ? r.paging.next : null; }
      pedidos.forEach(id => {
        const x = deLaPagina[id];
        if (!x) problemas.push('El formulario ' + id + ' no pertenece a la página elegida o ya no existe. Elige uno de esta página.');
        else if (String(x.status || '').toUpperCase() !== 'ACTIVE') problemas.push('El formulario "' + x.name + '" está ' + x.status + ': solo se pueden usar formularios activos.');
      });
    } catch (e) {
      problemas.push('No pude leer los formularios de la página: ' + explicar(e));
    }
  }
}

/* ---- publicaciones existentes (5.1): se usan tal cual; solo en conjuntos al sitio web ---- */
ads.filter(a => a.creative_type === 'EXISTING_POST').forEach(a => {
  if (!a.post_id) problemas.push('El anuncio "' + a.name + '" usa una publicación existente y no tiene publicación elegida.');
  if (['WHATSAPP','FORMULARIO'].indexOf(String(a.destino || '').toUpperCase()) >= 0)
    problemas.push('El anuncio "' + a.name + '" usa una publicación existente en un conjunto de ' + (String(a.destino).toUpperCase() === 'WHATSAPP' ? 'WhatsApp' : 'formulario')
      + '. Meta no permite cambiar el botón de una publicación ya publicada: usa una imagen o video.');
});
/* ---- textos: máximo 5 opciones de cada uno ---- */
ads.forEach(a => {
  if (a.creative_type === 'EXISTING_POST') return;
  const tx = String(a.primary_texts || a.primary_text || '').split(' || ').filter(s => s.trim());
  const ti = String(a.headlines || a.headline || '').split(' || ').filter(s => s.trim());
  if (!tx.length) problemas.push('El anuncio "' + a.name + '" no tiene texto principal.');
  if (!ti.length) problemas.push('El anuncio "' + a.name + '" no tiene título.');
  if (tx.length > 5) problemas.push('El anuncio "' + a.name + '" trae ' + tx.length + ' textos principales; Meta admite 5.');
  if (ti.length > 5) problemas.push('El anuncio "' + a.name + '" trae ' + ti.length + ' títulos; Meta admite 5.');
});

/* ---- creativos descargables sin sesión ---- */
for (const a of assets) {
  if (a.image_hash || a.video_id) continue;   /* ya están en la cuenta */
  if (a.source_data) {
    if (String(a.type).toUpperCase() === 'VIDEO') problemas.push('El creativo "' + a.asset_ref + '" es un video subido desde el ordenador; los videos van por enlace.');
    continue;
  }
  const u = String(a.source_url || '');
  if (!u) { problemas.push('El creativo "' + a.asset_ref + '" no tiene archivo ni enlace.'); continue; }
  if (/drive\.google\.com\/drive\/folders/.test(u)) {
    problemas.push('El creativo "' + a.asset_ref + '" apunta a una carpeta de Drive. '
      + 'Hace falta el enlace del archivo, no de la carpeta.');
  }
}

/* ---- avisos (no bloquean) ---- */
const avisosVal = [], infoVal = [];

/* ---- WhatsApp (5.5): se verifica con Meta, sin crear nada, qué configuración acepta para cada campaña ---- */
const waResuelto = {};
if (cuenta && pageId && !problemas.length) {
  const cacheWA = {};
  const porCampana = {};
  adsets.filter(esWhatsApp).forEach(a => { if (!porCampana[a.campaign_key]) porCampana[a.campaign_key] = a; });
  for (const k of Object.keys(porCampana)) {
    const a = porCampana[k];
    let cfg = null; try { cfg = a.config_json ? JSON.parse(a.config_json) : null; } catch (e) {}
    const cNueva = camps.find(x => x.campaign_key === k);
    const existente = !cNueva && a.campaign_id;
    let campanaFija = null;
    if (existente) { try { const r = await gGet(base + a.campaign_id + '?fields=daily_budget,lifetime_budget'); campanaFija = { id: String(a.campaign_id), cbo: !!(Number(r.daily_budget) || Number(r.lifetime_budget)) }; } catch (e) {} }
    const pais = lista(a.countries)[0] || 'MX';
    /* El objetivo del plan se respeta salvo que se permita cambiarlo (5.5.1). */
    const fijo = existente ? objetoDeExistente(k) : (cNueva && String(cNueva.wa_cambiar_objetivo || '').toUpperCase() !== 'SI' ? String(cNueva.objective || '').toUpperCase() : '');
    const campanaRef = await campanaDeReferencia(cNueva);
    try {
      const r = await resolverWA({ acc: cuenta.act, pageId, meta: (cfg && cfg.optimization_goal) || a.optimization_goal, objetivo: (cNueva || {}).objective || objetoDeExistente(k),
        objetivoRef: (cNueva || {}).objective, objetivoFijo: fijo, campanaFija, campanaRef, cfg, numero: a.whatsapp_phone_number,
        dataset: a.messaging_dataset_id || (String(a.optimization_goal).toUpperCase() === 'OFFSITE_CONVERSIONS' ? a.pixel_id : ''), evento: a.custom_event_type,
        targeting: { geo_locations: { countries: [pais] }, age_min: 18, targeting_automation: { advantage_audience: 0 } },
        moneda: cuenta.currency, minimo: cuenta.minDiario, cache: cacheWA });
      const nom = cNueva ? 'La campaña "' + cNueva.name + '"' : 'El conjunto "' + a.name + '"';
      if (r.ok) {
        waResuelto[k] = { estado: 'ok', elegido: r.elegido, intentos: r.intentos };
        (r.intentos.length || (cNueva && r.elegido.objetivo !== String(cNueva.objective).toUpperCase()) ? avisosVal : infoVal).push(nom + ' va a WhatsApp con una configuración verificada con Meta: ' + r.elegido.etiqueta
          + (cNueva && r.elegido.objetivo !== String(cNueva.objective).toUpperCase() ? ' (el objetivo cambia de ' + (NOMBRE_OBJETIVO[String(cNueva.objective).toUpperCase()] || cNueva.objective) + ' a ' + (NOMBRE_OBJETIVO[r.elegido.objetivo] || r.elegido.objetivo) + ')' : '')
          + (r.intentos.length ? '. Antes Meta rechazó: ' + textoIntentosWA(r.intentos) : '') + '.');
      } else if (r.sinPrueba.length) {
        waResuelto[k] = { estado: 'pendiente', intentos: r.intentos };
        avisosVal.push(nom + ': no pude verificar todas las configuraciones de WhatsApp antes de crear (' + textoIntentosWA(r.intentos) + '). Al publicar, el motor las prueba en una campaña temporal en pausa que luego elimina.');
      } else {
        waResuelto[k] = { estado: 'falla', intentos: r.intentos };
        problemas.push(nom + ': Meta rechazó todas las configuraciones de WhatsApp' + (fijo ? ' con objetivo ' + (NOMBRE_OBJETIVO[fijo] || fijo) : '') + ', así que no se creó nada. '
          + (r.faltaDataset ? 'Falta elegir el conjunto de datos de compras (WhatsApp CAPI) en la campaña. ' : '') + textoIntentosWA(r.intentos)
          + (fijo && !existente ? '. Si aceptas otro objetivo, marca en la campaña "Permitir que el motor cambie el objetivo" y vuelve a revisar' : '')
          + '. Revisa en "Chequeo de Meta" que el número esté vinculado a la página y, para compras, elige el conjunto de datos de WhatsApp (CAPI).');
      }
    } catch (e) { waResuelto[k] = { estado: 'pendiente', intentos: [] }; }
  }
}
function objetoDeExistente(k){ return objetivoDe[k] || ''; }
/* Campaña de la referencia (misma configuración de campaña): el lugar más fiel para probar. */
async function campanaDeReferencia(c){
  const id = c && (c.clonar_campana_de || '');
  if (!id) return null;
  try { const r = await gGet(base + id + '?fields=objective,daily_budget,lifetime_budget'); return { id: String(id), objetivo: r.objective, cbo: !!(Number(r.daily_budget) || Number(r.lifetime_budget)) }; }
  catch (e) { return null; }
}

/* El run_id lo generó "Fila de arranque" antes de responder al navegador. */
let runId = 'prevalidacion';
try { runId = $('Fila de arranque').first().json.run_id; } catch (e) { /* ruta "prevalidar": no hay corrida */ }

return [{ json: {
  ok: problemas.length === 0,
  problemas,
  avisos: avisosVal,
  info: infoVal,
  wa_resuelto: waResuelto,
  run_id: runId,
  client_key: b.client_key || '',
  cuenta_id: cuenta ? cuenta.act.replace('act_','') : String(b.cuenta_id || ''),
  operador: String(b.usuario || b.operador || ''),
  campana: b.campana || (nombresExistentes.length ? nombresExistentes.join(' + ') : ''),
  campaign_id: usaExistente ? String(idsExistentes[0]) : '',
  campaign_ids: idsExistentes,
  page_id: pageId,
  act: cuenta ? cuenta.act : '',
  moneda: cuenta ? cuenta.currency : '',
  tz: cuenta ? cuenta.tz : 'UTC',
  categorias: categoriasVigentes,
  bid_strategy: estrategiaCampana,
  pais_por_campana: paisPorCampana,
  total_ads: ads.length,
  total_adsets: adsets.length,
} }];
