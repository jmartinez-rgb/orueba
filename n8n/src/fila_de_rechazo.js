/* motor 5.0 · El plan no pasó la validación (o el validador se detuvo): la
   corrida se cierra como RECHAZADO y el sitio lo recibe en el sondeo. */
const v = $input.first().json || {};
const a = $('Fila de arranque').first().json;
const problemas = (v.problemas && v.problemas.length) ? v.problemas
  : ['El validador se detuvo: ' + (v.error || v.message || 'error desconocido') + '. Vuelve a enviar; si se repite, revisa la ejecución en n8n.'];
return [{ json: {
  run_id: a.run_id,
  actualizado_en: new Date().toISOString(),
  cuenta_id: v.cuenta_id || a.cuenta_id,
  campana: v.campana || a.campana,
  estado: 'RECHAZADO',
  anuncios_publicados: 0,
  errores: problemas.length,
  mensaje: 'El plan no se publicó. Revisa lo siguiente:',
  detalle: problemas.map(x => 'ERROR: ' + x).join(' | '),
} }];
