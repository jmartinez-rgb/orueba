/* ---- v2.1 · listado de cuentas (D1-06, D2-08) ---- */
const CAMPOS = 'account_id,name,currency,timezone_name,account_status,min_daily_budget,'
  + 'adspixels.limit(1){id},instagram_accounts.limit(1){id}';
const CAMPOS_MIN = 'account_id,name,currency,timezone_name,account_status,min_daily_budget';

let crudas;
try { crudas = await todasLasCuentas(CAMPOS); }
catch (e) { crudas = await todasLasCuentas(CAMPOS_MIN); }

const cuentas = asignarLlaves(crudas).map(a => {
  const md = aMayor(a.min_daily_budget, a.currency);
  return {
    key: a.__key,
    nombre: String(a.name || a.account_id),
    cuenta: String(a.account_id).replace(/^act_/, ''),
    moneda: String(a.currency || ''),
    tz: String(a.timezone_name || ''),
    pixel: (a.adspixels && a.adspixels.data && a.adspixels.data[0]) ? String(a.adspixels.data[0].id) : '',
    ig: !!(a.instagram_accounts && a.instagram_accounts.data && a.instagram_accounts.data.length),
    minImp: md || 40,
    minConv: md || 120,
  };
}).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));

/* Versión de la API configurada en n8n: el sitio avisa si ya no está vigente (5.3). */
return [{ json: { cuentas, api_version: String(version), api_vigente: VERSION_API_NUM >= VERSION_API_MINIMA, api_minima: 'v' + VERSION_API_MINIMA + '.0' } }];
