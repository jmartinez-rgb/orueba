/* =====================================================================
   Meta Bulk Editor · interfaz — v3
   Pinta las seis pantallas sobre el modelo de model.js y habla con n8n.
   ===================================================================== */
const CFG = Object.assign({endpoint:"", clave:"", hojaUrl:"", entorno:"ABCW", timeout:45}, window.CONFIG || {});
const CONECTADO = !!CFG.endpoint;
const $ = s => document.querySelector(s);
const view = $("#view");

/* ------------------------------------------------------------ transporte */
const DEMO_CUENTAS = [{key:"demo_mx", nombre:"Cliente Demo MX", cuenta:"1", moneda:"MXN", tz:"America/Mexico_City", pixel:"1", ig:true, minImp:40, minConv:120},
  {key:"demo_co", nombre:"Cliente Demo CO", cuenta:"2", moneda:"COP", tz:"America/Bogota", pixel:"2", ig:true, minImp:4000, minConv:12000},
  {key:"demo_mx_norte", nombre:"Cliente Demo MX Norte", cuenta:"3", moneda:"MXN", tz:"America/Monterrey", pixel:"3", ig:false, minImp:40, minConv:120}];
const DEMO_PAQUETE = (origen) => ({ formato:"mbe-export", version:1, origen:{cuenta:origen, nombre:"Cliente Demo CO", moneda:"COP"}, destino:{cuenta:"1", moneda:"MXN"},
  avisos:['Conjunto "Retargeting": el público "Visitantes 30 días" no existe en la cuenta de destino y se quitó de la segmentación.',
          'La campaña "Promo Octubre" está en COP y la cuenta de destino en MXN: el presupuesto quedó en blanco para capturarlo.'],
  campanas:[{ nombre:"Promo Octubre", objetivo:"OUTCOME_SALES", categorias:[], cbo:true, diario:0, total:0, duracionDias:0, puja:"",
    conjuntos:[{ nombre:"Prospección 25-45", meta:"OFFSITE_CONVERSIONS", destino:"WEBSITE", whatsapp:"", evento:"PURCHASE",
        targeting:{geo_locations:{countries:["MX"]}, age_min:25, age_max:45, flexible_spec:[{interests:[{id:"1",name:"Café"}]}], publisher_platforms:["facebook","instagram"]},
        diario:0, total:0, pujaMonto:0,
        anuncios:[{nombre:"Oferta 2x1", textos:["Aprovecha el 2x1 este fin"], titulos:["2x1 solo este fin"], descripcion:"", url:"https://ejemplo.com", cta:"SHOP_NOW", whatsapp:false,
          saludo:"", prellenado:"", preguntas:[], secuencia:"", url_tags:"utm_source=meta", media:{tipo:"IMAGE", urlFeed:"https://ejemplo.com/a.jpg", urlVert:"", urlHoriz:""}}]},
      { nombre:"Retargeting", meta:"OFFSITE_CONVERSIONS", destino:"WEBSITE", whatsapp:"", evento:"PURCHASE",
        targeting:{geo_locations:{countries:["MX"]}, age_min:18, age_max:65}, diario:0, total:0, pujaMonto:0,
        anuncios:[{nombre:"Oferta 2x1", textos:["Aprovecha el 2x1 este fin"], titulos:["2x1 solo este fin"], descripcion:"", url:"https://ejemplo.com", cta:"SHOP_NOW", whatsapp:false,
          saludo:"", prellenado:"", preguntas:[], secuencia:"", url_tags:"utm_source=meta", media:{tipo:"IMAGE", urlFeed:"https://ejemplo.com/a.jpg", urlVert:"", urlHoriz:""}}]}]}]});
const DEMO_LISTA = [{id:"1",n:"Ejemplo uno",r:"demo"},{id:"2",n:"Ejemplo dos",r:"demo"}];
const DEMO_FORMS = [{id:"7101",n:"Cotización izzi · nombre, teléfono, CP",estado:"ACTIVE",r:"activo · es_LA · Nombre completo, Teléfono, Código postal",preguntas:["Nombre completo","Teléfono","Código postal"],leads:128},
  {id:"7102",n:"Formulario prueba (borrador)",estado:"DRAFT",r:"draft · es_LA · Correo",preguntas:["Correo"],leads:0}];
const DEMO_RUN = { t:0 };
const DEMO_RUNS = {};
function demoGestor(d){
  if (d.op === "aplicar"){
    const resultados = (d.cambios || []).map(c => /error/i.test(String((c.campos||{}).name || "")) ? { id:c.id, ok:false, error:"Meta rechazó el cambio (simulado)." } : { id:c.id, ok:true, error:"" });
    resultados.forEach(r => { if (!r.ok) return; const c = d.cambios.find(x => x.id === r.id); const f = DEMO_G.find(x => x.id === r.id); if (!f) return;
      if (c.campos.status) f.estado = f.efectivo = c.campos.status; if (c.campos.name) f.nombre = c.campos.name; if (c.campos.daily_budget) f.diario = c.campos.daily_budget; if (c.campos.lifetime_budget) f.total = c.campos.lifetime_budget; if (c.campos.fin) f.fin = c.campos.fin; });
    return { resultados, aplicados: resultados.filter(r => r.ok).length, fallidos: resultados.filter(r => !r.ok).length };
  }
  const cuentas = lista_(d.cuentas), nivel = d.nivel || "campaign";
  if (!DEMO_G.length) DEMO_CUENTAS.forEach(c => ["Leads CP","Tráfico hogar","WhatsApp ventas","Awareness marca"].forEach((n, i) => ["campaign","adset","ad"].forEach(nv => {
    const id = c.cuenta + "_" + nv + "_" + i;
    DEMO_G.push({ id, nivel:nv, cuenta:c.cuenta, cuentaNombre:c.nombre, moneda:c.moneda, nombre:(nv === "campaign" ? "" : nv === "adset" ? "Conjunto · " : "Anuncio · ") + "izzi · " + n,
      estado: i === 3 ? "PAUSED" : "ACTIVE", efectivo: i === 3 ? "PAUSED" : (i === 2 && nv === "ad" ? "WITH_ISSUES" : "ACTIVE"), objetivo:"", padre: nv === "campaign" ? "" : "izzi · " + n,
      diario: (nv === "campaign" && i !== 1) || (nv === "adset" && i === 1) ? (c.moneda === "COP" ? 80000 : 500 + i * 250) : 0, total:0, fin: i === 0 ? "2026-10-31T23:59:00-0600" : "",
      gasto: (i + 1) * (c.moneda === "COP" ? 90000 : 1800), impresiones:(i + 1) * 42000, clics:(i + 1) * 610, leads: i === 0 ? 64 : 0, conversaciones: i === 2 ? 38 : 0, compras: i === 1 ? 5 : 0 }); })));
  const est = lista_(d.estados);
  const filas = DEMO_G.filter(f => cuentas.includes(f.cuenta) && f.nivel === nivel && (!est.length || est.includes(f.efectivo)) && (!d.texto || f.nombre.toLowerCase().includes(String(d.texto).toLowerCase())));
  return { filas: JSON.parse(JSON.stringify(filas)), cuentas: DEMO_CUENTAS.filter(c => cuentas.includes(c.cuenta)).map(c => ({ id:c.cuenta, nombre:c.nombre, moneda:c.moneda, minimo:c.minImp, objetos: filas.filter(f => f.cuenta === c.cuenta).length })), errores:[] };
}
const DEMO_G = [];
const lista_ = v => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
async function llamar(accion, datos, limiteMB){
  if (!CONECTADO){
    await new Promise(r => setTimeout(r, 250));
    const d = datos || {};
    if (accion === "cuentas") return {cuentas: DEMO_CUENTAS, motor_version: SITIO_VERSION};
    if (accion === "prevalidar") return S.anuncios.some(a => /rechaz/i.test(a.nombre)) ? {ok:false, problemas:["Modo demostración: el anuncio con \"rechazo\" en el nombre simula un problema que Meta rechazaría."]} : {ok:true, problemas:[]};
    if (accion === "buscar"){
      if (d.tipo === "paises") return {resultados:[{id:"MX",n:"México",r:"País"},{id:"CO",n:"Colombia",r:"País"},{id:"US",n:"Estados Unidos",r:"País"}]};
      if (d.tipo === "paginas") return {resultados:[{id:"p1",n:"Página Demo",r:""}]};
      if (d.tipo === "pagina_de_campana") return {page_id:"p1", page_name:"Página Demo"};
      if (d.tipo === "whatsapp") return {resultados:[
        {id:"+5218114540207",n:"+52 1 81 1454 0207",r:"usado en 3 conjunto(s) con esta página",grupo:"ESTA_PAGINA",usos:3},
        {id:"+525512345678",n:"+52 55 1234 5678",r:"WhatsApp Business: izzi ventas",grupo:"WABA",usos:0},
        {id:"+573001234567",n:"+57 300 123 4567",r:"usado con otra página",grupo:"OTRA_PAGINA",usos:1}]};
      if (d.tipo === "whatsapp_info"){
        const n = await llamar("buscar", Object.assign({}, d, {tipo:"whatsapp"})), t = await llamar("buscar", Object.assign({}, d, {tipo:"plantillas_wa"})), c = await llamar("buscar", Object.assign({}, d, {tipo:"config_whatsapp"}));
        return {numeros:n.resultados, plantillas:t.resultados, configs:c.resultados, diagnostico:{conjuntosRevisados:12, conjuntosWhatsApp:3, numerosEnAnuncios:1, wabas:1, negocios:["ABCW"], nombresWaba:["izzi"]}};
      }
      if (d.tipo === "preview") return {previews:["MOBILE_FEED_STANDARD","INSTAGRAM_STANDARD","INSTAGRAM_STORY"].map(f => ({formato:f, src:"https://www.facebook.com/ads/api/preview_iframe.php?d=demo&f=" + f, error:""}))};
      if (d.tipo === "diagnostico_referencia") return {pasos:[
        {paso:"Leer la referencia", ok:true, detalle:"Conjunto \"SKATE ROCK 23.09\" (PAUSED) · optimización OFFSITE_CONVERSIONS · destino WHATSAPP · campaña: objetivo OUTCOME_ENGAGEMENT"},
        {paso:"Copiar la campaña (sin conjuntos)", ok:true, detalle:"Copia 120200"},
        {paso:"Copiar el conjunto dentro de la copia", ok:false, detalle:"Meta no acepta esa combinación… · Campo señalado por Meta: optimization_goal [100/2490408 · traza AbC123]"},
        {paso:"Copia profunda de la campaña de referencia", ok:true, detalle:"Copia 120201 con 4 objetos · la copia profunda FUNCIONA"},
        {paso:"Limpieza", ok:true, detalle:"Se eliminaron 2 de 2 objetos de prueba."}]};
      if (d.tipo === "publicaciones") return {resultados:[
        {id:"p1_101",origen:"FACEBOOK",n:"Internet + TV desde $350 al mes. Contrata hoy y recibe instalación gratis.",img:"",fecha:"2026-09-20T15:00:00Z",elegible:true},
        {id:"1790",origen:"INSTAGRAM",n:"Nuevo paquete con Universal+ incluido. Pregunta por disponibilidad en tu zona.",img:"",fecha:"2026-09-18T15:00:00Z",elegible:true},
        {id:"p1_99",origen:"FACEBOOK",n:"Evento de lanzamiento (publicación compartida)",img:"",fecha:"2026-09-10T15:00:00Z",elegible:false}], avisos:[]};
      if (d.tipo === "chequeo_meta") return { revisado: new Date().toISOString(), pasos: [
        { grupo:"WhatsApp", punto:"Número vinculado a la página", estado:"revisar", detalle:"Modo demostración: Meta no reporta un número de WhatsApp vinculado a la página; si no lo está, Meta rechaza los conjuntos que van a WhatsApp (error 2446886).", como:"Vincula el número de WhatsApp Business en la configuración de la página (Cuentas vinculadas → WhatsApp)." },
        { grupo:"Cuenta", punto:"Estado", estado:"falla", detalle:"Modo demostración: la cuenta tiene pagos pendientes y Meta no entrega anuncios.", como:"Resuélvelo en la configuración de pagos de Business Manager." },
        { grupo:"Token", punto:"Permisos opcionales", estado:"revisar", detalle:"Sin pages_read_user_content (publicaciones de la página como anuncio).", como:"Agrégalo al token si quieres usar esa función." },
        { grupo:"Medición", punto:"Píxel \"Facebook 3 B Event Data\"", estado:"revisar", detalle:"Último evento hace 9 días.", como:"Revisa la instalación en el Administrador de eventos antes de optimizar o medir con él." },
        { grupo:"API", punto:"Versión de la API", estado:"ok", detalle:"META_API_VERSION es v25.0.", como:"" },
        { grupo:"Token", punto:"Tipo y vigencia", estado:"ok", detalle:"Token de system user, no vence.", como:"" },
        { grupo:"Token", punto:"Permisos necesarios", estado:"ok", detalle:"Tiene los 8 permisos que usa la herramienta.", como:"" },
        { grupo:"Página", punto:"Instagram", estado:"ok", detalle:"Cuenta de Instagram conectada (@demo).", como:"" },
        { grupo:"Formularios", punto:"Condiciones de Lead Ads", estado:"ok", detalle:"La página aceptó las condiciones de los anuncios para clientes potenciales.", como:"" },
        { grupo:"App", punto:"Modo de la app", estado:"info", detalle:"La API no informa si la app está en modo activo.", como:"La app debe estar en modo Live y el Business verificado." } ] };
      if (d.tipo === "lote_resultados") return {resultados: lista_(d.campaign_ids).map((id, i) => ({id, nombre:"Campaña demo " + (i+1), gasto: 1250 * (i+1), moneda:"MXN", impresiones: 84000 * (i+1), clics: 1320 * (i+1), leads: 41 * (i+1), conversaciones: 12 * (i+1), compras: 3 * (i+1), universo: i ? "offline" : "chat"}))};
      if (d.tipo === "lote") return {objetos:{campanas:[{id:"C1",name:"izzi · Promo 350",estado:"PAUSED",diario:500}], conjuntos:[{id:"S1",name:"MX 25-45",estado:"PAUSED"}], anuncios:[{id:"A1",name:"Oferta A",estado:"PAUSED"},{id:"A2",name:"Oferta B",estado:"PAUSED"}]}};
      if (d.tipo === "lote_accion") return {ok:[].concat(d.ids.campanas||[], d.ids.conjuntos||[], d.ids.anuncios||[]).length, fallos:[], omitidos:0};
      if (d.tipo === "config_conjunto") return {config:{id:"120211", n:"Conjunto pegado por ID", compras:true, objetivo:"OUTCOME_SALES", r:"OUTCOME_SALES · OFFSITE_CONVERSIONS · WHATSAPP", config:{optimization_goal:"OFFSITE_CONVERSIONS", destination_type:"WHATSAPP", promoted_object:{page_id:"p1", custom_event_type:"PURCHASE", pixel_id:"DS1"}}}};
      if (d.tipo === "config_whatsapp") return {resultados:[
        {id:"238500", n:"Rolling Stones Vegetable", compras:true, puntaje:6.5, campanaId:"238400", cuenta:"1", objetivo:"OUTCOME_ENGAGEMENT", r:"OUTCOME_ENGAGEMENT · OFFSITE_CONVERSIONS · WHATSAPP · campaña \"WhatsApp// CAPI WHATSAPP Prueba 23 - sep\"",
         config:{optimization_goal:"OFFSITE_CONVERSIONS", destination_type:"WHATSAPP", billing_event:"IMPRESSIONS", promoted_object:{page_id:"p1", whatsapp_phone_number:"+5218114540207", pixel_id:"2950494825239430", custom_event_type:"PURCHASE"}}},
        {id:"238501", n:"Play norteña", compras:false, puntaje:0.5, campanaId:"238400", cuenta:"1", objetivo:"OUTCOME_ENGAGEMENT", r:"OUTCOME_ENGAGEMENT · CONVERSATIONS · WHATSAPP", config:{optimization_goal:"CONVERSATIONS", destination_type:"WHATSAPP", promoted_object:{page_id:"p1"}}}]};
      if (d.tipo === "plantillas_wa") return {resultados:[
        {id:"t1",n:"¡Hola! ¿Cómo podemos ayudarte?",r:"usado en 4 anuncio(s) con esta página",saludo:"¡Hola! ¿Cómo podemos ayudarte?",prellenado:"¡Hola, quiero contratar izzi!",preguntas:[],secuencia:"",conEsta:true},
        {id:"t2",n:"Bienvenido a izzi",r:"usado en 2 anuncio(s)",saludo:"Bienvenido a izzi",prellenado:"",preguntas:["¿Qué paquetes tienen?","¿Hay cobertura en mi zona?"],secuencia:"",conEsta:false}]};
      if (d.tipo === "fuentes") return {resultados:[{id:"1743510677085693",n:"Facebook 3 B Event Data",r:"Píxel",tipo:"PIXEL",activo:true},{id:"2950494825239430",n:"CAPI-Offline",r:"Conjunto de datos offline",tipo:"OFFLINE",activo:true},{id:"1188776655443322",n:"izzi WhatsApp CAPI",r:"Conjunto de datos de WhatsApp · izzi WABA",tipo:"WHATSAPP",activo:true}]};
      if (d.tipo === "resolver_wa") return d.dataset ? { ok:true, elegido: d.cambiar_objetivo ? { objetivo:"OUTCOME_SALES", optimization_goal:"OFFSITE_CONVERSIONS", etiqueta:"Ventas · conversiones con el conjunto de datos " + d.dataset + " (PURCHASE)" }
          : { objetivo:"OUTCOME_ENGAGEMENT", optimization_goal:"MESSAGING_PURCHASE_CONVERSION", etiqueta:"Interacción · compras por mensajes con el conjunto de datos " + d.dataset },
        intentos: d.config ? [{ etiqueta:"igual a la referencia", error:"Modo demostración: No puedes usar el objetivo de rendimiento seleccionado con tu objetivo de campaña. [100/2490408]" }] : [], sin_prueba:[] }
        : { ok:false, elegido:null, sin_prueba:[], intentos:[{ etiqueta:"Interacción · compras por mensajes", error:"Modo demostración: No puedes usar el objetivo de rendimiento seleccionado con tu objetivo de campaña. [100/2490408]" }] };
      if (d.tipo === "campanas") return {resultados: d.cuenta_id === "2"
        ? [{id:"7001",n:"Promo Octubre",r:"OUTCOME_SALES · ACTIVE",objetivo:"OUTCOME_SALES",cbo:true,categorias:[],estado:"ACTIVE",gasto30:1250000,moneda:"COP"},
           {id:"7002",n:"Awareness Marca",r:"OUTCOME_AWARENESS · PAUSED",objetivo:"OUTCOME_AWARENESS",cbo:true,categorias:[],estado:"PAUSED",gasto30:0,moneda:"COP"}]
        : [{id:"9001",n:"Campaña existente demo",r:"OUTCOME_SALES · ACTIVE",objetivo:"OUTCOME_SALES",cbo:true,categorias:[],estado:"ACTIVE",gasto30:18000,moneda:"MXN"}]};
      if (d.tipo === "importar") return DEMO_PAQUETE(d.origen_cuenta_id);
      if (d.tipo === "conjuntos") return {resultados:[{id:"5001",n:"Conjunto demo A",r:"Campaña existente demo · active · LINK_CLICKS",campaign_id:"9001",campana:"Campaña existente demo",optim:"LINK_CLICKS",destino:"WEBSITE"},{id:"5002",n:"Conjunto demo WhatsApp",r:"Campaña existente demo · active · CONVERSATIONS",campaign_id:"9001",campana:"Campaña existente demo",optim:"CONVERSATIONS",destino:"WHATSAPP"},{id:"5003",n:"Conjunto demo formulario",r:"Campaña existente demo · active · LEAD_GENERATION",campaign_id:"9001",campana:"Campaña existente demo",optim:"LEAD_GENERATION",destino:"FORMULARIO"}]};
      return {resultados: DEMO_LISTA};
    }
    if (accion === "subir"){
      if (d.fase === "imagen") return {hash:"demo_" + uid()};
      if (d.fase === "video_inicio") return {sesion:"s", video_id:"v_" + uid(), inicio:0, fin:Math.min(d.tamano, 1048576)};
      if (d.fase === "video_parte"){ const ini = d.inicio + Math.round(d.datos.length * 0.75); const tot = +(d._total||ini); return {inicio:ini, fin:Math.min(tot, ini + 1048576)}; }
      if (d.fase === "video_fin") return {ok:true, video_id:d.video_id};
      return {};
    }
    if (accion === "formularios"){
      if (d.op === "leads") return { filas:[{fecha:"2026-09-24T18:02:00Z", campana:"izzi · Leads CP", conjunto:"CDMX formulario", anuncio:"Cotiza hoy", plataforma:"ig", organico:"no", full_name:"Nombre Demo", phone_number:"+5215555555555", lead_id:"1"}],
        columnas:["fecha","campana","conjunto","anuncio","plataforma","organico","full_name","phone_number","lead_id"], truncado:false };
      if (d.op === "crear"){ const x = { id:"f_" + uid(), n:(d.formulario||{}).nombre || "Formulario nuevo", estado:"ACTIVE", r:"activo · es_LA · " + ((d.formulario||{}).preguntas||[]).length + " preguntas" }; DEMO_FORMS.unshift(x);
        return { formulario:x, avisos: (d.formulario||{}).cierre && d.formulario.cierre.boton === "WHATSAPP" ? ["Modo demostración: en Meta se intenta primero el botón nativo de WhatsApp."] : [] }; }
      return { resultados: DEMO_FORMS.slice() };
    }
    if (accion === "gestor") return demoGestor(d);
    if (accion === "historial") return { corridas:[
      { run_id:"run_20260925101500_a1", inicio:"2026-09-25T15:15:00Z", cuenta:"1", campana:"izzi · Leads CP · Consideración · Sep26", estado:"OK_CON_AVISOS", anuncios:12, previstos:12, mensaje:"Listo. Se crearon 1 campaña nueva, 3 conjuntos nuevos, 12 anuncios.", fallos:[], avisos:["Conjunto \"GDL\": el número se envió como +528114540207 (formato que Meta aceptó)."] },
      { run_id:"run_20260924183000_b2", inicio:"2026-09-24T23:30:00Z", cuenta:"3", campana:"izzi · Tráfico · Sep26", estado:"PARCIAL", anuncios:7, previstos:9, mensaje:"Se publicaron 7 anuncio(s), pero 2 elemento(s) fallaron.", fallos:["Anuncio \"B3\": no se creó porque su creativo falló (Invalid image)."], avisos:[] },
      { run_id:"run_20260923120000_c3", inicio:"2026-09-23T17:00:00Z", cuenta:"1", campana:"prueba · WhatsApp", estado:"RECHAZADO", anuncios:0, previstos:2, mensaje:"El plan no se publicó.", fallos:["El formulario \"Borrador\" está DRAFT: solo se pueden usar formularios activos."], avisos:[] }] };
    if (accion === "publicar"){ const id = "demo_" + d.cuenta_id; DEMO_RUNS[id] = { t:0, cuenta:d.cuenta_id, n:((d.filas||{}).ads||[]).length }; return {estado:"EN_PROCESO", run_id:id}; }
    if (accion === "estado"){
      const run = DEMO_RUNS[d.run_id] || { t:0, n:instancias().length }; run.t++; DEMO_RUN.t = run.t;
      const tot = run.n;
      const fases = ["validacion","creativos","campanas","conjuntos","anuncios"];
      if (run.t < 5) return {estado:"EN_PROCESO", fase: fases[DEMO_RUN.t], mensaje:"Tramo " + DEMO_RUN.t + " · " + fases[DEMO_RUN.t] + " · " + Math.round(tot * Math.max(0, DEMO_RUN.t - 3) / 2) + " de " + tot + " anuncios creados", anuncios: Math.round(tot * Math.max(0, DEMO_RUN.t - 3) / 2), previstos: tot};
      if (S.campanas.some(c => /demo-error/i.test(nombreCampana(c))) && run.cuenta !== "3") return {estado:"ERROR", mensaje:"No se pudo publicar: Conjunto \"MXN - WhatsApp\": Meta no acepta esa combinación de objetivo y optimización en esta cuenta. [100/2490408] (simulado)", anuncios:0, previstos:tot,
        fallos:["Conjunto \"MXN - WhatsApp\": Meta no acepta esa combinación de objetivo y optimización en esta cuenta. [100/2490408] (simulado)"], avisos:[], inicio:"2026-09-25T20:00:00Z", actualizado:"2026-09-25T20:01:00Z"};
      if (run.cuenta === "3") return {estado:"PARCIAL", mensaje:"Modo demostración: réplica con un error simulado.", anuncios: Math.max(0, tot - 1), previstos: tot, fallos:["Anuncio \"Cotiza hoy\": el formulario no pertenece a esta página (simulado)."], avisos:["Conjunto \"CDMX formulario\": el público \"Visitantes 30 días\" no existe en esta cuenta y se quitó de la segmentación."], inicio:"2026-09-25T20:00:00Z", actualizado:"2026-09-25T20:02:40Z"};
      return {estado:"OK_CON_AVISOS", mensaje:"Modo demostración: nada se envió a Meta.", anuncios: tot, previstos: tot, fallos:[], avisos:["Modo demostración: así se ven los avisos del motor.", "Conjunto \"MTY WhatsApp\": el número se envió como +528114540207 (formato que Meta aceptó)."], inicio:"2026-09-25T20:00:00Z", actualizado:"2026-09-25T20:03:10Z"};
    }
    return {};
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CFG.timeout * 1000);
  const cuerpo = JSON.stringify(Object.assign({accion}, CFG.clave ? {clave: CFG.clave} : {}, datos || {}));
  const mb = cuerpo.length / 1048576;
  if (mb > (limiteMB || LIMITE_ENVIO_MB)) throw new Error("El envío pesa " + mb.toFixed(1) + " MB y el máximo es " + (limiteMB || LIMITE_ENVIO_MB) + " MB.");
  try {
    const res = await fetch(CFG.endpoint, { method:"POST", headers:{"Content-Type":"application/json","X-PMOS":"1"}, credentials:"same-origin", body: cuerpo, signal: ctl.signal });
    const texto = await res.text();
    let body = null; try { body = JSON.parse(texto); } catch(e){ body = null; }
    if (res.ok && body && body.error) throw new Error(body.error);
    if (!res.ok) throw errorDeConexion(res, body, texto, accion, mb);
    return body || {};
  } catch(e){
    if (e.name === "AbortError") throw new Error("El webhook tardó más de " + CFG.timeout + " segundos.");
    if (e instanceof TypeError){ const x = new Error("No se pudo contactar el webhook. Revisa tu conexión, _redirects y que el workflow esté activo en n8n."); x.conexion = true; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}
/* Traduce una respuesta fallida a un mensaje que dice QUIÉN la rechazó y qué hacer.
   El motor siempre responde JSON con "error"; si no lo trae, la respuesta vino de
   Netlify (protección de acceso, proxy) o de n8n (autenticación del webhook, ruta inactiva). */
function errorDeConexion(res, body, texto, accion, mb){
  const st = res.status, plano = String(texto || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const deN8n = body && (body.message || body.code) && !body.error;
  let m;
  if (body && body.error) m = body.error;
  else if ((st === 401 || st === 403) && deN8n)
    m = "n8n rechazó la llamada (" + st + ": " + (body.message || "sin detalle") + "). En n8n, abre el nodo Recibir y deja Authentication en None; verifica también que solo un workflow activo use la ruta meta-bulk-captura.";
  else if (st === 401){ m = "Tu sesión venció. Inicia sesión de nuevo con tu cuenta corporativa (el plan quedó guardado; recupéralo con «Recuperar»)."; setTimeout(() => { location.href = "/login?returnTo=/plan/"; }, 2500); }
  else if (st === 401 || st === 403)
    m = "La sesión del sitio venció o la protección de acceso de Netlify bloqueó la llamada (" + st + "). Recarga la página e inicia sesión de nuevo: el plan está guardado y lo recuperas con «Recuperar» en el primer paso.";
  else if (st === 404)
    m = "n8n no encontró el webhook (404). Activa el workflow del motor en n8n y revisa que _redirects apunte a /webhook/ (no a /webhook-test/).";
  else if (st === 502 || st === 503 || st === 504)
    m = "El proxy de Netlify no obtuvo respuesta de n8n a tiempo (" + st + "). Si fue al enviar, revisa el historial antes de reintentar: la publicación pudo haber empezado.";
  else m = "El servidor respondió " + st + (plano ? ": " + plano : "") + (accion === "publicar" ? " · envío de " + mb.toFixed(1) + " MB" : "");
  const e = new Error(m); e.status = st; e.conexion = !(body && body.error); return e;
}
const ctx = () => ({client_key:S.clienteKey, cuenta_id:(cliente()||{}).cuenta});

/* ----------------------------------------------------------- imágenes */
/* Imagen: se optimiza en el navegador (2048 px por lado; JPEG que baja de calidad
   hasta quedar en 4 MB o menos) y se guarda una miniatura liviana para la interfaz. */
const LIMITE_VIDEO_GB = 4;
/* Lectura de la imagen en tres intentos, del más directo al más compatible:
   1. createImageBitmap(file): no usa URLs, así que la política de seguridad no interviene.
   2. URL blob: temporal.
   3. FileReader a data:, que siempre está permitido.
   HEIC (fotos de iPhone) no se puede decodificar en la mayoría de navegadores. */
async function decodificar(file){
  if (/hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type)) throw new Error("Es una foto HEIC de iPhone: expórtala como JPG o PNG y vuelve a subirla.");
  if (typeof createImageBitmap === "function"){
    try { const bm = await createImageBitmap(file); return { fuente: bm, ancho: bm.width, alto: bm.height, cerrar: () => bm.close && bm.close() }; } catch(e){}
  }
  const cargar = src => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(); img.src = src; });
  try { const url = URL.createObjectURL(file); const img = await cargar(url); return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) }; } catch(e){}
  const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error("No se pudo leer el archivo.")); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
  try { const img = await cargar(dataUrl); return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => {} }; }
  catch(e){ throw new Error("El navegador no pudo abrir " + file.name + " como imagen (" + (file.type || "tipo desconocido") + "). Prueba exportarla de nuevo como JPG o PNG."); }
}
async function leerImagen(file){
  if (file.size > 200 * 1048576) throw new Error("La imagen pesa más de 200 MB.");
  const im = await decodificar(file);
  try {
    const MAX = 2048, k = Math.min(1, MAX / Math.max(im.ancho, im.alto));
    const w = Math.round(im.ancho*k), h = Math.round(im.alto*k);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0,0,w,h); cx.drawImage(im.fuente, 0, 0, w, h);
    let q = 0.92, dataUrl = cv.toDataURL("image/jpeg", q);
    while (dataUrl.length * 0.75 > 4 * 1048576 && q > 0.5){ q -= 0.08; dataUrl = cv.toDataURL("image/jpeg", q); }
    const t = document.createElement("canvas"), kt = Math.min(1, 160 / Math.max(w, h));
    t.width = Math.max(1, Math.round(w*kt)); t.height = Math.max(1, Math.round(h*kt)); t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
    return { nombre:file.name, ancho:w, alto:h, datos:dataUrl.split(",")[1], kb:Math.round(dataUrl.length*0.75/1024),
             kbOriginal:Math.round(file.size/1024), preview:t.toDataURL("image/jpeg", 0.7) };
  } finally { im.cerrar(); }
}
function aBase64(blob){
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error("No se pudo leer el archivo.")); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
function pintarProgreso(c, campo){
  const el = document.querySelector(`[data-cr="${c.id}"] [data-prog="${campo}"]`);
  const l = (c.local||{})[campo]; if (!el || !l) return;
  el.querySelector(".barra i").style.width = Math.round((l.progreso||0)*100) + "%";
  el.querySelector(".pct").textContent = Math.round((l.progreso||0)*100) + " % · " + (l.etapa || "");
}
/* Sube el archivo a la cuenta publicitaria en el momento de elegirlo.
   Imagen: una llamada. Video: por partes, en los tramos que indica Meta. */
