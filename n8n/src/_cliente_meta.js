/* ================= Meta Bulk Editor · motor 5.5 · cliente Meta compartido ==
   FUENTE ÚNICA: este archivo se inserta al inicio de cada nodo que habla con
   Meta (build.py). No se edita dentro de n8n: se edita aquí y se reconstruye.
   Sin fallback de versión · errores con code/subcode + backoff · paginación
   completa · offset de moneda en una sola función · token de página para
   formularios instantáneos (5.0).
   ====================================================================== */
const token   = $vars.META_ACCESS_TOKEN;
const version = $vars.META_API_VERSION;
if (!token)   throw new Error('Falta la variable META_ACCESS_TOKEN en n8n.');
if (!version) throw new Error('Falta META_API_VERSION en n8n. No hay versión por defecto: fíjala explícitamente.');
const base = `https://graph.facebook.com/${version}/`;
/* Versión mínima vigente de la API (v23 se retiró el 9-jun-2026). Se informa al sitio. */
const VERSION_API_NUM = Number(String(version).replace(/^v/i, '')) || 0;
const VERSION_API_MINIMA = 24;
const http = (this && this.helpers && this.helpers.httpRequest)
  ? this.helpers.httpRequest.bind(this) : null;
if (!http) throw new Error('Este Code node necesita this.helpers.httpRequest.');

/* Límites de uso: Meta pide esperar y reintentar (no se creó nada). */
const REINTENTABLES = [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014];
/* Errores temporales de Meta (1 desconocido, 2 servicio) y errores marcados is_transient:
   se reintentan solo en lecturas, para no duplicar una creación que sí ocurrió. */
const TRANSITORIOS = [1, 2];
function pausa(ms){ return new Promise(s => setTimeout(s, ms)); }
function fallo(r){
  const e = (r.body && r.body.error) || {};
  const err = new Error(e.error_user_msg || e.message || ('HTTP ' + r.statusCode));
  err.titulo = e.error_user_title || '';
  err.code = e.code; err.subcode = e.error_subcode; err.fbtrace = e.fbtrace_id;
  err.transitorio = e.is_transient === true || TRANSITORIOS.indexOf(Number(e.code)) >= 0 || (!e.code && r.statusCode >= 500);
  /* Meta suele indicar el campo exacto que provocó el rechazo: se conserva. */
  let ed = e.error_data; if (typeof ed === 'string') { try { ed = JSON.parse(ed); } catch (x) { ed = null; } }
  const campos = ed && ed.blame_field_specs ? [].concat(...ed.blame_field_specs.map(b => [].concat(b))).map(String) : [];
  err.campos = campos; err.tecnico = String(e.message || '');
  err.espera = segundosDeEspera(r.headers || {});
  return err;
}
/* Minutos que Meta pide esperar (estimated_time_to_regain_access), en segundos. */
function segundosDeEspera(h){
  let min = 0;
  ['x-business-use-case-usage', 'x-ad-account-usage'].forEach(k => {
    try {
      const v = h[k]; if (!v) return;
      const o = JSON.parse(v);
      const vals = Array.isArray(o) ? o : [].concat.apply([], Object.values(o).map(x => [].concat(x)));
      vals.concat([o]).forEach(x => { const m = Number((x || {}).estimated_time_to_regain_access || 0); if (m > min) min = m; });
    } catch (e) {}
  });
  return min * 60;
}
/* Errores de Meta en lenguaje de negocio. Si el código no está en la tabla,
   se usa error_user_msg de Meta (ya viene en el idioma de la cuenta). */
