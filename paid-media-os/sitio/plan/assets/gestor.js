/* =====================================================================
   Meta Bulk Editor · gestor multicuenta — sitio 5.5
   Edita campañas, conjuntos o anuncios YA publicados en varias cuentas a
   la vez: estado, nombre, presupuesto y fecha de fin, uno por uno o en
   bloque. Nada se aplica hasta revisar los cambios y confirmar.
   ===================================================================== */
const G = { cuentas:new Set(), nivel:"campaign", periodo:"last_7d", estados:"VIVOS", texto:"", buscar:"",
  filas:[], resumen:[], errores:[], cargando:false, error:"", cargado:false,
  sel:new Set(), cambios:{}, orden:{ col:"gasto", dir:-1 }, limite:150,
  aplicando:false, resultado:null, masivo:{ pct:"", monto:"", fin:"", de:"", a:"" } };
const NIVEL_G = { campaign:"Campañas", adset:"Conjuntos", ad:"Anuncios" };
const PERIODO_G = [["today","Hoy"],["yesterday","Ayer"],["last_7d","Últimos 7 días"],["last_30d","Últimos 30 días"],["this_month","Este mes"],["maximum","Desde el inicio"]];
const ESTADOS_G = { VIVOS:["ACTIVE","PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED","WITH_ISSUES","IN_PROCESS","PENDING_REVIEW"], ACTIVOS:["ACTIVE"], PAUSADOS:["PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED"] };

const filaG = id => G.filas.find(f => f.id === id);
const valorG = (f, k) => { const c = G.cambios[f.id] || {}; return k in c ? c[k] : ({ status:f.estado, name:f.nombre, diario:f.diario, total:f.total, fin:String(f.fin||"").slice(0,10) })[k]; };
function cambiarG(f, k, v){
  const orig = ({ status:f.estado, name:f.nombre, diario:f.diario, total:f.total, fin:String(f.fin||"").slice(0,10) })[k];
  const c = G.cambios[f.id] = G.cambios[f.id] || {};
  if (String(v) === String(orig) || (v === "" && k !== "name")) delete c[k]; else c[k] = v;
  if (!Object.keys(c).length) delete G.cambios[f.id];
}
const nCambiosG = () => Object.keys(G.cambios).length;
/* Resultado de cada fila (5.3): el que corresponde a lo que optimiza, no el mayor de todos.
   Las campañas "CAPI WhatsApp" se miden por compras en el chat; sin objetivo legible
   (anuncios) se usa el resultado con más volumen. */
function tipoResultado(f){
  const o = String(f.objetivo || ""), d = String(f.destino || "");
  if (f.universo === "chat") return "compras";
  if (/MESSAGING_PURCHASE|OFFSITE_CONVERSIONS|^VALUE$|OUTCOME_SALES/.test(o)) return "compras";
  if (/CONVERSATIONS/.test(o) || /WHATSAPP|MESSENGER/.test(d)) return "conversaciones";
  if (/LEAD_GENERATION|QUALITY_LEAD|OUTCOME_LEADS/.test(o)) return "leads";
  const l = f.leads || 0, c = f.conversaciones || 0, p = f.compras || 0;
  if (!l && !c && !p) return "";
  return l >= c && l >= p ? "leads" : c >= p ? "conversaciones" : "compras";
}
const resultadoDe = f => { const t = tipoResultado(f); return t ? Number(f[t] || 0) : 0; };
const ETIQ_RES = { leads:"leads", conversaciones:"conversaciones", compras:"compras" };
const etiquetaResultado = f => { const t = tipoResultado(f); return t === "compras" && f.universo ? "compras " + ({ chat:"chat", offline:"offline", web:"sitio" }[f.universo] || "") : (ETIQ_RES[t] || ""); };
const fmtD = (v, m) => Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 }) + (m ? " " + m : "");

