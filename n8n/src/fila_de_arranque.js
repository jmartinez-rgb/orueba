/* motor 5.0 · La corrida se abre ANTES de validar: el navegador recibe el run_id
   de inmediato y la validación corre sin el límite de 26 s del proxy de Netlify. */
const b = $('Recibir').first().json.body || {};
const f = b.filas || {};
const runId = 'run_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  + '_' + Math.random().toString(36).slice(2, 7);
const ahora = new Date().toISOString();
return [{ json: {
  run_id: runId,
  creado_en: ahora,
  actualizado_en: ahora,
  client_key: String(b.client_key || ''),
  cuenta_id: String(b.cuenta_id || '').replace(/^act_/, ''),
  campana: String(b.campana || ''),
  estado: 'EN_PROCESO',
  anuncios_previstos: (f.ads || []).length,
  anuncios_publicados: 0,
  errores: 0,
  mensaje: 'Validando el plan…',
  detalle: 'fase:validacion',
  operador: String(b.operador || ''),
} }];
