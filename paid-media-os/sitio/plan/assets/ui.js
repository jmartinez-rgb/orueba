/* =====================================================================
   Meta Bulk Editor · componentes de interfaz — sitio 5.5
   Iconos, avisos flotantes, centro de alertas, ventana modal,
   formularios y leads, publicaciones existentes, progreso y resultados.
   Se carga antes de app.js: aquí solo hay funciones; nada corre al cargar.
   ===================================================================== */

/* ---------------------------------------------------------------- iconos */
const ICO = {
  imagen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-7 8"/></svg>',
  video:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  web:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  wa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.5 9.5c.3 1.6 1.4 3.2 3 4 .5.2 1 0 1.3-.4l.4-.5 1.6.8c-.2 1-1.1 1.6-2.1 1.5-2.8-.4-5-2.6-5.4-5.4-.1-1 .5-1.9 1.5-2.1l.8 1.6-.5.4c-.4.3-.6.8-.4 1.3"/></svg>',
  form:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  alerta:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/></svg>',
  ok:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  fb:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1 1-1h1.8V3h-2.6C11.4 3 11 5 11 6.5v2H9v3h2V21h3v-9.5h2.5l.4-3z"/></svg>',
  ig:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor"/></svg>',
  bajar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  hoja:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/></svg>',
  guardar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
  abrir:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7h6l2 2h10v10H3z"/></svg>',
  grafica:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  reloj:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  escudo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
};
const icono = (n, cls) => `<span class="ico ${cls||""}" aria-hidden="true">${ICO[n] || ""}</span>`;
const ICONO_DESTINO = { WEBSITE:"web", WHATSAPP:"wa", FORMULARIO:"form" };

/* ------------------------------------------------------------- avisos flotantes */
function toast(texto, tipo){
  let box = document.getElementById("toasts");
  if (!box){ box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + (tipo || "ok");
  t.innerHTML = icono(tipo === "stop" ? "stop" : tipo === "warn" ? "alerta" : "ok") + `<span>${esc(texto)}</span>`;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, tipo === "stop" ? 7000 : 4200);
}

/* ------------------------------------------------------------- centro de alertas */
const NIVELES = [
  { v:"bloquea", t:"Impiden enviar", ico:"stop" },
  { v:"revisar", t:"Conviene revisar", ico:"alerta" },
  { v:"info",    t:"Para tener en cuenta", ico:"info" },
];
const PASO_NOMBRE = i => (PASOS[i] || {t:"Revisión"}).t;
/* lista: [{nivel, paso, texto}] · opciones: {max, compacto, sinSaltos} */
function alertasHTML(lista, opciones){
  const o = Object.assign({ max: 99, compacto: false, sinSaltos: false }, opciones || {});
  if (!lista.length) return `<div class="al-vacio">${icono("ok")} Sin alertas.</div>`;
  return NIVELES.map(n => {
    const xs = lista.filter(a => a.nivel === n.v); if (!xs.length) return "";
    const vis = xs.slice(0, o.max);
    return `<section class="al-grupo ${n.v}">
      <header>${icono(n.ico)}<b>${n.t}</b><span class="al-n">${xs.length}</span></header>
      <ul>${vis.map(a => `<li>${o.sinSaltos || a.paso == null ? "" : `<button type="button" class="al-ir" data-ir-paso="${a.paso}" ${a.ref ? `data-ir-ref="${esc(a.ref)}"` : ""} title="${a.ref ? "Ir al elemento" : "Ir a " + esc(PASO_NOMBRE(a.paso))}">${esc(PASO_NOMBRE(a.paso))}${a.ref ? " ›" : ""}</button>`}<span>${esc(a.texto)}</span></li>`).join("")}</ul>
      ${xs.length > vis.length ? `<button type="button" class="btn link al-mas" data-ver-alertas>y ${xs.length - vis.length} más…</button>` : ""}
    </section>`;
  }).join("");
}
function ligarAlertas(root){
  (root || document).querySelectorAll("[data-ir-paso]").forEach(b => b.onclick = () => {
    const p = +b.dataset.irPaso; cerrarModal();
    if (S.enviando) return;
    S.enviado = ""; S.falloEnvio = "";
    S.paso = Math.min(p, 5); S.verTodos = false; render();
    if (b.dataset.irRef) irAElemento(b.dataset.irRef);
  });
  (root || document).querySelectorAll("[data-ver-alertas]").forEach(b => b.onclick = () => abrirModal("alertas"));
}
/* ------------------------------------------------ alertas por elemento (5.4) */
/* Cada alerta con ref ("c:", "k:", "cr:", "a:" + id) se muestra dentro de su tarjeta y la marca.
   Se recalcula en cada cambio (mensajes) sin tocar el campo que se está editando. */