const TRADUCCIONES = {
  '100:1815857': 'La campaña usa una estrategia de puja con tope y el conjunto no trae importe. Cámbiala a costo más bajo o crea una campaña nueva.',
  '100:1885501': 'La ventana de atribución no aplica a esta optimización.',
  '100:2490408': 'Meta no acepta esa optimización con el objetivo de la campaña. Con WhatsApp: Ventas admite conversiones (con conjunto de datos) y conversaciones; Interacción, conversaciones y clics; Clientes potenciales, solo conversaciones.',
  '100:4834011': 'Meta exige indicar si los conjuntos comparten presupuesto cuando el presupuesto va en cada conjunto (obligatorio desde v26 y en todas las versiones desde el 27-oct-2026). El motor ya lo envía: si ves este error, el workflow activo en n8n es anterior a 5.3.',
  '100:1487246': 'Ese número de WhatsApp no está vinculado a la cuenta publicitaria o a la página. Vincúlalo en la configuración de la página (WhatsApp) o elige otro número.',
  '100:2446886': 'La página no tiene una cuenta de WhatsApp vinculada. Vincula el número de WhatsApp Business en la configuración de la página y vuelve a enviar.',
  '100:1885183': 'La app de Meta con la que trabaja el motor está en modo desarrollo: Meta no deja publicar anuncios creados con ella. Pásala a modo activo (Live) en developers.facebook.com.',
  '613:1487742': 'Demasiadas llamadas a esta cuenta en poco tiempo. Espera unos minutos antes de volver a intentar.',
  '17:2446079':  'Meta limitó temporalmente las solicitudes del usuario. Espera unos minutos.',
  '4:1504022':   'Meta limitó temporalmente la aplicación. Espera unos minutos.',
  '4:1504039':   'Meta limitó temporalmente la aplicación. Espera unos minutos.',
  '80004:':      'Se alcanzó el límite de uso de anuncios de la cuenta. Espera unos minutos.',
  '80000:':      'Se alcanzó el límite de uso de la cuenta en Meta. Espera unos minutos.',
  '1:':          'Meta tuvo un error interno temporal. Vuelve a intentar en unos minutos; si se repite, revisa el objeto en Ads Manager.',
  '2:':          'El servicio de Meta no respondió en ese momento. Vuelve a intentar en unos minutos.',
  '190:':        'El token de Meta venció o fue revocado. Actualiza META_ACCESS_TOKEN en n8n.',
  '200:':        'El token no tiene permiso sobre este activo. Revisa en Business Manager que el system user tenga acceso.',
  '10:':         'El token no tiene el permiso necesario para esta acción.',
  '368:':        'La cuenta o la página tienen una restricción activa de Meta.',
  '2635:':       'La versión de la API está vencida. Actualiza META_API_VERSION en n8n (recomendado: v25.0 o posterior).',
};
function explicar(e){
  if (!e) return 'Error desconocido.';
  let t = TRADUCCIONES[e.code + ':' + (e.subcode || '')] || TRADUCCIONES[e.code + ':'];
  /* Formularios: la página debe aceptar las condiciones de anuncios para clientes potenciales. */
  if (!t && /terms of service|leadgen.*tos|condiciones.*(clientes potenciales|anuncios para)/i.test(String(e.message || '') + ' ' + String(e.tecnico || '')))
    t = 'La página no ha aceptado las condiciones de los anuncios para clientes potenciales. Un administrador de la página debe aceptarlas en https://www.facebook.com/ads/leadgen/tos y volver a enviar.';
  /* Errores genéricos (1, 2): si Meta dio un mensaje propio más útil, se conserva. */
  if (t && [1, 2].indexOf(Number(e.code)) >= 0 && e.message && !/unknown error|unexpected error|service temporarily/i.test(e.message)) t = null;
  return (t || e.message || 'Error desconocido.')
    + (e.campos && e.campos.length ? ' · Campo señalado por Meta: ' + e.campos.join(', ') : '')
    + (e.titulo && t ? ' · Meta: ' + e.titulo : '')
    + (e.code ? ' [' + e.code + (e.subcode ? '/' + e.subcode : '') + (e.fbtrace ? ' · traza ' + e.fbtrace : '') + ']' : '');
}
/* Lectura de varios objetos por la API de lotes (POST / con batch), hasta 50 por
   llamada. Reemplaza a GET /?ids=, que Meta eliminó en v26.0 y en todas las
   versiones desde el 27 de octubre de 2026. Los objetos que Meta no devuelve
   (borrados o sin acceso) simplemente no aparecen en el resultado. */
async function porIds(ids, campos){
  const out = {}, lista_ = [...new Set((ids || []).map(String).filter(Boolean))];
  for (let i = 0; i < lista_.length; i += 50) {
    const bloque = lista_.slice(i, i + 50);
    const r = await gPost('', { include_headers: 'false',
      batch: bloque.map(id => ({ method: 'GET', relative_url: id + '?fields=' + encodeURIComponent(campos) })) });
    (Array.isArray(r) ? r : []).forEach((x, j) => {
      if (x && Number(x.code) === 200) { try { out[bloque[j]] = JSON.parse(x.body); } catch (e) {} }
    });
  }
  return out;
}
/* Ritmo: Meta informa el uso en tres cabeceras (aplicación, cuenta publicitaria y
   caso de uso de negocio). Al pasar de 75 % se frena; a partir de 90 % se frena más.
   Si Meta ya indica tiempo de espera, se respeta hasta 30 s: n8n corta el nodo a los
   300 s y cada tramo trabaja 150 s, así que las esperas deben caber en el margen. */
