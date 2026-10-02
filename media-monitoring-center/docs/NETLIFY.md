# Netlify y límites actuales de las APIs directas

Netlify puede asignar la URL pública al publicar un sitio desde GitHub. El adaptador
`@netlify/plugin-nextjs` sirve Next.js; `netlify.toml` configura Node 22, `npm run build` y `.next`.
No se publicó ningún sitio.

## Bloqueo para la v1 elegida

El equipo eligió `DATA_SOURCE=unified`. Su catálogo, particiones, locks y checkpoints usan archivos
mediante `UnifiedSnapshotStore`. Las Functions no convierten esos archivos en almacenamiento durable
compartido. `RECORDS_BACKEND=blobs` mueve bitácora/tickets/configuración, **no el histórico
publicitario**. Añadir variables o copiar `.data` a la construcción no resuelve ese bloqueo.

```bash
npm run v1:check -- --sin-red --destino netlify
```

Señala `NETLIFY_UNIFIED_FILE_HISTORY_UNSUPPORTED`; registros en memoria/archivo también quedan
bloqueados. Debe migrarse el histórico/checkpoint a un backend externo y definir el extractor antes
de proponer Netlify para esta v1. Sheets/BigQuery son alternativas heredadas; no se cambia a ellas
sin decisión del usuario. [PRODUCCION.md](PRODUCCION.md) explica contenedores/discos y las dos URLs.

## Configuración conservada para revisión futura

- Directorio raíz `media-monitoring-center`; revisar rama antes de activar publicación automática.
  Un push a la rama vigilada puede publicar: mantenerlo desactivado hasta autorización.
- Sesión nominal obligatoria. Next.js 16 usa `src/proxy.ts` en runtime Node; no se presupone una
  antigua Edge Function. Secretos de servidor, sin `NEXT_PUBLIC_`.
- Deploy Previews aislados, datos ficticios y sin credenciales, datos ni Blobs de producción.
- Health 200 no certifica fuente real. Validar login, permisos, HTTPS, registros, historial,
  reinicio y conciliación en el sitio creado: [V1.md](V1.md).
- Verificar límites de variables/Functions y compatibilidad en el plan/versión elegidos; las cifras
  históricas de Lambda no se presentan como contrato vigente de Netlify.
- Blobs persiste registros operativos, pero accesos reales, CAS, escrituras multiclave y usuarios
  entre instancias requieren aceptación específica.

Referencia: [Next.js en Netlify](https://docs.netlify.com/frameworks/next-js/overview/).
No ejecutar `netlify deploy`, crear sitios ni publicar para estas comprobaciones locales.
