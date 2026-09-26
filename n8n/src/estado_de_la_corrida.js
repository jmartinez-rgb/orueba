/* motor 5.1 · Estado para el sondeo del sitio.
   NO_ENCONTRADO: la fila aún no aparece (el sitio sigue preguntando un rato).
   DETENIDO: EN_PROCESO sin avance en 12 minutos (cada tramo escribe su avance).
   Mientras corre, "detalle" guarda la fase (fase:<nombre>); al cerrar, la lista de
   errores y avisos con prefijo ERROR: / AVISO:. */
const b = $('Recibir').first().json.body || {};
const buscado = String(b.run_id || '');
const filas = $input.all().map(i => i.json).filter(f => f && f.run_id);
const mias = filas.filter(f => String(f.run_id) === buscado);
const f = mias.length ? mias[mias.length - 1] : null;
if (!f) return [{ json: { estado: 'NO_ENCONTRADO', mensaje: 'La corrida todavía no aparece en la hoja.' } }];
const partes = String(f.detalle || '').split(' | ').filter(Boolean);
const enCurso = f.estado === 'EN_PROCESO';
const fallos = [], avisos = [];
if (!enCurso) partes.forEach(x => {
  if (/^AVISO: /.test(x)) avisos.push(x.slice(7));
  else fallos.push(x.replace(/^ERROR: /, ''));
});
const out = {
  estado: f.estado, mensaje: f.mensaje,
  anuncios: Number(f.anuncios_publicados || 0),
  previstos: Number(f.anuncios_previstos || 0),
  fase: enCurso && /^fase:/.test(String(f.detalle || '')) ? String(f.detalle).slice(5) : '',
  fallos, avisos,
  problemas: fallos.concat(avisos),
  inicio: f.creado_en || '', actualizado: f.actualizado_en || '',
};
if (enCurso) {
  const t = Date.parse(f.actualizado_en || f.creado_en || '');
  const edad = isNaN(t) ? 0 : Date.now() - t;
  if (edad > 12 * 60000) {
    out.estado = 'DETENIDO';
    out.mensaje = 'La corrida no avanza desde hace ' + Math.round(edad / 60000) + ' minutos: n8n la detuvo. '
      + 'Lo creado lleva la etiqueta del lote; al reenviar el plan se reutiliza y no se duplica. Revisa la ejecución en n8n.';
  }
}
return [{ json: out }];
