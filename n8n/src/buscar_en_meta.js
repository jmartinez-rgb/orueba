/* ---- motor 5.5 · buscadores ---- */
const b = $('Recibir').first().json.body || {};
const tipo = b.tipo;
const texto = String(b.texto || '').trim();
const pais = String(b.pais || '').toUpperCase();

async function actDe(){
  if (b.cuenta_id) return 'act_' + String(b.cuenta_id).replace(/^act_/, '');
  const crudas = await todasLasCuentas('account_id,name,account_status');
  const c = resolverCuenta(crudas, null, b.client_key);
  if (!c) throw new Error('El system user ya no tiene acceso a la cuenta ' + b.client_key + '.');
  return 'act_' + String(c.account_id).replace(/^act_/, '');
}
async function paginar(url, tope){
  const out = [];
  let u = url;
  for (let i = 0; i < 10 && u && out.length < tope; i++){
    const r = await gGet(u);
    (r.data || []).forEach(x => out.push(x));
    u = (r.paging && r.paging.next) ? r.paging.next : null;
  }
  return out.slice(0, tope);
}

let resultados = [];

/* Clave de un número para agrupar variantes: solo dígitos y, en México,
   sin el "1" de móvil que algunas fuentes incluyen (+52 1 81… = +52 81…). */
function claveNumero(v){
  let dg = String(v || '').replace(/[^0-9]/g, '');
  if (/^521\d{10}$/.test(dg)) dg = '52' + dg.slice(3);
  return dg.length >= 8 ? dg : '';
}
function bonito(v){
  const s = String(v || '').trim(); if (/\s/.test(s)) return s;
  const d = s.replace(/[^0-9]/g, '');
  if (/^521\d{10}$/.test(d)) return d.replace(/^(\d{2})(\d)(\d{2})(\d{4})(\d{4})$/, '+$1 $2 $3 $4 $5');
  if (/^\d{12}$/.test(d)) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/, '+$1 $2 $3 $4');
  if (/^1\d{10}$/.test(d)) return d.replace(/^(\d)(\d{3})(\d{3})(\d{4})$/, '+$1 $2-$3-$4');
  return '+' + d;
}
/* WhatsApp Business accesibles para el token. Se revisan TODOS los Business
   relevantes: el dueño de la cuenta publicitaria (por ejemplo, el del cliente) y
   los del propio system user (el de la agencia), porque una WABA compartida con
   la agencia aparece ahí como "de cliente". Cada fuente deja su error en el
   diagnóstico en lugar de fallar en silencio. */
