// Pruebas de la plataforma contra la API simulada: node pruebas/api.test.mjs
import http from 'node:http';
import { cargar } from './arnes-api.mjs';
const log = console.log; console.log = () => {}; console.warn = () => {};
let fallas = 0;
const ok = (c, m) => { log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallas++; };
const motor = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(j.accion === 'cuentas' ? { cuentas: [{ cuenta: '100000000000001' }, { cuenta: '100000000000002' }] } : j.accion === 'historial' ? { corridas: [{ run_id: 'run_1', cuenta: '100000000000001' }, { run_id: 'run_2', cuenta: '100000000000002' }] } : { ok: true })); }); }).listen(18999);
process.env.MOTOR_URL = 'http://127.0.0.1:18999/webhook'; process.env.MOTOR_SHARED_SECRET = 's'.repeat(20);
const { call, login, usar } = await cargar();

const h = await call('GET', '/api/health');
ok(h.json.version === '6.1.0' && h.json.metaVersion === 'v26.0', 'health 6.1.0 con v26.0 por defecto');

const admin = await login('admin@abcw.mx');
const chk = await call('GET', '/api/meta/check?accountId=act_100000000000001');
const item = (re) => chk.json.checks.find((c) => re.test(c.item));
const capi = item(/solo CAPI/);
ok(capi && capi.status === 'ok' && /eventos en 7 días/.test(capi.detail) && /solo por servidor/.test(capi.detail), 'dataset solo CAPI con actividad real: ' + capi?.detail);
const telecom = item(/WhatsApp de "izzi telecom"/);
ok(telecom?.status === 'ok' && /el vínculo funciona/.test(telecom.detail), 'página sin whatsapp_number confirmada por conjuntos');
ok(!chk.json.checks.some((c) => c.status === 'warning' && /Sin dataset: ABCW WhatsApp/.test(c.detail)), 'WABA ajena sin dataset no genera advertencia');
ok(item(/Cuentas de WhatsApp Business/)?.detail.includes('izzi telecom · Ventas WhatsApp'), 'WABA descubierta por granular_scopes');
const ev = await call('GET', '/api/accounts/act_100000000000001/events');
ok(ev.json.datasets.find((d) => d.id === '500901')?.lastFiredTime, 'Centro de eventos: fecha de último evento en dataset CAPI');
const as = await call('GET', '/api/accounts/act_100000000000001/assets');
ok(as.json.value.pixels.every((p) => p.lastFiredTime), 'assets: todos los datasets activos tienen lastFiredTime');

// Permisos por cuenta
const coord = await login('coord@abcw.mx');
usar(admin);
await call('PUT', '/api/users/coord@abcw.mx', { role: 'coordinador', accountIds: ['act_100000000000002'] });
const camp = (await call('GET', '/api/accounts/act_100000000000001/structure?metrics=0')).json.campaigns[0];
await login('coord@abcw.mx');
ok((await call('GET', '/api/meta/check?accountId=act_100000000000001')).status === 403, 'chequeo de cuenta ajena → 403');
ok((await call('POST', '/api/rules/run', { accountId: 'act_100000000000001' })).status === 403, 'reglas en cuenta ajena → 403');
const ap = await call('POST', '/api/changes/apply', { changes: [{ id: 'c1', kind: 'update', level: 'campaign', accountId: 'act_100000000000002', entityId: camp.id, entityName: camp.name, fields: { name: { before: camp.name, after: 'X' } } }] });
ok(ap.json.results[0].ok === false && /pertenece a la cuenta/.test(ap.json.results[0].error), 'cambio sobre objeto de otra cuenta rechazado');
ok((await call('POST', '/api/motor', { accion: 'gestor', op: 'listar', cuentas: '100000000000001' })).status === 403, 'motor: gestor sobre cuenta ajena → 403');
ok((await call('POST', '/api/motor', { accion: 'cuentas' })).json.cuentas.length === 1, 'motor: lista de cuentas filtrada');
ok((await call('POST', '/api/motor', { accion: 'historial' })).json.corridas.map((c) => c.run_id).join() === 'run_2', 'motor: historial filtrado');
ok((await call('POST', '/api/alerts/dismiss', { keys: ['user/admin@abcw.mx'] })).status === 200, 'dismiss con clave ajena no falla');
usar(admin);
ok(!JSON.stringify((await call('GET', '/api/users')).json).includes('dismissed'), 'dismiss no escribe fuera de alert/');
// Gestor: subida > 50 % requiere director (coordinador sí publica)
await call('PUT', '/api/users/coord@abcw.mx', { role: 'coordinador', accountIds: [] });
const st = (await call('GET', '/api/accounts/act_100000000000001/structure?metrics=0&force=1')).json;
const cbo = st.campaigns.find((c) => c.dailyBudget);
await login('coord@abcw.mx');
const g1 = await call('POST', '/api/motor', { accion: 'gestor', op: 'aplicar', cambios: [{ id: cbo.id, cuenta: '100000000000001', nivel: 'campaign', nombre: cbo.name, campos: { daily_budget: cbo.dailyBudget * 2 }, antes: { diario: cbo.dailyBudget * 2 } }] });
ok(g1.status === 403 && /requiere aprobación/.test(g1.json.error), 'gestor: +100 % de presupuesto sin director → 403 (con el valor real de Meta)');
const g2 = await call('POST', '/api/motor', { accion: 'gestor', op: 'aplicar', cambios: [{ id: cbo.id, cuenta: '100000000000001', nivel: 'campaign', nombre: cbo.name, campos: { daily_budget: cbo.dailyBudget * 1.2 }, antes: { diario: cbo.dailyBudget } }] });
ok(g2.status === 200, 'gestor: +20 % permitido');
const g3 = await call('POST', '/api/motor', { accion: 'gestor', op: 'aplicar', cambios: [{ id: cbo.id, cuenta: '100000000000002', nivel: 'campaign', nombre: cbo.name, campos: { name: 'x' }, antes: {} }] });
ok(g3.status === 400 && /pertenece a la cuenta/.test(g3.json.error), 'gestor: objeto de otra cuenta → 400');
await login('analista@abcw.mx');
ok((await call('POST', '/api/motor', { accion: 'buscar', tipo: 'diagnostico_referencia', cuenta_id: '100000000000001', adset_id: '1' })).status === 403, 'motor: analista no puede lanzar el diagnóstico de referencia (escribe en Meta)');
ok((await call('POST', '/api/motor', { accion: 'buscar', tipo: 'lote_accion', cuenta_id: '100000000000001', accion_lote: 'ACTIVE' })).status === 403, 'motor: analista no puede activar un lote');
ok((await call('POST', '/api/motor', { accion: 'buscar', tipo: 'paises', texto: 'mex' })).status === 200, 'motor: analista sí puede buscar');
motor.close();
log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fallas ? 1 : 0);