async function cargarGestor(){
  if (!G.cuentas.size){ toast("Elige al menos una cuenta.", "warn"); return; }
  G.cargando = true; G.error = ""; render();
  try {
    const r = await llamar("gestor", { op:"listar", cuentas:[...G.cuentas].join(","), nivel:G.nivel, periodo:G.periodo, estados:ESTADOS_G[G.estados].join(","), texto:G.texto });
    G.filas = r.filas || []; G.resumen = r.cuentas || []; G.errores = r.errores || []; G.cargado = true; G.sel = new Set(); G.limite = 150;
    Object.keys(G.cambios).forEach(id => { if (!filaG(id)) delete G.cambios[id]; });
    if (r.parcial) G.errores.push("La consulta tardó mucho y puede venir incompleta: elige menos cuentas o filtra por nombre.");
  } catch(e){ G.error = e.message; }
  G.cargando = false; render();
}
function filasVisiblesG(){
  const q = G.buscar.trim().toLowerCase();
  const xs = G.filas.filter(f => !q || (f.nombre + " " + f.padre + " " + f.cuentaNombre).toLowerCase().includes(q));
  const k = G.orden.col, d = G.orden.dir;
  return xs.sort((a, b) => {
    const va = k === "resultado" ? resultadoDe(a) : k === "presupuesto" ? (a.diario || a.total) : a[k], vb = k === "resultado" ? resultadoDe(b) : k === "presupuesto" ? (b.diario || b.total) : b[k];
    return (typeof va === "number" ? va - vb : String(va||"").localeCompare(String(vb||""), "es")) * d;
  });
}

