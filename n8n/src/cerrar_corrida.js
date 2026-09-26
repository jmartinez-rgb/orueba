/* motor 5.0 · Si la bitácora no se escribió completa, la corrida NO se reporta
   como OK: queda OK_SIN_BITACORA para que alguien la revise.
   No se envía creado_en: la fila conserva la hora de inicio. */
const p = $('Preparar cierre').first().json;
const fila = Object.assign({}, p.cierre);
const esperadas = (p.bitacora || []).length;
let escritas = 0;
try { escritas = $('Escribir bitácora').all().filter(i => i.json && i.json.run_id).length; } catch (e) { escritas = 0; }
if (esperadas && escritas < esperadas) {
  if (fila.estado === 'OK' || fila.estado === 'OK_CON_AVISOS') fila.estado = 'OK_SIN_BITACORA';
  fila.mensaje = fila.mensaje + ' Aviso: la bitácora quedó incompleta (' + escritas + ' de ' + esperadas
    + ' filas). Verifica los IDs en Ads Manager antes de reintentar.';
}
return [{ json: fila }];
