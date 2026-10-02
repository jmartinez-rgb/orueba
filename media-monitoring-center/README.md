# Media Monitoring Center (izzi · Sky)

**Dominios y Absolute Top:** [implementación, reglas y validación](docs/DOMINIOS_ABSOLUTE_TOP.md)
en `codex/dominios-absolute-top`. El selector global clasifica Google izzi en Primer, Segundo
y Tercer Dominio. `/absolute-top` evalúa campañas y grupos Search por separado con mínimos
70%, 10% y 25%, conserva historia privada y muestra afectaciones sin ocultarlas por el promedio.
`npm run absolute-top:sync -- --help` explica la extracción explícita; abrir la página solo relee
las auditorías guardadas. Se comprobaron las cuatro cuentas izzi en granularidad diaria y
horaria para el 1 de octubre de 2026, con reloj `America/Mexico_City`; las auditorías diarias
quedaron almacenadas localmente en privado. La conciliación independiente sigue pendiente.

**Entrega vigente para la fase final:** [guía de auditoría y continuación](docs/ENTREGA_CLAUDE_FASE_FINAL.md)
y [prompt listo para pegar](docs/PROMPT_PARA_CLAUDE.md). Usar el último HEAD de
`codex/dominios-absolute-top`, que contiene la base funcional `2c8ca56` y esta documentación.
Incluye evidencia fechada, revisión UX, permisos, conciliación y tareas manuales. La
[entrega de la base v1](docs/ENTREGA_CLAUDE_V1.md) conserva contexto histórico.
La publicación confirmada es del entorno de Codex; no hay URLs públicas confirmadas ni
aceptación de producción.

Plataforma interna de monitoreo de Paid Media para **izzi y Sky**, cada una como un monitoreo
aparte que se cambia con un botón (izzi | Sky). Responde en segundos a la pregunta **¿está todo
funcionando correctamente en este momento?** para Google Ads, Meta Ads, TikTok Ads, Microsoft
Advertising, Spotify Ads y X Ads.

No es un dashboard decorativo: compara cada plataforma, cuenta y campaña contra **el mismo día
de la semana en la misma franja horaria** (hoy 00:00–12:00 vs los 4 lunes anteriores
00:00–12:00), detecta anomalías con reglas que combinan porcentaje, volumen, variabilidad
histórica, hora, frescura del dato y peso en la inversión, agrupa todo en incidentes sin
spam y prepara las alertas que n8n envía por WhatsApp.

**Es solo de monitoreo**: no cambia campañas, presupuestos ni configuraciones en ninguna
plataforma, y la app nunca envía WhatsApp por sí misma (las alertas las entrega n8n y el mensaje de
monitoreo se copia y se envía a mano). El acceso es con contraseña y cada entrada queda registrada;
el administrador crea las cuentas, asigna contraseñas, permisos y marcas desde la propia app.

```
Plataformas → unified-ads-api → unified:sync → histórico privado ─┐
            → Dataslayer (cada 2 h) → Google Sheets ─────────────┤
            → n8n (ingesta) → BigQuery ──────────────┴→ Data Health → Monitoring Engine → Anomaly Engine → API (Next.js) → UI (Netlify)
                                                                                           ↘ n8n → WhatsApp Business Cloud API
```

**Instalación paso a paso:** [docs/INSTALACION.md](docs/INSTALACION.md) (hoja de Dataslayer,
cuenta de servicio, computadora, Netlify).

**Preparación de v1:** [docs/V1.md](docs/V1.md), con configuración, conexiones comprobadas y
aceptación pendiente. `npm run v1:check` distingue una demo funcional de configuración real y
consulta los estados de las seis plataformas sin imprimir valores privados. La API unificada
aporta estado, presupuestos y entrega. El motor ahora también consume su rendimiento guardado
con `DATA_SOURCE=unified`: [APIs directas](docs/APIS_DIRECTAS.md). Se comprobaron 35 días de
TikTok y tres días de X de izzi; las conversiones de negocio permanecen pendientes.
Hay acceso nominal y delegación de incidencias: [cuentas y responsables](docs/ACCESOS_NOMINALES.md).

La [preauditoría de v1](../unified-ads-api/docs/PREAUDITORIA_V1.md) corrigió acceso ante registros
inválidos, duplicados, advertencias y pérdida de tasas con guardados simultáneos. Spotify izzi
ya aporta 30 filas horarias UTC recuperadas; ingresos y conversiones de negocio siguen pendientes.
La continuación protege formularios antiguos con revisión, captura financiera con valor anterior
y Settings/dictámenes con CAS en Blobs. Corrige carreras de usuarios dentro del proceso y el
cambio propio de contraseña del principal. Validación: 367 pruebas, tipos/lint/build y conflictos
por HTTP. Usuarios entre instancias, notificaciones y validación de Blobs real siguen pendientes.