async function subirArchivo(c, campo, file){
  const cl = cliente(); if (!cl) throw new Error("Elige primero la cuenta.");
  const esVideo = /^video\//.test(file.type);
  c.local = c.local || {};
  const l = c.local[campo] = { nombre:file.name, kb:Math.round(file.size/1024), subiendo:true, progreso:0, etapa:"preparando", tipo: esVideo ? "VIDEO" : "IMAGE" };
  c[campo] = "";
  render();
  try {
    if (!esVideo){
      const im = await leerImagen(file);
      Object.assign(l, { ancho:im.ancho, alto:im.alto, preview:im.preview, kb:im.kb, kbOriginal:im.kbOriginal, etapa:"subiendo a Meta", progreso:0.5 });
      pintarProgreso(c, campo);
      const r = await llamar("subir", {fase:"imagen", datos:im.datos, cuenta_id:cl.cuenta}, 8);
      Object.assign(l, { hash:r.hash, cuenta:cl.cuenta, subiendo:false, progreso:1, etapa:"listo" });
      toast(file.name + " quedó en la cuenta.");
    } else {
      if (file.size > LIMITE_VIDEO_GB * 1073741824) throw new Error("El video pesa más de " + LIMITE_VIDEO_GB + " GB, el máximo que admite Meta.");
      l.etapa = "iniciando"; pintarProgreso(c, campo);
      let r = await llamar("subir", {fase:"video_inicio", tamano:file.size, cuenta_id:cl.cuenta});
      const sesion = r.sesion, videoId = r.video_id;
      let ini = r.inicio, fin = r.fin;
      while (ini < fin){
        const datos = await aBase64(file.slice(ini, fin));
        let rr = null;
        for (let intento = 0; intento < 4 && !rr; intento++){
          try { rr = await llamar("subir", {fase:"video_parte", sesion, inicio:ini, datos, cuenta_id:cl.cuenta, _total:file.size}, 16); }
          catch(e){ if (intento === 3) throw e; l.etapa = "reintentando"; pintarProgreso(c, campo); await esperar(2000 * (intento + 1)); }
        }
        ini = rr.inicio; fin = rr.fin;
        l.progreso = Math.min(0.99, ini / file.size); l.etapa = "subiendo"; pintarProgreso(c, campo);
      }
      l.etapa = "cerrando"; pintarProgreso(c, campo);
      await llamar("subir", {fase:"video_fin", sesion, video_id:videoId, nombre:file.name, cuenta_id:cl.cuenta});
      Object.assign(l, { video_id:videoId, cuenta:cl.cuenta, subiendo:false, progreso:1, etapa:"listo · Meta lo procesa antes de publicar" });
      toast(file.name + " se subió; Meta lo procesa antes de publicar.");
    }
  } catch(e){
    Object.assign(l, { subiendo:false, fallo:e.message });
    toast("No se pudo subir " + file.name + ": " + e.message, "stop");
  }
  render();
}

/* ------------------------------------------------------------ armazón */
function pintarPasos(){
  if (S.modo === "gestor"){
    $("#steps").innerHTML = `<span class="modo-t">${icono("grafica")} Gestor multicuenta</span><button class="step" id="salirGestor">← Crear campañas</button>`;
    $("#salirGestor").onclick = salirGestor; return;
  }
  const pend = S.cargando || S.fallo ? [0,0,0,0,0,0] : pendientesPorPaso();
  $("#steps").innerHTML = PASOS.map((p,i) => {
    const malo = i < S.paso && pend[i];
    return `<button class="step ${i<S.paso?(malo?"pend":"done"):""}" data-p="${i}" aria-current="${i===S.paso}" ${i>S.paso?"disabled":""} title="${malo ? pend[i] + " pendiente(s) en este paso" : esc(p.t)}">
      <span class="n">${malo ? "!" : String(i+1)}</span><span class="st">${esc(p.t)}</span></button>`; }).join("");
  $("#steps").querySelectorAll(".step").forEach(b => b.onclick = () => { S.paso = +b.dataset.p; render(); });
  /* Avance del plan: pasos 1-5 completos (sin pendientes) sobre 5; la barra vive bajo el encabezado. */
  const av = $("#avance");
  if (av){ const hechos = S.clienteKey ? [1,2,3,4].filter(i => i < S.paso && !pend[i]).length + (S.clienteKey ? 1 : 0) : 0;
    av.style.width = Math.round(Math.min(hechos, 5) / 5 * 100) + "%"; av.className = pend.slice(0, S.paso).some(Boolean) ? "con-pend" : ""; }
  const nx = $("#next"); if (nx && S.paso < 5) nx.textContent = window.innerWidth < 760 ? "Continuar" : "Continuar: " + PASOS[S.paso + 1].t;
}
function pintarContador(){
  const ta = $("#tAdsets"); if (ta) ta.textContent = conjuntosActivos().length;
  const tb = $("#tAds"); if (tb) tb.textContent = instancias().length;
  const n = $("#nAlertas");
  if (n){ const l = S.cargando || S.fallo || !S.clienteKey || S.modo === "gestor" ? [] : alertasVisibles(); const b = l.filter(a => a.nivel === "bloquea").length, r = l.filter(a => a.nivel === "revisar").length;
    n.textContent = b || r; n.className = "badge " + (b ? "stop" : r ? "warn" : "hide"); }
}
function fmt(n){ return (Math.round(n*100)/100).toLocaleString("es-MX"); }
function pintarResumen(){
  const box = $("#resumen"); if (!box) return;
  const cl = cliente(), inv = inversion(), inst = instancias();
  const alr = S.clienteKey ? alertasVisibles() : [];
  const nNuevas = S.campanas.filter(c => c.modo === "NUEVA").length, nExist = S.campanas.length - nNuevas;
  const nConj = conjuntosActivos().length, nConjNuevos = S.conjuntos.filter(k => k.modo === "NUEVO").length;
  const mon = cl ? " " + cl.moneda : "";
  box.innerHTML = `
    <div class="res-h"><span>Resumen del plan</span><small>${cl ? esc(cl.nombre) : "sin cuenta"}</small></div>
    <div class="res-kpis">
      <div><b>${S.campanas.length}</b><small>${nNuevas} nuevas · ${nExist} exist.</small><span>campañas</span></div>
      <div><b>${nConj}</b><small>${nConjNuevos} nuevos</small><span>conjuntos</span></div>
      <div><b>${inst.length}</b><small>${S.anuncios.length} definidos</small><span>anuncios</span></div>
    </div>
    <div class="res-inv">
      <div><span>Inversión diaria nueva</span><b>${fmt(inv.diaria)}${mon}</b></div>
      ${inv.total ? `<div><span>Presupuesto total nuevo</span><b>${fmt(inv.total)}${mon}</b></div>` : ""}
      ${inv.existenteDiaria ? `<div class="dim"><span>Ya corriendo en existentes</span><b>${fmt(inv.existenteDiaria)}${mon}/día</b></div>` : ""}
    </div>
    <div class="res-arbol">${S.campanas.length ? S.campanas.map(c => {
      const ks = conjuntosDe(c).filter(k => k.modo === "NUEVO" || k.sel);
      return `<div class="ra-c"><span class="ra-t">${c.modo==="EXISTENTE"?"◆":"◇"} ${esc(nombreCampana(c))}</span><span class="ra-m">${esc(presupuestoRama(c))}</span>
        ${ks.map(k => { const n = inst.filter(x => x.k.id === k.id).length; return `<div class="ra-k"><span class="ra-t">${icono(ICONO_DESTINO[destinoConjunto(k)] || "web", "xs")}${esc(nombreConjunto(k))}</span><span class="ra-m">${n} ${n===1?"anuncio":"anuncios"}${k.modo==="NUEVO" && llevaPresupuestoConjunto(c) && k.presupuesto ? " · " + esc(k.presupuesto) + "/día" : ""}</span></div>`; }).join("")}
      </div>`; }).join("") : `<div class="ra-vacio">El árbol se arma aquí a medida que agregas campañas.</div>`}</div>
    ${estadoPlanHTML()}
    <div class="res-al">${S.paso > 0 ? alertasHTML(alr, { max: 3 }) : ""}</div>`;
  box.querySelectorAll("[data-estado-paso]").forEach(b => b.onclick = () => { if (S.enviando) return; S.paso = +b.dataset.estadoPaso; S.enviado = ""; render(); });
}
/* Estado del plan por paso (5.4): completo, con pendientes o por llenar. */
function estadoPlanHTML(){
  if (!S.clienteKey) return "";
  const pend = pendientesPorPaso();
  const filas = [1,2,3,4].map(i => {
    const n = pend[i], abierto = i <= S.paso;
    const cls = !abierto ? "futuro" : n ? "pend" : "ok";
    const txt = !abierto ? "por llenar" : n ? n + (n === 1 ? " pendiente" : " pendientes") : "completo";
    return `<button type="button" class="ep ${cls}" data-estado-paso="${i}" ${i > S.paso ? "disabled" : ""}><span class="ep-i">${icono(cls === "ok" ? "ok" : cls === "pend" ? "stop" : "info")}</span><span class="ep-t">${esc(PASOS[i].t)}</span><span class="ep-s">${txt}</span></button>`;
  }).join("");
  const listo = [1,2,3,4].every(i => i <= S.paso && !pend[i]) && !problemas(5).length;
  return `<div class="res-estado"><div class="res-sub">Estado del plan${listo ? `<span class="ep-listo">listo para enviar</span>` : ""}</div>${filas}</div>`;
}
/* En el resumen: los pendientes de los pasos ya abiertos (los futuros aún no se llenan) y todos los avisos. */
function alertasVisibles(){
  return alertas().filter(a => a.nivel !== "bloquea" || a.paso <= S.paso || S.paso === 5);
}
/* Autoguardado local: cerrar la pestaña no borra el trabajo. Si el plan con
   imágenes no cabe en el almacenamiento del navegador, se guarda sin ellas. */
const CLAVE_AUTO = "mbe:autoguardado";
let tAuto;
function autoguardar(){
  clearTimeout(tAuto);
  tAuto = setTimeout(() => {
    try {
      if (!S.clienteKey || (!S.campanas.length && !S.creativos.length)) return;
      let txt = JSON.stringify(serializarBorrador());
      if (txt.length > 4000000){ const b = JSON.parse(txt); b.creativos.forEach(c => c.local = {}); b.sinImagenes = true; txt = JSON.stringify(b); }
      localStorage.setItem(CLAVE_AUTO, txt);
    } catch(e){}
  }, 1200);
}
function autoguardarYa(){ clearTimeout(tAuto); try { localStorage.setItem(CLAVE_AUTO, JSON.stringify(serializarBorrador())); } catch(e){} }
function leerAutoguardado(){ try { const t = localStorage.getItem(CLAVE_AUTO); return t ? JSON.parse(t) : null; } catch(e){ return null; } }
function borrarAutoguardado(){ try { localStorage.removeItem(CLAVE_AUTO); } catch(e){} }
async function restaurar(b){
  cargarBorrador(b);
  REPL.abierto = (S.replicas || []).length > 0;
  if (!S.cuentas.some(c => c.key === S.clienteKey)){ S.clienteKey = ""; S.paso = 0; render(); return; }
  S.paso = 1; render();
  await Promise.all([cargarPaginas(), cargarFuentes()]);
  await Promise.all([cargarWhatsapps(), cargarFormularios()]);
  render();
}
const IMP = { abierto:false, origen:"", lista:[], cargando:false, sel:new Set(), filtro:"", trayendo:"", reporte:null, paquetes:[] };
let pasoPintado = -1;
function avisoMotorHTML(){
  if (!S.cuentas.length) return "";
  /* La versión de la API de Meta la fija META_API_VERSION en n8n (5.3). */
  if (S.motorVersion === SITIO_VERSION) return S.apiVigente === false ? `<div class="note warn" style="margin-bottom:18px"><strong>La versión de la API de Meta configurada en n8n (${esc(S.apiVersion)}) ya no está vigente.</strong>
    Meta la retiró y responderá con error. En n8n cambia la variable <code>META_API_VERSION</code> a <code>v25.0</code> (o posterior; mínimo ${esc(S.apiMinima || "v24.0")}) y recarga esta página.</div>` : "";
  return `<div class="note stop" style="margin-bottom:18px"><strong>El motor de n8n no es la versión de este sitio</strong> (motor: ${esc(S.motorVersion || "anterior a " + SITIO_VERSION)}; sitio: ${SITIO_VERSION}).
    El envío está bloqueado para evitar errores confusos. En n8n: <strong>1)</strong> abre el workflow que importaste más recientemente y <strong>actívalo</strong>; <strong>2)</strong> desactiva (o borra) el workflow anterior, que sigue ocupando la misma URL del webhook; <strong>3)</strong> recarga esta página.</div>`;
}
function render(){
  if (S.cargando || S.fallo){ vArranque(); pasoPintado = -1; return; }
  if (S.modo === "gestor"){ renderGestor(); return; }
  document.querySelector(".layout").classList.remove("sin-resumen");
  // Solo se sube al inicio cuando cambia el paso; en un re-render dentro del
  // mismo paso (agregar campaña, cambiar estrategia, subir un arte) se conserva
  // la posición del scroll para no perder de vista dónde estabas.
  const cambioDePaso = S.paso !== pasoPintado;
  const scrollPrevio = window.scrollY;
  // Firma del campo enfocado, para devolverle el foco tras reconstruir el HTML.
  const act = document.activeElement;
  let foco = null, busq = null;
  /* Un buscador con texto escrito (campañas, intereses, ciudades…) sobrevive al redibujo:
     se conserva el texto y se vuelve a lanzar la búsqueda. */
  if (act && view.contains(act) && act.hasAttribute("data-q") && act.value){
    const fi = act.closest(".finder"), it = act.closest("[data-c],[data-k],[data-cr],[data-a]");
    busq = { cat: fi ? fi.dataset.cat : "", id: it ? (it.getAttribute("data-c")||it.getAttribute("data-k")||it.getAttribute("data-cr")||it.getAttribute("data-a")) : "", valor: act.value, pos: act.selectionStart };
  }
  if (act && view.contains(act) && (act.tagName === "INPUT" || act.tagName === "TEXTAREA")){
    const item = act.closest("[data-c],[data-k],[data-cr],[data-a]");
    foco = { id: item ? item.getAttribute("data-c")||item.getAttribute("data-k")||item.getAttribute("data-cr")||item.getAttribute("data-a") : "",
             f: act.dataset.f || "", tx: act.dataset.tx != null ? act.dataset.tx : "", preg: act.dataset.preg != null ? act.dataset.preg : "",
             sel: act.selectionStart, selEnd: act.selectionEnd };
  }
  pintarPasos(); pintarContador(); pintarResumen(); ligarAlertas($("#resumen"));
  view.innerHTML = avisoMotorHTML() + `<div class="eyebrow">Paso ${S.paso + 1} de ${PASOS.length}<span>${esc(PASOS[S.paso].t)}</span></div>` + [vCuenta,vCampanas,vConjuntos,vCreativos,vAnuncios,vRevision][S.paso]();
  [aCuenta,aCampanas,aConjuntos,aCreativos,aAnuncios,aRevision][S.paso]();
  mensajes();
  ligarPlegables();
  ligarAlertas(view);
  if (MODAL.abierto) pintarModal();
  $("#next").classList.toggle("hide", S.paso === 5);
  $("#back").disabled = S.paso === 0 || S.enviando;
  autoguardar();
  if (cambioDePaso){ window.scrollTo({top:0}); }
  else {
    if (foco){
      const item = foco.id ? view.querySelector(`[data-c="${foco.id}"],[data-k="${foco.id}"],[data-cr="${foco.id}"],[data-a="${foco.id}"]`) : view;
      let el = null;
      if (item){
        if (foco.tx !== "") el = item.querySelector(`[data-tx="${foco.tx}"]`);
        else if (foco.preg !== "") el = item.querySelector(`[data-preg="${foco.preg}"]`);
        else if (foco.f) el = item.querySelector(`[data-f="${foco.f}"]`);
      }
      if (el){ el.focus(); try { el.setSelectionRange(foco.sel, foco.selEnd); } catch(e){} }
    }
    if (busq){
      const cont = busq.id ? view.querySelector(`[data-c="${busq.id}"],[data-k="${busq.id}"],[data-cr="${busq.id}"],[data-a="${busq.id}"]`) : view;
      const q = cont && cont.querySelector(`.finder[data-cat="${busq.cat}"] [data-q]`);
      if (q && !q.disabled){ q.value = busq.valor; q.focus(); try { q.setSelectionRange(busq.pos, busq.pos); } catch(e){} q.dispatchEvent(new Event("input")); }
    }
    window.scrollTo({top:scrollPrevio});
  }
  pasoPintado = S.paso;
}
function renderGestor(){
  const scroll = window.scrollY, cambio = pasoPintado !== "gestor";
  pintarPasos(); pintarContador();
  document.querySelector(".layout").classList.add("sin-resumen");
  view.innerHTML = avisoMotorHTML() + vGestor(); aGestor();
  mensajesGestor();
  $("#back").disabled = false;
  if (MODAL.abierto) pintarModal();
  window.scrollTo({ top: cambio ? 0 : scroll });
  pasoPintado = "gestor";
}
function mensajes(){
  if (S.modo === "gestor") return mensajesGestor();
  marcarElementos();
  const msg = $("#msg");
  pintarContador();
  if (S.paso === 5){
    const e5 = problemas(5);
    msg.className = e5.length && !S.enviado ? "msg bad" : "msg";
    msg.innerHTML = S.enviado || S.enviando ? "" : (e5.length ? icono("stop") + `<span><b>${e5.length} ${e5.length === 1 ? "pendiente" : "pendientes"}</b> antes de enviar.</span><button type="button" class="btn link" data-ver-alertas>Ver y corregir</button>`
      : icono("ok") + "<span>Nada impide enviar. Revisa el árbol y, si quieres, revisa con Meta antes.</span>");
    ligarAlertas(msg);
    $("#next").disabled = true; return;
  }
  const errs = problemas(S.paso);
  if (!errs.length){ msg.className = "msg ok"; msg.innerHTML = S.paso > 0 ? icono("ok") + "<span>Paso completo.</span>" : ""; }
  else {
    msg.className = "msg bad";
    const ref0 = REFS[errs[0]] || "";
    msg.innerHTML = icono("stop") + `<span><b>${errs.length} ${errs.length === 1 ? "pendiente" : "pendientes"}:</b> ${esc(errs[0])}</span>`
      + (ref0 ? `<button type="button" class="btn link" data-ir-dock="${esc(ref0)}">Ir</button>` : "")
      + (errs.length > 1 ? `<button type="button" class="btn link" data-ver-alertas>Ver ${errs.length === 2 ? "el otro" : "los " + errs.length}</button>` : "");
    ligarAlertas(msg);
    const ir = msg.querySelector("[data-ir-dock]"); if (ir) ir.onclick = () => irAElemento(ir.dataset.irDock);
  }
  $("#next").disabled = errs.length > 0;
}
function vArranque(){
  view.innerHTML = S.fallo ? `
    <div class="boot"><h1>No se pudo cargar la lista de cuentas</h1>
    <p class="lede">${esc(S.fallo)}</p>
    <div class="note stop">Revisa que <code>_redirects</code> apunte a tu instancia de n8n y que el workflow esté activo.</div>
    <p><button class="btn" id="reintentar">Reintentar</button></p></div>`
  : `<div class="boot"><h1>Cargando</h1><p class="lede"><span class="spinner"></span> Leyendo las cuentas disponibles.</p></div>`;
  const r = $("#reintentar"); if (r) r.onclick = arrancar;
}
/* El sitio y el motor de n8n deben ser de la misma versión. Al importar un JSON en
   n8n se crea un workflow NUEVO y el anterior puede seguir activo en la misma URL;
   esta verificación lo hace visible en lugar de fallar de formas confusas. */
