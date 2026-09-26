/* ---- motor 5.0 · formularios instantáneos (Lead Ads) ----
   accion "formularios":
     op "listar" → formularios de la página (activos primero)
     op "crear"  → crea un formulario en la página y lo devuelve
   Meta exige token de página para leadgen_forms; se obtiene con el del system
   user (tokenPagina, en el cliente compartido). */
const b = $('Recibir').first().json.body || {};
const op = String(b.op || 'listar');
const pageId = String(b.page_id || '');

const TIPOS_PREGUNTA = {
  FULL_NAME: 'Nombre completo', EMAIL: 'Correo', PHONE: 'Teléfono', CITY: 'Ciudad', STATE: 'Estado',
  ZIP: 'Código postal', STREET_ADDRESS: 'Dirección', COMPANY_NAME: 'Empresa', JOB_TITLE: 'Puesto',
  FIRST_NAME: 'Nombre', LAST_NAME: 'Apellido', DATE_OF_BIRTH: 'Fecha de nacimiento', GENDER: 'Género',
};
function resumen(x){
  const qs = ((x.questions || []).map(q => q.type === 'CUSTOM' ? (q.label || 'personalizada') : (TIPOS_PREGUNTA[q.type] || q.type)));
  const estado = String(x.status || '').toUpperCase();
  return {
    id: String(x.id), n: x.name || String(x.id), estado,
    idioma: x.locale || '', preguntas: qs,
    r: (estado === 'ACTIVE' ? 'activo' : estado.toLowerCase()) + (x.locale ? ' · ' + x.locale : '')
      + (qs.length ? ' · ' + qs.slice(0, 4).join(', ') + (qs.length > 4 ? '…' : '') : ''),
    creado: x.created_time || '',
    leads: x.leads_count == null ? null : Number(x.leads_count),
  };
}
const digitos = s => String(s || '').replace(/[^0-9]/g, '');

