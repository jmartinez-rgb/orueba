# Arquitectura

## Visión general

```
                 ┌──────────────────────────── n8n ───────────────────────────┐
APIs de Google,  │ WF01–WF06 ingesta horaria ─► MERGE a BigQuery + sync log    │
Meta, TikTok,    │ WF07 Monitoring Runner (07–23 cada 2 h) ─► POST /api/…/evaluate
Microsoft,       │ WF08 WhatsApp Alert ◄── webhook firmado ── app               │
Spotify, X ──────┤ WF09 Escalamiento · WF10 Recuperación                        │
                 └────────────────────────────────────────────────────────────┘
                                   │                         ▲
                                   ▼                         │ notificaciones (HMAC)
                         ┌──────────────────┐                │
                         │  Google BigQuery │  fuente única de verdad
                         │  métricas · cortes · presupuestos · sync log
                         │  alertas · incidentes · corridas · settings (tablas de la app)
                         └──────────────────┘
                                   │ SQL parametrizado, con filtro de partición
                                   ▼
┌──────────────────────── Next.js en Netlify (servidor) ────────────────────────┐
│ lib/bigquery  →  lib/data (contrato + caché)  →  lib/monitoring (Data Health,   │
│ comparador histórico, PacingEngine, MonitoringEngine)  →  lib/anomaly-engine   │
│ →  lib/alerts (incidentes, anti-spam, WhatsApp)  →  lib/services  →  API routes│
└────────────────────────────────────────────────────────────────────────────────┘
                                   │ solo modelos de vista (sin credenciales)
                                   ▼
                        Navegador: React Server Components + gráficas cliente
```

## Principios

1. **El frontend nunca habla con BigQuery.** Las páginas son Server Components que llaman a
   `lib/services`; los componentes cliente reciben modelos de vista chicos. Ninguna variable
   secreta tiene prefijo `NEXT_PUBLIC_`; `server-only` impide importar módulos de servidor en el
   navegador.
2. **Un solo contrato de datos** (`lib/data/source.ts` → `MonitoringDataSource`). El mock y
   BigQuery lo implementan igual; motores y UI no saben de dónde vienen los datos.
3. **Nada de tablas inventadas.** El esquema real se declara en un mapeo (`lib/bigquery/mapping.ts`,
   `config/*.json`). Se soportan varias tablas (p. ej. una por plataforma), forma horaria o de
   cortes acumulados, fecha local o timestamp UTC.
4. **NULL ≠ 0 ≠ DATA DELAYED ≠ ERROR.** Las métricas son `number | null`; la suma respeta NULL;
   la frescura se valida antes de evaluar rendimiento.
5. **Motores puros y probados.** `runMonitoring`, `detectAnomalies`, `reconcile` y el
   PacingEngine son funciones sin efectos secundarios (fuera de la fuente de datos), con pruebas
   en `tests/`.
6. **n8n orquesta, Netlify aloja.** La app no programa tareas ni envía WhatsApp: expone
   `POST /api/monitoring/evaluate` para el runner de n8n y entrega notificaciones a un webhook
   firmado de n8n.

## Capas

| Capa | Módulo | Responsabilidad |
|---|---|---|
| Configuración | `lib/config` | `env.ts` (solo servidor), `settings.ts` (umbrales, frecuencia, histórico, zona horaria, destinatarios; validado con zod) |
| Tiempo | `lib/time/tz.ts` | Fechas y horas de negocio con `Intl`; conversión explícita UTC ↔ local |
| Datos | `lib/data`, `lib/mock`, `lib/bigquery` | Contrato, caché TTL por fecha, mock determinista, SQL parametrizado |
| Monitoreo | `lib/monitoring` | Data Health, comparador (mismo día + franja), PacingEngine, MonitoringEngine |
| Anomalías | `lib/anomaly-engine` | Reglas de patrón (casos 1–7), severidad, agrupación jerárquica |
| Alertas | `lib/alerts` | Alertas → incidentes, anti-spam, escalamiento, formato WhatsApp, despacho a n8n |
| Estado | `lib/state` | Memoria (mock/dev) o BigQuery (append-only) |
| Servicios | `lib/services` | Snapshot, budget, compare, historical, integraciones, evaluación programada |
| UI | `src/app`, `src/components` | Páginas, tablas, gráficas, estados vacíos/errores |

## Flujo de una evaluación (cada 2 h)

1. n8n WF07 llama `POST /api/monitoring/evaluate` con `Authorization: Bearer MONITORING_API_KEY`.
2. La app invalida la caché del día en curso y consulta BigQuery: filas horarias del día + las
   mismas fechas de las N semanas anteriores (4 por defecto) con poda de particiones.
3. **Data Health**: frescura por plataforma y cuenta, horas faltantes, duplicados, nulos, carga
   incompleta. Las cuentas atrasadas se excluyen de la comparación de su plataforma.
4. **MonitoringEngine**: ventana acumulada `[00:00, corte)` y ventana reciente (últimas 2 h) contra
   las mismas ventanas de semanas anteriores; valor esperado, desviaciones, pacing con curva
   horaria histórica.
5. **AnomalyEngine**: reglas de patrón + ajustes (volumen, significancia, variabilidad, hora,
   materialidad) + agrupación jerárquica.
6. **Gestor de incidentes**: reconcilia con el estado persistido; decide qué notificar.
7. Notificaciones → webhook de n8n (WF08) → WhatsApp Business Cloud API.
8. Persistencia en BigQuery: alertas, incidentes, notificaciones y resumen de la corrida.

La UI calcula además una **vista previa en vivo** al abrir cada página (misma lógica, sin
notificar ni persistir), con caché de 1 minuto.

## MOCK MODE

`USE_MOCK_DATA=true` (o si falta la configuración de BigQuery). El mock genera 15 semanas de
datos horarios por campaña con curvas horarias por plataforma, estacionalidad semanal, ruido
determinista y los escenarios de `lib/mock/scenarios.ts`. Para que el historial de incidentes
sea real, **reproduce las corridas programadas de ayer y hoy** a través del mismo motor y del
mismo gestor de incidentes; las notificaciones quedan como `SIMULATED`.

## Caché y costo

- Histórico cerrado: 6 h por fecha; día en curso: 4 min; frescura: 2 min.
- Las fechas faltantes se piden en una sola consulta y se guardan por fecha: cambiar de página no
  vuelve a consultar el histórico.
- `maximumBytesBilled` en cada consulta, etiquetas `app`/`query` para auditar costo, sin `SELECT *`
  sobre tablas de origen.

## Seguridad

- Secretos solo en variables de entorno del servidor (Netlify) o credenciales de n8n.
- Webhooks a n8n firmados (HMAC SHA-256 con timestamp); endpoint de evaluación con API key y
  comparación en tiempo constante.
- Roles: Admin (todo), Paid Media Manager (alertas, incidentes, presupuestos, disparar
  evaluaciones), Viewer (lectura). `AUTH_MODE=header` delega la identidad a un proxy/SSO.
- Destinatarios enmascarados en pantalla para quien no administra; logs con redacción de llaves
  sensibles; errores técnicos solo detrás de "Ver detalles técnicos".
- Cabeceras: `X-Frame-Options: DENY`, `nosniff`, `noindex`, `Referrer-Policy`, `Permissions-Policy`.