const SITIO_VERSION = "5.6.0";
async function arrancar(){
  S.cargando = true; S.fallo = ""; render();
  try {
    const r = await llamar("cuentas"); S.cuentas = r.cuentas || [];
    S.motorVersion = r.motor_version || "";
    S.apiVersion = r.api_version || ""; S.apiVigente = r.api_vigente !== false; S.apiMinima = r.api_minima || "";
    if (!S.cuentas.length) throw new Error("El token no tiene acceso a ninguna cuenta publicitaria activa.");
  }
  catch(e){ S.fallo = e.message; }
  S.cargando = false; render();
}

/* --------------------------------------------------------- buscadores */
function tagHTML(cat, x){ return `<span class="tag">${esc(x.n)}<button type="button" data-rm="${cat}|${esc(x.id)}" aria-label="Quitar">&times;</button></span>`; }
function finderHTML(cat, etiqueta, placeholder, obj, deshabilitado, ayuda){
  const lista = obj[cat] || [];
  return `<div class="f s6 finder" data-cat="${cat}">
    <label>${esc(etiqueta)}</label>
    <div class="chips">${lista.map(x => tagHTML(cat, x)).join("")}</div>
    <div class="finder-box"><input type="text" placeholder="${esc(placeholder)}" data-q autocomplete="off" ${deshabilitado?"disabled":""}>
    <div class="results hide"></div></div>
    ${ayuda ? `<span class="hint">${esc(ayuda)}</span>` : ""}
  </div>`;
}
function montarBuscadores(box, obj, extra){
  box.querySelectorAll(".finder").forEach(f => {
    const cat = f.dataset.cat, q = f.querySelector("[data-q]"), out = f.querySelector(".results");
    if (!q) return;
    let t;
    q.oninput = () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2){ out.classList.add("hide"); return; } t = setTimeout(() => buscar(v), 280); };
    q.onblur = () => setTimeout(() => out.classList.add("hide"), 180);
    async function buscar(v){
      out.innerHTML = `<div class="empty"><span class="spinner"></span> Buscando…</div>`; out.classList.remove("hide");
      try {
        const tipo = cat === "cuenta" ? "audiencias_cuenta" : cat;
        const r = await llamar("buscar", Object.assign({tipo, texto:v, pais:S.pais.cc}, ctx(), extra || {}));
        obj[cat] = obj[cat] || [];
        const ya = new Set(obj[cat].map(x => x.id));
        const hits = (r.resultados||[]).filter(x => !ya.has(x.id));
        out.innerHTML = hits.length ? hits.map(x => `<button type="button" data-add="${esc(x.id)}" title="${esc(x.n)}"><span class="rn">${esc(x.n)}</span><span class="id">${esc(x.r||"")}</span></button>`).join("") : `<div class="empty">Sin resultados para "${esc(v)}".</div>`;
        out.querySelectorAll("[data-add]").forEach(b => b.onmousedown = () => {
          const h = hits.find(x => x.id === b.dataset.add);
          if (cat === "cuenta") obj[cat] = [h]; else obj[cat].push(h);
          render();
        });
      } catch(e){ out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }
  });
  box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const [cat, id] = b.dataset.rm.split("|");
    obj[cat] = (obj[cat]||[]).filter(x => x.id !== id); render();
  });
}
function ligarCampos(box, obj, alCambiar){
  box.querySelectorAll("[data-f]").forEach(el => {
    if (el.closest(".finder")) return;
    const f = el.dataset.f;
    const upd = () => { obj[f] = el.type === "checkbox" ? el.checked : el.value; if (alCambiar) alCambiar(f, el); mensajes(); pintarResumen(); autoguardar(); };
    el.oninput = upd; el.onchange = upd;
  });
}

/* ------------------------------------------------------------ 1 · cuenta */
const CUENTA_UI = { filtro:"" };
function vCuenta(){
  const cl = cliente();
  const q = CUENTA_UI.filtro.trim().toLowerCase();
  const lista = S.cuentas.filter(c => !q || (c.nombre + " " + c.cuenta + " " + c.moneda).toLowerCase().includes(q));
  return `
  <h1>¿Qué vas a hacer?</h1>
  <p class="lede">Crea campañas nuevas (en una cuenta o replicadas en varias) o edita lo que ya está publicado en varias cuentas a la vez.</p>
  <div class="modos">
    <button type="button" class="modo on" data-modo="crear">${icono("form")}<span><b>Crear campañas</b><small>Campañas, conjuntos, creativos y anuncios nuevos, con formularios, WhatsApp o sitio web. Se pueden publicar en varias cuentas.</small></span></button>
    <button type="button" class="modo" data-modo="gestor">${icono("grafica")}<span><b>Editar campañas existentes</b><small>Varias cuentas a la vez: pausar, activar, presupuestos, nombres y fechas, con métricas del periodo.</small></span></button>
  </div>
  ${(() => { const b = leerAutoguardado(); if (!b || S.campanas.length) return "";
      const cta = S.cuentas.find(c => c.key === b.clienteKey);
      return `<div class="note" style="margin-bottom:18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span style="flex:1">Hay un plan sin enviar${cta ? " de <strong>" + esc(cta.nombre) + "</strong>" : ""}, guardado el ${esc(new Date(b.guardado).toLocaleString("es-MX"))}: ${(b.campanas||[]).length} campañas, ${(b.anuncios||[]).length} anuncios${b.sinImagenes ? " (sin las imágenes subidas: eran demasiado pesadas para guardarlas)" : ""}.</span>
        <button class="btn sm" id="recuperar">Recuperar</button><button class="btn ghost sm" id="descartar">Descartar</button></div>`; })()}
  <div class="panel"><header><div><h2>Cuenta publicitaria principal</h2><p>${S.cuentas.length} disponibles para este token${cl ? " · elegida: " + esc(cl.nombre) : ""}</p></div>
    <div class="row-actions"><input type="text" id="cuentaFiltro" placeholder="Buscar por nombre, ID o moneda…" value="${esc(CUENTA_UI.filtro)}" style="width:260px;min-height:34px"></div></header>
    <div class="body"><div class="cuentas-grid">${lista.map(c => `<label class="cuenta-card ${c.key===S.clienteKey?"on":""}"><input type="radio" name="cuenta" value="${esc(c.key)}" data-cuenta ${c.key===S.clienteKey?"checked":""}>
        <span class="cc-n">${esc(c.nombre)}</span><span class="cc-r mono">act_${esc(c.cuenta)} · ${esc(c.moneda)} · ${esc(String(c.tz||"").split("/").pop().replace(/_/g," "))}</span>
        <span class="cc-t">${c.pixel ? `<span class="pill ok">píxel</span>` : `<span class="pill dim">sin píxel</span>`}${c.ig ? `<span class="pill ok">Instagram</span>` : `<span class="pill dim">sin Instagram</span>`}</span></label>`).join("") || `<div class="empty">Ninguna cuenta coincide con "${esc(CUENTA_UI.filtro)}".</div>`}</div>
    </div></div>
  ${cl ? `<div class="cheq-cta">${icono("escudo")}<div><b>Chequeo de configuración de Meta</b><span>Revisa en un paso el token, sus permisos, la cuenta, la página, el WhatsApp vinculado, las condiciones de formularios y el píxel. Conviene correrlo antes de la primera publicación en una cuenta o página nueva.</span></div><button type="button" class="btn ghost sm" id="cheqAbrir">Revisar ahora</button></div>` : ""}`;
}
function aCuenta(){
  const ch = $("#cheqAbrir"); if (ch) ch.onclick = () => $("#btnChequeo").click();
  const rc = $("#recuperar"); if (rc) rc.onclick = () => { const b = leerAutoguardado(); if (b) restaurar(b).catch(e => toast(e.message, "stop")); };
  const dc = $("#descartar"); if (dc) dc.onclick = () => { borrarAutoguardado(); render(); };
  document.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => {
    if (b.dataset.modo === "gestor"){ S.modo = "gestor"; if (!G.cuentas.size && S.clienteKey){ const cl = cliente(); if (cl) G.cuentas.add(cl.cuenta); } window.scrollTo({ top:0 }); render(); }
  });
  const f = $("#cuentaFiltro"); if (f) f.oninput = () => { CUENTA_UI.filtro = f.value; const pos = f.selectionStart; render(); const n = $("#cuentaFiltro"); if (n){ n.focus(); n.setSelectionRange(pos, pos); } };
  document.querySelectorAll("[data-cuenta]").forEach(r => r.onchange = () => elegirCuenta(r.value));
}
async function elegirCuenta(key){
  if (key === S.clienteKey) return;
  const hay = S.campanas.length || S.anuncios.length;
  if (hay && !confirm("Cambiar de cuenta vacía las campañas, conjuntos y anuncios del plan (los creativos por enlace se conservan). ¿Continuar?")){ render(); return; }
  S.clienteKey = key;
  S.campanas = []; S.conjuntos = []; S.anuncios = []; S.pageId = ""; S.paginas = []; S.whatsapps = []; S.fuentes = [];
  S.formularios = []; S.replicas = []; PUBS.lista = []; PUBS.clave = ""; PREVAL.hecho = false;
  render(); await Promise.all([cargarPaginas(), cargarFuentes()]); await Promise.all([cargarWhatsapps(), cargarFormularios()]); render();
}
/* Números, plantillas y configuraciones de WhatsApp en UNA llamada, recordada por
   cuenta y página: volver a la misma página no repite la lectura (y no gasta el
   límite de solicitudes de Meta). "Volver a buscar" fuerza una lectura nueva. */
let claveWA = "";
async function cargarWhatsapps(forzar){
  if (!S.pageId || !S.clienteKey){ S.whatsapps = []; S.plantillasWA = []; S.configsWA = []; return; }
  const clave = (cliente()||{}).cuenta + "|" + S.pageId;
  if (!forzar && clave === claveWA && (S.whatsapps.length || S.configsWA.length || S.plantillasWA.length)) return;
  S.cargandoWhatsapps = true;
  try {
    const r = await llamar("buscar", Object.assign({tipo:"whatsapp_info", texto:"", page_id:S.pageId}, ctx()));
    S.whatsapps = r.numeros || []; S.plantillasWA = r.plantillas || []; S.configsWA = r.configs || [];
    S.diagWA = r.diagnostico || null; S.diagPlantillas = { conjuntosWhatsApp: (r.diagnostico||{}).conjuntosWhatsApp || 0, plantillas: S.plantillasWA.length };
    claveWA = clave;
  } catch(e){
    S.diagWA = { conjuntosRevisados:0, conjuntosWhatsApp:0, wabas:0, negocios:[], erroresWaba:[e.message] };
  }
  S.cargandoWhatsapps = false;
  sugerirConfigs();
}
/* Formularios instantáneos de la página elegida. */
let claveForms = "";
async function cargarFormularios(forzar){
  if (!S.pageId || !S.clienteKey){ S.formularios = []; S.falloFormularios = ""; return; }
  const clave = S.pageId;
  if (!forzar && clave === claveForms && S.formularios.length) return;
  S.cargandoFormularios = true; S.falloFormularios = "";
  try { const r = await llamar("formularios", Object.assign({ op:"listar", page_id:S.pageId }, ctx())); S.formularios = r.resultados || []; claveForms = clave; }
  catch(e){ S.formularios = []; S.falloFormularios = e.message; }
  S.cargandoFormularios = false;
}
async function cargarFuentes(){
  S.fuentes = []; if (!S.clienteKey) return;
  try { const r = await llamar("buscar", Object.assign({tipo:"fuentes", texto:""}, ctx())); S.fuentes = r.resultados || []; }
  catch(e){ S.fuentes = []; }
}
async function cargarPaginas(){
  S.paginas = []; S.falloPaginas = ""; S.cargandoPaginas = true;
  if (!S.clienteKey){ S.cargandoPaginas = false; return; }
  try {
    const r = await llamar("buscar", Object.assign({tipo:"paginas", texto:""}, ctx()));
    S.paginas = r.resultados || [];
    if (!S.paginas.length) S.falloPaginas = "No hay páginas accesibles con este token.";
    if (S.paginas.length === 1 && !S.pageId) S.pageId = S.paginas[0].id;
  } catch(e){ S.falloPaginas = e.message; }
  S.cargandoPaginas = false;
}

/* --------------------------------------------------------- 2 · campañas */
function vCampanas(){
  const cl = cliente();
  return `
  <h1>Campañas</h1>
  <p class="lede">Crea las campañas nuevas que necesites y suma las existentes a las que quieras agregar conjuntos o anuncios. Todo en el mismo plan.</p>
  <div class="panel"><header><div><h2>Página de Facebook</h2><p>Con esta página salen todos los anuncios de esta carga</p></div></header>
    <div class="body"><div class="grid">
      <div class="f s6"><label for="pagina">Página<span class="req">*</span></label>
        <select id="pagina" ${S.cargandoPaginas?"disabled":""}>
          ${S.paginas.length ? `<option value="">Elige…</option>` + S.paginas.map(p => `<option value="${esc(p.id)}" ${p.id===S.pageId?"selected":""}>${esc(p.n)}</option>`).join("")
            : `<option value="">${S.cargandoPaginas?"Cargando…":"No se pudieron cargar las páginas"}</option>`}
        </select>
        <span class="hint">${S.falloPaginas ? esc(S.falloPaginas) + ' <a href="#" id="reintentarPaginas">Reintentar</a>' : "Al agregar una campaña existente se toma la página con la que ya publica."}</span></div>
    </div></div></div>

  ${importarHTML()}
  <div class="panel"><header><div><h2>${S.campanas.length} ${S.campanas.length===1?"campaña":"campañas"} en el plan</h2><p>Nuevas, importadas y existentes conviven en la misma carga</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="abrirImp">${IMP.abierto ? "Cerrar importación" : "Traer de otra cuenta"}</button><button class="btn sm" id="addNueva">+ Campaña nueva</button></div></header>
    <div class="body">
      <div class="f s12 finder" data-cat="campanas" style="margin-bottom:16px;position:relative">
        <label>Agregar una campaña existente</label>
        <div class="finder-box"><input type="text" placeholder="Escribe parte del nombre de la campaña…" data-q autocomplete="off">
        <div class="results hide"></div></div>
        <span class="hint">Se buscan campañas activas o en pausa de la cuenta elegida.</span>
      </div>
      ${S.campanas.length ? S.campanas.map((c,i) => campanaHTML(c, i, cl)).join("") : `<div class="empty">Todavía no hay campañas. Crea una nueva o busca una existente.</div>`}
    </div></div>`;
}
function campanaImportadaHTML(c, i, cl){
  const ks = conjuntosDe(c);
  return `
  <div class="item" data-c="${c.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(nombreCampana(c))}</strong> · importada de ${esc(c.importada)}</span>
    <button class="btn link" data-del="${c.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s6"><label>Nombre de la campaña<span class="req">*</span></label><input type="text" data-f="nombreLibre" value="${esc(c.nombreLibre)}"><span class="hint">Se conserva el nombre de origen; ajústalo si tu convención lo pide.</span></div>
      <div class="f s3"><label>Objetivo</label><div class="mono">${esc((OBJETIVOS.find(o=>o.v===c.objetivo)||{t:c.objetivo}).t)}</div></div>
      <div class="f s3"><label>Categoría especial</label><div class="mono">${esc((CATEGORIAS.find(k=>k.v===c.categoria)||{t:"Ninguna"}).t)}</div></div>
      <div class="f s3"><label>Presupuesto en</label><div class="mono">${c.presupuestoEn==="CAMPAIGN" ? "La campaña (CBO)" : "Cada conjunto (ABO)"}</div></div>
      <div class="f s3"><label>Diario o total</label><select data-f="tipoMonto"><option value="DAILY" ${c.tipoMonto==="DAILY"?"selected":""}>Diario</option><option value="LIFETIME" ${c.tipoMonto==="LIFETIME"?"selected":""}>Total</option></select></div>
      <div class="f s3"><label>Monto${c.presupuestoEn==="CAMPAIGN"?'<span class="req">*</span>':""}</label><input type="number" data-f="monto" value="${c.presupuestoEn==="ADSET" ? "" : esc(c.monto)}" min="0" ${c.presupuestoEn==="ADSET"?"disabled":""} placeholder="${cl ? "mín. " + minimoDe(c) + " " + cl.moneda : ""}"><span class="hint">${c.presupuestoEn==="ADSET" ? "Se captura por conjunto." : (cl ? "En " + esc(cl.moneda) : "")}</span></div>
      <div class="f s3"><label>Puja</label><div class="mono">${c.puja ? esc(c.puja) : "Costo más bajo"}</div></div>
      <div class="f s3"><label>Inicio<span class="req">*</span></label><input type="date" data-f="inicio" value="${esc(c.inicio)}"></div>
      <div class="f s3"><label>Fin${c.tipoMonto==="LIFETIME"?'<span class="req">*</span>':""}</label><input type="date" data-f="fin" value="${esc(c.fin)}"></div>
      <div class="f s6"><span class="hint">${ks.length} ${ks.length===1?"conjunto copiado":"conjuntos copiados"}: sus segmentaciones, optimización y destino se revisan en el paso siguiente.</span></div>
    </div></div></div>`;
}
const CFGID = { valor:"", cargando:false, error:"" };
const DIAG = { cargando:false, pasos:null, error:"", ref:"" };
function diagnosticoHTML(){
  return `<div class="panel" style="margin-top:14px"><header><div><h2>Diagnóstico de la referencia</h2><p>Prueba real y reversible: copia la campaña y el conjunto de referencia en pausa, informa cada paso con el error completo de Meta y elimina todo al terminar.</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="diagCorrer" ${DIAG.cargando?"disabled":""}>${DIAG.cargando ? "Probando…" : "Diagnosticar la referencia elegida"}</button></div></header>
    ${DIAG.pasos || DIAG.error ? `<div class="body">
      ${DIAG.error ? `<div class="note stop">${esc(DIAG.error)}</div>` : ""}
      ${DIAG.pasos ? `<ol class="diag">${DIAG.pasos.map(x => `<li class="${x.ok ? "ok" : "bad"}"><strong>${x.ok ? "Bien" : "Falla"} · ${esc(x.paso)}</strong><div>${esc(x.detalle)}</div></li>`).join("")}</ol>
        <button class="btn ghost sm" id="diagCopiar">Copiar el diagnóstico</button> <span class="hint" id="diagCopiado"></span>` : ""}
    </div>` : ""}</div>`;
}
async function correrDiagnostico(ref, cWA){
  Object.assign(DIAG, { cargando:true, pasos:null, error:"", ref }); render();
  try { const r = await llamar("buscar", Object.assign({ tipo:"diagnostico_referencia", adset_id: ref, page_id: S.pageId, dataset: cWA ? datasetWA(cWA) : "" }, ctx())); DIAG.pasos = r.pasos || []; }
  catch(e){ DIAG.error = e.message; }
  DIAG.cargando = false; render();
}
function textoDiagnostico(){
  return "Diagnóstico de referencia " + DIAG.ref + " · sitio " + SITIO_VERSION + " · motor " + (S.motorVersion||"?") + "\n" + (DIAG.pasos||[]).map((x,i) => (i+1) + ". " + (x.ok ? "BIEN " : "FALLA ") + x.paso + ": " + x.detalle).join("\n");
}
/* Lee la configuración de un conjunto por su ID y la aplica a las campañas indicadas. */
async function leerConfigPorId(campanas){
  CFGID.cargando = true; CFGID.error = ""; render();
  try {
    const r = await llamar("buscar", Object.assign({tipo:"config_conjunto", adset_id: CFGID.valor}, ctx()));
    const x = r.config;
    if (!x || !x.config || !x.config.optimization_goal) throw new Error("Meta no devolvió la configuración de ese conjunto.");
    if (!/WHATSAPP/.test(String(x.config.destination_type || "")) && !(x.config.promoted_object||{}).whatsapp_phone_number)
      CFGID.error = "Ojo: ese conjunto no va a WhatsApp (destino " + (x.config.destination_type || "sin destino") + "). Se aplicó igual.";
    S.configsWA = [x].concat((S.configsWA||[]).filter(y => y.id !== x.id));
    campanas.forEach(c => aplicarConfig(c, x));
  } catch(e){ CFGID.error = e.message; }
  CFGID.cargando = false; render();
}
function configHTML(c){
  const lista = S.configsWA || [];
  const x = c.cfgWA, cfg = x ? x.config : null;
  const po = cfg ? Object.keys(cfg.promoted_object || {}).join(", ") : "";
  return `<div class="f s12"><label>Configuración de optimización</label>
    <select data-cfgwa><option value="">Automática: el motor verifica con Meta la configuración válida</option>
      ${lista.filter(y => y.compras).length ? `<optgroup label="Conjuntos de compras por WhatsApp de la cuenta">${lista.filter(y => y.compras).slice().sort((a,b) => (b.puntaje||0)-(a.puntaje||0)).map(y => `<option value="${esc(y.id)}" ${x && x.id===y.id?"selected":""}>${esc(y.n)} · ${esc(y.r)}</option>`).join("")}</optgroup>` : ""}
      ${lista.filter(y => !y.compras).length ? `<optgroup label="Otros conjuntos de WhatsApp de la cuenta">${lista.filter(y => !y.compras).map(y => `<option value="${esc(y.id)}" ${x && x.id===y.id?"selected":""}>${esc(y.n)} · ${esc(y.r)}</option>`).join("")}</optgroup>` : ""}
    </select>
    <span class="hint">${cfg
      ? "Se usan los valores de \"" + esc(x.n) + "\" (objetivo " + esc(x.objetivo) + ", optimización " + esc(cfg.optimization_goal) + (po ? ", objeto promovido con " + esc(po) : "") + "). Antes de crear, el motor verifica con Meta que los acepte; si ya no los admite (pasa con conjuntos creados hace tiempo), usa la configuración que Meta documenta y te lo dice. Ya no se copia el conjunto."
      : (lista.length ? "Opcional: elige un conjunto de WhatsApp que ya funcione para tomar sus valores. Sin él, el motor arma la configuración y la verifica con Meta." : (S.cargandoWhatsapps ? "Buscando conjuntos de WhatsApp de la cuenta…" : "No encontré conjuntos de WhatsApp en esta cuenta. Si el que funciona está en otra cuenta, pega su ID abajo."))}</span>
    <div class="utm-fila" style="margin-top:8px"><input type="text" data-cfgid placeholder="O pega el ID del conjunto que funciona, o el enlace de Ads Manager" value="${esc(CFGID.valor)}">
      <button type="button" class="btn ghost sm" data-cfgleer ${CFGID.cargando?"disabled":""}>${CFGID.cargando ? "Leyendo…" : "Leer configuración"}</button></div>
    ${CFGID.error ? `<span class="hint warn-t">${esc(CFGID.error)}</span>` : `<span class="hint">En Ads Manager, abre el conjunto que funciona: su ID es el número después de <code>selected_adset_ids=</code> en la dirección. Puede estar en cualquier cuenta a la que tenga acceso el token.</span>`}</div>`;
}
function whatsappHTML(obj, meta, tam){
  const grupos = [["ESTA_PAGINA","Usados con esta página"],["WABA","WhatsApp Business de la cuenta"],["OTRA_PAGINA","Usados con otra página"]];
  const actual = obj.whatsapp ? infoNumero(obj.whatsapp) : null;
  const manual = obj.whatsappManual || (obj.whatsapp && !actual);
  const valorSel = manual ? "__otro" : (actual ? actual.id : "");
  const offline = S.fuentes;
  const aviso = actual && actual.grupo === "OTRA_PAGINA" ? "Este número solo se ha usado con otra página: confirma que esté conectado a la página elegida."
    : actual && actual.grupo === "WABA" ? "Número del WhatsApp Business. Si nunca se ha usado en anuncios, el motor verificará con Meta que esté conectado a la página."
    : actual ? "Número ya usado en anuncios con esta página: el formato está confirmado por Meta." : "";
  return `
      <div class="f ${tam||"s4"}"><label>Número de WhatsApp</label>
        <select data-num>
          <option value="">${S.cargandoWhatsapps ? "Cargando…" : (S.whatsapps.length ? "Elige…" : "Sin números detectados")}</option>
          ${grupos.map(([g, t]) => { const xs = S.whatsapps.filter(x => x.grupo === g); return xs.length ? `<optgroup label="${esc(t)}">${xs.map(x => `<option value="${esc(x.id)}" ${x.id===valorSel?"selected":""}>${esc(x.n)} · ${esc(x.r)}</option>`).join("")}</optgroup>` : ""; }).join("")}
          <option value="__otro" ${valorSel==="__otro"?"selected":""}>Otro número…</option>
        </select>
        ${manual ? `<input type="text" data-f="whatsapp" value="${esc(obj.whatsapp||"")}" placeholder="+52 81 1454 0207" style="margin-top:6px">` : ""}
        <span class="hint ${actual && actual.grupo==="OTRA_PAGINA" ? "warn-t" : ""}">${esc(manual ? "Con código de país. El motor lo verificará con Meta en varios formatos antes de crear." : (aviso || (S.whatsapps.length ? "" : diagnosticoNumeros())))}
          ${S.cargandoWhatsapps ? "" : ` <a href="#" data-rebuscar-num>Volver a buscar números</a>`}</span></div>
      ${esComprasWA(meta) ? datasetWAHTML(obj, tam) : ""}
      ${verificarWAHTML(obj)}`;
}
/* Conjunto de datos de WhatsApp (API de conversiones para mensajería): con él Meta optimiza por compras
   en el chat (Ventas + conversiones, lo que documenta para Click to WhatsApp). */
