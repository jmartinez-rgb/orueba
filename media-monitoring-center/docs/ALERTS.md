# Alertas, incidentes y WhatsApp

Código: `src/lib/alerts/*`. Pruebas: `tests/incident-manager.test.ts`.

## Modelo

| Objeto | Qué es | Identidad |
|---|---|---|
| **Anomalía** | Resultado de una evaluación (efímero) | Huella = entidad + familia (`platform:meta#delivery`) |
| **Alerta** (`ALT-0001`) | Una anomalía viva; se actualiza en cada corrida | Una por huella mientras esté activa |
| **Incidente** (`INC-0001`) | Anomalía persistente o grave con línea de tiempo, owner y notas | Uno por alerta |
| **Notificación** (`NTF-0001`) | Mensaje entregado a n8n (WhatsApp / email) | Uno por evento y canal |

Campos de la alerta: ID, severidad, plataforma, cuenta, campaña, tipo, métrica, valor actual,
esperado, desviación, detectada, última actualización, duración, estado y evidencia.

Estados de alerta: **NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED / FALSE POSITIVE**.
Estados de incidente: OPEN, ACKNOWLEDGED, INVESTIGATING, RESOLVED.

## Ciclo de vida (anti-spam)

Ejemplo real de las pruebas:

| Hora | Evaluación | Qué pasa | ¿Notifica? |
|---|---|---|---|
| 09:00 | Meta −30% (ALERTA) | Se crea ALT-0001 e **INC-0001** | Sí · apertura |
| 11:00 | Meta −33% (ALERTA) | Se actualiza INC-0001 | No |
| 13:00 | Meta −42% (CRÍTICO) | Sube la severidad de INC-0001 | Sí · escalamiento |
| 15:00 | Meta −44% | Lleva 6 h abierto | Sí · recordatorio por duración (una sola vez) |
| 16:00 | Meta −45% | Se actualiza | No |
| 17:00 | Normal | INC-0001 → RESOLVED (inicio, fin, duración, desviación máxima) | Sí · recuperación |

Reglas (configurables en Settings → Alertas y escalamiento):

- **Incidente**: inmediato desde `incidentMinSeverity` (ALERTA) o tras `persistRunsForIncident`
  (2) evaluaciones consecutivas.
- **Notificar al abrir**: desde `notifyMinSeverity` (ALERTA). Una campaña que pesa menos de
  `materialShare` (15%) del gasto de su plataforma solo notifica si es CRÍTICO.
- **Escalamiento**: cuando sube la severidad.
- **Empeora**: si la desviación crece `worsenDeltaPts` (10 pp) desde el último aviso.
- **Duración**: un recordatorio al superar `escalateAfterHours` (6 h).
- **Recuperación**: al normalizar, si alguna vez se notificó (`notifyRecovery`).
- **Agrupación**: las campañas con la misma causa que su plataforma/cuenta quedan agrupadas bajo
  ese incidente (visibles en Alert Center con "Mostrar agrupadas").
- **FALSE POSITIVE**: cierra el incidente sin mensaje de recuperación, deja de pintar el estado de
  la plataforma y no vuelve a abrir incidente mientras dure esa anomalía.

## Estado general

El estado de cada plataforma sale de la severidad de sus anomalías vivas (con materialidad para
campañas y excluyendo falsos positivos); el **estado general de medios** es el peor estado de
las plataformas: 🟢 NORMAL, 🟡 ATENCIÓN, 🟠 ALERTA, 🔴 CRÍTICO.

## WhatsApp: arquitectura desacoplada

```
Anomaly Engine → gestor de incidentes → dispatcher (servidor) ──HMAC──► n8n WF08 → WhatsApp Business Cloud API
```

- La app **nunca** llama a WhatsApp ni tiene su token. El token vive en la credencial de n8n.
- Cada notificación viaja al webhook `N8N_ALERT_WEBHOOK` con cabeceras `X-IMMC-Event`,
  `X-IMMC-Timestamp` y `X-IMMC-Signature: sha256=HMAC(N8N_WEBHOOK_SECRET, "${timestamp}.${body}")`.
- El payload incluye el texto listo, la **plantilla** para la Cloud API y los destinatarios
  completos (solo servidor → n8n; en pantalla se enmascaran).
- Estados: `SENT` (n8n lo aceptó), `FAILED`, `SKIPPED` (`WHATSAPP_ALERTS_ENABLED=false`),
  `SIMULATED` (mock).

### Plantillas (obligatorias fuera de la ventana de 24 h)

Los mensajes iniciados por el negocio requieren plantillas aprobadas en WhatsApp Manager. Crear
dos plantillas de categoría *Utility*, idioma `es_MX`:

**`izzi_media_alert`** (10 variables):

```
🚨 IZZI MEDIA ALERT
{{1}}
Estado: {{2}}
Gasto actual: {{3}} · Esperado: {{4}} · Desviación: {{5}}
{{6}}
Detectado: {{7}} · Corte: {{8}}
Posible incidencia: {{9}}
Ref: {{10}}
```

**`izzi_media_recovery`** (6 variables):

```
✅ IZZI MEDIA RECOVERY
{{1}} regresó a parámetros normales.
Inicio: {{2}} · Normalización: {{3}}
Duración: {{4}} · Desviación máxima: {{5}}
Ref: {{6}}
```

El texto libre equivalente (útil dentro de la ventana de 24 h o para email) ya viene armado:

```
🚨 IZZI MEDIA ALERT
META ADS
Estado: CRÍTICO

Gasto actual: $825,421
Esperado: $1,242,550
Desviación: −33.6%

Conversaciones WhatsApp: 8,421
Promedio histórico: 12,605
Variación: −33.2%

Detectado: 09:00
Corte: 13:00
Posible incidencia: Delivery
```

```
✅ IZZI MEDIA RECOVERY
Meta Ads regresó a parámetros normales.

Inicio: 09:00
Normalización: 17:00
Duración: 8 h
Desviación máxima: −42%
```

## Destinatarios

Settings → Destinatarios: nombre, canal (WhatsApp/email), dirección, severidad mínima,
plataformas y activo. Ej.: guardia recibe ALERTA+ de todas; el líder de Meta recibe CRÍTICO de
Meta; el equipo recibe ATENCIÓN+ por email.

## Dónde se guarda

- MOCK: memoria del servidor; el historial se reconstruye reproduciendo las corridas de ayer y hoy.
- BigQuery: `monitoring_alerts`, `monitoring_incidents`, `monitoring_notifications`,
  `monitoring_runs` (append-only, última versión por id). DDL en `sql/monitoring_tables.sql`.
