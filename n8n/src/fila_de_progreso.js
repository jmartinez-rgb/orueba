/* motor 5.0 · Avance del tramo: la hoja muestra cuántos anuncios van y el sitio
   lo pinta. Solo toca estas columnas; el estado final lo escribe el cierre. */
const E = $input.first().json || {};
return [{ json: {
  run_id: E.run_id,
  actualizado_en: new Date().toISOString(),
  anuncios_publicados: E.nAds || 0,
  mensaje: E.progreso || 'Publicando en Meta…',
  detalle: 'fase:' + (E.fase || ''),
} }];
