#!/usr/bin/env python3
"""Da nombre nuevo a los archivos de sitio/assets que cambiaron desde una revisión de git.

Netlify sirve /assets/* con "Cache-Control: immutable" durante un año (netlify.toml): un archivo
editado que conserva su nombre NO llega a los navegadores que ya lo tenían. Este script:
  1. detecta los .js/.css de sitio/assets distintos a la revisión base;
  2. agrega, en cascada, los que hacen referencia a un archivo renombrado (su contenido cambia);
  3. les asigna un sufijo nuevo y actualiza todas las referencias (chunks e index.html).

Uso:  python3 herramientas/renombrar_assets.py <revision-base> <etiqueta>
Ej.:  python3 herramientas/renombrar_assets.py 335a883 6.1.0
"""
import base64, hashlib, os, re, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO = os.path.join(RAIZ, 'paid-media-os', 'sitio')
ASSETS = os.path.join(SITIO, 'assets')


def git_show(rev, ruta):
    r = subprocess.run(['git', '-C', RAIZ, 'show', f'{rev}:{ruta}'], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    base, etiqueta = sys.argv[1], sys.argv[2]
    # Vite nombra cada archivo nombre-<hash de 8>.ext; el hash puede tener "-" y "_".
    nombres = sorted(f for f in os.listdir(ASSETS) if re.match(r'.+-[A-Za-z0-9_-]{8}\.(js|css)$', f))
    leer = lambda f: open(os.path.join(ASSETS, f), 'rb').read()
    cambiados = set()
    for f in nombres:
        antes = git_show(base, f'paid-media-os/sitio/assets/{f}')
        if antes is None or antes != leer(f):
            cambiados.add(f)
    # Cascada: quien menciona un archivo renombrado también cambia de contenido.
    while True:
        nuevos = {f for f in nombres if f not in cambiados and any(c.encode() in leer(f) for c in cambiados)}
        if not nuevos:
            break
        cambiados |= nuevos
    if not cambiados:
        print('Ningún archivo de assets cambió.')
        return
    mapa = {}
    for f in sorted(cambiados):
        m = re.match(r'(.+)-([A-Za-z0-9_-]{8})\.(js|css)$', f)
        token = base64.urlsafe_b64encode(hashlib.sha256((f + etiqueta).encode()).digest()).decode()[:8].replace('-', '_')
        mapa[f] = f'{m.group(1)}-{token}.{m.group(3)}'
    archivos = [os.path.join(ASSETS, f) for f in nombres] + [os.path.join(SITIO, 'index.html')]
    for ruta in archivos:
        s = open(ruta, 'rb').read()
        t = s
        for viejo, nuevo in mapa.items():
            t = t.replace(viejo.encode(), nuevo.encode())
        if t != s:
            open(ruta, 'wb').write(t)
    for viejo, nuevo in mapa.items():
        os.rename(os.path.join(ASSETS, viejo), os.path.join(ASSETS, nuevo))
    for viejo, nuevo in sorted(mapa.items()):
        print(f'{viejo} -> {nuevo}')


if __name__ == '__main__':
    main()