/* ------------------------------------------------------------------ vista */
function vGestor(){
  const cuentas = S.cuentas.filter(c => !G.filtroCuenta || (c.nombre + " " + c.cuenta).toLowerCase().includes(G.filtroCuenta.toLowerCase()));
  return `
  <h1>Editar campañas en varias cuentas</h1>
  <p class="lede">Elige las cuentas, carga lo que ya está publicado y cambia estado, nombre, presupuesto o fecha de fin, uno por uno o en bloque. Nada se aplica hasta que revises los cambios.</p>
  <div class="panel"><header><div><h2>Cuentas</h2><p>${G.cuentas.size} de ${S.cuentas.length} elegidas</p></div>
    <div class="row-actions"><input type="text" id="gFiltroCuenta" placeholder="Buscar cuenta…" value="${esc(G.filtroCuenta||"")}" style="width:220px;min-height:34px">
      <button class="btn ghost sm" id="gTodas">${G.cuentas.size === S.cuentas.length ? "Quitar todas" : "Todas"}</button></div></header>
    <div class="body"><div class="cuentas-grid">${cuentas.map(c => `<label class="cuenta-card ${G.cuentas.has(c.cuenta) ? "on" : ""}"><input type="checkbox" data-gcuenta="${esc(c.cuenta)}" ${G.cuentas.has(c.cuenta) ? "checked" : ""}>
      <span class="cc-n">${esc(c.nombre)}</span><span class="cc-r mono">act_${esc(c.cuenta)} · ${esc(c.moneda)}</span></label>`).join("") || `<div class="empty">Ninguna cuenta coincide.</div>`}</div>
    <div class="gestor-filtros">
      <div class="seg">${Object.keys(NIVEL_G).map(k => `<label class="opt ${G.nivel===k?"on":""}"><input type="radio" name="gnivel" value="${k}" data-gnivel ${G.nivel===k?"checked":""}> ${NIVEL_G[k]}</label>`).join("")}</div>
      <select id="gPeriodo" style="width:auto">${PERIODO_G.map(([v,t]) => `<option value="${v}" ${G.periodo===v?"selected":""}>${t}</option>`).join("")}</select>
      <select id="gEstados" style="width:auto"><option value="VIVOS" ${G.estados==="VIVOS"?"selected":""}>Activas y en pausa</option><option value="ACTIVOS" ${G.estados==="ACTIVOS"?"selected":""}>Solo activas</option><option value="PAUSADOS" ${G.estados==="PAUSADOS"?"selected":""}>Solo en pausa</option></select>
      <input type="text" id="gTexto" placeholder="Nombre contiene… (en Meta)" value="${esc(G.texto)}" style="flex:1;min-width:180px">
      <button class="btn go" id="gCargar" ${G.cargando || !G.cuentas.size ? "disabled" : ""}>${G.cargando ? `<span class="spinner"></span> Cargando…` : G.cargado ? "Volver a cargar" : "Cargar " + NIVEL_G[G.nivel].toLowerCase()}</button>
    </div></div></div>
  ${G.error ? `<div class="note stop" style="margin-bottom:16px">${esc(G.error)}</div>` : ""}
  ${G.errores.length ? `<div class="note warn" style="margin-bottom:16px"><ul style="margin:0">${G.errores.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
  ${G.resultado ? resultadoGestorHTML() : ""}
  ${G.cargado ? tablaGestorHTML() : ""}`;
}
function tablaGestorHTML(){
  const xs = filasVisiblesG(), vis = xs.slice(0, G.limite);
  const selVis = vis.filter(f => G.sel.has(f.id)).length;
  const totales = {};
  /* Totales por moneda y por tipo de resultado: gasto sumado y resultados sin mezclar tipos ni universos. */
  xs.forEach(f => { const m = f.moneda; totales[m] = totales[m] || { gasto:0, res:{} }; totales[m].gasto += f.gasto;
    const r = resultadoDe(f); if (r){ const e = etiquetaResultado(f); totales[m].res[e] = (totales[m].res[e] || 0) + r; } });
  const th = (k, t, cls) => `<th class="${cls||""} ord ${G.orden.col===k?"on":""}" data-gorden="${k}">${t}${G.orden.col===k ? (G.orden.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
  return `<div class="panel"><header><div><h2>${xs.length} ${NIVEL_G[G.nivel].toLowerCase()} en ${G.resumen.length} ${G.resumen.length===1?"cuenta":"cuentas"}</h2>
      <p>${Object.keys(totales).map(m => "Gasto " + fmtD(totales[m].gasto, m) + Object.keys(totales[m].res).map(e => " · " + fmtD(totales[m].res[e]) + " " + e).join("")).join(" · ") || "Sin gasto en el periodo"} · ${esc((PERIODO_G.find(p => p[0]===G.periodo)||[])[1]||"")}</p></div>
    <div class="row-actions"><input type="text" id="gBuscar" placeholder="Filtrar la tabla…" value="${esc(G.buscar)}" style="width:220px;min-height:34px"></div></header>
    ${G.sel.size ? masivoHTML() : ""}
    <div class="scroll tabla-g-caja"><table class="rows tabla-g"><thead><tr>
      <th class="chk"><input type="checkbox" id="gSelTodo" ${selVis && selVis === vis.length ? "checked" : ""} aria-label="Seleccionar todo"></th>
      ${th("cuentaNombre","Cuenta")}${th("nombre","Nombre")}${th("estado","Estado")}${G.nivel !== "ad" ? th("presupuesto","Presupuesto","num") : ""}${G.nivel !== "ad" ? th("fin","Fin") : ""}
      ${th("gasto","Gasto","num")}${th("resultado","Resultados","num")}<th class="num">Costo/res.</th>${th("impresiones","Impr.","num")}<th></th></tr></thead><tbody>
      ${vis.map(filaGestorHTML).join("")}
      </tbody></table></div>
    ${xs.length > vis.length ? `<div class="body" style="text-align:center"><button class="btn ghost sm" id="gMas">Mostrar ${Math.min(150, xs.length - vis.length)} más (de ${xs.length - vis.length})</button></div>` : ""}
    ${!xs.length ? `<div class="body"><div class="empty">Nada coincide con los filtros.</div></div>` : ""}
  </div>`;
}
function filaGestorHTML(f){
  const c = G.cambios[f.id] || {}, cambiado = Object.keys(c).length > 0;
  const st = valorG(f, "status"), activo = st === "ACTIVE";
  const presu = f.diario ? "diario" : f.total ? "total" : "";
  const res = resultadoDe(f), cpr = res ? f.gasto / res : 0;
  const efectivoTxt = f.efectivo && f.efectivo !== f.estado ? `<small class="efec">${esc(pillTxt(f.efectivo))}</small>` : "";
  return `<tr data-gfila="${esc(f.id)}" class="${cambiado ? "cambiada" : ""} ${G.sel.has(f.id) ? "sel" : ""}">
    <td class="chk"><input type="checkbox" data-gsel ${G.sel.has(f.id) ? "checked" : ""} aria-label="Seleccionar"></td>
    <td class="cta-c" title="act_${esc(f.cuenta)}">${esc(f.cuentaNombre)}</td>
    <td class="nom"><input type="text" data-gcampo="name" value="${esc(valorG(f,"name"))}" class="${"name" in c ? "mod" : ""}">${f.padre ? `<small>${esc(f.padre)}</small>` : ""}</td>
    <td><button type="button" class="switch ${activo ? "on" : ""} ${"status" in c ? "mod" : ""}" data-gtoggle aria-pressed="${activo}"><i></i>${activo ? "Activo" : "En pausa"}</button>${efectivoTxt}</td>
    ${G.nivel !== "ad" ? `<td class="num">${presu ? `<input type="number" min="0" step="1" data-gcampo="${presu}" value="${esc(valorG(f, presu))}" class="${presu in c ? "mod" : ""}"><small>${presu} · ${esc(f.moneda)}</small>` : `<span class="dim">${G.nivel === "adset" ? "en campaña" : "en conjuntos"}</span>`}</td>
    <td><input type="date" data-gcampo="fin" value="${esc(valorG(f,"fin"))}" class="${"fin" in c ? "mod" : ""}"></td>` : ""}
    <td class="num mono">${fmtD(f.gasto)}</td>
    <td class="num mono">${res ? fmtD(res) + `<small>${esc(etiquetaResultado(f))}</small>` : "—"}</td>
    <td class="num mono">${cpr ? fmtD(cpr) : "—"}</td>
    <td class="num mono">${fmtD(f.impresiones)}</td>
    <td>${cambiado ? `<button class="btn link sm" data-gdeshacer title="Deshacer los cambios de esta fila">Deshacer</button>` : ""}</td></tr>`;
}
function pillTxt(e){ return ({ ACTIVE:"activo", PAUSED:"en pausa", CAMPAIGN_PAUSED:"campaña en pausa", ADSET_PAUSED:"conjunto en pausa", WITH_ISSUES:"con problemas", IN_PROCESS:"en proceso", PENDING_REVIEW:"en revisión", DISAPPROVED:"rechazado" })[e] || String(e||"").toLowerCase(); }
function masivoHTML(){
  const m = G.masivo, conPresu = G.nivel !== "ad";
  return `<div class="masivo"><b>${G.sel.size} ${G.sel.size === 1 ? "seleccionado" : "seleccionados"}</b>
    <button class="btn ghost sm" data-gm="pausar">Pausar</button><button class="btn ghost sm" data-gm="activar">Activar</button>
    ${conPresu ? `<span class="sep"></span><label>Presupuesto <input type="number" id="gmPct" placeholder="±%" value="${esc(m.pct)}"></label><button class="btn ghost sm" data-gm="pct">Aplicar %</button>
    <label>o fijar <input type="number" id="gmMonto" placeholder="monto" value="${esc(m.monto)}"></label><button class="btn ghost sm" data-gm="monto">Fijar</button>
    <span class="sep"></span><label>Fin <input type="date" id="gmFin" value="${esc(m.fin)}"></label><button class="btn ghost sm" data-gm="fin">Fijar</button>` : ""}
    <span class="sep"></span><label>Renombrar <input type="text" id="gmDe" placeholder="buscar" value="${esc(m.de)}"></label><label>por <input type="text" id="gmA" placeholder="reemplazo" value="${esc(m.a)}"></label><button class="btn ghost sm" data-gm="renombrar">Reemplazar</button>
    <button class="btn link sm" data-gm="limpiar">Quitar selección</button></div>`;
}
function resultadoGestorHTML(){
  const r = G.resultado, malos = r.resultados.filter(x => !x.ok);
  return `<div class="note ${malos.length ? (r.aplicados ? "warn" : "stop") : "go"}" style="margin-bottom:16px"><strong>${r.aplicados} ${r.aplicados === 1 ? "cambio aplicado" : "cambios aplicados"}${malos.length ? " · " + malos.length + " con error" : ""}.</strong>
    ${malos.length ? `<ul>${malos.slice(0, 12).map(x => `<li>${esc((filaG(x.id) || {}).nombre || x.id)}: ${esc(x.error)}</li>`).join("")}</ul>` : " Quedaron registrados en la bitácora."}
    <button class="btn link sm" id="gCerrarRes">Cerrar</button></div>`;
}

/* ---------------------------------------------------------------- eventos */
function aGestor(){
  const fc = $("#gFiltroCuenta"); if (fc) fc.oninput = () => { G.filtroCuenta = fc.value; const pos = fc.selectionStart; render(); const n = $("#gFiltroCuenta"); if (n){ n.focus(); n.setSelectionRange(pos, pos); } };
  const td = $("#gTodas"); if (td) td.onclick = () => { if (G.cuentas.size === S.cuentas.length) G.cuentas.clear(); else S.cuentas.forEach(c => G.cuentas.add(c.cuenta)); render(); };
  document.querySelectorAll("[data-gcuenta]").forEach(cb => cb.onchange = () => { cb.checked ? G.cuentas.add(cb.dataset.gcuenta) : G.cuentas.delete(cb.dataset.gcuenta); render(); });
  document.querySelectorAll("[data-gnivel]").forEach(r => r.onchange = () => {
    if (nCambiosG() && !confirm("Hay " + nCambiosG() + " cambios sin aplicar en " + NIVEL_G[G.nivel].toLowerCase() + ". ¿Descartarlos?")){ render(); return; }
    G.nivel = r.value; G.cambios = {}; G.cargado = false; G.filas = []; G.resultado = null; render();
  });
  const pe = $("#gPeriodo"); if (pe) pe.onchange = () => { G.periodo = pe.value; };
  const es = $("#gEstados"); if (es) es.onchange = () => { G.estados = es.value; };
  const tx = $("#gTexto"); if (tx){ tx.oninput = () => { G.texto = tx.value; }; tx.onkeydown = e => { if (e.key === "Enter") cargarGestor(); }; }
  const cg = $("#gCargar"); if (cg) cg.onclick = cargarGestor;
  const bu = $("#gBuscar"); if (bu) bu.oninput = () => { G.buscar = bu.value; const pos = bu.selectionStart; render(); const n = $("#gBuscar"); if (n){ n.focus(); n.setSelectionRange(pos, pos); } };
  const mas = $("#gMas"); if (mas) mas.onclick = () => { G.limite += 150; render(); };
  const cr = $("#gCerrarRes"); if (cr) cr.onclick = () => { G.resultado = null; render(); };
  document.querySelectorAll("[data-gorden]").forEach(h => h.onclick = () => { const k = h.dataset.gorden; G.orden = { col:k, dir: G.orden.col === k ? -G.orden.dir : (["nombre","cuentaNombre","estado","fin"].includes(k) ? 1 : -1) }; render(); });
  const st = $("#gSelTodo"); if (st) st.onchange = () => { filasVisiblesG().slice(0, G.limite).forEach(f => st.checked ? G.sel.add(f.id) : G.sel.delete(f.id)); render(); };
  document.querySelectorAll("[data-gfila]").forEach(tr => {
    const f = filaG(tr.dataset.gfila); if (!f) return;
    tr.querySelector("[data-gsel]").onchange = e => { e.target.checked ? G.sel.add(f.id) : G.sel.delete(f.id); render(); };
    tr.querySelector("[data-gtoggle]").onclick = () => { cambiarG(f, "status", valorG(f, "status") === "ACTIVE" ? "PAUSED" : "ACTIVE"); render(); };
    tr.querySelectorAll("[data-gcampo]").forEach(inp => inp.onchange = () => {
      const k = inp.dataset.gcampo; let v = inp.value;
      if (k === "diario" || k === "total") v = v === "" ? "" : Number(v);
      cambiarG(f, k, v); render();
    });
    const d = tr.querySelector("[data-gdeshacer]"); if (d) d.onclick = () => { delete G.cambios[f.id]; render(); };
  });
  ["gmPct","gmMonto","gmFin","gmDe","gmA"].forEach(id => { const el = $("#" + id); if (el) el.oninput = () => { G.masivo[{gmPct:"pct",gmMonto:"monto",gmFin:"fin",gmDe:"de",gmA:"a"}[id]] = el.value; }; });
  document.querySelectorAll("[data-gm]").forEach(bt => bt.onclick = () => accionMasiva(bt.dataset.gm));
}
function accionMasiva(acc){
  const xs = [...G.sel].map(filaG).filter(Boolean), m = G.masivo;
  let n = 0;
  if (acc === "limpiar"){ G.sel.clear(); render(); return; }
  xs.forEach(f => {
    if (acc === "pausar"){ cambiarG(f, "status", "PAUSED"); n++; }
    if (acc === "activar"){ cambiarG(f, "status", "ACTIVE"); n++; }
    const k = f.diario ? "diario" : f.total ? "total" : "";
    if (acc === "pct" && k && Number(m.pct)){ const base = Number(valorG(f, k)) || 0; cambiarG(f, k, Math.max(1, Math.round(base * (1 + Number(m.pct) / 100)))); n++; }
    if (acc === "monto" && k && Number(m.monto) > 0){ cambiarG(f, k, Number(m.monto)); n++; }
    if (acc === "fin" && m.fin){ cambiarG(f, "fin", m.fin); n++; }
    if (acc === "renombrar" && m.de){ const nv = String(valorG(f, "name")).split(m.de).join(m.a || ""); if (nv !== valorG(f, "name")){ cambiarG(f, "name", nv); n++; } }
  });
  toast(n ? n + (n === 1 ? " fila modificada" : " filas modificadas") + ". Revisa y aplica abajo." : "Ninguna fila cambió con esa acción.", n ? "ok" : "warn");
  render();
}

/* --------------------------------------------------- revisión y aplicación */
function listaCambiosG(){
  return Object.keys(G.cambios).map(id => ({ f: filaG(id), c: G.cambios[id] })).filter(x => x.f);
}
function riesgosG(lista){
  const r = [];
  const activa = lista.filter(x => x.c.status === "ACTIVE");
  if (activa.length) r.push({ nivel:"revisar", texto: activa.length + " " + (activa.length === 1 ? "objeto se activa" : "objetos se activan") + " y empezará(n) a gastar." });
  lista.forEach(({ f, c }) => {
    ["diario","total"].forEach(k => { if (k in c && f[k] && c[k] > f[k] * 1.5) r.push({ nivel:"revisar", texto:'"' + f.nombre + '": el presupuesto ' + k + " sube " + Math.round((c[k] / f[k] - 1) * 100) + "% (" + fmtD(f[k], f.moneda) + " → " + fmtD(c[k], f.moneda) + ")." }); });
    const cta = S.cuentas.find(x => x.cuenta === f.cuenta);
    if ("diario" in c && cta && cta.minImp && c.diario < cta.minImp) r.push({ nivel:"bloquea", texto:'"' + f.nombre + '": ' + fmtD(c.diario, f.moneda) + " diarios está por debajo del mínimo de la cuenta (" + fmtD(cta.minImp, f.moneda) + ")." });
    if ("name" in c && !String(c.name).trim()) r.push({ nivel:"bloquea", texto:'"' + f.nombre + '": el nombre no puede quedar vacío.' });
    if ("fin" in c && c.fin && c.fin < hoy()) r.push({ nivel:"bloquea", texto:'"' + f.nombre + '": la fecha de fin ya pasó.' });
  });
  return r;
}
function modalGestor(){
  const lista = listaCambiosG(), riesgos = riesgosG(lista);
  const porCuenta = {};
  lista.forEach(x => { (porCuenta[x.f.cuentaNombre] = porCuenta[x.f.cuentaNombre] || []).push(x); });
  const txt = (k, v, f) => k === "status" ? (v === "ACTIVE" ? "Activo" : "En pausa") : (k === "diario" || k === "total") ? fmtD(v, f.moneda) : k === "fin" ? (v || "sin fin") : v;
  const orig = (f, k) => ({ status:f.estado, name:f.nombre, diario:f.diario, total:f.total, fin:String(f.fin||"").slice(0,10) })[k];
  const bloquea = riesgos.some(r => r.nivel === "bloquea");
  return ["Revisar cambios", lista.length + (lista.length === 1 ? " objeto" : " objetos") + " en " + Object.keys(porCuenta).length + (Object.keys(porCuenta).length === 1 ? " cuenta" : " cuentas"),
    `${riesgos.length ? `<div class="al-caja" style="margin-bottom:14px">${alertasHTML(riesgos, { sinSaltos:true })}</div>` : ""}
    ${Object.keys(porCuenta).map(n => `<h3>${esc(n)}</h3><table class="tabla-fm"><tbody>${porCuenta[n].map(({ f, c }) => `<tr><td><b>${esc(f.nombre)}</b><small>${esc(NIVEL_G[f.nivel].slice(0,-1))}${f.padre ? " · " + esc(f.padre) : ""}</small></td>
      <td>${Object.keys(c).map(k => `<div class="diff"><span class="k">${({ status:"Estado", name:"Nombre", diario:"Diario", total:"Total", fin:"Fin" })[k]}</span><s>${esc(txt(k, orig(f, k), f) || "—")}</s> → <b>${esc(txt(k, c[k], f))}</b></div>`).join("")}</td></tr>`).join("")}</tbody></table>`).join("")}
    <div class="res-acciones"><button class="btn go" id="gAplicar" ${bloquea || G.aplicando ? "disabled" : ""}>${G.aplicando ? `<span class="spinner"></span> Aplicando…` : "Aplicar " + lista.length + (lista.length === 1 ? " cambio" : " cambios") + " en Meta"}</button>
      <button class="btn ghost" data-cerrar>Seguir editando</button>
      ${bloquea ? `<span class="hint warn-t">Corrige lo marcado en rojo antes de aplicar.</span>` : `<span class="hint">Cada cambio queda en la bitácora con el valor anterior.</span>`}</div>`];
}
function ligarModalGestor(caja){
  const c = caja.querySelector("[data-cerrar]"); if (c) c.onclick = cerrarModal;
  const a = caja.querySelector("#gAplicar"); if (a) a.onclick = aplicarGestor;
}
async function aplicarGestor(){
  const lista = listaCambiosG();
  if (!lista.length) return;
  G.aplicando = true; pintarModal();
  try {
    const cambios = lista.map(({ f, c }) => {
      const campos = {};
      if ("status" in c) campos.status = c.status;
      if ("name" in c) campos.name = c.name;
      if ("diario" in c) campos.daily_budget = c.diario;
      if ("total" in c) campos.lifetime_budget = c.total;
      if ("fin" in c && c.fin) campos.fin = c.fin;
      return { id:f.id, cuenta:f.cuenta, nivel:f.nivel, nombre:f.nombre, campos, antes:{ estado:f.estado, nombre:f.nombre, diario:f.diario, total:f.total, fin:f.fin } };
    });
    const r = await llamar("gestor", { op:"aplicar", cambios });
    G.resultado = r;
    (r.resultados || []).forEach(x => { if (x.ok) delete G.cambios[x.id]; });
    toast(r.aplicados + " cambios aplicados" + (r.fallidos ? " · " + r.fallidos + " con error" : "") + ".", r.fallidos ? "warn" : "ok");
    G.aplicando = false; cerrarModal();
    await cargarGestor();
  } catch(e){ G.aplicando = false; toast(e.message, "stop"); pintarModal(); }
}

/* ------------------------------------------------------------ barra inferior */
function mensajesGestor(){
  const msg = $("#msg"), n = nCambiosG();
  msg.className = n ? "msg pend" : "msg";
  msg.innerHTML = n ? icono("alerta") + `<span><b>${n} ${n === 1 ? "cambio" : "cambios"} sin aplicar.</b> Nada se envía a Meta hasta que confirmes.</span><button type="button" class="btn link" id="gDescartar">Descartar</button>`
    : (G.cargado ? icono("ok") + "<span>Sin cambios pendientes.</span>" : "");
  const d = $("#gDescartar"); if (d) d.onclick = () => { if (confirm("¿Descartar los " + n + " cambios?")){ G.cambios = {}; render(); } };
  const nx = $("#next"); nx.classList.remove("hide"); nx.disabled = !n; nx.textContent = n ? "Revisar " + n + (n === 1 ? " cambio" : " cambios") : "Revisar cambios";
}