const ATRIB_REF = { c:"data-c", k:"data-k", cr:"data-cr", a:"data-a" };
function elementoDeRef(ref){
  const i = String(ref || "").indexOf(":"); if (i < 0) return null;
  const at = ATRIB_REF[ref.slice(0, i)], id = ref.slice(i + 1);
  if (!at || typeof view === "undefined" || !view) return null;
  return Array.from(view.querySelectorAll("[" + at + "]")).find(el => el.getAttribute(at) === id && el.classList.contains("item")) || null;
}
/* Dentro de la tarjeta sobra repetir de quién es la alerta. */
function sinPrefijo(t, ref){
  let x = String(t).replace(/^(Campaña|Anuncio) \d+: /, "").replace(/^Conjunto "[^"]*" \([^)]*\): /, "");
  if (/^cr:/.test(ref)) x = x.replace(/^[^:]{1,90}: /, "");
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function marcarElementos(){
  if (typeof view === "undefined" || !view) return;
  view.querySelectorAll(".item-al").forEach(x => x.remove());
  view.querySelectorAll(".item.al-bloquea, .item.al-revisar").forEach(x => x.classList.remove("al-bloquea", "al-revisar"));
  if (!S.clienteKey || S.modo === "gestor") return;
  const porRef = {};
  /* Solo lo que se corrige en este paso o en uno anterior: lo de pasos futuros aún no se llena. */
  alertas().forEach(a => { if (a.ref && a.nivel !== "info" && (a.paso == null || a.paso <= S.paso)) (porRef[a.ref] = porRef[a.ref] || []).push(a); });
  Object.keys(porRef).forEach(ref => {
    const el = elementoDeRef(ref); if (!el) return;
    const xs = porRef[ref], bloq = xs.some(a => a.nivel === "bloquea");
    el.classList.add(bloq ? "al-bloquea" : "al-revisar");
    const d = document.createElement("div");
    d.className = "item-al " + (bloq ? "bloquea" : "revisar");
    d.innerHTML = icono(bloq ? "stop" : "alerta") + `<div><b>${bloq ? (xs.length === 1 ? "Falta resolver" : "Faltan " + xs.length + " cosas") : "Conviene revisar"}</b><ul>${xs.slice(0, 4).map(a => `<li>${esc(sinPrefijo(a.texto, ref))}</li>`).join("")}${xs.length > 4 ? `<li>y ${xs.length - 4} más</li>` : ""}</ul></div>`;
    const head = el.querySelector(":scope > .head");
    if (head) head.after(d); else el.prepend(d);
  });
}
/* Tarjetas plegables (5.4): con muchos anuncios o conjuntos, cada tarjeta se contrae a su
   encabezado. El estado vive en memoria mientras dura la sesión. */
const PLEGADAS = new Set();
function idDeItem(el){ for (const at of Object.values(ATRIB_REF)) if (el.hasAttribute(at)) return at + ":" + el.getAttribute(at); return ""; }
function ligarPlegables(){
  if (typeof view === "undefined" || !view) return;
  const items = Array.from(view.querySelectorAll(".item")).filter(el => idDeItem(el) && el.querySelector(":scope > .head") && el.querySelector(":scope > .inner"));
  items.forEach(el => {
    const id = idDeItem(el), head = el.querySelector(":scope > .head");
    el.classList.toggle("plegada", PLEGADAS.has(id));
    if (head.querySelector("[data-plegar]")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn link plegar"; b.dataset.plegar = "1";
    b.setAttribute("aria-label", "Contraer o expandir");
    b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    b.onclick = ev => { ev.stopPropagation(); if (PLEGADAS.has(id)) PLEGADAS.delete(id); else PLEGADAS.add(id); el.classList.toggle("plegada", PLEGADAS.has(id)); };
    head.appendChild(b);
  });
  /* Control general cuando hay más de 2 tarjetas en el paso. */
  const ey = view.querySelector(".eyebrow");
  if (ey && items.length > 2 && !view.querySelector("[data-plegar-todo]")){
    const todas = items.every(el => PLEGADAS.has(idDeItem(el)));
    const t = document.createElement("button");
    t.type = "button"; t.className = "btn link plegar-todo"; t.dataset.plegarTodo = "1";
    t.textContent = todas ? "Expandir todas las tarjetas" : "Contraer todas las tarjetas";
    t.onclick = () => { const cerrar = !items.every(el => PLEGADAS.has(idDeItem(el)));
      items.forEach(el => { const id = idDeItem(el); if (cerrar) PLEGADAS.add(id); else PLEGADAS.delete(id); el.classList.toggle("plegada", cerrar); });
      t.textContent = cerrar ? "Expandir todas las tarjetas" : "Contraer todas las tarjetas"; };
    ey.appendChild(t);
  }
}
/* Lleva al elemento de una alerta: lo centra en pantalla y lo resalta un momento. */
function irAElemento(ref){
  const el = elementoDeRef(ref); if (!el) return;
  if (el.classList.contains("plegada")){ PLEGADAS.delete(ref.replace(/^c:/, "data-c:").replace(/^k:/, "data-k:").replace(/^cr:/, "data-cr:").replace(/^a:/, "data-a:")); el.classList.remove("plegada"); }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("destello"); void el.offsetWidth; el.classList.add("destello");
  const campos = Array.from(el.querySelectorAll(".inner input:not([disabled]):not([type=checkbox]):not([type=radio]):not([type=file]), .inner textarea"));
  const campo = campos.find(x => !String(x.value || "").trim()) || campos[0];
  if (campo) setTimeout(() => { try { campo.focus({ preventScroll: true }); } catch (e) {} }, 350);
}

/* Pendientes por paso, para el indicador del encabezado. */
function pendientesPorPaso(){
  const n = [0,0,0,0,0,0];
  alertas().forEach(a => { if (a.nivel === "bloquea" && a.paso <= 5) n[a.paso]++; });
  return n;
}

/* ------------------------------------------------------------------ modal */
const MODAL = { abierto:"" };
function abrirModal(cual){ MODAL.abierto = cual; pintarModal(); }
function cerrarModal(){ if (!MODAL.abierto) return; MODAL.abierto = ""; pintarModal(); }
function pintarModal(){
  let m = document.getElementById("modal");
  if (!MODAL.abierto){ if (m) m.remove(); document.body.classList.remove("con-modal"); return; }
  if (!m){
    m = document.createElement("div"); m.id = "modal"; m.className = "modal";
    m.innerHTML = `<div class="modal-fondo" data-cerrar-modal></div><div class="modal-caja" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(m);
    m.querySelector("[data-cerrar-modal]").onclick = cerrarModal;
  }
  document.body.classList.add("con-modal");
  const caja = m.querySelector(".modal-caja");
  const scroll = caja.querySelector(".modal-cuerpo") ? caja.querySelector(".modal-cuerpo").scrollTop : 0;
  const def = MODALES[MODAL.abierto] || MODALES.alertas;
  const [titulo, sub, cuerpo] = def[0]();
  caja.innerHTML = `<header class="modal-h"><div><h2>${titulo}</h2><p>${sub}</p></div><button type="button" class="btn link ico-btn" data-x aria-label="Cerrar">${icono("x")}</button></header><div class="modal-cuerpo">${cuerpo}</div>`;
  caja.querySelector("[data-x]").onclick = cerrarModal;
  caja.querySelector(".modal-cuerpo").scrollTop = scroll;
  caja.classList.toggle("ancha", MODAL.abierto === "historial" || MODAL.abierto === "gestor");
  def[1](caja);
}
document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarModal(); });
/* Registro de ventanas: [contenido, eventos]. Las del gestor e historial viven en sus archivos. */
const MODALES = {
  alertas:     [() => modalAlertas(),      c => ligarAlertas(c)],
  formularios: [() => modalFormularios(),  c => ligarModalFormularios(c)],
  historial:   [() => modalHistorial(),    c => ligarHistorial(c)],
  gestor:      [() => modalGestor(),       c => ligarModalGestor(c)],
  chequeo:     [() => modalChequeo(),      c => ligarChequeo(c)],
};
/* ------------------------------------------------ chequeo de configuración de Meta (5.4) */
const CHEQ = { cargando:false, pasos:null, error:"", revisado:"", cuenta:"" };
async function cargarChequeo(){
  if (!S.clienteKey){ CHEQ.error = "Elige primero la cuenta publicitaria (y la página, si ya la tienes)."; CHEQ.pasos = null; pintarModal(); return; }
  CHEQ.cargando = true; CHEQ.error = ""; pintarModal();
  try { const r = await llamar("buscar", Object.assign({ tipo:"chequeo_meta", page_id:S.pageId }, ctx())); CHEQ.pasos = r.pasos || []; CHEQ.revisado = r.revisado || ""; CHEQ.cuenta = S.clienteKey; }
  catch(e){ CHEQ.error = e.message; }
  CHEQ.cargando = false; pintarModal();
}
const ESTADO_CHEQ = { falla:["stop","Corregir"], revisar:["alerta","Revisar"], ok:["ok","Bien"], info:["info","Nota"] };
function modalChequeo(){
  const l = CHEQ.pasos || [];
  const n = k => l.filter(x => x.estado === k).length;
  const sub = CHEQ.pasos ? (n("falla") ? n("falla") + (n("falla") === 1 ? " punto impide" : " puntos impiden") + " publicar algo del plan" : n("revisar") ? "Nada bloquea; " + n("revisar") + " para revisar" : "Todo en orden") : "Revisa en Meta lo que la herramienta necesita";
  const grupos = [...new Set(l.map(x => x.grupo))];
  return ["Chequeo de configuración de Meta", sub, `
    ${CHEQ.error ? `<div class="note stop">${esc(CHEQ.error)}</div>` : ""}
    ${CHEQ.cargando ? `<div class="empty"><span class="spinner"></span> Consultando a Meta: API, token, cuenta, página, WhatsApp, formularios y píxel…</div>` : ""}
    ${!CHEQ.cargando && CHEQ.pasos ? `<div class="cheq-res">${["falla","revisar","ok"].map(k => `<div class="cheq-k ${k}"><b>${n(k)}</b><span>${ESTADO_CHEQ[k][1]}</span></div>`).join("")}</div>
      ${grupos.map(g => `<section class="cheq-g"><h4>${esc(g)}</h4><ul>${l.filter(x => x.grupo === g).map(x => `<li class="cheq ${x.estado}">
        <span class="cheq-i">${icono(ESTADO_CHEQ[x.estado][0])}</span><div><b>${esc(x.punto)}</b><p>${esc(x.detalle)}</p>${x.como ? `<p class="cheq-como">${esc(x.como)}</p>` : ""}</div></li>`).join("")}</ul></section>`).join("")}
      <p class="hint">Revisado ${esc(fechaHora(CHEQ.revisado))} para ${esc((cliente() || {}).nombre || "")}${S.pageId ? " · página " + esc((S.paginas.find(p => p.id === S.pageId) || { n: S.pageId }).n) : " · sin página elegida"}.</p>` : ""}
    <div class="res-acciones"><button class="btn go sm" data-cheq-correr ${CHEQ.cargando ? "disabled" : ""}>${CHEQ.pasos ? "Volver a revisar" : "Revisar ahora"}</button></div>`];
}
function ligarChequeo(caja){ const b = caja.querySelector("[data-cheq-correr]"); if (b) b.onclick = cargarChequeo; }
function modalAlertas(){
  const l = alertas();
  const b = l.filter(a => a.nivel === "bloquea").length;
  return ["Alertas del plan", b ? b + (b === 1 ? " pendiente impide" : " pendientes impiden") + " enviar · toca el paso para ir a corregir" : "Nada impide enviar", alertasHTML(l)];
}

/* ------------------------------------------------------- formularios y leads */
const LEADS = { bajando:"", error:"" };
function modalFormularios(){
  const pagina = (S.paginas.find(p => p.id === S.pageId) || {}).n;
  if (!S.pageId) return ["Formularios y leads", "Sin página elegida", `<div class="empty">Elige la cuenta y la página en los pasos 1 y 2 para ver sus formularios.</div>`];
  const lista = S.formularios || [];
  const tot = lista.reduce((t, x) => t + (Number(x.leads) || 0), 0);
  return ["Formularios y leads", esc(pagina || S.pageId) + " · " + lista.length + (lista.length === 1 ? " formulario" : " formularios") + (tot ? " · " + tot.toLocaleString("es-MX") + " leads" : ""),
    `<div class="row-actions" style="margin-bottom:12px"><button class="btn ghost sm" data-fm-recargar>${S.cargandoFormularios ? `<span class="spinner"></span> Cargando…` : "Volver a cargar"}</button>
      <button class="btn sm" data-fm-crear>+ Crear formulario</button>
      <label class="hint" style="display:flex;align-items:center;gap:6px;margin-left:auto">Leads desde <input type="date" data-leads-desde value="${esc(LEADS.desde||"")}" style="width:auto;min-height:32px;padding:4px 8px"></label></div>
    ${LEADS.error ? `<div class="note stop" style="margin-bottom:12px">${esc(LEADS.error)}</div>` : ""}
    ${S.falloFormularios ? `<div class="note stop">${esc(S.falloFormularios)}</div>` : ""}
    ${lista.length ? `<table class="tabla-fm"><thead><tr><th>Formulario</th><th>Estado</th><th class="num">Leads</th><th></th></tr></thead><tbody>
      ${lista.map(x => `<tr><td><b>${esc(x.n)}</b><small>${esc((x.preguntas||[]).slice(0,5).join(" · "))}</small></td>
        <td><span class="pill ${x.estado === "ACTIVE" ? "ok" : "dim"}">${({ACTIVE:"Activo",DRAFT:"Borrador",ARCHIVED:"Archivado",DELETED:"Eliminado"})[x.estado] || esc(String(x.estado||"").toLowerCase())}</span></td>
        <td class="num mono">${x.leads == null ? "—" : Number(x.leads).toLocaleString("es-MX")}</td>
        <td class="der"><button class="btn ghost sm" data-bajar-leads="${esc(x.id)}" ${LEADS.bajando ? "disabled" : ""}>${LEADS.bajando === x.id ? `<span class="spinner"></span> Descargando…` : icono("bajar") + " CSV"}</button></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">${S.cargandoFormularios ? "Cargando…" : "La página no tiene formularios todavía."}</div>`}
    <p class="hint" style="margin-top:12px">La descarga trae hasta 2.000 leads por consulta, del más reciente al más antiguo. Usa "Leads desde" para bajar solo los nuevos.</p>`];
}
function ligarModalFormularios(caja){
  const r = caja.querySelector("[data-fm-recargar]"); if (r) r.onclick = async () => { S.cargandoFormularios = true; pintarModal(); await cargarFormularios(true); pintarModal(); };
  const c = caja.querySelector("[data-fm-crear]"); if (c) c.onclick = () => {
    FORM.abierto = true; FORM.d = FORM.d || formNuevo(); FORM.hecho = ""; cerrarModal();
    if (S.paso !== 4){ toast("El creador de formularios está en el paso Anuncios.", "warn"); if (S.clienteKey && S.pageId && S.campanas.length){ S.paso = 4; } }
    render(); window.scrollTo({ top:0, behavior:"smooth" });
  };
  const d = caja.querySelector("[data-leads-desde]"); if (d) d.onchange = () => { LEADS.desde = d.value; };
  caja.querySelectorAll("[data-bajar-leads]").forEach(b => b.onclick = () => bajarLeads(b.dataset.bajarLeads));
}
async function bajarLeads(formId){
  LEADS.bajando = formId; LEADS.error = ""; pintarModal();
  try {
    const r = await llamar("formularios", Object.assign({ op:"leads", page_id:S.pageId, form_id:formId, desde: LEADS.desde || "" }, ctx()));
    const filas = r.filas || [], cols = r.columnas || [];
    if (!filas.length){ toast("Ese formulario no tiene leads" + (LEADS.desde ? " desde esa fecha." : "."), "warn"); }
    else {
      const celda = v => { const x = String(v == null ? "" : v); return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const csv = "﻿" + [cols.join(";")].concat(filas.map(f => cols.map(c => celda(f[c])).join(";"))).join("\r\n");
      const fx = (S.formularios||[]).find(x => x.id === formId) || { n: formId };
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
      a.download = "leads_" + slug(fx.n) + "_" + hoy() + ".csv"; a.click();
      toast(filas.length.toLocaleString("es-MX") + " leads descargados" + (r.truncado ? " (hay más: usa \"Leads desde\" para bajar el resto)" : "") + ".");
    }
  } catch(e){ LEADS.error = e.message; }
  LEADS.bajando = ""; pintarModal();
}

/* ------------------------------------------------ publicaciones existentes */
const PUBS = { clave:"", cargando:false, lista:[], avisos:[], error:"", filtro:"TODAS", abiertoPara:"" };
async function cargarPublicaciones(forzar){
  if (!S.pageId) return;
  if (!forzar && PUBS.clave === S.pageId && PUBS.lista.length) return;
  PUBS.cargando = true; PUBS.error = ""; render();
  try { const r = await llamar("buscar", Object.assign({ tipo:"publicaciones", texto:"", page_id:S.pageId }, ctx())); PUBS.lista = r.resultados || []; PUBS.avisos = r.avisos || []; PUBS.clave = S.pageId; }
  catch(e){ PUBS.error = e.message; }
  PUBS.cargando = false; render();
}
function fechaCorta(iso){ const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day:"numeric", month:"short" }); }
function publicacionCardHTML(p, sel){
  return `<span class="pub-img">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icono(p.origen === "INSTAGRAM" ? "ig" : "fb")}</span>
    <span class="pub-info"><span class="pub-origen ${p.origen === "INSTAGRAM" ? "ig" : "fb"}">${icono(p.origen === "INSTAGRAM" ? "ig" : "fb")}${p.origen === "INSTAGRAM" ? "Instagram" : "Facebook"} · ${esc(fechaCorta(p.fecha))}</span>
    <span class="pub-txt">${esc(p.n)}</span>${p.elegible === false ? `<span class="pub-no">No se puede promocionar</span>` : ""}</span>${sel ? icono("ok", "pub-check") : ""}`;
}
function publicacionHTML(c){
  const elegido = c.post;
  const abierto = PUBS.abiertoPara === c.id || !elegido;
  const lista = PUBS.lista.filter(p => PUBS.filtro === "TODAS" || p.origen === PUBS.filtro);
  return `<div class="f s12"><label>Publicación de la página<span class="req">*</span></label>
    ${elegido ? `<div class="pub sel">${publicacionCardHTML(elegido, true)}<button type="button" class="btn ghost sm" data-pub-cambiar>${abierto ? "Cerrar" : "Cambiar"}</button></div>` : ""}
    ${abierto ? `<div class="pub-picker">
      <div class="pub-barra"><div class="seg">${[["TODAS","Todas"],["FACEBOOK","Facebook"],["INSTAGRAM","Instagram"]].map(([v,t]) => `<label class="opt ${PUBS.filtro===v?"on":""}"><input type="radio" name="pubf_${c.id}" value="${v}" data-pub-filtro ${PUBS.filtro===v?"checked":""}> ${t}</label>`).join("")}</div>
        <button type="button" class="btn ghost sm" data-pub-recargar>${PUBS.cargando ? `<span class="spinner"></span>` : ""} Volver a cargar</button></div>
      ${PUBS.error ? `<div class="note stop">${esc(PUBS.error)}</div>` : ""}
      ${PUBS.avisos.length ? `<div class="hint warn-t">${esc(PUBS.avisos.join(" · "))}</div>` : ""}
      ${PUBS.cargando && !PUBS.lista.length ? `<div class="empty"><span class="spinner"></span> Leyendo publicaciones…</div>`
        : lista.length ? `<div class="pub-grid">${lista.map(p => `<button type="button" class="pub ${elegido && elegido.id === p.id ? "on" : ""}" data-pub="${esc(p.id)}" ${p.elegible === false ? "disabled" : ""}>${publicacionCardHTML(p, elegido && elegido.id === p.id)}</button>`).join("")}</div>`
        : `<div class="empty">No encontré publicaciones${PUBS.filtro !== "TODAS" ? " de " + (PUBS.filtro === "INSTAGRAM" ? "Instagram" : "Facebook") : ""} en la página elegida.</div>`}
    </div>` : ""}
    <span class="hint">Se usa tal cual: conserva sus reacciones y comentarios. Solo va a conjuntos que llevan al sitio web. En Facebook el botón es el de la publicación; en Instagram puedes agregar botón y URL en el anuncio.</span></div>`;
}
function ligarPublicacion(box, c){
  const cam = box.querySelector("[data-pub-cambiar]"); if (cam) cam.onclick = () => { PUBS.abiertoPara = PUBS.abiertoPara === c.id ? "" : c.id; if (PUBS.abiertoPara) cargarPublicaciones(); render(); };
  const rec = box.querySelector("[data-pub-recargar]"); if (rec) rec.onclick = () => cargarPublicaciones(true);
  box.querySelectorAll("[data-pub-filtro]").forEach(r => r.onchange = () => { PUBS.filtro = r.value; render(); });
  box.querySelectorAll("[data-pub]").forEach(b => b.onclick = () => {
    const p = PUBS.lista.find(x => x.id === b.dataset.pub); if (!p) return;
    c.post = p; PUBS.abiertoPara = ""; if (!c.nombre) c.nombre = ""; render();
  });
}
function publicacionAnuncioHTML(a){
  const cr = creativoDe(a), p = cr && cr.post;
  return `<div class="f s12"><label>Contenido</label>${p ? `<div class="pub sel estatica">${publicacionCardHTML(p)}</div>` : `<div class="empty">El creativo aún no tiene publicación elegida.</div>`}
    <span class="hint">El texto, la imagen y ${p && p.origen === "FACEBOOK" ? "el botón" : "el título"} vienen de la publicación. Para cambiarlos, usa un creativo de imagen o video.</span></div>`;
}

/* ----------------------------------------------------- progreso por fases */
const FASES = [["validacion","Validación"],["inicio","Preparación"],["creativos","Creativos"],["videos","Videos"],["campanas","Campañas"],["conjuntos","Conjuntos"],["ajustes","Ajustes"],["anuncios","Anuncios"],["limpieza","Cierre"]];
function fasesHTML(){
  const i = Math.max(0, FASES.findIndex(f => f[0] === (S.fase || "validacion")));
  return `<ol class="fases">${FASES.map((f, j) => `<li class="${j < i ? "hecha" : j === i ? "actual" : ""}"><span class="fp">${j < i ? icono("ok") : ""}</span>${f[1]}</li>`).join("")}</ol>`;
}

/* ------------------------------------------------------------ resultado */
function kpisResultadoHTML(r){
  const fallos = (r && r.fallos) || [], avs = (r && r.avisos) || [];
  const n = r ? (r.anuncios || 0) : 0, de = r ? (r.previstos || instancias().length) : instancias().length;
  const min = r && r.inicio && r.actualizado ? Math.max(0, Math.round((Date.parse(r.actualizado) - Date.parse(r.inicio)) / 60000)) : null;
  return `<div class="kpis">
    <div class="kpi ${n && n === de ? "ok" : ""}"><b>${n}<small> / ${de}</small></b><span>anuncios publicados</span></div>
    <div class="kpi ${fallos.length ? "stop" : ""}"><b>${fallos.length}</b><span>${fallos.length === 1 ? "error" : "errores"}</span></div>
    <div class="kpi ${avs.length ? "warn" : ""}"><b>${avs.length}</b><span>${avs.length === 1 ? "aviso" : "avisos"}</span></div>
    ${min != null ? `<div class="kpi"><b>${min < 1 ? "<1" : min}<small> min</small></b><span>duración</span></div>` : ""}
  </div>`;
}
function alertasDeResultado(r){
  if (!r) return [];
  const fallos = r.fallos || (r.estado === "RECHAZADO" ? r.problemas || [] : []);
  const avs = r.avisos || (!r.fallos && r.estado !== "RECHAZADO" ? r.problemas || [] : []);
  return fallos.map(t => ({ nivel:"bloquea", texto:t })).concat(avs.map(t => ({ nivel: /^AVISO|se eliminó|se reutilizó|se usó|se duplicó|se creó por copia/i.test(t) ? "info" : "revisar", texto:t })));
}
function resultadosLoteHTML(){
  const R = LOTE.resultados; if (!R) return "";
  if (R.error) return `<div class="note stop" style="margin-top:12px">${esc(R.error)}</div>`;
  const filas = R.filas || [];
  const suma = k => filas.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const fmtN = v => Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
  const mon = (filas.find(x => x.moneda) || {}).moneda || ((cliente()||{}).moneda || "");
  return `<div class="scroll" style="margin-top:12px"><table class="rows"><thead><tr><th>Campaña</th><th class="num">Gasto</th><th class="num">Impresiones</th><th class="num">Clics</th><th class="num">Leads</th><th class="num">Conversaciones</th><th class="num">Compras</th></tr></thead><tbody>
    ${filas.map(x => x.error ? `<tr><td>${esc(x.id)}</td><td colspan="6" class="warn-t">${esc(x.error)}</td></tr>` : `<tr><td>${esc(x.nombre || x.id)}</td><td class="num">${fmtN(x.gasto)} ${esc(x.moneda||"")}</td><td class="num">${fmtN(x.impresiones)}</td><td class="num">${fmtN(x.clics)}</td><td class="num">${fmtN(x.leads)}</td><td class="num">${fmtN(x.conversaciones)}</td><td class="num">${fmtN(x.compras)}${x.compras && UNIVERSO[x.universo] ? `<small class="uni">${UNIVERSO[x.universo]}</small>` : ""}</td></tr>`).join("")}
    ${filas.length > 1 ? `<tr class="total"><td>Total</td><td class="num">${fmtN(suma("gasto"))} ${esc(mon)}</td><td class="num">${fmtN(suma("impresiones"))}</td><td class="num">${fmtN(suma("clics"))}</td><td class="num">${fmtN(suma("leads"))}</td><td class="num">${fmtN(suma("conversaciones"))}</td><td class="num">${comprasTotales(filas, fmtN)}</td></tr>` : ""}
    </tbody></table></div><p class="hint">Desde que se creó cada campaña, según Meta. Las compras se leen por universo y no se mezclan: campañas "CAPI WhatsApp" con compras en el chat (On-Facebook Purchase); las demás con compras offline y, si no hay, las del sitio web.</p>`;
}
const UNIVERSO = { chat:"chat", offline:"offline", web:"sitio" };
/* Total de compras separado por universo (5.3): nunca una sola cifra mezclada. */
function comprasTotales(filas, fmtN){
  const t = {}; filas.forEach(x => { if (x.compras && x.universo) t[x.universo] = (t[x.universo] || 0) + Number(x.compras); });
  const k = Object.keys(t); if (!k.length) return "0";
  return k.map(u => fmtN(t[u]) + " " + UNIVERSO[u]).join(" · ");
}
async function cargarResultadosLote(){
  const o = LOTE.objetos; if (!o) return;
  const ids = o.campanas.map(c => c.id).concat(S.campanas.filter(c => c.modo === "EXISTENTE").map(c => c.metaId));
  if (!ids.length){ toast("No hay campañas del lote para consultar.", "warn"); return; }
  LOTE.cargandoRes = true; render();
  try { const r = await llamar("buscar", Object.assign({ tipo:"lote_resultados", campaign_ids: ids.join(",") }, ctx())); LOTE.resultados = { filas: r.resultados || [] }; }
  catch(e){ LOTE.resultados = { error: e.message }; }
  LOTE.cargandoRes = false; render();
}

/* ------------------------------------------------ revisión previa con Meta */
const PREVAL = { cargando:false, hecho:false, ok:false, problemas:[], avisos:[], error:"", firma:"" };
function firmaPlan(){ try { return JSON.stringify(generarFilas()).length + "|" + instancias().length + "|" + S.pageId + "|" + JSON.stringify(S.replicas || []); } catch(e){ return ""; } }
async function prevalidar(){
  Object.assign(PREVAL, { cargando:true, error:"", hecho:false }); render();
  try {
    const f = generarFilas(), cl = cliente(), existentes = S.campanas.filter(c => c.modo === "EXISTENTE");
    const r = await llamar("prevalidar", { client_key:S.clienteKey, cuenta_id:cl.cuenta, page_id:S.pageId, lote_id: asegurarLote(),
      campaign_id: existentes[0] ? existentes[0].metaId : "", campana: S.campanas.map(nombreCampana).join(" + "), filas:f });
    let problemas = (r.problemas || []).slice(), ok = !!r.ok; const avisosP = (r.avisos || []).slice(), infoP = (r.info || []).slice();
    /* Cada réplica se revisa con su propia cuenta y página. */
    for (const rp of (S.replicas || [])){
      const d = cuentaPorId(rp.cuenta); if (!d) continue;
      try {
        const x = await llamar("prevalidar", { client_key:d.key, cuenta_id:d.cuenta, page_id:rp.pageId || S.pageId, lote_id: asegurarLote(), campaign_id:"", replica_de: cl.cuenta,
          campana: S.campanas.filter(c => c.modo === "NUEVA").map(nombreCampana).join(" + "), filas: generarFilasReplica(rp) });
        if (!x.ok){ ok = false; (x.problemas || []).forEach(t => problemas.push("Réplica en " + d.nombre + ": " + t)); }
      } catch(e){ problemas.push("Réplica en " + d.nombre + ": no se pudo revisar (" + e.message + ")."); ok = false; }
    }
    Object.assign(PREVAL, { hecho:true, ok, problemas, avisos: avisosP, info: infoP, firma: firmaPlan() });
    toast(ok ? "Meta no encontró problemas" + ((S.replicas||[]).length ? " en ninguna cuenta." : " en el plan.") : problemas.length + " problema(s) que Meta rechazaría.", ok ? "ok" : "stop");
  } catch(e){ PREVAL.error = /tardó|26|504/.test(e.message) ? "La revisión tardó más de lo que permite el proxy. No es un error del plan: al enviar, el motor valida igual." : e.message; }
  PREVAL.cargando = false; render();
}
function prevalHTML(){
  const vigente = PREVAL.hecho && PREVAL.firma === firmaPlan();
  return `<div class="preval ${vigente ? (PREVAL.ok ? "ok" : "stop") : ""}">
    <div class="preval-t">${icono("escudo")}<div><b>Revisión con Meta</b><span>${PREVAL.cargando ? "Consultando la cuenta, la página, los formularios y las referencias…"
      : vigente ? (PREVAL.ok ? "Meta no encontró problemas. El plan está listo para enviarse." : PREVAL.problemas.length + " problema(s) que Meta rechazaría: están abajo.")
      : PREVAL.hecho ? "El plan cambió desde la última revisión." : "Comprueba con Meta presupuestos mínimos, página, formularios, números y referencias sin crear nada."}</span></div></div>
    <button class="btn ${vigente && PREVAL.ok ? "ghost" : ""} sm" id="prevalidar" ${PREVAL.cargando ? "disabled" : ""}>${PREVAL.cargando ? `<span class="spinner"></span> Revisando…` : vigente ? "Revisar de nuevo" : "Revisar con Meta"}</button>
  </div>
  ${PREVAL.error ? `<div class="note warn" style="margin:-6px 0 14px">${esc(PREVAL.error)}</div>` : ""}
  ${vigente && (!PREVAL.ok || (PREVAL.avisos || []).length || (PREVAL.info || []).length) ? `<div class="al-caja" style="margin-bottom:14px">${alertasHTML(PREVAL.problemas.map(t => ({ nivel:"bloquea", texto:t })).concat((PREVAL.avisos || []).map(t => ({ nivel:"revisar", texto:t })), (PREVAL.info || []).map(t => ({ nivel:"info", texto:t }))), { sinSaltos:true })}</div>` : ""}`;
}

/* --------------------------------------------------------------- historial */
const HIST = { cargando:false, lista:null, error:"", abierto:"" };
async function cargarHistorial(){
  HIST.cargando = true; HIST.error = ""; pintarModal();
  try { const r = await llamar("historial", {}); HIST.lista = r.corridas || []; }
  catch(e){ HIST.error = e.message; }
  HIST.cargando = false; pintarModal();
}
const CHIP_ESTADO = { OK:["ok","Publicado"], OK_CON_AVISOS:["ok","Con avisos"], OK_SIN_BITACORA:["warn","Sin bitácora completa"], PARCIAL:["warn","Parcial"],
  ERROR:["stop","Error"], RECHAZADO:["stop","Rechazado"], EN_PROCESO:["run","En proceso"], DETENIDO:["warn","Detenido"] };
function chipEstado(e){ const c = CHIP_ESTADO[e] || ["dim", String(e || "").toLowerCase()]; return `<span class="pill ${c[0] === "run" ? "" : c[0]}">${esc(c[1])}</span>`; }
function fechaHora(iso){ const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("es-MX", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); }
function modalHistorial(){
  const l = HIST.lista;
  const nombreCuenta = id => (S.cuentas.find(c => String(c.cuenta) === String(id)) || { nombre: id ? "act_" + id : "—" }).nombre;
  return ["Historial de publicaciones", l ? "Las últimas " + l.length + " corridas registradas en la hoja" : "Corridas registradas en la hoja",
    `${HIST.error ? `<div class="note stop">${esc(HIST.error)}</div>` : ""}
    ${!l ? `<div class="empty"><span class="spinner"></span> Leyendo la hoja…</div>` : !l.length ? `<div class="empty">Todavía no hay corridas registradas.</div>` :
      `<table class="tabla-fm hist"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Campañas</th><th>Estado</th><th class="num">Anuncios</th></tr></thead><tbody>
      ${l.map(x => `<tr data-hist="${esc(x.run_id)}" class="${HIST.abierto === x.run_id ? "abierta" : ""}"><td class="mono">${esc(fechaHora(x.inicio))}</td><td>${esc(nombreCuenta(x.cuenta))}</td>
        <td><b>${esc(x.campana || "—")}</b><small>${esc(x.mensaje).slice(0, 140)}</small></td><td>${chipEstado(x.estado)}</td><td class="num mono">${x.anuncios} / ${x.previstos}</td></tr>
        ${HIST.abierto === x.run_id && (x.fallos.length || x.avisos.length) ? `<tr class="hist-det"><td colspan="5">${alertasHTML(x.fallos.map(t => ({ nivel:"bloquea", texto:t })).concat(x.avisos.map(t => ({ nivel:"info", texto:t }))), { sinSaltos:true })}</td></tr>` : ""}`).join("")}
      </tbody></table><p class="hint" style="margin-top:10px">Toca una fila para ver sus errores y avisos.</p>`}
    <div class="res-acciones"><button class="btn ghost sm" data-hist-recargar>${HIST.cargando ? `<span class="spinner"></span> ` : ""}Volver a cargar</button>${CFG.hojaUrl ? `<a class="btn ghost sm" href="${esc(CFG.hojaUrl)}" target="_blank" rel="noopener">${icono("hoja")} Abrir la hoja</a>` : ""}</div>`];
}
function ligarHistorial(caja){
  const r = caja.querySelector("[data-hist-recargar]"); if (r) r.onclick = cargarHistorial;
  caja.querySelectorAll("[data-hist]").forEach(tr => tr.onclick = () => { HIST.abierto = HIST.abierto === tr.dataset.hist ? "" : tr.dataset.hist; pintarModal(); });
}

/* ------------------------------------------------ publicar en varias cuentas */
function replicasHTML(){
  const cl = cliente(); if (!cl) return "";
  const otras = S.cuentas.filter(c => c.cuenta !== cl.cuenta);
  if (!otras.length) return "";
  const elegidas = S.replicas || [];
  const abierta = REPL.abierto;
  const pagina = id => (S.paginas.find(p => p.id === id) || { n: id }).n;
  return `<div class="panel repl"><header><div><h2>${icono("abrir")} Cuentas donde se publica</h2><p>${1 + elegidas.length} ${elegidas.length ? "cuentas: la principal y " + elegidas.length + (elegidas.length === 1 ? " réplica" : " réplicas") : "cuenta"}. Cada réplica crea las mismas campañas nuevas en otra cuenta.</p></div>
    <div class="row-actions"><button class="btn ghost sm" id="replAbrir">${abierta ? "Ocultar" : elegidas.length ? "Ver cuentas" : "+ Publicar también en otras cuentas"}</button></div></header>
    ${abierta ? `<div class="body">
      <div class="repl-fila principal"><span class="pill ok">Principal</span><b>${esc(cl.nombre)}</b><span class="mono">act_${esc(cl.cuenta)} · ${esc(cl.moneda)}</span><span class="hint">Página: ${esc(pagina(S.pageId))}</span></div>
      ${elegidas.map(r => { const d = cuentaPorId(r.cuenta) || { nombre: r.cuenta }; const pr = problemasReplica(r);
        return `<div class="repl-fila ${pr.length ? "mal" : ""}" data-repl="${esc(r.cuenta)}"><span class="pill ${pr.length ? "stop" : ""}">Réplica</span><b>${esc(d.nombre)}</b><span class="mono">act_${esc(r.cuenta)} · ${esc(d.moneda || "")} · ${d.pixel ? "píxel " + esc(d.pixel) : "sin píxel"}</span>
          <select data-repl-pagina>${S.paginas.map(p => `<option value="${esc(p.id)}" ${(r.pageId || S.pageId) === p.id ? "selected" : ""}>${esc(p.n)}</option>`).join("")}</select>
          <button class="btn link sm" data-repl-quitar>Quitar</button>
          ${pr.length ? `<div class="repl-pr">${pr.map(x => `<div>${icono("stop")} ${esc(x.replace(/^Réplica en [^:]+: /, ""))}</div>`).join("")}</div>` : ""}</div>`; }).join("")}
      <div class="repl-agregar"><select id="replNueva"><option value="">Agregar cuenta…</option>${otras.filter(c => !elegidas.some(r => r.cuenta === c.cuenta)).map(c => `<option value="${esc(c.cuenta)}" ${c.moneda !== cl.moneda ? "disabled" : ""}>${esc(c.nombre)} · ${esc(c.moneda)}${c.moneda !== cl.moneda ? " (otra moneda)" : ""}</option>`).join("")}</select>
        <span class="hint">Solo campañas nuevas. Cada cuenta usa su píxel; las imágenes y videos se copian de la cuenta principal; los públicos se buscan por nombre.</span></div>
    </div>` : ""}</div>`;
}
const REPL = { abierto:false };
/* Al abrir un borrador con réplicas, el panel se muestra abierto. */
function ligarReplicas(){
  const ab = $("#replAbrir"); if (ab) ab.onclick = () => { REPL.abierto = !REPL.abierto; render(); };
  const nv = $("#replNueva"); if (nv) nv.onchange = () => { if (nv.value){ S.replicas = (S.replicas || []).concat([{ cuenta: nv.value, pageId: S.pageId }]); PREVAL.hecho = false; render(); } };
  document.querySelectorAll("[data-repl]").forEach(row => {
    const r = (S.replicas || []).find(x => x.cuenta === row.dataset.repl); if (!r) return;
    row.querySelector("[data-repl-pagina]").onchange = e => { r.pageId = e.target.value; render(); };
    row.querySelector("[data-repl-quitar]").onclick = () => { S.replicas = S.replicas.filter(x => x !== r); render(); };
  });
}
/* Progreso y resultado por cuenta cuando hay réplicas. */
function corridasHTML(){
  const cs = S.corridas || []; if (cs.length < 2) return "";
  return `<div class="panel"><header><div><h2>Por cuenta</h2><p>${cs.filter(c => c.fin).length} de ${cs.length} terminadas</p></div></header><div class="body">
    <table class="tabla-fm"><thead><tr><th>Cuenta</th><th>Estado</th><th class="num">Anuncios</th><th>Detalle</th></tr></thead><tbody>
    ${cs.map(c => { const r = c.resultado || {}; const est = r.estado || (c.error ? "ERROR" : "EN_PROCESO");
      const pct = r.previstos ? Math.round(100 * (r.anuncios || 0) / r.previstos) : 0;
      return `<tr><td><b>${esc(c.nombre)}</b><small>${c.principal ? "principal" : "réplica"} · act_${esc(c.cuenta)}</small></td><td>${c.fin ? chipEstado(est) : `<span class="pill"><span class="spinner"></span>${esc(FASES_NOMBRE[r.fase] || "en curso")}</span>`}</td>
        <td class="num mono">${r.previstos ? (r.anuncios || 0) + " / " + r.previstos : "—"}${!c.fin && r.previstos ? `<span class="barra"><i style="width:${pct}%"></i></span>` : ""}</td>
        <td>${esc(c.error || r.mensaje || "")}${c.fin && ((r.fallos||[]).length || (r.avisos||[]).length) ? `<details class="det"><summary>${(r.fallos||[]).length} errores · ${(r.avisos||[]).length} avisos</summary>${alertasHTML(alertasDeResultado(r), { sinSaltos:true })}</details>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div></div>`;
}
const FASES_NOMBRE = Object.fromEntries(FASES);