async function frenar(r){
  try {
    const h = r.headers || {};
    const vals = [];
    const leer = (k) => { const v = h[k]; if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } };
    const buc = leer('x-business-use-case-usage');
    if (buc) [].concat.apply([], Object.values(buc)).forEach(x => vals.push(x.call_count || 0, x.total_cputime || 0, x.total_time || 0));
    const app = leer('x-app-usage');
    if (app) vals.push(app.call_count || 0, app.total_cputime || 0, app.total_time || 0);
    const acc = leer('x-ad-account-usage');
    if (acc) vals.push(Number(acc.acc_id_util_pct) || 0);
    if (!vals.length) return;
    const pico = Math.max.apply(null, vals);
    const espera = segundosDeEspera(h);
    if (espera > 0) await pausa(Math.min(espera, 30) * 1000);
    else if (pico >= 90) await pausa(30000);
    else if (pico >= 75) await pausa(15000);
  } catch (e) {}
}
/* Tope de espera acumulada por solicitud (reintentos): 45 s. */
const ESPERA_MAX_MS = 45000;
async function pedir(opts, intento, esperado){
  intento = intento || 0; esperado = esperado || 0;
  /* _token: token de página para los endpoints de formularios; por defecto, el del system user. */
  const o = Object.assign({}, opts); const tk = o._token || token; delete o._token;
  const lectura = String(o.method || 'GET').toUpperCase() === 'GET';
  const headers = Object.assign({ Authorization: 'Bearer ' + tk }, o.headers || {}); delete o.headers;
  let r;
  try {
    r = await http(Object.assign({ json: true, returnFullResponse: true, ignoreHttpStatusErrors: true }, o, { headers }));
    /* Con cuerpo de formulario la respuesta puede llegar como texto o Buffer: se convierte a objeto. */
    if (r && r.body && typeof r.body !== 'object') { try { r.body = JSON.parse(String(r.body)); } catch (x) {} }
    else if (r && r.body && typeof Buffer !== 'undefined' && Buffer.isBuffer(r.body)) { try { r.body = JSON.parse(r.body.toString('utf8')); } catch (x) {} }
  } catch (e) {
    /* Red caída o tiempo agotado: se reintenta solo una lectura. */
    if (lectura && intento < 3) { await pausa(2000 * (intento + 1)); return pedir(opts, intento + 1, esperado + 2000 * (intento + 1)); }
    const err = new Error('No hubo respuesta de Meta (' + String(e.message || e).slice(0, 120) + '). Si fue una creación, revisa en Ads Manager antes de reenviar: el lote evita duplicados.');
    err.transitorio = true; throw err;
  }
  if (r.statusCode >= 400) {
    const err = fallo(r);
    const limite = REINTENTABLES.indexOf(Number(err.code)) >= 0;
    /* Backoff exponencial con azar; si Meta dice cuánto esperar y cabe en el margen, se respeta. */
    const ms = err.espera > 0 ? err.espera * 1000 : Math.pow(2, intento) * 2000 + Math.random() * 1000;
    if ((limite || (lectura && err.transitorio)) && intento < 4 && esperado + ms <= ESPERA_MAX_MS) {
      await pausa(ms);
      return pedir(opts, intento + 1, esperado + ms);
    }
    if (limite && err.espera > 0) err.message = err.message + ' (Meta pide esperar unos ' + Math.ceil(err.espera / 60) + ' min)';
    throw err;
  }
  await frenar(r);
  return r.body;
}
const gGet = (url, tk) => pedir({ method: 'GET', url, timeout: 30000, _token: tk });
/* POST como formulario (application/x-www-form-urlencoded), igual que la documentación de Meta
   (curl -F) y sus SDK oficiales: cada valor viaja como texto y los objetos o listas como JSON.
   Hasta 5.3 se enviaba un cuerpo JSON con las listas convertidas en texto; Meta lo tolera en la
   mayoría de los campos, pero no en adbatch (lotes asíncronos): "(#194) param adbatch has too few
   elements" (caso real 25-sep-2026). */
