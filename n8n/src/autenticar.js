/* 5.6 · Puerta de entrada CERRADA por defecto.
   Desde 5.6 el sitio ya no llama a n8n directamente: lo hace el backend de la plataforma
   (Netlify Function /api/motor), que exige sesión corporativa de Google (@abcw.global / @abcw.mx),
   aplica permisos por rol y agrega la clave compartida en la cabecera X-ABCW-Clave. El navegador
   nunca conoce la clave.
   - Sin la variable APP_SHARED_SECRET en n8n: se rechaza todo (antes pasaba todo: el webhook
     quedaba abierto a cualquiera que conociera la URL, con el token del system user detrás).
   - Con la variable: exige la misma clave en X-ABCW-Clave. El usuario llega en X-ABCW-Usuario. */
const req = $('Recibir').first().json;
const b = req.body || {};
const h = req.headers || {};

const faltan = [];
if (!$vars.META_ACCESS_TOKEN) faltan.push('META_ACCESS_TOKEN');
if (!$vars.META_API_VERSION)  faltan.push('META_API_VERSION');
if (!$vars.SHEET_ID)          faltan.push('SHEET_ID');
if (!$vars.APP_SHARED_SECRET) faltan.push('APP_SHARED_SECRET');

function iguales(a, b2){
  a = String(a); b2 = String(b2);
  if (a.length !== b2.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b2.charCodeAt(i);
  return d === 0;
}

const esperado = $vars.APP_SHARED_SECRET || '';
const recibido = String(h['x-abcw-clave'] || h['X-ABCW-Clave'] || '');
const usuario = String(h['x-abcw-usuario'] || b.usuario || '');

const configOk = faltan.length === 0;
const claveOk = !!esperado && !!recibido && iguales(recibido, esperado);
const ok = configOk && claveOk;

return [{ json: {
  ok,
  config_ok: configOk,
  modo_abierto: false,
  usuario,
  motivo: !configOk
    ? ('Configuración incompleta en n8n. Faltan variables: ' + faltan.join(', ') + '. APP_SHARED_SECRET debe ser igual a MOTOR_SHARED_SECRET en Netlify.')
    : (ok ? '' : 'Llamada rechazada: el motor solo atiende a la plataforma (clave compartida ausente o inválida).'),
} }];
