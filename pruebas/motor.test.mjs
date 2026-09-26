import { correr } from './simulador-n8n.mjs';
const ok = (c, m) => console.log((c ? 'OK   ' : 'FALLA') + ' ' + m);
// 1) lote_accion con accion_lote (lo que manda el sitio 5.7)
let r = await correr('Buscar en Meta', { body: { accion: 'buscar', tipo: 'lote_accion', cuenta_id: '1', lote_id: 'L1', accion_lote: 'PAUSED', ids: { campanas: ['11'], conjuntos: [], anuncios: ['33'] } },
  rutas: [
    { match: /adlabels/, res: { data: [{ id: '900', name: 'mbe_L1' }] } },
    { method: 'POST', match: /"relative_url":"(11|33)\?fields/, res: (u, o) => { const b = JSON.parse(new URLSearchParams(o.body).get('batch')); return b.map(x => ({ code: 200, body: JSON.stringify({ id: x.relative_url.split('?')[0], name: 'obj', adlabels: [{ id: '900' }] }) })); } },
    { method: 'POST', match: /status=PAUSED/, res: (u, o) => JSON.parse(new URLSearchParams(o.body).get('batch')).map(() => ({ code: 200, body: '{"success":true}' })) },
  ] });
ok(r.out.ok === 2 && !r.out.fallos.length, 'lote_accion pausa 2 objetos con accion_lote → ' + JSON.stringify(r.out));
// 2) gestor aplicar rechaza objeto de otra cuenta
r = await correr('Gestor multicuenta', { body: { accion: 'gestor', op: 'aplicar', usuario: 'a@abcw.mx', cambios: [
    { id: '501', cuenta: '1', nivel: 'campaign', nombre: 'X', campos: { daily_budget: 500 }, antes: { diario: 400 } },
    { id: '502', cuenta: '1', nivel: 'campaign', nombre: 'Y', campos: { name: 'Nuevo' }, antes: { nombre: 'Y' } }] },
  rutas: [
    { match: /act_1\?fields=name,currency/, res: { name: 'MX', currency: 'MXN', timezone_name: 'America/Mexico_City', min_daily_budget: '2000' } },
    { method: 'POST', match: /account_id/, res: [{ code: 200, body: JSON.stringify({ id: '501', account_id: '2' }) }, { code: 200, body: JSON.stringify({ id: '502', account_id: '1' }) }] },
    { method: 'POST', match: /name=Nuevo/, res: [{ code: 200, body: '{"success":true}' }] },
  ] });
const r501 = r.out.resultados.find(x => x.id === '501'), r502 = r.out.resultados.find(x => x.id === '502');
ok(!r501.ok && /pertenece a la cuenta 2/.test(r501.error) && r502.ok, 'gestor: 501 (otra cuenta) rechazado, 502 aplicado → ' + JSON.stringify(r.out.resultados));
ok(r.out.bitacora.every(x => x.operador === 'a@abcw.mx'), 'gestor: la bitácora registra el usuario de la sesión');
// 3) chequeo_meta: dataset solo CAPI y página con WhatsApp confirmada por conjuntos
r = await correr('Buscar en Meta', { body: { accion: 'buscar', tipo: 'chequeo_meta', cuenta_id: '1', page_id: '77' },
  rutas: [
    { match: /me\/permissions/, res: { data: [] } },
    { match: /debug_token/, res: { data: { type: 'SYSTEM_USER', is_valid: true, expires_at: 0 } } },
    { match: /act_1\?fields=name,account_status/, res: { name: 'IZZI WHATSAPP', account_status: 1, currency: 'MXN', timezone_name: 'America/Mexico_City' } },
    { match: /act_1\/adspixels/, res: { data: [{ id: 'P1', name: 'Facebook 3 B Event Data' }] } },
    { match: /P1\/stats/, res: { data: [{ start_time: new Date(Date.now() - 3600e3).toISOString().slice(0, 19) + '+0000', data: [{ value: 'Purchase', count: 130 }, { value: 'LeadSubmitted', count: 547 }] }] } },
    { match: /act_1\/adsets/, res: { data: [{ destination_type: 'WHATSAPP', promoted_object: { page_id: '77', whatsapp_phone_number: '+5215512345678' } }] } },
    { match: /\/77\?fields=name,instagram/, res: { name: 'izzi telecom' } },
    { match: /\/77\?fields=access_token/, res: { access_token: 'ptk' } },
    { match: /\/77\?fields=leadgen_tos_accepted/, res: { leadgen_tos_accepted: true } },
    { match: /\/77\?fields=whatsapp_number/, res: {} },
  ] });
const px = r.out.pasos.find(x => /Píxel/.test(x.punto)), wa = r.out.pasos.find(x => /WhatsApp/.test(x.grupo)), ver = r.out.pasos.find(x => /Versión/.test(x.punto));
ok(px.estado === 'ok' && /677 eventos/.test(px.detalle) && /solo por servidor/.test(px.detalle), 'chequeo: dataset CAPI → ' + px.detalle);
ok(wa.estado === 'ok' && /ya anuncian a WhatsApp/.test(wa.detalle), 'chequeo: WhatsApp confirmado → ' + wa.detalle);
ok(ver.estado === 'ok', 'chequeo: v26.0 ok → ' + ver.detalle);
r = await correr('Buscar en Meta', { body: { accion: 'buscar', tipo: 'version' }, vars: { META_API_VERSION: 'v25.0' } });
ok(r.out.motor_version === '5.7.0' && r.out.api_recomendada === 'v26.0', 'version → ' + JSON.stringify(r.out));
// 4) whatsapp: WABA encontrada por granular_scopes
r = await correr('Buscar en Meta', { body: { accion: 'buscar', tipo: 'whatsapp', cuenta_id: '1', page_id: '77' },
  rutas: [
    { match: /act_1\/adsets/, res: { data: [] } },
    { match: /act_1\?fields=business/, res: { business: { id: 'B1', name: 'ABCW' } } },
    { match: /me\/businesses/, res: { data: [] } },
    { match: /me\/permissions/, res: { data: [{ permission: 'whatsapp_business_management', status: 'granted' }] } },
    { match: /B1\/(owned|client)_whatsapp/, res: { data: [] } },
    { match: /debug_token/, res: { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['803058249331497'] }] } } },
    { match: /803058249331497\?fields=id,name/, res: { id: '803058249331497', name: 'izzi WhatsApp' } },
    { match: /803058249331497\/phone_numbers/, res: { data: [{ display_phone_number: '+52 55 1234 5678', verified_name: 'izzi' }] } },
    { match: /\/77\?fields=whatsapp_number/, res: {} },
  ] });
ok(r.out.resultados.length === 1 && r.out.diagnostico.wabas === 1, 'whatsapp: número desde WABA asignada al token → ' + JSON.stringify(r.out.resultados.map(x => x.n)));