function formulario(payload){
  const partes = [];
  Object.keys(payload).forEach(k => {
    const v = payload[k];
    if (v === null || v === undefined || v === '') return;
    /* Los arreglos vacíos SÍ se envían: Meta exige special_ad_categories
       incluso cuando va en [], y omitirlo devuelve el error 100. */
    partes.push(encodeURIComponent(k) + '=' + encodeURIComponent((typeof v === 'object') ? JSON.stringify(v) : String(v)));
  });
  return partes.join('&');
}
async function gPost(ruta, payload, tk){
  return pedir({ method: 'POST', url: base + ruta, body: formulario(payload), json: false,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 90000, _token: tk });
}
/* Token de la página (formularios instantáneos): Meta exige token de página para
   leer y crear leadgen_forms. Se obtiene con el token del system user, que debe
   tener la página asignada. Se recuerda durante la ejecución. */
const _tokensPagina = {};
async function tokenPagina(pageId){
  const id = String(pageId || '');
  if (!id) throw new Error('Falta la página.');
  if (_tokensPagina[id]) return _tokensPagina[id];
  let tk = '';
  try { const r = await gGet(base + id + '?fields=access_token'); tk = String(r.access_token || ''); } catch (e) {}
  if (!tk) {
    try {
      const l = await gGet(base + 'me/accounts?fields=id,access_token&limit=200');
      const x = (l.data || []).find(p => String(p.id) === id); if (x) tk = String(x.access_token || '');
    } catch (e) {}
  }
  if (!tk) throw new Error('No pude obtener el token de la página ' + id + '. El system user necesita la página asignada '
    + 'con permiso de anuncios y el token debe incluir pages_manage_ads, pages_read_engagement y leads_retrieval.');
  return (_tokensPagina[id] = tk);
}

/* Objetivos que admiten cada optimización con destino WhatsApp, según la documentación de Click to
   WhatsApp (sept-2026). Compras por mensajes no aparece en la tabla: la evidencia de Ads Manager
   indica Ventas o Interacción. */
