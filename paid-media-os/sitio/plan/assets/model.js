/* =====================================================================
   Meta Bulk Editor · modelo — sitio 5.5
   Sin DOM. Estado, catálogos, validación y filas de salida.
   app.js pinta; este archivo decide.
   ===================================================================== */

/* ------------------------------------------------------------ catálogos */
const OBJETIVOS = [
  {v:"OUTCOME_SALES", t:"Ventas", d:"Compras o registros en el sitio",
   metas:[["OFFSITE_CONVERSIONS","Conversiones"],["VALUE","Valor de compra"],["LANDING_PAGE_VIEWS","Vistas de página"],["LINK_CLICKS","Clics"]]},
  {v:"OUTCOME_LEADS", t:"Clientes potenciales", d:"Registros en el sitio",
   metas:[["OFFSITE_CONVERSIONS","Conversiones"],["LANDING_PAGE_VIEWS","Vistas de página"],["LINK_CLICKS","Clics"]]},
  {v:"OUTCOME_TRAFFIC", t:"Tráfico", d:"Visitas al sitio",
   metas:[["LANDING_PAGE_VIEWS","Vistas de página"],["LINK_CLICKS","Clics"],["REACH","Alcance"],["IMPRESSIONS","Impresiones"]]},
  {v:"OUTCOME_ENGAGEMENT", t:"Interacción", d:"Reacciones, comentarios, reproducciones",
   metas:[["POST_ENGAGEMENT","Interacción"],["THRUPLAY","Reproducciones (solo video)"]]},
  {v:"OUTCOME_AWARENESS", t:"Reconocimiento", d:"Alcance e impresiones",
   metas:[["REACH","Alcance"],["IMPRESSIONS","Impresiones"],["THRUPLAY","Reproducciones (solo video)"]]},
];
const EVENTOS = [["PURCHASE","Compra"],["LEAD","Lead"],["COMPLETE_REGISTRATION","Registro"],["ADD_TO_CART","Agregar al carrito"],["CONTACT","Contacto"]];
const CATEGORIAS = [{v:"NONE",t:"Ninguna"},{v:"CREDIT",t:"Crédito"},{v:"EMPLOYMENT",t:"Empleo"},{v:"HOUSING",t:"Vivienda"},{v:"ISSUES_ELECTIONS_POLITICS",t:"Temas sociales o políticos"}];
const CTAS = [["LEARN_MORE","Más información"],["SHOP_NOW","Comprar"],["SIGN_UP","Registrarse"],["GET_QUOTE","Cotizar"],
  ["CONTACT_US","Contactar"],["APPLY_NOW","Solicitar"],["WATCH_MORE","Ver más"],["DOWNLOAD","Descargar"],["BOOK_TRAVEL","Reservar"],["SUBSCRIBE","Suscribirse"]];
/* Botones que Meta admite con formulario instantáneo. */
const CTAS_FORM = ["SIGN_UP","LEARN_MORE","APPLY_NOW","GET_QUOTE","SUBSCRIBE","DOWNLOAD","BOOK_TRAVEL","CONTACT_US"];
const ETAPAS = ["Awareness","Consideración","Conversión","Retargeting"];
/* Ubicaciones (5.3). Meta recomienda Advantage+ (automáticas): reparte en todas sus apps. */
const UBICACIONES = [["FBIG","Facebook e Instagram","Todas sus ubicaciones: feed, Stories, Reels, Explorar, etc."],
  ["AUTO","Advantage+ (Meta decide)","Recomendado por Meta: incluye Audience Network, Messenger y Threads"],
  ["FB","Solo Facebook",""],["IG","Solo Instagram",""]];
const MEJORAS = [["META","Las que Meta aplica por defecto","Meta puede ajustar brillo, recortar para cada ubicación, animar la imagen, mostrar comentarios y variar el texto"],
  ["OFF","Apagadas","El anuncio sale tal cual lo diseñaste"]];
const PASOS = [{t:"Cuenta"},{t:"Campañas"},{t:"Conjuntos"},{t:"Creativos"},{t:"Anuncios"},{t:"Revisar y enviar"}];
/* Límite conservador: el envío pasa por el proxy de Netlify antes de llegar a n8n. */
const LIMITE_ENVIO_MB = 5;
const SITIO_VERSION_ESPERADA = "5.6.0";
const RATIO_ESPERADO = { archivo:[1, 0.8], archivoStories:[0.5625], archivoColumna:[1.91] };

/* --------------------------------------------------------------- estado */
const S = {
  cuentas:[], clienteKey:"", paginas:[], pageId:"", falloPaginas:"", cargandoPaginas:false,
  pais:{cc:"", n:""},
  campanas:[], conjuntos:[], creativos:[], anuncios:[], loteId:"",
  whatsapps:[], cargandoWhatsapps:false, fuentes:[], plantillasWA:[], configsWA:[],
  formularios:[], cargandoFormularios:false, falloFormularios:"",
  paso:0, cargando:true, fallo:"", verTodos:false,
  enviando:false, enviado:"", falloEnvio:"", runId:"", segundos:0, resultado:null, progreso:"",
  modo:"crear", replicas:[], corridas:[],
};

/* ------------------------------------------------------------- utilería */
const uid = () => Math.random().toString(36).slice(2,9);
const slug = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60) || "x";
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const cliente = () => S.cuentas.find(c => c.key === S.clienteKey) || null;
const hoy = () => new Date().toISOString().slice(0,10);
const periodoHoy = () => { const d = new Date(); return d.toLocaleString("es-MX",{month:"short"}).replace(".","").replace(/^./,x=>x.toUpperCase()) + d.getFullYear().toString().slice(-2); };

/* --------------------------------------------------------- constructores */
const nuevaCampana = () => ({ id:uid(), modo:"NUEVA", metaId:"", nombreMeta:"",
  marca:"", producto:"", etapa:"Consideración", periodo:periodoHoy(),
  objetivo:"OUTCOME_SALES", meta:"OFFSITE_CONVERSIONS", evento:"PURCHASE", categoria:"NONE",
  presupuestoEn:"CAMPAIGN", tipoMonto:"DAILY", monto:"", inicio:hoy(), fin:"",
  cbo:false, estadoMeta:"", conjuntosCargados:false, pageId:"",
  destino:"WEBSITE", whatsapp:"", datasetMsg:"", nombreLibre:"", importada:"", puja:"", cfgWA:null,
  compartir:"NO", ubicaciones:"FBIG", audienciaAdv:"OFF", waCambiaObjetivo:false });
const campanaExistente = (x) => ({ id:uid(), modo:"EXISTENTE", metaId:String(x.id), nombreMeta:x.n||"",
  marca:"", producto:"", etapa:"", periodo:"",
  objetivo:x.objetivo||"", meta:"", evento:"", categoria:(x.categorias&&x.categorias[0])||"NONE",
  presupuestoEn: x.cbo ? "CAMPAIGN" : "ADSET", tipoMonto:"DAILY", monto:"", inicio:"", fin:"",
  cbo:!!x.cbo, estadoMeta:x.estado||"", conjuntosCargados:false, pageId:x.page_id||"",
  presupuestoDiario:Number(x.daily||0), presupuestoTotal:Number(x.lifetime||0) });
const nuevoConjunto = (campanaId) => ({ id:uid(), campanaId, modo:"NUEVO", metaId:"", nombre:"",
  origen:"DEFINIR", cuenta:[], regiones:[], ciudades:[], radio:15, edadMin:18, edadMax:65, genero:"ALL",
  intereses:[], guardadas:[], excluidas:[], presupuesto:"", meta:"",
  destino:"WEBSITE", whatsapp:"", datasetMsg:"", copia:false, targeting:null, evento:"", pujaMonto:"" });
const conjuntoExistente = (campanaId, x) => ({ id:uid(), campanaId, modo:"EXISTENTE", metaId:String(x.id), nombre:x.n||"",
  origen:"", cuenta:[], regiones:[], ciudades:[], radio:0, edadMin:"", edadMax:"", genero:"", intereses:[], guardadas:[], excluidas:[],
  presupuesto:"", sel:true, estadoMeta:x.estado||"", optim:x.optim||"", detalle:x.r||"",
  destinoMeta: ["WHATSAPP","FORMULARIO"].includes(x.destino) ? x.destino : "WEBSITE" });
/* tipo: IMAGE, VIDEO o POST (publicación existente de Facebook o Instagram, 5.1). */
const nuevoCreativo = () => ({ id:uid(), nombre:"", tipo:"IMAGE", archivo:"", archivoStories:"", archivoColumna:"", local:{}, post:null });
/* Los textos viven en el anuncio: hasta 5 textos principales y 5 títulos, que
   Meta combina y optimiza por persona. */
const nuevoAnuncio = () => ({ id:uid(), nombre:"", creativoId:"", conjuntoIds:[],
  textos:[""], titulos:[""], descripcion:"", cta:"LEARN_MORE", url:"",
  saludo:"", prellenado:"", preguntas:[], secuencia:"", plantilla:"", formId:"", mejoras:"META",
  trackPixel: (S.fuentes.find(f => f.tipo === "PIXEL") || {}).id || (cliente()||{}).pixel || "",
  trackDataset: (S.fuentes.find(f => f.tipo === "OFFLINE") || {}).id || "" });

/* ---------------------------------------------------- números de WhatsApp */
/* Clave para comparar números: dígitos y, en México, sin el "1" de móvil. */
function claveNumero(v){ let d = String(v||"").replace(/[^0-9]/g,""); if (/^521\d{10}$/.test(d)) d = "52" + d.slice(3); return d; }
const numeroValido = v => /^\+?\d{10,15}$/.test(String(v||"").replace(/[\s\-().]/g,""));
function infoNumero(v){ const k = claveNumero(v); return S.whatsapps.find(x => claveNumero(x.id) === k) || null; }

