// Arnés de la Function /api en modo simulado (META_MODE=mock) con almacenamiento en memoria.
process.env.META_MODE = 'mock';
process.env.PMOS_MEMORY_STORE = '1';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.DEV_LOGIN = '1';
process.env.ACCESS_CODE = 'codigo-de-prueba-123';
process.env.APP_URL = 'http://localhost:8888';
export async function cargar(archivo = new URL('../paid-media-os/functions/api.mjs', import.meta.url).href) {
  const handler = (await import(archivo)).default;
  let cookie = '';
  const call = async (method, path, body, extra = {}) => {
    const headers = { 'x-pmos': '1', origin: 'http://localhost:8888', cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...extra };
    const res = await handler(new Request('http://localhost:8888' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }));
    const sc = res.headers.get('set-cookie');
    if (sc && sc.includes('pmos_session=') && !sc.includes('pmos_session=;')) cookie = sc.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  const login = async (email) => { cookie = ''; const r = await call('POST', '/api/auth/dev-login', { email, name: 'Prueba' }); if (r.status !== 200) throw new Error('login: ' + JSON.stringify(r)); return cookie; };
  return { call, login, usar: (c) => { cookie = c; } };
}
