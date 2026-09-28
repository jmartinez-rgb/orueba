# izzi Media Monitoring Center

Plataforma interna de monitoreo de Paid Media para izzi. Responde en segundos a la pregunta
**¿está todo izzi funcionando correctamente en este momento?** para Google Ads, Meta Ads,
TikTok Ads, Microsoft Advertising, Spotify Ads y X Ads.

No es un dashboard decorativo: compara cada plataforma, cuenta y campaña contra **el mismo día
de la semana en la misma franja horaria** (hoy 00:00–12:00 vs los 4 lunes anteriores
00:00–12:00), detecta anomalías con reglas que combinan porcentaje, volumen, variabilidad
histórica, hora, frescura del dato y peso en la inversión, agrupa todo en incidentes sin
spam y prepara las alertas que n8n envía por WhatsApp.

**Es solo de monitoreo**: no cambia campañas, presupuestos ni configuraciones en ninguna
plataforma, y la app nunca envía WhatsApp por sí misma (las alertas las entrega n8n y el mensaje de
monitoreo se copia y se envía a mano). El acceso es con contraseña y cada entrada queda registrada.

```
APIs publicitarias → n8n (ingesta) → BigQuery → Data Health → Monitoring Engine → Anomaly Engine → API (Next.js) → UI (Netlify)
                                                                                   ↘ n8n → WhatsApp Business Cloud API
```

## Arranque rápido

Requisitos: Node.js 22+.

```bash
cd media-monitoring-center
npm install
cp .env.example .env.local        # USE_MOCK_DATA=true ya viene activo
npm run auth:setup -- --write     # opcional: contraseñas y cuentas en .env.local (ver docs/AUTH.md)
npm run dev                       # http://localhost:3000
```

Sin configurar el acceso, en local se entra sin contraseña (aviso de *modo abierto*); en
producción el sitio queda bloqueado hasta configurar `AUTH_*`. Cuentas: `jmartinez`
(Administrador), `operaciones` (Co-administrador) y una contraseña universal con la que cada
persona entra con su nombre.

Sin credenciales de datos la app funciona completa en **MOCK MODE**: 15 semanas de datos horarios
simulados, 6 plataformas, 26 cuentas (varias por plataforma, algunas en USD), 76 campañas con los
nombres del equipo, presupuestos a nivel cuenta y campaña, hoja de control, sincronizaciones e
incidentes. El escenario por defecto muestra:

| Plataforma | Estado | Qué está pasando |
|---|---|---|
| Google Ads | 🟢 Normal | Sin anomalías del motor; frente a ayer hay campañas con más gasto y cuentas con menos conversiones (aparecen en el mensaje de Monitoreos) |
| Meta Ads | 🔴 Crítico | 9 campañas con caída simultánea de delivery (incidente de plataforma), una campaña activa con gasto $0 y otra con ventas en cero (tracking) |
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
| `npm test` | Pruebas de motores (comparación, anomalías, incidentes, pacing, data health, BigQuery, escenarios), acceso, clasificadores, monedas, confianza y mensaje de monitoreo |
| `npm run check` | typecheck + lint + tests |
| `npm run auth:setup` | Genera contraseñas nuevas, sus hashes y `AUTH_SECRET` (`-- --write` los guarda en `.env.local`) |
| `npm run auth:hash -- "contraseña"` | Hash scrypt de una contraseña elegida |

## Páginas

| Grupo | Páginas |
|---|---|
| Monitoreo | Overview · Live Monitoring · Platforms (y `/platforms/{google\|meta\|tiktok\|microsoft\|spotify\|x}`) · Campaigns · **Monitoreos** (mensaje de WhatsApp manual) |
| Alertas | Alerts · Incidents · **Tickets** |
| Análisis | Budget Control · Compare (por plataforma, cuenta, estrategia, objetivo o campaña) · Historical · **Métricas** · **Optimizaciones** |
| Operación | Integrations · Automation · **Usuarios** (administradores) · Settings |
| Ayuda | **Guía** |

Además: `/login`, alerta crítica a pantalla completa con acuse obligatorio, confianza de datos
(0–100%) por plataforma, métrica monitoreada por plataforma, conversión USD→MXN con tasa mensual y
gráficas con vista de tabla. Modo oscuro y claro, responsive.

## Estructura

```
media-monitoring-center/
├── src/app/                 (app)/ páginas con sesión, login/, API routes (/api/*)
├── src/proxy.ts             Exige sesión en páginas y API (redirige a /login)
├── src/components/          UI: shadcn/ui (ui/), RareUI (rareui/), layout, monitoreo, gráficas (Recharts)
├── src/lib/
│   ├── config/              Variables de entorno (servidor) y configuración operativa
│   ├── data/                Contrato de datos (MonitoringDataSource), caché y conversión USD→MXN
│   ├── mock/                Generador de datos simulados y escenarios de anomalías
│   ├── bigquery/            Cliente, mapeo configurable del esquema, SQL y fuente real
│   ├── google/              Lectura (solo lector) de la hoja de control en Google Sheets
│   ├── classifiers/         Clasificadores de estrategia (réplica de las fórmulas de Meta y Google)
│   ├── monitoring/          MonitoringEngine, comparador histórico, PacingEngine, Data Health, confianza, objetivos fijos
│   ├── anomaly-engine/      AnomalyEngine (reglas de patrón y severidad)
│   ├── alerts/              Alertas, incidentes, anti-spam, formato WhatsApp, despacho a n8n
│   ├── n8n/                 Cliente de webhooks firmado y catálogo de workflows
│   ├── state/               Persistencia de estado (memoria o BigQuery)
│   ├── services/            Orquestación para páginas y API (snapshot, budget, compare, reporte, críticos...)
│   ├── reports/             Formato del mensaje de monitoreo para WhatsApp
│   ├── optimizations/       Recomendaciones de la documentación oficial de cada plataforma
│   ├── records/             Bitácora, tickets, acuses e historial (Netlify Blobs / archivos locales)
│   ├── auth/                Roles, contraseñas (scrypt), sesión firmada y límite de intentos
│   └── logging/             Logging estructurado sin secretos
├── config/                  Ejemplos de mapeo de BigQuery y plantilla de la hoja de control
├── scripts/                 auth:setup y auth:hash (contraseñas y hashes, nunca se guardan en el repo)
├── sql/                     DDL de las tablas propias de la app
├── n8n/workflows/           Plantillas importables (WF07 Monitoring Runner, WF08 WhatsApp Alert)
├── tests/                   Vitest
├── docs/                    Documentación técnica
└── netlify.toml             Build y plugin de Next.js para Netlify
```

## Documentación

- [docs/GUIA.md](docs/GUIA.md): qué hay en cada sección, cómo leer el semáforo, mensaje de Monitoreos y clasificadores.
- [docs/AUTH.md](docs/AUTH.md): cuentas, contraseña universal, roles y bitácora de accesos.
- [docs/DATOS.md](docs/DATOS.md): API directa o Sheets, hoja de control, monedas, presupuestos y varias cuentas.
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
| 7. Acceso con contraseña, bitácora, Monitoreos, tickets, alerta crítica, monedas, clasificadores, confianza | ✅ con pruebas |
| 8. Integraciones reales (proyecto, tablas, hoja de control, n8n, plantillas de WhatsApp) | Pendiente de accesos |
