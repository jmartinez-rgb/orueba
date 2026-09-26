/* motor 5.2 · Historial: las últimas 40 corridas de la hoja "runs", de la más reciente a la más antigua. */
const b = $('Recibir').first().json.body || {};
const cuenta = String(b.cuenta_id || '').replace(/^act_/, '');
const filas = $input.all().map(i => i.json).filter(f => f && f.run_id && String(f.run_id).indexOf('run_') === 0);
const vistas = {};
filas.forEach(f => { vistas[f.run_id] = Object.assign(vistas[f.run_id] || {}, f); });
const lista_ = Object.values(vistas)
  .filter(f => !(b.solo_cuenta && cuenta) || String(f.cuenta_id || '') === cuenta)
  .sort((p, q) => String(q.creado_en || q.run_id).localeCompare(String(p.creado_en || p.run_id)))
  .slice(0, 40)
  .map(f => {
    const partes = String(f.detalle || '').split(' | ').filter(x => x && !/^fase:/.test(x));
    return {
      run_id: f.run_id, inicio: f.creado_en || '', fin: f.actualizado_en || '', cuenta: f.cuenta_id || '', campana: f.campana || '',
      estado: f.estado || '', anuncios: Number(f.anuncios_publicados || 0), previstos: Number(f.anuncios_previstos || 0),
      mensaje: f.mensaje || '', operador: f.operador || '',
      fallos: partes.filter(x => !/^AVISO: /.test(x)).map(x => x.replace(/^ERROR: /, '')),
      avisos: partes.filter(x => /^AVISO: /.test(x)).map(x => x.slice(7)),
    };
  });
return [{ json: { corridas: lista_ } }];
