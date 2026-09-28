# n8n

n8n es el orquestador: ingestas, ejecuciones programadas, monitoreo cada 2 horas, alertas,
escalamientos, recuperaciones, webhooks, registro de errores y reintentos. Netlify no sustituye
a n8n (la app no tiene tareas programadas propias).

## Conexión con la app

| Dirección | Mecanismo | Seguridad |
|---|---|---|
| n8n → app | `POST {APP_URL}/api/monitoring/evaluate` | `Authorization: Bearer MONITORING_API_KEY` |
| app → n8n | Webhooks `N8N_MONITORING_WEBHOOK`, `N8N_ALERT_WEBHOOK`, `N8N_MANUAL_SYNC_WEBHOOK` | Firma `X-IMMC-Signature` (HMAC SHA-256 con `N8N_WEBHOOK_SECRET` sobre `${timestamp}.${body}`) + `X-IMMC-Timestamp` |
| app → n8n (prueba) | `GET {N8N_BASE_URL}/healthz` | No dispara workflows |

Las URLs de webhook pueden ser completas o rutas relativas a `N8N_BASE_URL`. Nunca se
codifican en el repositorio. Reintentos: 2 con backoff (0.5 s, 1.5 s) ante error de red o 5xx;
timeout `N8N_TIMEOUT_MS`.

Variables del lado de n8n (no de la app): `IMMC_APP_URL`, `IMMC_MONITORING_API_KEY`,
`IMMC_WEBHOOK_SECRET` (= `N8N_WEBHOOK_SECRET`), `WHATSAPP_PHONE_NUMBER_ID`, `META_API_VERSION`,
credencial *HTTP Header Auth* con el token de WhatsApp, y
`NODE_FUNCTION_ALLOW_BUILTIN=crypto` para verificar la firma en el Code node.

## Workflows

| ID | Nombre | Disparador | Qué hace |
|---|---|---|---|
| WF01 | Google ingestion | Cron horario (:05) + sync manual | Google Ads (MCC) → MERGE en la tabla horaria/cortes de BigQuery; escribe en el sync log |
| WF02 | Meta ingestion | Cron horario (:05) + sync manual | Insights de Meta; conserva por separado Compras Offline Web (Inbound) y On-Facebook Purchase |
| WF03 | TikTok ingestion | Cron horario | Reporte de TikTok Ads → BigQuery |
| WF04 | Microsoft ingestion | Cron horario | Reporting API de Microsoft Advertising → BigQuery |
| WF05 | Spotify ingestion | Cron horario | Spotify Ads → BigQuery |
| WF06 | X ingestion | Cron horario | X Ads → BigQuery |
| WF07 | Monitoring Runner | Cron `0 7-23/2 * * *` (zona America/Mexico_City) + webhook | Llama a `/api/monitoring/evaluate`; la app evalúa, agrupa, persiste y entrega notificaciones a WF08 |
| WF08 | WhatsApp Alert | Webhook (`N8N_ALERT_WEBHOOK`) | Verifica la firma, separa destinatarios y envía la plantilla por WhatsApp Business Cloud API |
| WF09 | Incident Escalation | Rama de WF08 (`kind` = ESCALATED / DURATION_EXCEEDED) | Agrega destinatarios de segundo nivel (líderes) |
| WF10 | Recovery Notifications | Rama de WF08 (`kind` = RECOVERED) | Mensaje de recuperación (plantilla `izzi_media_recovery`) |

Plantillas importables: `n8n/workflows/WF07-monitoring-runner.json` y
`n8n/workflows/WF08-whatsapp-alert.json` (se importan desactivadas; revisar credenciales y
variables antes de activar).

### Recomendaciones para las ingestas (WF01–WF06)

- Una ejecución por hora al minuto :05; reintentos del nodo HTTP (3, espera exponencial).
- `MERGE` idempotente por (fecha, hora, cuenta, campaña) o insertar cortes con `cargado_en`.
- Registrar cada ejecución en la tabla de sync log (plataforma, inicio, fin, estado, filas,
  mensaje): la app la usa para Data Health e Integrations.
- *Error workflow* común que registre el fallo y, si se repite, avise por email.
- El sync manual (`N8N_MANUAL_SYNC_WEBHOOK`, botón **Actualizar ahora**) corre las ingestas y al
  final llama al webhook de WF07 para reevaluar.

## Payload que recibe WF08

```json
{
  "event": "alert",
  "sentAt": "2026-09-28T19:00:00.000Z",
  "source": "izzi-media-monitoring-center",
  "payload": {
    "notificationId": "NTF-0012",
    "incidentId": "INC-0008",
    "kind": "ESCALATED",
    "severity": "CRITICAL",
    "platform": "meta",
    "channel": "whatsapp",
    "text": "🚨 IZZI MEDIA ALERT · ESCALAMIENTO\nMETA ADS\n…",
    "whatsappTemplate": { "name": "izzi_media_alert", "language": { "code": "es_MX" }, "components": [ … ] },
    "recipientCount": 2,
    "recipients": [{ "name": "Guardia Paid Media", "address": "+52 55 …" }]
  }
}
```

Llamada a la Cloud API que hace WF08 por destinatario:

```
POST https://graph.facebook.com/{META_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages
Authorization: Bearer <token en credencial de n8n>
{ "messaging_product": "whatsapp", "to": "5255…", "type": "template", "template": { … } }
```

## Respuesta de `/api/monitoring/evaluate`

```json
{
  "ok": true, "mode": "bigquery", "persisted": true, "runAt": "…", "cutoffHour": 13,
  "overall": "CRITICAL",
  "platforms": { "meta": { "severity": "CRITICAL", "dataState": "OK" }, "…": {} },
  "anomalies": 6, "openIncidents": 4,
  "notifications": [{ "id": "NTF-0012", "kind": "ESCALATED", "platform": "meta", "status": "SENT" }]
}
```

`{ "dryRun": true }` evalúa sin enviar ni persistir. En MOCK MODE el endpoint siempre es un
ensayo (y funciona sin API key para poder probarlo).
