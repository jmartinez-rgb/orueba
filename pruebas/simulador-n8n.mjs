// Simulador mínimo de un Code node de n8n: $vars, $('Nodo'), this.helpers.httpRequest.
import fs from 'node:fs';
const wf = JSON.parse(fs.readFileSync(new URL('../n8n/meta_bulk_motor.json', import.meta.url), 'utf8'));
export function codigo(nodo) { return wf.nodes.find(n => n.name === nodo).parameters.jsCode; }
export async function correr(nodo, { body = {}, rutas = [], vars = {}, nodos = {} } = {}) {
  const llamadas = [];
  const http = async (o) => {
    const url = new URL(o.url);
    llamadas.push({ method: o.method, url: o.url, body: o.body });
    for (const r of rutas) {
      if ((r.method || 'GET') === o.method && r.match.test(url.pathname + url.search + (o.body ? ' ' + decodeURIComponent(o.body) : ''))) {
        const out = typeof r.res === 'function' ? r.res(url, o) : r.res;
        return { statusCode: out.status || 200, headers: {}, body: out.body ?? out };
      }
    }
    return { statusCode: 400, headers: {}, body: { error: { message: 'Ruta simulada no definida: ' + o.method + ' ' + url.pathname, code: 100 } } };
  };
  const $vars = { META_ACCESS_TOKEN: 'tok', META_API_VERSION: 'v26.0', SHEET_ID: 'x', APP_SHARED_SECRET: 's', ...vars };
  const $ = (n) => ({ first: () => ({ json: n === 'Recibir' ? { body, headers: {} } : (nodos[n] || {}) }), all: () => [] });
  const fn = new Function('$vars', '$', '$runIndex', '$input', 'Buffer', 'return (async function(){\n' + codigo(nodo) + '\n}).call(this);');
  const out = await fn.call({ helpers: { httpRequest: http } }, $vars, $, 0, { first: () => ({ json: {} }), all: () => [] }, Buffer);
  return { out: out?.[0]?.json, llamadas };
}