La [auditoría de diseño, UX y Nexus](docs/AUDITORIA_UX_NEXUS_2026-10-02.md) continúa desde esa
base: navegación en español, seguimiento visual, correcciones de teclado/móvil y cobertura
de totales, reserva concurrente de IDs y barrera de simulación de webhooks. Incluye
[Nexus](docs/NEXUS.md), chat de consulta local sobre campañas y uso, limitado a la marca y
acceso interno. No utiliza un modelo generativo ni ejecuta acciones. Los pendientes de datos,
producción y decisiones de negocio siguen separados de las comprobaciones locales. Esta ronda
valida **485 pruebas**, tipos/lint/build y recorridos de navegador en escritorio/móvil; el informe
incluye evidencia visual con datos simulados y resultados por escenario.

La [auditoría ampliada](docs/AUDITORIA_AMPLIADA_2026-10-02.md) continúa desde `501e45f`:
**658 pruebas** del monitoreo y **648 de la API**, con tipos/lint/formato y ambas compilaciones.
Corrige acceso a tickets de otra marca, diagnósticos privados, pérdida de seguimiento concurrente,
cuentas ausentes en agregados, proyección incompleta y promedios de CPA en Comparar/Histórico.
Incluye 15 accesos nominales por HTTP y `scripts/ux-regression.cjs` para la revisión en navegador
de 30 rutas, cinco anchos y dos temas. Fixtures y comprobaciones reales se distinguen en el informe;
conciliación y producción siguen pendientes.

## Arranque rápido

**Conciliación y preparación de producción:** [CONCILIACION.md](docs/CONCILIACION.md) añade
`npm run conciliar`, sin red, para las 25 cuentas izzi en su moneda/reloj original. Necesita
exports independientes de Ads Manager; los informes de la API no sirven como referencia propia.
[PRODUCCION.md](docs/PRODUCCION.md) explica cómo obtener las URLs y preparar discos persistentes.
Los Dockerfiles excluyen secretos/histórico del contexto; no crean servicios. `v1:check` añade
`--destino netlify|contenedor` y `--volumen /var/data`, con bloqueos de transporte/almacenamiento.
Netlify con histórico directo por archivo sigue bloqueado; no se publicó ni aceptó producción.
Los extractores admiten `--brand izzi`; usar ese filtro explícito durante esta aceptación.
[Informe para la siguiente auditoría](docs/PREPARACION_PRODUCCION_2026-10-02.md):
839 pruebas del monitoreo y 678 de la API, evidencia sin cifras privadas y bloqueos separados.

Tras publicar el entorno de Codex se comprobó nuevamente su arranque y el acceso a los seis
proveedores. `npm run produccion:smoke` prepara siete comprobaciones públicas sin llaves ni
escrituras, para usar cuando existan las URL del alojamiento. La continuación también protege
el contador de accesos y las detecciones del arranque mensual ante actualizaciones simultáneas;
ver [informe del entorno publicado](docs/CONTINUACION_ENTORNO_PUBLICADO_2026-10-02.md).

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

Fuente de datos (`DATA_SOURCE`): **`unified`** lee el histórico de APIs directas generado por
`npm run unified:sync`; **`sheets`** lee directamente la hoja de Google Sheets que
actualiza Dataslayer ("Monitoreo | Big Query"; `npm run sheets:setup` la conecta), `bigquery` lee
BigQuery y `mock` usa datos simulados.

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
| `npm run v1:check` | Configuración de producción y estados de API; `-- --sin-red` evita red. No certifica conciliación ni publica |
| `npm run produccion:smoke` | Siete comprobaciones HTTPS sin autenticación ni escrituras; requiere `--monitor` y `--api`; no acepta la v1 |
| `npm run conciliar` | Comparación offline izzi por cuenta/día con referencia independiente; JSON/CSV privados, sin inventar ceros, tasas ni eventos |
| `npm run unified:sync` | Extrae las cuentas del mapeo explícito, guarda catálogo y particiones diarias/horarias privadas; `-- --help` muestra opciones |
| `npm run auth:setup` | Genera contraseñas nuevas, sus hashes y `AUTH_SECRET` (`-- --write` los guarda en `.env.local`) |
| `npm run auth:hash -- "contraseña"` | Hash scrypt de una contraseña elegida |
| `npm run sheets:setup -- "URL de la hoja"` | Conecta la hoja de Dataslayer: busca la llave JSON en Descargas/Escritorio, la prueba contra Google (se salta las borradas), guarda en `.env.local` el ID y la cuenta de servicio (no muestra la llave) y revisa la hoja |
| `npm run sheets:check` | Revisa sin cambiar nada: llave, permisos, pestañas, columnas, fechas y estado de Dataslayer |

