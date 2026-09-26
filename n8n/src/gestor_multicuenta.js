/* ---- motor 5.5 · gestor multicuenta ----
   accion "gestor":
     op "listar"  → campañas, conjuntos o anuncios de varias cuentas, con métricas del periodo
     op "aplicar" → cambios (estado, nombre, presupuesto, fecha de fin) en lotes de 50 por cuenta;
                    deja cada cambio en la bitácora (después de responder).
   Responde dentro de los 26 s del proxy: las cuentas se leen en paralelo (4 a la vez). */
const b = $('Recibir').first().json.body || {};
const op = String(b.op || 'listar');
const T0 = Date.now();
const NIVELES = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };
const PERIODOS = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'maximum'];
const act_ = id => 'act_' + String(id || '').replace(/^act_/, '');

async function enParalelo(items, n, fn){
  const out = new Array(items.length); let i = 0;
  async function trabajador(){ while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
  return out;
}
async function paginarHasta(url, tope, limiteMs){
  const out = []; let u = url;
  for (let i = 0; i < 10 && u && out.length < tope; i++) {
    if (limiteMs && Date.now() - T0 > limiteMs) break;
    const r = await gGet(u); (r.data || []).forEach(x => out.push(x));
    u = r.paging && r.paging.next ? r.paging.next : null;
  }
  return out;
}
const suma = (acts, tipos) => (acts || []).filter(a => tipos.indexOf(a.action_type) >= 0).reduce((t, a) => Math.max(t, Number(a.value) || 0), 0);

try {
  if (op === 'listar') {
    const cuentas = lista(b.cuentas).slice(0, 20);
    if (!cuentas.length) throw new Error('Elige al menos una cuenta.');
    const nivel = NIVELES[b.nivel] ? String(b.nivel) : 'campaign';
    const periodo = PERIODOS.indexOf(String(b.periodo)) >= 0 ? String(b.periodo) : 'last_7d';
    const estados = lista(b.estados).filter(x => /^[A-Z_]+$/.test(x));
    const filtros = [{ field: 'effective_status', operator: 'IN', value: estados.length ? estados : ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'WITH_ISSUES', 'IN_PROCESS', 'PENDING_REVIEW'] }];
    const texto = String(b.texto || '').trim();
    if (texto) filtros.push({ field: 'name', operator: 'CONTAIN', value: texto });
    const CAMPOS = {
      campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy',
      adset: 'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,destination_type,campaign{id,name}',
      ad: 'id,name,status,effective_status,adset{id,name},campaign{id,name}',
    }[nivel];
    const errores = [], resumen = [];
    const porCuenta = await enParalelo(cuentas, 4, async (cid) => {
      const act = act_(cid);
      try {
        const info = await gGet(base + act + '?fields=name,currency,timezone_name,min_daily_budget,account_status');
        const mon = info.currency;
        const objs = await paginarHasta(base + act + '/' + NIVELES[nivel] + '?fields=' + encodeURIComponent(CAMPOS)
          + '&filtering=' + encodeURIComponent(JSON.stringify(filtros)) + '&limit=200', 1000, 20000);
        const met = {};
        try {
          const ins = await paginarHasta(base + act + '/insights?level=' + nivel + '&date_preset=' + periodo
            + '&use_unified_attribution_setting=true&fields=' + nivel + '_id,spend,impressions,clicks,actions&limit=500', 3000, 21000);
          ins.forEach(x => { met[String(x[nivel + '_id'])] = x; });
        } catch (e) { errores.push((info.name || act) + ': sin métricas (' + explicar(e) + ').'); }
        resumen.push({ id: act.replace('act_', ''), nombre: info.name || act, moneda: mon, tz: info.timezone_name || '', minimo: aMayor(info.min_daily_budget, mon), objetos: objs.length });
        return objs.map(o => {
          const m = met[String(o.id)] || {};
          const padre = nivel === 'adset' ? (o.campaign || {}).name : nivel === 'ad' ? ((o.campaign || {}).name || '') + ' › ' + ((o.adset || {}).name || '') : '';
          return {
            id: String(o.id), nivel, cuenta: act.replace('act_', ''), cuentaNombre: info.name || act, moneda: mon,
            nombre: o.name || '', estado: o.status || '', efectivo: o.effective_status || '',
            objetivo: o.objective || o.optimization_goal || '', destino: o.destination_type || '', padre: padre || '',
            diario: o.daily_budget ? aMayor(o.daily_budget, mon) : 0, total: o.lifetime_budget ? aMayor(o.lifetime_budget, mon) : 0,
            fin: o.stop_time || o.end_time || '', inicio: o.start_time || '',
            gasto: Number(m.spend || 0), impresiones: Number(m.impressions || 0), clics: Number(m.clicks || 0),
            leads: suma(m.actions, ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']),
            conversaciones: suma(m.actions, ['onsite_conversion.messaging_conversation_started_7d']),
            /* Compras por universo, según el nombre de la campaña (nunca se mezclan fuentes). */
            ...(() => { const u = comprasPorUniverso(m.actions, nivel === 'campaign' ? o.name : (o.campaign || {}).name); return { compras: u.compras, universo: u.universo }; })(),
          };
        });
      } catch (e) { errores.push('Cuenta ' + cid + ': ' + explicar(e)); return []; }
    });
    const filas = [].concat(...porCuenta);
    return [{ json: { filas, cuentas: resumen, errores, nivel, periodo, parcial: Date.now() - T0 > 22000 } }];
  }

  if (op === 'aplicar') {
    const cambios = (b.cambios || []).slice(0, 500);
    if (!cambios.length) throw new Error('No hay cambios para aplicar.');
    const cuentas = [...new Set(cambios.map(c => String(c.cuenta || '').replace(/^act_/, '')).filter(Boolean))];
    const infoCuenta = {};
    await enParalelo(cuentas, 4, async cid => {
      try { infoCuenta[cid] = await gGet(base + act_(cid) + '?fields=name,currency,timezone_name,min_daily_budget'); }
      catch (e) { infoCuenta[cid] = { error: explicar(e) }; }
    });
    const resultados = [], bitacora = [];
    const corrida = 'cambio_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const valido = [];
    let duenos = {};
    try { duenos = await porIds(cambios.map(c => String(c.id)), 'account_id'); } catch (e) { duenos = {}; }
    cambios.forEach(c => {
      const cid = String(c.cuenta || '').replace(/^act_/, '');
      const inf = infoCuenta[cid] || {};
      const r = { id: String(c.id), ok: false, error: '' };
      if (!inf.currency) { r.error = inf.error || 'No pude leer la cuenta ' + cid + '.'; resultados.push(r); return; }
      const dueno = String((duenos[String(c.id)] || {}).account_id || '').replace(/^act_/, '');
      if (dueno && dueno !== cid) { r.error = 'El objeto pertenece a la cuenta ' + dueno + ', no a ' + cid + '. Vuelve a cargar el gestor.'; resultados.push(r); return; }
      const campos = c.campos || {}, cuerpo = [];
      if (campos.status) {
        if (['ACTIVE', 'PAUSED'].indexOf(campos.status) < 0) { r.error = 'Estado no válido.'; resultados.push(r); return; }
        cuerpo.push('status=' + campos.status);
      }
      if (campos.name != null) {
        const n = String(campos.name).trim();
        if (!n) { r.error = 'El nombre no puede quedar vacío.'; resultados.push(r); return; }
        cuerpo.push('name=' + encodeURIComponent(n.slice(0, 400)));
      }
      const minimo = aMayor(inf.min_daily_budget, inf.currency);
      for (const k of ['daily_budget', 'lifetime_budget']) {
        if (campos[k] == null) continue;
        const v = Number(campos[k]);
        if (!(v > 0)) { r.error = 'El presupuesto debe ser mayor que cero.'; resultados.push(r); return; }
        if (k === 'daily_budget' && minimo && v < minimo) { r.error = 'Presupuesto diario por debajo del mínimo de la cuenta (' + minimo + ' ' + inf.currency + ').'; resultados.push(r); return; }
        if (!((c.antes || {})[k === 'daily_budget' ? 'diario' : 'total'])) { r.error = 'Este objeto no administra presupuesto ' + (k === 'daily_budget' ? 'diario' : 'total') + ' a este nivel.'; resultados.push(r); return; }
        cuerpo.push(k + '=' + aMenor(v, inf.currency));
      }
      if (campos.fin) {
        const iso = isoEnZona(String(campos.fin).slice(0, 10) + ' 23:59', inf.timezone_name || 'UTC');
        if (!iso) { r.error = 'Fecha de fin no válida.'; resultados.push(r); return; }
        if (Date.parse(iso) < Date.now()) { r.error = 'La fecha de fin ya pasó.'; resultados.push(r); return; }
        cuerpo.push((c.nivel === 'campaign' ? 'stop_time' : 'end_time') + '=' + encodeURIComponent(iso));
      }
      if (!cuerpo.length) { r.error = 'Sin cambios.'; resultados.push(r); return; }
      valido.push({ c, r, cuerpo: cuerpo.join('&'), cid, inf });
    });
    for (let i = 0; i < valido.length; i += 50) {
      const bloque = valido.slice(i, i + 50);
      let resp = [];
      try { resp = await gPost('', { include_headers: 'false', batch: bloque.map(x => ({ method: 'POST', relative_url: x.c.id, body: x.cuerpo })) }); }
      catch (e) { bloque.forEach(x => { x.r.error = explicar(e); }); }
      (Array.isArray(resp) ? resp : []).forEach((y, j) => {
        const x = bloque[j];
        if (y && Number(y.code) === 200) x.r.ok = true;
        else { let m = ''; try { const er = JSON.parse(y.body).error || {}; m = er.error_user_msg || er.message || ''; } catch (e) {} x.r.error = m || 'Meta rechazó el cambio.'; }
      });
      bloque.forEach(x => resultados.push(x.r));
    }
    /* Bitácora: una fila por campo cambiado. */
    const ahora = new Date().toISOString();
    cambios.forEach(c => {
      const r = resultados.find(x => x.id === String(c.id)) || {};
      const antes = c.antes || {};
      Object.keys(c.campos || {}).forEach(k => {
        const nombreCampo = { status: 'estado', name: 'nombre', daily_budget: 'presupuesto diario', lifetime_budget: 'presupuesto total', fin: 'fecha de fin' }[k] || k;
        const previo = { status: antes.estado, name: antes.nombre, daily_budget: antes.diario, lifetime_budget: antes.total, fin: String(antes.fin || '').slice(0, 10) }[k];
        bitacora.push({ run_id: corrida, publicado_en: ahora, client_key: 'gestor', cuenta: act_(c.cuenta), campana: String(c.nombre || antes.nombre || ''),
          campaign_id: c.nivel === 'campaign' ? String(c.id) : '', adset_id: c.nivel === 'adset' ? String(c.id) : '', ad_id: c.nivel === 'ad' ? String(c.id) : '', creative_id: '',
          anuncio: 'CAMBIO · ' + nombreCampo + ': ' + (previo == null || previo === '' ? '—' : previo) + ' → ' + c.campos[k],
          estado: r.ok ? 'APLICADO' : 'ERROR', error: r.error || '', operador: String(b.usuario || b.operador || '') });
      });
    });
    const aplicados = resultados.filter(x => x.ok).length;
    return [{ json: { resultados, aplicados, fallidos: resultados.length - aplicados, corrida, bitacora } }];
  }
  throw new Error('Operación del gestor no reconocida: ' + op);
} catch (e) {
  return [{ json: { error: explicar(e), bitacora: [] } }];
}
