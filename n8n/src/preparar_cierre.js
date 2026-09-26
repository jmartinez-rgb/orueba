/* motor 5.0 · Resultado final de la corrida.
   Si el último tramo se detuvo sin poder guardar su estado (tiempo agotado del
   task runner, memoria), se recupera el último tramo bueno: la bitácora conserva
   lo creado hasta ahí y lo demás queda identificado por la etiqueta del lote. */
let E = $input.first().json || {};
const v = $('Validar plan').first().json;
let detenido = false;
if (!E.__mbe) {
  detenido = true;
  const motivo = E.error || E.message || 'error desconocido';
  let ultimo = null;
  for (let i = 0; i < 200; i++) {
    let x = null;
    try { x = $('Publicar en Meta').first(0, i); } catch (e) { break; }
    if (!x) break;
    if (x.json && x.json.__mbe) ultimo = x.json;
  }
  E = ultimo ? JSON.parse(JSON.stringify(ultimo))
    : { run_id: v.run_id, bitacora: [], fallos: [], avisos: [], nCamp: 0, nAdset: 0, nAds: 0, omitidos: 0, fase: 'inicio' };
  E.fallos = E.fallos || [];
  E.fallos.push('El motor se detuvo durante la fase "' + (E.fase || '?') + '": ' + motivo
    + '. Lo creado lleva la etiqueta del lote: al reenviar el mismo plan se reutiliza y no se duplica.');
}
const fallos = E.fallos || [], avisos = E.avisos || [];
const nCamp = E.nCamp || 0, nAdset = E.nAdset || 0, nAds = E.nAds || 0;
if (E.omitidos) avisos.push(E.omitidos + ' anuncio(s) ya existían de un envío anterior de este plan y no se duplicaron.');
const estado = fallos.length === 0 ? (avisos.length ? 'OK_CON_AVISOS' : 'OK') : (nAds > 0 ? 'PARCIAL' : 'ERROR');
const partes = [];
if (nCamp)  partes.push(nCamp + (nCamp === 1 ? ' campaña nueva' : ' campañas nuevas'));
if (nAdset) partes.push(nAdset + (nAdset === 1 ? ' conjunto nuevo' : ' conjuntos nuevos'));
partes.push(nAds + (nAds === 1 ? ' anuncio' : ' anuncios'));
const mensaje = detenido
  ? 'La corrida se detuvo antes de terminar: se publicaron ' + nAds + ' de ' + (v.total_ads || '?') + ' anuncios. Reenvía el mismo plan para completar lo que falta; lo ya creado se reutiliza y no se duplica.'
  : fallos.length === 0
  ? 'Listo. Se crearon ' + partes.join(', ') + (v.campaign_id && !nCamp ? ' sobre campañas existentes' : '') + '. Todo quedó en pausa.'
  : (nAds > 0
      ? 'Se publicaron ' + nAds + ' anuncio(s), pero ' + fallos.length + ' elemento(s) fallaron. Lo que quedó vacío se eliminó.'
      : (nCamp <= 0 && nAdset <= 0
          ? 'No se pudo publicar y no quedó nada creado en Meta: corrige y vuelve a enviar. Motivo: ' + fallos[0]
          : 'No se pudo publicar: ' + fallos[0]));
return [{ json: {
  cierre: {
    run_id: v.run_id,
    actualizado_en: new Date().toISOString(),
    client_key: v.client_key,
    cuenta_id: v.cuenta_id,
    campana: v.campana,
    estado,
    anuncios_previstos: v.total_ads,
    anuncios_publicados: nAds,
    errores: fallos.length,
    mensaje,
    detalle: fallos.map(x => 'ERROR: ' + x).concat(avisos.map(x => 'AVISO: ' + x)).join(' | '),
    operador: v.operador || '',
  },
  bitacora: E.bitacora || [],
  tramos: E.tramo || 0,
} }];