try {
  if (!pageId) throw new Error('Elige primero la página de Facebook.');
  const tk = await tokenPagina(pageId);

  if (op === 'listar') {
    const out = [];
    let u = base + pageId + '/leadgen_forms?fields=id,name,status,locale,created_time,leads_count,questions{type,label,key}&limit=100';
    for (let i = 0; i < 10 && u; i++) {
      const r = await gGet(u, tk);
      (r.data || []).forEach(x => out.push(resumen(x)));
      u = r.paging && r.paging.next ? r.paging.next : null;
    }
    const vivos = out.filter(x => x.estado !== 'ARCHIVED' && x.estado !== 'DELETED')
      .sort((p, q) => (p.estado === 'ACTIVE' ? 0 : 1) - (q.estado === 'ACTIVE' ? 0 : 1) || String(q.creado).localeCompare(String(p.creado)));
    return [{ json: { resultados: vivos } }];
  }

  if (op === 'crear') {
    const d = b.formulario || {};
    const nombre = String(d.nombre || '').trim();
    const privUrl = String(d.privacidad_url || '').trim();
    if (!nombre) throw new Error('El formulario necesita nombre.');
    if (!/^https:\/\//i.test(privUrl)) throw new Error('La política de privacidad debe ser un enlace https://. Meta la exige en todo formulario.');
    const preguntas = [];
    (d.preguntas || []).forEach(t => { const x = String(t).toUpperCase(); if (TIPOS_PREGUNTA[x] && !preguntas.some(q => q.type === x)) preguntas.push({ type: x }); });
    (d.personalizadas || []).forEach((q, i) => {
      const label = String(q.label || '').trim(); if (!label) return;
      const pq = { type: 'CUSTOM', key: 'pregunta_' + (i + 1), label };
      const ops = (q.opciones || []).map(o => String(o).trim()).filter(Boolean).slice(0, 10);
      if (ops.length) pq.options = ops.map((o, j) => ({ key: 'op_' + (i + 1) + '_' + (j + 1), value: o }));
      preguntas.push(pq);
    });
    if (!preguntas.length) throw new Error('Elige al menos una pregunta.');

    const cierre = d.cierre || {};
    const boton = String(cierre.boton || 'VIEW_WEBSITE').toUpperCase();
    const webUrl = String(cierre.url || '').trim();
    const tel = digitos(cierre.telefono);
    const tyBase = {
      title: String(cierre.titulo || '¡Gracias! Recibimos tus datos').slice(0, 60),
      body: String(cierre.texto || 'Un asesor te contactará muy pronto.').slice(0, 160),
    };
    const payload = {
      name: nombre.slice(0, 200),
      locale: String(d.idioma || 'es_LA'),
      questions: preguntas,
      privacy_policy: { url: privUrl, link_text: String(d.privacidad_texto || 'Aviso de privacidad').slice(0, 70) },
      follow_up_action_url: webUrl || privUrl,
      is_optimized_for_quality: String(d.tipo || '').toUpperCase() === 'INTENCION',
    };
    if (String(d.intro_titulo || '').trim() || String(d.intro_texto || '').trim()) {
      payload.context_card = { title: String(d.intro_titulo || '').slice(0, 60), style: 'PARAGRAPH_STYLE',
        content: [String(d.intro_texto || '').slice(0, 800)].filter(Boolean) };
    }

    const avisos = [];
    const variantes = [];
    /* País del número (ISO de 2 letras) para la pantalla final con WhatsApp o llamada, como la pide Ads Manager. */
    const PAISES = [['593','EC'],['506','CR'],['502','GT'],['503','SV'],['504','HN'],['505','NI'],['507','PA'],['591','BO'],['595','PY'],['598','UY'],
      ['52','MX'],['57','CO'],['54','AR'],['56','CL'],['51','PE'],['58','VE'],['34','ES'],['55','BR'],['1','US']];
    const pais = (PAISES.find(x => tel.indexOf(x[0]) === 0) || [])[1];
    const conPais = o => pais ? Object.assign(o, { country_code: pais }) : o;
    if (boton === 'WHATSAPP') {
      if (tel.length < 10) throw new Error('Para terminar en WhatsApp escribe el número con código de país, por ejemplo +52 81 1454 0207.');
      const texto = String(cierre.mensaje_whatsapp || '').trim();
      /* 1) botón nativo de WhatsApp de Meta; 2) respaldo: botón "Ver sitio" que abre wa.me con el mensaje. */
      variantes.push(conPais(Object.assign({}, tyBase, { button_type: 'WHATSAPP', button_text: String(cierre.texto_boton || 'Chatear en WhatsApp').slice(0, 60), business_phone_number: '+' + tel })));
      variantes.push(Object.assign({}, tyBase, { button_type: 'VIEW_WEBSITE', button_text: String(cierre.texto_boton || 'Chatear en WhatsApp').slice(0, 60),
        website_url: 'https://wa.me/' + tel + (texto ? '?text=' + encodeURIComponent(texto) : '') }));
    } else if (boton === 'CALL_BUSINESS') {
      if (tel.length < 10) throw new Error('Para el botón de llamada escribe el número con código de país.');
      variantes.push(conPais(Object.assign({}, tyBase, { button_type: 'CALL_BUSINESS', button_text: String(cierre.texto_boton || 'Llamar').slice(0, 60), business_phone_number: '+' + tel })));
    } else if (boton === 'NONE') {
      variantes.push(Object.assign({}, tyBase, { button_type: 'NONE' }));
    } else {
      if (!/^https?:\/\//i.test(webUrl)) throw new Error('Para el botón "Ver sitio web" escribe la URL con https://.');
      variantes.push(Object.assign({}, tyBase, { button_type: 'VIEW_WEBSITE', button_text: String(cierre.texto_boton || 'Ver sitio web').slice(0, 60), website_url: webUrl }));
    }

    let creado = null, primerError = null;
    for (let i = 0; i < variantes.length && !creado; i++) {
      try {
        creado = await gPost(pageId + '/leadgen_forms', Object.assign({}, payload, { thank_you_page: variantes[i] }), tk);
        if (i > 0) avisos.push('Meta no aceptó el botón nativo de WhatsApp en la pantalla final (' + explicar(primerError)
          + '). El formulario se creó con un botón que abre WhatsApp por enlace (wa.me) con tu número.');
      } catch (e) { if (!primerError) primerError = e; if (i === variantes.length - 1) throw e; }
    }
    if (!creado || !creado.id) throw new Error('Meta no devolvió el ID del formulario.');
    let info = { id: creado.id, name: nombre, status: 'ACTIVE', locale: payload.locale, questions: preguntas };
    try { info = await gGet(base + creado.id + '?fields=id,name,status,locale,created_time,questions{type,label,key}', tk); } catch (e) {}
    return [{ json: { formulario: resumen(info), avisos } }];
  }

  if (op === 'leads') {
    /* 5.1 · Descarga de leads de un formulario (hasta 2.000 por consulta, del más reciente al más antiguo). */
    const formId = String(b.form_id || '');
    if (!formId) throw new Error('Falta el formulario.');
    const desde = b.desde ? Math.floor(Date.parse(b.desde) / 1000) : 0;
    let u = base + formId + '/leads?fields=id,created_time,ad_name,adset_name,campaign_name,platform,is_organic,field_data&limit=100'
      + (desde ? '&filtering=' + encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desde }])) : '');
    const filas = [], columnas = [];
    const T0 = Date.now();
    for (let i = 0; i < 20 && u && Date.now() - T0 < 19000; i++) {
      const r = await gGet(u, tk);
      (r.data || []).forEach(x => {
        const fila = { fecha: x.created_time || '', lead_id: String(x.id), campana: x.campaign_name || '', conjunto: x.adset_name || '',
          anuncio: x.ad_name || '', plataforma: x.platform || '', organico: x.is_organic ? 'sí' : 'no' };
        (x.field_data || []).forEach(fd => { const k = String(fd.name); if (columnas.indexOf(k) < 0) columnas.push(k); fila[k] = (fd.values || []).join(', '); });
        filas.push(fila);
      });
      u = r.paging && r.paging.next ? r.paging.next : null;
    }
    return [{ json: { filas, columnas: ['fecha','campana','conjunto','anuncio','plataforma','organico'].concat(columnas).concat(['lead_id']), truncado: !!u } }];
  }

  throw new Error('Operación de formularios no reconocida: ' + op);
} catch (e) {
  return [{ json: { error: explicar(e) } }];
}