/* ---------------------------------------------------- destino WhatsApp */
/* Optimizaciones que Meta admite con destino WhatsApp, por objetivo. */
const METAS_WA = {
  /* MESSAGING_PURCHASE_CONVERSION = "Maximizar compras por mensajes" (eventos de WhatsApp).
     OFFSITE_CONVERSIONS = "Maximizar conversiones" del sitio web (píxel). No son lo mismo. */
  /* Con WhatsApp, "Compras por mensajes" va con objetivo Interacción (como lo crea
     Ads Manager); con Ventas, Meta la rechaza (error 100/2490408). */
  OUTCOME_ENGAGEMENT: [["MESSAGING_PURCHASE_CONVERSION","Compras por mensajes (modo anterior)"],["CONVERSATIONS","Conversaciones"],["LINK_CLICKS","Clics"]],
  OUTCOME_SALES:      [["OFFSITE_CONVERSIONS","Compras con conjunto de datos (WhatsApp CAPI o píxel)"],["CONVERSATIONS","Conversaciones"],["LINK_CLICKS","Clics"]],
  OUTCOME_TRAFFIC:    [["CONVERSATIONS","Conversaciones"],["LINK_CLICKS","Clics"]],
  OUTCOME_LEADS:      [["CONVERSATIONS","Conversaciones"]],
};
/* Formulario instantáneo: solo con objetivo Clientes potenciales. */
const METAS_FORM = [["LEAD_GENERATION","Clientes potenciales (más volumen)"],["QUALITY_LEAD","Clientes potenciales de conversión (CRM conectado)"]];
/* Objetivos que admiten cada optimización con WhatsApp (documentación de Click to WhatsApp, sept-2026). */
const OBJETIVOS_WA_DOC = { OFFSITE_CONVERSIONS:["OUTCOME_SALES"], MESSAGING_PURCHASE_CONVERSION:["OUTCOME_SALES","OUTCOME_ENGAGEMENT"],
  CONVERSATIONS:["OUTCOME_ENGAGEMENT","OUTCOME_SALES","OUTCOME_TRAFFIC","OUTCOME_LEADS"], LINK_CLICKS:["OUTCOME_TRAFFIC","OUTCOME_ENGAGEMENT","OUTCOME_SALES"] };
const NOMBRE_META_WA = { OFFSITE_CONVERSIONS:"conversiones con el conjunto de datos", MESSAGING_PURCHASE_CONVERSION:"compras por mensajes", CONVERSATIONS:"conversaciones", LINK_CLICKS:"clics" };
const DESTINOS = [["WEBSITE","Sitio web"],["WHATSAPP","WhatsApp"],["FORMULARIO","Formulario instantáneo"]];
const nombreDestino = d => (DESTINOS.find(x => x[0] === d) || ["","Sitio web"])[1];
function metasPara(objetivo, destino){
  if (destino === "WHATSAPP") return METAS_WA[objetivo] || [];
  if (destino === "FORMULARIO") return objetivo === "OUTCOME_LEADS" ? METAS_FORM : [];
  const o = OBJETIVOS.find(x => x.v === objetivo); return o ? o.metas : OBJETIVOS.flatMap(x => x.metas);
}
/* En campañas nuevas el destino lo define la campaña; en existentes, cada conjunto nuevo. */
const propioDe = k => { const c = campanaDe(k) || {}; return !(c.modo === "NUEVA" && !k.copia); };
function destinoDe(k){ const c = campanaDe(k) || {}; return (propioDe(k) ? k.destino : c.destino) || "WEBSITE"; }
function whatsappDe(k){ const c = campanaDe(k) || {}; return propioDe(k) ? k.whatsapp : c.whatsapp; }
function datasetMsgDe(k){ const c = campanaDe(k) || {}; return propioDe(k) ? k.datasetMsg : c.datasetMsg; }
/* WhatsApp (5.5): compras = optimizar por compras (modo anterior o con conjunto de datos). */
const esComprasWA = meta => ["MESSAGING_PURCHASE_CONVERSION","OFFSITE_CONVERSIONS","VALUE"].includes(meta);
/* Conjunto de datos de compras a usar: el elegido; si no, el único conjunto de datos de WhatsApp (CAPI)
   de la cuenta; si no, el de la configuración probada. */
function datasetWA(obj){
  if (!obj) return "";
  if (obj.datasetMsg) return obj.datasetMsg;
  const was = (S.fuentes || []).filter(f => f.tipo === "WHATSAPP");
  if (was.length === 1) return was[0].id;
  const c = obj.campanaId ? (campanaDe(obj) || {}) : obj;
  const ref = c.cfgWA && c.cfgWA.config && (c.cfgWA.config.promoted_object || {}).pixel_id;
  return ref ? String(ref) : "";
}
function metaDe(k){ const c = campanaDe(k) || {}; return propioDe(k) ? k.meta : c.meta; }
const PUJAS_CON_IMPORTE = ["LOWEST_COST_WITH_BID_CAP","COST_CAP","TARGET_COST","LOWEST_COST_WITH_MIN_ROAS"];
const destinoConjunto = k => k.modo === "EXISTENTE" ? (k.destinoMeta || "WEBSITE") : destinoDe(k);
const destinosDelAnuncio = a => [...new Set((a.conjuntoIds||[]).map(conjuntoPorId).filter(k => k && (k.modo==="NUEVO"||k.sel)).map(destinoConjunto))];
const formularioPorId = id => (S.formularios || []).find(x => x.id === String(id||"")) || null;
const limpios = arr => (arr||[]).map(x => String(x||"").trim()).filter(Boolean);

/* --------------------------------------------------------------- nombres */
const restringida = c => !!c && c.categoria !== "NONE";
function nombreCampana(c){
  if (c.modo === "EXISTENTE") return c.nombreMeta || "Campaña existente";
  if (c.nombreLibre) return c.nombreLibre;
  const p = [c.marca, c.producto, c.etapa, c.periodo].map(x => String(x||"").trim()).filter(Boolean);
  return p.length ? p.join(" · ") : "Campaña nueva";
}
function nombreConjunto(k){
  if (k.nombre && k.nombre.trim()) return k.nombre.trim();
  if (k.origen === "CUENTA" && k.cuenta[0]) return k.cuenta[0].n;
  return "Conjunto sin nombre";
}
function nombreCreativo(cr, i){
  if (cr.nombre && cr.nombre.trim()) return cr.nombre.trim();
  if (cr.tipo === "POST" && cr.post) return (cr.post.origen === "INSTAGRAM" ? "Post IG · " : "Post FB · ") + String(cr.post.n || "").slice(0, 40);
  const l = (cr.local||{}).archivo;
  if (l && l.nombre) return l.nombre.replace(/\.[a-z0-9]+$/i,"");
  return "Creativo " + (i+1);
}
function nombreAnuncio(a){ return (a.nombre||"").trim() || "Anuncio sin nombre"; }
const campanaDe = k => S.campanas.find(c => c.id === k.campanaId) || null;
const conjuntosDe = c => S.conjuntos.filter(k => k.campanaId === c.id);
const conjuntosActivos = () => S.conjuntos.filter(k => k.modo === "NUEVO" || k.sel);
const creativoDe = a => S.creativos.find(c => c.id === a.creativoId) || null;
const conjuntoPorId = id => S.conjuntos.find(k => k.id === id) || null;

/* Inversión comprometida por el plan: lo nuevo suma; lo existente se informa aparte. */
function inversion(){
  let diaria = 0, total = 0, existenteDiaria = 0, existenteTotal = 0;
  S.campanas.forEach(c => {
    if (c.modo === "EXISTENTE"){ existenteDiaria += c.presupuestoDiario||0; existenteTotal += c.presupuestoTotal||0; }
    else if (c.presupuestoEn === "CAMPAIGN"){ if (c.tipoMonto === "DAILY") diaria += Number(c.monto)||0; else total += Number(c.monto)||0; }
    const nuevos = conjuntosDe(c).filter(k => k.modo === "NUEVO");
    if (llevaPresupuestoConjunto(c)) nuevos.forEach(k => { const m = Number(k.presupuesto)||0; if (c.modo !== "EXISTENTE" && c.tipoMonto === "LIFETIME") total += m; else diaria += m; });
  });
  return { diaria, total, existenteDiaria, existenteTotal };
}
function presupuestoRama(c){
  if (c.modo === "EXISTENTE") return c.cbo ? (c.presupuestoDiario ? c.presupuestoDiario + "/día" : (c.presupuestoTotal ? c.presupuestoTotal + " total" : "existente")) : "ABO";
  if (c.presupuestoEn === "CAMPAIGN") return (Number(c.monto)||0) + (c.tipoMonto === "DAILY" ? "/día" : " total");
  const suma = conjuntosDe(c).filter(k => k.modo === "NUEVO").reduce((t,k) => t + (Number(k.presupuesto)||0), 0);
  return suma + (c.tipoMonto === "DAILY" ? "/día" : " total") + " (ABO)";
}

/* Cada anuncio × conjunto asignado es un anuncio real en Meta. */
function instancias(){
  const out = [];
  S.anuncios.forEach(a => (a.conjuntoIds||[]).forEach(kid => {
    const k = conjuntoPorId(kid);
    if (k && (k.modo === "NUEVO" || k.sel)) out.push({ a, k, c: campanaDe(k) });
  }));
  return out;
}
function minimoDe(c){
  const cl = cliente(); if (!cl) return 0;
  const conv = ["OFFSITE_CONVERSIONS","VALUE","MESSAGING_PURCHASE_CONVERSION"].includes(c ? c.meta : "");
  return conv ? cl.minConv : cl.minImp;
}
const llevaPresupuestoConjunto = c => !!c && c.presupuestoEn === "ADSET";

function resumenSegmentacion(k){
  if (k.modo === "EXISTENTE") return k.detalle || "Conjunto existente";
  if (k.copia){
    const t = k.targeting || {}, g = t.geo_locations || {}, p = [];
    const geo = [].concat(g.countries || [], (g.regions || []).map(x => x.name || x.key), (g.cities || []).map(x => x.name || x.key));
    if (geo.length) p.push(geo.slice(0,4).join(", ") + (geo.length > 4 ? " +" + (geo.length-4) : ""));
    p.push((t.age_min || 18) + "–" + (t.age_max || 65));
    const n = (t.flexible_spec || []).reduce((s,f) => s + (f.interests||[]).length + (f.behaviors||[]).length, 0) + (t.interests||[]).length;
    if (n) p.push(n + " intereses o comportamientos");
    if ((t.custom_audiences || []).length) p.push(t.custom_audiences.length + " públicos");
    if ((t.publisher_platforms || []).length) p.push(t.publisher_platforms.join(" + "));
    return "Copiada · " + p.join(" · ");
  }
  if (k.origen === "CUENTA") return "Audiencia guardada" + (k.cuenta[0] ? ": " + k.cuenta[0].n : "");
  const p = [];
  const geo = [];
  if (k.ciudades.length) geo.push(k.ciudades.map(x=>x.n).join(", ") + (k.radio>0 ? " +" + k.radio + " km" : ""));
  if (k.regiones.length) geo.push(k.regiones.map(x=>x.n).join(", "));
  if (!geo.length && S.pais.cc) geo.push("Todo " + (S.pais.n || S.pais.cc));
  if (geo.length) p.push(geo.join(" · "));
  p.push((k.edadMin||18) + "–" + (k.edadMax||65) + (k.genero==="ALL"?"":k.genero==="MALE"?" · hombres":" · mujeres"));
  if (k.intereses.length) p.push(k.intereses.map(x=>x.n).join(", "));
  if (k.guardadas.length) p.push(k.guardadas.length + (k.guardadas.length===1?" público personalizado":" públicos personalizados"));
  if (k.excluidas.length) p.push("excluye " + k.excluidas.length);
  return p.join(" · ");
}
function kbLocales(){
  /* Solo cuenta lo que viaja dentro del plan (borradores antiguos); lo subido a Meta no pesa. */
  let kb = 0;
  S.creativos.forEach(c => Object.values(c.local||{}).forEach(l => { kb += (l && l.data && l.kb) || 0; }));
  return kb;
}
function avisoRatio(campo, l){
  if (!l || !l.ancho) return "";
  const r = l.ancho / l.alto;
  const ok = (RATIO_ESPERADO[campo]||[]).some(x => Math.abs(r - x) < 0.06);
  return ok ? "" : "Proporción " + (Math.round(r*100)/100) + ":1, distinta a la recomendada para esta ubicación. Meta la recortará.";
}

