// Servidor local de pruebas: sitio estático + Function /api en modo simulado (META_MODE=mock).
// Uso: node pruebas/servidor-local.mjs [puerto]   → http://localhost:8888 (acceso de desarrollo habilitado)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
process.env.META_MODE ??= 'mock';
process.env.PMOS_MEMORY_STORE ??= '1';
process.env.SESSION_SECRET ??= 'x'.repeat(40);
process.env.DEV_LOGIN ??= '1';
process.env.ACCESS_CODE ??= 'codigo-de-prueba-123';
const puerto = Number(process.argv[2] || 8888);
process.env.APP_URL ??= 'http://localhost:' + puerto;
const raiz = new URL('../paid-media-os/', import.meta.url).pathname;
const api = (await import(path.join(raiz, 'functions/api.mjs'))).default;
const tipos = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + puerto);
  if (url.pathname.startsWith('/api/')) {
    const cuerpo = await new Promise((ok) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => ok(Buffer.concat(b))); });
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo }));
    const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
    const cookies = r.headers.getSetCookie?.() || [];
    if (cookies.length) h['set-cookie'] = cookies;
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let archivo = path.join(raiz, 'sitio', decodeURIComponent(url.pathname));
  if (!archivo.startsWith(path.join(raiz, 'sitio'))) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) archivo = path.join(archivo, 'index.html');
  if (!fs.existsSync(archivo)) {
    if (url.pathname.startsWith('/assets/')) { res.writeHead(404); return res.end('no existe'); }
    archivo = path.join(raiz, 'sitio', url.pathname.startsWith('/plan/') ? 'plan/index.html' : 'index.html');
  }
  res.writeHead(200, { 'content-type': tipos[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
}).listen(puerto, () => console.log('Paid Media OS local en http://localhost:' + puerto));