function datasetWAHTML(obj, tam){
  const fs = S.fuentes || [], was = fs.filter(f => f.tipo === "WHATSAPP"), otros = fs.filter(f => f.tipo !== "WHATSAPP");
  const auto = datasetWA(Object.assign({}, obj, { datasetMsg: "" }));
  const autoN = auto ? ((fs.find(f => f.id === auto) || {}).n || auto) : "";
  return `<div class="f ${tam||"s4"}"><label>Conjunto de datos de compras</label>
    <select data-f="datasetMsg">
      <option value="">${auto ? "Automático: " + esc(autoN) : "Elige…"}</option>
      ${was.length ? `<optgroup label="WhatsApp (API de conversiones para mensajería)">${was.map(f => `<option value="${esc(f.id)}" ${f.id===obj.datasetMsg?"selected":""}>${esc(f.n)} · ${esc(f.id)}</option>`).join("")}</optgroup>` : ""}
      ${otros.length ? `<optgroup label="Otros conjuntos de datos y píxeles">${otros.map(f => `<option value="${esc(f.id)}" ${f.id===obj.datasetMsg?"selected":""}>${esc(f.n)} · ${esc(f.id)}</option>`).join("")}</optgroup>` : ""}
    </select>
    <span class="hint">${was.length ? "El de WhatsApp recibe las compras que reporta tu proveedor del chat. Es el que Meta pide para optimizar compras por WhatsApp." : "No encontré conjuntos de datos de WhatsApp (requiere el permiso whatsapp_business_management). Si tu proveedor comparte el conjunto de datos con la cuenta, aparece en la otra lista."}</span></div>`;
}
/* Verificación con Meta (sin crear nada) de la configuración de WhatsApp de una campaña. */
const WAV = {};
function verificarWAHTML(obj){
  const v = WAV[obj.id] || {};
  const r = v.r;
  return `<div class="f s12 wav">
    <div class="wav-fila"><button type="button" class="btn ghost sm" data-wa-verificar ${v.cargando ? "disabled" : ""}>${v.cargando ? `<span class="spinner"></span> Verificando con Meta…` : icono("escudo") + " Verificar con Meta"}</button>
      <span class="hint">Prueba con Meta, sin crear nada, qué configuración de WhatsApp acepta para esta campaña.</span></div>
    ${v.error ? `<div class="note stop">${esc(v.error)}</div>` : ""}
    ${r && r.ok ? `<div class="note go"><strong>Meta acepta: ${esc(r.elegido.etiqueta)}.</strong> ${r.elegido.objetivo !== (obj.objetivo || "") && obj.objetivo ? "El objetivo de la campaña quedará en " + esc((OBJETIVOS.find(o => o.v === r.elegido.objetivo) || {t:r.elegido.objetivo}).t) + ". " : ""}${(r.intentos||[]).length ? "Antes rechazó: " + esc(r.intentos.map(x => x.etiqueta).join(", ")) + "." : ""}
      ${obj.objetivo && (r.elegido.objetivo !== obj.objetivo || r.elegido.optimization_goal !== obj.meta) && (METAS_WA[r.elegido.objetivo] || []).some(m => m[0] === r.elegido.optimization_goal) ? `<button type="button" class="btn sm" data-wa-aplicar style="margin-left:6px">Usar esta configuración en el plan</button>` : ""}</div>` : ""}
    ${r && !r.ok ? `<div class="note ${r.sin_prueba && r.sin_prueba.length ? "warn" : "stop"}"><strong>${r.sin_prueba && r.sin_prueba.length ? "No se pudo verificar todo" : "Meta rechazó todas las opciones"}</strong><ol class="wav-l">${(r.intentos||[]).map(x => `<li><b>${esc(x.etiqueta)}:</b> ${esc(x.error)}</li>`).join("")}</ol>
      ${esComprasWA(obj.meta) && !datasetWA(obj) ? "Elige el conjunto de datos de compras (WhatsApp CAPI) y vuelve a verificar." : r.sin_prueba && r.sin_prueba.length ? "Al enviar, el motor prueba lo que falta en una campaña temporal en pausa que luego elimina." : !obj.waCambiaObjetivo && !obj.campanaId ? "Con el objetivo elegido Meta no acepta ninguna opción. Usa «Diagnosticar la referencia» para ver en qué se diferencia de tu conjunto original, o permite cambiar el objetivo." : "Revisa en «Chequeo de Meta» que el número esté vinculado a la página."}</div>` : ""}
    ${!obj.campanaId && obj.cfgWA ? `<div class="wav-fila" style="margin-top:8px"><button type="button" class="btn ghost sm" data-wa-diag ${DIAG.cargando ? "disabled" : ""}>${DIAG.cargando && DIAG.ref === obj.cfgWA.id ? "Diagnosticando…" : "Diagnosticar la referencia"}</button>
      <span class="hint">Lee la referencia tal como la guarda Meta, la prueba dentro de su propia campaña y compara la campaña original con una copia (la copia se elimina al terminar).</span></div>
      ${DIAG.ref === obj.cfgWA.id && (DIAG.pasos || DIAG.error) ? `${DIAG.error ? `<div class="note stop">${esc(DIAG.error)}</div>` : ""}${DIAG.pasos ? `<ol class="diag">${DIAG.pasos.map(x => `<li class="${x.ok ? "ok" : "bad"}"><strong>${x.ok ? "Bien" : "Falla"} · ${esc(x.paso)}</strong><div>${esc(x.detalle)}</div></li>`).join("")}</ol>
        <button type="button" class="btn ghost sm" data-wa-diag-copiar>Copiar el diagnóstico</button>` : ""}` : ""}` : ""}
    ${obj.campanaId ? "" : `<label class="chk-linea"><input type="checkbox" data-wa-cambia ${obj.waCambiaObjetivo ? "checked" : ""}> Permitir que el motor cambie el objetivo (por ejemplo, a Ventas) si Meta no acepta el elegido</label>`}
  </div>`;
}
async function verificarWA(obj){
  const c = obj.campanaId ? (campanaDe(obj) || {}) : obj;
  WAV[obj.id] = { cargando:true }; render();
  try {
    const r = await llamar("buscar", Object.assign({ tipo:"resolver_wa", page_id:S.pageId, meta: obj.meta || c.meta, objetivo: c.objetivo, campaign_id: c.modo === "EXISTENTE" ? c.metaId : "",
      cambiar_objetivo: !!c.waCambiaObjetivo, campana_ref: c.cfgWA && clonable(c) ? c.cfgWA.campanaId : "",
      config: c.cfgWA ? c.cfgWA.config : null, numero: obj.whatsapp || c.whatsapp || "", dataset: datasetWA(obj), evento: c.evento || "PURCHASE", pais: S.pais.cc || "MX" }, ctx()));
    WAV[obj.id] = { r };
    if (r.ok) toast("Meta acepta la configuración de WhatsApp.", "ok"); else toast("Meta no aceptó ninguna configuración.", "stop");
  } catch(e){ WAV[obj.id] = { error: e.message }; }
  render();
}
function diagnosticoNumeros(){
  const d = S.diagWA;
  if (!d) return "No encontré números: elige Otro número.";
  const partes = [];
  if (d.faltaPermisoWA) partes.push("El token NO tiene el permiso whatsapp_business_management: genera un token nuevo del system user marcando ese permiso y actualízalo en n8n (META_ACCESS_TOKEN)");
  partes.push("Business revisados: " + ((d.negocios||[]).join(", ") || "ninguno"));
  partes.push("WhatsApp Business encontrados: " + (d.wabas ? (d.nombresWaba||[]).join(", ") : "ninguno"));
  partes.push("conjuntos de WhatsApp en la cuenta: " + (d.conjuntosWhatsApp||0));
  (d.erroresWaba||[]).slice(0,3).forEach(e => partes.push(e));
  return partes.join(" · ") + ".";
}
/* El selector de número vive en campañas nuevas y en conjuntos nuevos. */
function ligarNumero(box, obj){
  const vw = box.querySelector("[data-wa-verificar]"); if (vw) vw.onclick = () => verificarWA(obj);
  const wd = box.querySelector("[data-wa-diag]"); if (wd) wd.onclick = () => correrDiagnostico(obj.cfgWA.id, obj);
  const wdc = box.querySelector("[data-wa-diag-copiar]"); if (wdc) wdc.onclick = async () => { try { await navigator.clipboard.writeText(textoDiagnostico()); toast("Diagnóstico copiado.", "ok"); } catch(e){ toast("No se pudo copiar.", "stop"); } };
  const wc = box.querySelector("[data-wa-cambia]"); if (wc) wc.onchange = () => { obj.waCambiaObjetivo = wc.checked; delete WAV[obj.id]; autoguardar(); render(); };
  const va = box.querySelector("[data-wa-aplicar]");
  if (va) va.onclick = () => { const r = (WAV[obj.id] || {}).r; if (!r || !r.ok) return;
    obj.objetivo = r.elegido.objetivo; obj.meta = r.elegido.optimization_goal; obj.cfgWA = null;
    WAV[obj.id] = { r: Object.assign({}, r, { intentos: [] }) }; toast("El plan quedó con la configuración que Meta acepta.", "ok"); render(); };
  const rb = box.querySelector("[data-rebuscar-num]");
  if (rb) rb.onclick = async ev => { ev.preventDefault(); S.cargandoWhatsapps = true; render(); await cargarWhatsapps(true); render(); };
  const sel = box.querySelector("[data-num]"); if (!sel) return;
  sel.onchange = () => {
    delete WAV[obj.id];
    if (sel.value === "__otro"){ obj.whatsappManual = true; obj.whatsapp = ""; }
    else { obj.whatsappManual = false; obj.whatsapp = sel.value; }
    render();
  };
}
function fmtMonto(v, mon){ return (Number(v)||0).toLocaleString("es-MX", {maximumFractionDigits:0}) + (mon ? " " + mon : ""); }
function importarHTML(){
  if (!IMP.abierto) return "";
  const cl = cliente();
  const lista = IMP.lista.filter(x => !IMP.filtro || x.n.toLowerCase().includes(IMP.filtro.toLowerCase()));
  const origen = S.cuentas.find(c => c.cuenta === IMP.origen);
  return `
  <div class="panel imp"><header><div><h2>Traer campañas de otra cuenta</h2><p>Se reconstruyen en <strong>${esc(cl ? cl.nombre : "")}</strong> con sus conjuntos, segmentaciones, creativos y anuncios. Todo entra al plan para revisarlo antes de publicar.</p></div></header>
    <div class="body"><div class="grid">
      <div class="f s6"><label>Cuenta de origen</label>
        <select id="impOrigen"><option value="">Elige…</option>${S.cuentas.map(c => `<option value="${esc(c.cuenta)}" ${c.cuenta===IMP.origen?"selected":""}>${esc(c.nombre)} · ${esc(c.moneda)}${cl && c.cuenta===cl.cuenta ? " · esta misma cuenta" : ""}</option>`).join("")}</select>
        <span class="hint">${origen && cl && origen.moneda !== cl.moneda ? `Moneda distinta (${esc(origen.moneda)} → ${esc(cl.moneda)}): los presupuestos llegan en blanco para capturarlos.` : "Puedes traer de cualquier cuenta a la que tenga acceso el token, incluida esta misma para duplicar."}</span></div>
      <div class="f s6"><label>Buscar</label><input type="text" id="impFiltro" value="${esc(IMP.filtro)}" placeholder="Filtra por nombre…" ${IMP.origen?"":"disabled"}></div>
      <div class="f s12">
        ${IMP.cargando ? `<div class="empty"><span class="spinner"></span> Leyendo campañas…</div>`
          : !IMP.origen ? `<div class="empty">Elige la cuenta de origen para ver sus campañas.</div>`
          : !lista.length ? `<div class="empty">No hay campañas activas ni en pausa${IMP.filtro ? " que coincidan" : ""}.</div>`
          : `<div class="imp-lista">${lista.map(x => `<label class="conj ${IMP.sel.has(x.id)?"on":""}"><input type="checkbox" data-impsel="${esc(x.id)}" ${IMP.sel.has(x.id)?"checked":""}>
              <span class="conj-n">${esc(x.n)}</span><span class="conj-r">${esc((OBJETIVOS.find(o=>o.v===x.objetivo)||{t:x.objetivo}).t)} · ${esc(String(x.estado||"").toLowerCase())} · ${x.gasto30 ? "gastó " + fmtMonto(x.gasto30, x.moneda) + " en 30 d" : "sin gasto en 30 d"}</span></label>`).join("")}</div>`}
      </div>
      <div class="f s12 imp-acciones">
        <button class="btn go" id="impTraer" ${IMP.sel.size && !IMP.trayendo ? "" : "disabled"}>${IMP.trayendo ? `<span class="spinner"></span> ${esc(IMP.trayendo)}` : "Traer " + IMP.sel.size + " " + (IMP.sel.size===1?"campaña":"campañas")}</button>
        <button class="btn ghost sm" id="impDescargar" ${IMP.paquetes.length ? "" : "disabled"}>Descargar exportación (.json)</button>
        <label class="btn ghost sm arch-btn">Importar archivo de exportación<input type="file" accept="application/json,.json" id="impArchivo" hidden></label>
      </div>
      ${IMP.reporte ? `<div class="f s12"><div class="note ${IMP.reporte.avisos.length ? "warn" : "go"}"><strong>Se trajeron ${IMP.reporte.campanas} campañas, ${IMP.reporte.conjuntos} conjuntos, ${IMP.reporte.anuncios} anuncios y ${IMP.reporte.creativos} creativos.</strong>
        ${IMP.reporte.avisos.length ? `<ul>${IMP.reporte.avisos.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : " Sin observaciones."}</div></div>` : ""}
    </div></div></div>`;
}
async function cargarImpLista(){
  IMP.lista = []; IMP.sel = new Set(); IMP.cargando = true; render();
  try { const r = await llamar("buscar", {tipo:"campanas", texto:"", cuenta_id: IMP.origen}); IMP.lista = r.resultados || []; }
  catch(e){ alert(e.message); }
  IMP.cargando = false; render();
}
function sumarReporte(r){
  if (!IMP.reporte) IMP.reporte = { campanas:0, conjuntos:0, anuncios:0, creativos:0, avisos:[] };
  ["campanas","conjuntos","anuncios","creativos"].forEach(k => IMP.reporte[k] += r[k]);
  IMP.reporte.avisos = IMP.reporte.avisos.concat(r.avisos);
}
async function traerSeleccion(){
  const ids = [...IMP.sel], cl = cliente();
  IMP.reporte = null; IMP.paquetes = [];
  for (let i = 0; i < ids.length; i += 1){
    const bloque = ids.slice(i, i + 1);
    IMP.trayendo = "Leyendo " + (i + 1) + " de " + ids.length + "…"; render();
    try {
      const paq = await llamar("buscar", {tipo:"importar", origen_cuenta_id: IMP.origen, campaign_ids: bloque.join(","), cuenta_id: cl.cuenta, client_key: S.clienteKey});
      if (paq.formato !== "mbe-export") throw new Error("La respuesta del motor no es un paquete de importación.");
      IMP.paquetes.push(paq); sumarReporte(importarPaquete(paq));
    } catch(e){ sumarReporte({campanas:0,conjuntos:0,anuncios:0,creativos:0,avisos:["No pude traer " + bloque.length + " campaña(s): " + e.message]}); }
  }
  IMP.trayendo = ""; IMP.sel = new Set(); render();
}
const DESTINO_DESC = { WEBSITE:"Visitas y conversiones con el píxel", WHATSAPP:"Abre un chat con tu número", FORMULARIO:"Deja sus datos sin salir de Meta" };
function campanaHTML(c, i, cl){
  if (c.importada) return campanaImportadaHTML(c, i, cl);
  if (c.modo === "EXISTENTE") return `
  <div class="item" data-c="${c.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(c.nombreMeta)}</strong> · existente</span>
    <button class="btn link" data-del="${c.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s3"><label>Objetivo</label><div class="mono">${esc((OBJETIVOS.find(o=>o.v===c.objetivo)||{t:c.objetivo}).t)}</div></div>
      <div class="f s3"><label>Presupuesto</label><div class="mono">${c.cbo ? "En la campaña" : "En cada conjunto"}</div></div>
      <div class="f s3"><label>Categoría especial</label><div class="mono">${esc((CATEGORIAS.find(k=>k.v===c.categoria)||{t:"Ninguna"}).t)}</div></div>
      <div class="f s3"><label>Página</label><div class="mono">${c.pageId ? esc((S.paginas.find(p=>p.id===c.pageId)||{n:c.pageId}).n) : "—"}</div></div>
      <div class="f s12"><span class="hint">Objetivo, presupuesto, fechas y categoría los define la campaña. En el paso siguiente eliges sus conjuntos o le agregas nuevos.</span></div>
    </div></div></div>`;
  const wa = c.destino === "WHATSAPP", fm = c.destino === "FORMULARIO";
  const metas = metasPara(c.objetivo, c.destino);
  const conv = ["OFFSITE_CONVERSIONS","VALUE"].includes(c.meta);
  const objetivos = wa ? OBJETIVOS.filter(x => METAS_WA[x.v]) : fm ? OBJETIVOS.filter(x => x.v === "OUTCOME_LEADS").map(x => Object.assign({}, x, { d:"Formulario instantáneo de Meta" })) : OBJETIVOS;
  const ayudaDestino = wa ? "Los anuncios abren un chat de WhatsApp. Para optimizar por compras en el chat elige Interacción → Compras por mensajes (así lo crea Ads Manager)."
    : fm ? "Los anuncios abren un formulario de Meta sin salir de Facebook o Instagram. El formulario se elige en cada anuncio y puede terminar con un botón a WhatsApp."
    : "Los anuncios llevan al sitio web y se optimizan con el píxel.";
  return `
  <div class="item" data-c="${c.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(nombreCampana(c))}</strong> · nueva</span>
    <button class="btn link" data-dup="${c.id}">Duplicar</button>
    <button class="btn link" data-del="${c.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s3"><label>Marca<span class="req">*</span></label><input type="text" data-f="marca" value="${esc(c.marca)}" placeholder="Acme"></div>
      <div class="f s3"><label>Producto o línea<span class="req">*</span></label><input type="text" data-f="producto" value="${esc(c.producto)}" placeholder="Zapatos verano"></div>
      <div class="f s3"><label>Etapa</label><select data-f="etapa">${ETAPAS.map(e => `<option ${e===c.etapa?"selected":""}>${e}</option>`).join("")}</select></div>
      <div class="f s3"><label>Periodo<span class="req">*</span></label><input type="text" data-f="periodo" value="${esc(c.periodo)}" placeholder="Sep26"></div>
      <div class="f s12"><label>A dónde llegan las personas</label><div class="destinos">
        ${DESTINOS.map(([v, t]) => `<label class="destino ${c.destino===v?"on":""}"><input type="radio" name="dest_${c.id}" value="${v}" data-destino ${c.destino===v?"checked":""}>
          ${icono(ICONO_DESTINO[v])}<span><b>${esc(t)}</b><small>${esc(DESTINO_DESC[v])}</small></span></label>`).join("")}</div>
        <span class="hint">${esc(ayudaDestino)}</span></div>
      <div class="f s4"><label>Qué buscas</label><select data-f="objetivo">${objetivos.map(x => `<option value="${x.v}" ${x.v===c.objetivo?"selected":""}>${esc(x.t)} — ${esc(x.d)}</option>`).join("")}</select></div>
      <div class="f s4"><label>Optimizar hacia</label><select data-f="meta">${metas.map(m => `<option value="${m[0]}" ${m[0]===c.meta?"selected":""}>${esc(m[1])}</option>`).join("")}</select></div>
      ${wa ? configHTML(c) : ""}
      ${wa ? whatsappHTML(c, c.meta) : ""}
      ${conv ? `<div class="f s4"><label>Evento del píxel</label><select data-f="evento">${EVENTOS.map(e => `<option value="${e[0]}" ${e[0]===c.evento?"selected":""}>${esc(e[1])}</option>`).join("")}</select></div>`
             : `<div class="f s4"><label>Categoría especial</label><select data-f="categoria">${CATEGORIAS.map(k => `<option value="${k.v}" ${k.v===c.categoria?"selected":""}>${esc(k.t)}</option>`).join("")}</select></div>`}
      ${conv ? `<div class="f s4"><label>Categoría especial</label><select data-f="categoria">${CATEGORIAS.map(k => `<option value="${k.v}" ${k.v===c.categoria?"selected":""}>${esc(k.t)}</option>`).join("")}</select></div>` : ""}
      <div class="f s3"><label>Presupuesto en</label><select data-f="presupuestoEn"><option value="CAMPAIGN" ${c.presupuestoEn==="CAMPAIGN"?"selected":""}>La campaña (CBO)</option><option value="ADSET" ${c.presupuestoEn==="ADSET"?"selected":""}>Cada conjunto (ABO)</option></select></div>
      <div class="f s3"><label>Diario o total</label><select data-f="tipoMonto"><option value="DAILY" ${c.tipoMonto==="DAILY"?"selected":""}>Diario</option><option value="LIFETIME" ${c.tipoMonto==="LIFETIME"?"selected":""}>Total</option></select></div>
      <div class="f s3"><label>Monto${c.presupuestoEn==="CAMPAIGN"?'<span class="req">*</span>':""}</label><input type="number" data-f="monto" value="${c.presupuestoEn==="ADSET" ? "" : esc(c.monto)}" min="0" ${c.presupuestoEn==="ADSET"?"disabled":""} placeholder="${cl ? "mín. " + minimoDe(c) + " " + cl.moneda : ""}"><span class="hint">${c.presupuestoEn==="ADSET" ? "Se captura por conjunto." : (cl ? "En " + esc(cl.moneda) : "")}</span></div>
      <div class="f s3"><label>Inicio<span class="req">*</span></label><input type="date" data-f="inicio" value="${esc(c.inicio)}"></div>
      <div class="f s3"><label>Fin${c.tipoMonto==="LIFETIME"?'<span class="req">*</span>':""}</label><input type="date" data-f="fin" value="${esc(c.fin)}"><span class="hint">${c.tipoMonto==="LIFETIME"?"Obligatoria con presupuesto total.":"Vacío = sin fecha de fin."}</span></div>
      ${entregaHTML(c)}
    </div></div></div>`;
}
/* Entrega en una línea para el árbol de revisión. */
function entregaCorta(c){
  if (c.modo !== "NUEVA") return "";
  const u = { FBIG:"", AUTO:"ubicaciones Advantage+", FB:"solo Facebook", IG:"solo Instagram" }[c.ubicaciones || "FBIG"];
  return [u, c.audienciaAdv === "ON" ? "Advantage+ audience" : "", c.presupuestoEn === "ADSET" && c.compartir === "SI" ? "comparte 20 %" : ""].filter(Boolean).map(x => " · " + x).join("");
}
/* Entrega (5.3): decisiones que Meta pide o recomienda al crear la campaña. */
function entregaHTML(c){
  const cl = cliente();
  const ub = UBICACIONES.filter(u => u[0] !== "IG" || (cl && cl.ig) || c.ubicaciones === "IG");
  const d = (UBICACIONES.find(u => u[0] === c.ubicaciones) || UBICACIONES[0])[2];
  return `<div class="f s12 sub-h"><span>Entrega</span><small>Cómo reparte Meta el presupuesto y a quién muestra los anuncios</small></div>
      <div class="f s4"><label>Ubicaciones</label><select data-f="ubicaciones">${ub.map(u => `<option value="${u[0]}" ${u[0]===c.ubicaciones?"selected":""}>${esc(u[1])}</option>`).join("")}</select><span class="hint">${esc(d)}</span></div>
      <div class="f s4"><label>Advantage+ audience</label><select data-f="audienciaAdv"><option value="OFF" ${c.audienciaAdv!=="ON"?"selected":""}>Apagado: solo la audiencia que defines</option><option value="ON" ${c.audienciaAdv==="ON"?"selected":""}>Encendido: Meta puede ampliarla</option></select><span class="hint">${c.audienciaAdv==="ON" ? "Recomendado por Meta. Intereses y públicos pasan a ser sugerencia; la ubicación geográfica y las exclusiones se respetan." : "Los conjuntos copiados o con audiencia guardada conservan su propia configuración."}</span></div>
      ${c.presupuestoEn === "ADSET" ? `<div class="f s4"><label>Compartir presupuesto entre conjuntos</label><select data-f="compartir"><option value="NO" ${c.compartir!=="SI"?"selected":""}>No: cada conjunto gasta lo suyo</option><option value="SI" ${c.compartir==="SI"?"selected":""}>Sí: hasta 20 % al que rinda mejor</option></select><span class="hint">Meta exige esta decisión cuando el presupuesto va en cada conjunto.</span></div>` : ""}`;
}
function aCampanas(){
  const pg = $("#pagina"); if (pg) pg.onchange = async () => { S.pageId = pg.value; mensajes(); await Promise.all([cargarWhatsapps(), cargarFormularios(true)]); render(); };
  const rp = $("#reintentarPaginas"); if (rp) rp.onclick = async ev => { ev.preventDefault(); await cargarPaginas(); render(); };
  $("#addNueva").onclick = () => { S.campanas.push(nuevaCampana()); render(); };
  $("#abrirImp").onclick = () => { IMP.abierto = !IMP.abierto; render(); };
  const io = $("#impOrigen"); if (io) io.onchange = () => { IMP.origen = io.value; IMP.filtro = ""; IMP.reporte = null; if (IMP.origen) cargarImpLista(); else render(); };
  const ifi = $("#impFiltro"); if (ifi) ifi.oninput = () => { IMP.filtro = ifi.value; const pos = ifi.selectionStart; render(); const n = $("#impFiltro"); if (n){ n.focus(); n.setSelectionRange(pos, pos); } };
  document.querySelectorAll("[data-impsel]").forEach(cb => cb.onchange = () => { cb.checked ? IMP.sel.add(cb.dataset.impsel) : IMP.sel.delete(cb.dataset.impsel); render(); });
  const it = $("#impTraer"); if (it) it.onclick = () => traerSeleccion();
  const idl = $("#impDescargar"); if (idl) idl.onclick = () => {
    const todo = { formato:"mbe-export", version:1, exportado:new Date().toISOString(), paquetes: IMP.paquetes };
    const blob = new Blob([JSON.stringify(todo, null, 1)], {type:"application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "meta-bulk_exportacion_" + hoy() + ".json"; a.click();
  };
  const ia = $("#impArchivo"); if (ia) ia.onchange = async () => {
    const file = ia.files && ia.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      const paqs = d.paquetes || (d.formato === "mbe-export" ? [d] : null);
      if (!paqs) throw new Error("El archivo no es una exportación de Meta Bulk Editor.");
      IMP.reporte = null;
      paqs.forEach(pq => { const r = importarPaquete(pq); r.avisos.unshift("Desde archivo: las imágenes se toman de las URL guardadas en la exportación; si pasaron varios días, pueden haber vencido y habrá que volver a cargarlas."); sumarReporte(r); });
    } catch(e){ alert(e.message); }
    ia.value = ""; render();
  };
  document.querySelectorAll("[data-c]").forEach(box => {
    const c = S.campanas.find(x => x.id === box.dataset.c);
    ligarNumero(box, c);
    const ci = box.querySelector("[data-cfgid]"); if (ci) ci.oninput = () => { CFGID.valor = ci.value; };
    const cl_ = box.querySelector("[data-cfgleer]"); if (cl_) cl_.onclick = () => { if (CFGID.valor.trim()) leerConfigPorId([c]); };
    const cf = box.querySelector("[data-cfgwa]");
    if (cf) cf.onchange = () => { aplicarConfig(c, (S.configsWA||[]).find(y => y.id === cf.value) || null); delete WAV[c.id]; render(); };
    box.querySelectorAll("[data-destino]").forEach(r => r.onchange = () => {
      c.destino = r.value;
      if (c.destino === "WHATSAPP" && !METAS_WA[c.objetivo]) c.objetivo = "OUTCOME_ENGAGEMENT";
      if (c.destino === "FORMULARIO"){ c.objetivo = "OUTCOME_LEADS"; c.cfgWA = null; }
      if (c.destino !== "FORMULARIO" && c.objetivo === "OUTCOME_LEADS" && !metasPara(c.objetivo, c.destino).length) c.objetivo = "OUTCOME_SALES";
      const ms = metasPara(c.objetivo, c.destino); if (!ms.some(m => m[0] === c.meta)) c.meta = ms[0][0];
      render();
    });
    ligarCampos(box, c, (f) => {
      if (f === "objetivo"){ const ms = metasPara(c.objetivo, c.destino); if (!ms.some(m => m[0] === c.meta)) c.meta = ms[0][0]; render(); }
      if (f === "meta"){ if (c.meta !== "MESSAGING_PURCHASE_CONVERSION") c.cfgWA = null; else sugerirConfigs(); }
      if (["meta","objetivo","datasetMsg","whatsapp","evento"].includes(f)) delete WAV[c.id];
      if (["meta","presupuestoEn","tipoMonto","ubicaciones","audienciaAdv","compartir","datasetMsg"].includes(f)) render();
      if (["marca","producto","etapa","periodo","nombreLibre"].includes(f)) box.querySelector(".head strong").textContent = nombreCampana(c);
    });
    const del = box.querySelector("[data-del]"); if (del) del.onclick = () => {
      S.campanas = S.campanas.filter(x => x.id !== c.id);
      const ids = new Set(conjuntosDe(c).map(k => k.id));
      S.conjuntos = S.conjuntos.filter(k => k.campanaId !== c.id);
      S.anuncios.forEach(a => a.conjuntoIds = a.conjuntoIds.filter(id => !ids.has(id)));
      render();
    };
    const dup = box.querySelector("[data-dup]"); if (dup) dup.onclick = () => {
      const copia = JSON.parse(JSON.stringify(c)); copia.id = uid(); copia.producto = (c.producto||"") + " copia"; copia.conjuntosCargados = true;
      S.campanas.push(copia);
      conjuntosDe(c).forEach(k => { const kc = JSON.parse(JSON.stringify(k)); kc.id = uid(); kc.campanaId = copia.id; S.conjuntos.push(kc); });
      render();
    };
  });
  // buscador de campañas existentes
  const ya = () => new Set(S.campanas.filter(c => c.modo === "EXISTENTE").map(c => c.metaId));
  const f = view.querySelector('.finder[data-cat="campanas"]'), q = f.querySelector("[data-q]"), out = f.querySelector(".results");
  let t;
  q.oninput = () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2){ out.classList.add("hide"); return; } t = setTimeout(() => buscar(v), 280); };
  q.onblur = () => setTimeout(() => out.classList.add("hide"), 180);
  async function buscar(v){
    out.innerHTML = `<div class="empty"><span class="spinner"></span> Buscando…</div>`; out.classList.remove("hide");
    try {
      const r = await llamar("buscar", Object.assign({tipo:"campanas", texto:v}, ctx()));
      const hits = (r.resultados||[]).filter(x => !ya().has(String(x.id)));
      out.innerHTML = hits.length ? hits.map(x => `<button type="button" data-add="${esc(x.id)}"><span>${esc(x.n)}</span><span class="id">${esc(x.r||"")}</span></button>`).join("") : `<div class="empty">Ninguna campaña coincide.</div>`;
      out.querySelectorAll("[data-add]").forEach(b => b.onmousedown = async () => {
        const x = hits.find(h => String(h.id) === b.dataset.add);
        const c = campanaExistente(x);
        S.campanas.push(c); render();
        const antes = S.pageId;
        await paginaDeCampana(c);
        if (S.pageId !== antes || !S.whatsapps.length) await Promise.all([cargarWhatsapps(), cargarFormularios(S.pageId !== antes)]);
        render();
      });
    } catch(e){ out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
}
async function paginaDeCampana(c){
  try {
    const r = await llamar("buscar", Object.assign({tipo:"pagina_de_campana", campaign_id:c.metaId}, ctx()));
    if (r.page_id){
      c.pageId = String(r.page_id);
      if (!S.paginas.some(p => p.id === c.pageId)) S.paginas.push({id:c.pageId, n:r.page_name || c.pageId, r:""});
      if (!S.pageId) S.pageId = c.pageId;
    }
  } catch(e){ /* sin página detectable: se elige a mano */ }
}

/* -------------------------------------------------------- 3 · conjuntos */
async function cargarConjuntosExistentes(){
  for (const c of S.campanas.filter(x => x.modo === "EXISTENTE" && !x.conjuntosCargados)){
    try {
      const r = await llamar("buscar", Object.assign({tipo:"conjuntos", texto:"", campaign_ids:c.metaId}, ctx()));
      const ya = new Set(conjuntosDe(c).filter(k => k.modo === "EXISTENTE").map(k => k.metaId));
      (r.resultados||[]).forEach(x => { if (!ya.has(String(x.id))) S.conjuntos.push(conjuntoExistente(c.id, {id:x.id, n:x.n, r:x.r, optim:x.optim, estado:x.estado, destino:x.destino})); });
      c.conjuntosCargados = true;
    } catch(e){ c.falloConjuntos = e.message; }
  }
}
function vConjuntos(){
  const cl = cliente();
  const hayNuevos = S.conjuntos.some(k => k.modo === "NUEVO" && k.origen !== "CUENTA");
  return `
  <h1>Conjuntos de anuncios</h1>
  <p class="lede">Por cada campaña: marca los conjuntos existentes que reciben anuncios y agrega los nuevos que necesites, con su nombre y su audiencia.</p>
  <div class="panel ${hayNuevos?"":"hide"}"><header><div><h2>País</h2><p>Base geográfica de los conjuntos nuevos</p></div></header>
    <div class="body"><div class="grid">
      <div class="f s6 finder" data-cat="pais" style="position:relative"><label>País<span class="req">*</span></label>
        <div class="chips">${S.pais.cc ? `<span class="tag">${esc(S.pais.n||S.pais.cc)}<button type="button" data-rm-pais aria-label="Quitar">&times;</button></span>` : ""}</div>
        <input type="text" placeholder="${S.pais.cc ? "Para cambiarlo, quita el actual" : "Escribe el país…"}" data-q autocomplete="off" ${S.pais.cc?"disabled":""}>
        <div class="results hide"></div></div>
    </div></div></div>
  ${S.campanas.map(c => {
    const ks = conjuntosDe(c), ex = ks.filter(k => k.modo === "EXISTENTE"), nu = ks.filter(k => k.modo === "NUEVO");
    return `
  <div class="panel"><header><div><h2>${esc(nombreCampana(c))}</h2><p>${c.modo==="EXISTENTE" ? (c.conjuntosCargados ? ex.filter(k=>k.sel).length + " de " + ex.length + " existentes marcados · " : "Cargando conjuntos… · ") : ""}${nu.length} ${nu.length===1?"nuevo":"nuevos"}</p></div>
    <div class="row-actions">${c.modo==="EXISTENTE" && ex.length ? `<button class="btn ghost sm" data-todos="${c.id}">Marcar todos</button><button class="btn ghost sm" data-ninguno="${c.id}">Desmarcar</button>` : ""}<button class="btn sm" data-addk="${c.id}">+ Conjunto nuevo</button></div></header>
    <div class="body">
      ${c.modo==="EXISTENTE" ? (c.falloConjuntos ? `<div class="note stop">${esc(c.falloConjuntos)}</div>` : !c.conjuntosCargados ? `<div class="empty"><span class="spinner"></span> Cargando…</div>` : ex.length ? `<div class="conj-grupo">${ex.map(k => `
        <label class="conj ${k.sel?"on":""}"><input type="checkbox" data-sel="${k.id}" ${k.sel?"checked":""}><span class="conj-n">${esc(k.nombre)}</span><span class="conj-r">${esc(String(k.detalle||"").split(" · ").slice(1).join(" · "))}</span></label>`).join("")}</div>` : `<div class="empty">Esta campaña no tiene conjuntos activos ni en pausa.</div>`) : ""}
      ${nu.map((k,i) => conjuntoHTML(k, i, c, cl)).join("")}
    </div></div>`; }).join("")}`;
}
function conjuntoCopiadoHTML(k, i, c, cl){
  const wa = destinoDe(k) === "WHATSAPP";
  const metas = OBJETIVOS.flatMap(o => o.metas).concat(Object.values(METAS_WA).flat(), METAS_FORM);
  const nombreMeta = (metas.find(m => m[0] === k.meta) || [k.meta, k.meta])[1];
  return `
  <div class="item" data-k="${k.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(nombreConjunto(k))}</strong> · copiado</span>
    <button class="btn link" data-dupk="${k.id}">Duplicar</button><button class="btn link" data-delk="${k.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s6"><label>Nombre del conjunto de anuncios<span class="req">*</span></label><input type="text" data-f="nombre" value="${esc(k.nombre)}"></div>
      <div class="f s3"><label>Optimización</label><div class="mono">${esc(nombreMeta)}${k.evento ? " · " + esc(k.evento) : ""}</div></div>
      <div class="f s3"><label>Destino</label><div class="mono">${esc(nombreDestino(destinoDe(k)))}</div></div>
      ${llevaPresupuestoConjunto(c) ? `<div class="f s3"><label>Presupuesto diario<span class="req">*</span></label><input type="number" data-f="presupuesto" value="${esc(k.presupuesto)}" min="0" placeholder="${cl ? "mín. " + minimoDe(c) : ""}"><span class="hint">${cl ? "En " + esc(cl.moneda) : ""}</span></div>` : ""}
      ${PUJAS_CON_IMPORTE.includes(c.puja) ? `<div class="f s3"><label>Importe de puja<span class="req">*</span></label><input type="number" data-f="pujaMonto" value="${esc(k.pujaMonto)}" min="0"><span class="hint">${esc(c.puja)}</span></div>` : ""}
      ${wa ? whatsappHTML(k, k.meta, "s3") : ""}
      <div class="f s12"><label>Segmentación</label><div class="copia-seg">${esc(resumenSegmentacion(k).replace(/^Copiada · /,""))}</div>
        <span class="hint">Se usa tal como estaba en la cuenta de origen. Los públicos personalizados se tradujeron por nombre a esta cuenta; los que no existen aquí se quitaron y aparecen en el reporte de importación.</span></div>
    </div></div></div>`;
}
function conjuntoHTML(k, i, c, cl){
  if (k.copia) return conjuntoCopiadoHTML(k, i, c, cl);
  const cuenta = k.origen === "CUENTA", rest = restringida(c);
  const o = OBJETIVOS.find(x => x.v === c.objetivo);
  const conv = ["OFFSITE_CONVERSIONS","VALUE"].includes(c.modo === "EXISTENTE" ? k.meta : c.meta);
  return `
  <div class="item" data-k="${k.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(nombreConjunto(k))}</strong> · nuevo</span>
    <button class="btn link" data-dupk="${k.id}">Duplicar</button><button class="btn link" data-delk="${k.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s6"><label>Nombre del conjunto de anuncios${cuenta?"":'<span class="req">*</span>'}</label><input type="text" data-f="nombre" value="${esc(k.nombre)}" placeholder="${cuenta ? "Vacío = el nombre de la audiencia guardada" : "Ej. CDMX · 25-45 · Intereses café"}"><span class="hint">Así se llama en Ads Manager.</span></div>
      ${c.modo==="EXISTENTE" ? `<div class="f s3"><label>Destino</label><select data-f="destino"><option value="WEBSITE" ${k.destino==="WEBSITE"||!k.destino?"selected":""}>Sitio web</option><option value="WHATSAPP" ${k.destino==="WHATSAPP"?"selected":""} ${METAS_WA[c.objetivo]?"":"disabled"}>WhatsApp</option><option value="FORMULARIO" ${k.destino==="FORMULARIO"?"selected":""} ${c.objetivo==="OUTCOME_LEADS"?"":"disabled"}>Formulario instantáneo</option></select>${c.objetivo!=="OUTCOME_LEADS" ? `<span class="hint">Formulario: solo en campañas de Clientes potenciales.</span>` : ""}</div>
      <div class="f s3"><label>Optimizar hacia<span class="req">*</span></label><select data-f="meta"><option value="">Elige…</option>${metasPara(c.objetivo, k.destino).map(m => `<option value="${m[0]}" ${m[0]===k.meta?"selected":""}>${esc(m[1])}</option>`).join("")}</select></div>
      ${k.destino==="WHATSAPP" ? whatsappHTML(k, k.meta, "s3") : ""}` : ""}
      ${c.modo==="EXISTENTE" && conv ? `<div class="f s3"><label>Evento del píxel</label><select data-f="evento">${EVENTOS.map(e => `<option value="${e[0]}" ${e[0]===(k.evento||"PURCHASE")?"selected":""}>${esc(e[1])}</option>`).join("")}</select></div>` : ""}
      ${llevaPresupuestoConjunto(c) ? `<div class="f s3"><label>Presupuesto diario<span class="req">*</span></label><input type="number" data-f="presupuesto" value="${esc(k.presupuesto)}" min="0" placeholder="${cl ? "mín. " + minimoDe(c) : ""}"><span class="hint">${cl ? "En " + esc(cl.moneda) : ""}</span></div>` : ""}
      <div class="f s12"><label>Audiencia</label><div class="seg">
        <label class="opt ${cuenta?"":"on"}"><input type="radio" name="origen_${k.id}" value="DEFINIR" data-origen ${cuenta?"":"checked"}> Definirla aquí</label>
        <label class="opt ${cuenta?"on":""}"><input type="radio" name="origen_${k.id}" value="CUENTA" data-origen ${cuenta?"checked":""}> Usar una audiencia guardada de la cuenta</label></div></div>
      ${cuenta ? finderHTML("cuenta","Audiencia guardada","Escribe parte del nombre…", k, k.cuenta.length>0, "Se usa la segmentación tal como está guardada en Ads Manager.").replace("s6","s12") : `
      ${finderHTML("regiones","Estados o regiones","Escribe un estado…", k, false, "")}
      ${finderHTML("ciudades","Ciudades","Escribe una ciudad…", k, false, "")}
      <div class="f s3"><label>Radio (km)</label><input type="number" data-f="radio" min="0" max="80" value="${k.radio}"></div>
      <div class="f s3"><label>Edad mínima</label><input type="number" data-f="edadMin" min="18" max="65" value="${k.edadMin}" ${rest?"disabled":""}></div>
      <div class="f s3"><label>Edad máxima</label><input type="number" data-f="edadMax" min="18" max="65" value="${k.edadMax}" ${rest?"disabled":""}></div>
      <div class="f s3"><label>Género</label><select data-f="genero" ${rest?"disabled":""}><option value="ALL" ${k.genero==="ALL"?"selected":""}>Todos</option><option value="MALE" ${k.genero==="MALE"?"selected":""}>Hombres</option><option value="FEMALE" ${k.genero==="FEMALE"?"selected":""}>Mujeres</option></select></div>
      ${finderHTML("intereses","Intereses","Escribe un interés…", k, rest, rest ? "Sin intereses con categoría especial." : "")}
      ${finderHTML("guardadas","Públicos personalizados","Listas, similares, visitantes…", k, false, "")}
      ${finderHTML("excluidas","Excluir","Público a excluir…", k, rest, "")}`}
    </div></div></div>`;
}
function aConjuntos(){
  // país
  const fp = view.querySelector('.finder[data-cat="pais"]');
  if (fp){
    const q = fp.querySelector("[data-q]"), out = fp.querySelector(".results"); let t;
    q.oninput = () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2){ out.classList.add("hide"); return; } t = setTimeout(async () => {
      out.innerHTML = `<div class="empty"><span class="spinner"></span> Buscando…</div>`; out.classList.remove("hide");
      try { const r = await llamar("buscar", Object.assign({tipo:"paises", texto:v}, ctx())); const hits = r.resultados||[];
        out.innerHTML = hits.length ? hits.map(x => `<button type="button" data-add="${esc(x.id)}"><span>${esc(x.n)}</span></button>`).join("") : `<div class="empty">Sin resultados.</div>`;
        out.querySelectorAll("[data-add]").forEach(b => b.onmousedown = () => { const h = hits.find(x => x.id === b.dataset.add); S.pais = {cc:h.id, n:h.n}; render(); });
      } catch(e){ out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; } }, 280); };
    q.onblur = () => setTimeout(() => out.classList.add("hide"), 180);
    const rm = fp.querySelector("[data-rm-pais]"); if (rm) rm.onclick = () => { S.pais = {cc:"",n:""}; S.conjuntos.forEach(k => { k.regiones = []; k.ciudades = []; }); render(); };
  }
  document.querySelectorAll("[data-addk]").forEach(b => b.onclick = () => { S.conjuntos.push(nuevoConjunto(b.dataset.addk)); render(); });
  document.querySelectorAll("[data-todos]").forEach(b => b.onclick = () => { conjuntosDe({id:b.dataset.todos}).forEach(k => { if (k.modo==="EXISTENTE") k.sel = true; }); render(); });
  document.querySelectorAll("[data-ninguno]").forEach(b => b.onclick = () => { conjuntosDe({id:b.dataset.ninguno}).forEach(k => { if (k.modo==="EXISTENTE") k.sel = false; }); render(); });
  document.querySelectorAll("[data-sel]").forEach(cb => cb.onchange = () => { const k = conjuntoPorId(cb.dataset.sel); if (k) k.sel = cb.checked; render(); });
  document.querySelectorAll("[data-k]").forEach(box => {
    const k = conjuntoPorId(box.dataset.k);
    ligarCampos(box, k, (f) => { if (f === "nombre") box.querySelector(".head strong").textContent = nombreConjunto(k); if (f === "meta") render(); if (f === "destino"){ k.meta = ""; render(); } });
    box.querySelectorAll("[data-origen]").forEach(r => r.onchange = () => { k.origen = r.value; render(); });
    ligarNumero(box, k);
    montarBuscadores(box, k);
    box.querySelector("[data-delk]").onclick = () => { S.conjuntos = S.conjuntos.filter(x => x.id !== k.id); S.anuncios.forEach(a => a.conjuntoIds = a.conjuntoIds.filter(id => id !== k.id)); render(); };
    box.querySelector("[data-dupk]").onclick = () => { const kc = JSON.parse(JSON.stringify(k)); kc.id = uid(); kc.nombre = (k.nombre||"") + " copia"; S.conjuntos.push(kc); render(); };
  });
}

/* -------------------------------------------------------- 4 · creativos */
function archivoHTML(c, campo, etiqueta, obligatorio, ayuda, video){
  const l = (c.local||{})[campo], aviso = l && l.ancho ? avisoRatio(campo, l) : "";
  const tam = kb => kb >= 1024 ? (kb/1024).toFixed(1) + " MB" : kb + " KB";
  let cuerpo;
  if (l && l.subiendo) cuerpo = `<div class="arch-ok" data-prog="${campo}"><div class="arch-ico">${icono(l.tipo==="VIDEO"?"video":"imagen")}</div><div class="arch-info"><strong>${esc(l.nombre)}</strong>
      <div class="barra"><i style="width:${Math.round((l.progreso||0)*100)}%"></i></div><small class="pct">${Math.round((l.progreso||0)*100)} % · ${esc(l.etapa||"")}</small></div></div>`;
  else if (l && l.fallo) cuerpo = `<div class="arch-ok bad"><div class="arch-ico">${icono("alerta")}</div><div class="arch-info"><strong>${esc(l.nombre)}</strong><small class="warn">${esc(l.fallo)}</small></div><button type="button" class="btn link" data-quitar-local="${campo}">Quitar</button></div>`;
  else if (l) cuerpo = `<div class="arch-ok">${l.preview ? `<img src="${l.preview}" alt="">` : l.data ? `<img src="data:${esc(l.mime||"image/jpeg")};base64,${l.data}" alt="">` : `<div class="arch-ico">${icono(l.video_id?"video":"imagen")}</div>`}
      <div class="arch-info"><strong>${esc(l.nombre)}</strong><small>${l.ancho ? l.ancho + " × " + l.alto + " px · " : ""}${tam(l.kbOriginal || l.kb)}${l.kbOriginal && l.kbOriginal > l.kb ? " → " + tam(l.kb) + " optimizada" : ""}${l.hash || l.video_id ? " · en la cuenta ✓" : ""}</small>
      ${l.etapa && l.video_id ? `<small>${esc(l.etapa)}</small>` : ""}${aviso?`<small class="warn">${esc(aviso)}</small>`:""}</div><button type="button" class="btn link" data-quitar-local="${campo}">Quitar</button></div>`;
  else cuerpo = `<div class="arch-elegir"><label class="btn ghost sm arch-btn">Subir desde el ordenador<input type="file" accept="${video ? "video/mp4,video/quicktime,video/*" : "image/png,image/jpeg,image/webp"}" data-local="${campo}" hidden></label><span class="o">o</span><input type="text" data-f="${campo}" value="${esc(c[campo]||"")}" placeholder="Pega un enlace de descarga directa"></div>`;
  return `<div class="f ${campo==="archivo"?"s12":"s6"}"><label>${esc(etiqueta)}${obligatorio?'<span class="req">*</span>':""}</label>${cuerpo}<span class="hint">${esc(ayuda)}</span></div>`;
}
function creativoHTML(c, i){
  return `
  <div class="item" data-cr="${c.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <input type="text" data-f="nombre" value="${esc(c.nombre)}" placeholder="${esc(nombreCreativo(c,i))}">
    <button class="btn link" data-dupc="${c.id}">Duplicar</button><button class="btn link" data-delc="${c.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s4"><label>Formato</label><select data-f="tipo"><option value="IMAGE" ${c.tipo==="IMAGE"?"selected":""}>Imagen</option><option value="VIDEO" ${c.tipo==="VIDEO"?"selected":""}>Video</option><option value="POST" ${c.tipo==="POST"?"selected":""}>Publicación existente (Facebook o Instagram)</option></select></div>
      <div class="f s8"><label>Nombre del creativo</label><input type="text" data-f="nombre" value="${esc(c.nombre)}" placeholder="Ej. Verano piscina · v1"><span class="hint">Referencia interna; el nombre del anuncio se define en el paso siguiente.</span></div>
      ${c.tipo==="POST" ? publicacionHTML(c) : c.tipo==="VIDEO" ? archivoHTML(c, "archivo", "Video", true, "Hasta " + LIMITE_VIDEO_GB + " GB. Se sube a la cuenta por partes al elegirlo; puedes seguir trabajando mientras avanza.", true)
        : archivoHTML(c,"archivo","Feeds e In-stream · 1:1 o 4:5", true, "La imagen base. Si no cargas las otras, Meta la adapta a todas las ubicaciones.")
        + archivoHTML(c,"archivoStories","Stories, Status y Reels · 9:16", false, "Vertical completa. Vacío = Meta recorta la de feed.")
        + archivoHTML(c,"archivoColumna","Columna derecha y búsqueda · 1.91:1", false, "Horizontal. Vacío = Meta recorta la de feed.")}
    </div></div></div>`;
}
function vCreativos(){
  return `
  <h1>Creativos</h1>
  <p class="lede">La biblioteca de piezas: imágenes, videos y publicaciones que ya están en la página o en Instagram. Los textos, el botón y la URL se escriben en cada anuncio, en el paso siguiente.</p>
  <div class="panel"><header><div><h2>${S.creativos.length} ${S.creativos.length===1?"creativo":"creativos"}</h2><p>Imagen con hasta tres tamaños, video, o publicación existente</p></div>
    <div class="row-actions"><button class="btn sm" id="addCr">+ Creativo</button></div></header>
    <div class="body">${S.creativos.length ? S.creativos.map(creativoHTML).join("") : `<div class="empty">Todavía no hay creativos.</div>`}</div></div>`;
}
function aCreativos(){
  $("#addCr").onclick = () => { S.creativos.push(nuevoCreativo()); render(); };
  document.querySelectorAll("[data-cr]").forEach(box => {
    const c = S.creativos.find(x => x.id === box.dataset.cr);
    ligarCampos(box, c, (f, el) => {
      if (f === "tipo"){ const l = (c.local||{}).archivo; if (l && ((c.tipo === "VIDEO" && !l.video_id && !l.subiendo) || (c.tipo === "IMAGE" && l.video_id) || c.tipo === "POST")) delete c.local.archivo;
        if (c.tipo === "POST"){ PUBS.abiertoPara = c.id; cargarPublicaciones(); } render(); }
      if (f === "nombre") box.querySelectorAll('[data-f="nombre"]').forEach(x => { if (x !== el) x.value = c.nombre; });
    });
    box.querySelectorAll("[data-local]").forEach(inp => inp.onchange = () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      subirArchivo(c, inp.dataset.local, file);
    });
    box.querySelectorAll("[data-quitar-local]").forEach(b => b.onclick = () => { if (c.local) delete c.local[b.dataset.quitarLocal]; render(); });
    ligarPublicacion(box, c);
    /* Al cambiar de imagen a video (o al revés) el archivo subido deja de servir. */
    box.querySelector("[data-delc]").onclick = () => { S.creativos = S.creativos.filter(x => x.id !== c.id); S.anuncios.forEach(a => { if (a.creativoId === c.id) a.creativoId = ""; }); render(); };
    box.querySelector("[data-dupc]").onclick = () => { const cc = JSON.parse(JSON.stringify(c)); cc.id = uid(); cc.nombre = (c.nombre||nombreCreativo(c, S.creativos.indexOf(c))) + " copia"; S.creativos.push(cc); render(); };
  });
}

