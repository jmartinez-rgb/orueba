# Variables de entorno

Plantilla: `.env.example` (sin valores reales). Local: `.env.local` (ignorado por git). Netlify:
*Site configuration → Environment variables*. **Nunca** subir `.env` ni credenciales.

Solo las variables con prefijo `NEXT_PUBLIC_` llegan al navegador; ninguna de ellas es secreta.
Todo lo demás se lee en `src/lib/config/env.ts` y, lo de acceso, en `src/lib/auth/config.ts`
(módulos `server-only`).

## App y datos

| Variable | Default | Descripción |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | izzi Media Monitoring Center | Nombre visible |
| `DATA_SOURCE` | `mock` | `mock` (simulados), `sheets` (hoja de Google Sheets que llena Dataslayer) o `bigquery`. Si falta la configuración de la fuente elegida, usa datos simulados y lo avisa en Integrations |
| `USE_MOCK_DATA` | `true` | Compatibilidad: sin `DATA_SOURCE`, `false` elige Sheets o BigQuery según lo configurado |
| `MOCK_SCENARIO` | `default` | `default`, `normal`, `meta-delayed`, `tiktok-stopped` |
| `MOCK_REFERENCE_TIME` | — | Hora fija del mock (ISO) para demos reproducibles |
| `APP_TIMEZONE` | `America/Mexico_City` | Zona horaria de negocio (Settings puede cambiarla) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Google Sheets (Dataslayer)

Ver `docs/INSTALACION.md` y `docs/DATOS.md`. Se configura con `npm run sheets:setup`.

| Variable | Secreta | Descripción |
|---|---|---|
| `SHEETS_SPREADSHEET_ID` | No* | ID de la hoja (entre `/d/` y `/edit` en la URL) |
| `SHEETS_MAPPING` | No | Mapeo JSON de pestañas y columnas (alternativa al archivo) |
| `SHEETS_MAPPING_FILE` | No | Ruta del mapeo (default `config/sheets.mapping.json`, versionado) |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | **Sí** (la llave) | Cuenta de servicio con permiso de **Lector** en la hoja (compartida con ese correo) |
| `SHEETS_FIXTURE_FILE` | No | Solo desarrollo: lee la hoja desde un JSON local (pruebas sin Google). Se ignora en producción |

\* El ID no da acceso por sí solo (la hoja debe estar compartida), pero no la publiques en internet.

## BigQuery

| Variable | Secreta | Descripción |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | No | Proyecto |
| `BIGQUERY_DATASET` | No | Dataset de métricas |
| `BIGQUERY_STATE_DATASET` | No | Dataset de tablas de la app (default = `BIGQUERY_DATASET`) |
| `BIGQUERY_LOCATION` | No | `US`, `us-central1`… (default `US`) |
| `BIGQUERY_MAX_BYTES_BILLED` | No | Tope de bytes por consulta (default 5 GB) |
| `BIGQUERY_MAPPING` | No | Mapeo JSON (alternativa: `config/bigquery.mapping.json`) |
| `BIGQUERY_MAPPING_FILE` | No | Ruta del mapeo (default `config/bigquery.mapping.json`) |
| `GOOGLE_CLIENT_EMAIL` | No | Service account (opción recomendada en Netlify) |
| `GOOGLE_PRIVATE_KEY` | **Sí** | Llave privada (acepta `\n` escapados) |
| `GOOGLE_SERVICE_ACCOUNT` | **Sí** | Alternativa: JSON completo (texto o base64). Ojo con el límite de 4 KB de Netlify |

Sin credenciales explícitas el cliente usa *Application Default Credentials* (útil si algún día
corre dentro de GCP).

## n8n