const OBJETIVOS_WA = {
  OFFSITE_CONVERSIONS: ['OUTCOME_SALES'],
  MESSAGING_PURCHASE_CONVERSION: ['OUTCOME_SALES', 'OUTCOME_ENGAGEMENT'],
  CONVERSATIONS: ['OUTCOME_ENGAGEMENT', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_LEADS'],
  LINK_CLICKS: ['OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_SALES'],
  IMPRESSIONS: ['OUTCOME_SALES', 'OUTCOME_TRAFFIC'], REACH: ['OUTCOME_SALES', 'OUTCOME_TRAFFIC'],
  LANDING_PAGE_VIEWS: ['OUTCOME_TRAFFIC'], POST_ENGAGEMENT: ['OUTCOME_TRAFFIC'],
};
const NOMBRE_META_WA = { OFFSITE_CONVERSIONS: 'conversiones con el conjunto de datos', MESSAGING_PURCHASE_CONVERSION: 'compras por mensajes', CONVERSATIONS: 'conversaciones', LINK_CLICKS: 'clics', LANDING_PAGE_VIEWS: 'vistas de página', IMPRESSIONS: 'impresiones', REACH: 'alcance', POST_ENGAGEMENT: 'interacción' };
const NOMBRE_OBJETIVO = { OUTCOME_SALES: 'Ventas', OUTCOME_ENGAGEMENT: 'Interacción', OUTCOME_TRAFFIC: 'Tráfico', OUTCOME_LEADS: 'Clientes potenciales', OUTCOME_AWARENESS: 'Reconocimiento' };
/* Mensaje tal cual lo da Meta (sin la traducción genérica). */
function textoMeta(e){
  if (!e) return 'Error desconocido.';
  const t_ = [e.titulo, e.message].filter(Boolean).join(': ');
  return (t_ || 'Error desconocido.') + (e.campos && e.campos.length ? ' · campo: ' + e.campos.join(', ') : '')
    + (e.code ? ' [' + e.code + (e.subcode ? '/' + e.subcode : '') + ']' : '');
}
/* ===================== WhatsApp: verificación de la configuración con Meta (5.5) =====================
   En lugar de copiar un conjunto de referencia (Meta rechaza copiar o recrear optimizaciones que ya no
   admite: 2490408), se arman las configuraciones candidatas para lo que se quiere optimizar y se prueban
   con Meta en modo validate_only, que no crea nada. Se usa la primera que Meta acepte.
   Candidatas para COMPRAS, en orden:
     1. la configuración exacta de la referencia (objetivo, optimización, objeto promovido y atribución);
     2. Ventas + Conversiones con el conjunto de datos de WhatsApp (CAPI) y evento Compra (lo que documenta
        Meta para Click to WhatsApp);
     3. Interacción + Compras por mensajes (como lo creaba Ads Manager);
     4. Ventas + Compras por mensajes.
   Las pruebas se hacen dentro de una campaña de la cuenta que ya tenga ese objetivo (no se modifica). */
function variantesNumero(n){
  const s = String(n || '').trim(); if (!s) return [''];
  const dg = s.replace(/[^0-9]/g, ''), out = [];
  const add = v => { if (v && out.indexOf(v) < 0) out.push(v); };
  add('+' + dg); add(dg);
  if (/^521\d{10}$/.test(dg)) { add('+52' + dg.slice(3)); add('52' + dg.slice(3)); }
  else if (/^52\d{10}$/.test(dg)) { add('+521' + dg.slice(2)); add('521' + dg.slice(2)); }
  add(s);
  return out;
}
const esDeNumero = e => /whats ?app|phone|n[uú]mero|1487246/i.test(String(e.message || '') + ' ' + String(e.titulo || '') + ' ' + (e.subcode || ''))
  && !/objetivo de rendimiento|performance goal|2490408/i.test(String(e.message || '') + ' ' + (e.subcode || ''));
function intencionWA(meta){
  meta = String(meta || '').toUpperCase();
  if (meta === 'MESSAGING_PURCHASE_CONVERSION' || meta === 'OFFSITE_CONVERSIONS' || meta === 'VALUE') return 'COMPRAS';
  if (meta === 'CONVERSATIONS') return 'CONVERSACIONES';
  return meta || 'CONVERSACIONES';
}
function candidatosWA(o){
  const out = [], vistos = {};
  const add = (objetivo, goal, po, extra, etiqueta) => {
    const k = objetivo + '|' + goal + '|' + JSON.stringify(po); if (vistos[k]) return; vistos[k] = 1;
    out.push(Object.assign({ objetivo, optimization_goal: goal, promoted_object: po, etiqueta }, extra || {}));
  };
  const pg = { page_id: String(o.pageId) };
  const cfg = o.cfg || null, intencion = intencionWA(o.meta || (cfg && cfg.optimization_goal));
  const objetivoPlan = String(o.objetivo || '').toUpperCase();
  const ds = String(o.dataset || ((cfg && cfg.promoted_object) || {}).pixel_id || '');
  if (cfg && cfg.optimization_goal) {
    const po = Object.assign({}, cfg.promoted_object || {}, pg);
    delete po.whatsapp_phone_number;
    add(String(o.objetivoRef || objetivoPlan || '').toUpperCase(), String(cfg.optimization_goal).toUpperCase(), po,
      { attribution_spec: cfg.attribution_spec || null, optimization_sub_event: cfg.optimization_sub_event || null, billing_event: cfg.billing_event || null, bid_strategy: cfg.bid_strategy || null },
      'igual a la referencia');
  }
  if (intencion === 'COMPRAS') {
    const ev = String(o.evento || 'PURCHASE').toUpperCase();
    const conDs = x => Object.assign({}, pg, x || {}, { pixel_id: ds, custom_event_type: ev });
    /* Interacción primero: es como se crean en Ads Manager las campañas de compras por WhatsApp de la cuenta. */
    add('OUTCOME_ENGAGEMENT', 'MESSAGING_PURCHASE_CONVERSION', Object.assign({}, pg), null, 'Interacción · compras por mensajes');
    if (ds) add('OUTCOME_ENGAGEMENT', 'MESSAGING_PURCHASE_CONVERSION', conDs(), null, 'Interacción · compras por mensajes con el conjunto de datos ' + ds);
    if (ds) add('OUTCOME_ENGAGEMENT', 'OFFSITE_CONVERSIONS', conDs(), null, 'Interacción · conversiones con el conjunto de datos ' + ds + ' (' + ev + ')');
    if (ds) add('OUTCOME_SALES', 'OFFSITE_CONVERSIONS', conDs(), null, 'Ventas · conversiones con el conjunto de datos ' + ds + ' (' + ev + ')');
    add('OUTCOME_SALES', 'MESSAGING_PURCHASE_CONVERSION', Object.assign({}, pg), null, 'Ventas · compras por mensajes');
  } else {
    const goal = intencion === 'CONVERSACIONES' ? 'CONVERSATIONS' : intencion;
    const objs = [objetivoPlan].concat(OBJETIVOS_WA[goal] || []).filter(Boolean);
    [...new Set(objs)].filter(x => !OBJETIVOS_WA[goal] || OBJETIVOS_WA[goal].indexOf(x) >= 0 || x === objetivoPlan)
      .forEach(obj => add(obj, goal, Object.assign({}, pg), null, (NOMBRE_OBJETIVO[obj] || obj) + ' · ' + (NOMBRE_META_WA[goal] || goal)));
  }
  /* Si el objetivo está fijo (conjunto nuevo en una campaña existente), solo sirven los de ese objetivo. */
  return o.objetivoFijo ? out.filter(x => x.objetivo === String(o.objetivoFijo).toUpperCase()) : out;
}
/* Campañas de la cuenta que sirven para probar (validate_only no las modifica). */
async function campanasParaValidar(acc, cache){
  if (cache.__lista) return cache.__lista;
  const filtro = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'] }]));
  let lista_ = [];
  try { lista_ = (await gGet(base + acc + '/campaigns?fields=id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories&limit=200&filtering=' + filtro)).data || []; } catch (e) {}
  /* Primero las campañas con presupuesto por conjunto: en una campaña con presupuesto de campaña y costo más bajo
     Meta exige que todos los conjuntos optimicen igual (1885760) y la prueba no sería concluyente. */
  const utiles = lista_.filter(c => !(c.special_ad_categories || []).filter(x => x && x !== 'NONE').length
    && (!c.bid_strategy || c.bid_strategy === 'LOWEST_COST_WITHOUT_CAP'));
  const abo = c => !(Number(c.daily_budget) || Number(c.lifetime_budget));
  return (cache.__lista = utiles.filter(abo).concat(utiles.filter(c => !abo(c))));
}
/* Errores que dicen algo de la campaña donde se probó, no de la configuración: se prueba en otra. */
const NO_CONCLUYENTE = e => [1885760, 1885621, 1815857].indexOf(Number(e && e.subcode)) >= 0 || /misma opción de optimización|same optimization/i.test(String((e && e.message) || ''));
/* Prueba las candidatas. o: { acc, pageId, meta, objetivo, objetivoRef, objetivoFijo, campanaFija, cfg, numero, dataset,
   targeting, moneda, minimo, cache, crearCampana(objetivo) opcional }. Devuelve { ok, elegido, intentos, sinPrueba }. */
async function resolverWA(o){
  const cache = o.cache || {};
  const cands = candidatosWA(o);
  const intentos = [], sinPrueba = [];
  const lista_ = o.campanaFija ? [] : await campanasParaValidar(o.acc, cache);
  /* Lugares donde probar cada objetivo, en orden: la campaña de la referencia (misma configuración de campaña),
     campañas de la cuenta con ese objetivo (primero con presupuesto por conjunto) y, si se permite, una temporal. */
  const lugaresPara = async (obj) => {
    if (o.campanaFija) return [o.campanaFija];
    const out = [];
    if (o.campanaRef && String(o.campanaRef.objetivo || '').toUpperCase() === obj) out.push(o.campanaRef);
    lista_.filter(c => String(c.objective).toUpperCase() === obj && (!o.campanaRef || String(c.id) !== String(o.campanaRef.id))).slice(0, 2)
      .forEach(x => out.push({ id: String(x.id), cbo: !!(Number(x.daily_budget) || Number(x.lifetime_budget)) }));
    if (o.crearCampana) out.push({ temporal: obj });
    return out;
  };
  const materializar = async (l) => {
    if (!l.temporal) return l;
    cache.__temporales = cache.__temporales || {};
    if (!cache.__temporales[l.temporal]) cache.__temporales[l.temporal] = await o.crearCampana(l.temporal);
    return cache.__temporales[l.temporal];
  };
  const numRef = ((o.cfg || {}).promoted_object || {}).whatsapp_phone_number || '';
  const numeros = (o.numero || numRef) ? variantesNumero(o.numero || numRef).slice(0, 4) : [''];
  const clave = JSON.stringify([o.acc, o.pageId, o.meta, o.objetivoFijo || '', o.dataset || '', o.numero || '', (o.cfg || {}).optimization_goal || '', JSON.stringify((o.cfg || {}).promoted_object || {})]);
  cache.__resueltos = cache.__resueltos || {};
  if (cache.__resueltos[clave]) return cache.__resueltos[clave];
  for (const cand of cands) {
    if (o.objetivoFijo && cand.objetivo !== String(o.objetivoFijo).toUpperCase()) continue;
    let lugares = [];
    try { lugares = await lugaresPara(cand.objetivo); } catch (e) {}
    if (!lugares.length) { sinPrueba.push(cand.objetivo); intentos.push({ etiqueta: cand.etiqueta, error: 'no hay en la cuenta una campaña de ' + (NOMBRE_OBJETIVO[cand.objetivo] || cand.objetivo) + ' donde probarla sin crear nada' }); continue; }
    let ultimo = null, aceptado = null, dondeOk = null, concluyente = false;
    for (const lugar of lugares) {
      let camp;
      try { camp = await materializar(lugar); } catch (e) { ultimo = e; continue; }
      ultimo = null;
    for (const n of numeros) {
      const po = Object.assign({}, cand.promoted_object); if (n) po.whatsapp_phone_number = n;
      const p = { name: 'mbe_validacion', campaign_id: camp.id, optimization_goal: cand.optimization_goal, billing_event: String(cand.billing_event || 'IMPRESSIONS').toUpperCase(),
        destination_type: 'WHATSAPP', promoted_object: po, status: 'PAUSED', execution_options: ['validate_only'],
        targeting: o.targeting || { geo_locations: { countries: ['MX'] }, age_min: 18, targeting_automation: { advantage_audience: 0 } } };
      if (!camp.cbo) p.daily_budget = aMenor(Math.max(Number(o.minimo) || 0, 50), o.moneda);
      if (cand.attribution_spec) p.attribution_spec = cand.attribution_spec.map(x => Object.assign({}, x, String(x.event_type).toUpperCase() === 'VIEW_THROUGH' && Number(x.window_days) > 1 ? { window_days: 1 } : {}));
      if (cand.optimization_sub_event && cand.optimization_sub_event !== 'NONE') p.optimization_sub_event = cand.optimization_sub_event;
      if (cand.bid_strategy && cand.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP') p.bid_strategy = cand.bid_strategy;
      try { await gPost(o.acc + '/adsets', p); aceptado = po; dondeOk = camp.id; break; }
      catch (e) { ultimo = e; if (!n || !esDeNumero(e) || Number(e.subcode) === 2446886) break; }
    }
      if (aceptado) break;
      if (ultimo && !NO_CONCLUYENTE(ultimo)) { concluyente = true; break; }   /* rechazo real: no hace falta otra campaña */
    }
    if (!aceptado && ultimo && NO_CONCLUYENTE(ultimo) && !concluyente) { sinPrueba.push(cand.objetivo);
      intentos.push({ etiqueta: cand.etiqueta, error: 'no se pudo probar en las campañas de la cuenta (' + textoMeta(ultimo) + ')' }); continue; }
    if (aceptado) {
      const r = { ok: true, elegido: Object.assign({}, cand, { promoted_object: aceptado }), intentos, sinPrueba };
      return (cache.__resueltos[clave] = r);
    }
    intentos.push({ etiqueta: cand.etiqueta, error: !ultimo ? 'rechazada' : ([2446886, 1487246].indexOf(Number(ultimo.subcode)) >= 0 ? explicar(ultimo) : textoMeta(ultimo)) });
    /* Página sin WhatsApp vinculado: ninguna otra configuración puede funcionar. */
    if (ultimo && Number(ultimo.subcode) === 2446886) {
      const r = { ok: false, elegido: null, intentos, sinPrueba: [], paginaSinWA: true };
      return (cache.__resueltos[clave] = r);
    }
  }
  const r = { ok: false, elegido: null, intentos, sinPrueba };
  /* Compras sin conjunto de datos: la opción documentada por Meta no se pudo probar. */
  if (intencionWA(o.meta || (o.cfg && o.cfg.optimization_goal)) === 'COMPRAS' && !String(o.dataset || ((o.cfg || {}).promoted_object || {}).pixel_id || ''))
    r.faltaDataset = true;
  return (cache.__resueltos[clave] = r);
}
function textoIntentosWA(intentos){ return intentos.map((x, i) => (i + 1) + ') ' + x.etiqueta + ': ' + x.error).join(' · '); }
/* Compras por universo de medición (5.3), sin mezclar fuentes:
   - Campañas con "CAPI WhatsApp" en el nombre → compras en el chat (onsite_conversion.purchase,
     "On-Facebook Purchase").
   - Las demás → compras offline (offline_conversion.purchase, "Compras offline") y, si la cuenta
     no las registra, compras del sitio web (píxel).
   Nunca se suman ni se toma el mayor entre universos. */
function valorAccion(acts, tipo){ const x = (acts || []).find(a => a.action_type === tipo); return x ? Number(x.value) || 0 : 0; }
function comprasPorUniverso(acts, nombreCampana){
  if (/capi\s*whats\s*app/i.test(String(nombreCampana || ''))) return { compras: valorAccion(acts, 'onsite_conversion.purchase'), universo: 'chat' };
  const off = valorAccion(acts, 'offline_conversion.purchase');
  if (off) return { compras: off, universo: 'offline' };
  const web = valorAccion(acts, 'offsite_conversion.fb_pixel_purchase') || valorAccion(acts, 'purchase');
  return { compras: web, universo: web ? 'web' : '' };
}
function slug(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40) || 'cuenta';
}
function lista(v){
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v||'').split(',').map(s=>s.trim()).filter(Boolean);
}
/* Paginación completa: hasta 20 páginas de 100 (2.000 cuentas). */
async function todasLasCuentas(campos){
  let url = base + 'me/adaccounts?limit=100&fields=' + campos;
  const out = [];
  for (let i = 0; i < 20 && url; i++){
    const r = await gGet(url);
    (r.data || []).forEach(x => out.push(x));
    url = (r.paging && r.paging.next) ? r.paging.next : null;
  }
  return out;
}
/* Las llaves se asignan SIEMPRE en el mismo orden (account_id), así que no
   cambian entre llamadas ni entre nodos. */
