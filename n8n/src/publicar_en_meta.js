/* ---- motor 5.5 · publicación por tramos ----------------------------------
   n8n detiene cualquier Code node a los 300 s (task runner). Por eso la
   publicación avanza en TRAMOS: cada ejecución de este nodo trabaja como
   máximo MBE_TRAMO_SEGUNDOS (150 por defecto), guarda su estado en la salida y
   el workflow vuelve a llamarlo (¿Terminó? → Fila de progreso → Progreso en
   runs → este nodo) hasta terminar. Cada tramo deja el avance en la hoja.

   Fases: inicio → creativos → videos → campañas → conjuntos → ajustes →
          anuncios → limpieza → fin
   Un creativo que falla ya no tumba la corrida: solo fallan los anuncios que
   lo usan. El mismo anuncio en varios conjuntos reutiliza un solo creativo. */
const T0 = Date.now();
const PRESUPUESTO_MS = Math.max(60, Math.min(220, Number($vars.MBE_TRAMO_SEGUNDOS || 150))) * 1000;
const MAX_TRAMOS = 60;
const queda = () => (Date.now() - T0) < PRESUPUESTO_MS;

const b   = $('Recibir').first().json.body || {};
const val = $('Validar plan').first().json;
const act = val.act, moneda = val.moneda, tz = val.tz || 'UTC';
const pageId = val.page_id;
const campExistente = val.campaign_id;

/* ---------- estado: nuevo en el primer tramo, heredado en los siguientes ---------- */
let E;
if ($runIndex === 0) {
  E = {
    __mbe: 1, run_id: val.run_id, fase: 'inicio', i: 0, tramo: 0, fin: false,
    f: JSON.parse(JSON.stringify(b.filas || {})),
    subidos: {}, fallidosAsset: {}, videos: [], videoDesde: 0,
    igId: '', sinIG: false, etiqueta: null, loteNuevo: false,
    idCamp: {}, nivelPresupuesto: {}, campanasNuevas: {}, conjuntosNuevos: {},
    campanasFallidas: {}, conjuntosFallidos: {}, repartoClon: {}, ajustesPendientes: [],
    idAdset: {}, adsPorConjunto: {}, creativos: {}, wa: JSON.parse(JSON.stringify(val.wa_resuelto || {})),
    bitacora: [], fallos: [], avisos: [],
    reutilizados: 0, omitidos: 0, nCamp: 0, nAdset: 0, nAds: 0,
    progreso: 'Preparando…',
  };
} else {
  let prev = null;
  try { prev = $('Publicar en Meta').first(0, $runIndex - 1); } catch (e) { prev = null; }
  if (!prev || !prev.json || !prev.json.__mbe) throw new Error('No pude recuperar el estado del tramo anterior (' + ($runIndex - 1) + ').');
  E = JSON.parse(JSON.stringify(prev.json));
}
E.tramo++;
const f = E.f;
const total = (f.ads || []).length;

function pausaTramo(){
  E.progreso = 'Tramo ' + E.tramo + ' · ' + nombreFase(E.fase) + ' · ' + E.nAds + ' de ' + total + ' anuncios creados';
  if (E.tramo >= MAX_TRAMOS) {
    E.fallos.push('La corrida superó ' + MAX_TRAMOS + ' tramos y se detuvo en la fase "' + nombreFase(E.fase) + '". Lo creado lleva la etiqueta del lote: reenvía el plan para continuar sin duplicar.');
    E.fin = true;
  }
  return [{ json: E }];
}
function nombreFase(x){
  return ({ inicio:'preparación', creativos:'subida de creativos', videos:'procesamiento de videos', campanas:'campañas',
    conjuntos:'conjuntos', ajustes:'ajustes de copias', anuncios:'anuncios', limpieza:'limpieza' })[x] || x;
}

const menor = (v) => aMenor(v, moneda);
const iso   = (v) => isoEnZona(v, tz);
/* Una fecha de inicio ya pasada (por ejemplo, hoy a las 06:00 publicado a las 10:00)
   se omite: Meta arranca en el momento de la creación. */
const isoInicio = (v) => { const x = iso(v); return (x && Date.parse(x) < Date.now() + 5 * 60000) ? null : x; };

/* Las ciudades vienen como "key" o "key:radio". */
function ciudad(tk){
  const p = String(tk).split(':');
  const o = { key: p[0] };
  const radio = Number(p[1]);
  if (radio > 0) { o.radius = radio; o.distance_unit = 'kilometer'; }
  return o;
}
/* Enlaces de Drive: servidor de descarga con confirmación (archivos grandes). */
function urlDescarga(u){
  const s = String(u);
  if (!/drive\.google\.com|drive\.usercontent\.google\.com/.test(s)) return s;
  const m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? 'https://drive.usercontent.google.com/download?id=' + m[1] + '&export=download&confirm=t' : s;
}
async function subirImagen(asset){
  let b64;
  if (asset.source_data) {
    b64 = String(asset.source_data).replace(/^data:[^,]*,/, '');
  } else {
    const r = await http({ method:'GET', url: urlDescarga(asset.source_url), encoding:'arraybuffer',
      timeout:90000, returnFullResponse:true, ignoreHttpStatusErrors:true });
    const ct = String((r.headers || {})['content-type'] || '');
    if (r.statusCode >= 400) throw new Error('No se pudo descargar el creativo (HTTP ' + r.statusCode + ').');
    if (/text\/html/.test(ct)) {
      throw new Error('El enlace del creativo devuelve una página, no un archivo. '
        + 'Revisa que sea "cualquiera con el enlace" y que no sea una carpeta.');
    }
    b64 = Buffer.from(r.body).toString('base64');
  }
  const res = await gPost(act + '/adimages', { bytes: b64 });
  const imgs = res.images || {};
  const k = Object.keys(imgs)[0];
  if (!k) throw new Error('Meta no devolvió image_hash.');
  return { hash: imgs[k].hash, url: imgs[k].url || '' };
}
async function subirVideo(url, nombre){
  const r = await gPost(act + '/advideos', { file_url: urlDescarga(url), name: nombre || 'video' });
  if (!r.id) throw new Error('Meta no devolvió video_id.');
  return String(r.id);
}

/* Segmentación desde una audiencia guardada: tal cual, completando plataformas
   y apagando Advantage+ audience si no viene definido. */
const cacheGuardadas = {};
async function segmentacionGuardada(id, a){
  if (!cacheGuardadas[id]) {
    const sa = await gGet(base + id + '?fields=targeting');
    if (!sa.targeting) throw new Error('La audiencia guardada ' + id + ' no trae segmentación.');
    cacheGuardadas[id] = sa.targeting;
  }
  const t = JSON.parse(JSON.stringify(cacheGuardadas[id]));
  if (!t.publisher_platforms && lista(a.publisher_platforms).length) t.publisher_platforms = lista(a.publisher_platforms);
  if (!t.targeting_automation) t.targeting_automation = { advantage_audience: 0 };
  return t;
}
function segmentacionCopiada(a){
  const t = JSON.parse(a.targeting_json);
  if (!t.targeting_automation) t.targeting_automation = { advantage_audience: 0 };
  return t;
}
function segmentacion(a){
  const t = {}, geo = {};
  if (lista(a.countries).length)   geo.countries = lista(a.countries);
  if (lista(a.region_keys).length) geo.regions   = lista(a.region_keys).map(k=>({key:k}));
  if (lista(a.city_keys).length)   geo.cities    = lista(a.city_keys).map(ciudad);
  if (lista(a.zips).length)        geo.zips      = lista(a.zips).map(k=>({key:k}));
  geo.location_types = lista(a.location_types).length ? lista(a.location_types) : ['home','recent'];
  t.geo_locations = geo;
  if (lista(a.excluded_geo_keys).length) t.excluded_geo_locations = { cities: lista(a.excluded_geo_keys).map(ciudad) };
  if (Number(a.age_min)) t.age_min = Number(a.age_min);
  if (Number(a.age_max)) t.age_max = Number(a.age_max);
  const g = String(a.genders||'ALL').toUpperCase();
  if (g === 'MALE')   t.genders = [1];
  if (g === 'FEMALE') t.genders = [2];
  if (lista(a.locales).length) t.locales = lista(a.locales).map(Number);
  if (lista(a.interest_ids).length)     t.interests    = lista(a.interest_ids).map(id=>({id}));
  if (lista(a.behavior_ids).length)     t.behaviors    = lista(a.behavior_ids).map(id=>({id}));
  if (lista(a.demographic_ids).length)  t.demographics = lista(a.demographic_ids).map(id=>({id}));
  if (lista(a.custom_audience_ids).length)   t.custom_audiences = lista(a.custom_audience_ids).map(id=>({id}));
  if (lista(a.excluded_audience_ids).length) t.excluded_custom_audiences = lista(a.excluded_audience_ids).map(id=>({id}));
  if (lista(a.publisher_platforms).length)  t.publisher_platforms  = lista(a.publisher_platforms);
  if (lista(a.facebook_positions).length)   t.facebook_positions   = lista(a.facebook_positions);
  if (lista(a.instagram_positions).length)  t.instagram_positions  = lista(a.instagram_positions);
  if (lista(a.device_platforms).length)     t.device_platforms     = lista(a.device_platforms);
  const adv = String(a.advantage_audience).toUpperCase() === 'ON';
  t.targeting_automation = { advantage_audience: adv ? 1 : 0 };
  if (adv) {
    /* Advantage+ audience (documentación de Meta): la edad mínima solo puede ir de 18 a 25 y la
       máxima queda fija en 65; el rango elegido viaja como sugerencia en age_range. */
    const mn = Number(t.age_min || 18), mx = Number(t.age_max || 65);
    if (mn > 18 || mx < 65) t.age_range = [mn, mx];
    t.age_min = Math.min(mn, 25); delete t.age_max;
    if (mn > 25) E.avisos.push('Conjunto "' + a.name + '": con Advantage+ audience la edad mínima obligatoria es de hasta 25 años; ' + mn + '–' + mx + ' se envió como sugerencia.');
  }
  return t;
}
async function segmentacionDe(a){
  let t = a.targeting_json ? segmentacionCopiada(a)
    : (a.saved_audience_id ? await segmentacionGuardada(a.saved_audience_id, a) : segmentacion(a));
  if (b.replica_de) t = await traducirPublicos(t, a);
  return sanearSegmentacion(t, a);
}
/* Ubicaciones que la API ya no acepta o que esta herramienta no puede servir (5.3):
   - WhatsApp (Estados) como ubicación exige una identidad de WhatsApp en cada anuncio
     (wamo_whatsapp_identity_spec, v26): se quita de segmentaciones copiadas o guardadas.
   - Las historias de Messenger ya no existen como ubicación (v26 las descarta).
   Una segmentación con Advantage+ audience copiada de otra cuenta se conserva tal cual. */
function sanearSegmentacion(t, a){
  if (!t || typeof t !== 'object') return t;
  const quitados = [];
  if (Array.isArray(t.publisher_platforms) && t.publisher_platforms.indexOf('whatsapp') >= 0) {
    t.publisher_platforms = t.publisher_platforms.filter(x => x !== 'whatsapp'); quitados.push('WhatsApp (Estados)');
    if (!t.publisher_platforms.length) delete t.publisher_platforms;
  }
  if (t.whatsapp_positions) { delete t.whatsapp_positions; if (quitados.indexOf('WhatsApp (Estados)') < 0) quitados.push('WhatsApp (Estados)'); }
  /* Explorar de Instagram ("Explore Feed") deja de existir en v26 y en todas las versiones desde el
     27-oct-2026: se quita antes de enviar. explore_home se quita solo si Meta la rechaza. */
  if (Array.isArray(t.instagram_positions) && t.instagram_positions.indexOf('explore') >= 0) {
    t.instagram_positions = t.instagram_positions.filter(x => x !== 'explore'); quitados.push('Explorar de Instagram');
    if (!t.instagram_positions.length) delete t.instagram_positions;
  }
  if (Array.isArray(t.messenger_positions) && t.messenger_positions.indexOf('story') >= 0) {
    t.messenger_positions = t.messenger_positions.filter(x => x !== 'story');
    if (!t.messenger_positions.length) delete t.messenger_positions;
  }
  if (quitados.length) E.avisos.push('Conjunto "' + a.name + '": se quitó ' + quitados.join(' y ') + ' de las ubicaciones copiadas'
    + (quitados.indexOf('WhatsApp (Estados)') >= 0 ? ' (los Estados de WhatsApp exigen una identidad de WhatsApp por anuncio que esta herramienta no configura)' : ' (Meta la retiró)') + '.');
  return t;
}
/* Quita posiciones de Instagram que Meta retiró o rechaza (Explorar, búsqueda) cuando
   Meta devuelve un error de ubicación. Devuelve true si cambió algo. */