/* ------------------------------------------------------------ validación */
/* Cada alerta recuerda a qué elemento pertenece ("c:", "k:", "cr:", "a:" + id) para marcar su
   tarjeta y llevar a él con un clic (5.4). */
const REFS = {};
function px(p, ref, texto){ p.push(texto); if (ref) REFS[texto] = ref; }
function problemas(paso){
  const p = [], cl = cliente();
  if (paso === 0){
    if (!S.clienteKey) p.push("Elige la cuenta publicitaria.");
  }
  if (paso === 1){
    if (!S.campanas.length) p.push("Agrega al menos una campaña, nueva o existente.");
    if (!S.pageId) p.push("Elige la página de Facebook con la que salen los anuncios.");
    S.campanas.forEach((c, i) => {
      if (c.modo === "EXISTENTE") return;
      const et = "Campaña " + (i+1);
      if (c.nombreLibre){ if (!c.nombreLibre.trim()) px(p, "c:" + c.id, et + ": falta el nombre."); }
      else {
        if (!c.marca.trim() || !c.producto.trim()) px(p, "c:" + c.id, et + ": el nombre necesita marca y producto.");
        if (!c.periodo.trim()) px(p, "c:" + c.id, et + ": falta el periodo del nombre.");
      }
      if (PUJAS_CON_IMPORTE.includes(c.puja) && conjuntosDe(c).some(k => k.copia && !Number(k.pujaMonto)))
        px(p, "c:" + c.id, et + ": usa una puja con tope (" + c.puja + ") y algún conjunto no tiene importe de puja.");
      if (c.presupuestoEn === "CAMPAIGN"){
        const m = parseFloat(c.monto);
        if (!m) px(p, "c:" + c.id, et + ": falta el presupuesto de la campaña.");
        else if (cl && c.tipoMonto === "DAILY" && m < minimoDe(c)) px(p, "c:" + c.id, et + ": el presupuesto está por debajo del mínimo de la cuenta (" + minimoDe(c) + " " + cl.moneda + ").");
      }
      if (c.tipoMonto === "LIFETIME" && !c.fin) px(p, "c:" + c.id, et + ": con presupuesto total hace falta fecha de fin.");
      if (c.ubicaciones === "IG" && cl && !cl.ig) px(p, "c:" + c.id, et + ": la cuenta no tiene Instagram conectado; elige otras ubicaciones.");
      if (!c.inicio) px(p, "c:" + c.id, et + ": falta la fecha de inicio.");
      if (c.fin && c.inicio && c.fin < c.inicio) px(p, "c:" + c.id, et + ": la fecha de fin es anterior al inicio.");
      if (c.importada){ /* la optimización y el destino viven en los conjuntos copiados */ }
      else if (c.destino === "FORMULARIO"){
        if (c.objetivo !== "OUTCOME_LEADS") px(p, "c:" + c.id, et + ": los formularios instantáneos solo funcionan con el objetivo Clientes potenciales.");
        if (!METAS_FORM.some(m => m[0] === c.meta)) px(p, "c:" + c.id, et + ": con formulario, optimiza por Clientes potenciales.");
      }
      else if (c.destino === "WHATSAPP" && c.cfgWA){ if (c.whatsapp && !numeroValido(c.whatsapp)) px(p, "c:" + c.id, et + ": el número de WhatsApp no tiene un formato válido."); }
      else if (c.destino === "WHATSAPP"){
        if (!METAS_WA[c.objetivo]) px(p, "c:" + c.id, et + ": el objetivo elegido no admite destino WhatsApp. Usa Ventas, Interacción, Tráfico o Clientes potenciales.");
        else if (!METAS_WA[c.objetivo].some(m => m[0] === c.meta)) px(p, "c:" + c.id, et + ": esa optimización no existe con WhatsApp para este objetivo." + (c.meta === "MESSAGING_PURCHASE_CONVERSION" ? " Con WhatsApp, las compras por mensajes se crean con objetivo Interacción." : ""));
        if (c.meta === "OFFSITE_CONVERSIONS" && !datasetWA(c) && cl && !cl.pixel) px(p, "c:" + c.id, et + ": para optimizar por compras elige el conjunto de datos de WhatsApp (CAPI); la cuenta tampoco tiene píxel.");
        if (c.whatsapp && !numeroValido(c.whatsapp)) px(p, "c:" + c.id, et + ": el número de WhatsApp no tiene un formato válido. Escríbelo con código de país, por ejemplo +52 81 1454 0207.");
      } else if (["OFFSITE_CONVERSIONS","VALUE"].includes(c.meta) && cl && !cl.pixel) px(p, "c:" + c.id, et + ": optimiza por conversiones y la cuenta no tiene píxel. Elige clics o vistas de página.");
      if (c.meta === "VALUE" && c.evento !== "PURCHASE") px(p, "c:" + c.id, et + ": valor de compra solo funciona con el evento Compra.");
    });
    const dup = {};
    S.campanas.forEach(c => { const n = nombreCampana(c); if (dup[n]) px(p, "c:" + c.id, "Hay dos campañas con el mismo nombre: " + n + "."); dup[n] = true; });
  }
  if (paso === 2){
    if (!S.pais.cc && S.conjuntos.some(k => k.modo === "NUEVO" && k.origen !== "CUENTA" && !k.copia)) p.push("Elige el país donde se va a pautar.");
    S.campanas.forEach(c => {
      const ks = conjuntosDe(c);
      const activos = ks.filter(k => k.modo === "NUEVO" || k.sel);
      if (!activos.length) px(p, "c:" + c.id, 'La campaña "' + nombreCampana(c) + '" no tiene ningún conjunto' + (c.modo==="EXISTENTE" ? " marcado ni nuevo." : "."));
      const dup = {};
      ks.filter(k => k.modo === "NUEVO").forEach((k, i) => {
        const et = 'Conjunto "' + nombreConjunto(k) + '" (' + nombreCampana(c) + ')';
        if (k.copia){
          if (!k.nombre.trim()) px(p, "k:" + k.id, "Un conjunto copiado de " + nombreCampana(c) + " no tiene nombre.");
          if (destinoDe(k) === "WHATSAPP" && k.whatsapp && !numeroValido(k.whatsapp)) px(p, "k:" + k.id, et + ": el número de WhatsApp no tiene un formato válido.");
        } else if (k.origen === "CUENTA"){
          if (!k.cuenta.length) px(p, "k:" + k.id, et + ": elige la audiencia guardada de la cuenta.");
        } else {
          if (!k.nombre.trim()) px(p, "k:" + k.id, "Un conjunto de " + nombreCampana(c) + " no tiene nombre.");
          if (!k.ciudades.length && !k.regiones.length && !S.pais.cc) px(p, "k:" + k.id, et + ": falta la ubicación.");
          if (+k.edadMin > +k.edadMax) px(p, "k:" + k.id, et + ": el rango de edad está invertido.");
          if (+k.edadMin < 18) px(p, "k:" + k.id, et + ": la edad mínima que acepta Meta es 18.");
        }
        if (llevaPresupuestoConjunto(c)){
          const m = parseFloat(k.presupuesto);
          if (!m) px(p, "k:" + k.id, et + ": falta el presupuesto diario del conjunto.");
          else if (cl && m < minimoDe(c)) px(p, "k:" + k.id, et + ": está por debajo del mínimo (" + minimoDe(c) + " " + cl.moneda + ").");
        }
        if (c.modo === "EXISTENTE" && !k.meta) px(p, "k:" + k.id, et + ": indica hacia qué optimiza (la campaña existente no lo define por ti).");
        if (c.modo === "EXISTENTE" && k.destino === "FORMULARIO" && c.objetivo !== "OUTCOME_LEADS") px(p, "k:" + k.id, et + ": el formulario instantáneo necesita una campaña de Clientes potenciales.");
        if (c.modo === "EXISTENTE" && k.destino === "WHATSAPP" && k.whatsapp && !numeroValido(k.whatsapp)) px(p, "k:" + k.id, et + ": el número de WhatsApp no tiene un formato válido.");
        const n = nombreConjunto(k);
        if (dup[n]) px(p, "k:" + k.id, 'Hay dos conjuntos nuevos con el mismo nombre en ' + nombreCampana(c) + ': ' + n + '.');
        dup[n] = true;
      });
    });
  }
  if (paso === 3){
    if (!S.creativos.length) p.push("Agrega al menos un creativo.");
    S.creativos.forEach((cr, i) => {
      const et = nombreCreativo(cr, i), loc = cr.local||{};
      if (cr.tipo === "POST"){ if (!cr.post) px(p, "cr:" + cr.id, et + ": elige la publicación de Facebook o Instagram."); return; }
      if (!cr.archivo.trim() && !loc.archivo) px(p, "cr:" + cr.id, et + ": falta el archivo: súbelo desde el ordenador o pega su enlace.");
      else if (cr.archivo.trim() && /drive\.google\.com\/file\//.test(cr.archivo)) px(p, "cr:" + cr.id, et + ": ese enlace de Drive es de vista previa. Usa el de descarga directa.");
      Object.keys(loc).forEach(campo => {
        const l = loc[campo]; if (!l) return;
        if (l.subiendo) return;   /* se puede seguir armando el plan; el envío espera */
        if (l.fallo) px(p, "cr:" + cr.id, et + ": la subida de " + l.nombre + " falló (" + l.fallo + "). Quítalo y vuelve a subirlo.");
        else if (l.cuenta && cl && l.cuenta !== cl.cuenta) px(p, "cr:" + cr.id, et + ": " + l.nombre + " se subió a otra cuenta publicitaria. Quítalo y vuelve a subirlo en esta.");
      });
      if (cr.tipo === "VIDEO" && loc.archivo && loc.archivo.hash) px(p, "cr:" + cr.id, et + ": el formato es video pero el archivo subido es una imagen.");
      if (cr.tipo === "IMAGE" && loc.archivo && loc.archivo.video_id) px(p, "cr:" + cr.id, et + ": el formato es imagen pero el archivo subido es un video.");
      if (cr.tipo === "IMAGE") [["archivoStories","Stories/Reels"],["archivoColumna","columna derecha"]].forEach(([k,lbl]) => {
        const v = String(cr[k]||"").trim();
        if (v && /drive\.google\.com\/file\//.test(v)) px(p, "cr:" + cr.id, et + ": el enlace de " + lbl + " es de vista previa.");
      });
    });
    const vistos = {};
    S.creativos.forEach((cr, i) => { const n = nombreCreativo(cr, i); if (vistos[n]) px(p, "cr:" + cr.id, "Hay dos creativos con el mismo nombre: " + n + "."); vistos[n] = true; });
    const mb = kbLocales()/1024;
    if (mb > LIMITE_ENVIO_MB) p.push("Las imágenes subidas desde el ordenador suman " + mb.toFixed(1) + " MB y el envío admite " + LIMITE_ENVIO_MB + " MB. Cambia algunas a enlace.");
  }
  if (paso === 4){
    if (!S.anuncios.length) p.push("Agrega al menos un anuncio.");
    const vistos = {};
    S.anuncios.forEach((a, i) => {
      const et = "Anuncio " + (i+1);
      if (!a.nombre.trim()) px(p, "a:" + a.id, et + ": falta el nombre.");
      if (!a.creativoId || !creativoDe(a)) px(p, "a:" + a.id, et + ": elige el creativo.");
      const validos = (a.conjuntoIds||[]).filter(id => { const k = conjuntoPorId(id); return k && (k.modo==="NUEVO" || k.sel); });
      if (!validos.length) px(p, "a:" + a.id, et + ": asígnalo al menos a un conjunto.");
      const tx = limpios(a.textos), ti = limpios(a.titulos), post = esPublicacion(a);
      if (post && destinosDelAnuncio(a).some(d => d !== "WEBSITE")) px(p, "a:" + a.id, et + ": una publicación existente solo puede ir a conjuntos que llevan al sitio web (Meta no permite cambiarle el botón a WhatsApp o formulario).");
      if (!post && !tx.length) px(p, "a:" + a.id, et + ": falta al menos un texto principal.");
      if (!post && !ti.length) px(p, "a:" + a.id, et + ": falta al menos un título.");
      if (tx.length > 5) px(p, "a:" + a.id, et + ": Meta admite máximo 5 textos principales.");
      if (ti.length > 5) px(p, "a:" + a.id, et + ": Meta admite máximo 5 títulos.");

      const dests = destinosDelAnuncio(a);
      const postFB = post && (creativoDe(a).post || {}).origen === "FACEBOOK";
      if (dests.includes("WEBSITE") && !postFB){
        if (!(a.url||"").trim()) px(p, "a:" + a.id, et + ": falta la URL de destino (está en al menos un conjunto que va al sitio web).");
        else if (!/^https?:\/\//i.test(a.url.trim())) px(p, "a:" + a.id, et + ": la URL debe empezar por https://");
      }
      if (a.prellenado && a.prellenado.length > 300) px(p, "a:" + a.id, et + ": el mensaje prellenado de WhatsApp supera 300 caracteres.");
      if (a.saludo && a.saludo.length > 300) px(p, "a:" + a.id, et + ": el saludo de WhatsApp supera 300 caracteres.");
      if (dests.includes("WHATSAPP") && (a.preguntas||[]).filter(Boolean).length > 4) px(p, "a:" + a.id, et + ": Meta admite hasta 4 preguntas frecuentes.");
      if (dests.includes("FORMULARIO")){
        if (!a.formId) px(p, "a:" + a.id, et + ": elige el formulario instantáneo (está en al menos un conjunto con formulario).");
        else if (S.formularios.length && !formularioPorId(a.formId)) px(p, "a:" + a.id, et + ": el formulario elegido no es de la página actual. Elige otro.");
        else if (formularioPorId(a.formId) && formularioPorId(a.formId).estado !== "ACTIVE") px(p, "a:" + a.id, et + ': el formulario "' + formularioPorId(a.formId).n + '" no está activo.');
        if (!CTAS_FORM.includes(a.cta)) px(p, "a:" + a.id, et + ": ese botón no está disponible con formularios. Usa Registrarse, Más información, Solicitar o Cotizar.");
      }
      const utm = String(a.urlTags || "").trim();
      if (utm){
        if (/^[?&]/.test(utm)) px(p, "a:" + a.id, et + ": los parámetros de URL van sin el \"?\" inicial (ejemplo: utm_source=meta&utm_medium=paid).");
        else if (/\s/.test(utm.replace(/\{\{[^}]*\}\}/g, ""))) px(p, "a:" + a.id, et + ": los parámetros de URL no pueden tener espacios.");
        else if (utm.split("&").some(par => !/^[^=&]+=[^&]*$/.test(par))) px(p, "a:" + a.id, et + ": los parámetros de URL deben tener la forma clave=valor, separados por &.");
      }
      if (dests.includes("WHATSAPP") && (a.preguntas||[]).some(q => q.length > 80)) px(p, "a:" + a.id, et + ": cada pregunta frecuente admite hasta 80 caracteres.");
      const cr = creativoDe(a);
      if (cr) validos.forEach(id => {
        const k = conjuntoPorId(id), c = campanaDe(k);
        const optim = k.modo === "EXISTENTE" ? k.optim : (c && c.modo === "EXISTENTE" ? k.meta : (c ? c.meta : ""));
        if (optim === "THRUPLAY" && cr.tipo !== "VIDEO") px(p, "a:" + a.id, et + ': el conjunto "' + nombreConjunto(k) + '" optimiza por reproducciones y el creativo es una imagen.');
      });
      const n = a.nombre.trim();
      if (n && vistos[n]) px(p, "a:" + a.id, "Hay dos anuncios con el mismo nombre: " + n + ".");
      if (n) vistos[n] = true;
    });
  }
  if (paso === 5){
    if (S.cuentas.length && typeof SITIO_VERSION_ESPERADA !== "undefined" && S.motorVersion !== SITIO_VERSION_ESPERADA)
      p.push("El motor de n8n activo (" + (S.motorVersion || "anterior a " + SITIO_VERSION_ESPERADA) + ") no coincide con este sitio (" + SITIO_VERSION_ESPERADA + "): activa el workflow nuevo en n8n y desactiva el anterior.");
    for (let q = 0; q < 5; q++) problemas(q).forEach(x => { if (p.indexOf(x) < 0) p.push(x); });
    S.creativos.forEach((cr, i) => Object.values(cr.local||{}).forEach(l => {
      if (l && l.subiendo) px(p, "cr:" + cr.id, nombreCreativo(cr, i) + ": todavía se está subiendo " + l.nombre + " (" + Math.round((l.progreso||0)*100) + " %). El envío se habilita al terminar.");
    }));
    if (!instancias().length) p.push("No hay ningún anuncio asignado a un conjunto activo.");
    (S.replicas || []).forEach(r => problemasReplica(r).forEach(x => p.push(x)));
  }
  return p;
}

/* ------------------------------------------------ avisos (no bloquean) */
/* Cada aviso es { paso, texto, nivel }: nivel "revisar" (conviene mirarlo antes de
   enviar) o "info" (contexto). El paso permite saltar a donde se corrige. */
function avisos(){
  const out = [], cl = cliente();
  const add = (paso, texto, nivel, ref) => out.push({ paso, texto, nivel: nivel || "revisar", ref: ref || "" });
  S.campanas.filter(c => c.modo === "EXISTENTE" && c.pageId && S.pageId && c.pageId !== S.pageId)
    .forEach(c => add(1, 'La campaña "' + nombreCampana(c) + '" publica con otra página; los anuncios nuevos saldrán con la página elegida.'));
  /* Cero de más: un monto 10 veces la mediana del plan, o 2000 veces el mínimo de la cuenta. */
  const montos = [];
  S.campanas.forEach(c => { if (c.modo === "NUEVA" && c.presupuestoEn === "CAMPAIGN" && Number(c.monto)) montos.push({ n:'La campaña "' + nombreCampana(c) + '"', v:Number(c.monto), paso:1 }); });
  S.conjuntos.forEach(k => { if (k.modo === "NUEVO" && Number(k.presupuesto)) montos.push({ n:'El conjunto "' + nombreConjunto(k) + '"', v:Number(k.presupuesto), paso:2 }); });
  const ord = montos.map(m => m.v).sort((a,b) => a-b), med = ord.length ? ord[Math.floor(ord.length/2)] : 0;
  const minimo = cl ? cl.minImp : 0;
  montos.forEach(m => { if ((ord.length >= 3 && m.v >= med * 10) || (minimo && m.v >= minimo * 2000))
    add(m.paso, m.n + " tiene " + m.v.toLocaleString("es-MX") + " " + (cl ? cl.moneda : "") + " de presupuesto: revisa que no sobre un cero."); });
  S.fuentes.filter(f => f.tipo === "PIXEL" && f.dias != null && f.dias > 7 && S.anuncios.some(a => a.trackPixel === f.id))
    .forEach(f => add(4, 'El píxel "' + f.n + '" no registra eventos hace ' + f.dias + ' días: revisa la instalación antes de medir con él.'));
  S.campanas.filter(c => c.modo === "NUEVA" && c.destino === "WHATSAPP" && esComprasWA(c.meta) && !datasetWA(c))
    .forEach(c => add(1, 'La campaña "' + nombreCampana(c) + '" optimiza por compras en WhatsApp sin conjunto de datos de compras (WhatsApp CAPI). Elígelo en la campaña: Meta lo usa para optimizar compras y el motor lo necesita para varias de las configuraciones que prueba.', "revisar", "c:" + c.id));
  if (S.campanas.some(c => c.modo === "NUEVA" && c.destino === "WHATSAPP" && esComprasWA(c.meta))
      || S.conjuntos.some(k => k.modo === "NUEVO" && destinoDe(k) === "WHATSAPP" && esComprasWA(metaDe(k))))
    add(1, "Optimizar por compras en WhatsApp necesita que tu proveedor del chat envíe compras al conjunto de datos de WhatsApp (API de conversiones). Sin compras recientes, Meta aprende lento: considera empezar por Conversaciones.", "info");
  /* Configuración probada que Meta ya no admite con su objetivo (tabla de Click to WhatsApp): se verifica al enviar. */
  S.campanas.filter(c => c.modo === "NUEVA" && c.destino === "WHATSAPP" && c.cfgWA && c.cfgWA.config).forEach(c => {
    const meta = String(c.cfgWA.config.optimization_goal || "").toUpperCase(), obj = String(c.cfgWA.objetivo || "").toUpperCase();
    const permitidos = OBJETIVOS_WA_DOC[meta];
    if ((permitidos && obj && !permitidos.includes(obj)) || meta === "MESSAGING_PURCHASE_CONVERSION")
      add(1, 'La configuración probada de "' + nombreCampana(c) + '" usa ' + (NOMBRE_META_WA[meta] || meta) + ' con objetivo ' + ((OBJETIVOS.find(o => o.v === obj) || {}).t || obj)
        + ', que Meta ya no documenta para WhatsApp. Al enviar, el motor verifica con Meta qué configuración acepta y usa la primera válida (sin crear nada antes). Usa "Verificar con Meta" en la campaña para verlo ahora.', "info", "c:" + c.id);
  });

  if (S.conjuntos.some(k => k.modo === "NUEVO" && destinoDe(k) === "FORMULARIO" && metaDe(k) === "QUALITY_LEAD"))
    add(2, "Clientes potenciales de conversión necesita el CRM conectado a Meta (eventos de calidad del lead por la API de conversiones). Sin eso, Meta optimiza como clientes potenciales normales.");
  if (S.anuncios.some(a => destinosDelAnuncio(a).includes("FORMULARIO")))
    add(4, "Los leads del formulario llegan al Centro de clientes potenciales de la página. Desde \"Formularios y leads\" (barra superior) puedes descargarlos en CSV.", "info");
  S.campanas.filter(c => c.modo === "NUEVA" && c.destino === "WHATSAPP" && !c.whatsapp)
    .forEach(c => add(1, 'La campaña "' + nombreCampana(c) + '" no tiene número de WhatsApp elegido: Meta usará el número vinculado a la página.', "info", "c:" + c.id));
  const numerosUsados = [];
  S.campanas.forEach(c => { if (c.modo === "NUEVA" && c.destino === "WHATSAPP" && c.whatsapp) numerosUsados.push({ n:c.whatsapp, d:'la campaña "' + nombreCampana(c) + '"', paso:1 }); });
  S.conjuntos.forEach(k => { if (k.modo === "NUEVO" && k.destino === "WHATSAPP" && k.whatsapp) numerosUsados.push({ n:k.whatsapp, d:'el conjunto "' + nombreConjunto(k) + '"', paso:2 }); });
  numerosUsados.forEach(u => {
    const i = infoNumero(u.n);
    if (i && i.grupo === "OTRA_PAGINA") add(u.paso, "El número " + i.n + " de " + u.d + " solo se ha usado con otra página. Confirma que esté conectado a la página elegida.");
    else if (!i && S.whatsapps.length) add(u.paso, "El número " + u.n + " de " + u.d + " no aparece en los anuncios publicados ni en los WhatsApp Business de la cuenta. El motor lo verificará con Meta antes de crear.", "info");
  });
  /* Longitudes recomendadas: un aviso por texto distinto, no uno por anuncio. */
  const largos = {};
  const marcar = (tipo, t, lim, a) => { if (t.length <= lim) return; const k = tipo + "|" + t; (largos[k] = largos[k] || { tipo, t, lim, ads:[] }).ads.push(nombreAnuncio(a)); };
  S.anuncios.forEach(a => {
    if (esPublicacion(a)) return;
    limpios(a.textos).forEach(t => marcar("texto principal", t, 125, a));
    limpios(a.titulos).forEach(t => marcar("título", t, 40, a));
    if ((a.descripcion||"").trim()) marcar("descripción", a.descripcion.trim(), 30, a);
  });
  Object.values(largos).forEach(x => {
    const quien = x.ads.length === 1 ? 'el anuncio "' + x.ads[0] + '"' : x.ads.length + " anuncios";
    add(4, "Un " + x.tipo + " de " + x.t.length + " caracteres (\"" + x.t.slice(0, 32) + "…\") en " + quien + ": se muestra completo solo hasta unos " + x.lim + ".", "info");
  });
  conjuntosActivos().filter(k => k.modo === "NUEVO" && !S.anuncios.some(a => (a.conjuntoIds||[]).includes(k.id)))
    .forEach(k => add(4, 'El conjunto nuevo "' + nombreConjunto(k) + '" no tiene anuncios asignados: se creará vacío y el motor lo eliminará.', "revisar", "k:" + k.id));
  const nInst = instancias().length;
  if (nInst > 200) add(4, "El plan crea " + nInst + " anuncios. El motor admite 200 por envío por defecto (variable TOPE_ADS_POR_CORRIDA en n8n): súbela o divide el plan.");
  S.anuncios.forEach(a => {
    const claves = String(a.urlTags||"").split("&").map(x => x.split("=")[0]).filter(Boolean);
    const dup = claves.filter((k,i) => claves.indexOf(k) !== i);
    if (dup.length) add(4, 'Anuncio "' + nombreAnuncio(a) + '": el parámetro ' + dup[0] + ' está repetido en la URL.');
    if ((a.url||"").includes("utm_") && (a.urlTags||"").includes("utm_")) add(4, 'Anuncio "' + nombreAnuncio(a) + '": la URL ya trae UTM y además hay parámetros de URL; pueden quedar duplicados.');
  });
  (S.replicas || []).forEach(r => avisosReplica(r).forEach(t => add(5, t, "info")));
  /* Recomendaciones de Meta (5.3): se informan, no se imponen. */
  S.campanas.filter(c => c.modo === "NUEVA" && c.audienciaAdv === "ON" && conjuntosDe(c).some(k => k.modo === "NUEVO" && !k.copia && k.origen !== "CUENTA" && (+k.edadMax < 65 || +k.edadMin > 25)))
    .forEach(c => add(2, 'La campaña "' + nombreCampana(c) + '" usa Advantage+ audience y algún conjunto cierra la edad: Meta suele pedir la edad máxima en 65 (y mínima de hasta 25). Si la rechaza, el motor abre el rango y lo avisa.', "info"));
  S.campanas.filter(c => c.modo === "NUEVA" && c.audienciaAdv === "ON" && conjuntosDe(c).some(k => k.modo === "NUEVO" && (k.intereses.length || k.guardadas.length)))
    .forEach(c => add(2, 'La campaña "' + nombreCampana(c) + '" usa Advantage+ audience: los intereses y públicos de sus conjuntos funcionan como sugerencia y Meta puede mostrar los anuncios fuera de ellos. La ubicación geográfica y las exclusiones sí se respetan.'));
  S.campanas.filter(c => c.modo === "NUEVA" && c.ubicaciones === "AUTO" && S.creativos.some(cr => cr.tipo === "IMAGE" && (String(cr.archivoStories||"").trim() || (cr.local||{}).archivoStories)))
    .forEach(c => add(3, 'La campaña "' + nombreCampana(c) + '" usa ubicaciones Advantage+: la imagen de feed se usa también en Audience Network y Messenger.', "info"));
  if (S.anuncios.some(a => (a.preguntas||[]).filter(Boolean).length && (a.prellenado||"").trim()))
    add(4, "Hay anuncios de WhatsApp con preguntas frecuentes y mensaje prellenado: Meta usa uno u otro, y se enviarán las preguntas.", "info");
  if (S.anuncios.some(a => !esPublicacion(a) && destinosDelAnuncio(a).some(d => d !== "WEBSITE") && (limpios(a.textos).length > 1 || limpios(a.titulos).length > 1)))
    add(4, "Hay anuncios de WhatsApp o formulario con varias opciones de texto. Si Meta no las admite en ese formato, se publican con la primera y queda el aviso en la bitácora.", "info");
  return out;
}
const esPublicacion = a => { const cr = creativoDe(a); return !!cr && cr.tipo === "POST"; };

/* Todas las alertas del plan, por nivel: "bloquea" (impide enviar), "revisar", "info".
   Cada una sabe en qué paso se corrige. */
function alertas(){
  const out = [], vistos = new Set();
  for (let q = 0; q <= 4; q++) problemas(q).forEach(t => { if (!vistos.has(t)){ vistos.add(t); out.push({ paso:q, texto:t, nivel:"bloquea", ref: REFS[t] || "" }); } });
  problemas(5).forEach(t => { if (!vistos.has(t)){ vistos.add(t); out.push({ paso:/subiendo/.test(t) ? 3 : 5, texto:t, nivel:"bloquea", ref: REFS[t] || "" }); } });
  avisos().forEach(a => { if (!vistos.has(a.texto)){ vistos.add(a.texto); out.push(a); } });
  return out;
}

/* Configuración probada: copia exacta de un conjunto de WhatsApp que Meta ya
   aceptó en la cuenta. Fija el objetivo de la campaña al de ese conjunto. */
function aplicarConfig(c, x){
  if (!x){ c.cfgWA = null; return; }
  c.cfgWA = { id:x.id, n:x.n, objetivo:x.objetivo, config:x.config, campanaId:x.campanaId || "", cuenta:x.cuenta || "" };
  if (OBJETIVOS.some(o => o.v === x.objetivo)) c.objetivo = x.objetivo;
}
/* Sugiere la configuración de compras más reciente para campañas de WhatsApp
   que optimizan por compras y todavía no tienen una. Devuelve cuántas cambió. */
/* Clonar con /copies solo es posible dentro de la misma cuenta publicitaria. */
function clonable(c){ const cl = cliente(); return !!(c && c.cfgWA && c.cfgWA.campanaId && cl && (!c.cfgWA.cuenta || c.cfgWA.cuenta === cl.cuenta)); }
function sugerirConfigs(){
  const mejor = (S.configsWA || []).slice().sort((a, b) => (b.puntaje||0) - (a.puntaje||0)).find(x => x.compras);
  let n = 0;
  if (mejor) S.campanas.forEach(c => { if (c.modo === "NUEVA" && !c.importada && c.destino === "WHATSAPP" && c.meta === "MESSAGING_PURCHASE_CONVERSION" && !c.cfgWA){ aplicarConfig(c, mejor); n++; } });
  return n;
}
/* Corrige en un clic la combinación que Meta rechaza (Ventas + compras por mensajes). */
function corregirObjetivosWhatsApp(){
  let n = 0;
  S.campanas.forEach(c => { if (c.modo === "NUEVA" && c.destino === "WHATSAPP" && c.objetivo === "OUTCOME_SALES" && c.meta === "MESSAGING_PURCHASE_CONVERSION"){ c.objetivo = "OUTCOME_ENGAGEMENT"; n++; } });
  return n;
}

/* ------------------------------------------ carga de anuncios desde Excel */
/* Lee una tabla pegada desde Excel o Google Sheets (tabulaciones) o un CSV (coma o
   punto y coma, con comillas). La primera fila son los encabezados. */
function parsearTabla(texto){
  const t = String(texto || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").trim();
  if (!t) return [];
  const primera = t.split("\n")[0];
  const sep = primera.includes("\t") ? "\t" : (primera.split(";").length > primera.split(",").length ? ";" : ",");
  const filas = []; let fila = [], campo = "", comillas = false;
  for (let i = 0; i < t.length; i++){
    const ch = t[i];
    if (comillas){
      if (ch === '"' && t[i+1] === '"'){ campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"' && campo === "") comillas = true;
    else if (ch === sep){ fila.push(campo); campo = ""; }
    else if (ch === "\n"){ fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += ch;
  }
  fila.push(campo); filas.push(fila);
  const norm = h => String(h||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const enc = filas[0].map(norm);
  return filas.slice(1).filter(f => f.some(x => String(x).trim())).map(f => { const o = {}; enc.forEach((h, j) => { if (h) o[h] = String(f[j] == null ? "" : f[j]).trim(); }); return o; });
}
const ALIAS_TABLA = {
  nombre: ["nombre","nombre_anuncio","anuncio","ad_name","name"],
  archivo: ["archivo","imagen","creativo","url_imagen","image","image_url","video","url_video","media","feed"],
  stories: ["stories","vertical","9x16","imagen_stories","reels"],
  columna: ["columna","horizontal","191x1","columna_derecha"],
  formato: ["formato","tipo","type"],
  descripcion: ["descripcion","description"],
  boton: ["boton","cta","call_to_action"],
  url: ["url","destino","link","url_destino","landing"],
  utm: ["utm","utms","url_tags","parametros","parametros_url"],
  conjuntos: ["conjuntos","conjunto","adsets","adset"],
  saludo: ["saludo","whatsapp_saludo"],
  prellenado: ["prellenado","mensaje_prellenado","whatsapp_prellenado"],
  formulario: ["formulario","form","lead_form","formulario_id","id_formulario"],
  mejoras: ["mejoras","mejoras_automaticas","advantage_creative"],
};
const valorDe = (o, clave) => { for (const k of ALIAS_TABLA[clave]) if (o[k] != null && o[k] !== "") return o[k]; return ""; };
const variosDe = (o, base_, alias) => { const out = []; for (let i = 1; i <= 5; i++){ const v = o[base_ + i] || o[base_ + "_" + i]; if (v) out.push(v); } if (!out.length) alias.forEach(k => { if (o[k]) out.push(o[k]); }); return out.slice(0,5); };
/* Crea creativos y anuncios desde las filas. Devuelve {anuncios, creativos, errores}. */
function importarFilasAnuncios(filas){
  const rep = { anuncios:0, creativos:0, errores:[] };
  const activos = conjuntosActivos();
  const porArchivo = {}; S.creativos.forEach(c => { porArchivo[(c.archivo||"") + "|" + (c.archivoStories||"") + "|" + (c.archivoColumna||"")] = c; });
  const porNombreCr = {}; S.creativos.forEach((c, i) => { porNombreCr[nombreCreativo(c, i).toLowerCase()] = c; });
  const usados = new Set(S.anuncios.map(a => a.nombre.trim().toLowerCase()));
  filas.forEach((o, i) => {
    const n = "Fila " + (i + 2);
    const nombre = valorDe(o, "nombre");
    if (!nombre){ rep.errores.push(n + ": falta el nombre del anuncio."); return; }
    if (usados.has(nombre.toLowerCase())){ rep.errores.push(n + ': ya existe un anuncio llamado "' + nombre + '".'); return; }
    /* Primero se valida la fila completa; el creativo se crea solo si todo está bien. */
    const archivo = valorDe(o, "archivo");
    const existente = porNombreCr[archivo.toLowerCase()];
    if (!existente && !/^https?:\/\//i.test(archivo)){ rep.errores.push(n + ": la columna de imagen o video debe ser un enlace (https://…) o el nombre de un creativo existente."); return; }
    const stories = valorDe(o, "stories"), columna = valorDe(o, "columna");
    const textos = variosDe(o, "texto", ["texto","texto_principal","primary_text"]);
    const titulos = variosDe(o, "titulo", ["titulo","headline","title"]);
    if (!textos.length){ rep.errores.push(n + ": falta al menos un texto principal."); return; }
    let conjuntoIds;
    const cj = valorDe(o, "conjuntos");
    if (cj){
      const nombres = cj.split(/[;|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
      conjuntoIds = activos.filter(k => nombres.includes(nombreConjunto(k).toLowerCase())).map(k => k.id);
      const faltan = nombres.filter(x => !activos.some(k => nombreConjunto(k).toLowerCase() === x));
      if (faltan.length){ rep.errores.push(n + ": no existe el conjunto " + faltan.map(x => '"' + x + '"').join(", ") + " en el plan."); return; }
    } else conjuntoIds = activos.map(k => k.id);
    const fRaw = valorDe(o, "formulario");
    let formId = "";
    if (fRaw){
      const fx = (S.formularios||[]).find(x => x.id === fRaw || x.n.toLowerCase() === fRaw.toLowerCase());
      if (!fx && !/^\d{6,}$/.test(fRaw)){ rep.errores.push(n + ': no encontré el formulario "' + fRaw + '" en la página elegida.'); return; }
      formId = fx ? fx.id : fRaw;
    }
    const bRaw = valorDe(o, "boton");
    const cta = !bRaw ? "LEARN_MORE" : ((CTAS.find(c => c[0].toLowerCase() === bRaw.toLowerCase().replace(/\s+/g,"_") || c[1].toLowerCase() === bRaw.toLowerCase()) || [])[0] || "");
    if (bRaw && !cta){ rep.errores.push(n + ': el botón "' + bRaw + '" no existe. Usa uno de: ' + CTAS.map(c => c[1]).join(", ") + "."); return; }
    let cr = existente;
    if (!cr){
      const clave = archivo + "|" + stories + "|" + columna;
      cr = porArchivo[clave];
      if (!cr){
        cr = nuevoCreativo();
        const fmt = valorDe(o, "formato").toLowerCase();
        cr.tipo = /video/.test(fmt) || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(archivo) ? "VIDEO" : "IMAGE";
        cr.nombre = nombre; cr.archivo = archivo;
        if (cr.tipo === "IMAGE"){ cr.archivoStories = stories; cr.archivoColumna = columna; }
        S.creativos.push(cr); porArchivo[clave] = cr; rep.creativos++;
      }
    }
    const a = nuevoAnuncio();
    Object.assign(a, { nombre, creativoId: cr.id, conjuntoIds, textos, titulos: titulos.length ? titulos : [""],
      descripcion: valorDe(o, "descripcion"), url: valorDe(o, "url"), cta, urlTags: valorDe(o, "utm"),
      saludo: valorDe(o, "saludo"), prellenado: valorDe(o, "prellenado"), formId,
      mejoras: /^(off|no|apagad[ao]s?|sin)$/i.test(valorDe(o, "mejoras")) ? "OFF" : "META" });
    S.anuncios.push(a); usados.add(nombre.toLowerCase()); rep.anuncios++;
  });
  return rep;
}
const PLANTILLA_TABLA = ["nombre","imagen","stories","columna","formato","texto1","texto2","titulo1","titulo2","descripcion","boton","url","utm","conjuntos","saludo","prellenado","formulario","mejoras"];

/* ----------------------------------------------------- filas de salida */
/* Plataformas del conjunto según las ubicaciones de su campaña. Vacío = Advantage+ (Meta decide). */
function plataformasDe(c, cl){
  const ig = !!(cl && cl.ig), u = (c && c.modo === "NUEVA" && c.ubicaciones) || "FBIG";
  if (u === "AUTO") return "";
  if (u === "FB") return "facebook";
  if (u === "IG") return ig ? "instagram" : "facebook";
  return ig ? "facebook,instagram" : "facebook";
}
function generarFilas(){
  const cl = cliente();
  const keyCamp = c => c.modo === "EXISTENTE" ? "existente_" + c.metaId : "camp_" + c.id;
  const keyConj = k => k.modo === "EXISTENTE" ? "existente_adset_" + k.metaId : "adset_" + k.id;
  const paises = S.pais.cc ? [S.pais.cc] : [];

  const campaigns = S.campanas.filter(c => c.modo === "NUEVA").map(c => ({
    campaign_key: keyCamp(c), client_key: cl ? cl.key : "",
    name: nombreCampana(c), objective: c.objetivo, buying_type: "AUCTION",
    special_ad_categories: c.categoria === "NONE" ? "" : c.categoria,
    bid_strategy: c.puja || "",
    clonar_campana_de: c.destino === "WHATSAPP" && clonable(c) ? c.cfgWA.campanaId : "",
    /* La referencia viaja siempre: el motor decide si puede clonar (misma cuenta) o no. */
    referencia_conjunto: c.modo === "NUEVA" && !c.importada && c.destino === "WHATSAPP" && c.cfgWA ? c.cfgWA.id : "",
    budget_level: c.presupuestoEn,
    /* ABO: si los conjuntos comparten hasta 20 % de su presupuesto (Meta, v26). */
    compartir_presupuesto: c.presupuestoEn === "ADSET" && c.compartir === "SI" ? "SI" : "NO",
    /* WhatsApp: el motor respeta el objetivo del plan salvo que se permita cambiarlo. */
    wa_cambiar_objetivo: c.destino === "WHATSAPP" && c.waCambiaObjetivo ? "SI" : "NO",
    daily_budget: c.presupuestoEn === "CAMPAIGN" && c.tipoMonto === "DAILY" ? c.monto : "",
    lifetime_budget: c.presupuestoEn === "CAMPAIGN" && c.tipoMonto === "LIFETIME" ? c.monto : "",
    start_time: c.inicio ? c.inicio + " 06:00" : "",
    stop_time: c.fin ? c.fin + " 23:59" : "",
    status: "PAUSED",
  }));

  const adsets = S.conjuntos.filter(k => k.modo === "NUEVO").map(k => {
    const c = campanaDe(k) || {};
    const enConjunto = llevaPresupuestoConjunto(c);
    const cfg = (c.modo === "NUEVA" && !k.copia && c.destino === "WHATSAPP" && c.cfgWA) ? c.cfgWA.config : null;
    const meta = cfg ? String(cfg.optimization_goal || c.meta) : ((c.modo === "EXISTENTE" || k.copia) ? k.meta : c.meta);
    const wa = destinoDe(k) === "WHATSAPP";
    const form = destinoDe(k) === "FORMULARIO";
    const cuenta = k.origen === "CUENTA";
    const rest = restringida(c);
    const radio = k.radio > 0 ? ":" + k.radio : "";
    return {
      adset_key: keyConj(k), campaign_key: keyCamp(c),
      campaign_id: c.modo === "EXISTENTE" ? c.metaId : "",
      saved_audience_id: cuenta && k.cuenta[0] ? k.cuenta[0].id : "",
      name: nombreConjunto(k),
      optimization_goal: meta, billing_event: "IMPRESSIONS",
      destination_type: wa ? "WHATSAPP" : (form ? "ON_AD" : "WEBSITE"),
      whatsapp_phone_number: wa ? (whatsappDe(k)||"") : "",
      messaging_dataset_id: wa ? datasetWA(propioDe(k) ? k : c) : "",
      promoted_object_type: wa ? "WHATSAPP" : form ? "PAGE" : (["OFFSITE_CONVERSIONS","VALUE"].includes(meta) ? "PIXEL" : "NONE"),
      /* El píxel solo acompaña a conversiones del sitio web (con o sin WhatsApp); nunca a compras por mensajes. */
      pixel_id: ["OFFSITE_CONVERSIONS","VALUE"].includes(meta) ? (cl ? cl.pixel : "") : "",
      custom_event_type: meta === "MESSAGING_PURCHASE_CONVERSION" ? "PURCHASE"
        : (["OFFSITE_CONVERSIONS","VALUE"].includes(meta) ? ((c.modo === "EXISTENTE" || k.copia) ? (k.evento||"PURCHASE") : c.evento) : ""),
      targeting_json: k.copia && k.targeting ? JSON.stringify(k.targeting) : "",
      config_json: cfg ? JSON.stringify(cfg) : "",
      clonar_conjunto_de: cfg && clonable(c) ? c.cfgWA.id : "",
      bid_amount: k.copia && Number(k.pujaMonto) ? k.pujaMonto : "",
      daily_budget: enConjunto && (c.modo === "EXISTENTE" || c.tipoMonto === "DAILY") ? k.presupuesto : "",
      lifetime_budget: enConjunto && c.modo !== "EXISTENTE" && c.tipoMonto === "LIFETIME" ? k.presupuesto : "",
      start_time: c.modo !== "EXISTENTE" && c.inicio ? c.inicio + " 06:00" : "",
      end_time: enConjunto && c.modo !== "EXISTENTE" && c.tipoMonto === "LIFETIME" && c.fin ? c.fin + " 23:59" : "",
      countries: cuenta || k.copia ? "" : paises.join(","),
      region_keys: cuenta ? "" : k.regiones.map(x=>x.id).join(","),
      city_keys: cuenta ? "" : k.ciudades.map(x=>x.id + radio).join(","),
      age_min: cuenta ? "" : (rest ? 18 : k.edadMin),
      age_max: cuenta ? "" : (rest ? 65 : k.edadMax),
      genders: cuenta ? "" : (rest ? "ALL" : k.genero),
      interest_ids: cuenta || rest ? "" : k.intereses.map(x=>x.id).join(","),
      custom_audience_ids: cuenta ? "" : k.guardadas.map(x=>x.id).join(","),
      excluded_audience_ids: cuenta || rest ? "" : k.excluidas.map(x=>x.id).join(","),
      publisher_platforms: plataformasDe(c, cl),
      advantage_audience: c.modo === "NUEVA" && c.audienciaAdv === "ON" ? "ON" : "OFF", status: "PAUSED",
    };
  });

  const refDe = (cr, i) => slug(nombreCreativo(cr, i));
  const tiene = (cr, campo) => { const l = (cr.local||{})[campo]; return (l && (l.data || l.hash || l.video_id)) || String(cr[campo]||"").trim(); };
  const ads = [];
  instancias().forEach(({a, k, c}) => {
    const i = S.creativos.findIndex(x => x.id === a.creativoId);
    const cr = S.creativos[i]; if (!cr) return;
    const ref = cr.tipo === "POST" ? "" : refDe(cr, i);
    ads.push({
      ad_key: keyConj(k) + "__" + slug(nombreAnuncio(a)),
      adset_key: keyConj(k),
      adset_id: k.modo === "EXISTENTE" ? k.metaId : "",
      campaign_key: keyCamp(c), campaign_id: c.modo === "EXISTENTE" ? c.metaId : "",
      name: nombreAnuncio(a),
      creative_type: cr.tipo === "POST" ? "EXISTING_POST" : cr.tipo, asset_ref: ref,
      post_id: cr.tipo === "POST" && cr.post ? cr.post.id : "", post_origen: cr.tipo === "POST" && cr.post ? cr.post.origen : "",
      asset_ref_9x16: cr.tipo === "IMAGE" && tiene(cr, "archivoStories") ? ref + "__9x16" : "",
      asset_ref_191x1: cr.tipo === "IMAGE" && tiene(cr, "archivoColumna") ? ref + "__191x1" : "",
      primary_text: limpios(a.textos)[0] || "", headline: limpios(a.titulos)[0] || "",
      primary_texts: limpios(a.textos).join(" || "), headlines: limpios(a.titulos).join(" || "),
      description: (a.descripcion||"").trim(),
      destino: destinoConjunto(k),
      cta_type: destinoConjunto(k) === "WHATSAPP" ? "WHATSAPP_MESSAGE" : a.cta,
      link_url: destinoConjunto(k) === "WEBSITE" ? (a.url||"").trim() : "",
      lead_form_id: destinoConjunto(k) === "FORMULARIO" ? String(a.formId || "") : "",
      whatsapp_greeting: a.secuencia ? "" : (a.saludo||"").trim(), whatsapp_autofill: a.secuencia ? "" : (a.prellenado||"").trim(),
      whatsapp_icebreakers: a.secuencia ? "" : limpios(a.preguntas).join(" || "), whatsapp_sequence_id: a.secuencia || "",
      tracking_pixel_id: a.trackPixel || "", tracking_dataset_id: a.trackDataset || "",
      url_tags: a.urlTags || "",
      mejoras: a.mejoras === "OFF" ? "OFF" : "META",
      status: "PAUSED",
    });
  });

  const usados = new Set(ads.filter(x => x.asset_ref).map(x => x.asset_ref.replace(/__9x16$|__191x1$/,"")));
  const assets = [];
  S.creativos.forEach((cr, i) => {
    if (cr.tipo === "POST") return;
    const ref = refDe(cr, i); if (!usados.has(ref)) return;
    const loc = cr.local||{};
    const fuente = (campo, suf) => {
      const l = loc[campo];
      /* Ya subidos a la cuenta desde el navegador: solo viaja el identificador. */
      if (l && l.hash) return { source_url:"", image_hash:l.hash, file_name: ref + suf + ".jpg" };
      if (l && l.video_id) return { source_url:"", video_id:l.video_id, file_name: ref + suf + ".mp4" };
      if (l && l.data) return { source_url:"", source_data:l.data, source_mime:l.mime, file_name: ref + suf + (l.mime === "image/png" ? ".png" : ".jpg") };
      return { source_url: String(cr[campo]||"").trim(), file_name: ref + suf + (cr.tipo === "VIDEO" ? ".mp4" : ".jpg") };
    };
    assets.push(Object.assign({ asset_ref: ref, type: cr.tipo === "VIDEO" ? "VIDEO" : "IMAGE", ratio:"feed" }, fuente("archivo","")));
    if (cr.tipo === "IMAGE" && tiene(cr, "archivoStories")) assets.push(Object.assign({ asset_ref: ref + "__9x16", type:"IMAGE", ratio:"9x16" }, fuente("archivoStories","_9x16")));
    if (cr.tipo === "IMAGE" && tiene(cr, "archivoColumna")) assets.push(Object.assign({ asset_ref: ref + "__191x1", type:"IMAGE", ratio:"191x1" }, fuente("archivoColumna","_191x1")));
  });

  return { campaigns, adsets, ads, assets };
}

/* ------------------------------------------ publicar en varias cuentas (5.2) */
/* Una réplica es el mismo plan publicado en otra cuenta publicitaria: solo las
   campañas NUEVAS; cada cuenta usa su píxel; las imágenes y videos se copian
   desde la cuenta principal; los públicos se buscan por nombre en la de destino. */
const cuentaPorId = id => S.cuentas.find(c => String(c.cuenta) === String(id)) || null;
function problemasReplica(r){
  const p = [], cl = cliente(), d = cuentaPorId(r.cuenta);
  const et = "Réplica en " + (d ? d.nombre : r.cuenta) + ": ";
  if (!d){ p.push(et + "la cuenta ya no está disponible para el token."); return p; }
  if (cl && d.moneda !== cl.moneda) p.push(et + "la cuenta usa " + d.moneda + " y el plan está en " + cl.moneda + ". Solo se replica en cuentas con la misma moneda.");
  if (!S.campanas.some(c => c.modo === "NUEVA")) p.push(et + "el plan no tiene campañas nuevas; las existentes no se replican.");
  const pagina = r.pageId || S.pageId;
  const conv = S.campanas.some(c => c.modo === "NUEVA" && ["OFFSITE_CONVERSIONS","VALUE"].includes(c.meta))
    || S.conjuntos.some(k => k.modo === "NUEVO" && (campanaDe(k)||{}).modo === "NUEVA" && ["OFFSITE_CONVERSIONS","VALUE"].includes(metaDe(k)));
  if (conv && !d.pixel) p.push(et + "la cuenta no tiene píxel y el plan optimiza por conversiones del sitio web.");
  if (pagina !== S.pageId){
    if (S.anuncios.some(a => destinosDelAnuncio(a).includes("FORMULARIO"))) p.push(et + "usa otra página y el plan tiene formularios, que pertenecen a la página principal. Usa la misma página o quita la réplica.");
    if (S.anuncios.some(a => esPublicacion(a))) p.push(et + "usa otra página y el plan tiene publicaciones existentes de la página principal.");
  }
  if (S.creativos.some(cr => Object.values(cr.local||{}).some(l => l && l.data && !l.hash))) p.push(et + "hay imágenes guardadas dentro del borrador sin subir a la cuenta: vuelve a subirlas.");
  return p;
}
function avisosReplica(r){
  const out = [], d = cuentaPorId(r.cuenta); if (!d) return out;
  const nExist = S.campanas.filter(c => c.modo === "EXISTENTE").length;
  const et = "Réplica en " + d.nombre + ": ";
  if (nExist) out.push(et + nExist + (nExist === 1 ? " campaña existente no se replica" : " campañas existentes no se replican") + " (solo las nuevas).");
  if (S.anuncios.some(a => a.trackDataset)) out.push(et + "el conjunto de datos offline es de la cuenta principal; en la réplica no se registra.");
  if (S.campanas.some(c => c.modo === "NUEVA" && c.cfgWA)) out.push(et + "la referencia de WhatsApp se copia por valores (Meta solo clona dentro de la misma cuenta).");
  if (S.conjuntos.some(k => k.modo === "NUEVO" && (k.guardadas.length || k.excluidas.length || k.origen === "CUENTA"))) out.push(et + "los públicos personalizados se buscan por nombre en la cuenta; los que no existan se quitan.");
  return out;
}
function generarFilasReplica(r){
  const f = generarFilas(), d = cuentaPorId(r.cuenta) || {}, cl = cliente() || {};
  const campanas = f.campaigns.map(c => Object.assign({}, c, { clonar_campana_de: "" }));
  const claves = new Set(campanas.map(c => c.campaign_key));
  const adsets = f.adsets.filter(a => claves.has(a.campaign_key) && !a.campaign_id).map(a => {
    const k = S.conjuntos.find(x => "adset_" + x.id === a.adset_key) || {};
    return Object.assign({}, a, { clonar_conjunto_de: "", pixel_id: a.pixel_id ? (d.pixel || "") : "",
      custom_audiences_json: JSON.stringify((k.guardadas || []).map(x => ({ id: x.id, name: x.n }))),
      excluded_audiences_json: JSON.stringify((k.excluidas || []).map(x => ({ id: x.id, name: x.n }))) });
  });
  const conjuntos = new Set(adsets.map(a => a.adset_key));
  const ads = f.ads.filter(x => conjuntos.has(x.adset_key) && !x.adset_id && !x.campaign_id)
    .map(x => Object.assign({}, x, { tracking_pixel_id: x.tracking_pixel_id ? (d.pixel || "") : "", tracking_dataset_id: "" }));
  const refs = new Set(ads.map(x => x.asset_ref).concat(ads.map(x => x.asset_ref_9x16), ads.map(x => x.asset_ref_191x1)).filter(Boolean));
  const assets = f.assets.filter(a => refs.has(a.asset_ref)).map(a => Object.assign({}, a,
    a.image_hash ? { hash_cuenta: cl.cuenta } : {}, a.video_id ? { video_cuenta: cl.cuenta } : {}));
  return { campaigns: campanas, adsets, ads, assets };
}

/* ----------------------------------------------- importación entre cuentas */
/* Convierte un paquete del motor (tipo "importar") en campañas, conjuntos,
   creativos y anuncios del plan. Los creativos se deduplican por archivo, y los
   anuncios idénticos en varios conjuntos se funden en uno con varios conjuntos. */
function sumarDias(fecha, n){ const d = new Date(fecha + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); }
function importarPaquete(paq){
  const rep = { campanas:0, conjuntos:0, anuncios:0, creativos:0, avisos:(paq.avisos||[]).slice() };
  const crPorArchivo = {};
  S.creativos.forEach(c => { const k = c.tipo + "|" + c.archivo + "|" + (c.archivoStories||"") + "|" + (c.archivoColumna||""); crPorArchivo[k] = c; });
  const firmaAd = x => JSON.stringify([x.nombre, x.creativoId, x.textos, x.titulos, x.descripcion, x.url, x.cta, x.saludo, x.prellenado, x.preguntas, x.secuencia, x.formId]);
  (paq.campanas || []).forEach(pc => {
    if (!OBJETIVOS.some(o => o.v === pc.objetivo)){ rep.avisos.push('La campaña "' + pc.nombre + '" tiene el objetivo ' + pc.objetivo + ', que la herramienta aún no crea. No se importó.'); return; }
    const c = nuevaCampana();
    Object.assign(c, { nombreLibre: pc.nombre, importada: (paq.origen && paq.origen.nombre) || "otra cuenta", objetivo: pc.objetivo,
      categoria: (pc.categorias && pc.categorias[0]) || "NONE", presupuestoEn: pc.cbo ? "CAMPAIGN" : "ADSET",
      tipoMonto: pc.total ? "LIFETIME" : "DAILY", monto: pc.cbo ? String(pc.diario || pc.total || "") : "",
      inicio: hoy(), fin: pc.total && pc.duracionDias ? sumarDias(hoy(), pc.duracionDias) : "",
      puja: PUJAS_CON_IMPORTE.includes(pc.puja) ? pc.puja : "", compartir: pc.compartir ? "SI" : "NO" });
    const k0 = (pc.conjuntos || [])[0];
    if (k0){ c.meta = k0.meta || c.meta; c.destino = k0.destino || "WEBSITE"; c.whatsapp = k0.whatsapp || ""; c.evento = k0.evento || c.evento; }
    S.campanas.push(c); rep.campanas++;
    const adsDeEsta = [];
    (pc.conjuntos || []).forEach(pk => {
      const k = nuevoConjunto(c.id);
      let nk = String(pk.nombre || "Conjunto"), ik = 2; const baseK = nk;
      while (conjuntosDe(c).some(x => x.nombre === nk)) nk = baseK + " (" + ik++ + ")";
      Object.assign(k, { copia:true, nombre: nk, targeting: pk.targeting, meta: pk.meta, evento: pk.evento || "",
        destino: pk.destino || "WEBSITE", whatsapp: pk.whatsapp || "",
        presupuesto: pc.cbo ? "" : String(pk.diario || pk.total || ""), pujaMonto: pk.pujaMonto ? String(pk.pujaMonto) : "" });
      S.conjuntos.push(k); rep.conjuntos++;
      (pk.anuncios || []).forEach(pa => {
        const m = pa.media || {};
        const archivo = m.tipo === "VIDEO" ? (m.url || "") : (m.urlFeed || "");
        const clave = (m.tipo === "VIDEO" ? "VIDEO" : "IMAGE") + "|" + archivo + "|" + (m.urlVert || "") + "|" + (m.urlHoriz || "");
        let cr = crPorArchivo[clave];
        if (!cr){
          cr = nuevoCreativo();
          Object.assign(cr, { nombre: pa.nombre, tipo: m.tipo === "VIDEO" ? "VIDEO" : "IMAGE", archivo, archivoStories: m.urlVert || "", archivoColumna: m.urlHoriz || "" });
          S.creativos.push(cr); crPorArchivo[clave] = cr; rep.creativos++;
        }
        const x = { nombre: pa.nombre, creativoId: cr.id, textos: (pa.textos||[]).slice(0,5), titulos: (pa.titulos||[]).slice(0,5), formId: pa.formulario || "",
          descripcion: pa.descripcion || "", url: pa.url || "", cta: pa.whatsapp ? "LEARN_MORE" : (pa.cta || "LEARN_MORE"),
          saludo: pa.saludo || "", prellenado: pa.prellenado || "", preguntas: (pa.preguntas||[]).slice(0,4), secuencia: pa.secuencia || "" };
        const f = firmaAd(x);
        const igual = adsDeEsta.find(y => y.firma === f);
        if (igual){ if (!igual.a.conjuntoIds.includes(k.id)) igual.a.conjuntoIds.push(k.id); return; }
        const a = nuevoAnuncio();
        Object.assign(a, x, { conjuntoIds:[k.id], urlTags: pa.url_tags || "" });
        if (!a.textos.length) a.textos = [""]; if (!a.titulos.length) a.titulos = [""];
        adsDeEsta.push({ firma: f, a }); rep.anuncios++;
      });
    });
    /* Nombres de anuncio únicos en todo el plan. */
    const usados = new Set(S.anuncios.map(a => a.nombre.trim()));
    adsDeEsta.forEach(({ a }) => { let n = a.nombre.trim() || "Anuncio", base = n, i = 2; while (usados.has(n)) n = base + " (" + i++ + ")"; a.nombre = n; usados.add(n); S.anuncios.push(a); });
  });
  return rep;
}

/* ------------------------------------------------- borrador: (de)serializar */
/* Identificador de lote: estable durante todo el plan (también al reenviar),
   nuevo al empezar otro plan. El motor lo usa para no duplicar en Meta. */
function asegurarLote(){ if (!S.loteId) S.loteId = new Date().toISOString().slice(0,10).replace(/-/g,"") + "_" + uid() + uid(); return S.loteId; }
function serializarBorrador(){
  return { v:3, guardado:new Date().toISOString(), clienteKey:S.clienteKey, pageId:S.pageId, pais:S.pais, loteId:S.loteId, loteEnviado:!!S.loteEnviado, replicas:S.replicas,
    campanas:S.campanas, conjuntos:S.conjuntos, creativos:S.creativos, anuncios:S.anuncios };
}
function cargarBorrador(d){
  if (!d || d.v !== 3) throw new Error("Este borrador es de una versión anterior y no se puede abrir aquí.");
  S.clienteKey = d.clienteKey||""; S.pageId = d.pageId||""; S.pais = d.pais||{cc:"",n:""}; S.loteId = d.loteId || ""; S.loteEnviado = !!d.loteEnviado; S.replicas = d.replicas || [];
  S.campanas = d.campanas||[]; S.conjuntos = d.conjuntos||[]; S.creativos = d.creativos||[]; S.anuncios = d.anuncios||[];
  S.creativos.forEach(c => { c.local = c.local||{};
    Object.values(c.local).forEach(l => { if (l && l.subiendo){ l.subiendo = false; l.fallo = "la subida se interrumpió al cerrar la página"; } }); });
  S.campanas.forEach(c => { c.destino = c.destino || "WEBSITE"; c.whatsapp = c.whatsapp || ""; c.datasetMsg = c.datasetMsg || "";
    c.compartir = c.compartir || "NO"; c.ubicaciones = c.ubicaciones || "FBIG"; c.audienciaAdv = c.audienciaAdv || "OFF";
    if (c.destino === "WHATSAPP" && c.objetivo === "OUTCOME_SALES" && c.meta === "MESSAGING_PURCHASE_CONVERSION") c.objetivo = "OUTCOME_ENGAGEMENT"; });
  S.conjuntos.forEach(k => { k.destino = k.destino || "WEBSITE"; k.whatsapp = k.whatsapp || ""; k.datasetMsg = k.datasetMsg || ""; k.copia = !!k.copia; });
  S.anuncios.forEach(a => {
    a.mejoras = a.mejoras || "META";
    a.saludo = a.saludo || ""; a.prellenado = a.prellenado || ""; a.preguntas = a.preguntas || []; a.secuencia = a.secuencia || ""; a.plantilla = a.plantilla || ""; a.formId = a.formId || "";
    if (a.trackPixel === undefined) a.trackPixel = ""; if (a.trackDataset === undefined) a.trackDataset = "";
    if (!a.textos){ const cr = S.creativos.find(c => c.id === a.creativoId) || {};
      a.textos = [cr.texto||""]; a.titulos = [cr.titulo||""]; a.descripcion = cr.descripcion||""; a.cta = cr.cta||"LEARN_MORE"; a.url = cr.url||""; }
  });
  S.campanas.forEach(c => { c.conjuntosCargados = c.modo === "EXISTENTE" ? conjuntosDe(c).some(k => k.modo === "EXISTENTE") : true; });
}

if (typeof module !== "undefined") module.exports = { S, OBJETIVOS, CATEGORIAS, CTAS, nuevaCampana, campanaExistente, nuevoConjunto,
  conjuntoExistente, nuevoCreativo, nuevoAnuncio, problemas, generarFilas, instancias, nombreCampana, nombreConjunto,
  nombreCreativo, nombreAnuncio, serializarBorrador, cargarBorrador, slug, inversion, avisos, importarPaquete, asegurarLote, aplicarConfig, sugerirConfigs, clonable, parsearTabla, importarFilasAnuncios, PLANTILLA_TABLA,
  datasetWA, esComprasWA, METAS_FORM, CTAS_FORM, DESTINOS, UBICACIONES, MEJORAS, plataformasDe, destinosDelAnuncio, formularioPorId, alertas, esPublicacion, generarFilasReplica, problemasReplica, cuentaPorId };
