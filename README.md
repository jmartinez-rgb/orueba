# ABCW · Paid Media OS y motor de plan masivo

| Carpeta | Qué es |
|---|---|
| `media-monitoring-center/` | **izzi Media Monitoring Center**: plataforma de monitoreo de Paid Media (Next.js en Netlify, BigQuery, n8n, alertas por WhatsApp). Funciona completa en modo simulado. Ver `media-monitoring-center/README.md`; en Netlify se publica como sitio aparte con *Base directory* = `media-monitoring-center`. |
| `unified-ads-api/` | API de consulta de las seis plataformas y herramientas de extracción y conciliación. Ver `unified-ads-api/README.md`. |
| `paid-media-os/` | Paquete listo para Netlify: `sitio/` (plataforma React compilada + plan masivo), `functions/` (API y sincronización horaria), `netlify.toml`. Cómo publicar: `paid-media-os/LEEME-PUBLICAR.md`. |
| `n8n/` | Motor del plan masivo. `meta_bulk_motor.json` es el workflow que se importa; se genera desde `n8n/src/` con `python3 n8n/build.py`. |
| `pruebas/` | Pruebas locales: `node pruebas/api.test.mjs`, `node pruebas/motor.test.mjs` y `node pruebas/servidor-local.mjs` (sitio + API simulada en http://localhost:8888). |
| `herramientas/` | `renombrar_assets.py`: da nombre nuevo a los archivos del sitio que cambian (Netlify los guarda en caché un año). |

Versiones: plataforma **6.1.0**, plan masivo y motor **5.7.0**, API de Meta **v26.0**.
Hallazgos y cambios de esta versión: `AUDITORIA.md`.

Revisión del monitoreo del 2 de octubre: [auditoría funcional, UX y Nexus](media-monitoring-center/docs/AUDITORIA_UX_NEXUS_2026-10-02.md).
La [auditoría ampliada](media-monitoring-center/docs/AUDITORIA_AMPLIADA_2026-10-02.md) añade
regresiones de permisos, marcas, concurrencia, cobertura y CPA agregado: monitoreo **658 pruebas**,
API **648**, compilaciones y recorrido de navegador reproducible. V1 sigue pendiente de aceptación.
Nexus consulta campañas y explica el monitoreo con acceso por marca; quedan pendientes la
conciliación de datos, configuración de producción y decisiones de negocio.

## Cambiar el motor de n8n

1. Edita `n8n/src/<nodo>.js` (o `n8n/src/_cliente_meta.js` para lo que comparten todos los nodos que hablan con Meta).
2. `python3 n8n/build.py` y `node pruebas/motor.test.mjs`.
3. Si cambias la versión, súbela en `n8n/src/armar_cuentas.js`, `n8n/src/buscar_en_meta.js` (tipo `version`) y en el plan
   masivo (`SITIO_VERSION` en `sitio/plan/assets/app.js` y `SITIO_VERSION_ESPERADA` en `model.js`).

## Cambiar archivos de `paid-media-os/sitio/assets`

Después de editar: `python3 herramientas/renombrar_assets.py <commit-anterior> <versión>` y prueba con `node pruebas/servidor-local.mjs`.