function quitarPosicionesRetiradas(t){
  if (!t || !Array.isArray(t.instagram_positions)) return false;
  const antes = t.instagram_positions.length;
  t.instagram_positions = t.instagram_positions.filter(x => ['explore', 'explore_home', 'ig_search'].indexOf(x) < 0);
  if (!t.instagram_positions.length) delete t.instagram_positions;
  return (t.instagram_positions || []).length !== antes;
}
/* Ventanas de atribución de una configuración copiada: Meta retiró las de visualización
   de 7 y 28 días (12-ene-2026); se dejan en 1 día. */
function sanearAtribucion(spec){
  if (!Array.isArray(spec)) return spec;
  return spec.map(x => {
    const y = Object.assign({}, x);
    if (String(y.event_type || '').toUpperCase() === 'VIEW_THROUGH' && Number(y.window_days) > 1) y.window_days = 1;
    return y;
  });
}
/* Réplica en otra cuenta (5.2): los públicos personalizados son de cada cuenta. Se buscan
   por nombre en la cuenta de destino; los que no existen se quitan y queda el aviso. */
let _publicosDestino = null;
async function traducirPublicos(t, a){
  const nombres = {};
  [].concat(safeJSON(a.custom_audiences_json), safeJSON(a.excluded_audiences_json)).forEach(x => { if (x && x.id) nombres[String(x.id)] = x.name || x.n || ''; });
  const campos = ['custom_audiences', 'excluded_custom_audiences'];
  if (!campos.some(k => (t[k] || []).length)) return t;
  if (!_publicosDestino) {
    _publicosDestino = {};
    try { (await paginar(base + act + '/customaudiences?fields=id,name&limit=500', 5000)).forEach(x => { _publicosDestino[String(x.name || '').trim().toLowerCase()] = String(x.id); }); } catch (e) {}
  }
  campos.forEach(k => {
    if (!t[k]) return;
    t[k] = t[k].map(x => {
      const nombre = String(x.name || nombres[String(x.id)] || '').trim();
      const id = _publicosDestino[nombre.toLowerCase()];
      if (id) return { id };
      E.avisos.push('Conjunto "' + a.name + '": el público "' + (nombre || x.id) + '" no existe en esta cuenta y se quitó de la segmentación.');
      return null;
    }).filter(Boolean);
    if (!t[k].length) delete t[k];
  });
  return t;
}
function safeJSON(s){ try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

/* ---------- idempotencia por lote (etiqueta mbe_<lote>) ---------- */
const conEtiqueta = obj => (obj.adlabels || []).some(l => E.etiqueta && String(l.id) === E.etiqueta.id);
const etiquetar = payload => E.etiqueta ? Object.assign({}, payload, { adlabels: [{ id: E.etiqueta.id }] }) : payload;
async function crear(ruta, payload){
  try { return await gPost(ruta, etiquetar(payload)); }
  catch (e) {
    if (E.etiqueta && /adlabel|label|etiqueta/i.test(String(e.message))) {
      E.avisos.push('Meta rechazó la etiqueta de lote; se sigue sin protección contra duplicados.');
      E.etiqueta = null; return await gPost(ruta, payload);
    }
    throw e;
  }
}
async function actualizarClon(id, upd, que){
  let intento = Object.assign({}, upd);
  for (let i = 0; i < 3; i++) {
    try { return await gPost(id, etiquetar(intento)); }
    catch (e) {
      const msg = String(e.message || '');
      if (E.etiqueta && /adlabel|label/i.test(msg)) { E.etiqueta = null; continue; }
      if (intento.stop_time === '0' || intento.end_time === '0') {
        delete intento.stop_time; if (intento.end_time === '0') delete intento.end_time;
        E.avisos.push(que + ': quedó con la fecha de fin de la referencia; revísala en Ads Manager.');
        continue;
      }
      throw e;
    }
  }
}
async function paginar(url, tope){
  const out = []; let u = url;
  for (let i = 0; i < 20 && u && out.length < tope; i++){
    const r = await gGet(u); (r.data || []).forEach(x => out.push(x));
    u = (r.paging && r.paging.next) ? r.paging.next : null;
  }
  return out.slice(0, tope);
}
const yaConjunto = {}, yaAnuncios = {};
async function buscarCampanaDelLote(nombre){
  if (!E.etiqueta || E.loteNuevo) return null;
  try {
    const r = await gGet(base + act + '/campaigns?fields=id,name,adlabels,effective_status&limit=50&filtering='
      + encodeURIComponent(JSON.stringify([{ field: 'name', operator: 'EQUAL', value: nombre }])));
    return (r.data || []).find(c => c.name === nombre && conEtiqueta(c) && ['DELETED','ARCHIVED'].indexOf(c.effective_status) < 0) || null;
  } catch (e) { return null; }
}
async function conjuntosDelLote(campaignId){
  if (!E.etiqueta || E.loteNuevo) return {};
  if (yaConjunto[campaignId]) return yaConjunto[campaignId];
  const m = {};
  try { (await paginar(base + campaignId + '/adsets?fields=id,name,adlabels,effective_status&limit=100', 500))
    .forEach(a => { if (conEtiqueta(a) && ['DELETED','ARCHIVED'].indexOf(a.effective_status) < 0) m[a.name] = String(a.id); }); }
  catch (e) { E.avisos.push('No pude revisar los conjuntos previos del lote (' + explicar(e) + '): podrían duplicarse.'); }
  return (yaConjunto[campaignId] = m);
}
async function anunciosDelLote(adsetId){
  if (!E.etiqueta || E.loteNuevo) return {};
  if (yaAnuncios[adsetId]) return yaAnuncios[adsetId];
  const m = {};
  try { (await paginar(base + adsetId + '/ads?fields=id,name,adlabels,effective_status&limit=100', 1000))
    .forEach(a => { if (conEtiqueta(a) && ['DELETED','ARCHIVED'].indexOf(a.effective_status) < 0) m[a.name] = String(a.id); }); }
  catch (e) { E.avisos.push('No pude revisar los anuncios previos del lote (' + explicar(e) + '): podrían duplicarse.'); }
  return (yaAnuncios[adsetId] = m);
}
const digitosNumero = v => String(v || '').replace(/[^0-9]/g, '');
const filaBitacora = (x) => Object.assign({ run_id: E.run_id, publicado_en: new Date().toISOString(), client_key: val.client_key,
  cuenta: act, campana: '', campaign_id: '', adset_id: '', ad_id: '', creative_id: '', anuncio: '', estado: 'PAUSED', error: '', operador: val.operador || '' }, x);

/* Constantes que usan las funciones de abajo: deben declararse antes del primer return. */
/* Nombres legibles de cada nivel de creativo (para avisos). */
const NOMBRE_NIVEL = { ubicacion: 'las imágenes por ubicación', textos: 'las varias opciones de texto', clasico: 'el primer texto y la imagen de feed', post: 'la publicación' };
/* Mejoras de Advantage+ creative que se apagan cuando el anuncio pide "Apagadas" (5.3).
   Desde v22 Meta retiró standard_enhancements: cada mejora se decide por separado en
   degrees_of_freedom_spec.creative_features_spec. Si Meta no acepta la lista, el anuncio
   sale con las mejoras que Meta aplica por defecto y queda el aviso. */
/* Claves documentadas en la guía de Advantage+ creative (sept-2026), separadas por tipo de medio.
   No se envían claves fuera de la guía (site_extensions, profile_card) ni standard_enhancements. */
const MEJORAS_COMUNES = ['adapt_to_placement', 'add_text_overlay', 'creative_stickers', 'description_automation', 'enhance_cta',
  'inline_comment', 'media_type_automation', 'reveal_details_over_time', 'text_optimizations', 'text_translation'];
const MEJORAS_IMAGEN = ['image_animation', 'image_background_gen', 'image_brightness_and_contrast', 'image_templates', 'image_text_translation',
  'image_touchups', 'image_uncrop'];
const MEJORAS_VIDEO = ['video_auto_crop', 'video_filtering', 'video_uncrop', 'translate_voiceover'];

/* ================================================================== fases */
try {
  if (!pageId) throw new Error('No hay página de Facebook seleccionada.');

  /* ---------------- inicio: Instagram, etiqueta del lote, referencias ---------------- */
  if (E.fase === 'inicio') {
    try {
      const p = await gGet(base + pageId + '?fields=instagram_business_account{id},connected_instagram_account{id}');
      E.igId = String((p.instagram_business_account && p.instagram_business_account.id) ||
        (p.connected_instagram_account && p.connected_instagram_account.id) || '');
    } catch (e) {}
    if (!E.igId) {
      try { const g = await gGet(base + act + '/instagram_accounts?fields=id&limit=5'); if (g.data && g.data[0]) E.igId = String(g.data[0].id); } catch (e) {}
    }
    const loteId = String((b.lote_id || '')).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    if (loteId) {
      const nombreEt = 'mbe_' + loteId;
      try { const r = await gPost(act + '/adlabels', { name: nombreEt }); if (r.id) { E.etiqueta = { id: String(r.id), name: nombreEt }; E.loteNuevo = true; } }
      catch (e) {
        try { const l = await gGet(base + act + '/adlabels?fields=id,name&limit=500'); const x = (l.data || []).find(y => y.name === nombreEt); if (x) E.etiqueta = { id: String(x.id), name: nombreEt }; } catch (e2) {}
      }
      if (!E.etiqueta) E.avisos.push('No pude etiquetar el lote en Meta: esta publicación no tiene protección contra duplicados si la reenvías.');
    }
    /* Referencia de conjunto en la campaña: si es de esta cuenta, se clona. */
    for (const c of (f.campaigns || [])) {
      const ref = String(c.referencia_conjunto || '');
      if (!ref) continue;
      let metodo;
      try {
        const r = await gGet(base + ref + '?fields=id,name,campaign_id,account_id');
        const mismaCuenta = String(r.account_id || '').replace('act_', '') === act.replace('act_', '');
        if (mismaCuenta && r.campaign_id) {
          if (!c.clonar_campana_de) c.clonar_campana_de = String(r.campaign_id);
          (f.adsets || []).filter(a => a.campaign_key === c.campaign_key && !a.clonar_conjunto_de).forEach(a => { a.clonar_conjunto_de = ref; });
          metodo = 'clonación nativa de "' + (r.name || ref) + '"';
        } else metodo = 'copia de valores de "' + (r.name || ref) + '" (' + (mismaCuenta ? 'sin campaña legible' : 'está en otra cuenta; Meta no clona entre cuentas') + ')';
      } catch (e) { metodo = 'copia de valores (no pude leer la referencia ' + ref + ': ' + explicar(e) + ')'; }
      E.avisos.push('Campaña "' + c.name + '": se usó ' + metodo + '.');
    }
    await prepararWhatsApp();
    E.fase = 'creativos'; E.i = 0;
  }

  /* ---------------- creativos: uno por uno; el que falla no tumba el resto ---------------- */
  if (E.fase === 'creativos') {
    const assets = f.assets || [];
    while (E.i < assets.length) {
      if (!queda()) return pausaTramo();
      const a = assets[E.i];
      try {
        const deOtra = x => x && String(x).replace(/^act_/, '') !== act.replace(/^act_/, '');
        if (a.image_hash && deOtra(a.hash_cuenta)) {
          /* Réplica (5.2): la imagen está en otra cuenta; Meta la copia sin volver a subirla. */
          const r = await gPost(act + '/adimages', { copy_from: { source_account_id: String(a.hash_cuenta).replace(/^act_/, ''), hash: String(a.image_hash) } });
          const k = Object.keys(r.images || {})[0];
          if (!k) throw new Error('Meta no devolvió la imagen copiada de la otra cuenta.');
          E.subidos[a.asset_ref] = { hash: r.images[k].hash };
        }
        else if (a.image_hash) E.subidos[a.asset_ref] = { hash: String(a.image_hash) };
        else if (a.video_id && deOtra(a.video_cuenta)) {
          /* El video de otra cuenta se vuelve a subir desde su archivo original. */
          const v = await gGet(base + a.video_id + '?fields=source');
          if (!v.source) throw new Error('No pude obtener el archivo del video en la otra cuenta.');
          E.videos.push({ ref: a.asset_ref, id: await subirVideo(v.source, a.file_name), listo: false });
        }
        else if (a.video_id) E.videos.push({ ref: a.asset_ref, id: String(a.video_id), listo: false });
        else if (String(a.type).toUpperCase() === 'VIDEO') E.videos.push({ ref: a.asset_ref, id: await subirVideo(a.source_url, a.file_name), listo: false });
        else E.subidos[a.asset_ref] = await subirImagen(a);
      } catch (e) {
        E.fallidosAsset[a.asset_ref] = explicar(e);
        E.fallos.push('Creativo "' + a.asset_ref + '": ' + explicar(e));
      }
      /* La fuente en base64 ya no hace falta: aligera el estado entre tramos. */
      if (a.source_data) a.source_data = '';
      E.i++;
    }
    E.fase = 'videos'; E.i = 0; E.videoDesde = Date.now();
  }

  /* ---------------- videos: se espera el procesamiento sin bloquear el tramo ---------------- */
  if (E.fase === 'videos') {
    const TOPE_VIDEO_MS = 20 * 60000;
    let pendientes = E.videos.filter(v => !v.listo);
    while (pendientes.length) {
      for (const v of pendientes) {
        try {
          const st = await gGet(base + v.id + '?fields=status,thumbnails');
          const s = st.status && st.status.video_status;
          const th = st.thumbnails && st.thumbnails.data && st.thumbnails.data[0];
          if (s === 'error') { v.listo = true; E.fallidosAsset[v.ref] = 'Meta no pudo procesar el video.'; E.fallos.push('Video "' + v.ref + '": Meta no pudo procesarlo.'); }
          else if (s === 'ready' && th) { v.listo = true; E.subidos[v.ref] = { video: v.id, thumb: th.uri }; }
          else if (s === 'ready') { v.sinMiniatura = (v.sinMiniatura || 0) + 1;
            if (v.sinMiniatura >= 8) { v.listo = true; E.subidos[v.ref] = { video: v.id, thumb: '' }; E.avisos.push('Video "' + v.ref + '": Meta no generó miniatura; se publica sin ella.'); } }
        } catch (e) {}
      }
      pendientes = E.videos.filter(v => !v.listo);
      if (!pendientes.length) break;
      if (Date.now() - E.videoDesde > TOPE_VIDEO_MS) {
        pendientes.forEach(v => { v.listo = true; E.subidos[v.ref] = { video: v.id, thumb: '' };
          E.avisos.push('Video "' + v.ref + '": seguía en proceso tras 20 minutos; se publica y Meta lo termina de procesar.'); });
        break;
      }
      if (!queda()) return pausaTramo();
      await pausa(5000);
    }
    E.fase = 'campanas'; E.i = 0;
  }

  /* ---------------- campañas nuevas ---------------- */
  if (E.fase === 'campanas') {
    const camps = f.campaigns || [];
    while (E.i < camps.length) {
      if (!queda()) return pausaTramo();
      const c = camps[E.i];
      if (E.campanasFallidas[c.campaign_key]) { E.i++; continue; }
      try {
        const previa = await buscarCampanaDelLote(c.name);
        if (previa) {
          E.idCamp[c.campaign_key] = String(previa.id); E.reutilizados++;
          E.nivelPresupuesto[c.campaign_key] = String(c.budget_level||'').toUpperCase();
          E.avisos.push('La campaña "' + c.name + '" ya se había creado en un envío anterior de este plan: se reutilizó.');
        } else if (c.clonar_campana_de) {
          /* Clonación nativa (Meta /copies) de una campaña que Meta ya aceptó. */
          const cp = await gPost(String(c.clonar_campana_de) + '/copies', { deep_copy: 'false', status_option: 'PAUSED' });
          const nueva = String(cp.copied_campaign_id || cp.id || '');
          if (!nueva) throw new Error('Meta no devolvió el ID de la campaña copiada.');
          E.idCamp[c.campaign_key] = nueva; E.campanasNuevas[c.campaign_key] = { id: nueva, name: c.name }; E.nCamp++;
          const info = await gGet(base + nueva + '?fields=daily_budget,lifetime_budget,objective,stop_time');
          const cboRef = !!(Number(info.daily_budget) || Number(info.lifetime_budget));
          E.nivelPresupuesto[c.campaign_key] = cboRef ? 'CAMPAIGN' : 'ADSET';
          const sumaConj = (f.adsets || []).filter(x => x.campaign_key === c.campaign_key).reduce((t, x) => t + (Number(x.daily_budget) || 0), 0);
          const monto = Number(c.daily_budget) || Number(c.lifetime_budget) || sumaConj;
          const upd = { name: c.name, start_time: isoInicio(c.start_time) };
          if (c.stop_time) upd.stop_time = iso(c.stop_time);
          else if (Number(info.lifetime_budget)) {
            upd.stop_time = new Date(Math.max(Date.now(), Date.parse(iso(c.start_time) || '') || 0) + 30 * 86400000).toISOString();
            E.avisos.push('La campaña "' + c.name + '" usa presupuesto total como su referencia: se le puso fin en 30 días; ajústalo si hace falta.');
          }
          else if (info.stop_time) upd.stop_time = '0';
          if (cboRef && monto) { if (Number(info.lifetime_budget)) upd.lifetime_budget = menor(monto); else upd.daily_budget = menor(monto); }
          E.repartoClon[c.campaign_key] = cboRef ? 0 : (Number(c.daily_budget) || 0);
          /* No se toca la campaña hasta haber copiado sus conjuntos. */
          E.ajustesPendientes.push({ id: nueva, upd, que: 'La campaña "' + c.name + '"', ref: String(c.clonar_campana_de) });
          if (cboRef !== (String(c.budget_level).toUpperCase() === 'CAMPAIGN'))
            E.avisos.push('La campaña "' + c.name + '" se clonó de una referencia con presupuesto en ' + (cboRef ? 'la campaña (CBO)' : 'cada conjunto (ABO)') + '; el monto se ubicó así.');
          E.bitacora.push(filaBitacora({ campana: c.name, campaign_id: nueva, anuncio: '(campaña clonada)' }));
        } else {
          const cats = lista(c.special_ad_categories).map(x=>x.toUpperCase()).filter(x=>x && x!=='NONE');
          const p = {
            name: c.name,
            objective: (E.wa[c.campaign_key] && E.wa[c.campaign_key].estado === 'ok') ? E.wa[c.campaign_key].elegido.objetivo : objetivoAdmitido(c),
            status: 'PAUSED',
            buying_type: String(c.buying_type||'AUCTION').toUpperCase(),
            special_ad_categories: cats,   /* obligatorio: [] cuando no hay categoría */
            bid_strategy: c.bid_strategy ? String(c.bid_strategy).toUpperCase() : 'LOWEST_COST_WITHOUT_CAP',
            spend_cap: menor(c.spend_cap),
            start_time: isoInicio(c.start_time),
            stop_time: iso(c.stop_time),
          };
          const paisCat = (val.pais_por_campana || {})[c.campaign_key];
          if (cats.length && paisCat) p.special_ad_category_country = [paisCat];
          if (String(c.budget_level).toUpperCase() === 'CAMPAIGN') {
            if (Number(c.lifetime_budget)) p.lifetime_budget = menor(c.lifetime_budget);
            else p.daily_budget = menor(c.daily_budget);
          } else {
            /* Sin presupuesto de campaña, la estrategia de puja se define en cada conjunto (documentación
               de Meta); en la campaña solo se deja con presupuesto de campaña. */
            E.pujaConjunto = E.pujaConjunto || {};
            if (p.bid_strategy && p.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP') E.pujaConjunto[c.campaign_key] = p.bid_strategy;
            delete p.bid_strategy;
            /* Presupuesto en cada conjunto (ABO): desde v26 Meta exige decir si los conjuntos
               comparten hasta 20 % de su presupuesto (error 100/4834011 si falta). Por defecto no. */
            p.is_adset_budget_sharing_enabled = String(c.compartir_presupuesto || '').toUpperCase() === 'SI';
          }
          let r;
          try { r = await crear(act + '/campaigns', p); }
          catch (e) {
            /* Versión de la API que aún no conoce el campo: se reintenta sin él. */
            if ('is_adset_budget_sharing_enabled' in p && /is_adset_budget_sharing_enabled/i.test(String(e.tecnico || e.message)) && Number(e.subcode) !== 4834011) {
              delete p.is_adset_budget_sharing_enabled; r = await crear(act + '/campaigns', p);
            } else throw e;
          }
          E.pujaCamp = E.pujaCamp || {}; E.pujaCamp[c.campaign_key] = p.bid_strategy || (E.pujaConjunto || {})[c.campaign_key] || '';
          E.idCamp[c.campaign_key] = String(r.id);
          E.campanasNuevas[c.campaign_key] = { id: String(r.id), name: c.name };
          E.nivelPresupuesto[c.campaign_key] = String(c.budget_level||'').toUpperCase();
          E.nCamp++;
          E.bitacora.push(filaBitacora({ campana: c.name, campaign_id: String(r.id), anuncio: '(campaña)' }));
        }
      } catch (e) {
        E.campanasFallidas[c.campaign_key] = true;
        E.fallos.push('Campaña "' + c.name + '": ' + explicar(e));
      }
      E.i++;
    }
    (f.adsets || []).forEach(a => { if (a.campaign_id) { E.idCamp[a.campaign_key] = String(a.campaign_id); E.nivelPresupuesto[a.campaign_key] = 'EXISTENTE'; } });
    (f.ads || []).forEach(ad => { if (ad.campaign_id && !E.idCamp[ad.campaign_key]) E.idCamp[ad.campaign_key] = String(ad.campaign_id); });
    E.fase = 'conjuntos'; E.i = 0;
  }

  /* ---------------- conjuntos ---------------- */
  if (E.fase === 'conjuntos') {
    const adsets = f.adsets || [];
    while (E.i < adsets.length) {
      if (!queda()) return pausaTramo();
      const a = adsets[E.i];
      try { await crearConjunto(a); }
      catch (e) {
        if (e.__pausa) return pausaTramo();   /* copia asíncrona en curso: se retoma este mismo conjunto */
        E.conjuntosFallidos[a.adset_key] = true; E.fallos.push('Conjunto "' + a.name + '": ' + explicar(e));
      }
      E.i++;
    }
    E.fase = 'ajustes'; E.i = 0;
  }

  /* ---------------- ajustes de campañas clonadas (después de copiar sus conjuntos) ---------------- */
  if (E.fase === 'ajustes') {
    while (E.i < E.ajustesPendientes.length) {
      if (!queda()) return pausaTramo();
      const x = E.ajustesPendientes[E.i];
      try { await actualizarClon(x.id, x.upd, x.que); }
      catch (e) { E.avisos.push(x.que + ': no pude aplicar nombre, fechas o presupuesto a la copia (' + explicar(e) + '). Ajústalo en Ads Manager; quedó en pausa.'); }
      E.i++;
    }
    E.fase = 'anuncios'; E.i = 0;
  }

  /* ---------------- anuncios ---------------- */
  if (E.fase === 'anuncios') {
    const ads = f.ads || [];
    while (E.i < ads.length) {
      if (!queda()) return pausaTramo();
      const ad = ads[E.i];
      await crearAnuncio(ad);
      E.i++;
    }
    E.fase = 'limpieza'; E.i = 0;
  }

  /* ---------------- limpieza: lo creado que quedó vacío se elimina ---------------- */
  if (E.fase === 'limpieza') {
    const limpiar = async (id, que) => {
      try { await gPost(String(id), { status: 'DELETED' }); E.avisos.push('Se eliminó ' + que + ': quedó sin contenido por los errores de arriba.'); return true; }
      catch (e) { E.avisos.push('No pude eliminar ' + que + ' (' + explicar(e) + '): bórralo en Ads Manager.'); return false; }
    };
    const planeados = {};
    (f.ads || []).forEach(ad => { planeados[ad.adset_key] = (planeados[ad.adset_key] || 0) + 1; });
    const conjPlaneados = {};
    (f.adsets || []).forEach(a => { conjPlaneados[a.campaign_key] = (conjPlaneados[a.campaign_key] || 0) + 1; });
    for (const k of Object.keys(E.conjuntosNuevos)) {
      if (planeados[k] && !E.adsPorConjunto[k]) { if (await limpiar(E.conjuntosNuevos[k].id, 'el conjunto "' + E.conjuntosNuevos[k].name + '"')) { delete E.conjuntosNuevos[k]; E.nAdset--; } }
    }
    for (const k of Object.keys(E.campanasNuevas)) {
      const vivos = Object.keys(E.conjuntosNuevos).some(x => E.conjuntosNuevos[x].campaign_key === k);
      if (conjPlaneados[k] && !vivos && await limpiar(E.campanasNuevas[k].id, 'la campaña "' + E.campanasNuevas[k].name + '"')) { delete E.campanasNuevas[k]; E.nCamp--; }
    }
    E.bitacora.forEach(row => {
      if (/^\(campaña/.test(row.anuncio) && !Object.keys(E.campanasNuevas).some(k => E.campanasNuevas[k].id === row.campaign_id)) row.estado = 'ELIMINADA_POR_LIMPIEZA';
    });
    E.fase = 'fin';
  }
} catch (e) {
  E.fallos.push(explicar(e));
  E.fase = 'fin';
}

E.fin = true;
E.progreso = 'Cerrando la corrida…';
return [{ json: E }];

/* Objetivo de una campaña nueva: si sus conjuntos copian una configuración de WhatsApp cuya
   optimización Meta ya no admite con ese objetivo (tabla de Click to WhatsApp), se usa el objetivo
   documentado y queda el aviso. Así una réplica o una referencia de otra cuenta no falla con 2490408. */
function objetivoAdmitido(c){
  const obj = String(c.objective || '').toUpperCase();
  const metas = [...new Set((f.adsets || []).filter(x => x.campaign_key === c.campaign_key && x.config_json && /WHATSAPP/i.test(String(x.destination_type || '')))
    .map(x => { try { return String(JSON.parse(x.config_json).optimization_goal || '').toUpperCase(); } catch (e) { return ''; } }).filter(Boolean))];
  if (metas.length !== 1 || !OBJETIVOS_WA[metas[0]] || OBJETIVOS_WA[metas[0]].indexOf(obj) >= 0) return obj;
  const nuevo = OBJETIVOS_WA[metas[0]][0];
  E.avisos.push('Campaña "' + c.name + '": su configuración de WhatsApp optimiza por ' + (NOMBRE_META_WA[metas[0]] || metas[0]) + ', que Meta solo admite con objetivo '
    + (NOMBRE_OBJETIVO[nuevo] || nuevo) + '; se creó con ese objetivo en lugar de ' + (NOMBRE_OBJETIVO[obj] || obj) + '.');
  return nuevo;
}

/* WhatsApp (5.5): con la configuración verificada ya no se clona la referencia (Meta rechaza copiar
   optimizaciones que no admite). Lo que no se pudo verificar antes se prueba ahora en una campaña
   temporal en pausa que se elimina al terminar. */
async function prepararWhatsApp(){
  const cacheWA = {};
  const temporales = [];
  const porCampana = {};
  (f.adsets || []).filter(a => /WHATSAPP/i.test(String(a.destination_type || '')) && !a.campaign_id).forEach(a => { if (!porCampana[a.campaign_key]) porCampana[a.campaign_key] = a; });
  for (const k of Object.keys(porCampana)) {
    const c = (f.campaigns || []).find(x => x.campaign_key === k); if (!c) continue;
    const a = porCampana[k];
    if (!E.wa[k] || E.wa[k].estado === 'pendiente') {
      let cfg = null; try { cfg = a.config_json ? JSON.parse(a.config_json) : null; } catch (e) {}
      try {
        let campanaRef = null;
        if (c.clonar_campana_de) { try { const ri = await gGet(base + c.clonar_campana_de + '?fields=objective,daily_budget,lifetime_budget'); campanaRef = { id: String(c.clonar_campana_de), objetivo: ri.objective, cbo: !!(Number(ri.daily_budget) || Number(ri.lifetime_budget)) }; } catch (e) {} }
        const r = await resolverWA({ acc: act, pageId, meta: (cfg && cfg.optimization_goal) || a.optimization_goal, objetivo: c.objective, objetivoRef: c.objective, cfg, campanaRef,
          objetivoFijo: String(c.wa_cambiar_objetivo || '').toUpperCase() === 'SI' ? '' : String(c.objective || '').toUpperCase(),
          numero: a.whatsapp_phone_number, dataset: a.messaging_dataset_id || (String(a.optimization_goal).toUpperCase() === 'OFFSITE_CONVERSIONS' ? a.pixel_id : ''), evento: a.custom_event_type,
          targeting: { geo_locations: { countries: [lista(a.countries)[0] || 'MX'] }, age_min: 18, targeting_automation: { advantage_audience: 0 } },
          moneda, minimo: 0, cache: cacheWA,
          crearCampana: async (obj) => {
            const r = await gPost(act + '/campaigns', { name: 'MBE · validación temporal (se elimina)', objective: obj, status: 'PAUSED', buying_type: 'AUCTION',
              special_ad_categories: [], is_adset_budget_sharing_enabled: false });
            temporales.push(String(r.id)); return { id: String(r.id), cbo: false };
          } });
        E.wa[k] = r.ok ? { estado: 'ok', elegido: r.elegido, intentos: r.intentos } : { estado: 'falla', intentos: r.intentos, faltaDataset: !!r.faltaDataset };
      } catch (e) { E.wa[k] = { estado: 'falla', intentos: [{ etiqueta: 'verificación', error: explicar(e) }] }; }
    }
    const w = E.wa[k];
    if (w.estado === 'ok') {
      const antes = String(c.objective || '').toUpperCase();
      if (c.clonar_campana_de || (f.adsets || []).some(x => x.campaign_key === k && x.clonar_conjunto_de)) {
        c.clonar_campana_de = ''; (f.adsets || []).forEach(x => { if (x.campaign_key === k) x.clonar_conjunto_de = ''; });
        E.avisos = E.avisos.filter(t => !(t.indexOf('"' + c.name + '"') >= 0 && /se usó clonación nativa|copia de valores/.test(t)));
        E.avisos.push('Campaña "' + c.name + '": se creó con la configuración de WhatsApp que Meta aceptó (' + w.elegido.etiqueta + '), sin copiar la referencia.');
      }
      if (w.elegido.objetivo !== antes) E.avisos.push('Campaña "' + c.name + '": el objetivo quedó en ' + (NOMBRE_OBJETIVO[w.elegido.objetivo] || w.elegido.objetivo)
        + ' (el plan decía ' + (NOMBRE_OBJETIVO[antes] || antes) + ') porque es el que Meta acepta para esa optimización con WhatsApp.');
    } else if (w.estado === 'falla') {
      E.campanasFallidas[k] = true;
      E.fallos.push('Campaña "' + c.name + '": Meta rechazó todas las configuraciones posibles para WhatsApp; no se creó nada. ' + (w.faltaDataset ? 'Falta elegir el conjunto de datos de WhatsApp (CAPI): Meta crea hoy las campañas de compras por WhatsApp como Ventas + conversiones con ese conjunto de datos. ' : '') + textoIntentosWA(w.intentos || [])
        + '. Revisa en "Chequeo de Meta" el número vinculado a la página y, para compras, elige el conjunto de datos de WhatsApp (CAPI).');
    }
  }
  for (const id of temporales) { try { await gPost(id, { status: 'DELETED' }); } catch (e) { E.avisos.push('No pude eliminar la campaña temporal de validación ' + id + ': bórrala en Ads Manager.'); } }
}

/* ======================================================= conjunto (uno) */
async function crearConjunto(a){
  if (E.campanasFallidas[a.campaign_key] || !E.idCamp[a.campaign_key]) {
    E.conjuntosFallidos[a.adset_key] = true;
    E.fallos.push('Conjunto "' + a.name + '": no se creó porque su campaña falló.');
    return;
  }
  const previos = E.campanasNuevas[a.campaign_key] ? {} : await conjuntosDelLote(String(E.idCamp[a.campaign_key]));
  if (previos[a.name]) {
    E.idAdset[a.adset_key] = previos[a.name]; E.reutilizados++;
    E.avisos.push('El conjunto "' + a.name + '" ya existía de un envío anterior de este plan: se reutilizó.');
    return;
  }
  if (a.clonar_conjunto_de) return clonarConjunto(a);

  const metaOptim = String(a.optimization_goal || '').toUpperCase();
  const p = {
    name: a.name,
    campaign_id: E.idCamp[a.campaign_key],
    optimization_goal: metaOptim,
    billing_event: String(a.billing_event || 'IMPRESSIONS').toUpperCase(),
    status: 'PAUSED',
    start_time: isoInicio(a.start_time),
    end_time: iso(a.end_time),
    targeting: await segmentacionDe(a),
  };
  const nivel = E.nivelPresupuesto[a.campaign_key] || '';
  const llevaPropio = (nivel === 'ADSET') || (nivel === 'EXISTENTE' && (Number(a.daily_budget) || Number(a.lifetime_budget)));
  if (llevaPropio) {
    if (Number(a.lifetime_budget)) p.lifetime_budget = menor(a.lifetime_budget);
    else p.daily_budget = menor(a.daily_budget);
  }
  const CON_IMPORTE = ['LOWEST_COST_WITH_BID_CAP','COST_CAP','TARGET_COST','LOWEST_COST_WITH_MIN_ROAS'];
  const estrategia = String(((E.pujaCamp || {})[a.campaign_key]) || val.bid_strategy || '').toUpperCase();
  if (Number(a.bid_amount)) p.bid_amount = menor(a.bid_amount);
  const pujaPropia = (E.pujaConjunto || {})[a.campaign_key];
  if (pujaPropia) p.bid_strategy = pujaPropia;
  else if (CON_IMPORTE.indexOf(estrategia) >= 0) {
    throw new Error('La campaña usa la estrategia ' + estrategia + ', que exige un importe de puja, y el conjunto "' + a.name
      + '" no trae ninguno. Cámbiala a costo más bajo en Ads Manager o crea una campaña nueva desde esta herramienta.');
  }
  /* Configuración copiada de un conjunto que Meta ya aceptó en la cuenta. */
  let cfgWA = null;
  if (a.config_json) { try { cfgWA = JSON.parse(a.config_json); } catch (e) { cfgWA = null; } }
  /* WhatsApp verificado con Meta (5.5): se usa la configuración que Meta aceptó. */
  const waOk = E.wa && E.wa[a.campaign_key] && E.wa[a.campaign_key].estado === 'ok' ? E.wa[a.campaign_key].elegido : null;
  if (waOk && /WHATSAPP/i.test(String(a.destination_type || ''))) {
    const po = Object.assign({}, waOk.promoted_object);
    if (a.whatsapp_phone_number) delete po.whatsapp_phone_number;   /* el número del conjunto se prueba en sus formatos abajo */
    cfgWA = { optimization_goal: waOk.optimization_goal, billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object: po,
      attribution_spec: waOk.attribution_spec || null, optimization_sub_event: waOk.optimization_sub_event || null };
  }
  if (cfgWA) {
    if (cfgWA.optimization_goal) p.optimization_goal = String(cfgWA.optimization_goal).toUpperCase();
    if (cfgWA.billing_event) p.billing_event = String(cfgWA.billing_event).toUpperCase();
    if (cfgWA.optimization_sub_event && cfgWA.optimization_sub_event !== 'NONE') p.optimization_sub_event = cfgWA.optimization_sub_event;
    if (cfgWA.attribution_spec && cfgWA.attribution_spec.length) p.attribution_spec = sanearAtribucion(cfgWA.attribution_spec);
    if (cfgWA.destination_type) a.destination_type = cfgWA.destination_type;
  }
  const dest = String(a.destination_type||'').toUpperCase();
  if (dest && dest !== 'WEBSITE') p.destination_type = dest;

  const po = String(a.promoted_object_type||'NONE').toUpperCase();
  if (/WHATSAPP/.test(dest)) {
    /* Click to WhatsApp: validate_only sobre cada forma posible del objeto
       promovido (número tal cual y variantes; con y sin evento) y se crea con la
       primera que Meta acepte. */
    const numeros = variantesNumero(a.whatsapp_phone_number);
    const comprasMensajes = String(p.optimization_goal) === 'MESSAGING_PURCHASE_CONVERSION';
    const conversionesWeb = String(p.optimization_goal) === 'OFFSITE_CONVERSIONS';
    const candidatas = [];
    numeros.forEach(n => {
      const b0 = { page_id: pageId }; if (n) b0.whatsapp_phone_number = n;
      if (cfgWA) {
        const po2 = Object.assign({}, cfgWA.promoted_object || {}, b0);
        if (!n && (cfgWA.promoted_object || {}).whatsapp_phone_number) po2.whatsapp_phone_number = cfgWA.promoted_object.whatsapp_phone_number;
        candidatas.push(po2);
      } else if (comprasMensajes) {
        candidatas.push(Object.assign({}, b0, { custom_event_type: 'PURCHASE' }));
        candidatas.push(Object.assign({}, b0));
      } else if (conversionesWeb && a.pixel_id) {
        candidatas.push(Object.assign({}, b0, { pixel_id: String(a.pixel_id), custom_event_type: String(a.custom_event_type || 'PURCHASE').toUpperCase() }));
      } else candidatas.push(b0);
    });
    const esDelNumero = e => /whats ?app|phone|n[uú]mero|promoted[_ ]object|objeto promocionado/i.test(String(e.message || '') + ' ' + String(e.titulo || ''))
      && !/objetivo de rendimiento|performance goal|optimization goal|objetivo de la campa/i.test(String(e.message || ''));
    let ultimo = null, elegida = null, probadas = 0;
    for (const cand of candidatas.slice(0, 8)) {
      try {
        probadas++;
        await gPost(act + '/adsets', Object.assign({}, p, { promoted_object: cand, execution_options: ['validate_only'] }));
        elegida = cand; break;
      } catch (e) { ultimo = e; if (Number(e.subcode) === 2446886 || !esDelNumero(e)) break; }   /* página sin WhatsApp: ningún formato sirve */
    }
    if (!elegida) {
      const err = ultimo || new Error('Meta no aceptó el conjunto de WhatsApp.');
      if (a.whatsapp_phone_number && esDelNumero(err)) err.message = 'Meta no aceptó el número ' + a.whatsapp_phone_number
        + ' con esta página (probé ' + probadas + ' formatos). Revisa en la configuración de la página que ese número esté conectado. Detalle: ' + (err.message || '');
      throw err;
    }
    p.promoted_object = elegida;
    if (elegida.whatsapp_phone_number && digitosNumero(elegida.whatsapp_phone_number) !== digitosNumero(a.whatsapp_phone_number)) {
      E.avisos.push('Conjunto "' + a.name + '": el número se envió como ' + elegida.whatsapp_phone_number + ' (formato que Meta aceptó).');
    }
  } else if (dest === 'ON_AD') {
    /* Formulario instantáneo: la página es el objeto promovido; el formulario va en cada anuncio. */
    p.promoted_object = { page_id: pageId };
    if (['LEAD_GENERATION','QUALITY_LEAD'].indexOf(String(p.optimization_goal)) < 0) p.optimization_goal = 'LEAD_GENERATION';
  } else if (po === 'PIXEL' && a.pixel_id) {
    p.promoted_object = { pixel_id: String(a.pixel_id), custom_event_type: String(a.custom_event_type||'').toUpperCase() };
  } else if (po === 'PAGE' || metaOptim === 'PAGE_LIKES') {
    p.promoted_object = { page_id: pageId };
  }
  /* attribution_spec no se envía (depende del objetivo; Meta aplica el de la cuenta). */
  if (Number(a.frequency_cap) && metaOptim === 'REACH') {
    p.frequency_control_specs = [{ event:'IMPRESSIONS', interval_days:7, max_frequency:Number(a.frequency_cap) }];
  }
  const r = await crearConjuntoEnMeta(p, a);
  E.idAdset[a.adset_key] = String(r.id);
  E.conjuntosNuevos[a.adset_key] = { id: String(r.id), name: a.name, campaign_key: a.campaign_key };
  E.nAdset++;
}

/* Crea el conjunto y corrige en un segundo intento lo que Meta rechaza por cambios de la API:
   posiciones de Instagram retiradas, y edades cerradas con Advantage+ audience. */
async function crearConjuntoEnMeta(p, a){
  try { return await crear(act + '/adsets', p); }
  catch (e) {
    const msg = String(e.message || '') + ' ' + String(e.tecnico || '') + ' ' + (e.campos || []).join(' ');
    const t = p.targeting || {};
    if (/position|placement|ubicaci|explore|explorar/i.test(msg) && quitarPosicionesRetiradas(t)) {
      E.avisos.push('Conjunto "' + a.name + '": Meta ya no admite la ubicación Explorar o Búsqueda de Instagram en la segmentación; se quitó.');
      return await crear(act + '/adsets', p);
    }
    const adv = t.targeting_automation && Number(t.targeting_automation.advantage_audience) === 1;
    if (adv && /age_range/i.test(msg) && t.age_range) {
      delete t.age_range;
      E.avisos.push('Conjunto "' + a.name + '": Meta no aceptó el rango de edad como sugerencia de Advantage+ audience; se publicó con la edad mínima y sin sugerencia.');
      return await crear(act + '/adsets', p);
    }
    if (adv && /\bage|edad/i.test(msg) && (Number(t.age_max || 65) < 65 || Number(t.age_min || 18) > 25)) {
      const antes = (t.age_min || 18) + '–' + (t.age_max || 65);
      t.age_min = Math.min(Number(t.age_min || 18), 25); delete t.age_max;
      E.avisos.push('Conjunto "' + a.name + '": con Advantage+ audience Meta pide edades abiertas; el rango ' + antes + ' se abrió a ' + t.age_min + '–65.');
      return await crear(act + '/adsets', p);
    }
    throw e;
  }
}

/* Clonación nativa de un conjunto que Meta ya aceptó (con respaldo de copia profunda). */
async function clonarConjunto(a){
  E.copiaAsync = E.copiaAsync || {}; E.copiaProfunda = E.copiaProfunda || {}; E.sinCopiaSimple = E.sinCopiaSimple || {};
  const ref = String(a.clonar_conjunto_de);
  const refCamp = String(((f.campaigns || []).find(x => x.campaign_key === a.campaign_key) || {}).clonar_campana_de || '');
  let nuevo = '';
  const pendiente = E.copiaAsync[a.adset_key];
  /* Si ya se comprobó en esta corrida que la referencia no se puede copiar, no se repite
     (cada intento de copia profunda puede tardar varios minutos). */
  E.copiaImposible = E.copiaImposible || {};
  if (!pendiente && E.copiaImposible[ref]) throw new Error(E.copiaImposible[ref]);
  try { return await clonarConjuntoInterno(a, ref, refCamp, pendiente); }
  catch (e) {
    if (!e.__pausa && /^No se pudo copiar el conjunto de referencia/.test(String(e.message))) E.copiaImposible[ref] = e.message;
    throw e;
  }
}
async function clonarConjuntoInterno(a, ref, refCamp, pendiente){
  let nuevo = '';

  if (!pendiente) {
    /* 1 · Ya hay en esta campaña una copia profunda de la referencia: se duplica ESA
          copia dentro de su propia campaña (así no se vuelve a copiar la campaña
          entera ni se borra el conjunto anterior). */
    const base_ = E.copiaProfunda[a.campaign_key];
    if (base_) {
      const cp = await gPost(base_ + '/copies', { deep_copy: 'false', status_option: 'PAUSED' });
      nuevo = String(cp.copied_adset_id || cp.id || '');
      if (!nuevo) throw new Error('Meta no devolvió el ID del conjunto copiado.');
      E.avisos.push('Conjunto "' + a.name + '": se duplicó la copia de la referencia dentro de la misma campaña.');
    } else {
      /* 2 · Copia simple del conjunto dentro de la campaña nueva. */
      let e1 = null;
      if (!E.sinCopiaSimple[ref]) {
        try {
          const cp = await gPost(ref + '/copies', { campaign_id: String(E.idCamp[a.campaign_key]), deep_copy: 'false', status_option: 'PAUSED' });
          nuevo = String(cp.copied_adset_id || cp.id || '');
        } catch (e) { e1 = e; E.sinCopiaSimple[ref] = textoMeta(e); E.subcodeCopia = Number(e.subcode) || 0; }
      }
      /* 2b · Meta no deja usar la optimización de la referencia con el objetivo de su campaña
            (2490408): se crea el conjunto con los mismos valores en una campaña cuyo objetivo
            sí la admite según la documentación de Click to WhatsApp. */
      if (!nuevo && a.config_json && /2490408|objetivo de rendimiento|performance goal/i.test(String(E.sinCopiaSimple[ref] || ''))) {
        if (await reconstruirPorValores(a)) return;
      }
      if (!nuevo) {
        /* 3 · Copia profunda de la campaña de referencia (como "Duplicar" en Ads Manager).
              Meta solo la hace al instante con menos de 3 objetos; si la campaña es
              más grande se encola como lote asíncrono y se espera entre tramos. */
        if (!refCamp) { const e = e1 || new Error('No se pudo copiar el conjunto de referencia.'); e.message = 'Al copiar el conjunto de referencia: ' + e.message; throw e; }
        E.avisos.push('Conjunto "' + a.name + '": la copia simple no está disponible para esta referencia (' + E.sinCopiaSimple[ref]
          + '); se usa la copia profunda de la campaña de referencia.');
        let cp2 = null;
        try { cp2 = await gPost(refCamp + '/copies', { deep_copy: 'true', status_option: 'PAUSED' }); }
        catch (e2) {
          const grande = Number(e2.subcode) === 1885194 || /demasiado alto|too (many|large)|asynchronous|asincr/i.test(String(e2.message));
          if (!grande) throw errorDeCopia(a, E.sinCopiaSimple[ref], textoMeta(e2));
          /* Copia asíncrona como la documenta Meta en "Copies" (5.5): parámetro asyncbatch enviado a la
             raíz del API; responde async_sessions[{id}] y el resultado se lee en /{id}?fields=result.
             async_batch_requests (lo que se usaba antes) solo admite crear y actualizar: con /copies
             devolvía "(#194) param adbatch has too few elements". */
          let sesion = '';
          try {
            const r = await gPost('', { asyncbatch: [{ method: 'POST', relative_url: refCamp + '/copies', name: 'mbe_copia_' + refCamp, body: 'deep_copy=true&status_option=PAUSED' }] });
            const ss = (r && (r.async_sessions || (r.data && r.data.async_sessions))) || [];
            sesion = String((ss[0] || {}).id || '');
          } catch (e3) { throw errorDeCopia(a, E.sinCopiaSimple[ref], 'Meta no aceptó la copia en segundo plano: ' + textoMeta(e3)); }
          if (!sesion) throw errorDeCopia(a, E.sinCopiaSimple[ref], 'Meta no devolvió la sesión de la copia en segundo plano.');
          E.copiaAsync[a.adset_key] = { sesion, desde: Date.now() };
          E.avisos.push('Conjunto "' + a.name + '": la campaña de referencia es grande; Meta la copió en segundo plano (lote asíncrono).');
        }
        if (cp2) nuevo = await adoptarCopiaProfunda(a, cp2, ref);
      }
    }
  }
  if (E.copiaAsync[a.adset_key]) {
    const r = await esperarCopiaAsync(a);        /* lanza {__pausa} si hay que seguir en el próximo tramo */
    delete E.copiaAsync[a.adset_key];
    nuevo = await adoptarCopiaProfunda(a, r, ref);
  }
  if (!nuevo) throw new Error('Meta no devolvió el ID del conjunto copiado.');
  E.idAdset[a.adset_key] = nuevo; E.conjuntosNuevos[a.adset_key] = { id: nuevo, name: a.name, campaign_key: a.campaign_key }; E.nAdset++;
  const infoK = await gGet(base + nuevo + '?fields=daily_budget,lifetime_budget,end_time');
  const upd = { name: a.name, start_time: isoInicio(a.start_time), targeting: await segmentacionDe(a) };
  const totalRef = !!Number(infoK.lifetime_budget);
  const inicioMs = Math.max(Date.now(), Date.parse(iso(a.start_time) || '') || 0);
  let dias = 30;
  if (a.end_time) { upd.end_time = iso(a.end_time); dias = Math.max(1, Math.round((Date.parse(upd.end_time) - inicioMs) / 86400000)); }
  else if (totalRef) upd.end_time = new Date(inicioMs + 30 * 86400000).toISOString();
  else if (infoK.end_time) upd.end_time = '0';
  if (E.nivelPresupuesto[a.campaign_key] === 'ADSET') {
    const hermanos = (f.adsets || []).filter(x => x.campaign_key === a.campaign_key).length || 1;
    const m = Number(a.daily_budget) || Number(a.lifetime_budget) || (E.repartoClon[a.campaign_key] ? E.repartoClon[a.campaign_key] / hermanos : 0);
    if (m) {
      if (totalRef) {
        const tot = Number(a.lifetime_budget) || m * dias;
        upd.lifetime_budget = menor(tot);
        E.avisos.push('El conjunto "' + a.name + '" usa presupuesto total como su referencia: ' + (Number(a.lifetime_budget) ? '' : m + ' ' + moneda + ' diarios × ' + dias + ' días = ') + tot + ' ' + moneda + ' en total, hasta ' + String(upd.end_time).slice(0, 10) + '.');
      }
      else upd.daily_budget = menor(m);
    }
  }
  try { await actualizarClon(nuevo, upd, 'El conjunto "' + a.name + '"'); }
  catch (e) { e.message = 'Al ajustar la copia (' + Object.keys(upd).join(', ') + '): ' + e.message; throw e; }
  try {
    const ref = await gGet(base + nuevo + '?fields=promoted_object,optimization_goal,destination_type');
    const numRef = String((ref.promoted_object || {}).whatsapp_phone_number || '');
    const dg = s => { let x = String(s || '').replace(/[^0-9]/g, ''); if (/^521\d{10}$/.test(x)) x = '52' + x.slice(3); return x; };
    if (a.whatsapp_phone_number && numRef && dg(numRef) !== dg(a.whatsapp_phone_number))
      E.avisos.push('El conjunto "' + a.name + '" quedó con el número ' + numRef + ' de la referencia: Meta no permite cambiar el número en una copia.');
  } catch (e) {}
}

/* Crea (o reutiliza) la campaña del plan con otro objetivo, con el nombre, fechas y presupuesto del plan. */
async function campanaConObjetivo(a, objetivo){
  const k = a.campaign_key;
  E.campReconstruida = E.campReconstruida || {};
  const clave = k + '|' + objetivo;
  if (E.campReconstruida[clave]) return E.campReconstruida[clave];
  const c = (f.campaigns || []).find(x => x.campaign_key === k) || {};
  const cats = lista(c.special_ad_categories).map(x => x.toUpperCase()).filter(x => x && x !== 'NONE');
  const p = { name: c.name || a.name, objective: objetivo, status: 'PAUSED', buying_type: 'AUCTION', special_ad_categories: cats,
    start_time: isoInicio(c.start_time), stop_time: iso(c.stop_time) };
  const paisCat = (val.pais_por_campana || {})[k];
  if (cats.length && paisCat) p.special_ad_category_country = [paisCat];
  /* Campaña nueva: sigue el nivel de presupuesto del PLAN (no el de la referencia). */
  if (String(c.budget_level || '').toUpperCase() === 'CAMPAIGN') {
    const suma = (f.adsets || []).filter(x => x.campaign_key === k).reduce((t, x) => t + (Number(x.daily_budget) || 0), 0);
    if (Number(c.lifetime_budget) && c.stop_time) p.lifetime_budget = menor(c.lifetime_budget);
    else p.daily_budget = menor(Number(c.daily_budget) || Number(c.lifetime_budget) || suma);
    p.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
  } else p.is_adset_budget_sharing_enabled = String(c.compartir_presupuesto || '').toUpperCase() === 'SI';
  const r = await crear(act + '/campaigns', p);
  return (E.campReconstruida[clave] = String(r.id));
}
/* Reconstrucción por valores: prueba el objetivo actual y, si Meta lo rechaza, los objetivos que la
   documentación admite para esa optimización con WhatsApp. Cada intento valida con Meta antes de
   crear (validate_only dentro de crearConjunto), así que un intento fallido no deja conjuntos. */
async function reconstruirPorValores(a){
  let cfg = null; try { cfg = JSON.parse(a.config_json); } catch (e) { return false; }
  const meta = String((cfg && cfg.optimization_goal) || a.optimization_goal || '').toUpperCase();
  const k = a.campaign_key, original = String(E.idCamp[k]);
  let actual = '';
  try { actual = String((await gGet(base + original + '?fields=objective')).objective || '').toUpperCase(); } catch (e) {}
  const candidatos = [...new Set([actual].concat(OBJETIVOS_WA[meta] || []).filter(Boolean))];
  const hermanos = (f.adsets || []).filter(x => x.campaign_key === k).length || 1;
  const cPlan = (f.campaigns || []).find(x => x.campaign_key === k) || {};
  const nivelPlan = String(cPlan.budget_level || '').toUpperCase() === 'CAMPAIGN' ? 'CAMPAIGN' : 'ADSET';
  const nivelOriginal = E.nivelPresupuesto[k];
  const conPresupuesto = (campNueva) => {
    const x = Object.assign({}, a, { clonar_conjunto_de: '' });
    const nivel = campNueva ? nivelPlan : nivelOriginal;
    if (nivel === 'ADSET' && !Number(x.daily_budget) && !Number(x.lifetime_budget)) {
      const m = E.repartoClon[k] ? E.repartoClon[k] / hermanos : (Number(cPlan.daily_budget) || 0) / hermanos;
      if (m) x.daily_budget = Math.round(m * 100) / 100;
    }
    if (nivel === 'CAMPAIGN') { x.daily_budget = ''; x.lifetime_budget = ''; }
    return x;
  };
  let ultimo = null;
  for (const obj of candidatos) {
    let campId = original, creada = false;
    try {
      if (obj !== actual) {
        const previa = (E.campReconstruida || {})[k + '|' + obj];
        campId = await campanaConObjetivo(a, obj); creada = !previa;
      }
      E.idCamp[k] = campId;
      if (campId !== original) E.nivelPresupuesto[k] = nivelPlan;
      await crearConjunto(conPresupuesto(campId !== original));
      if (campId !== original) {
        /* La campaña copiada de la referencia queda sin uso: se reemplaza por la nueva. */
        const c = (f.campaigns || []).find(x => x.campaign_key === k) || {};
        const otros = Object.keys(E.conjuntosNuevos).some(x => E.conjuntosNuevos[x].campaign_key === k && x !== a.adset_key);
        if (!otros) { try { await gPost(original, { status: 'DELETED' }); } catch (e) {}
          E.bitacora.forEach(row => { if (row.campaign_id === original && /^\(campaña/.test(row.anuncio)) row.estado = 'REEMPLAZADA'; }); }
        E.ajustesPendientes = E.ajustesPendientes.filter(x => x.id !== original);
        E.campanasNuevas[k] = { id: campId, name: c.name || a.name };
        /* Los avisos de la clonación de la campaña ya no aplican: se reemplazó. */
        const nom = '"' + (c.name || a.name) + '"';
        E.avisos = E.avisos.filter(t => !(t.indexOf(nom) >= 0 && /se usó clonación nativa|se clonó de una referencia/.test(t)));
        if (creada) E.bitacora.push(filaBitacora({ campana: c.name || a.name, campaign_id: campId, anuncio: '(campaña)' }));
        E.avisos.push('Campaña "' + (c.name || a.name) + '": Meta no permite ' + (meta ? 'optimizar por ' + (NOMBRE_META_WA[meta] || meta) + ' ' : '') + 'con WhatsApp en una campaña de '
          + (NOMBRE_OBJETIVO[actual] || actual || 'ese objetivo') + ' (la referencia es de una configuración anterior); se creó con objetivo ' + (NOMBRE_OBJETIVO[obj] || obj)
          + ', como indica la documentación de Click to WhatsApp, con el mismo presupuesto, fechas y optimización.');
      }
      E.avisos.push('Conjunto "' + a.name + '": se creó con los valores de la referencia (optimización, evento y número) porque Meta no permite duplicarla.');
      return true;
    } catch (e) {
      ultimo = e;
      E.idCamp[k] = original; E.nivelPresupuesto[k] = nivelOriginal;
      if (creada) { try { await gPost(campId, { status: 'DELETED' }); } catch (x) {} delete E.campReconstruida[k + '|' + obj]; }
      /* Solo se prueba otro objetivo si el rechazo es por la combinación objetivo/optimización. */
      if (!/2490408|objetivo de rendimiento|performance goal/i.test(textoMeta(e))) break;
    }
  }
  if (ultimo) E.avisos.push('Conjunto "' + a.name + '": tampoco se pudo crear con los valores de la referencia (' + textoMeta(ultimo) + ').');
  return false;
}

/* Error final cuando ninguna forma de copiar la referencia funcionó. Si Meta dijo que el objetivo de
   rendimiento no está disponible (2490408), la causa casi siempre es la referencia: fue creada con una
   combinación que Meta ya no permite en conjuntos nuevos, aunque el conjunto viejo siga activo. */
function errorDeCopia(a, simple, profunda){
  const legado = E.subcodeCopia === 2490408 || /2490408|objetivo de rendimiento|performance goal/i.test(String(simple) + ' ' + String(profunda));
  return new Error('No se pudo copiar el conjunto de referencia. Copia simple: ' + (simple || 'no se intentó') + ' · Copia de la campaña: ' + profunda
    + (legado ? ' · Qué hacer: Meta no deja crear conjuntos nuevos con la optimización de esa referencia en esta cuenta (el original puede seguir activo, pero no se puede duplicar). '
      + 'Elige como configuración probada un conjunto de WhatsApp creado recientemente en Ads Manager, o crea uno nuevo ahí con la optimización que quieres y úsalo como referencia. '
      + 'Si no hay ninguno, optimiza por Conversaciones.' : ''));
}

/* Espera la copia asíncrona sin bloquear: sondea mientras quede tiempo del tramo
   y, si no termina, pide continuar en el siguiente. Tope: 25 minutos. */
async function esperarCopiaAsync(a){
  const p = E.copiaAsync[a.adset_key];
  while (true) {
    let listo = false, fallo = '';
    try {
      let x = null;
      if (p.sesion) {
        const st = await gGet(base + p.sesion + '?fields=result');
        if (st && st.result != null && st.result !== '') { listo = true; x = { status: '', result: st.result }; }
      } else {
        const st = await gGet(base + p.lote + '?fields=is_completed,success_count,error_count');
        listo = !!st.is_completed;
        if (listo) { const rq = await gGet(base + p.lote + '/requests?fields=status,result,error_code,error_message&limit=5'); x = (rq.data || [])[0] || {}; }
      }
      if (listo) {
        const res = buscarCopia(x.result);
        if (res) return res;
        /* El error de la copia viene en el resultado (texto JSON con {error:{…}}) o en error_message. */
        let er = null; try { const rr = typeof x.result === 'string' ? JSON.parse(x.result) : x.result; er = rr && (rr.error || (rr.body && JSON.parse(rr.body).error)); } catch (e) {}
        const detalle = er ? [er.error_user_title, er.error_user_msg || er.message].filter(Boolean).join(': ') + (er.code ? ' [' + er.code + (er.error_subcode ? '/' + er.error_subcode : '') + ']' : '')
          : (x.error_message || JSON.stringify(x.result || '').slice(0, 300));
        const ef = errorDeCopia(a, E.sinCopiaSimple[String(a.clonar_conjunto_de)], 'la copia en segundo plano terminó con error (' + String(x.status || '') + '): ' + detalle);
        ef.__final = true; throw ef;
      }
    } catch (e) {
      if (e.__final) { delete E.copiaAsync[a.adset_key]; throw e; }
      if (Date.now() - p.desde > 60000) fallo = 'No pude consultar la copia asíncrona: ' + explicar(e);
    }
    if (fallo) { delete E.copiaAsync[a.adset_key]; throw new Error(fallo); }
    if (Date.now() - p.desde > 25 * 60000) { delete E.copiaAsync[a.adset_key]; throw new Error('La copia asíncrona de la campaña de referencia no terminó en 25 minutos.'); }
    if (!queda()) { const e = new Error('pausa'); e.__pausa = true; throw e; }
    await pausa(5000);
  }
}
/* Busca {copied_campaign_id, ad_object_ids} dentro de la respuesta del lote, venga como texto o como objeto. */
function buscarCopia(v, prof){
  prof = prof || 0; if (prof > 6 || v == null) return null;
  if (typeof v === 'string') { try { return buscarCopia(JSON.parse(v), prof + 1); } catch (e) { return null; } }
  if (typeof v !== 'object') return null;
  if (v.copied_campaign_id) return v;
  for (const k of Object.keys(v)) { const r = buscarCopia(v[k], prof + 1); if (r) return r; }
  return null;
}
/* Toma la copia profunda: conserva la campaña copiada y el conjunto de referencia,
   borra todo lo demás que se copió (en lotes de 50) y reemplaza la copia simple vacía. */
async function adoptarCopiaProfunda(a, cp2, ref){
  const campNueva = String(cp2.copied_campaign_id || '');
  const objs = cp2.ad_object_ids || [];
  const par = objs.find(o => String(o.source_id) === ref && /adset|ad_set/i.test(String(o.ad_object_type || '')))
           || objs.find(o => String(o.source_id) === ref);
  if (!campNueva || !par) throw new Error('La copia profunda no devolvió la copia del conjunto de referencia.');
  const nuevo = String(par.copied_id);
  const vieja = String(E.idCamp[a.campaign_key]);
  if (vieja && vieja !== campNueva) { try { await gPost(vieja, { status: 'DELETED' }); } catch (e) {} }
  E.idCamp[a.campaign_key] = campNueva;
  E.campanasNuevas[a.campaign_key] = { id: campNueva, name: (E.campanasNuevas[a.campaign_key] || {}).name || a.name };
  E.ajustesPendientes.forEach(x => { if (x.id === vieja) x.id = campNueva; });
  E.copiaProfunda[a.campaign_key] = nuevo;
  const sobran = objs.filter(o => String(o.copied_id) !== nuevo && String(o.copied_id) !== campNueva);
  const orden = sobran.filter(o => /^ad$/i.test(String(o.ad_object_type || ''))).concat(sobran.filter(o => !/^ad$/i.test(String(o.ad_object_type || ''))));
  let borrados = 0;
  for (let i = 0; i < orden.length; i += 50) {
    const bloque = orden.slice(i, i + 50);
    try {
      const r = await gPost('', { include_headers: 'false', batch: bloque.map(o => ({ method: 'POST', relative_url: String(o.copied_id), body: 'status=DELETED' })) });
      (Array.isArray(r) ? r : []).forEach(x => { if (x && Number(x.code) === 200) borrados++; });
    } catch (e) {}
  }
  E.avisos.push('Conjunto "' + a.name + '": se creó por copia profunda de la campaña de referencia; se eliminaron ' + borrados + ' de ' + orden.length
    + ' objetos copiados que no forman parte del plan' + (borrados < orden.length ? ' (revisa en Ads Manager los que quedaron en pausa con "Copia" en el nombre)' : '') + '.');
  return nuevo;
}

/* ======================================================== anuncio (uno) */
async function crearAnuncio(ad){
  if (ad.adset_id && !E.idAdset[ad.adset_key]) E.idAdset[ad.adset_key] = String(ad.adset_id);
  const campanaDelAd = E.idCamp[ad.campaign_key] || E.idCamp[((f.adsets||[]).find(x=>x.adset_key===ad.adset_key)||{}).campaign_key] || ad.campaign_id || campExistente || '';
  if (E.conjuntosFallidos[ad.adset_key] || !E.idAdset[ad.adset_key]) {
    E.fallos.push('Anuncio "' + ad.name + '": no se creó porque su conjunto falló.');
    return;
  }
  const esPost = ad.creative_type === 'EXISTING_POST';
  const refs = esPost ? [] : [ad.asset_ref, ad.asset_ref_9x16, ad.asset_ref_191x1].filter(Boolean);
  const malo = refs.find(r => E.fallidosAsset[r]);
  if (!esPost && (malo || !E.subidos[ad.asset_ref])) {
    const motivo = malo ? E.fallidosAsset[malo] : 'el creativo no se cargó';
    E.fallos.push('Anuncio "' + ad.name + '": no se creó porque su creativo falló (' + motivo + ').');
    E.bitacora.push(filaBitacora({ campana: val.campana, campaign_id: campanaDelAd, adset_id: E.idAdset[ad.adset_key] || '', anuncio: ad.name, estado: 'ERROR', error: 'Creativo: ' + motivo }));
    return;
  }
  try {
    const previosAd = E.conjuntosNuevos[ad.adset_key] ? {} : await anunciosDelLote(String(E.idAdset[ad.adset_key]));
    if (previosAd[ad.name]) {
      E.omitidos++; E.adsPorConjunto[ad.adset_key] = (E.adsPorConjunto[ad.adset_key] || 0) + 1;
      return;
    }
    let intentos = armarCreativos(ad);
    let cre = null, r = null, avisoAd = '', primerError = null, nivelUsado = '';
    for (let j = 0; j < intentos.length; j++) {
      const it = intentos[j];
      try {
        cre = await creativoReutilizable(it.pc);
        r = await crear(act + '/ads', {
          name: ad.name, adset_id: E.idAdset[ad.adset_key],
          creative: { creative_id: cre }, status: 'PAUSED',
          tracking_specs: seguimiento(ad),
        });
        nivelUsado = it.nivel;
        break;
      } catch (e) {
        const msg = String(e.message || '') + ' ' + String(e.tecnico || '');
        /* Cuenta de Instagram no vinculada: se reintenta sin ella (Meta usa el perfil de la página). */
        if (!E.sinIG && E.igId && /instagram/i.test(msg)) {
          E.sinIG = true; E.avisos.push('La cuenta de Instagram no aceptó los anuncios; se publicaron con el perfil respaldado por la página.');
          intentos = armarCreativos(ad); j--; continue;
        }
        /* Mejoras automáticas apagadas: si Meta no acepta la lista, se publica con las de Meta. */
        if (!E.sinMejorasSpec && it.pc.degrees_of_freedom_spec && /degrees_of_freedom|creative_features|enroll_status/i.test(msg + ' ' + (e.campos || []).join(' '))) {
          E.sinMejorasSpec = true;
          E.avisos.push('Meta no aceptó apagar las mejoras automáticas de Advantage+ creative (' + explicar(e) + '); los anuncios siguientes salen con las que Meta aplica por defecto. Revísalas en Ads Manager.');
          intentos = armarCreativos(ad); j--; continue;
        }
        if (!primerError) primerError = e;
        /* Un formato enriquecido que Meta rechaza dos veces en la corrida ya no se intenta. */
        if (it.nivel !== 'clasico' && !e.transitorio) {
          E.rechazosNivel = E.rechazosNivel || {};
          E.rechazosNivel[it.nivel] = (E.rechazosNivel[it.nivel] || 0) + 1;
        }
        if (j === intentos.length - 1) {
          if (j > 0 && explicar(primerError) !== explicar(e)) e.message = e.message + ' (antes, con varias opciones de texto o tamaños: ' + explicar(primerError) + ')';
          throw e;
        }
      }
    }
    const pedido = intentos.pedido || (intentos[0] ? intentos[0].nivel : 'clasico');
    if (nivelUsado !== pedido) {
      avisoAd = 'AVISO: ' + (primerError ? 'Meta rechazó ' + NOMBRE_NIVEL[pedido] + ' (' + explicar(primerError) + ')' : 'en esta corrida Meta ya había rechazado ' + NOMBRE_NIVEL[pedido])
        + '; se publicó con ' + NOMBRE_NIVEL[nivelUsado] + '.';
      if (String(ad.destino || '').toUpperCase() === 'FORMULARIO') E.formSinRico = true;
    }
    if (nivelUsado === 'ubicacion' && intentos.some(x => x.multiTexto)) {
      avisoAd = avisoAd || 'AVISO: salió con imágenes por ubicación y el primer texto.';
      if (!E.avisoUbicTextos) { E.avisoUbicTextos = true;
        E.avisos.push('Los anuncios con imágenes por ubicación salieron con el primer texto y título: Meta no combina varias opciones de texto con imágenes por ubicación en el mismo anuncio. Si prefieres las opciones de texto, quita las versiones de Stories y columna del creativo.'); }
    }
    E.nAds++;
    E.adsPorConjunto[ad.adset_key] = (E.adsPorConjunto[ad.adset_key] || 0) + 1;
    E.bitacora.push(filaBitacora({ campana: val.campana, campaign_id: campanaDelAd, adset_id: E.idAdset[ad.adset_key],
      ad_id: String(r.id), creative_id: String(cre), anuncio: ad.name, error: avisoAd }));
    if (avisoAd && primerError) E.avisos.push('Anuncio "' + ad.name + '": ' + avisoAd.replace(/^AVISO: /, ''));
  } catch (e) {
    E.fallos.push('Anuncio "' + ad.name + '": ' + explicar(e));
    E.bitacora.push(filaBitacora({ campana: val.campana, campaign_id: campanaDelAd, adset_id: E.idAdset[ad.adset_key] || '',
      anuncio: ad.name, estado: 'ERROR', error: explicar(e) }));
  }
}
/* Un creativo idéntico (mismo anuncio en varios conjuntos) se crea una sola vez. */
async function creativoReutilizable(pc){
  const clave = JSON.stringify(pc);
  if (E.creativos[clave]) return E.creativos[clave];
  const cre = await gPost(act + '/adcreatives', pc);
  if (!cre.id) throw new Error('Meta no devolvió el ID del creativo.');
  E.creativos[clave] = String(cre.id);
  return String(cre.id);
}
function seguimiento(ad){
  const t = [];
  if (ad.tracking_pixel_id)   t.push({ 'action.type': ['offsite_conversion'], fb_pixel: [String(ad.tracking_pixel_id)] });
  if (ad.tracking_dataset_id) t.push({ 'action.type': ['offline_conversion'], dataset: [String(ad.tracking_dataset_id)] });
  /* Los leads del formulario los rastrea Meta por defecto: no hace falta declararlos. */
  return t.length ? t : null;
}
function specMejoras(ad){
  if (E.sinMejorasSpec || String(ad.mejoras || '').toUpperCase() !== 'OFF') return null;
  const claves = MEJORAS_COMUNES.concat(String(ad.creative_type).toUpperCase() === 'VIDEO' ? MEJORAS_VIDEO : MEJORAS_IMAGEN);
  const cfs = {}; claves.forEach(k => { cfs[k] = { enroll_status: 'OPT_OUT' }; });
  return { creative_features_spec: cfs };
}
/* Devuelve los creativos a intentar, del más rico al más simple (5.3):
   1 · "ubicacion": imágenes por ubicación (asset_feed_spec, optimization_type PLACEMENT) con un texto.
   2 · "textos": varias opciones de texto y título (asset_feed_spec, optimization_type
       DEGREES_OF_FREEDOM). Sin optimization_type, Meta trata el asset_feed_spec como
       creativo dinámico, que solo se admite en conjuntos marcados como dinámicos.
   3 · "clasico": object_story_spec con el primer texto y la imagen de feed.
   Cada nivel que Meta rechaza dos veces en la corrida deja de intentarse. */
function armarCreativos(ad){
  const tipo = String(ad.creative_type).toUpperCase();
  /* Publicación existente (5.1): conserva comentarios y reacciones.
     Facebook → object_story_id. Instagram → source_instagram_media_id con la
     cuenta de Instagram y, si el anuncio trae URL, un botón al sitio. */
  if (tipo === 'EXISTING_POST') {
    if (String(ad.post_origen || '').toUpperCase() === 'INSTAGRAM') {
      if (!E.igId || E.sinIG) throw new Error('La publicación es de Instagram y la página no tiene una cuenta de Instagram conectada que Meta acepte.');
      const pc = { name: ad.name, object_id: pageId, instagram_user_id: E.igId, source_instagram_media_id: String(ad.post_id) };
      if (ad.link_url && ad.cta_type) pc.call_to_action = { type: String(ad.cta_type).toUpperCase(), value: { link: ad.link_url } };
      if (ad.url_tags) pc.url_tags = ad.url_tags;
      return [{ nivel: 'post', pc }];
    }
    const pid = String(ad.post_id);
    const pc = { name: ad.name, object_story_id: pid.indexOf('_') > 0 ? pid : pageId + '_' + pid };
    if (ad.url_tags) pc.url_tags = ad.url_tags;
    return [{ nivel: 'post', pc }];
  }
  const destino = String(ad.destino || '').toUpperCase();
  const aWhatsApp = destino === 'WHATSAPP';
  const aFormulario = destino === 'FORMULARIO';
  const LINK_FORM = 'http://fb.me/';
  const formId = String(ad.lead_form_id || '');
  let enlace = ad.link_url;
  let cta = ad.cta_type ? { type: String(ad.cta_type).toUpperCase(), value: { link: ad.link_url } } : null;
  if (aWhatsApp) { cta = { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } }; enlace = 'https://api.whatsapp.com/send'; }
  if (aFormulario) {
    const tipoCta = ['WHATSAPP_MESSAGE'].indexOf(String(ad.cta_type).toUpperCase()) >= 0 || !ad.cta_type ? 'SIGN_UP' : String(ad.cta_type).toUpperCase();
    cta = { type: tipoCta, value: { lead_gen_form_id: formId } }; enlace = LINK_FORM;
  }
  /* Saludo y mensaje prellenado de WhatsApp (page_welcome_message). */
  let bienvenida = null;
  const preguntas = String(ad.whatsapp_icebreakers || '').split(' || ').map(x => x.trim()).filter(Boolean).slice(0, 4);
  const secuencia = aWhatsApp ? String(ad.whatsapp_sequence_id || '') : '';
  if (aWhatsApp && !secuencia && preguntas.length) {
    bienvenida = { type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
      text_format: { customer_action_type: 'ice_breakers', message: {
        text: String(ad.whatsapp_greeting || '¡Hola! ¿Cómo podemos ayudarte?'),
        ice_breakers: preguntas.map(t => ({ title: t })) } } };
  } else if (aWhatsApp && !secuencia && (ad.whatsapp_greeting || ad.whatsapp_autofill)) {
    bienvenida = { type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
      text_format: { customer_action_type: 'autofill_message', message: {
        text: String(ad.whatsapp_greeting || '¡Hola! ¿Cómo podemos ayudarte?'),
        autofill_message: { content: String(ad.whatsapp_autofill || 'Hola, quiero más información.') } } } };
  }
  const textos  = String(ad.primary_texts || ad.primary_text || '').split(' || ').map(s => s.trim()).filter(Boolean).slice(0, 5);
  const titulos = String(ad.headlines || ad.headline || '').split(' || ').map(s => s.trim()).filter(Boolean).slice(0, 5);
  const descripcion = String(ad.description || '').trim();
  const s = E.subidos[ad.asset_ref];
  const s916  = (tipo === 'IMAGE' && ad.asset_ref_9x16)  ? E.subidos[ad.asset_ref_9x16]  : null;
  const s1911 = (tipo === 'IMAGE' && ad.asset_ref_191x1) ? E.subidos[ad.asset_ref_191x1] : null;
  const multiTexto = textos.length > 1 || titulos.length > 1;
  const specBase = () => { const x = { page_id: pageId }; if (E.igId && !E.sinIG) x.instagram_user_id = E.igId; return x; };
  const mejoras = specMejoras(ad);
  const conExtras = (pc) => {
    if (secuencia) pc.asset_feed_spec = Object.assign({}, pc.asset_feed_spec || {}, { additional_data: { partner_app_welcome_message_flow_id: secuencia } });
    if (ad.url_tags && !aFormulario) pc.url_tags = ad.url_tags;
    if (mejoras) pc.degrees_of_freedom_spec = mejoras;
    return pc;
  };

  /* clásico: un texto, una imagen o video */
  const clasico = () => {
    const spec = specBase();
    if (tipo === 'VIDEO') {
      const ctaV = aWhatsApp ? { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP', link: 'https://api.whatsapp.com/send' } }
        : aFormulario ? { type: cta.type, value: { lead_gen_form_id: formId, link: LINK_FORM } } : cta;
      spec.video_data = { video_id: s.video, message: textos[0] || '', title: titulos[0] || '', link_description: descripcion, call_to_action: ctaV };
      if (bienvenida) spec.video_data.page_welcome_message = JSON.stringify(bienvenida);
      if (s.thumb) spec.video_data.image_url = s.thumb;
    } else {
      spec.link_data = { image_hash: s.hash, link: enlace, message: textos[0] || '', name: titulos[0] || '', description: descripcion, call_to_action: cta };
      if (bienvenida) spec.link_data.page_welcome_message = JSON.stringify(bienvenida);
      if (ad.display_link && !aFormulario) spec.link_data.caption = ad.display_link;
    }
    return conExtras({ name: ad.name, object_story_spec: spec });
  };

  const salida = [];
  const rechazado = n => ((E.rechazosNivel || {})[n] || 0) >= 2;
  /* Si Meta ya rechazó en esta corrida el formato enriquecido con formulario, no se insiste. */
  /* Un video a WhatsApp con saludo propio no tiene dónde llevar el saludo en el formato enriquecido:
     sale en el formato clásico, que sí lo conserva. */
  const videoConSaludo = aWhatsApp && bienvenida && tipo === 'VIDEO';
  if (videoConSaludo && multiTexto && !E.avisoVideoSaludo) { E.avisoVideoSaludo = true;
    E.avisos.push('Los videos que van a WhatsApp con saludo o preguntas frecuentes salen con el primer texto y título: Meta no admite el saludo junto con varias opciones de texto en video.'); }
  const sinRico = (aFormulario && E.formSinRico) || videoConSaludo;

  const adsetDe = (f.adsets || []).find(x => x.adset_key === ad.adset_key) || {};
  const propias = lista(adsetDe.publisher_platforms);
  /* Con ubicaciones Advantage+ (sin plataformas fijas) la última regla cubre todas las apps de Meta. */
  const plataformas = propias.length ? propias : ['facebook', 'instagram', 'audience_network', 'messenger'];
  const conIG = plataformas.indexOf('instagram') >= 0, conFB = plataformas.indexOf('facebook') >= 0;
  /* object_story_spec del formato enriquecido: página, Instagram y el enlace de destino
     (Meta rechaza un object_story_spec sin enlace cuando hay asset_feed_spec de imagen). */
  const specRico = () => {
    const spec = specBase();
    /* El saludo de WhatsApp va dentro de link_data, como texto JSON (documentación de Click to WhatsApp). */
    if (tipo !== 'VIDEO') { spec.link_data = { link: enlace }; if (bienvenida) spec.link_data.page_welcome_message = JSON.stringify(bienvenida); }
    return spec;
  };
  const feedBase = (varios) => {
    const fs_ = {
      ad_formats: [tipo === 'VIDEO' ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
      bodies: (varios ? textos : textos.slice(0, 1)).map(t => ({ text: t })),
      titles: (varios ? titulos : titulos.slice(0, 1)).map(t => ({ text: t })),
      link_urls: [{ website_url: enlace }],
      call_to_action_types: cta ? [cta.type] : [],
    };
    if (aFormulario) fs_.call_to_actions = [{ type: cta.type, value: { lead_gen_form_id: formId } }];
    if (descripcion) fs_.descriptions = [{ text: descripcion }];
    return fs_;
  };

  /* 1 · imágenes por ubicación */
  if ((s916 || s1911) && !sinRico && !rechazado('ubicacion')) {
    const feedSpec = feedBase(false);
    feedSpec.optimization_type = 'PLACEMENT';
    feedSpec.images = [{ hash: s.hash, adlabels: [{ name: 'img_feed' }] }];
    const reglas = []; let prio = 1;
    if (s916) {
      feedSpec.images.push({ hash: s916.hash, adlabels: [{ name: 'img_9x16' }] });
      const cs = { publisher_platforms: [] };
      if (conFB) { cs.publisher_platforms.push('facebook');  cs.facebook_positions  = ['story', 'facebook_reels']; }
      if (conIG) { cs.publisher_platforms.push('instagram'); cs.instagram_positions = ['story', 'reels']; }
      if (cs.publisher_platforms.length) reglas.push({ customization_spec: cs, image_label: { name: 'img_9x16' }, priority: prio++ });
    }
    if (s1911 && conFB) {
      feedSpec.images.push({ hash: s1911.hash, adlabels: [{ name: 'img_191x1' }] });
      reglas.push({ customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['right_hand_column', 'search'] },
                    image_label: { name: 'img_191x1' }, priority: prio++ });
    }
    reglas.push({ customization_spec: { publisher_platforms: plataformas }, image_label: { name: 'img_feed' }, priority: prio++ });
    feedSpec.asset_customization_rules = reglas;
    if (reglas.length > 1) salida.push({ nivel: 'ubicacion', multiTexto, pc: conExtras({ name: ad.name, object_story_spec: specRico(), asset_feed_spec: feedSpec }) });
  }
  /* 2 · varias opciones de texto (Advantage+ creative, DEGREES_OF_FREEDOM) */
  if (multiTexto && !sinRico && !rechazado('textos')) {
    const feedSpec = feedBase(true);
    feedSpec.optimization_type = 'DEGREES_OF_FREEDOM';
    if (tipo === 'VIDEO') feedSpec.videos = [{ video_id: s.video, thumbnail_url: s.thumb || undefined }];
    else feedSpec.images = [{ hash: s.hash }];
    salida.push({ nivel: 'textos', multiTexto, pc: conExtras({ name: ad.name, object_story_spec: specRico(), asset_feed_spec: feedSpec }) });
  }
  /* 3 · clásico (siempre, como respaldo) */
  salida.push({ nivel: 'clasico', multiTexto, pc: clasico() });
  /* Lo que el anuncio pidió (para el aviso cuando se usa un respaldo). */
  const pedido = videoConSaludo ? 'clasico' : (s916 || s1911) ? 'ubicacion' : (multiTexto ? 'textos' : 'clasico');
  salida.pedido = pedido;
  return salida;
}