| Variable | Secreta | Descripción |
|---|---|---|
| `N8N_BASE_URL` | No | URL base de n8n (también para `/healthz`) |
| `N8N_MONITORING_WEBHOOK` | No* | Webhook de WF07 (ruta o URL completa) |
| `N8N_ALERT_WEBHOOK` | No* | Webhook de WF08 (notificaciones) |
| `N8N_MANUAL_SYNC_WEBHOOK` | No* | Webhook del sync manual (botón Actualizar ahora) |
| `N8N_WEBHOOK_SECRET` | **Sí** | Firma HMAC de los webhooks |
| `N8N_TIMEOUT_MS` | No | Timeout por intento (default 10000) |
| `MONITORING_API_KEY` | **Sí** | Llave que n8n envía a `/api/monitoring/evaluate` |

\* Las URLs de webhook de n8n funcionan como capacidad: trátalas como sensibles aunque vayan
firmadas.

## WhatsApp (vía n8n)

| Variable | Descripción |
|---|---|
| `WHATSAPP_ALERTS_ENABLED` | `true` para entregar notificaciones de WhatsApp a n8n |
| `WHATSAPP_TEMPLATE_ALERT` | Plantilla de alerta (default `izzi_media_alert`) |
| `WHATSAPP_TEMPLATE_RECOVERY` | Plantilla de recuperación (default `izzi_media_recovery`) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Idioma (default `es_MX`) |

El token de WhatsApp Business **no** es una variable de la app: vive en la credencial de n8n.

## Acceso (ver `docs/AUTH.md`)

| Variable | Secreta | Descripción |
|---|---|---|
| `AUTH_SECRET` | **Sí** | Firma de las sesiones (32+ caracteres aleatorios). Cambiarla cierra todas las sesiones |
| `AUTH_USERS` | No* | JSON en una línea: `[{"u":"jmartinez","n":"J. Martínez","r":"admin","h":"scrypt:…"}]`. Roles: `admin`, `coadmin`, `manager`, `viewer` |
| `AUTH_UNIVERSAL_PASSWORD_HASH` | No* | Hash de la contraseña universal (cada persona entra con su nombre) |
| `AUTH_UNIVERSAL_ROLE` | No | `viewer` (default) o `manager` |
| `AUTH_SESSION_HOURS` | No | Duración de la sesión (default 12, máximo 336) |
| `AUTH_MODE` | No | Vacío = automático (recomendado). `open` = sin contraseña (solo demo local). `header` = identidad en `x-immc-user`, `x-immc-role`, `x-immc-email` de un proxy/SSO de confianza. El valor antiguo `dev` cuenta como automático |
| `AUTH_DEFAULT_ROLE` | No | Rol en modo abierto (default `admin`) |

\* Son hashes scrypt (no contraseñas), pero trátalos como sensibles. Se generan con
`npm run auth:setup` o `npm run auth:hash`; las contraseñas nunca se guardan en ningún lado.

Modo automático: con `AUTH_SECRET` válido y al menos una credencial pide contraseña; sin
configurar, en local entra en modo abierto (con aviso) y en producción queda **bloqueado**.

## Registros de la app

Bitácora de accesos, tickets, acuses de alertas críticas e historial de mensajes de Monitoreos.

| Variable | Default | Descripción |
|---|---|---|
| `RECORDS_BACKEND` | automático | `blobs` (Netlify Blobs, automático en Netlify), `file` (local) o `memory` |
| `RECORDS_DIR` | `.data/records` | Carpeta para `file` (ignorada por git) |

No hace falta configurar nada en Netlify: el sitio ya tiene acceso a Netlify Blobs. Las métricas
nunca se guardan aquí (viven en BigQuery).

## Buenas prácticas

- Rotar `MONITORING_API_KEY` y `N8N_WEBHOOK_SECRET` en ambos lados (Netlify y n8n) a la vez.
- Rotar `AUTH_SECRET` y la contraseña universal cuando alguien deja el equipo.
- Si se requiere, mover los secretos a Google Secret Manager y cargarlos en el arranque; la app
  solo necesita que existan como variables de entorno.
- Los logs nunca imprimen secretos: el logger enmascara llaves como `token`, `secret`, `key`,
  `password`, `authorization`, `private`, `service_account`.
