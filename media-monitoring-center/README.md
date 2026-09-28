# izzi Media Monitoring Center

Plataforma interna de monitoreo de Paid Media para izzi. Responde en segundos a la pregunta
**¿está todo izzi funcionando correctamente en este momento?** para Google Ads, Meta Ads,
TikTok Ads, Microsoft Advertising, Spotify Ads y X Ads.

No es un dashboard decorativo: compara cada plataforma, cuenta y campaña contra **el mismo día
de la semana en la misma franja horaria** (hoy 00:00–12:00 vs los 4 lunes anteriores
00:00–12:00), detecta anomalías con reglas que combinan porcentaje, volumen, variabilidad
histórica, hora, frescura del dato y peso en la inversión, agrupa todo en incidentes sin
spam y prepara las alertas que n8n envía por WhatsApp.

```
APIs publicitarias → n8n (ingesta) → BigQuery → Data Health → Monitoring Engine → Anomaly Engine → API (Next.js) → UI (Netlify)
                                                                                   ↘ n8n → WhatsApp Business Cloud API
```

## Arranque rápido

Requisitos: Node.js 22+.

```bash
cd media-monitoring-center
npm install
cp .env.example .env.local   # USE_MOCK_DATA=true ya viene activo
npm run dev                  # http://localhost:3000
```

Sin credenciales la app funciona completa en **MOCK MODE**: 15 semanas de datos horarios
simulados, 6 plataformas, 11 cuentas, 37 campañas, presupuestos, sincronizaciones e incidentes.
El escenario por defecto muestra:

| Plataforma | Estado | Qué está pasando |
|---|---|---|
| Google Ads | 🟢 Normal | Sin anomalías |
| Meta Ads | 🔴 Crítico | 7 campañas con caída simultánea de delivery (incidente de plataforma), una campaña activa con gasto $0 y otra con ventas en cero (tracking) |
| TikTok Ads | 🟢 Normal | Ayer tuvo una caída 09:00–15:00 que se recuperó (incidente resuelto con mensaje de recuperación) |
| Microsoft Advertising | 🟡 Atención | Caída de conversiones, sobreinversión en una campaña pequeña y una cuenta con DATA DELAYED (excluida de la comparación) |
| Spotify Ads | 🟢 Normal | — |
| X Ads | 🟢 Normal | Una campaña sin conversión configurada (NULL, no cero) |

Otros escenarios (menú de usuario → *Escenario simulado*): **Todo normal**, **Meta sin datos
recientes** (DATA DELAYED en lugar de $0 y un ERROR de sincronización en X) y **TikTok dejó de
gastar** (datos al día, gasto en cero las últimas 3 horas).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo local |
| `npm run build` | Build de producción (lo mismo que corre Netlify) |
| `npm start` | Sirve el build |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run lint` | ESLint (config de Next.js) |
| `npm test` | Pruebas de motores (comparación, anomalías, incidentes, pacing, data health, BigQuery, escenarios) |
| `npm run check` | typecheck + lint + tests |

## Páginas

Overview · Live Monitoring · Platforms (y `/platforms/{google|meta|tiktok|microsoft|spotify|x}`) ·
Campaigns · Alerts · Incidents · Budget Control · Compare · Historical · Integrations ·
Automation · Settings. Modo oscuro y claro, responsive (en móvil se priorizan estado, alertas,
incidentes y plataformas).

## Estructura

```
media-monitoring-center/
├── src/app/                 Páginas (App Router) y API routes (/api/*)
├── src/components/          UI: shadcn/ui (ui/), layout, monitoreo y gráficas (Recharts)
├── src/lib/
│   ├── config/              Variables de entorno (servidor) y configuración operativa
│   ├── data/                Contrato de datos (MonitoringDataSource) y caché
│   ├── mock/                Generador de datos simulados y escenarios de anomalías
│   ├── bigquery/            Cliente, mapeo configurable del esquema, SQL y fuente real
│   ├── monitoring/          MonitoringEngine, comparador histórico, PacingEngine, Data Health
│   ├── anomaly-engine/      AnomalyEngine (reglas de patrón y severidad)
│   ├── alerts/              Alertas, incidentes, anti-spam, formato WhatsApp, despacho a n8n
│   ├── n8n/                 Cliente de webhooks firmado y catálogo de workflows
│   ├── state/               Persistencia de estado (memoria o BigQuery)
│   ├── services/            Orquestación para páginas y API (snapshot, budget, compare...)
│   ├── auth/                Roles (Admin, Paid Media Manager, Viewer) y sesión
│   └── logging/             Logging estructurado sin secretos
├── config/                  Ejemplos de mapeo de BigQuery
├── sql/                     DDL de las tablas propias de la app
├── n8n/workflows/           Plantillas importables (WF07 Monitoring Runner, WF08 WhatsApp Alert)
├── tests/                   Vitest
├── docs/                    Documentación técnica
└── netlify.toml             Build y plugin de Next.js para Netlify
```

## Documentación

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): capas, flujo de datos y decisiones.
- [docs/MONITORING_ENGINE.md](docs/MONITORING_ENGINE.md): regla de comparación, anomalías, pacing, data health.
- [docs/ALERTS.md](docs/ALERTS.md): alertas, incidentes, anti-spam, escalamiento y WhatsApp.
- [docs/BIGQUERY.md](docs/BIGQUERY.md): cómo conectar el esquema real sin tocar código.
- [docs/N8N.md](docs/N8N.md): los 10 workflows y cómo se conectan con la app.
- [docs/NETLIFY.md](docs/NETLIFY.md): deploy continuo desde GitHub.
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md): todas las variables y dónde van.

## Fases

| Fase | Estado |
|---|---|
| 1. Estructura, Next.js, Tailwind, shadcn, Netlify, layout, sidebar, mock | ✅ |
| 2. Overview, Live, Platforms, tablas, gráficas, alertas, incidentes | ✅ |
| 3. Monitoring, Anomaly y Pacing Engine, comparador histórico | ✅ con pruebas |
| 4. Capa BigQuery, toggle mock/real, consultas, Data Health | ✅ lista para configurar |
| 5. Integración n8n: webhooks firmados, triggers, endpoint de evaluación | ✅ lista para configurar |
| 6. Arquitectura de WhatsApp, bitácora de notificaciones, escalamientos | ✅ lista para configurar |
| 7. Integraciones reales (proyecto, tablas, n8n, plantillas de WhatsApp) | Pendiente de accesos |
