# ABCW · Paid Media OS y motor de plan masivo

| Carpeta | Qué es |
|---|---|
| `paid-media-os/` | Paquete listo para Netlify: `sitio/` (plataforma React compilada + plan masivo), `functions/` (API y sincronización horaria), `netlify.toml`. Cómo publicar: `paid-media-os/LEEME-PUBLICAR.md`. |
| `n8n/` | Motor del plan masivo. `meta_bulk_motor.json` es el workflow que se importa; se genera desde `n8n/src/` con `python3 n8n/build.py`. |
| `pruebas/` | Pruebas locales: `node pruebas/api.test.mjs`, `node pruebas/motor.test.mjs` y `node pruebas/servidor-local.mjs` (sitio + API simulada en http://localhost:8888). |
| `herramientas/` | `renombrar_assets.py`: da nombre nuevo a los archivos del sitio que cambian (Netlify los guarda en caché un año). |

Versiones: plataforma **6.1.0**, plan masivo y motor **5.7.0**, API de Meta **v26.0**.
Hallazgos y cambios de esta versión: `AUDITORIA.md`.

## Cambiar el motor de n8n

1. Edita `n8n/src/<nodo>.js` (o `n8n/src/_cliente_meta.js` para lo que comparten todos los nodos que hablan con Meta).
2. `python3 n8n/build.py` y `node pruebas/motor.test.mjs`.
3. Si cambias la versión, súbela en `n8n/src/armar_cuentas.js`, `n8n/src/buscar_en_meta.js` (tipo `version`) y en el plan
   masivo (`SITIO_VERSION` en `sitio/plan/assets/app.js` y `SITIO_VERSION_ESPERADA` en `model.js`).

## Cambiar archivos de `paid-media-os/sitio/assets`

Después de editar: `python3 herramientas/renombrar_assets.py <commit-anterior> <versión>` y prueba con `node pruebas/servidor-local.mjs`.
