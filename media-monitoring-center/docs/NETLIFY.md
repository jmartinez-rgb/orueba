# Netlify

La app es Next.js 16 (App Router) y se publica con el adaptador oficial de Netlify
(`@netlify/plugin-nextjs`): páginas SSR y API routes corren como Netlify Functions.

> Este repositorio también contiene `paid-media-os/`, que se publica aparte arrastrando la
> carpeta (sin GitHub). La app de monitoreo es **otro sitio** de Netlify con deploy continuo.

## Primer deploy (GitHub → Netlify)

1. Netlify → **Add new site → Import an existing project → GitHub** → este repositorio.
2. **Base directory**: `media-monitoring-center` (importante: la app vive en esa carpeta).
3. Build command y publish se leen de `media-monitoring-center/netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `.next`
   - Node 22, plugin `@netlify/plugin-nextjs`.
4. **Environment variables**: al inicio basta con `USE_MOCK_DATA=true` y
   `APP_TIMEZONE=America/Mexico_City` (ver `docs/ENVIRONMENT.md`).
5. Deploy. Cada push a la rama de producción publica; los PR generan *Deploy Previews*.
6. Verificar: `https://TU-SITIO/api/health` → `{"ok":true,"mode":"mock",…}`.

## Variables y el límite de 4 KB

Las Functions corren en AWS Lambda: **todas las variables disponibles para Functions suman
máximo 4 KB**. Un JSON completo de service account ocupa ~2.3 KB. Recomendado:

- Usar `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` en lugar de `GOOGLE_SERVICE_ACCOUNT`.
- Versionar el mapeo en `config/bigquery.mapping.json` (no es secreto) en lugar de
  `BIGQUERY_MAPPING`.
- Marcar como *Secret* las sensibles (`GOOGLE_PRIVATE_KEY`, `MONITORING_API_KEY`,
  `N8N_WEBHOOK_SECRET`) y limitar el scope a *Functions/Runtime* cuando aplique.

## Pasar a datos reales

1. Configurar BigQuery (`docs/BIGQUERY.md`) y las variables.
2. `USE_MOCK_DATA=false` → redeploy (las variables se leen al construir y al ejecutar).
3. Configurar n8n (`docs/N8N.md`): `N8N_*`, `MONITORING_API_KEY`, `N8N_WEBHOOK_SECRET`.
4. Activar WhatsApp cuando las plantillas estén aprobadas: `WHATSAPP_ALERTS_ENABLED=true`.

## Límites a tener en cuenta

- Timeout de Functions síncronas: 10 s por defecto (se puede subir hasta 26 s en el plan). La
  evaluación usa pocas consultas con poda de particiones; `maxDuration = 26` en el endpoint de
  evaluación.
- La memoria de una Function caliente sirve de caché; un *cold start* solo cuesta una consulta.
- En MOCK MODE los cambios de estado de alertas/incidentes viven en memoria de la Function y
  pueden reiniciarse; con BigQuery quedan persistidos. La configuración en mock se guarda en una
  cookie del navegador.

## Seguridad

- Cabeceras en `next.config.ts` (`X-Frame-Options: DENY`, `nosniff`, `noindex`...) y
  `Cache-Control: private, no-store` para `/api/*` en `netlify.toml`.
- El sitio no debe indexarse (robots `noindex`). Para restringir acceso: Netlify password
  protection / SSO del equipo, o `AUTH_MODE=header` detrás de un proxy de identidad.

## Local con Netlify CLI (opcional)

```bash
npm i -g netlify-cli
cd media-monitoring-center && netlify dev
```