function asignarLlaves(crudas){
  const activas = (crudas || [])
    .filter(a => Number(a.account_status) === 1)
    .sort((p,q) => String(p.account_id).localeCompare(String(q.account_id)));
  const vistos = {};
  activas.forEach(a => {
    let k = slug(a.name);
    if (vistos[k]) k = k + '_' + String(a.account_id).slice(-4);
    vistos[k] = true;
    a.__key = k;
  });
  return activas;
}
/* Identificador estable: account_id. El slug queda solo como respaldo. */
function resolverCuenta(crudas, cuentaId, clientKey){
  const activas = asignarLlaves(crudas);
  if (cuentaId) {
    const id = String(cuentaId).replace(/^act_/, '');
    const x = activas.filter(a => String(a.account_id) === id)[0];
    if (x) return x;
  }
  return activas.filter(a => a.__key === clientKey)[0] || null;
}
/* Offset de moneda en UN solo lugar. Verificar cada moneda nueva contra
   la referencia de Ad Account Currency antes de operar con ella. */
const OFFSET_1 = ['JPY','KRW','CLP','VND','COP','ISK','HUF','TWD','PYG','UGX',
                  'RWF','XAF','XOF','XPF','BIF','DJF','GNF','KMF','MGA','VUV'];
function offsetMoneda(m){ return OFFSET_1.indexOf(String(m||'').toUpperCase()) >= 0 ? 1 : 100; }
function aMenor(v, moneda){ const n = Number(v); if (!n) return null; return Math.round(n * offsetMoneda(moneda)); }
function aMayor(v, moneda){ return Number(v || 0) / offsetMoneda(moneda); }

/* Fecha en la zona horaria de la cuenta, no en la del contenedor (D1-05). */
function offsetDeZona(tz, fecha){
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(fecha).filter(x => x.type === 'timeZoneName')[0].value;
    const off = String(p).replace('GMT', '');
    return off || '+00:00';
  } catch (e) { return '+00:00'; }
}
function isoEnZona(v, tz){
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d0 = new Date(s);
    return isNaN(d0.getTime()) ? null : d0.toISOString();
  }
  const provisional = new Date(s + 'Z');
  if (isNaN(provisional.getTime())) return null;
  const d = new Date(s + offsetDeZona(tz || 'UTC', provisional));
  return isNaN(d.getTime()) ? null : d.toISOString();
}
