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
4. **Environment variables** (ver `docs/ENVIRONMENT.md`):
   - `APP_TIMEZONE=America/Mexico_City`.
   - **Datos** (hoja de Dataslayer): `DATA_SOURCE=sheets`, `SHEETS_SPREADSHEET_ID`,
     `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY` (secreta). Paso a paso en `docs/INSTALACION.md`.
     Sin ellas la app arranca con datos simulados.
   - **Acceso** (obligatorio: sin esto el sitio queda bloqueado): `AUTH_SECRET`, `AUTH_USERS`,
     `AUTH_UNIVERSAL_PASSWORD_HASH`, `AUTH_UNIVERSAL_ROLE=viewer`, `AUTH_SESSION_HOURS=12`. Se
     generan con `npm run auth:setup` (ver `docs/AUTH.md`). El valor de `AUTH_USERS` se pega tal
     cual, sin comillas. Si existe `AUTH_MODE=dev` de la primera versión, bórralo o déjalo vacío.
5. Deploy. Cada push a la rama de producción publica; los PR generan *Deploy Previews*.
6. Verificar: `https://TU-SITIO/api/health` → `{"ok":true,"mode":"sheets",…}` y que
   `https://TU-SITIO/` redirija a `/login`.

## Variables y el límite de 4 KB

Las Functions corren en AWS Lambda: **todas las variables disponibles para Functions suman
máximo 4 KB**. Un JSON completo de service account ocupa ~2.3 KB. Recomendado:

- Usar `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` en lugar de `GOOGLE_SERVICE_ACCOUNT`.
- Versionar el mapeo en `config/bigquery.mapping.json` (no es secreto) en lugar de
  `BIGQUERY_MAPPING`.
- Marcar como *Secret* las sensibles (`GOOGLE_PRIVATE_KEY`, `MONITORING_API_KEY`,
  `N8N_WEBHOOK_SECRET`, `AUTH_SECRET`). Deja las `AUTH_*` con el alcance por defecto (todos
  los scopes): el control de sesión (`src/proxy.ts`) corre como Edge Function y también las lee.
- Las variables `AUTH_*` ocupan ~0.5 KB con dos cuentas.

## Pasar a datos reales

1. Hoja de Dataslayer (recomendado): `docs/INSTALACION.md`. O BigQuery: `docs/BIGQUERY.md`.
2. `DATA_SOURCE=sheets` (o `bigquery`) → redeploy (las variables se leen al construir y al ejecutar).
3. Configurar n8n (`docs/N8N.md`): `N8N_*`, `MONITORING_API_KEY`, `N8N_WEBHOOK_SECRET`.
4. Activar WhatsApp cuando las plantillas estén aprobadas: `WHATSAPP_ALERTS_ENABLED=true`.

## Límites a tener en cuenta

- Timeout de Functions síncronas: 10 s por defecto (se puede subir hasta 26 s en el plan). La
  evaluación usa pocas consultas con poda de particiones; `maxDuration = 26` en el endpoint de
  evaluación.
- La memoria de una Function caliente sirve de caché; un *cold start* solo cuesta una consulta.
- En MOCK MODE los cambios de estado de alertas/incidentes viven en memoria de la Function y
  pueden reiniciarse; con BigQuery quedan persistidos.
- La bitácora de accesos, tickets, acuses, historial de Monitoreos, bugs y sugerencias, la
  configuración (salvo en modo BigQuery) y, con Google Sheets, el estado de alertas e incidentes se
  guardan en **Netlify Blobs** (store `immc-records`), sin configuración extra.
  Se ven en *Netlify → Blobs*. No contienen métricas ni secretos.

## Seguridad

- Cabeceras en `next.config.ts` (`X-Frame-Options: DENY`, `nosniff`, `noindex`...) y
  `Cache-Control: private, no-store` para `/api/*` en `netlify.toml`.
- El sitio no debe indexarse (robots `noindex`).
- Acceso con contraseña integrado (`docs/AUTH.md`): toda página y `/api/*` exige sesión, salvo
  `/api/health` y `/api/monitoring/evaluate` (API key de n8n). Alternativa: `AUTH_MODE=header`
  detrás de un proxy de identidad.

## Local con Netlify CLI (opcional)

```bash
npm i -g netlify-cli
cd media-monitoring-center && netlify dev
```
