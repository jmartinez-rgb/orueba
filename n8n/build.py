#!/usr/bin/env python3
"""Reconstruye el workflow de n8n a partir de src/.

Fuente única del motor: el código de cada Code node vive en src/<nodo>.js y el cliente
de Meta compartido en src/_cliente_meta.js (se antepone a los nodos que hablan con Meta,
según src/manifest.json). No edites el código dentro de n8n: edita src/ y ejecuta

    python3 n8n/build.py            # escribe n8n/meta_bulk_motor.json
    python3 n8n/build.py --check    # solo verifica que el JSON esté al día

Cada nodo se revisa con `node --check` antes de escribir (si Node.js está instalado).
"""
import json, os, shutil, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(AQUI, 'src')
WORKFLOW = os.path.join(AQUI, 'meta_bulk_motor.json')


def leer(nombre):
    with open(os.path.join(SRC, nombre), encoding='utf-8') as f:
        return f.read()


def codigo(entrada, cliente):
    cuerpo = leer(entrada['file'])
    return cliente + '\n\n' + cuerpo if entrada['cliente_meta'] else cuerpo


def revisar_sintaxis(nombre, js):
    if not shutil.which('node'):
        return
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as t:
        t.write('async function __nodo(){\n' + js + '\n}\n')
    try:
        r = subprocess.run(['node', '--check', t.name], capture_output=True, text=True)
        if r.returncode:
            sys.exit(f'Error de sintaxis en "{nombre}":\n{r.stderr}')
    finally:
        os.unlink(t.name)


def main():
    solo_revisar = '--check' in sys.argv
    with open(WORKFLOW, encoding='utf-8') as f:
        wf = json.load(f)
    manifest = json.loads(leer('manifest.json'))
    cliente = leer('_cliente_meta.js')
    por_nodo = {m['node']: m for m in manifest}
    cambios = 0
    for n in wf['nodes']:
        m = por_nodo.get(n['name'])
        if not m:
            continue
        js = codigo(m, cliente)
        revisar_sintaxis(n['name'], js)
        if n['parameters'].get('jsCode') != js:
            cambios += 1
            n['parameters']['jsCode'] = js
    faltan = set(por_nodo) - {n['name'] for n in wf['nodes']}
    if faltan:
        sys.exit('Nodos del manifiesto que no están en el workflow: ' + ', '.join(sorted(faltan)))
    if solo_revisar:
        if cambios:
            sys.exit(f'{cambios} nodo(s) desactualizados: ejecuta python3 n8n/build.py')
        print('El workflow está al día con src/.')
        return
    with open(WORKFLOW, 'w', encoding='utf-8') as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
    print(f'{cambios} nodo(s) actualizados en {os.path.basename(WORKFLOW)}.')


if __name__ == '__main__':
    main()