/* --------------------------------------------------------- 5 · anuncios */
function conjuntosAgrupados(){
  return S.campanas.map(c => ({ c, ks: conjuntosDe(c).filter(k => k.modo === "NUEVO" || k.sel) })).filter(g => g.ks.length);
}
function listaTextos(a, campo, etiqueta, ayuda, lim, filas){
  const arr = a[campo] && a[campo].length ? a[campo] : [""];
  return `<div class="f s12 lista-textos" data-lista="${campo}"><label>${esc(etiqueta)}<span class="req">*</span></label>
    ${arr.map((t, j) => `<div class="texto-fila">
      <span class="idx">${j+1}</span>
      ${filas > 1 ? `<textarea data-tx="${j}" rows="${filas}" maxlength="300" placeholder="${j===0?"Obligatorio":"Opcional"}">${esc(t)}</textarea>` : `<input type="text" data-tx="${j}" maxlength="80" placeholder="${j===0?"Obligatorio":"Opcional"}" value="${esc(t)}">`}
      <span class="count ${t.length>lim?"over":""}">${t.length}/${lim}</span>
      ${arr.length > 1 ? `<button type="button" class="btn link" data-tx-rm="${j}" aria-label="Quitar">&times;</button>` : ""}
    </div>`).join("")}
    <div class="texto-acciones">${arr.length < 5 ? `<button type="button" class="btn ghost sm" data-tx-add>+ Otra opción</button>` : `<span class="hint">Máximo 5.</span>`}<span class="hint">${esc(ayuda)}</span></div>
  </div>`;
}
function plantillaHTML(a){
  const deEste = S.anuncios.filter(x => x.id !== a.id && !x.secuencia && ((x.saludo||"").trim() || (x.prellenado||"").trim()))
    .map(x => ({ id:"plan:" + x.id, n:(x.saludo || x.prellenado).slice(0,70), r:"en este plan · " + nombreAnuncio(x), saludo:x.saludo, prellenado:x.prellenado, preguntas:(x.preguntas||[]).slice(), secuencia:"" }));
  const cuenta = S.plantillasWA || [];
  const grupo = (t, xs) => xs.length ? `<optgroup label="${esc(t)}">${xs.map(x => `<option value="${esc(x.id)}" ${x.id===a.plantilla?"selected":""}>${esc(x.n)} · ${esc(x.r)}</option>`).join("")}</optgroup>` : "";
  return `<div class="f s12"><label>Plantilla de mensaje</label>
    <select data-plantilla><option value="">${S.cargandoWhatsapps ? "Cargando plantillas…" : "Escribir un mensaje nuevo"}</option>
      ${grupo("Usadas con esta página", cuenta.filter(x => x.conEsta && !x.secuencia))}
      ${grupo("Usadas con otras páginas", cuenta.filter(x => !x.conEsta && !x.secuencia))}
      ${grupo("Secuencias de WhatsApp Business", cuenta.filter(x => x.secuencia))}
      ${grupo("De otros anuncios de este plan", deEste)}
    </select>
    <span class="hint">${cuenta.length || deEste.length ? "Mensajes ya publicados en anuncios de WhatsApp de la cuenta. Al elegir uno se copian sus textos y puedes ajustarlos."
      : (S.diagPlantillas ? "Revisé " + S.diagPlantillas.conjuntosWhatsApp + " conjuntos de WhatsApp de la cuenta y ninguno tiene mensaje de bienvenida personalizado." : "No encontré mensajes publicados en anuncios de WhatsApp de esta cuenta.")
      + " Las plantillas guardadas con \"Create template\" en Ads Manager no se pueden leer por API."}</span></div>`;
}
 /* ------------------------------------------------ creador de formularios */