async function wabasAccesibles(acc, diag){
  const negocios = {}, wabas = {};
  diag.negocios = []; diag.erroresWaba = []; diag.permisos = null;
  try { const info = await gGet(base + acc + '?fields=business{id,name}'); if (info.business) negocios[info.business.id] = info.business.name || 'dueño de la cuenta'; }
  catch (e) { diag.erroresWaba.push('Business de la cuenta: ' + explicar(e)); }
  try { (await paginar(base + 'me/businesses?fields=id,name&limit=50', 100)).forEach(x => { negocios[x.id] = x.name || x.id; }); }
  catch (e) { diag.erroresWaba.push('Business del token: ' + explicar(e)); }
  try {
    const pr = await gGet(base + 'me/permissions');
    const otorgados = (pr.data || []).filter(x => x.status === 'granted').map(x => x.permission);
    diag.permisos = otorgados;
    diag.faltaPermisoWA = otorgados.length > 0 && otorgados.indexOf('whatsapp_business_management') < 0;
  } catch (e) { /* algunos tokens no exponen /me/permissions; no es bloqueante */ }
  for (const bid of Object.keys(negocios)) {
    diag.negocios.push(negocios[bid]);
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try {
        (await paginar(base + bid + '/' + edge + '?fields=id,name&limit=50', 100)).forEach(w => { wabas[w.id] = w.name || w.id; });
      } catch (e) { diag.erroresWaba.push(negocios[bid] + ' (' + (edge.indexOf('owned') === 0 ? 'propias' : 'de clientes') + '): ' + explicar(e)); }
    }
  }
  diag.wabas = Object.keys(wabas).length;
  diag.nombresWaba = Object.keys(wabas).map(k => wabas[k]);
  return Object.keys(wabas).map(id => ({ id, name: wabas[id] }));
}
/* Destino de un conjunto en el vocabulario del sitio. */
function destinoDe(dt){
  const d = String(dt || '').toUpperCase();
  if (/WHATSAPP/.test(d)) return 'WHATSAPP';
  if (d === 'ON_AD') return 'FORMULARIO';
  return 'WEBSITE';
}
/* Configuración reutilizable de un conjunto (lo que Meta ya aceptó). */
function configDe(a, COMUNES){
  const camp = a.campaign || {};
  const goal = String(a.optimization_goal || '').toUpperCase(), po = a.promoted_object || {};
  /* Puntaje: prioriza lo que realmente optimiza por compras (no cualquier cosa "no común"). */
  const puntaje = (/PURCHASE/.test(goal) ? 4 : 0) + (String(po.custom_event_type || '').toUpperCase() === 'PURCHASE' ? 2 : 0)
    + (COMUNES.indexOf(goal) < 0 ? 1 : 0) + (/PAUSED|ACTIVE/.test(String(a.effective_status || '')) ? 0.5 : 0);
  return { id: String(a.id), n: a.name || String(a.id), puntaje,
    campanaId: String(camp.id || ''), cuenta: String(a.account_id || ''), estado: a.effective_status || '',
    compras: COMUNES.indexOf(goal) < 0,
    objetivo: camp.objective || '',
    r: (camp.objective || '') + ' · ' + (a.optimization_goal || '') + ' · ' + (a.destination_type || '') + ' · campaña "' + (camp.name || '') + '"',
    config: { optimization_goal: a.optimization_goal || '', destination_type: a.destination_type || '', billing_event: a.billing_event || '',
      optimization_sub_event: a.optimization_sub_event || '', promoted_object: a.promoted_object || {}, attribution_spec: a.attribution_spec || null } };
}
/* Conjuntos de WhatsApp de la cuenta (los más recientes). */
async function conjuntosWhatsApp(acc){
  const todos = await paginar(base + acc + '/adsets?fields=id,name,destination_type,promoted_object,updated_time&limit=100', 500);
  return todos.filter(a => /WHATSAPP/.test(String(a.destination_type || '').toUpperCase())
    || (a.promoted_object && a.promoted_object.whatsapp_phone_number));
}
try {
  if (tipo === 'paises') {
    const r = await gGet(base + 'search?type=adgeolocation&location_types=["country"]&limit=20&q='
      + encodeURIComponent(texto));
    resultados = (r.data || []).map(d => ({ id: String(d.country_code), n: d.name, r: 'País' }));

  } else if (tipo === 'regiones') {
    let u = base + 'search?type=adgeolocation&location_types=["region"]&limit=25&q='
      + encodeURIComponent(texto);
    if (pais) u += '&country_code=' + encodeURIComponent(pais);
    const r = await gGet(u);
    resultados = (r.data || []).map(d => ({
      id: String(d.key), n: d.name, r: d.country_name || pais, cc: d.country_code || pais,
    }));

  } else if (tipo === 'ciudades') {
    let u = base + 'search?type=adgeolocation&location_types=["city"]&limit=12&q='
      + encodeURIComponent(texto);
    if (pais) u += '&country_code=' + encodeURIComponent(pais);
    const r = await gGet(u);
    resultados = (r.data || []).map(d => ({
      id: String(d.key), n: d.name,
      r: [d.region, d.country_name].filter(Boolean).join(', '),
      cc: String(d.country_code || ''),
      region_key: d.region_id ? String(d.region_id) : '',
    }));

  } else if (tipo === 'intereses') {
    const r = await gGet(base + 'search?type=adinterest&limit=8&q=' + encodeURIComponent(texto));
    resultados = (r.data || []).map(d => ({
      id: String(d.id), n: d.name,
      r: 'Intereses · ' + Number(d.audience_size_upper_bound || 0).toLocaleString('es-MX') + ' personas',
    }));

  } else if (tipo === 'paginas') {
    const acc = await actDe();
    const vistas = {};
    const sumar = (arr) => (arr || []).forEach(x => {
      if (x && x.id && !vistas[String(x.id)]) {
        vistas[String(x.id)] = { id: String(x.id), n: x.name || String(x.id), r: x.link || '' };
      }
    });

    /* 1 · Páginas del perfil / system user. Es la fuente principal: en
       estructuras de agencia la página cuelga del Business, no de la cuenta. */
    try { sumar(await paginar(base + 'me/accounts?fields=id,name,link&limit=100', 200)); } catch (e) {}

    /* 2 · Páginas del Business dueño de la cuenta: propias y de clientes. */
    try {
      const info = await gGet(base + acc + '?fields=business{id,name}');
      const bid = info.business && info.business.id;
      if (bid) {
        try { sumar(await paginar(base + bid + '/owned_pages?fields=id,name,link&limit=100', 200)); } catch (e) {}
        try { sumar(await paginar(base + bid + '/client_pages?fields=id,name,link&limit=100', 200)); } catch (e) {}
      }
    } catch (e) {}

    /* 3 · Respaldo: lo que la cuenta publicitaria declara promocionable. */
    try { sumar(await paginar(base + acc + '/promote_pages?fields=id,name,link&limit=100', 200)); } catch (e) {}

    resultados = Object.keys(vistas).map(k => vistas[k])
      .sort((x, y) => String(x.n).localeCompare(String(y.n), 'es'));

    if (!resultados.length) {
      throw new Error('No encontré ninguna página de Facebook accesible con este token. '
        + 'Revisa que el system user tenga la página asignada en Business Manager y que el '
        + 'token incluya pages_show_list y business_management.');
    }

  } else if (tipo === 'campanas') {
    const acc = await actDe();
    const q = texto.toLowerCase();
    let moneda = '';
    try { const ai = await gGet(base + acc + '?fields=currency'); moneda = ai.currency || ''; } catch (e) {}
    let u = base + acc + '/campaigns?fields=id,name,objective,effective_status,daily_budget,'
      + 'lifetime_budget,special_ad_categories,updated_time,insights.date_preset(last_30d){spend}&limit=100&effective_status=["ACTIVE","PAUSED"]';
    if (texto) u += '&filtering=' + encodeURIComponent(JSON.stringify(
      [{ field: 'name', operator: 'CONTAIN', value: texto }]));
    const datos = await paginar(u, 200);
    resultados = datos
      .filter(d => !q || String(d.name).toLowerCase().indexOf(q) >= 0)
      .slice(0, 50)
      .map(d => ({
        id: String(d.id), n: d.name,
        r: d.objective + ' · ' + d.effective_status,
        objetivo: d.objective,
        categorias: (d.special_ad_categories || []).filter(x => x && x !== 'NONE'),
        cbo: !!(d.daily_budget || d.lifetime_budget),
        daily: aMayor(d.daily_budget, moneda), lifetime: aMayor(d.lifetime_budget, moneda),
        estado: d.effective_status || '', moneda,
        gasto30: Number((d.insights && d.insights.data && d.insights.data[0] && d.insights.data[0].spend) || 0),
        actualizada: d.updated_time || '',
      }));

  } else if (tipo === 'importar') {
    /* Lee campañas completas de una cuenta de origen y las devuelve en un paquete
       listo para la cuenta de destino. Meta no copia entre cuentas: todo lo que
       pertenece a la cuenta de origen se traduce o se reporta.
         · imágenes  → URL de la imagen en origen (el motor la vuelve a subir)
         · videos    → URL de la fuente del video
         · públicos  → se buscan por nombre en destino; si no existen, se quitan
         · moneda    → presupuestos y pujas solo si ambas cuentas usan la misma
       Se procesan hasta 3 campañas por llamada para no exceder el tiempo del proxy. */
    const origenId = String(b.origen_cuenta_id || '').replace(/^act_/, '');
    const actOrigen = 'act_' + origenId;
    const actDestino = await actDe();
    const cids = lista(b.campaign_ids).slice(0, 3);
    if (!origenId || !cids.length) throw new Error('Falta la cuenta de origen o las campañas a traer.');
    const [infoO, infoD] = await Promise.all([
      gGet(base + actOrigen + '?fields=currency,name'),
      gGet(base + actDestino + '?fields=currency,name'),
    ]);
    const monO = infoO.currency, monD = infoD.currency, mismaMoneda = monO === monD;
    const avisosImp = [];
    const paquete = { formato: 'mbe-export', version: 1, exportado: new Date().toISOString(),
      origen: { cuenta: origenId, nombre: infoO.name || '', moneda: monO },
      destino: { cuenta: actDestino.replace('act_', ''), nombre: infoD.name || '', moneda: monD },
      campanas: [], avisos: avisosImp };

    /* Públicos de destino, para traducir por nombre. */
    let audDestino = [];
    try { audDestino = await paginar(base + actDestino + '/customaudiences?fields=id,name&limit=200', 3000); } catch (e) {}
    const audPorNombre = {};
    audDestino.forEach(a => { audPorNombre[String(a.name || '').trim().toLowerCase()] = String(a.id); });
    const mismaCuenta = origenId === actDestino.replace('act_', '');
    const traducirPublicos = (arr, et) => (arr || []).map(x => {
      if (mismaCuenta) return { id: String(x.id), name: x.name };
      const dest = audPorNombre[String(x.name || '').trim().toLowerCase()];
      if (dest) return { id: dest, name: x.name };
      avisosImp.push(et + ': el público "' + (x.name || x.id) + '" no existe en la cuenta de destino y se quitó de la segmentación.');
      return null;
    }).filter(Boolean);

    const parseBienvenida = (pwm) => {
      if (typeof pwm === 'string') { try { pwm = JSON.parse(pwm); } catch (e) { pwm = null; } }
      const m = (pwm && pwm.text_format && pwm.text_format.message) || {};
      return { saludo: String(m.text || ''), prellenado: String((m.autofill_message && m.autofill_message.content) || ''),
               preguntas: (m.ice_breakers || []).map(q => String(q.title || '')).filter(Boolean) };
    };
    const hashes = {}, videos = {};
    const leerCreativo = (ad, et) => {
      const cr = ad.creative || {}, oss = cr.object_story_spec, afs = cr.asset_feed_spec || {};
      const nombre = 'Anuncio "' + ad.name + '" (' + et + ')';
      if (!oss) { avisosImp.push(nombre + ': usa una publicación existente de la página de origen y no se puede reutilizar en otra cuenta. No se importó.'); return null; }
      const ld = oss.link_data || null, vd = oss.video_data || null;
      if ((ld && ld.child_attachments) || (afs.ad_formats || []).some(f => /CAROUSEL|COLLECTION/.test(f)) || oss.template_data) {
        avisosImp.push(nombre + ': es carrusel, colección o de catálogo, formatos que la herramienta aún no crea. No se importó.'); return null;
      }
      const cta = (afs.call_to_action_types && afs.call_to_action_types[0]) || ((ld || vd || {}).call_to_action || {}).type || 'LEARN_MORE';
      const formulario = String((((ld || vd || {}).call_to_action || {}).value || {}).lead_gen_form_id
        || (((afs.call_to_actions || [])[0] || {}).value || {}).lead_gen_form_id || '');
      const out = {
        nombre: ad.name,
        textos: (afs.bodies || []).map(x => x.text).filter(Boolean),
        titulos: (afs.titles || []).map(x => x.text).filter(Boolean),
        descripcion: ((afs.descriptions || [])[0] || {}).text || (ld && ld.description) || (vd && vd.link_description) || '',
        url: ((afs.link_urls || [])[0] || {}).website_url || (ld && ld.link) || (((vd || {}).call_to_action || {}).value || {}).link || '',
        cta, whatsapp: cta === 'WHATSAPP_MESSAGE', formulario,
        url_tags: ad.url_tags || cr.url_tags || '',
        secuencia: String(((afs.additional_data || {}).partner_app_welcome_message_flow_id) || ''),
        media: {},
      };
      if (!out.textos.length) out.textos = [ (ld && ld.message) || (vd && vd.message) || '' ].filter(Boolean);
      if (!out.titulos.length) out.titulos = [ (ld && ld.name) || (vd && vd.title) || '' ].filter(Boolean);
      Object.assign(out, parseBienvenida((ld || vd || {}).page_welcome_message || oss.page_welcome_message));
      if (out.whatsapp || out.formulario) out.url = '';
      if (out.formulario && !mismaCuenta) avisosImp.push(nombre + ': usa el formulario ' + out.formulario + ' de su página. Si publicas con otra página, elige un formulario de esa página en el paso de anuncios.');
      const vid = (vd && vd.video_id) || ((afs.videos || [])[0] || {}).video_id;
      if (vid) { out.media = { tipo: 'VIDEO', video: String(vid) }; videos[String(vid)] = true; }
      else {
        const imgs = afs.images || [];
        const reglas = afs.asset_customization_rules || [];
        let feed = (ld && ld.image_hash) || '', vert = '', horiz = '';
        if (imgs.length) {
          const porEtiqueta = {}; imgs.forEach(im => (im.adlabels || []).forEach(l => { porEtiqueta[l.name] = im.hash; }));
          reglas.forEach(r => {
            const cs = r.customization_spec || {}, pos = [].concat(cs.facebook_positions || [], cs.instagram_positions || []);
            const h = porEtiqueta[(r.image_label || {}).name];
            if (!h) return;
            if (pos.some(x => /story|reels/.test(x))) vert = vert || h;
            else if (pos.some(x => /right_hand_column|search/.test(x))) horiz = horiz || h;
            else feed = feed || h;
          });
          feed = feed || imgs[0].hash;
        }
        if (!feed) { avisosImp.push(nombre + ': no pude identificar su imagen. No se importó.'); return null; }
        out.media = { tipo: 'IMAGE', feed, vert, horiz };
        [feed, vert, horiz].filter(Boolean).forEach(h => { hashes[h] = true; });
      }
      return out;
    };

    const camps = await porIds(cids, 'id,name,objective,special_ad_categories,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time,account_id,smart_promotion_type,is_adset_budget_sharing_enabled');
    for (const cid of cids) {
      const c = camps[cid];
      if (!c) { avisosImp.push('No pude leer la campaña ' + cid + '.'); continue; }
      if (String(c.account_id) !== origenId) { avisosImp.push('La campaña "' + c.name + '" no pertenece a la cuenta de origen.'); continue; }
      if (c.smart_promotion_type && c.smart_promotion_type !== 'GUIDED_CREATION') {
        avisosImp.push('La campaña "' + c.name + '" es Advantage+ (' + c.smart_promotion_type + ') y no se puede reconstruir con esta herramienta. No se importó.'); continue;
      }
      const conj = await paginar(base + cid + '/adsets?fields=id,name,optimization_goal,billing_event,destination_type,promoted_object,targeting,'
        + 'daily_budget,lifetime_budget,bid_amount,effective_status&limit=100', 200);
      const outC = {
        nombre: c.name, objetivo: c.objective,
        categorias: (c.special_ad_categories || []).filter(x => x && x !== 'NONE'),
        cbo: !!(c.daily_budget || c.lifetime_budget),
        diario: mismaMoneda ? aMayor(c.daily_budget, monO) : 0,
        total: mismaMoneda ? aMayor(c.lifetime_budget, monO) : 0,
        duracionDias: (c.start_time && c.stop_time) ? Math.max(1, Math.round((Date.parse(c.stop_time) - Date.parse(c.start_time)) / 86400000)) : 0,
        puja: mismaMoneda ? String(c.bid_strategy || '') : '',
        compartir: c.is_adset_budget_sharing_enabled === true,
        conjuntos: [],
      };
      if (!mismaMoneda && (c.daily_budget || c.lifetime_budget)) avisosImp.push('La campaña "' + c.name + '" está en ' + monO + ' y la cuenta de destino en ' + monD + ': el presupuesto quedó en blanco para capturarlo.');
      if (!mismaMoneda && /CAP|MIN_ROAS|TARGET_COST/.test(String(c.bid_strategy || ''))) avisosImp.push('La campaña "' + c.name + '" usa una puja con tope en otra moneda: se importa con costo más bajo.');
      const vivos = conj.filter(a => ['DELETED', 'ARCHIVED'].indexOf(a.effective_status) < 0);
      const conAds = vivos.length ? await porIds(vivos.map(a => a.id),
        'ads.limit(50){id,name,effective_status,url_tags,creative{object_story_spec,asset_feed_spec,object_story_id,url_tags}}') : {};
      for (const a of vivos) {
        const et = 'Conjunto "' + a.name + '"';
        const t = JSON.parse(JSON.stringify(a.targeting || {}));
        /* v26.0: se eliminaron Instagram Explorar y Messenger Stories; los Estados de
           WhatsApp exigen una identidad de WhatsApp en el creativo que esta
           herramienta no configura. Se quitan de la segmentación copiada. */
        const quitadas = [];
        const quitar = (campo, malos) => { if (!Array.isArray(t[campo])) return; const antes = t[campo].length;
          t[campo] = t[campo].filter(x => malos.indexOf(String(x)) < 0); if (t[campo].length < antes) quitadas.push(campo);
          if (!t[campo].length) delete t[campo]; };
        quitar('instagram_positions', ['explore', 'explore_home', 'ig_search']);
        quitar('messenger_positions', ['story']);
        quitar('publisher_platforms', ['whatsapp']);
        if (quitadas.length) avisosImp.push(et + ': se quitaron ubicaciones que Meta ya no admite o que requieren configuración adicional (' + quitadas.join(', ') + ').');
        ['custom_audiences', 'excluded_custom_audiences'].forEach(k => {
          if (t[k]) { t[k] = traducirPublicos(t[k], et); if (!t[k].length) delete t[k]; }
        });
        const po = a.promoted_object || {};
        /* Las conversiones personalizadas no existen en otra cuenta; OTHER no es un evento optimizable por sí solo. */
        const evento = (!po.custom_event_type || (po.custom_conversion_id && po.custom_event_type === 'OTHER')) ? (po.pixel_id || po.custom_conversion_id ? 'PURCHASE' : '') : po.custom_event_type;
        if (po.custom_conversion_id) avisosImp.push(et + ': optimizaba por una conversión personalizada de la cuenta de origen; se importa optimizando por el evento estándar ' + (evento || 'PURCHASE') + '. Revísalo.');
        const outK = {
          nombre: a.name, meta: a.optimization_goal,
          destino: destinoDe(a.destination_type),
          whatsapp: po.whatsapp_phone_number || '', evento,
          targeting: t,
          diario: mismaMoneda ? aMayor(a.daily_budget, monO) : 0,
          total: mismaMoneda ? aMayor(a.lifetime_budget, monO) : 0,
          pujaMonto: mismaMoneda ? aMayor(a.bid_amount, monO) : 0,
          anuncios: [],
        };
        (((conAds[a.id] || {}).ads || {}).data || []).forEach(ad => {
          if (['DELETED', 'ARCHIVED'].indexOf(ad.effective_status) >= 0) return;
          const r = leerCreativo(ad, a.name); if (r) outK.anuncios.push(r);
        });
        outC.conjuntos.push(outK);
      }
      paquete.campanas.push(outC);
    }

    /* URLs de imágenes y fuentes de video en la cuenta de origen. */
    const listaH = Object.keys(hashes), urls = {};
    for (let i = 0; i < listaH.length; i += 50) {
      try {
        const r = await gGet(base + actOrigen + '/adimages?hashes=' + encodeURIComponent(JSON.stringify(listaH.slice(i, i + 50))) + '&fields=hash,url,permalink_url,width,height');
        (r.data || []).forEach(x => { urls[x.hash] = x.permalink_url || x.url || ''; });
      } catch (e) {}
    }
    const listaV = Object.keys(videos), fuentesV = {};
    if (listaV.length) {
      try { const r = await porIds(listaV, 'source,picture'); Object.keys(r).forEach(k => { fuentesV[k] = r[k].source || ''; }); } catch (e) {}
    }
    paquete.campanas.forEach(c => c.conjuntos.forEach(k => k.anuncios.forEach(ad => {
      const m = ad.media;
      if (m.tipo === 'VIDEO') {
        m.url = fuentesV[m.video] || '';
        if (!m.url) avisosImp.push('Anuncio "' + ad.nombre + '": no pude obtener el archivo del video; vuelve a cargarlo en el paso de creativos.');
      } else {
        m.urlFeed = urls[m.feed] || ''; m.urlVert = urls[m.vert] || ''; m.urlHoriz = urls[m.horiz] || '';
        if (!m.urlFeed) avisosImp.push('Anuncio "' + ad.nombre + '": no pude obtener su imagen; vuelve a cargarla en el paso de creativos.');
      }
    })));
    return [{ json: paquete }];

  } else if (tipo === 'whatsapp') {
    /* Números de WhatsApp, de tres fuentes y en este orden de confianza:
       1. Conjuntos de WhatsApp ya publicados en la cuenta: el número está en el
          formato exacto que Meta aceptó, y se sabe con qué página se usó.
       2. WhatsApp Business del Business (propios y de clientes). Requiere el
          permiso whatsapp_business_management; sin él, esta fuente queda vacía.
       3. Campo whatsapp_number de la página (no documentado; intento adicional).
       Los números se agrupan por su clave normalizada: en México, +52 1 81… y
       +52 81… son el mismo número. */
    const acc = await actDe();
    const pid = String(b.page_id || '');
    const porClave = {};
    const sumar = (valor, fuente, extra) => {
      const clave = claveNumero(valor); if (!clave) return;
      const x = porClave[clave] || (porClave[clave] = { id: '', n: bonito(valor), fuentes: [], paginas: [], usos: 0, waba: '', ultimo: '' });
      if (fuente === 'ANUNCIOS' && !x.id) x.id = String(valor).trim();           /* el formato ya aceptado manda */
      if (x.fuentes.indexOf(fuente) < 0) x.fuentes.push(fuente);
      if (extra && extra.pagina && x.paginas.indexOf(extra.pagina) < 0) x.paginas.push(extra.pagina);
      if (extra && extra.waba) x.waba = extra.waba;
      if (extra && extra.usos) x.usos += extra.usos;
      if (extra && extra.ultimo && extra.ultimo > x.ultimo) x.ultimo = extra.ultimo;
    };
    const diag = { conjuntosRevisados: 0, conjuntosWhatsApp: 0, numerosEnAnuncios: 0, wabas: 0, errorWaba: '' };
    try {
      const todos = await paginar(base + acc + '/adsets?fields=id,name,destination_type,promoted_object,updated_time&limit=100', 500);
      diag.conjuntosRevisados = todos.length;
      const wa = todos.filter(a => /WHATSAPP/.test(String(a.destination_type || '').toUpperCase()) || (a.promoted_object && a.promoted_object.whatsapp_phone_number));
      diag.conjuntosWhatsApp = wa.length;
      wa.forEach(a => {
        const po = a.promoted_object || {};
        if (po.whatsapp_phone_number) sumar(po.whatsapp_phone_number, 'ANUNCIOS', { pagina: String(po.page_id || ''), usos: 1, ultimo: a.updated_time || '' });
      });
      /* Si el conjunto no guarda el número, se busca en sus anuncios: botón de WhatsApp o enlace wa.me / api.whatsapp.com. */
      const sinNumero = wa.filter(a => !(a.promoted_object || {}).whatsapp_phone_number).slice(0, 100);
      if (sinNumero.length) {
        const leidos = await porIds(sinNumero.map(a => a.id), 'promoted_object,ads.limit(5){creative{object_story_spec{page_id,link_data{link,call_to_action},video_data{call_to_action}}}}');
        Object.keys(leidos).forEach(id => ((leidos[id].ads && leidos[id].ads.data) || []).forEach(ad => {
          const oss = (ad.creative || {}).object_story_spec || {};
          const cta = ((oss.link_data || {}).call_to_action || (oss.video_data || {}).call_to_action || {});
          const v = cta.value || {};
          const enlace = String((oss.link_data || {}).link || v.link || '');
          const m = enlace.match(/(?:phone=|wa\.me\/)(\+?\d{8,15})/);
          const num = v.whatsapp_number || v.whatsapp_phone_number || (m && m[1]) || '';
          if (num) sumar(num, 'ANUNCIOS', { pagina: String(oss.page_id || (leidos[id].promoted_object || {}).page_id || ''), usos: 1 });
        }));
      }
    } catch (e) { diag.errorConjuntos = explicar(e); }
    for (const w of await wabasAccesibles(acc, diag)) {
      try {
        const nums = await paginar(base + w.id + '/phone_numbers?fields=display_phone_number,verified_name,code_verification_status,quality_rating&limit=50', 50);
        nums.forEach(x => sumar(x.display_phone_number, 'WABA', { waba: x.verified_name || w.name || '' }));
        if (!nums.length) diag.erroresWaba.push('La WABA "' + w.name + '" no tiene números registrados.');
      } catch (e) { diag.erroresWaba.push('Números de la WABA "' + w.name + '": ' + explicar(e)); }
    }
    if (pid) {
      try { const pg = await gGet(base + pid + '?fields=whatsapp_number'); if (pg.whatsapp_number) sumar(pg.whatsapp_number, 'PAGINA', { pagina: pid }); } catch (e) {}
    }
    resultados = Object.keys(porClave).map(k => {
      const x = porClave[k];
      if (!x.id) x.id = '+' + String(x.n).replace(/[^0-9]/g, '');
      const conEsta = pid && x.paginas.indexOf(pid) >= 0;
      x.grupo = conEsta ? 'ESTA_PAGINA' : (x.fuentes.indexOf('WABA') >= 0 ? 'WABA' : 'OTRA_PAGINA');
      x.r = conEsta ? ('usado en ' + x.usos + ' conjunto(s) con esta página')
          : x.fuentes.indexOf('WABA') >= 0 ? ('WhatsApp Business' + (x.waba ? ': ' + x.waba : ''))
          : ('usado con otra página');
      return x;
    }).sort((a, b) => ['ESTA_PAGINA','WABA','OTRA_PAGINA'].indexOf(a.grupo) - ['ESTA_PAGINA','WABA','OTRA_PAGINA'].indexOf(b.grupo) || b.usos - a.usos);
    diag.numerosEnAnuncios = resultados.filter(x => x.fuentes.indexOf('ANUNCIOS') >= 0).length;
    return [{ json: { resultados, diagnostico: diag } }];

  } else if (tipo === 'diagnostico_referencia') {
    /* Prueba real y reversible: lee la referencia, copia su campaña, copia el conjunto
       dentro, y si falla intenta la copia profunda. Informa cada paso con el error
       completo de Meta y elimina todo lo creado al terminar. */
    const acc = await actDe();
    const m = String(b.adset_id || '').match(/(\d{10,20})/);
    if (!m) throw new Error('Falta el ID del conjunto de referencia.');
    const ref = m[1], pasos = [], creados = [];
    const paso = (n, ok, detalle) => pasos.push({ paso: n, ok, detalle });
    let a = null;
    try {
      a = await gGet(base + ref + '?fields=' + encodeURIComponent('id,name,account_id,effective_status,optimization_goal,optimization_sub_event,destination_type,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,end_time,promoted_object,attribution_spec,created_time,campaign{id,name,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_categories,smart_promotion_type,stop_time,created_time}'));
      const c = a.campaign || {};
      paso('Leer la referencia', true, 'Conjunto "' + a.name + '" (' + a.effective_status + ') · optimización ' + a.optimization_goal + ' · destino ' + (a.destination_type || '—') + ' · facturación ' + (a.billing_event || '—')
        + ' · objeto promovido ' + JSON.stringify(a.promoted_object || {}) + ' · campaña "' + c.name + '": objetivo ' + c.objective + ', compra ' + (c.buying_type || '—') + ', puja ' + (c.bid_strategy || a.bid_strategy || '—')
        + ', presupuesto ' + (c.daily_budget ? 'de campaña diario' : c.lifetime_budget ? 'de campaña total' : 'por conjunto') + (c.smart_promotion_type ? ', tipo ' + c.smart_promotion_type : '') + ', categorías ' + JSON.stringify(c.special_ad_categories || []));
      if (String(a.account_id || '').replace('act_', '') !== acc.replace('act_', '')) paso('Misma cuenta', false, 'La referencia está en la cuenta ' + a.account_id + '; Meta solo copia dentro de la misma cuenta.');
      /* 5.5.1 · La configuración tal como la guarda Meta (para comparar con lo que se envía). */
      paso('Configuración guardada del conjunto', true, JSON.stringify({ optimization_goal: a.optimization_goal, optimization_sub_event: a.optimization_sub_event, destination_type: a.destination_type,
        billing_event: a.billing_event, bid_strategy: a.bid_strategy, promoted_object: a.promoted_object, attribution_spec: a.attribution_spec, creado: a.created_time,
        campana: { objective: c.objective, buying_type: c.buying_type, bid_strategy: c.bid_strategy, presupuesto: c.daily_budget ? 'diario de campaña' : c.lifetime_budget ? 'total de campaña' : 'por conjunto', smart_promotion_type: c.smart_promotion_type, creada: c.created_time } }));
      /* ¿Meta acepta HOY esa misma configuración dentro de su propia campaña? (validate_only, no crea nada) */
      try {
        const info0 = await gGet(base + acc + '?fields=currency,min_daily_budget');
        const p0 = { name: 'mbe_validacion', campaign_id: String(c.id), optimization_goal: a.optimization_goal, billing_event: a.billing_event || 'IMPRESSIONS', destination_type: a.destination_type,
          promoted_object: a.promoted_object || {}, status: 'PAUSED', execution_options: ['validate_only'], targeting: { geo_locations: { countries: ['MX'] }, age_min: 18, targeting_automation: { advantage_audience: 0 } } };
        if (a.optimization_sub_event && a.optimization_sub_event !== 'NONE') p0.optimization_sub_event = a.optimization_sub_event;
        if (a.attribution_spec) p0.attribution_spec = a.attribution_spec;
        if (!(Number(c.daily_budget) || Number(c.lifetime_budget))) p0.daily_budget = aMenor(Math.max(aMayor(info0.min_daily_budget, info0.currency) || 0, 50), info0.currency);
        if (a.bid_strategy && a.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP') { p0.bid_strategy = a.bid_strategy; if (a.bid_amount) p0.bid_amount = a.bid_amount; }
        await gPost(acc + '/adsets', p0);
        paso('Crear un conjunto igual dentro de su propia campaña', true, 'Meta lo acepta (solo validación, no se creó nada): la configuración sigue vigente dentro de esa campaña. Lo que cambia al crear una campaña nueva es la campaña.');
      } catch (e) { paso('Crear un conjunto igual dentro de su propia campaña', false, 'Meta lo rechaza incluso dentro de su propia campaña: ' + textoMeta(e) + '. Esa optimización ya no se puede crear por la API en esta cuenta, aunque el conjunto original siga activo.'); }
      /* 5.4.2 · ¿Meta admite hoy esa optimización con WhatsApp y ese objetivo? (tabla de Click to WhatsApp) */
      const meta_ = String(a.optimization_goal || '').toUpperCase(), obj_ = String(c.objective || '').toUpperCase();
      if (/WHATSAPP/.test(String(a.destination_type || '')) && OBJETIVOS_WA[meta_]) {
        const ok_ = OBJETIVOS_WA[meta_].indexOf(obj_) >= 0;
        paso('Combinación admitida por Meta', ok_, ok_ ? 'Meta admite ' + (NOMBRE_META_WA[meta_] || meta_) + ' con WhatsApp y objetivo ' + (NOMBRE_OBJETIVO[obj_] || obj_) + '.'
          : 'Meta documenta ' + (NOMBRE_META_WA[meta_] || meta_) + ' con WhatsApp solo con objetivo ' + OBJETIVOS_WA[meta_].map(x => NOMBRE_OBJETIVO[x] || x).join(' o ') + ', y esta referencia es de ' + (NOMBRE_OBJETIVO[obj_] || obj_)
            + '. El conjunto viejo puede seguir activo, pero Meta no deja copiarlo ni crear otro igual con ese objetivo. Al publicar, el motor crea el conjunto con los mismos valores en una campaña de '
            + (NOMBRE_OBJETIVO[OBJETIVOS_WA[meta_][0]] || OBJETIVOS_WA[meta_][0]) + ' y lo avisa.');
      }
    } catch (e) { paso('Leer la referencia', false, explicar(e)); return [{ json: { pasos } }]; }
    /* 5.5 · Qué configuración de WhatsApp acepta Meta hoy (validate_only, no crea nada). */
    if (/WHATSAPP/.test(String(a.destination_type || ''))) {
      try {
        const info = await gGet(base + acc + '?fields=currency,min_daily_budget');
        const cfgRef = { optimization_goal: a.optimization_goal, billing_event: a.billing_event, destination_type: a.destination_type, promoted_object: a.promoted_object || {}, attribution_spec: a.attribution_spec || null };
        const objRef = String((a.campaign || {}).objective || '').toUpperCase();
        const campanaRef = { id: String((a.campaign || {}).id || ''), objetivo: objRef, cbo: !!(Number((a.campaign || {}).daily_budget) || Number((a.campaign || {}).lifetime_budget)) };
        const base_ = { acc, pageId: String((a.promoted_object || {}).page_id || b.page_id || ''), meta: a.optimization_goal, objetivo: objRef, objetivoRef: objRef, cfg: cfgRef, campanaRef,
          numero: (a.promoted_object || {}).whatsapp_phone_number || '', dataset: b.dataset || '', evento: 'PURCHASE', moneda: info.currency, minimo: aMayor(info.min_daily_budget, info.currency) };
        const r = await resolverWA(Object.assign({}, base_, { objetivoFijo: objRef, cache: {} }));
        paso('Configuración que Meta acepta hoy con objetivo ' + (NOMBRE_OBJETIVO[objRef] || objRef), r.ok, r.ok ? r.elegido.etiqueta + (r.intentos.length ? ' · antes rechazó: ' + textoIntentosWA(r.intentos) : ' (igual a la referencia)')
          : 'Ninguna: ' + textoIntentosWA(r.intentos) + (r.faltaDataset ? ' · Falta elegir el conjunto de datos de compras (WhatsApp CAPI).' : ''));
        if (!r.ok) {
          const r2 = await resolverWA(Object.assign({}, base_, { objetivoFijo: '', cache: {} }));
          paso('Configuración que Meta acepta hoy con otro objetivo', r2.ok, r2.ok ? r2.elegido.etiqueta : 'Ninguna: ' + textoIntentosWA(r2.intentos.filter(x => !/^Interacción/.test(x.etiqueta))));
        }
      } catch (e) { paso('Configuración que Meta acepta hoy', false, explicar(e)); }
    }
    const campRef = String((a.campaign || {}).id || '');
    let campCopia = '';
    try { const r = await gPost(campRef + '/copies', { deep_copy: 'false', status_option: 'PAUSED' }); campCopia = String(r.copied_campaign_id || ''); creados.push(campCopia); paso('Copiar la campaña (sin conjuntos)', !!campCopia, campCopia ? 'Copia ' + campCopia : 'Meta no devolvió ID'); }
    catch (e) { paso('Copiar la campaña (sin conjuntos)', false, explicar(e)); }
    if (campCopia) {
      /* ¿En qué se diferencia la copia de la original? Es lo que explica un rechazo que solo pasa en la copia. */
      const CAMPOS_C = 'objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_categories,smart_promotion_type,is_adset_budget_sharing_enabled,spend_cap,pacing_type';
      try {
        const x1 = await gGet(base + campRef + '?fields=' + CAMPOS_C), x2 = await gGet(base + campCopia + '?fields=' + CAMPOS_C);
        const dif = CAMPOS_C.split(',').filter(k => JSON.stringify(x1[k]) !== JSON.stringify(x2[k])).map(k => k + ': ' + JSON.stringify(x1[k]) + ' → ' + JSON.stringify(x2[k]));
        paso('Diferencias entre la campaña original y su copia', !dif.length, dif.length ? dif.join(' · ') : 'Ninguna en los campos que expone la API.');
      } catch (e) { paso('Diferencias entre la campaña original y su copia', false, 'No pude compararlas: ' + explicar(e)); }
    }
    if (campCopia) {
      try { const r = await gPost(ref + '/copies', { campaign_id: campCopia, deep_copy: 'false', status_option: 'PAUSED' }); const id = String(r.copied_adset_id || ''); if (id) creados.unshift(id); paso('Copiar el conjunto dentro de la copia', !!id, id ? 'Copia ' + id + ' · la clonación simple FUNCIONA' : 'Meta no devolvió ID'); }
      catch (e) { paso('Copiar el conjunto dentro de la copia', false, explicar(e)); }
    }
    if (!pasos.some(x => x.paso === 'Copiar el conjunto dentro de la copia' && x.ok)) {
      try { const r = await gPost(campRef + '/copies', { deep_copy: 'true', status_option: 'PAUSED' }); const id = String(r.copied_campaign_id || '');
        /* Se eliminan primero anuncios y conjuntos copiados, luego la campaña (no se depende del borrado en cascada). */
        const hijos = (r.ad_object_ids || []).map(o => ({ id: String(o.copied_id), tipo: String(o.ad_object_type || '') })).filter(o => o.id && o.id !== id);
        hijos.filter(o => /^ad$/i.test(o.tipo)).forEach(o => creados.unshift(o.id));
        hijos.filter(o => !/^ad$/i.test(o.tipo)).forEach(o => creados.unshift(o.id));
        if (id) creados.push(id);
        paso('Copia profunda de la campaña de referencia', !!id, id ? 'Copia ' + id + ' con ' + (r.ad_object_ids || []).length + ' objetos · la copia profunda FUNCIONA' : 'Meta no devolvió ID'); }
      catch (e) {
        if (Number(e.subcode) === 1885194 || /demasiado alto|too many|asynchronous/i.test(String(e.message)))
          paso('Copia profunda de la campaña de referencia', true, 'La campaña de referencia tiene demasiados objetos para la copia inmediata (Meta admite menos de 3). '
            + 'Al publicar, el motor la copia como lote asíncrono, conserva solo el conjunto de referencia y borra el resto. No se prueba aquí para no copiar la campaña entera.');
        else paso('Copia profunda de la campaña de referencia', false, explicar(e));
      }
    }
    let borrados = 0;
    const unicos = [...new Set(creados.filter(Boolean))];
    for (const id of unicos) { try { await gPost(id, { status: 'DELETED' }); borrados++; } catch (e) {} }
    paso('Limpieza', borrados === unicos.length, 'Se eliminaron ' + borrados + ' de ' + unicos.length + ' objetos de prueba' + (borrados === unicos.length ? '.' : ': revisa en Ads Manager las campañas con "Copia" en el nombre.'));
    return [{ json: { pasos } }];

  } else if (tipo === 'resolver_wa') {
    /* 5.5 · Verifica con Meta, sin crear nada, qué configuración de WhatsApp acepta para esta campaña. */
    const acc = await actDe();
    const info = await gGet(base + acc + '?fields=currency,min_daily_budget');
    let cfg = b.config || null; if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
    /* Conjunto nuevo en una campaña existente: se prueba dentro de esa campaña y con su objetivo. */
    let campanaFija = null;
    if (b.campaign_id) { const ci = await gGet(base + String(b.campaign_id) + '?fields=objective,daily_budget,lifetime_budget'); campanaFija = { id: String(b.campaign_id), cbo: !!(Number(ci.daily_budget) || Number(ci.lifetime_budget)), objetivo: ci.objective }; }
    let campanaRef = null;
    if (b.campana_ref) { try { const ri = await gGet(base + String(b.campana_ref) + '?fields=objective,daily_budget,lifetime_budget'); campanaRef = { id: String(b.campana_ref), objetivo: ri.objective, cbo: !!(Number(ri.daily_budget) || Number(ri.lifetime_budget)) }; } catch (e) {} }
    const r = await resolverWA({ acc, pageId: String(b.page_id || ''), meta: (cfg && cfg.optimization_goal) || b.meta, objetivo: campanaFija ? campanaFija.objetivo : b.objetivo, objetivoRef: b.objetivo,
      objetivoFijo: campanaFija ? campanaFija.objetivo : (b.cambiar_objetivo ? '' : String(b.objetivo || '').toUpperCase()), campanaFija, campanaRef, cfg,
      numero: b.numero, dataset: b.dataset, evento: b.evento,
      targeting: { geo_locations: { countries: [String(b.pais || 'MX').toUpperCase()] }, age_min: 18, targeting_automation: { advantage_audience: 0 } },
      moneda: info.currency, minimo: aMayor(info.min_daily_budget, info.currency), cache: {} });
    return [{ json: { ok: r.ok, elegido: r.elegido ? { objetivo: r.elegido.objetivo, optimization_goal: r.elegido.optimization_goal, promoted_object: r.elegido.promoted_object, etiqueta: r.elegido.etiqueta } : null,
      intentos: r.intentos, sin_prueba: r.sinPrueba } }];

  } else if (tipo === 'chequeo_meta') {
    /* 5.4 · Chequeo de la configuración de Meta que la herramienta necesita: versión de la API,
       token (tipo, vencimiento, permisos), cuenta, página (token, Lead Ads, WhatsApp, Instagram) y píxel.
       Todo en paralelo para no pasar de los 26 s del proxy. Cada punto: ok · revisar · falla. */
    const pasos = [];
    const add = (grupo, punto, estado, detalle, como) => pasos.push({ grupo, punto, estado, detalle, como: como || '' });
    const acc = await actDe();
    const pageId = String(b.page_id || '');
    if (VERSION_API_NUM < VERSION_API_MINIMA) add('API', 'Versión de la API', 'falla', 'META_API_VERSION es ' + version + ' y Meta ya la retiró.', 'En n8n cambia la variable META_API_VERSION a v25.0.');
    else if (VERSION_API_NUM < 25) add('API', 'Versión de la API', 'revisar', 'META_API_VERSION es ' + version + ': vigente, pero es la más antigua que Meta acepta.', 'Cambia a v25.0 en n8n cuando puedas; el motor ya está probado con v25 y v26.');
    else add('API', 'Versión de la API', 'ok', 'META_API_VERSION es ' + version + '.');

    const NECESARIOS = { ads_management: 'crear y editar anuncios', ads_read: 'leer resultados', business_management: 'leer páginas y activos del Business',
      pages_show_list: 'listar páginas', pages_read_engagement: 'leer la página y su token', pages_manage_ads: 'anuncios y formularios de la página',
      leads_retrieval: 'formularios y descarga de leads', whatsapp_business_management: 'números de WhatsApp Business' };
    const OPCIONALES = { read_insights: 'métricas', instagram_basic: 'publicaciones de Instagram', pages_read_user_content: 'publicaciones de la página como anuncio' };
    const tareas = [
      gGet(base + 'me/permissions?limit=200').then(r => ({ permisos: r.data || [] }), e => ({ permisos: null, ePerm: e })),
      gGet(base + 'debug_token?input_token=' + encodeURIComponent(token)).then(r => ({ dbg: r.data || null }), () => ({ dbg: null })),
      gGet(base + acc + '?fields=name,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap').then(r => ({ cuenta: r }), e => ({ eCuenta: e })),
      gGet(base + acc + '/adspixels?fields=id,name,last_fired_time&limit=10').then(r => ({ pixeles: r.data || [] }), () => ({ pixeles: null })),
    ];
    if (pageId) {
      tareas.push(gGet(base + pageId + '?fields=name,instagram_business_account{id,username}').then(r => ({ pagina: r }), e => ({ ePagina: e })));
      tareas.push(tokenPagina(pageId).then(async tk => {
        const o = { tkPagina: true };
        try { const r = await gGet(base + pageId + '?fields=leadgen_tos_accepted', tk); o.tos = r.leadgen_tos_accepted; } catch (e) { o.tos = null; }
        try { const r = await gGet(base + pageId + '?fields=whatsapp_number', tk); o.wa = r.whatsapp_number || ''; } catch (e) { o.wa = null; }
        return o;
      }, e => ({ tkPagina: false, eTk: e })));
    }
    const res = Object.assign({}, ...(await Promise.all(tareas)));

    /* token */
    if (res.dbg) {
      const d = res.dbg;
      add('Token', 'Tipo y vigencia', d.is_valid === false ? 'falla' : (Number(d.expires_at) && Number(d.expires_at) * 1000 - Date.now() < 15 * 86400000 ? 'revisar' : 'ok'),
        (d.type === 'SYSTEM_USER' ? 'Token de system user' : 'Token de tipo ' + (d.type || 'desconocido')) + (Number(d.expires_at) ? ', vence el ' + new Date(Number(d.expires_at) * 1000).toISOString().slice(0, 10) : ', no vence') + '.',
        d.type !== 'SYSTEM_USER' ? 'Usa un token de system user (Business Manager → Usuarios del sistema): no vence y no depende de una persona.' : (Number(d.expires_at) ? 'Genera un token sin vencimiento para el system user.' : ''));
    }
    if (res.permisos) {
      const dados = {}; res.permisos.forEach(x => { if (x.status === 'granted') dados[x.permission] = true; });
      const faltan = Object.keys(NECESARIOS).filter(k => !dados[k]);
      add('Token', 'Permisos necesarios', faltan.length ? 'falla' : 'ok',
        faltan.length ? 'Faltan: ' + faltan.map(k => k + ' (' + NECESARIOS[k] + ')').join(', ') + '.' : 'Tiene los ' + Object.keys(NECESARIOS).length + ' permisos que usa la herramienta.',
        faltan.length ? 'Regenera el token del system user marcando esos permisos y actualiza META_ACCESS_TOKEN en n8n.' : '');
      const opc = Object.keys(OPCIONALES).filter(k => !dados[k]);
      if (opc.length) add('Token', 'Permisos opcionales', 'revisar', 'Sin ' + opc.map(k => k + ' (' + OPCIONALES[k] + ')').join(', ') + '.', 'Agrégalos al token si quieres usar esas funciones.');
    } else add('Token', 'Permisos', 'revisar', 'No pude leer los permisos del token' + (res.ePerm ? ' (' + explicar(res.ePerm) + ')' : '') + '.');

    /* cuenta */
    if (res.cuenta) {
      const c = res.cuenta, st = Number(c.account_status);
      const ESTADOS = { 1: 'activa', 2: 'desactivada', 3: 'con pagos pendientes', 7: 'en revisión de riesgo', 8: 'con liquidación pendiente', 9: 'en periodo de gracia', 100: 'por cerrarse', 101: 'cerrada' };
      add('Cuenta', 'Estado', st === 1 ? 'ok' : 'falla', '"' + c.name + '" está ' + (ESTADOS[st] || 'en estado ' + st) + ' · ' + c.currency + ' · ' + c.timezone_name + '.',
        st === 1 ? '' : 'Resuélvelo en la configuración de pagos o en la calidad de la cuenta en Business Manager.');
      const tope = Number(c.spend_cap || 0), gastado = Number(c.amount_spent || 0);
      if (tope) add('Cuenta', 'Límite de gasto de la cuenta', gastado >= tope * 0.9 ? 'revisar' : 'ok', 'Lleva ' + Math.round(gastado / tope * 100) + ' % del límite de gasto de la cuenta.',
        gastado >= tope * 0.9 ? 'Sube o quita el límite de gasto de la cuenta antes de publicar: al llegar, Meta detiene todo.' : '');
    } else add('Cuenta', 'Acceso', 'falla', 'No pude leer la cuenta: ' + explicar(res.eCuenta), 'Asigna la cuenta al system user con permiso de administrar campañas.');

    /* página */
    if (!pageId) add('Página', 'Página', 'revisar', 'No hay página elegida: los puntos de página, WhatsApp y formularios se revisan al elegirla.');
    else {
      if (res.pagina) {
        add('Página', 'Acceso', 'ok', 'Página "' + res.pagina.name + '".');
        const ig = res.pagina.instagram_business_account;
        add('Página', 'Instagram', ig ? 'ok' : 'revisar', ig ? 'Cuenta de Instagram conectada' + (ig.username ? ' (@' + ig.username + ')' : '') + '.' : 'La página no tiene una cuenta profesional de Instagram conectada: en Instagram los anuncios salen con el perfil de la página.',
          ig ? '' : 'Conecta la cuenta de Instagram a la página y asígnala al system user.');
      } else add('Página', 'Acceso', 'falla', 'No pude leer la página: ' + explicar(res.ePagina), 'Asigna la página al system user con permiso de anuncios.');
      if (res.tkPagina === false) add('Página', 'Token de página', 'falla', explicar(res.eTk), 'Sin token de página no se pueden leer ni crear formularios.');
      else if (res.tkPagina) {
        add('Formularios', 'Condiciones de Lead Ads', res.tos === true ? 'ok' : res.tos === false ? 'falla' : 'revisar',
          res.tos === true ? 'La página aceptó las condiciones de los anuncios para clientes potenciales.' : res.tos === false ? 'La página no ha aceptado las condiciones de los anuncios para clientes potenciales: Meta rechaza los anuncios con formulario.' : 'No pude confirmar si la página aceptó las condiciones de Lead Ads.',
          res.tos === true ? '' : 'Un administrador de la página debe aceptarlas en https://www.facebook.com/ads/leadgen/tos');
        /* Meta no siempre expone el número vinculado en la página: si no aparece, se pide revisar (no se bloquea).
           La prueba definitiva la hace el motor con validate_only antes de crear cada conjunto. */
        add('WhatsApp', 'Número vinculado a la página', res.wa ? 'ok' : 'revisar',
          res.wa ? 'La página tiene vinculado el número ' + res.wa + '.' : res.wa === '' ? 'Meta no reporta un número de WhatsApp vinculado a la página. Si publicas a WhatsApp y no está vinculado, Meta rechaza el conjunto (error 2446886).' : 'No pude leer el número de WhatsApp de la página; el motor lo verifica con Meta antes de crear cada conjunto.',
          res.wa ? 'Si usas otro número en el plan, también debe estar vinculado a esta página.' : 'Vincula el número de WhatsApp Business en la configuración de la página (Cuentas vinculadas → WhatsApp).');
      }
    }

    /* píxel */
    if (res.pixeles) {
      if (!res.pixeles.length) add('Medición', 'Píxel', 'revisar', 'La cuenta no tiene píxel: no se puede optimizar por conversiones del sitio web.', 'Crea o comparte un conjunto de datos (píxel) con la cuenta en el Administrador de eventos.');
      else res.pixeles.slice(0, 3).forEach(x => {
        const dias = x.last_fired_time ? Math.floor((Date.now() - Date.parse(x.last_fired_time)) / 86400000) : null;
        add('Medición', 'Píxel "' + x.name + '"', dias == null ? 'revisar' : dias > 7 ? 'revisar' : 'ok',
          dias == null ? 'No registra eventos.' : 'Último evento hace ' + dias + (dias === 1 ? ' día.' : ' días.'),
          dias == null || dias > 7 ? 'Revisa la instalación en el Administrador de eventos antes de optimizar o medir con él.' : '');
      });
    }
    add('App', 'Modo de la app', 'info', 'La API no informa si la app está en modo activo. Si Meta responde "la app está en modo desarrollo" (1885183), los anuncios no se publican.',
      'En developers.facebook.com, la app debe estar en modo Live y el Business verificado; pide "Ads Management Standard Access" para tener límites de uso más altos.');
    const orden = { falla: 0, revisar: 1, ok: 2, info: 3 };
    return [{ json: { pasos: pasos.sort((x, y) => orden[x.estado] - orden[y.estado]), revisado: new Date().toISOString(), cuenta: acc.replace('act_', '') } }];

  } else if (tipo === 'version') {
    return [{ json: { motor_version: '5.6.0', api_version: version, api_minima: 'v' + VERSION_API_MINIMA } }];

  } else if (tipo === 'preview') {
    /* Previsualización real con /generatepreviews: Meta renderiza el anuncio en cada
       formato. Se devuelve solo la URL del iframe (no HTML) para insertarlo con seguridad. */
    const acc = await actDe();
    const ad = b.anuncio || {}, pid = String(b.page_id || '');
    if (!pid) throw new Error('Elige la página para previsualizar.');
    let ig = '';
    try { const p0 = await gGet(base + pid + '?fields=instagram_business_account{id},connected_instagram_account{id}');
      ig = String((p0.instagram_business_account && p0.instagram_business_account.id) || (p0.connected_instagram_account && p0.connected_instagram_account.id) || ''); } catch (e) {}
    const wa = !!ad.whatsapp;
    const form = String(ad.formulario || '');
    const cta = wa ? { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } }
      : form ? { type: String(ad.cta || 'SIGN_UP'), value: { lead_gen_form_id: form, link: 'http://fb.me/' } }
      : { type: String(ad.cta || 'LEARN_MORE'), value: { link: ad.url || 'https://www.facebook.com' } };
    const spec = { page_id: pid };
    if (ig) spec.instagram_user_id = ig;
    if (ad.video_id) spec.video_data = { video_id: String(ad.video_id), message: ad.texto || '', title: ad.titulo || '', link_description: ad.descripcion || '', call_to_action: wa ? { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP', link: 'https://api.whatsapp.com/send' } } : cta };
    else {
      spec.link_data = { link: wa ? 'https://api.whatsapp.com/send' : form ? 'http://fb.me/' : (ad.url || 'https://www.facebook.com'), message: ad.texto || '', name: ad.titulo || '', description: ad.descripcion || '', call_to_action: cta };
      if (ad.image_hash) spec.link_data.image_hash = String(ad.image_hash); else if (ad.image_url) spec.link_data.picture = String(ad.image_url);
    }
    const formatos = lista(b.formatos).length ? lista(b.formatos) : ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY'];
    const out = [];
    for (const fmt of formatos.slice(0, 4)) {
      try {
        const r = await gGet(base + acc + '/generatepreviews?ad_format=' + fmt + '&creative=' + encodeURIComponent(JSON.stringify({ object_story_spec: spec })));
        const html = String(((r.data || [])[0] || {}).body || '');
        const m = html.match(/src=["']([^"']+)["']/);
        out.push({ formato: fmt, src: m ? m[1].replace(/&amp;/g, '&') : '', error: m ? '' : 'Meta no devolvió la vista previa.' });
      } catch (e) { out.push({ formato: fmt, src: '', error: explicar(e) }); }
    }
    return [{ json: { previews: out } }];

  } else if (tipo === 'publicaciones') {
    /* 5.1 · Publicaciones recientes de la página (Facebook) y de su cuenta de Instagram,
       para usarlas como anuncio conservando reacciones y comentarios. */
    const pid = String(b.page_id || '');
    if (!pid) throw new Error('Elige la página para ver sus publicaciones.');
    const tk = await tokenPagina(pid);
    const out = [], avisos = [];
    const corto = t => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 110 ? x.slice(0, 107) + '…' : (x || '(sin texto)'); };
    try {
      const r = await gGet(base + pid + '/posts?fields=id,message,full_picture,created_time,permalink_url,is_eligible_for_promotion,status_type&limit=30', tk);
      (r.data || []).forEach(x => out.push({ id: String(x.id), origen: 'FACEBOOK', n: corto(x.message), img: x.full_picture || '', fecha: x.created_time || '',
        url: x.permalink_url || '', elegible: x.is_eligible_for_promotion !== false, tipo: x.status_type || '' }));
    } catch (e) { avisos.push('Facebook: ' + explicar(e)); }
    try {
      const p0 = await gGet(base + pid + '?fields=instagram_business_account{id,username}', tk);
      const ig = p0.instagram_business_account;
      if (ig && ig.id) {
        const r = await gGet(base + ig.id + '/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=30', tk);
        (r.data || []).forEach(x => out.push({ id: String(x.id), origen: 'INSTAGRAM', n: corto(x.caption), img: x.thumbnail_url || x.media_url || '', fecha: x.timestamp || '',
          url: x.permalink || '', elegible: true, tipo: x.media_type || '', cuenta: ig.username || '' }));
      } else avisos.push('Instagram: la página no tiene una cuenta profesional de Instagram conectada.');
    } catch (e) { avisos.push('Instagram: ' + explicar(e)); }
    out.sort((p, q) => String(q.fecha).localeCompare(String(p.fecha)));
    return [{ json: { resultados: out, avisos } }];

  } else if (tipo === 'lote_resultados') {
    /* 5.1 · Resultados de lo publicado por el lote (desde que se creó). */
    const ids = lista(b.campaign_ids).slice(0, 50);
    const accion = (acts, tipos) => (acts || []).filter(a => tipos.indexOf(a.action_type) >= 0).reduce((t, a) => Math.max(t, Number(a.value) || 0), 0);
    /* 5.2: todas las campañas en una sola llamada por lotes. */
    const filas = [];
    const lotes = {};
    for (let i = 0; i < ids.length; i += 50) {
      const bloque = ids.slice(i, i + 50);
      const r = await gPost('', { include_headers: 'false', batch: bloque.map(id => ({ method: 'GET',
        relative_url: id + '/insights?date_preset=maximum&fields=campaign_name,spend,impressions,reach,clicks,actions,account_currency' })) });
      (Array.isArray(r) ? r : []).forEach((x, j) => { lotes[bloque[j]] = x; });
    }
    for (const id of ids) {
      try {
        const y = lotes[id] || {};
        const cuerpo = (() => { try { return JSON.parse(y.body || '{}'); } catch (e) { return {}; } })();
        if (Number(y.code) !== 200) { const er = cuerpo.error || {}; const e = new Error(er.error_user_msg || er.message || 'Meta no devolvió resultados.'); e.code = er.code; throw e; }
        const x = (cuerpo.data || [])[0] || {};
        filas.push({ id, nombre: x.campaign_name || '', gasto: Number(x.spend || 0), moneda: x.account_currency || '',
          impresiones: Number(x.impressions || 0), alcance: Number(x.reach || 0), clics: Number(x.clicks || 0),
          leads: accion(x.actions, ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']),
          conversaciones: accion(x.actions, ['onsite_conversion.messaging_conversation_started_7d']),
          ...(() => { const u = comprasPorUniverso(x.actions, x.campaign_name); return { compras: u.compras, universo: u.universo }; })() });
      } catch (e) { filas.push({ id, error: explicar(e) }); }
    }
    return [{ json: { resultados: filas } }];

  } else if (tipo === 'lote') {
    /* Todo lo que creó un plan, encontrado por su etiqueta de lote (mbe_<lote>). */
    const acc = await actDe();
    const nombreEt = 'mbe_' + String(b.lote_id || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (nombreEt === 'mbe_') throw new Error('Este plan todavía no se ha enviado.');
    const et = (await paginar(base + acc + '/adlabels?fields=id,name&limit=500', 2000)).find(x => x.name === nombreEt);
    const objetos = { campanas: [], conjuntos: [], anuncios: [] };
    if (!et) return [{ json: { objetos, sinEtiqueta: true } }];
    const tiene = o => (o.adlabels || []).some(l => String(l.id) === String(et.id));
    const vivo = o => ['DELETED', 'ARCHIVED'].indexOf(String(o.effective_status || '')) < 0;
    for (const nombre of lista(b.campanas || '').concat(Array.isArray(b.campanas) ? b.campanas : []).filter((x, i, a) => a.indexOf(x) === i)) {
      try {
        const r = await gGet(base + acc + '/campaigns?fields=id,name,adlabels,effective_status,daily_budget,lifetime_budget&limit=50&filtering='
          + encodeURIComponent(JSON.stringify([{ field: 'name', operator: 'EQUAL', value: nombre }])));
        (r.data || []).filter(c => tiene(c) && vivo(c)).forEach(c => objetos.campanas.push({ id: String(c.id), name: c.name, estado: c.effective_status, diario: aMayor(c.daily_budget, '') }));
      } catch (e) {}
    }
    /* 5.2: conjuntos y anuncios en lotes de 50 objetos por llamada (antes, una llamada por objeto). */
    const campIds = objetos.campanas.map(c => c.id).concat(lista(b.campanas_existentes));
    const conC = campIds.length ? await porIds(campIds, 'adsets.limit(300){id,name,adlabels,effective_status,campaign_id}') : {};
    Object.keys(conC).forEach(k => (((conC[k] || {}).adsets || {}).data || [])
      .filter(a => tiene(a) && vivo(a)).forEach(a => objetos.conjuntos.push({ id: String(a.id), name: a.name, estado: a.effective_status, campaign_id: String(a.campaign_id) })));
    const conjIds = [...new Set(objetos.conjuntos.map(a => a.id).concat(lista(b.conjuntos_existentes)))];
    const conA = conjIds.length ? await porIds(conjIds, 'ads.limit(500){id,name,adlabels,effective_status,adset_id}') : {};
    Object.keys(conA).forEach(k => (((conA[k] || {}).ads || {}).data || [])
      .filter(x => tiene(x) && vivo(x)).forEach(x => objetos.anuncios.push({ id: String(x.id), name: x.name, estado: x.effective_status, adset_id: String(x.adset_id) })));
    return [{ json: { objetos, etiqueta: nombreEt } }];

  } else if (tipo === 'lote_accion') {
    /* Activar, pausar o eliminar lo creado por un plan. Por seguridad solo se actúa
       sobre objetos que llevan la etiqueta de ESTE lote. Orden: al activar, de arriba
       hacia abajo; al pausar o eliminar, de abajo hacia arriba. */
    const acc = await actDe();
    const accion = String(b.accion || '').toUpperCase();
    if (['ACTIVE', 'PAUSED', 'DELETED'].indexOf(accion) < 0) throw new Error('Acción no válida.');
    const nombreEt = 'mbe_' + String(b.lote_id || '').replace(/[^a-zA-Z0-9_]/g, '');
    const et = (await paginar(base + acc + '/adlabels?fields=id,name&limit=500', 2000)).find(x => x.name === nombreEt);
    if (!et) throw new Error('No encontré la etiqueta de este plan en la cuenta.');
    const niveles = accion === 'ACTIVE' ? ['campanas', 'conjuntos', 'anuncios'] : ['anuncios', 'conjuntos', 'campanas'];
    const resultado = { ok: 0, fallos: [], omitidos: 0 };
    for (const nivel of niveles) {
      const ids = lista((b.ids || {})[nivel] || []);
      if (!ids.length) continue;
      const leidos = await porIds(ids, 'id,name,adlabels');
      const validos = ids.filter(id => leidos[id] && (leidos[id].adlabels || []).some(l => String(l.id) === String(et.id)));
      resultado.omitidos += ids.length - validos.length;
      for (let i = 0; i < validos.length; i += 50) {
        const bloque = validos.slice(i, i + 50);
        const r = await gPost('', { include_headers: 'false', batch: bloque.map(id => ({ method: 'POST', relative_url: id, body: 'status=' + accion })) });
        (Array.isArray(r) ? r : []).forEach((x, j) => {
          if (x && Number(x.code) === 200) resultado.ok++;
          else { let m = ''; try { m = (JSON.parse(x.body).error || {}).error_user_msg || (JSON.parse(x.body).error || {}).message; } catch (e) {} resultado.fallos.push((leidos[bloque[j]] || {}).name + ': ' + (m || 'error')); }
        });
      }
    }
    return [{ json: resultado }];

  } else if (tipo === 'whatsapp_info') {
    /* Todo lo de WhatsApp en UNA lectura liviana: números, plantillas de mensaje y
       configuraciones probadas. Antes eran tres búsquedas en paralelo que recorrían
       los conjuntos por separado y agotaban el límite de solicitudes (17/2446079). */
    const acc = await actDe();
    const pid = String(b.page_id || '');
    const CAMPOS = 'id,name,effective_status,updated_time,optimization_goal,destination_type,billing_event,'
      + 'optimization_sub_event,promoted_object,attribution_spec,campaign{id,name,objective}';
    const diag = { conjuntosRevisados: 0, conjuntosWhatsApp: 0, numerosEnAnuncios: 0, wabas: 0 };
    let todos = [];
    try { todos = await paginar(base + acc + '/adsets?fields=' + encodeURIComponent(CAMPOS) + '&limit=100', 300); }
    catch (e) { diag.errorConjuntos = explicar(e); }
    diag.conjuntosRevisados = todos.length;
    const wa = todos.filter(a => /WHATSAPP/.test(String(a.destination_type || '').toUpperCase()) || (a.promoted_object && a.promoted_object.whatsapp_phone_number))
      .sort((x, y) => String(y.updated_time || '').localeCompare(String(x.updated_time || '')));
    diag.conjuntosWhatsApp = wa.length;
    const COMUNES = ['CONVERSATIONS','LINK_CLICKS','IMPRESSIONS','REACH','POST_ENGAGEMENT','LANDING_PAGE_VIEWS','THRUPLAY'];
    const configs = wa.slice(0, 40).map(a => Object.assign(configDe(a, COMUNES), { cuenta: acc.replace('act_', '') }))
      .sort((x, y) => y.puntaje - x.puntaje);

    const porClave = {};
    const sumar = (valor, fuente, extra) => {
      const clave = claveNumero(valor); if (!clave) return;
      const x = porClave[clave] || (porClave[clave] = { id: '', n: bonito(valor), fuentes: [], paginas: [], usos: 0, waba: '' });
      if (fuente === 'ANUNCIOS' && !x.id) x.id = String(valor).trim();
      if (x.fuentes.indexOf(fuente) < 0) x.fuentes.push(fuente);
      if (extra && extra.pagina && x.paginas.indexOf(extra.pagina) < 0) x.paginas.push(extra.pagina);
      if (extra && extra.waba) x.waba = extra.waba;
      if (extra && extra.usos) x.usos += extra.usos;
    };
    wa.forEach(a => { const po = a.promoted_object || {}; if (po.whatsapp_phone_number) sumar(po.whatsapp_phone_number, 'ANUNCIOS', { pagina: String(po.page_id || ''), usos: 1 }); });

    /* Anuncios de los 25 conjuntos de WhatsApp más recientes: números del botón y mensajes de bienvenida. */
    const vistas = {};
    if (wa.length) {
      try {
        const leidos = await porIds(wa.slice(0, 25).map(a => a.id),
          'promoted_object,ads.limit(3){name,creative{object_story_spec{page_id,link_data{link,call_to_action,page_welcome_message},video_data{call_to_action,page_welcome_message}},asset_feed_spec{additional_data}}}');
        Object.keys(leidos).forEach(id => ((leidos[id].ads && leidos[id].ads.data) || []).forEach(ad => {
          const cr = ad.creative || {}, oss = cr.object_story_spec || {};
          const ld = oss.link_data || {}, vd = oss.video_data || {};
          const v = ((ld.call_to_action || vd.call_to_action || {}).value) || {};
          const m = String(ld.link || v.link || '').match(/(?:phone=|wa\.me\/)(\+?\d{8,15})/);
          const num = v.whatsapp_number || v.whatsapp_phone_number || (m && m[1]) || '';
          const pg = String(oss.page_id || (leidos[id].promoted_object || {}).page_id || '');
          if (num) sumar(num, 'ANUNCIOS', { pagina: pg, usos: 1 });
          let pwm = ld.page_welcome_message || vd.page_welcome_message || null;
          if (typeof pwm === 'string') { try { pwm = JSON.parse(pwm); } catch (e) { pwm = null; } }
          const seq = cr.asset_feed_spec && cr.asset_feed_spec.additional_data && cr.asset_feed_spec.additional_data.partner_app_welcome_message_flow_id;
          if (!pwm && !seq) return;
          const mm = (pwm && pwm.text_format && pwm.text_format.message) || {};
          const t = { saludo: String(mm.text || ''), prellenado: String((mm.autofill_message && mm.autofill_message.content) || ''),
            preguntas: (mm.ice_breakers || []).map(x => String(x.title || '')).filter(Boolean), secuencia: seq ? String(seq) : '' };
          const clave = t.secuencia ? 'seq:' + t.secuencia : JSON.stringify([t.saludo, t.prellenado, t.preguntas]);
          const x = vistas[clave] || (vistas[clave] = Object.assign({ id: clave, paginas: [], usos: 0, ejemplo: ad.name || '' }, t));
          x.usos++; if (pg && x.paginas.indexOf(pg) < 0) x.paginas.push(pg);
        }));
      } catch (e) { diag.errorAnuncios = explicar(e); }
    }
    for (const w of await wabasAccesibles(acc, diag)) {
      try {
        const nums = await paginar(base + w.id + '/phone_numbers?fields=display_phone_number,verified_name&limit=50', 50);
        nums.forEach(x => sumar(x.display_phone_number, 'WABA', { waba: x.verified_name || w.name || '' }));
      } catch (e) { diag.erroresWaba.push('Números de la WABA "' + w.name + '": ' + explicar(e)); }
    }
    const numeros = Object.keys(porClave).map(k => {
      const x = porClave[k];
      if (!x.id) x.id = '+' + String(x.n).replace(/[^0-9]/g, '');
      const conEsta = pid && x.paginas.indexOf(pid) >= 0;
      x.grupo = conEsta ? 'ESTA_PAGINA' : (x.fuentes.indexOf('WABA') >= 0 ? 'WABA' : 'OTRA_PAGINA');
      x.r = conEsta ? ('usado en ' + x.usos + ' anuncio(s) con esta página') : x.fuentes.indexOf('WABA') >= 0 ? ('WhatsApp Business' + (x.waba ? ': ' + x.waba : '')) : 'usado con otra página';
      return x;
    }).sort((a, c) => ['ESTA_PAGINA','WABA','OTRA_PAGINA'].indexOf(a.grupo) - ['ESTA_PAGINA','WABA','OTRA_PAGINA'].indexOf(c.grupo) || c.usos - a.usos);
    diag.numerosEnAnuncios = numeros.filter(x => x.fuentes.indexOf('ANUNCIOS') >= 0).length;
    const plantillas = Object.keys(vistas).map(k => {
      const v = vistas[k]; v.conEsta = !!pid && v.paginas.indexOf(pid) >= 0;
      v.n = v.secuencia ? ('Secuencia · ' + (v.ejemplo || v.secuencia)) : (v.saludo || v.prellenado || '(sin texto)').slice(0, 70);
      v.r = 'usado en ' + v.usos + ' anuncio(s)' + (v.conEsta ? ' con esta página' : '');
      return v;
    }).sort((a, c) => (c.conEsta - a.conEsta) || (c.usos - a.usos)).slice(0, 40);
    return [{ json: { numeros, plantillas, configs, diagnostico: diag } }];

  } else if (tipo === 'config_conjunto') {
    /* Configuración de UN conjunto por su ID (o pegando el enlace de Ads Manager),
       de cualquier cuenta a la que tenga acceso el token. */
    const m = String(b.adset_id || '').match(/(?:selected_adset_ids=|adset[_-]?id=|\b)(\d{10,20})\b/);
    if (!m) throw new Error('No reconozco un ID de conjunto. Pega el número del conjunto o el enlace de Ads Manager con ese conjunto seleccionado.');
    const CAMPOS = 'id,name,effective_status,updated_time,optimization_goal,destination_type,billing_event,'
      + 'optimization_sub_event,promoted_object,attribution_spec,campaign{id,name,objective},account_id';
    const a = await gGet(base + m[1] + '?fields=' + encodeURIComponent(CAMPOS));
    const x = configDe(a, ['CONVERSATIONS','LINK_CLICKS','IMPRESSIONS','REACH','POST_ENGAGEMENT','LANDING_PAGE_VIEWS','THRUPLAY']);
    x.cuenta = String(a.account_id || '');
    return [{ json: { config: x } }];

  } else if (tipo === 'config_whatsapp') {
    /* Configuración exacta de los conjuntos de WhatsApp que ya existen en la cuenta
       (los creados en Ads Manager incluidos): objetivo de su campaña, optimización,
       destino, objeto promovido y demás. Sirve para replicar una combinación que
       Meta ya aceptó, en lugar de adivinarla. */
    const acc = await actDe();
    const CAMPOS_CFG = 'id,name,effective_status,updated_time,optimization_goal,destination_type,billing_event,'
      + 'optimization_sub_event,promoted_object,attribution_spec,bid_strategy,campaign{id,name,objective}';
    const todos = await paginar(base + acc + '/adsets?fields=' + encodeURIComponent(CAMPOS_CFG) + '&limit=100', 500);
    const COMUNES = ['CONVERSATIONS','LINK_CLICKS','IMPRESSIONS','REACH','POST_ENGAGEMENT','LANDING_PAGE_VIEWS','THRUPLAY'];
    resultados = todos
      .filter(a => /WHATSAPP/.test(String(a.destination_type || '').toUpperCase()) || (a.promoted_object && a.promoted_object.whatsapp_phone_number))
      .map(a => {
        const camp = a.campaign || {};
        const compras = COMUNES.indexOf(String(a.optimization_goal || '').toUpperCase()) < 0;
        return {
          id: String(a.id), n: a.name, compras,
          r: (camp.objective || '') + ' · ' + (a.optimization_goal || '') + ' · ' + (a.destination_type || '') + ' · campaña "' + (camp.name || '') + '"',
          objetivo: camp.objective || '',
          config: {
            optimization_goal: a.optimization_goal || '', destination_type: a.destination_type || '',
            billing_event: a.billing_event || '', optimization_sub_event: a.optimization_sub_event || '',
            promoted_object: a.promoted_object || {}, attribution_spec: a.attribution_spec || null,
          },
          actualizado: a.updated_time || '',
        };
      })
      .sort((x, y) => (y.compras - x.compras) || String(y.actualizado).localeCompare(String(x.actualizado)))
      .slice(0, 30);

  } else if (tipo === 'plantillas_wa') {
    /* Mensajes de bienvenida ya usados en anuncios de WhatsApp de la cuenta
       (saludo, mensaje prellenado, preguntas frecuentes) y secuencias de
       bienvenida. Las plantillas guardadas con "Create template" en Ads Manager
       no tienen endpoint público; estas son las que efectivamente se publicaron. */
    const acc = await actDe();
    const pid = String(b.page_id || '');
    const vistas = {};
    const conj = (await conjuntosWhatsApp(acc)).slice(0, 150);
    if (conj.length) {
      const leidos = await porIds(conj.map(x => x.id),
        'ads.limit(10){name,creative{object_story_spec{page_id,link_data{page_welcome_message},video_data{page_welcome_message}},asset_feed_spec{additional_data}}}');
      Object.keys(leidos).forEach(id => ((leidos[id].ads && leidos[id].ads.data) || []).forEach(ad => {
        const cr = ad.creative || {}, oss = cr.object_story_spec || {};
        let pwm = (oss.link_data && oss.link_data.page_welcome_message) || (oss.video_data && oss.video_data.page_welcome_message) || null;
        if (typeof pwm === 'string') { try { pwm = JSON.parse(pwm); } catch (e) { pwm = null; } }
        const seq = cr.asset_feed_spec && cr.asset_feed_spec.additional_data && cr.asset_feed_spec.additional_data.partner_app_welcome_message_flow_id;
        if (!pwm && !seq) return;
        const m = (pwm && pwm.text_format && pwm.text_format.message) || {};
        const t = {
          saludo: String(m.text || ''),
          prellenado: String((m.autofill_message && m.autofill_message.content) || ''),
          preguntas: (m.ice_breakers || []).map(x => String(x.title || '')).filter(Boolean),
          secuencia: seq ? String(seq) : '',
        };
        const clave = t.secuencia ? 'seq:' + t.secuencia : JSON.stringify([t.saludo, t.prellenado, t.preguntas]);
        const v = vistas[clave] || (vistas[clave] = Object.assign({ id: clave, paginas: [], usos: 0, ejemplo: ad.name || '' }, t));
        v.usos++;
        const pg = String(oss.page_id || ''); if (pg && v.paginas.indexOf(pg) < 0) v.paginas.push(pg);
      }));
    }
    const diagP = {};
    for (const w of await wabasAccesibles(acc, diagP)) {
      try {
        const r = await gGet(base + w.id + '/welcome_message_sequences');
        (r.data || r.welcome_message_sequences || []).forEach(s => {
          const sid = String(s.sequence_id || s.id || ''); if (!sid) return;
          const clave = 'seq:' + sid;
          if (!vistas[clave]) vistas[clave] = { id: clave, saludo: '', prellenado: '', preguntas: [], secuencia: sid, paginas: [], usos: 0, ejemplo: s.name || '' };
          vistas[clave].nombre = s.name || vistas[clave].nombre || '';
        });
      } catch (e) {}
    }
    resultados = Object.keys(vistas).map(k => {
      const v = vistas[k];
      v.conEsta = !!pid && v.paginas.indexOf(pid) >= 0;
      v.n = v.secuencia ? ('Secuencia · ' + (v.nombre || v.ejemplo || v.secuencia)) : (v.saludo || v.prellenado || '(sin texto)').slice(0, 70);
      v.r = v.usos ? ('usado en ' + v.usos + ' anuncio(s)' + (v.conEsta ? ' con esta página' : '')) : 'secuencia de WhatsApp Business';
      return v;
    }).sort((a, b) => (b.conEsta - a.conEsta) || (b.usos - a.usos)).slice(0, 40);
    return [{ json: { resultados, diagnostico: { conjuntosWhatsApp: conj.length, plantillas: resultados.length } } }];

  } else if (tipo === 'fuentes') {
    /* Píxeles (sitio web) y conjuntos de datos offline de la cuenta. */
    const acc = await actDe();
    try {
      const px = await paginar(base + acc + '/adspixels?fields=id,name,last_fired_time,is_unavailable&limit=50', 100);
      const dias = t => t ? Math.floor((Date.now() - Date.parse(t)) / 86400000) : null;
      px.forEach(x => resultados.push({ id: String(x.id), n: x.name || String(x.id), r: 'Píxel',
        tipo: 'PIXEL', ultimo: x.last_fired_time || '', dias: dias(x.last_fired_time), activo: !x.is_unavailable }));
    } catch (e) {}
    try {
      const ds = await paginar(base + acc + '/offline_conversion_data_sets?fields=id,name,last_upload_time&limit=50', 100);
      ds.forEach(x => { if (!resultados.some(r => r.id === String(x.id)))
        resultados.push({ id: String(x.id), n: x.name || String(x.id), r: 'Conjunto de datos offline',
          tipo: 'OFFLINE', ultimo: x.last_upload_time || '', activo: true }); });
    } catch (e) {}
    /* 5.5 · Conjuntos de datos de WhatsApp (API de conversiones para mensajería): uno por cuenta de
       WhatsApp Business (GET /{waba}/dataset). Son los que Meta usa para optimizar compras por WhatsApp. */
    try {
      const wabas = await wabasAccesibles(acc, {});
      for (const w of wabas.slice(0, 10)) {
        try {
          const r = await gGet(base + w.id + '/dataset?fields=id,name');
          const lista_ = Array.isArray(r.data) ? r.data : (r.id ? [r] : []);
          lista_.forEach(x => { if (!x.id) return;
            const ya = resultados.find(y => y.id === String(x.id));
            if (ya) { ya.tipo = 'WHATSAPP'; ya.r = 'Conjunto de datos de WhatsApp · ' + (w.name || w.id); ya.waba = String(w.id); }
            else resultados.push({ id: String(x.id), n: x.name || ('Conjunto de datos de ' + (w.name || w.id)), r: 'Conjunto de datos de WhatsApp · ' + (w.name || w.id), tipo: 'WHATSAPP', waba: String(w.id), activo: true }); });
        } catch (e) {}
      }
    } catch (e) {}

  } else if (tipo === 'pagina_de_campana') {
    /* La página con la que ya publica la campaña: primero por sus anuncios,
       después por el promoted_object de sus conjuntos. */
    const cid = String(b.campaign_id || '');
    let pageId = '';
    try {
      const r = await gGet(base + cid + '/ads?fields=creative{object_story_spec}&limit=5');
      (r.data || []).forEach(ad => {
        const s = ad.creative && ad.creative.object_story_spec;
        if (!pageId && s && s.page_id) pageId = String(s.page_id);
      });
    } catch (e) {}
    if (!pageId) {
      try {
        const r = await gGet(base + cid + '/adsets?fields=promoted_object&limit=5');
        (r.data || []).forEach(a => { if (!pageId && a.promoted_object && a.promoted_object.page_id) pageId = String(a.promoted_object.page_id); });
      } catch (e) {}
    }
    let pageName = '';
    if (pageId) { try { const pg = await gGet(base + pageId + '?fields=name'); pageName = pg.name || ''; } catch (e) {} }
    return [{ json: { page_id: pageId, page_name: pageName } }];

  } else if (tipo === 'conjuntos') {
    /* Conjuntos existentes de las campañas elegidas: sobre ellos se montan
       anuncios nuevos sin tocar segmentación ni presupuesto. */
    const ids = lista(b.campaign_ids);
    for (const cid of ids) {
      let nombreCamp = cid;
      try { const c = await gGet(base + cid + '?fields=name'); nombreCamp = c.name || cid; } catch (e) {}
      const datos = await paginar(base + cid + '/adsets?fields=id,name,effective_status,optimization_goal,destination_type,'
        + 'daily_budget,lifetime_budget&effective_status=["ACTIVE","PAUSED","CAMPAIGN_PAUSED"]&limit=100', 200);
      datos.forEach(a => resultados.push({
        id: String(a.id), n: a.name,
        r: nombreCamp + ' · ' + String(a.effective_status || '').replace('CAMPAIGN_PAUSED', 'campaña en pausa').toLowerCase()
          + (a.optimization_goal ? ' · ' + a.optimization_goal : ''),
        campaign_id: cid, campana: nombreCamp,
        optim: a.optimization_goal || '', estado: a.effective_status || '',
        destino: destinoDe(a.destination_type),
      }));
    }

  } else if (tipo === 'audiencias_cuenta') {
    /* Audiencias guardadas de Ads Manager: una segmentación completa con nombre.
       Distintas de los públicos personalizados (customaudiences). */
    const acc = await actDe();
    const q = texto.toLowerCase();
    const datos = await paginar(base + acc + '/saved_audiences?fields=id,name,approximate_count_lower_bound,'
      + 'approximate_count_upper_bound,time_updated&limit=100', 500);
    resultados = datos
      .filter(d => !q || String(d.name).toLowerCase().indexOf(q) >= 0)
      .slice(0, 8)
      .map(d => {
        const lo = Number(d.approximate_count_lower_bound || 0), hi = Number(d.approximate_count_upper_bound || 0);
        const tam = hi ? (lo.toLocaleString('es-MX') + ' – ' + hi.toLocaleString('es-MX') + ' personas') : 'Audiencia guardada';
        return { id: String(d.id), n: d.name, r: tam };
      });

  } else if (tipo === 'guardadas' || tipo === 'excluidas') {
    const acc = await actDe();
    const q = texto.toLowerCase();
    const datos = await paginar(base + acc + '/customaudiences?fields=id,name,subtype&limit=100', 500);
    resultados = datos
      .filter(d => !q || String(d.name).toLowerCase().indexOf(q) >= 0)
      .slice(0, 8)
      .map(d => ({ id: String(d.id), n: d.name, r: d.subtype || 'Personalizada' }));
  }
} catch (e) {
  return [{ json: { error: explicar(e), code: e.code || '', subcode: e.subcode || '' } }];
}
return [{ json: { resultados } }];
