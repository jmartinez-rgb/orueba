/* ---- v3.9 · subida de archivos a la cuenta publicitaria ----
   El navegador sube cada archivo en el momento de elegirlo, y al plan solo
   viaja el identificador. Así el tamaño de los archivos no pasa por el plan.
     imagen        → una llamada a /adimages (la imagen ya viene optimizada)
     video_inicio  → /advideos upload_phase=start; Meta indica el primer tramo
     video_parte   → /advideos upload_phase=transfer con el tramo exacto que pidió Meta
     video_fin     → /advideos upload_phase=finish
     video_estado  → estado de procesamiento y miniatura */
const b = $('Recibir').first().json.body || {};
const act = 'act_' + String(b.cuenta_id || '').replace(/^act_/, '');
if (act === 'act_') return [{ json: { error: 'Falta la cuenta publicitaria.' } }];

/* multipart/form-data armado a mano: Meta exige el tramo de video como archivo. */
async function postMultipart(ruta, campos, archivoNombre, archivoBuf){
  const lim = '----mbe' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const partes = [];
  Object.keys(campos).forEach(k => partes.push(Buffer.from('--' + lim + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + campos[k] + '\r\n')));
  partes.push(Buffer.from('--' + lim + '\r\nContent-Disposition: form-data; name="' + archivoNombre + '"; filename="parte.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'));
  partes.push(archivoBuf, Buffer.from('\r\n--' + lim + '--\r\n'));
  for (let intento = 0; ; intento++) {
    const r = await http({ method: 'POST', url: base + ruta, body: Buffer.concat(partes), json: false,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + lim },
      returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 120000 });
    let cuerpo = r.body; try { cuerpo = JSON.parse(Buffer.isBuffer(cuerpo) ? cuerpo.toString() : cuerpo); } catch (e) {}
    if (r.statusCode >= 400) {
      const err = fallo({ statusCode: r.statusCode, body: cuerpo });
      if (REINTENTABLES.indexOf(Number(err.code)) >= 0 && intento < 4) { await pausa(Math.pow(2, intento) * 1500); continue; }
      throw err;
    }
    return cuerpo;
  }
}

try {
  const fase = String(b.fase || '');
  if (fase === 'imagen') {
    const datos = String(b.datos || '').replace(/^data:[^,]*,/, '');
    if (!datos) throw new Error('No llegó la imagen.');
    const res = await gPost(act + '/adimages', { bytes: datos });
    const k = Object.keys(res.images || {})[0];
    if (!k) throw new Error('Meta no devolvió el identificador de la imagen.');
    return [{ json: { hash: res.images[k].hash, url: res.images[k].url || '' } }];
  }
  if (fase === 'video_inicio') {
    const tam = Number(b.tamano || 0);
    if (!tam) throw new Error('Falta el tamaño del video.');
    const r = await gPost(act + '/advideos', { upload_phase: 'start', file_size: String(tam) });
    return [{ json: { sesion: String(r.upload_session_id), video_id: String(r.video_id), inicio: Number(r.start_offset), fin: Number(r.end_offset) } }];
  }
  if (fase === 'video_parte') {
    const buf = Buffer.from(String(b.datos || ''), 'base64');
    const r = await postMultipart(act + '/advideos', { upload_phase: 'transfer', upload_session_id: String(b.sesion), start_offset: String(b.inicio) }, 'video_file_chunk', buf);
    return [{ json: { inicio: Number(r.start_offset), fin: Number(r.end_offset) } }];
  }
  if (fase === 'video_fin') {
    const r = await gPost(act + '/advideos', { upload_phase: 'finish', upload_session_id: String(b.sesion), title: String(b.nombre || 'video') });
    return [{ json: { ok: !!(r.success === true || r.success === 'true'), video_id: String(b.video_id || '') } }];
  }
  if (fase === 'video_estado') {
    const r = await gGet(base + String(b.video_id) + '?fields=status,thumbnails');
    const th = r.thumbnails && r.thumbnails.data && r.thumbnails.data[0];
    return [{ json: { estado: (r.status && r.status.video_status) || '', progreso: (r.status && r.status.processing_progress) || 0, thumb: th ? th.uri : '' } }];
  }
  throw new Error('Fase de subida desconocida: ' + fase);
} catch (e) {
  return [{ json: { error: explicar(e) } }];
}