## Páginas

| Grupo | Páginas |
|---|---|
| Monitoreo | Resumen · En vivo · Plataformas (y `/platforms/{google\|meta\|tiktok\|microsoft\|spotify\|x}`) · Campañas · **Monitoreos** (mensaje de WhatsApp manual) |
| Alertas | Alertas · Incidentes · **Tickets** |
| Análisis | Presupuestos · Comparar (por plataforma, cuenta, estrategia, objetivo o campaña) · Histórico · **Métricas** · **Optimizaciones** |
| Operación | Integraciones · Automatización · **Usuarios** (administradores) · Configuración |
| Ayuda | **Guía** · **Nexus** (consulta interna) · **Bugs y sugerencias** (cualquiera envía; solo el administrador recibe) |

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
│   ├── unified/             Extracción acotada, histórico atómico y adaptador de APIs directas
│   ├── mock/                Generador de datos simulados y escenarios de anomalías
│   ├── bigquery/            Cliente, mapeo configurable del esquema, SQL y fuente real
│   ├── sheets/              Lectura de la hoja de Dataslayer: mapeo, celdas, reparto horario, fuente de datos
│   ├── google/              Cliente de solo lectura de Google Sheets (cuenta de servicio)
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
├── config/                  Mapeo de la hoja de Dataslayer, ejemplos de BigQuery y plantillas (control, presupuestos, tipo de cambio)
├── scripts/                 auth:setup, auth:hash y sheets:setup (credenciales solo en .env.local, nunca en el repo)
├── sql/                     DDL de las tablas propias de la app
├── n8n/workflows/           Plantillas importables (WF07 Monitoring Runner, WF08 WhatsApp Alert)
├── tests/                   Vitest
├── docs/                    Documentación técnica
└── netlify.toml             Build y plugin de Next.js para Netlify
```

## Documentación

- [docs/ENTREGA_CLAUDE_V1.md](docs/ENTREGA_CLAUDE_V1.md): punto de entrada vigente para auditoría funcional, visual y operativa.
- [docs/PROMPT_PARA_CLAUDE.md](docs/PROMPT_PARA_CLAUDE.md): instrucciones listas para copiar, sin ZIP ni secretos.
- [docs/APIS_DIRECTAS.md](docs/APIS_DIRECTAS.md): configuración, cuentas, histórico, extracción y límites comprobados.
- [docs/INSTALACION.md](docs/INSTALACION.md): instalación paso a paso con la hoja de Dataslayer.
- [docs/GUIA.md](docs/GUIA.md): qué hay en cada sección, cómo leer el semáforo, mensaje de Monitoreos y clasificadores.
- [docs/AUTH.md](docs/AUTH.md): cuentas, contraseña universal, roles y bitácora de accesos.
- [docs/DATOS.md](docs/DATOS.md): lectura de la hoja de Dataslayer, hoja de control, monedas, presupuestos y varias cuentas.
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
| 8. Lectura directa de la hoja de Dataslayer, bugs y sugerencias | ✅ con pruebas |
| 9. Conexión real (cuenta de servicio, hoja compartida, Netlify, n8n y plantillas de WhatsApp) | Pendiente de accesos |

**Actualización del histórico:** `npm run unified:refresh -- --provider tiktok` ejecuta una ronda
acotada con espera persistida y backoff; `--watch` permite un worker local explícito.
Ver [ACTUALIZACION_DIRECTA.md](docs/ACTUALIZACION_DIRECTA.md). No instala un cron ni publica.

**Cuentas y moneda:** el mapeo autorizado incorpora 31 cuentas (25 izzi/seis Sky), con cinco
cuentas USD. **Operación → Tipo de cambio** permite capturar tasas mensuales USD→MXN con
permisos administrativos y bitácora de valores anteriores/nuevos. No se eligieron tasas:
[instrucciones de captura y límites](docs/TIPO_DE_CAMBIO.md). La lectura del 30 de septiembre
incorpora Google (2390 filas horarias), Meta (2789) y Microsoft (266, con datos completos).
Quedan pendientes conciliación, cobertura por zona, Spotify horario y cuotas de X.