const PREGUNTAS_FORM = [["FULL_NAME","Nombre completo"],["PHONE","Teléfono"],["EMAIL","Correo"],["CITY","Ciudad"],["STATE","Estado"],["ZIP","Código postal"],["COMPANY_NAME","Empresa"],["JOB_TITLE","Puesto"]];
const FORM = { abierto:false, creando:false, error:"", hecho:"", avisos:[], d:null };
function formNuevo(){
  const wa = (S.whatsapps || []).find(x => x.grupo === "ESTA_PAGINA") || (S.whatsapps || [])[0];
  return { nombre:"", tipo:"VOLUMEN", idioma:"es_LA", preguntas:["FULL_NAME","PHONE","EMAIL"], personalizadas:[{label:"", opciones:""}],
    intro_titulo:"", intro_texto:"", privacidad_url:"", privacidad_texto:"Aviso de privacidad",
    cierre:{ titulo:"¡Gracias! Recibimos tus datos", texto:"Un asesor te contactará muy pronto.", boton:"VIEW_WEBSITE", url:"",
      telefono: wa ? wa.id : "", mensaje_whatsapp:"Hola, acabo de dejar mis datos en el formulario.", texto_boton:"" } };
}
function formularioPanelHTML(){
  const hayForm = conjuntosActivos().some(k => destinoConjunto(k) === "FORMULARIO");
  if (!hayForm && !FORM.abierto) return "";
  const pagina = (S.paginas.find(p => p.id === S.pageId) || {n:"la página elegida"}).n;
  const activos = (S.formularios||[]).filter(x => x.estado === "ACTIVE").length;
  const d = FORM.d;
  const campo = (ruta, etiqueta, tam, extra) => { const v = ruta.split(".").reduce((o,k) => (o||{})[k], d); return `<div class="f ${tam}"><label>${etiqueta}</label><input type="text" data-fm="${ruta}" value="${esc(v||"")}" ${extra||""}></div>`; };
  const boton = d ? d.cierre.boton : "";
  return `<div class="panel bloque"><header><div><h2>Formularios instantáneos</h2><p>${esc(pagina)} · ${S.cargandoFormularios ? "cargando…" : activos + (activos===1 ? " formulario activo" : " formularios activos")}</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="fmRecargar">Volver a cargar</button><button class="btn sm" id="fmAbrir">${FORM.abierto ? "Cerrar" : "+ Crear formulario"}</button></div></header>
    ${FORM.hecho ? `<div class="body"><div class="note go">${esc(FORM.hecho)}${FORM.avisos.length ? `<ul>${FORM.avisos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div></div>` : ""}
    ${FORM.abierto && d ? `<div class="body"><div class="grid">
      ${campo("nombre", 'Nombre del formulario<span class="req">*</span>', "s6", 'placeholder="Ej. Cotización · Sep26" maxlength="200"')}
      <div class="f s3"><label>Tipo</label><select data-fm="tipo"><option value="VOLUMEN" ${d.tipo==="VOLUMEN"?"selected":""}>Más volumen</option><option value="INTENCION" ${d.tipo==="INTENCION"?"selected":""}>Mayor intención (con revisión)</option></select></div>
      <div class="f s3"><label>Idioma</label><select data-fm="idioma">${[["es_LA","Español (Latinoamérica)"],["es_ES","Español (España)"],["en_US","Inglés"],["pt_BR","Portugués"]].map(x => `<option value="${x[0]}" ${d.idioma===x[0]?"selected":""}>${x[1]}</option>`).join("")}</select></div>
      <div class="f s12"><label>Preguntas<span class="req">*</span></label><div class="seg">${PREGUNTAS_FORM.map(([v,t]) => `<label class="opt ${d.preguntas.includes(v)?"on":""}"><input type="checkbox" data-fmq="${v}" ${d.preguntas.includes(v)?"checked":""}> ${t}</label>`).join("")}</div>
        <span class="hint">Meta rellena estos campos con los datos del perfil; la persona solo confirma.</span></div>
      ${d.personalizadas.map((q, j) => `<div class="f s6"><label>Pregunta propia ${j+1}</label><input type="text" data-fmp-label="${j}" value="${esc(q.label)}" placeholder="Ej. ¿Qué paquete te interesa?" maxlength="120"></div>
        <div class="f s6"><label>Opciones (separadas por ;)</label><input type="text" data-fmp-ops="${j}" value="${esc(q.opciones)}" placeholder="Vacío = respuesta libre · Internet;TV;Telefonía"></div>`).join("")}
      ${d.personalizadas.length < 3 ? `<div class="f s12"><button type="button" class="btn ghost sm" id="fmMasPregunta">+ Pregunta propia</button></div>` : ""}
      ${campo("intro_titulo", "Introducción · título", "s6", 'maxlength="60" placeholder="Opcional"')}
      ${campo("intro_texto", "Introducción · texto", "s6", 'maxlength="800" placeholder="Opcional: qué obtiene la persona al dejar sus datos"')}
      ${campo("privacidad_url", 'Aviso de privacidad (enlace https)<span class="req">*</span>', "s8", 'placeholder="https://tusitio.com/privacidad"')}
      ${campo("privacidad_texto", "Texto del enlace", "s4", 'maxlength="70"')}
      <div class="f s12 sub-h"><span>Pantalla final</span><small>Lo que ve la persona al enviar</small></div>
      ${campo("cierre.titulo", "Título", "s6", 'maxlength="60"')}
      ${campo("cierre.texto", "Texto", "s6", 'maxlength="160"')}
      <div class="f s4"><label>Botón</label><select data-fm="cierre.boton">${[["VIEW_WEBSITE","Ver sitio web"],["WHATSAPP","Chatear en WhatsApp"],["CALL_BUSINESS","Llamar"],["NONE","Sin botón"]].map(x => `<option value="${x[0]}" ${boton===x[0]?"selected":""}>${x[1]}</option>`).join("")}</select></div>
      ${boton === "VIEW_WEBSITE" ? campo("cierre.url", 'URL del botón<span class="req">*</span>', "s8", 'placeholder="https://"') : ""}
      ${boton === "WHATSAPP" || boton === "CALL_BUSINESS" ? `<div class="f s4"><label>Número${boton==="WHATSAPP"?" de WhatsApp":""}<span class="req">*</span></label><input type="text" data-fm="cierre.telefono" value="${esc(d.cierre.telefono||"")}" list="fmNums" placeholder="+52 81 1454 0207">
        <datalist id="fmNums">${(S.whatsapps||[]).map(x => `<option value="${esc(x.id)}">${esc(x.n)}</option>`).join("")}</datalist><span class="hint">Con código de país.</span></div>` : ""}
      ${boton === "WHATSAPP" ? campo("cierre.mensaje_whatsapp", "Mensaje con el que abre el chat", "s4", 'maxlength="200"') : ""}
      ${boton !== "NONE" ? campo("cierre.texto_boton", "Texto del botón", "s4", 'maxlength="60" placeholder="' + (boton==="WHATSAPP" ? "Chatear en WhatsApp" : boton==="CALL_BUSINESS" ? "Llamar" : "Ver sitio web") + '"') : ""}
      ${boton === "WHATSAPP" ? `<div class="f s12"><span class="hint">Se intenta primero el botón nativo de WhatsApp de Meta. Si la página no lo admite, el formulario se crea con un botón que abre el chat por enlace (wa.me) con este número y mensaje.</span></div>` : ""}
      <div class="f s12 imp-acciones"><button class="btn go" id="fmCrear" ${FORM.creando?"disabled":""}>${FORM.creando ? `<span class="spinner"></span> Creando en Meta…` : "Crear formulario en la página"}</button>
        ${FORM.error ? `<span class="hint warn-t">${esc(FORM.error)}</span>` : `<span class="hint">Se crea activo en ${esc(pagina)}. Después se puede editar o archivar en Meta Business Suite.</span>`}</div>
    </div></div>` : ""}</div>`;
}
function ligarFormularioPanel(){
  const ab = $("#fmAbrir"); if (ab) ab.onclick = () => { FORM.abierto = !FORM.abierto; if (FORM.abierto && !FORM.d) FORM.d = formNuevo(); FORM.error = ""; FORM.hecho = ""; render(); };
  const rc = $("#fmRecargar"); if (rc) rc.onclick = async () => { S.cargandoFormularios = true; render(); await cargarFormularios(true); render(); };
  const d = FORM.d; if (!d) return;
  document.querySelectorAll("[data-fm]").forEach(el => {
    const ruta = el.dataset.fm.split(".");
    const upd = () => { let o = d; for (let i = 0; i < ruta.length - 1; i++) o = o[ruta[i]]; o[ruta[ruta.length-1]] = el.value; if (el.dataset.fm === "cierre.boton") render(); };
    el.oninput = upd; el.onchange = upd;
  });
  document.querySelectorAll("[data-fmq]").forEach(cb => cb.onchange = () => { const v = cb.dataset.fmq; d.preguntas = cb.checked ? [...new Set(d.preguntas.concat([v]))] : d.preguntas.filter(x => x !== v); render(); });
  document.querySelectorAll("[data-fmp-label]").forEach(el => el.oninput = () => { d.personalizadas[+el.dataset.fmpLabel].label = el.value; });
  document.querySelectorAll("[data-fmp-ops]").forEach(el => el.oninput = () => { d.personalizadas[+el.dataset.fmpOps].opciones = el.value; });
  const mp = $("#fmMasPregunta"); if (mp) mp.onclick = () => { d.personalizadas.push({label:"", opciones:""}); render(); };
  const cr = $("#fmCrear"); if (cr) cr.onclick = async () => {
    const faltan = [];
    if (!d.nombre.trim()) faltan.push("el nombre");
    if (!/^https:\/\//i.test(d.privacidad_url.trim())) faltan.push("el aviso de privacidad (https://)");
    if (!d.preguntas.length && !d.personalizadas.some(q => q.label.trim())) faltan.push("al menos una pregunta");
    if (d.cierre.boton === "VIEW_WEBSITE" && !/^https?:\/\//i.test(d.cierre.url.trim())) faltan.push("la URL del botón final");
    if ((d.cierre.boton === "WHATSAPP" || d.cierre.boton === "CALL_BUSINESS") && !numeroValido(d.cierre.telefono)) faltan.push("un número válido con código de país");
    if (faltan.length){ FORM.error = "Falta " + faltan.join(", ") + "."; render(); return; }
    FORM.creando = true; FORM.error = ""; render();
    try {
      const payload = Object.assign({}, d, { personalizadas: d.personalizadas.filter(q => q.label.trim()).map(q => ({ label:q.label.trim(), opciones:q.opciones.split(";").map(x => x.trim()).filter(Boolean) })) });
      const r = await llamar("formularios", Object.assign({ op:"crear", page_id:S.pageId, formulario:payload }, ctx()));
      if (!r.formulario) throw new Error("Meta no devolvió el formulario creado.");
      S.formularios = [r.formulario].concat((S.formularios||[]).filter(x => x.id !== r.formulario.id));
      let asignados = 0;
      S.anuncios.forEach(a => { if (!a.formId && destinosDelAnuncio(a).includes("FORMULARIO")){ a.formId = r.formulario.id; asignados++; } });
      FORM.hecho = 'Se creó el formulario "' + r.formulario.n + '" (ID ' + r.formulario.id + ')' + (asignados ? " y se asignó a " + asignados + (asignados===1 ? " anuncio que no tenía formulario." : " anuncios que no tenían formulario.") : ".");
      FORM.avisos = r.avisos || []; FORM.abierto = false; FORM.d = null;
      toast('Formulario "' + r.formulario.n + '" creado en la página.');
    } catch(e){ FORM.error = e.message; }
    FORM.creando = false; render();
  };
}
const UTM_ESTANDAR = "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}";
const BLOQUE = { url:"", cta:"", urlTags:"", descripcion:"", saludo:"", prellenado:"", formId:"", mejoras:"", abierto:false, hecho:"" };
const TABLA = { abierto:false, texto:"", reporte:null };
function tablaHTML(){
  if (!conjuntosActivos().length) return "";
  return `<div class="panel bloque"><header><div><h2>Cargar anuncios desde Excel o Google Sheets</h2><p>Copia las filas de tu hoja (con los encabezados) y pégalas aquí. Crea los creativos y anuncios de una vez.</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="tablaPlantilla">Descargar plantilla</button><button class="btn ghost sm" id="tablaAbrir">${TABLA.abierto ? "Cerrar" : "Abrir"}</button></div></header>
    ${TABLA.abierto ? `<div class="body"><div class="grid">
      <div class="f s12"><textarea id="tablaTexto" rows="7" placeholder="nombre	imagen	texto1	titulo1	boton	url	conjuntos&#10;Oferta A	https://…/a.jpg	El plan más completo…	Solo hoy	Más información	https://izzi.mx	MX 25-45">${esc(TABLA.texto)}</textarea>
        <span class="hint">Columnas: nombre, imagen (enlace o nombre de un creativo existente), stories, columna, formato, texto1…texto5, titulo1…titulo5, descripcion, boton, url, utm, conjuntos (separados por ; — vacío = todos), saludo, prellenado, formulario (nombre o ID, para conjuntos con formulario), mejoras (meta o apagadas). Acepta también CSV con coma o punto y coma.</span></div>
      <div class="f s12 imp-acciones"><button class="btn go" id="tablaAgregar">Agregar anuncios</button></div>
      ${TABLA.reporte ? `<div class="f s12"><div class="note ${TABLA.reporte.errores.length ? "warn" : "go"}"><strong>Se agregaron ${TABLA.reporte.anuncios} anuncios y ${TABLA.reporte.creativos} creativos.</strong>
        ${TABLA.reporte.errores.length ? `<ul>${TABLA.reporte.errores.map(e => `<li>${esc(e)}</li>`).join("")}</ul><span class="hint">Las filas con error no se agregaron: corrígelas en la hoja y pega solo esas.</span>` : ""}</div></div>` : ""}
    </div></div>` : ""}</div>`;
}
function ligarTabla(){
  const ab = $("#tablaAbrir"); if (ab) ab.onclick = () => { TABLA.abierto = !TABLA.abierto; render(); };
  const tx = $("#tablaTexto"); if (tx) tx.oninput = () => { TABLA.texto = tx.value; };
  const ag = $("#tablaAgregar"); if (ag) ag.onclick = () => {
    const filas = parsearTabla(TABLA.texto);
    if (!filas.length){ TABLA.reporte = { anuncios:0, creativos:0, errores:["No encontré filas: pega también la fila de encabezados."] }; render(); return; }
    TABLA.reporte = importarFilasAnuncios(filas);
    if (!TABLA.reporte.errores.length) TABLA.texto = "";
    render();
  };
  const pl = $("#tablaPlantilla"); if (pl) pl.onclick = () => {
    const ej = ["Oferta A","https://ejemplo.com/a.jpg","","","imagen","El plan más completo por $350","","Solo hoy","","","Más información","https://ejemplo.com","utm_source=meta&utm_medium=paid_social", conjuntosActivos().map(k => nombreConjunto(k)).slice(0,2).join("; "), "", "", "", "meta"];
    const csv = "\uFEFF" + [PLANTILLA_TABLA, ej].map(f => f.map(v => /[;"\n]/.test(v) ? '"' + String(v).replace(/"/g,'""') + '"' : v).join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"})); a.download = "plantilla_anuncios.csv"; a.click();
  };
}
function bloqueHTML(){
  if (S.anuncios.length < 2) return "";
  const hayWA = S.anuncios.some(a => destinosDelAnuncio(a).includes("WHATSAPP"));
  return `<div class="panel bloque"><header><div><h2>Edición en bloque</h2><p>Aplica un valor a todos los anuncios de una vez. Los campos vacíos no se tocan.</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="bloqueAbrir">${BLOQUE.abierto ? "Cerrar" : "Abrir"}</button></div></header>
    ${BLOQUE.abierto ? `<div class="body"><div class="grid">
      <div class="f s6"><label>URL de destino</label><input type="url" data-b="url" value="${esc(BLOQUE.url)}" placeholder="https://"></div>
      <div class="f s3"><label>Botón</label><select data-b="cta"><option value="">Sin cambios</option>${CTAS.map(x => `<option value="${x[0]}" ${x[0]===BLOQUE.cta?"selected":""}>${esc(x[1])}</option>`).join("")}</select></div>
      <div class="f s3"><label>Descripción</label><input type="text" data-b="descripcion" value="${esc(BLOQUE.descripcion)}" maxlength="60"></div>
      <div class="f s8"><label>Parámetros de URL (UTM)</label><div class="utm-fila"><input type="text" data-b="urlTags" value="${esc(BLOQUE.urlTags)}" placeholder="utm_source=meta&…"><button type="button" class="btn ghost sm" id="bloqueUtm">Usar estándar</button></div></div>
      <div class="f s4"><label>Mejoras automáticas de Meta</label><select data-b="mejoras"><option value="">Sin cambios</option>${MEJORAS.map(m => `<option value="${m[0]}" ${m[0]===BLOQUE.mejoras?"selected":""}>${esc(m[1])}</option>`).join("")}</select></div>
      ${hayWA ? `<div class="f s6"><label>Saludo de WhatsApp</label><input type="text" data-b="saludo" value="${esc(BLOQUE.saludo)}" maxlength="300"></div>
      <div class="f s6"><label>Mensaje prellenado</label><input type="text" data-b="prellenado" value="${esc(BLOQUE.prellenado)}" maxlength="300"></div>` : ""}
      ${S.anuncios.some(a => destinosDelAnuncio(a).includes("FORMULARIO")) ? `<div class="f s12"><label>Formulario instantáneo</label><select data-b="formId"><option value="">Sin cambios</option>${(S.formularios||[]).filter(x => x.estado === "ACTIVE").map(x => `<option value="${esc(x.id)}" ${x.id===BLOQUE.formId?"selected":""}>${esc(x.n)}</option>`).join("")}</select><span class="hint">Se aplica a los anuncios que entran en conjuntos con formulario.</span></div>` : ""}
      <div class="f s12 imp-acciones"><button class="btn go" id="bloqueAplicar">Aplicar a los ${S.anuncios.length} anuncios</button>${BLOQUE.hecho ? `<span class="hint">${esc(BLOQUE.hecho)}</span>` : ""}</div>
    </div></div>` : ""}</div>`;
}
function ligarBloque(){
  const ab = $("#bloqueAbrir"); if (ab) ab.onclick = () => { BLOQUE.abierto = !BLOQUE.abierto; BLOQUE.hecho = ""; render(); };
  document.querySelectorAll("[data-b]").forEach(el => { el.oninput = el.onchange = () => { BLOQUE[el.dataset.b] = el.value; }; });
  const bu = $("#bloqueUtm"); if (bu) bu.onclick = () => { BLOQUE.urlTags = UTM_ESTANDAR; render(); };
  const ap = $("#bloqueAplicar"); if (ap) ap.onclick = () => {
    const campos = ["url","cta","urlTags","descripcion","saludo","prellenado","formId","mejoras"].filter(k => String(BLOQUE[k]||"").trim());
    if (!campos.length){ BLOQUE.hecho = "No hay ningún campo con valor."; render(); return; }
    S.anuncios.forEach(a => campos.forEach(k => { if (k === "formId" && !destinosDelAnuncio(a).includes("FORMULARIO")) return; a[k] = BLOQUE[k].trim(); if (k === "prellenado") a.preguntas = []; }));
    BLOQUE.hecho = "Aplicado: " + campos.length + " campo(s) en " + S.anuncios.length + " anuncios.";
    render();
  };
}
const PREV = { id:"", cargando:false, items:[], error:"" };
const NOMBRE_FMT = { MOBILE_FEED_STANDARD:"Facebook feed", INSTAGRAM_STANDARD:"Instagram feed", INSTAGRAM_STORY:"Instagram Stories" };
function previewHTML(a){
  if (PREV.id !== a.id) return "";
  if (PREV.cargando) return `<div class="f s12"><div class="empty"><span class="spinner"></span> Meta está generando la vista previa…</div></div>`;
  if (PREV.error) return `<div class="f s12"><div class="note stop">${esc(PREV.error)}</div></div>`;
  return `<div class="f s12"><div class="previews">${PREV.items.map(x => `<figure><figcaption>${esc(NOMBRE_FMT[x.formato] || x.formato)}</figcaption>
    ${x.src ? `<iframe src="${esc(x.src)}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" class="${x.formato==="INSTAGRAM_STORY"?"story":""}"></iframe>` : `<div class="note warn">${esc(x.error || "Sin vista previa")}</div>`}</figure>`).join("")}</div>
    <span class="hint">Así lo renderiza Meta con los datos actuales (primer texto y primer título). Los textos largos se ven recortados como en la plataforma.</span></div>`;
}
async function pedirPreview(a){
  const cr = S.creativos.find(c => c.id === a.creativoId);
  if (!cr){ PREV.id = a.id; PREV.error = "Elige un creativo para ver la vista previa."; render(); return; }
  const l = (cr.local||{}).archivo || {};
  if (!l.hash && !l.video_id && !cr.archivo){ PREV.id = a.id; PREV.error = "El creativo todavía no tiene archivo."; render(); return; }
  if (cr.tipo === "VIDEO" && !l.video_id){ PREV.id = a.id; PREV.error = "La vista previa de video necesita el video subido a la cuenta (no por enlace)."; render(); return; }
  Object.assign(PREV, { id:a.id, cargando:true, items:[], error:"" }); render();
  const dests = destinosDelAnuncio(a);
  try {
    const r = await llamar("buscar", Object.assign({ tipo:"preview", page_id:S.pageId, anuncio:{
      texto: limpios(a.textos)[0] || "", titulo: limpios(a.titulos)[0] || "", descripcion: a.descripcion || "",
      url: a.url || "", cta: a.cta, whatsapp: dests.includes("WHATSAPP") && !dests.includes("WEBSITE") && !dests.includes("FORMULARIO"),
      formulario: dests.includes("FORMULARIO") && !dests.includes("WEBSITE") ? (a.formId || "") : "",
      image_hash: l.hash || "", image_url: l.hash ? "" : (cr.tipo === "IMAGE" ? cr.archivo : ""), video_id: l.video_id || "" } }, ctx()));
    PREV.items = r.previews || [];
  } catch(e){ PREV.error = e.message; }
  PREV.cargando = false; render();
}
function botonHTML(a, dests){
  const web = dests.includes("WEBSITE"), form = dests.includes("FORMULARIO"), wa = dests.includes("WHATSAPP");
  if (!web && !form) return `<div class="f s6"><label>Botón</label><div class="mono">Enviar mensaje de WhatsApp</div><span class="hint">Fijo en anuncios que abren WhatsApp.</span></div>`;
  const opciones = form ? CTAS.filter(x => CTAS_FORM.includes(x[0])) : CTAS;
  const nota = [wa ? "En los conjuntos de WhatsApp el botón es «Enviar mensaje»." : "", form && !CTAS_FORM.includes(a.cta) ? "Ese botón no existe con formularios: elige otro." : ""].filter(Boolean).join(" ");
  /* Si el botón guardado no existe con este destino, se muestra tal cual (marcado) para que se vea qué corregir. */
  const invalido = !opciones.some(x => x[0] === a.cta) ? (CTAS.find(x => x[0] === a.cta) || [a.cta, a.cta]) : null;
  return `<div class="f s3"><label>Botón</label><select data-f="cta" ${invalido ? 'class="invalido"' : ""}>${invalido ? `<option value="${esc(invalido[0])}" selected>${esc(invalido[1])} · no disponible aquí</option>` : ""}${opciones.map(x => `<option value="${x[0]}" ${x[0]===a.cta?"selected":""}>${esc(x[1])}</option>`).join("")}</select>${nota ? `<span class="hint ${invalido ? "warn-t" : ""}">${esc(nota)}</span>` : ""}</div>
    ${web ? `<div class="f s3"><label>URL de destino<span class="req">*</span></label><input type="url" data-f="url" value="${esc(a.url||"")}" placeholder="https://"><span class="hint">${wa || form ? "Solo para los conjuntos que van al sitio web." : ""}</span></div>` : `<div class="f s3"></div>`}`;
}
function formularioAnuncioHTML(a){
  const lista = S.formularios || [];
  const suelto = a.formId && !lista.some(x => x.id === a.formId);
  return `<div class="f s12 sub-h"><span>Formulario instantáneo</span><small>Lo que llena la persona sin salir de Facebook o Instagram</small></div>
    <div class="f s12"><label>Formulario<span class="req">*</span></label>
      <select data-f="formId">
        <option value="">${S.cargandoFormularios ? "Cargando formularios…" : (lista.length ? "Elige…" : "La página no tiene formularios todavía")}</option>
        ${suelto ? `<option value="${esc(a.formId)}" selected>ID ${esc(a.formId)} · no está en la página elegida</option>` : ""}
        ${lista.map(x => `<option value="${esc(x.id)}" ${x.id===a.formId?"selected":""} ${x.estado!=="ACTIVE"?"disabled":""}>${esc(x.n)} · ${esc(x.r)}</option>`).join("")}
      </select>
      <span class="hint">${S.falloFormularios ? `<span class="warn-t">${esc(S.falloFormularios)}</span> ` : "Formularios de la página elegida; los borradores y archivados no se pueden usar. "}
        <a href="#" data-recargar-forms>Volver a cargar</a> · <a href="#" data-crear-form>Crear uno nuevo</a></span></div>`;
}
function anuncioHTML(a, i){
  const grupos = conjuntosAgrupados();
  const dests = destinosDelAnuncio(a).length ? destinosDelAnuncio(a) : ["WEBSITE"];
  const cr = creativoDe(a);
  return `
  <div class="item" data-a="${a.id}"><div class="head"><span class="idx">${String(i+1).padStart(2,"0")}</span>
    <span class="mono" style="flex:1"><strong>${esc(nombreAnuncio(a))}</strong> · ${a.conjuntoIds.length} ${a.conjuntoIds.length===1?"conjunto":"conjuntos"}</span>
    <button class="btn link" data-dupa="${a.id}">Duplicar</button><button class="btn link" data-dela="${a.id}">Quitar</button></div>
    <div class="inner"><div class="grid">
      <div class="f s6"><label>Nombre del anuncio<span class="req">*</span></label><input type="text" data-f="nombre" value="${esc(a.nombre)}" placeholder="Ej. Verano piscina · imagen · v1"><span class="hint">Así se llama en Ads Manager, en cada conjunto donde entre.</span></div>
      <div class="f s6"><label>Creativo<span class="req">*</span></label><select data-f="creativoId"><option value="">Elige…</option>${S.creativos.map((c,j) => `<option value="${c.id}" ${c.id===a.creativoId?"selected":""}>${esc(nombreCreativo(c,j))} · ${c.tipo==="VIDEO"?"video":c.tipo==="POST"?"publicación":"imagen"}</option>`).join("")}</select>
        ${(() => { const l = cr && (cr.local||{}).archivo; if (!l) return "";
            const src = l.preview || (l.data ? "data:" + (l.mime||"image/jpeg") + ";base64," + l.data : "");
            return `<div class="mini">${src ? `<img src="${src}" alt="">` : `<span class="arch-ico sm">${icono(l.video_id ? "video" : "imagen")}</span>`}<span class="hint">${esc(l.nombre)}</span></div>`; })()}</div>
      ${esPublicacion(a) ? publicacionAnuncioHTML(a) : `
      ${listaTextos(a, "textos", "Textos principales", "Hasta 5. Meta muestra el que mejor funcione con cada persona.", 125, 3)}
      ${listaTextos(a, "titulos", "Títulos", "Hasta 5.", 40, 1)}
      <div class="f s6"><label>Descripción</label><input type="text" data-f="descripcion" value="${esc(a.descripcion||"")}" maxlength="60" placeholder="Opcional · aparece bajo el título en algunas ubicaciones"><span class="count ${(a.descripcion||"").length>30?"over":""}">${(a.descripcion||"").length}/30</span></div>
      <div class="f s6"><label>Mejoras automáticas de Meta</label><select data-f="mejoras">${MEJORAS.map(m => `<option value="${m[0]}" ${m[0]===(a.mejoras||"META")?"selected":""}>${esc(m[1])}</option>`).join("")}</select><span class="hint">${esc((MEJORAS.find(m => m[0]===(a.mejoras||"META")) || MEJORAS[0])[2])} (Advantage+ creative).</span></div>`}
      ${esPublicacion(a) && ((creativoDe(a)||{}).post||{}).origen === "FACEBOOK" ? "" : botonHTML(a, dests)}
      ${dests.includes("FORMULARIO") ? formularioAnuncioHTML(a) : ""}
      ${dests.includes("WHATSAPP") ? `
      <div class="f s12 sub-h"><span>WhatsApp</span><small>Lo que ve la persona al abrir el chat</small></div>
      ${plantillaHTML(a)}
      ${a.secuencia ? `<div class="f s12"><div class="note">Este anuncio usa la secuencia de bienvenida <strong>${esc(a.secuencia)}</strong> de WhatsApp Business: el saludo y los mensajes los define la secuencia. <a href="#" data-sin-secuencia>Escribir un mensaje en su lugar</a></div></div>` : `
      <div class="f s6"><label>Saludo</label><input type="text" data-f="saludo" value="${esc(a.saludo||"")}" maxlength="300" placeholder="¡Hola! ¿Cómo podemos ayudarte?"><span class="hint">Mensaje que la empresa muestra al abrir. Vacío = el de Meta.</span></div>
      <div class="f s6"><label>Mensaje prellenado</label><input type="text" data-f="prellenado" value="${esc(a.prellenado||"")}" maxlength="300" placeholder="¡Hola, quiero contratar!" ${(a.preguntas||[]).filter(Boolean).length?"disabled":""}><span class="hint">${(a.preguntas||[]).filter(Boolean).length ? "No aplica: con preguntas frecuentes, Meta usa las preguntas." : "Texto que la persona ya tiene escrito para enviar."}</span></div>
      <div class="f s12"><label>Preguntas frecuentes</label>
        ${(a.preguntas||[]).map((q,j) => `<div class="texto-fila"><span class="idx">${j+1}</span><input type="text" data-preg="${j}" value="${esc(q)}" maxlength="80" placeholder="¿Qué paquetes tienen?"><button type="button" class="btn link" data-preg-rm="${j}" aria-label="Quitar">&times;</button></div>`).join("")}
        <div class="texto-acciones">${(a.preguntas||[]).length < 4 ? `<button type="button" class="btn ghost sm" data-preg-add>+ Pregunta frecuente</button>` : ""}<span class="hint">Opcional, hasta 4. Botones que la persona toca para iniciar la conversación; reemplazan al mensaje prellenado.</span></div></div>`}` : ""}
      <div class="f s12 sub-h"><span>Seguimiento</span><small>Qué eventos registra este anuncio</small></div>
      <div class="f s6"><label>Eventos del sitio web (píxel)</label><select data-f="trackPixel"><option value="">No registrar</option>${S.fuentes.filter(x=>x.tipo==="PIXEL").map(x => `<option value="${esc(x.id)}" ${x.id===a.trackPixel?"selected":""}>${esc(x.n)} · ${esc(x.id)}${x.dias!=null ? " · último evento hace " + x.dias + " d" : ""}</option>`).join("")}</select><span class="hint">Registra compras y otros eventos del sitio atribuidos al anuncio.</span></div>
      <div class="f s6"><label>Eventos offline (conjunto de datos)</label><select data-f="trackDataset"><option value="">No registrar</option>${S.fuentes.filter(x=>x.tipo==="OFFLINE").map(x => `<option value="${esc(x.id)}" ${x.id===a.trackDataset?"selected":""}>${esc(x.n)} · ${esc(x.id)}</option>`).join("")}</select><span class="hint">Ventas cargadas por CAPI u offline (por ejemplo, cierres desde el CRM).</span></div>
      <div class="f s12 prev-fila"><button type="button" class="btn ghost sm" data-prev>${PREV.id === a.id && !PREV.cargando ? "Actualizar vista previa" : "Ver cómo se verá en Meta"}</button>${PREV.id === a.id ? `<button type="button" class="btn link" data-prev-cerrar>Cerrar vista previa</button>` : ""}</div>
      ${previewHTML(a)}
      <div class="f s12"><label>Parámetros de URL (UTM)</label>
        <div class="utm-fila"><input type="text" data-f="urlTags" value="${esc(a.urlTags||"")}" placeholder="utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}">
        <button type="button" class="btn ghost sm" data-utm-std>Usar estándar</button></div>
        <span class="hint">Se agregan a la URL al hacer clic. Admite los parámetros dinámicos de Meta: {{campaign.name}}, {{adset.name}}, {{ad.name}}, {{placement}}.</span></div>
      <div class="f s12"><label>En qué conjuntos entra<span class="req">*</span></label>
        <div class="row-actions" style="margin-bottom:8px"><button class="btn ghost sm" data-atodos="${a.id}">Marcar todos</button><button class="btn ghost sm" data-aninguno="${a.id}">Desmarcar</button></div>
        ${grupos.length ? grupos.map(g => `<div class="conj-grupo"><div class="conj-camp mono">${esc(nombreCampana(g.c))}</div>
          ${g.ks.map(k => `<label class="conj ${a.conjuntoIds.includes(k.id)?"on":""}"><input type="checkbox" data-ak="${k.id}" ${a.conjuntoIds.includes(k.id)?"checked":""}><span class="conj-n">${esc(nombreConjunto(k))}</span><span class="conj-r">${k.modo==="EXISTENTE"?"existente":"nuevo"}${destinoConjunto(k)!=="WEBSITE" ? " · " + esc(nombreDestino(destinoConjunto(k))) : ""}</span></label>`).join("")}</div>`).join("")
          : `<div class="empty">No hay conjuntos activos. Vuelve al paso de conjuntos.</div>`}</div>
    </div></div></div>`;
}
function vAnuncios(){
  const n = instancias().length;
  return `
  <h1>Anuncios</h1>
  <p class="lede">Cada anuncio es un creativo con nombre propio, sus textos y los conjuntos donde entra. Un anuncio en tres conjuntos son tres anuncios en Meta. Con varios textos o títulos, Meta prueba las combinaciones y muestra la que mejor funcione.</p>
  ${formularioPanelHTML()}
  ${tablaHTML()}
  ${bloqueHTML()}
  <div class="panel"><header><div><h2>${S.anuncios.length} ${S.anuncios.length===1?"anuncio definido":"anuncios definidos"} · ${n} en Meta</h2><p>Se crean en pausa dentro de cada conjunto asignado</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="genUno" ${S.creativos.length?"":"disabled"}>Generar uno por creativo en todos los conjuntos</button><button class="btn sm" id="addAd">+ Anuncio</button></div></header>
    <div class="body">${S.anuncios.length ? S.anuncios.map(anuncioHTML).join("") : `<div class="empty">Todavía no hay anuncios. Genera uno por creativo o agrégalos a mano.</div>`}</div></div>`;
}
function aAnuncios(){
  ligarBloque(); ligarTabla(); ligarFormularioPanel();
  const todos = () => conjuntosActivos().map(k => k.id);
  $("#addAd").onclick = () => { const a = nuevoAnuncio(); a.conjuntoIds = todos(); if (S.creativos.length === 1) a.creativoId = S.creativos[0].id; S.anuncios.push(a); render(); };
  $("#genUno").onclick = () => {
    const ya = new Set(S.anuncios.map(a => a.creativoId));
    const base = S.anuncios[S.anuncios.length-1];
    S.creativos.forEach((c,i) => { if (ya.has(c.id)) return; const a = nuevoAnuncio(); a.creativoId = c.id; a.nombre = nombreCreativo(c,i); a.conjuntoIds = todos();
      if (base){ a.textos = base.textos.slice(); a.titulos = base.titulos.slice(); a.descripcion = base.descripcion; a.cta = base.cta; a.url = base.url; }
      S.anuncios.push(a); });
    render();
  };
  document.querySelectorAll("[data-a]").forEach(box => {
    const a = S.anuncios.find(x => x.id === box.dataset.a);
    ligarCampos(box, a, (f, el) => {
      if (f === "nombre") box.querySelector(".head strong").textContent = nombreAnuncio(a);
      if (f === "creativoId" || f === "mejoras") render();
      if (f === "descripcion"){ const cnt = el.parentElement.querySelector(".count"); if (cnt){ cnt.textContent = a.descripcion.length + "/30"; cnt.classList.toggle("over", a.descripcion.length > 30); } }
    });
    const rf = box.querySelector("[data-recargar-forms]"); if (rf) rf.onclick = async ev => { ev.preventDefault(); S.cargandoFormularios = true; render(); await cargarFormularios(true); render(); };
    const cf = box.querySelector("[data-crear-form]"); if (cf) cf.onclick = ev => { ev.preventDefault(); FORM.abierto = true; FORM.d = FORM.d || formNuevo(); FORM.hecho = ""; render(); window.scrollTo({top:0, behavior:"smooth"}); };
    const pv = box.querySelector("[data-prev]"); if (pv) pv.onclick = () => pedirPreview(a);
    const pc = box.querySelector("[data-prev-cerrar]"); if (pc) pc.onclick = () => { PREV.id = ""; render(); };
    const us = box.querySelector("[data-utm-std]"); if (us) us.onclick = () => { a.urlTags = UTM_ESTANDAR; render(); };
    const pl = box.querySelector("[data-plantilla]");
    if (pl) pl.onchange = () => {
      const id = pl.value;
      const t = (S.plantillasWA||[]).find(x => x.id === id)
        || (id.startsWith("plan:") ? (() => { const x = S.anuncios.find(y => "plan:" + y.id === id); return x ? { saludo:x.saludo, prellenado:x.prellenado, preguntas:(x.preguntas||[]).slice(), secuencia:"" } : null; })() : null);
      a.plantilla = id;
      if (t){ a.secuencia = t.secuencia || ""; a.saludo = t.saludo || ""; a.prellenado = t.prellenado || ""; a.preguntas = (t.preguntas||[]).slice(0,4); }
      render();
    };
    const ss = box.querySelector("[data-sin-secuencia]"); if (ss) ss.onclick = ev => { ev.preventDefault(); a.secuencia = ""; a.plantilla = ""; render(); };
    box.querySelectorAll("[data-preg]").forEach(el => el.oninput = () => { a.preguntas[+el.dataset.preg] = el.value; mensajes(); autoguardar(); });
    box.querySelectorAll("[data-preg-rm]").forEach(b => b.onclick = () => { a.preguntas.splice(+b.dataset.pregRm, 1); render(); });
    const pa = box.querySelector("[data-preg-add]"); if (pa) pa.onclick = () => { a.preguntas = (a.preguntas||[]).concat([""]); render(); };
    box.querySelectorAll("[data-lista]").forEach(l => {
      const campo = l.dataset.lista, lim = campo === "textos" ? 125 : 40;
      l.querySelectorAll("[data-tx]").forEach(el => el.oninput = () => {
        a[campo][+el.dataset.tx] = el.value;
        const cnt = el.parentElement.querySelector(".count"); cnt.textContent = el.value.length + "/" + lim; cnt.classList.toggle("over", el.value.length > lim);
        mensajes();
      });
      l.querySelectorAll("[data-tx-rm]").forEach(b => b.onclick = () => { a[campo].splice(+b.dataset.txRm, 1); render(); });
      const add = l.querySelector("[data-tx-add]"); if (add) add.onclick = () => { a[campo].push(""); render(); };
    });
    box.querySelectorAll("[data-ak]").forEach(cb => cb.onchange = () => { const id = cb.dataset.ak; a.conjuntoIds = cb.checked ? [...new Set([...a.conjuntoIds, id])] : a.conjuntoIds.filter(x => x !== id); render(); });
    box.querySelector("[data-atodos]").onclick = () => { a.conjuntoIds = todos(); render(); };
    box.querySelector("[data-aninguno]").onclick = () => { a.conjuntoIds = []; render(); };
    box.querySelector("[data-dela]").onclick = () => { S.anuncios = S.anuncios.filter(x => x.id !== a.id); render(); };
    box.querySelector("[data-dupa]").onclick = () => { const ac = JSON.parse(JSON.stringify(a)); ac.id = uid(); ac.nombre = (a.nombre||"") + " copia"; S.anuncios.push(ac); render(); };
  });
}

/* --------------------------------------------------------- 6 · revisión */
const LOTE = { cargando:false, objetos:null, error:"", trabajando:"", hecho:"" };
function pillEstado(e){
  const x = String(e || "").toUpperCase();
  const t = { ACTIVE:"Activo", PAUSED:"En pausa", CAMPAIGN_PAUSED:"Campaña en pausa", ADSET_PAUSED:"Conjunto en pausa", IN_PROCESS:"En proceso", WITH_ISSUES:"Con problemas", PENDING_REVIEW:"En revisión", DISAPPROVED:"Rechazado" }[x] || x.toLowerCase().replace(/_/g, " ");
  const c = x === "ACTIVE" ? "ok" : /DISAPPROVED|WITH_ISSUES/.test(x) ? "stop" : /REVIEW|PROCESS/.test(x) ? "warn" : "dim";
  return `<span class="pill ${c}">${esc(t)}</span>`;
}
function loteHTML(){
  if (!S.loteId || !S.loteEnviado) return "";
  const o = LOTE.objetos, tot = o ? o.campanas.length + o.conjuntos.length + o.anuncios.length : 0;
  const cl = cliente();
  const enlace = c => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${esc(cl ? cl.cuenta : "")}&selected_campaign_ids=${esc(c.id)}`;
  return `<div class="panel" style="margin-top:18px"><header><div><h2>Lo publicado por este plan</h2><p>Todo lo creado lleva la etiqueta del lote; desde aquí se activa, pausa o elimina sin tocar nada más de la cuenta.</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="loteVer" ${LOTE.cargando?"disabled":""}>${LOTE.cargando ? `<span class="spinner"></span> Buscando…` : (o ? "Actualizar" : "Ver lo creado")}</button>
      ${o && o.campanas.length ? `<button class="btn ghost sm" id="loteRes" ${LOTE.cargandoRes?"disabled":""}>${LOTE.cargandoRes ? `<span class="spinner"></span> Consultando…` : icono("grafica") + " Resultados"}</button>` : ""}</div></header>
    ${o || LOTE.error ? `<div class="body">
      ${LOTE.error ? `<div class="note stop">${esc(LOTE.error)}</div>` : ""}
      ${o ? (tot ? `<p><strong>${o.campanas.length}</strong> campañas · <strong>${o.conjuntos.length}</strong> conjuntos · <strong>${o.anuncios.length}</strong> anuncios</p>
        <table class="tabla-mini"><thead><tr><th>Tipo</th><th>Nombre</th><th>Estado</th></tr></thead><tbody>
          ${o.campanas.map(c => `<tr><td>Campaña</td><td><a href="${enlace(c)}" target="_blank" rel="noopener">${esc(c.name)}</a></td><td>${pillEstado(c.estado)}</td></tr>`).join("")}
          ${o.conjuntos.map(c => `<tr><td>Conjunto</td><td>${esc(c.name)}</td><td>${pillEstado(c.estado)}</td></tr>`).join("")}
        </tbody></table>
        ${o.anuncios.length ? `<details class="det"><summary>${o.anuncios.length} anuncios</summary><table class="tabla-mini"><tbody>${o.anuncios.map(c => `<tr><td>${esc(c.name)}</td><td>${pillEstado(c.estado)}</td></tr>`).join("")}</tbody></table></details>` : ""}
        ${resultadosLoteHTML()}
        <div class="imp-acciones" style="margin-top:12px">
          <button class="btn go" data-lote="ACTIVE" ${LOTE.trabajando?"disabled":""}>Activar todo</button>
          <button class="btn ghost" data-lote="PAUSED" ${LOTE.trabajando?"disabled":""}>Pausar todo</button>
          <button class="btn ghost danger" data-lote="DELETED" ${LOTE.trabajando?"disabled":""}>Eliminar todo</button>
          ${LOTE.trabajando ? `<span class="hint"><span class="spinner"></span> ${esc(LOTE.trabajando)}</span>` : ""}${LOTE.hecho ? `<span class="hint">${esc(LOTE.hecho)}</span>` : ""}
        </div>` : `<div class="empty">No encontré objetos de este plan en la cuenta.</div>`) : ""}
    </div>` : ""}</div>`;
}
function idsPlanExistentes(){
  return { campanas_existentes: S.campanas.filter(c => c.modo === "EXISTENTE").map(c => c.metaId),
           conjuntos_existentes: S.conjuntos.filter(k => k.modo === "EXISTENTE" && k.sel).map(k => k.metaId) };
}
async function cargarLote(){
  LOTE.cargando = true; LOTE.error = ""; render();
  try {
    const f = generarFilas();
    const r = await llamar("buscar", Object.assign({ tipo:"lote", lote_id:S.loteId, campanas:f.campaigns.map(c => c.name) }, idsPlanExistentes(), ctx()));
    LOTE.objetos = r.objetos; if (r.sinEtiqueta) LOTE.error = "Meta no tiene la etiqueta de este lote: el envío no quedó etiquetado o no creó nada.";
  } catch(e){ LOTE.error = e.message; }
  LOTE.cargando = false; render();
}
function ligarLote(){
  const v = $("#loteVer"); if (v) v.onclick = () => cargarLote();
  const lr = $("#loteRes"); if (lr) lr.onclick = () => cargarResultadosLote();
  document.querySelectorAll("[data-lote]").forEach(b => b.onclick = async () => {
    const acc = b.dataset.lote, o = LOTE.objetos; if (!o) return;
    const inv = o.campanas.reduce((t, c) => t + (Number(c.diario)||0), 0);
    const texto = acc === "ACTIVE" ? "Vas a ACTIVAR " + o.campanas.length + " campañas, " + o.conjuntos.length + " conjuntos y " + o.anuncios.length + " anuncios. Empezarán a gastar" + (inv ? " (al menos " + inv.toLocaleString("es-MX") + " " + (cliente()||{}).moneda + " diarios en presupuestos de campaña)" : "") + ". ¿Continuar?"
      : acc === "DELETED" ? "Vas a ELIMINAR todo lo creado por este plan (" + (o.campanas.length + o.conjuntos.length + o.anuncios.length) + " objetos). No se puede deshacer. ¿Continuar?"
      : "Vas a pausar todo lo creado por este plan. ¿Continuar?";
    if (!window.confirm(texto)) return;
    LOTE.trabajando = acc === "ACTIVE" ? "Activando…" : acc === "DELETED" ? "Eliminando…" : "Pausando…"; LOTE.hecho = ""; render();
    try {
      const r = await llamar("buscar", Object.assign({ tipo:"lote_accion", lote_id:S.loteId, accion:acc,
        ids:{ campanas:o.campanas.map(x => x.id), conjuntos:o.conjuntos.map(x => x.id), anuncios:o.anuncios.map(x => x.id) } }, ctx()));
      LOTE.hecho = r.ok + " objetos actualizados" + (r.fallos.length ? " · " + r.fallos.length + " fallaron: " + r.fallos.slice(0,3).join("; ") : "") + (r.omitidos ? " · " + r.omitidos + " omitidos por no llevar la etiqueta del lote" : "") + ".";
    } catch(e){ LOTE.hecho = "Error: " + e.message; }
    LOTE.trabajando = ""; await cargarLote();
  });
}
function vRevision(){
  const inst = instancias(), f = generarFilas(), errs = problemas(5), todas = alertas();
  const opciones = conjuntosAgrupados().map(g => `<optgroup label="${esc(nombreCampana(g.c))}">${g.ks.map(k => `<option value="${k.id}">${esc(nombreConjunto(k))}${k.modo==="EXISTENTE"?" (existente)":""}</option>`).join("")}</optgroup>`).join("");
  if (S.enviado || S.enviando || S.falloEnvio) return resultadoHTML();
  return `
  <h1>Revisar y enviar</h1>
  <p class="lede">El plan completo tal como va a Meta. Mueve anuncios entre conjuntos o campañas desde aquí; todo se crea en pausa.</p>
  <div class="panel"><header><div><h2>${f.campaigns.length} ${f.campaigns.length===1?"campaña nueva":"campañas nuevas"} · ${S.campanas.filter(c=>c.modo==="EXISTENTE").length} existentes · ${f.adsets.length} conjuntos nuevos · ${inst.length} anuncios</h2><p>${esc((cliente()||{}).nombre||"")} · ${esc((S.paginas.find(p=>p.id===S.pageId)||{n:S.pageId}).n)}</p></div>
    <div class="row-actions"><button class="btn go" id="enviar" ${inst.length && !errs.length?"":"disabled"}>${(S.replicas||[]).length ? "Enviar a " + (1 + S.replicas.length) + " cuentas" : "Enviar a Meta"}</button></div></header>
    <div class="body">
    ${replicasHTML()}
    ${!errs.length ? prevalHTML() : ""}
    ${todas.length ? `<div class="al-caja" style="margin-bottom:16px">${alertasHTML(todas, { max: 6 })}</div>` : ""}
    ${S.campanas.map(c => {
      const ks = conjuntosDe(c).filter(k => k.modo === "NUEVO" || k.sel);
      return `<div class="arbol-camp">
        <div class="arbol-h"><span class="arbol-t">${c.modo==="EXISTENTE"?"◆":"◇"} ${esc(nombreCampana(c))}</span><span class="mono arbol-m">${c.modo==="EXISTENTE" ? "existente" : esc((OBJETIVOS.find(o=>o.v===c.objetivo)||{t:""}).t) + " · " + (c.presupuestoEn==="CAMPAIGN" ? c.monto + " " + (c.tipoMonto==="DAILY"?"/día":"total") : "ABO") + " · desde " + esc(c.inicio) + entregaCorta(c)}</span></div>
        ${ks.length ? ks.map(k => {
          const mios = inst.filter(x => x.k.id === k.id);
          return `<div class="arbol-k"><div class="arbol-h"><span class="arbol-t">${icono(ICONO_DESTINO[destinoConjunto(k)] || "web", "xs")} ${esc(nombreConjunto(k))}${k.modo==="EXISTENTE" ? ' <span class="pill dim">existente</span>' : ""}</span><span class="mono arbol-m">${k.modo==="EXISTENTE" ? "existente" : esc(resumenSegmentacion(k)) + (llevaPresupuestoConjunto(c) ? " · " + esc(k.presupuesto) + "/día" : "")}</span></div>
            ${mios.length ? mios.map(x => { const cr = creativoDe(x.a); const j = S.creativos.indexOf(cr); return `<div class="arbol-a" data-inst="${x.a.id}|${k.id}">
              <span class="arbol-t">· ${esc(nombreAnuncio(x.a))}</span><span class="mono arbol-m">${cr ? esc(nombreCreativo(cr,j)) + " · " + (cr.tipo==="VIDEO"?"video":cr.tipo==="POST"?"publicación existente":"imagen") : "sin creativo"}${cr && cr.tipo==="POST" ? "" : " · " + limpios(x.a.textos).length + "×" + limpios(x.a.titulos).length + " textos"}${destinoConjunto(k) === "FORMULARIO" ? " · formulario " + esc((formularioPorId(x.a.formId)||{n:x.a.formId||"—"}).n) : destinoConjunto(k) === "WHATSAPP" ? " · WhatsApp" : ""}</span>
              <select data-mover aria-label="Mover a"><option value="">Mover a…</option>${opciones}</select><button class="btn link" data-quitar-inst>Quitar</button></div>`; }).join("")
            : `<div class="arbol-a vacio">sin anuncios</div>`}</div>`; }).join("") : `<div class="arbol-k vacio">sin conjuntos activos</div>`}
      </div>`; }).join("")}
    </div></div>
  <details class="panel tecnico"><summary><div><h2>Datos técnicos del envío</h2><p>Lo mismo que arriba, tal como lo recibe el motor. Solo para soporte.</p></div></summary>
    ${""}<div class="body">${tabla("Campañas nuevas", f.campaigns, ["name","objective","budget_level","daily_budget","lifetime_budget","start_time"])}${tabla("Conjuntos nuevos", f.adsets, ["name","campaign_key","optimization_goal","daily_budget","countries","city_keys","age_min","age_max"])}${tabla("Anuncios", f.ads, ["name","adset_key","creative_type","primary_texts","headlines","cta_type","link_url"])}</div></details>
  ${loteHTML()}`;
}
function tabla(t, filas, cols){
  if (!filas.length) return "";
  return `<h3 style="margin:12px 0 6px">${esc(t)} · ${filas.length}</h3><div class="scroll"><table class="rows"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${filas.map(r => `<tr>${cols.map(c => `<td class="${/key|id/.test(c)?"k":""}">${esc(r[c]==null?"":r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function progresoHTML(){
  const pct = S.avance && S.avance.de ? Math.round(100 * S.avance.n / S.avance.de) : 0;
  return `<span class="spinner"></span> ${S.segundos} s · ${esc(S.progreso || "Validando el plan…")}`
    + (S.avance ? `<span class="barra" style="display:block;margin-top:10px;max-width:420px"><i style="width:${pct}%"></i></span>` : "");
}
function recuperacionWAHTML(){
  if (!/2490408|objetivo Interacción/.test(S.falloEnvio + " " + ((S.resultado||{}).fallos||[]).join(" "))) return "";

        const ventas = S.campanas.some(c => c.modo === "NUEVA" && c.destino === "WHATSAPP" && c.objetivo === "OUTCOME_SALES" && c.meta === "MESSAGING_PURCHASE_CONVERSION" && !c.cfgWA);
        const probada = (S.configsWA||[]).find(x => x.compras);
        if (ventas) return `<p><button class="btn" id="corregirWA">Cambiar a Interacción y volver a la revisión</button></p>`;
        if (probada){
          const usada = (S.campanas.find(c => c.cfgWA) || {}).cfgWA;
          const lista = (S.configsWA||[]).slice().sort((a,b) => (b.puntaje||0)-(a.puntaje||0));
          return `<div class="note">${usada ? "El envío usó la referencia <strong>" + esc(usada.n) + "</strong> y Meta lo rechazó. Elige otra referencia: la herramienta la clona con la copia nativa de Meta." : "Meta rechazó la combinación que arma la herramienta. Elige un conjunto de WhatsApp de la cuenta que ya funcione: la herramienta lo clona con la copia nativa de Meta."}</div>
            <div class="utm-fila" style="max-width:720px"><select id="errRef">${lista.map(y => `<option value="${esc(y.id)}" ${usada && usada.id===y.id ? "" : ""}>${esc(y.n)} · ${esc(y.r)}${usada && usada.id===y.id ? " · (ya se probó)" : ""}</option>`).join("")}</select>
            <button class="btn" id="errRefUsar">Usar esta referencia y volver a la revisión</button></div>
            <p class="hint">¿El que funciona no está en la lista (otra cuenta)? Pega su ID o enlace:</p>
            <div class="utm-fila" style="max-width:720px"><input type="text" id="errCfgId" placeholder="ID del conjunto o enlace de Ads Manager" value="${esc(CFGID.valor)}"><button class="btn ghost" id="errCfgLeer" ${CFGID.cargando?"disabled":""}>${CFGID.cargando ? "Leyendo…" : "Usar ese conjunto"}</button></div>
            ${CFGID.error ? `<p class="hint warn-t">${esc(CFGID.error)}</p>` : ""}
            ${diagnosticoHTML()}`;
        }
        return `<div class="note">Meta no acepta la combinación que arma la herramienta en esta cuenta. Pega el ID (o el enlace de Ads Manager) de un conjunto de WhatsApp con "Maximizar compras por mensajes" que ya funcione, en cualquier cuenta: la herramienta copiará su configuración exacta.</div>
          <div class="utm-fila" style="max-width:640px"><input type="text" id="errCfgId" placeholder="ID del conjunto o enlace de Ads Manager" value="${esc(CFGID.valor)}"><button class="btn" id="errCfgLeer" ${CFGID.cargando?"disabled":""}>${CFGID.cargando ? "Leyendo…" : "Usar esa configuración"}</button></div>
          ${CFGID.error ? `<p class="hint warn-t">${esc(CFGID.error)}</p>` : ""}`;
}
function resultadoHTML(){
  const r = S.resultado, cl = cliente();
  if (S.enviando) return `<div class="res-pantalla"><span class="estado-chip run"><span class="spinner"></span> Publicando</span><h1>Publicando en Meta</h1>
    <p class="lede" id="progresoTxt">${progresoHTML()}</p><div id="fasesBox">${fasesHTML()}</div><div id="corridasBox">${corridasHTML()}</div>
    <p class="hint">Puedes dejar esta pestaña abierta: el motor publica por tramos y deja el avance en la hoja. Si cierras la página, la publicación sigue en n8n.</p></div>`;
  const sinEnvio = r && r.estado === "SIN_ENVIO";
  const nadaCreado = /no quedó nada creado/i.test(S.falloEnvio) || (r && (r.estado === "RECHAZADO" || sinEnvio));
  const ads = cl ? "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=" + encodeURIComponent(cl.cuenta) : "";
  const acciones = `<div class="res-acciones">
      ${ads && !nadaCreado ? `<a class="btn ghost" href="${ads}" target="_blank" rel="noopener">Abrir Ads Manager</a>` : ""}
      ${CFG.hojaUrl ? `<a class="btn ghost" href="${esc(CFG.hojaUrl)}" target="_blank" rel="noopener">${icono("hoja")} Bitácora</a>` : ""}
      ${S.falloEnvio ? `<button class="btn" id="volver">Volver a la revisión</button>` : `<button class="btn" id="otro">Empezar otro plan</button>`}</div>`;
  if (S.falloEnvio){
    const chip = sinEnvio ? ["stop","No llegó al motor"] : r && r.estado === "RECHAZADO" ? ["stop","Rechazado por el validador"] : r && r.estado === "PARCIAL" ? ["warn","Publicado en parte"] : r && r.estado === "DETENIDO" ? ["warn","Detenido"] : ["stop","No se publicó"];
    const lista = alertasDeResultado(r);
    return `<div class="res-pantalla"><span class="estado-chip ${chip[0]}">${icono(chip[0] === "stop" ? "stop" : "alerta")} ${chip[1]}</span>
      <h1>${r && r.estado === "PARCIAL" ? "Se publicó una parte" : "No se pudo publicar"}</h1>
      <p class="lede">${esc(S.falloEnvio)}</p>
      ${r && r.estado !== "RECHAZADO" && !sinEnvio ? kpisResultadoHTML(r) : ""}
      ${sinEnvio ? `<div class="note go">La llamada no llegó al motor, así que no se creó nada en Meta. Resuelve lo de arriba y vuelve a enviar: no hay riesgo de duplicar.</div>
        <div class="res-acciones"><button class="btn go" id="reintentarEnvio">Reintentar el envío</button><button class="btn ghost" id="recargarPagina">Recargar la página</button></div>`
      : nadaCreado ? `<div class="note go">No quedó nada creado en Meta: corrige lo indicado y vuelve a enviar sin riesgo de duplicar.</div>`
        : `<div class="note">Puedes corregir y reenviar este mismo plan: lo que ya se creó se reutiliza y no se duplica (lleva la etiqueta del lote). Lo que quedó vacío ya se eliminó.</div>`}
      ${lista.length ? `<div class="al-caja">${alertasHTML(lista, { sinSaltos:true })}</div>` : ""}
      ${recuperacionWAHTML()}
      ${corridasHTML()}
      ${acciones}
      ${nadaCreado ? "" : loteHTML()}</div>`;
  }
  const lista = alertasDeResultado(r);
  return `<div class="res-pantalla"><span class="estado-chip ok">${icono("ok")} ${r && r.estado === "OK_CON_AVISOS" ? "Publicado con avisos" : "Publicado"}</span>
    <h1>Listo</h1><p class="lede">${esc(S.enviado)} Revisa en Ads Manager y activa cuando corresponda.</p>
    ${kpisResultadoHTML(r)}
    ${lista.length ? `<div class="al-caja">${alertasHTML(lista, { sinSaltos:true })}</div>` : ""}
    ${corridasHTML()}
    ${acciones}
    ${loteHTML()}</div>`;
}
function aRevision(){
  ligarLote();
  const pv = $("#prevalidar"); if (pv) pv.onclick = prevalidar;
  ligarReplicas();
  const v = $("#volver"); if (v) v.onclick = () => { S.falloEnvio = ""; S.resultado = null; render(); };
  const re = $("#reintentarEnvio"); if (re) re.onclick = () => { S.falloEnvio = ""; S.resultado = null; enviar(); };
  const rp = $("#recargarPagina"); if (rp) rp.onclick = () => { autoguardarYa(); location.reload(); };
  const cw = $("#corregirWA"); if (cw) cw.onclick = () => { corregirObjetivosWhatsApp(); S.falloEnvio = ""; S.resultado = null; render(); };
  const eci = $("#errCfgId"); if (eci) eci.oninput = () => { CFGID.valor = eci.value; };
  const ecl = $("#errCfgLeer"); if (ecl) ecl.onclick = async () => {
    if (!CFGID.valor.trim()) return;
    const destino = S.campanas.filter(c => c.modo === "NUEVA" && !c.importada && c.destino === "WHATSAPP");
    await leerConfigPorId(destino);
    if (!CFGID.error || /Se aplicó igual/.test(CFGID.error)){ S.falloEnvio = ""; S.resultado = null; render(); }
  };
  const dc = $("#diagCorrer"); if (dc) dc.onclick = async () => {
    const sel = $("#errRef"); const ref = CFGID.valor.trim() || (sel ? sel.value : "");
    if (!ref){ DIAG.error = "Elige una referencia o pega su ID."; render(); return; }
    correrDiagnostico(ref, S.campanas.find(c => c.modo === "NUEVA" && c.destino === "WHATSAPP"));
  };
  const dcp = $("#diagCopiar"); if (dcp) dcp.onclick = async () => {
    const t = textoDiagnostico(); let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch(e){}
    const h = $("#diagCopiado"); if (h) h.textContent = ok ? "Copiado. Pégalo en el chat." : "No pude copiar: selecciona el texto de arriba y cópialo.";
  };
  const er = $("#errRef"); const eru = $("#errRefUsar");
  if (er && eru){
    // por defecto, la mejor referencia que todavía no se probó
    const usada = (S.campanas.find(c => c.cfgWA) || {}).cfgWA;
    const alt = [...er.options].find(o => !usada || o.value !== usada.id); if (alt) er.value = alt.value;
    eru.onclick = () => {
      const x = (S.configsWA||[]).find(y => y.id === er.value); if (!x) return;
      S.campanas.filter(c => c.modo === "NUEVA" && !c.importada && c.destino === "WHATSAPP").forEach(c => aplicarConfig(c, x));
      S.falloEnvio = ""; S.resultado = null; render();
    };
  }
  const up = $("#usarProbada"); if (up) up.onclick = async () => { if (!(S.configsWA||[]).length) await cargarWhatsapps(); sugerirConfigs(); S.falloEnvio = ""; S.resultado = null; render(); };
  const o = $("#otro"); if (o) o.onclick = () => { S.enviado = ""; S.resultado = null; S.campanas = []; S.conjuntos = []; S.creativos = []; S.anuncios = []; S.loteId = ""; S.loteEnviado = false; S.replicas = []; S.corridas = []; LOTE.objetos = null; LOTE.hecho = ""; S.paso = 1; render(); };
  document.querySelectorAll("[data-inst]").forEach(row => {
    const [aid, kid] = row.dataset.inst.split("|"), a = S.anuncios.find(x => x.id === aid);
    row.querySelector("[data-mover]").onchange = e => { const dest = e.target.value; if (!dest || dest === kid) return; a.conjuntoIds = [...new Set(a.conjuntoIds.filter(x => x !== kid).concat([dest]))]; render(); };
    row.querySelector("[data-quitar-inst]").onclick = () => { a.conjuntoIds = a.conjuntoIds.filter(x => x !== kid); render(); };
  });
  const env = $("#enviar"); if (env) env.onclick = enviar;
}
/* Estados del motor 5.0: EN_PROCESO (con avance), NO_ENCONTRADO (la fila aún no
   aparece), RECHAZADO (validación), DETENIDO (sin avance en 12 min) y los finales. */
async function sondear(runId, alTic){
  const TOPE_MS = 1920000; let espera = 3000, transcurrido = 0, i = 0, sinFila = 0;
  while (transcurrido < TOPE_MS){
    await new Promise(s => setTimeout(s, espera)); transcurrido += espera; i++;
    if (i === 5) espera = 5000; if (i === 20) espera = 10000;
    let e = null;
    try { e = await llamar("estado", {run_id: runId}); } catch(err){ e = null; }
    if (alTic) alTic(Math.round(transcurrido/1000), e && e.estado === "EN_PROCESO" ? e : null);
    if (!e || !e.estado || e.estado === "EN_PROCESO") continue;
    if (e.estado === "NO_ENCONTRADO"){
      if (++sinFila >= 24) return {estado:"DESCONOCIDO", mensaje:"La corrida no aparece en la hoja después de varios minutos. Revisa la ejecución en n8n y que la hoja tenga la pestaña runs."};
      continue;
    }
    return e;
  }
  return {estado:"DESCONOCIDO", mensaje:"No obtuve respuesta en 32 minutos. Revisa la bitácora; si reenvías el plan, lo que ya se creó se reutiliza y no se duplica."};
}
/* Envío: la cuenta principal y, si hay, cada réplica en su propia corrida. Todas se
   inician al instante (el motor responde con un run_id) y se siguen en paralelo. */
async function enviar(){
  const cl = cliente(), existentes = S.campanas.filter(c => c.modo === "EXISTENTE");
  const lote = (S.loteEnviado = true, asegurarLote());
  const nuevas = S.campanas.filter(c => c.modo === "NUEVA").map(nombreCampana).join(" + ");
  const destinos = [{ principal:true, cuenta:cl.cuenta, nombre:cl.nombre, key:cl.key, pageId:S.pageId, filas:generarFilas(),
      campaign_id: existentes[0] ? existentes[0].metaId : "", campana: S.campanas.map(nombreCampana).join(" + ") }]
    .concat((S.replicas || []).map(r => { const d = cuentaPorId(r.cuenta) || { nombre:r.cuenta, key:"" };
      return { principal:false, cuenta:r.cuenta, nombre:d.nombre, key:d.key, pageId:r.pageId || S.pageId, filas:generarFilasReplica(r), campaign_id:"", campana:nuevas, replica_de:cl.cuenta }; }));
  S.corridas = destinos.map(d => ({ cuenta:d.cuenta, nombre:d.nombre, principal:d.principal, run_id:"", resultado:null, fin:false, error:"" }));
  S.enviando = true; S.segundos = 0; S.falloEnvio = ""; S.enviado = ""; S.progreso = ""; S.avance = null; S.fase = "validacion"; render();
  const refrescar = () => {
    const p = $("#progresoTxt"); if (p) p.innerHTML = progresoHTML();
    const fb = $("#fasesBox"); if (fb) fb.innerHTML = fasesHTML();
    const cb = $("#corridasBox"); if (cb) cb.innerHTML = corridasHTML();
  };
  for (let i = 0; i < destinos.length; i++){
    const d = destinos[i], c = S.corridas[i];
    try {
      const r = await llamar("publicar", { client_key:d.key, cuenta_id:d.cuenta, page_id:d.pageId, lote_id:lote, campaign_id:d.campaign_id, campana:d.campana,
        replica_de: d.replica_de || "", filas:d.filas });
      if (r.estado === "RECHAZADO"){ c.resultado = r; c.fin = true; } else c.run_id = r.run_id;
    } catch(e){ c.error = e.message; c.sinEnvio = !!e.conexion && ![502,503,504].includes(e.status); c.fin = true; }
    refrescar();
  }
  S.runId = S.corridas[0].run_id;
  await Promise.all(S.corridas.filter(c => c.run_id).map(c => sondear(c.run_id, (seg, e) => {
    if (c.principal){ S.segundos = seg; if (e){ S.progreso = e.mensaje || ""; S.fase = e.fase || S.fase; S.avance = e.previstos ? { n:e.anuncios||0, de:e.previstos } : null; } }
    if (e) c.resultado = Object.assign({}, c.resultado || {}, e);
    refrescar();
  }).then(fin => { c.resultado = fin; c.fin = true; refrescar(); })));
  const main = S.corridas[0], fin = main.resultado || (main.sinEnvio ? { estado:"SIN_ENVIO", fallos:[], avisos:[] } : {});
  S.resultado = fin;
  const ok = x => x.resultado && (x.resultado.estado === "OK" || x.resultado.estado === "OK_CON_AVISOS");
  const replicas = S.corridas.slice(1), replOk = replicas.filter(ok).length;
  if (ok(main)){
    S.enviado = (fin.mensaje || "Publicado.") + (replicas.length ? " Réplicas: " + replOk + " de " + replicas.length + " publicadas sin errores." : "");
    borrarAutoguardado(); LOTE.objetos = null; LOTE.resultados = null;
    toast("Publicación terminada: " + (fin.anuncios || 0) + " anuncios en pausa" + (replicas.length ? " en la cuenta principal" : "") + ".", replOk === replicas.length ? "ok" : "warn");
  } else {
    S.falloEnvio = main.error || fin.mensaje || ("La corrida terminó en estado " + (fin.estado || "desconocido") + ".");
    toast("La publicación no terminó bien: revisa el detalle.", "stop");
  }
  S.enviando = false; render();
}

/* ------------------------------------------------------------- borradores */
$("#btnGuardar").onclick = () => {
  const blob = new Blob([JSON.stringify(serializarBorrador(), null, 1)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "meta-bulk_" + slug((cliente()||{}).nombre||"plan") + "_" + hoy() + ".json"; a.click();
};
$("#btnCargar").onclick = () => $("#fileBorrador").click();
$("#fileBorrador").onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try { await restaurar(JSON.parse(await file.text())); }
  catch(err){ alert(err.message); }
  e.target.value = "";
};
$("#btnHoja").onclick = () => { if (CFG.hojaUrl) window.open(CFG.hojaUrl, "_blank", "noopener"); else toast("No hay hoja configurada en config.js.", "warn"); };
document.querySelectorAll(".ico-slot").forEach(x => { x.innerHTML = icono(x.dataset.ico); });
$("#btnAlertas").onclick = () => abrirModal("alertas");
$("#btnHistorial").onclick = () => { abrirModal("historial"); cargarHistorial(); };
$("#btnChequeo").onclick = () => { abrirModal("chequeo"); if (!CHEQ.pasos || CHEQ.cuenta !== S.clienteKey) cargarChequeo(); };
$("#btnLeads").onclick = async () => { abrirModal("formularios"); if (S.pageId && !S.formularios.length){ await cargarFormularios(true); pintarModal(); } };
$("#modeTag").textContent = CONECTADO ? CFG.entorno : "modo demostración";

/* --------------------------------------------------------------- navegación */
function salirGestor(){
  if (nCambiosG() && !confirm("Hay " + nCambiosG() + " cambios sin aplicar en el gestor. Se conservan si vuelves. ¿Ir a crear campañas?")) return;
  S.modo = "crear"; S.paso = 0; $("#next").textContent = "Continuar"; render();
}
$("#next").onclick = async () => {
  if (S.modo === "gestor"){ abrirModal("gestor"); return; }
  if (S.paso >= 5) return;
  S.verTodos = false; S.paso++; render();
  if (S.paso === 2){ await cargarConjuntosExistentes(); render(); }
};
$("#back").onclick = () => { if (S.modo === "gestor"){ salirGestor(); return; } if (S.paso > 0){ S.paso--; S.verTodos = false; render(); } };
document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !$("#next").disabled && S.paso < 5) $("#next").click(); });
arrancar();
