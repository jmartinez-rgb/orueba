# Variables de entorno

Plantilla: `.env.example` (sin valores reales). Local: `.env.local` (ignorado por git). Netlify:
*Site configuration → Environment variables*. **Nunca** subir `.env` ni credenciales.

Solo las variables con prefijo `NEXT_PUBLIC_` llegan al navegador; ninguna de ellas es secreta.
Todo lo demás se lee en `src/lib/config/env.ts` (módulo `server-only`).

## App y datos

| Variable | Default | Descripción |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | izzi Media Monitoring Center | Nombre visible |
| `USE_MOCK_DATA` | `true` | `true` = datos simulados. `false` = BigQuery (si falta configuración válida, vuelve a mock y lo avisa en Integrations) |
| `MOCK_SCENARIO` | `default` | `default`, `normal`, `meta-delayed`, `tiktok-stopped` |
| `MOCK_REFERENCE_TIME` | — | Hora fija del mock (ISO) para demos reproducibles |
| `APP_TIMEZONE` | `America/Mexico_City` | Zona horaria de negocio (Settings puede cambiarla) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

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

## Autenticación

| Variable | Default | Descripción |
|---|---|---|
| `AUTH_MODE` | `dev` | `dev`: rol elegido desde la interfaz (desarrollo). `header`: rol en cabeceras `x-immc-role`, `x-immc-user`, `x-immc-email` puestas por un proxy/SSO de confianza |
| `AUTH_DEFAULT_ROLE` | `admin` | Rol inicial en modo `dev`: `admin`, `manager`, `viewer` |

## Buenas prácticas

- Rotar `MONITORING_API_KEY` y `N8N_WEBHOOK_SECRET` en ambos lados (Netlify y n8n) a la vez.
- Si se requiere, mover los secretos a Google Secret Manager y cargarlos en el arranque; la app
  solo necesita que existan como variables de entorno.
- Los logs nunca imprimen secretos: el logger enmascara llaves como `token`, `secret`, `key`,
  `password`, `authorization`, `private`, `service_account`.
