# Auditoría de la entrega de Codex — Unified Ads API

Fecha: 1 de octubre de 2026. Rama: `codex/entrega-auditoria-claude`. Estado recibido: commit
`39a65be` (idéntico al ZIP `unified-ads-api-para-auditoria.zip`, comprobado archivo por archivo).

## Auditoría de Claude sobre la continuación de Codex

Fecha: 1 de octubre de 2026. Estado recibido: `codex/continuacion-tiktok-x`, commit `b4226e9`.
Rama de trabajo: `claude/auditoria-tiktok-x`, creada desde esa entrega. Las líneas citadas son las
del commit recibido. No se publicó ni desplegó nada, no se pidieron secretos y no se leyó
`Ventas Detalle`.

### Línea base

`npm ci` con el lockfile y, en **Node 22.22.2** (versión mínima declarada; la entrega solo afirmaba
Node 24): tipos, lint, formato y build en verde, **501 pruebas en 22 archivos**. Es la primera
ejecución local en Node 22 de esta entrega.

### Contratos contrastados

La documentación web de X, Google, TikTok y Microsoft está bloqueada desde este entorno; se usaron
fuentes oficiales legibles por máquina:

| Fuente                                             | Qué se confirmó                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ejemplo oficial de firma OAuth 1.0a de X           | `oauthHeader` reproduce exactamente la firma publicada (`hCtSmYh+iHYCEqBWrE7C7hYmtUk=`).                                                                                                                           |
| SDK oficial `twitter-ads` 11.0.0 (PyPI)            | Rutas `stats/accounts`, `stats/jobs/accounts`, `active_entities`; trabajos con `id`/`id_str`, `status`, `url`; horas completas. Su enum de ubicaciones incluye `PUBLISHER_NETWORK` (ver riesgos).                  |
| Documento de descubrimiento de Google Ads v25      | `CampaignBudget` (`amount_micros`, `total_amount_micros`, `period`, `explicitly_shared`, recomendación) y `Campaign` (`serving_status`, `primary_status_reasons` con `BUDGET_CONSTRAINED`, `start/end_date_time`). |
| SDK oficial `tiktok-business-api-sdk` 1.0.1        | `campaign/get` y `adgroup/get`: `budget`, `budget_mode` (DAY, TOTAL, INFINITE, DYNAMIC_DAILY_BUDGET), `operation_status`, `schedule_start/end_time`. No define `total_complete_payment_rate`.                      |
| WSDL v13 de CampaignManagement (`bingads` 13.0.30) | `Campaign.DailyBudget`, `BudgetType` (incluye `LifetimeBudgetStandard`), `BudgetId`, `Status`, `EndDate`.                                                                                                          |

### Defectos demostrados y corregidos

**C1 (Media). Cancelaciones propias contadas como caídas del proveedor.**

- Ubicación: `src/utils/circuit-breaker.ts:53`, con `src/providers/google/index.ts:172` y `src/utils/retry.ts:48`.
- Impacto: con las consultas paralelas de Google, un error de consulta en una cuenta cancela las demás;
  esas cancelaciones salían como `PROVIDER_TIMEOUT` y el circuito las contaba como fallas. Tras dos
  episodios, Google sano respondía «falla de forma repetida» durante 30 s, incluido `/providers`.
  Lo mismo pasaba en los seis proveedores cuando el cliente HTTP se desconectaba.
- Evidencia: `tests/audit-cancellation.test.ts` falla con el código recibido con ese mensaje.
- Corrección: el circuito recibe la señal de la consulta; una cancelación cuyo motivo no es
  `TimeoutError` no cuenta. Un plazo vencido sí cuenta. Los seis clientes pasan su señal.

**C2 (Media). Almacén de tokens rotados: un fallo de lectura borraba los demás tokens.**

- Ubicación: `src/config/token-store.ts:48` (`readFile(...).catch(() => "")`), `:52` y `:22`.
- Impacto: con `TOKEN_STORE_FILE`, un EIO/EACCES al leer hacía que la siguiente rotación reescribiera
  el archivo solo con el token rotado: se perdía el del otro proveedor. Si el reemplazo fallaba, el
  temporal con el token quedaba en disco. Al arrancar, un almacén existente pero ilegible se ignoraba
  y se usaba el token de `.env`, ya rotado.
- Evidencia: `tests/audit-token-files.test.ts`: tres pruebas fallan con el código recibido.
- Corrección: `src/config/env-file.ts` (`updateEnvFile`): solo archivo normal, únicamente ENOENT se
  trata como vacío, temporal exclusivo 0600, `rename` atómico y limpieza del temporal. Un almacén
  ilegible detiene el arranque con `ConfigError` que solo nombra el código de error.

**C3 (Baja). El asistente de Google escribía `.env` en sitio.**

- Ubicación: `scripts/google-auth.ts:81`.
- Impacto: escritura no atómica (un corte deja `.env` truncado) y que sigue enlaces simbólicos, a
  diferencia de los asistentes de Microsoft, Spotify y TikTok.
- Corrección: los cuatro asistentes usan `updateEnvFile`; pruebas de conservación de líneas, 0600,
  enlaces rechazados y valores con saltos de línea.

Sin defecto demostrado en X: firma, codificación, paginación, trabajos de 64 bits, descarga fija,
nulos frente a ausentes y redacción de errores se revisaron y coinciden con el SDK y el contrato
citado por Codex. Las regresiones de Google (paralelismo, ceros protobuf), Meta (bloques), Microsoft
(host fijo) y Spotify (final inclusivo) se revisaron sin hallazgos adicionales.

### Riesgos nuevos por verificar (no demostrados)

| Sev.  | Ubicación                      | Riesgo                                                                                                                                                                                                 | Cómo cerrarlo                                                                                                 |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Media | `x/config.ts` (`X_PLACEMENTS`) | Se suman `ALL_ON_TWITTER`, `SPOTLIGHT` y `TREND`; el SDK oficial también define `PUBLISHER_NETWORK`. Una campaña en X Audience Platform quedaría subcontada.                                           | Confirmar en la referencia v12 si `PUBLISHER_NETWORK` sigue vigente y revisar `placements` de los line items. |
| Baja  | `x/reports.ts`                 | Atendido en esta rama: se filtran campañas con `active_entities` y el polling espacia 1, 2, 4, 8 y 10 s. Falta confirmar con una cuenta real que `active_entities` acepta los mismos límites horarios. | Primera lectura real tras la aprobación de Ads API.                                                           |
| Baja  | `x/client.ts` (descarga)       | El patrón `stats_job_<ID>.json.gz` en `ton.twimg.com` no se ha visto en una respuesta real. Si difiere, la descarga falla cerrada.                                                                     | Primera lectura asíncrona real tras la aprobación.                                                            |
| Baja  | `google/budgets.ts`            | La consulta de presupuestos usa campos confirmados en v25, pero no se ejecutó contra Google real (seleccionabilidad conjunta).                                                                         | Una consulta real acotada a una cuenta.                                                                       |
| Baja  | `microsoft/budgets.ts`         | Con `LifetimeBudgetStandard` se asume que `DailyBudget` lleva el monto total; no suma al diario, solo se informa.                                                                                      | Comparar una campaña con presupuesto total contra la interfaz.                                                |

### Mejoras añadidas en esta rama

- **Presupuestos vigentes** (`GET /api/v1/budgets`): Meta (campañas CBO y conjuntos ABO activos),
  Google (presupuesto diario o del periodo, compartidos, limitadas por presupuesto y recomendación),
  TikTok (campaña o grupos encendidos y vigentes) y Microsoft (diario, total y compartidos). Solo
  lectura; montos en la moneda de la cuenta; totales con diario estimado y método explícito.
- **Monitoreo, Budget Control:** panel de presupuesto diario por plataforma y estrategia contra el
  gasto de hoy y lo esperado a esta hora, con lectura automática (concentración, desviaciones según
  los umbrales del equipo, campañas sin gasto, limitadas por presupuesto).
- **Reporte de exclusiones de Meta** (`npm run meta:exclusiones`) integrado desde
  `claude/blissful-goodall-vh8k7n` mediante merge, sin reescribir historial.
- **Salud de entrega** (`GET /api/v1/delivery-health`): Meta (estado y tope de gasto de la cuenta,
  campañas y conjuntos con problemas o `issues_info`, aprendizaje), Google (estado principal y motivos:
  limitada por presupuesto, puja o políticas, aprendizaje) y Microsoft (pausadas por presupuesto,
  suspendidas). Contratos: SDK de Meta 26.0.2, descubrimiento de Google v25 y WSDL de Microsoft v13.
  TikTok queda fuera porque su SDK no publica los valores de estado.
- **X:** `X_ADS_PLACEMENTS` permite sumar `PUBLISHER_NETWORK` si se confirma en v12, la consulta del
  estado de trabajos asíncronos espera 1, 2, 4, 8 y luego 10 s, y antes de cada bloque se consulta
  `active_entities` para pedir métricas solo de campañas con actividad (respaldo: todas las campañas).
- **Monitoreo:** panel de salud en Overview (los topes de Meta se cruzan con el diario vigente de la
  cuenta para saber cuántos días alcanzan), proyección de cierre de mes con los diarios actuales contra
  el presupuesto mensual, y cambios de presupuesto contra el último día guardado (foto diaria por marca
  en el almacén de registros).

### Validación de esta rama

- `unified-ads-api`: **542 pruebas en 28 archivos** en Node 22.22.2; tipos, lint, formato y build en verde.
- `media-monitoring-center`: **215 pruebas en 23 archivos**; `npm run check` y `next build` en verde.
  El panel se revisó en escritorio y móvil (sin desbordes ni errores de consola) con una cuenta de
  prueba temporal solo en memoria.
- Ninguna lectura real nueva: este entorno no tiene credenciales de plataformas y su red bloquea sus
  APIs. Las cifras reales de la matriz siguen siendo las registradas por Codex.

## Continuación desde la auditoría de Claude

Rama de trabajo: `codex/continuacion-tiktok-x`, basada en `claude/blissful-goodall-vh8k7n`
(commit `1bf278f`). Se preservó el trabajo local anterior antes de cambiar de rama.
La línea base de esta continuación fue **434 pruebas**, con `fetch` global bloqueado;
no se sustituyeron las correcciones de Claude ni se eliminaron pruebas.

La documentación oficial de X y Spotify pudo consultarse en esta sesión. Las evidencias históricas
reales de Google, Meta, Microsoft y Spotify se conservan y **no se presentan como revalidadas**.
No se ejecutaron escrituras publicitarias, despliegues ni lecturas de `Ventas Detalle`.

### TikTok: primera lectura real completada

El usuario confirmó app aprobada y proporcionó cuatro cuentas:

| Cuenta         | Advertiser ID (texto) |
| -------------- | --------------------- |
| Sky México     | `7338571937913978882` |
| Sky Sports MXN | `7545502925565771792` |
| izzi - ABCW    | `7361545670072909840` |
| izzi ABCW US   | `7688066712031182866` |

El primer intento se omitió por variables ausentes y se continuó con X. Tras aplicar la
configuración y reiniciar, App ID, Secret, lista y callback privado llegaron al proceso. OAuth
funcionó y el token quedó en `.env` privado 0600; no se registraron valores ni respuestas OAuth.
La lectura real del **27 al 29 de septiembre de 2026** devolvió cuatro cuentas, **178 campañas,
76 filas diarias y 608 filas de conversiones**, sin errores ni avisos. izzi ABCW US no devolvió
filas para ese periodo; no se sustituyen por ceros.

Las cuatro cuentas reportan `Etc/GMT+6` (UTC−06:00). Tres usan MXN; izzi ABCW US usa USD.
Sky Sports devuelve `America/Chicago` como `display_timezone`, distinta de la zona base del
reporte en esas fechas. Se conservó `timezone`; su correspondencia con Ads Manager sigue pendiente.
El estado real de TikTok es `connected`; cuentas y rendimiento de izzi pasaron por las rutas
autenticadas con HTTP 200 mediante `app.inject`.

Se prepararon [12 totales cuenta/día y la evidencia](TIKTOK_PRIMERA_LECTURA.md), con costo,
conteos por evento y CPA de optimización calculado desde las sumas, sin promediar CPAs ni mezclar
acciones. izzi devuelve 29 `conversion` y 30 `onsite_form`; no se suman ni se decide la acción
principal de negocio. `total_complete_payment_rate` y `complete_payment` llegaron en cero: la
semántica monetaria **sigue inconclusa**; el CSV conserva muestras, sin presentarlas como ingresos.

### Riesgos resueltos con contrato o código

- **Spotify, final inclusivo:** la referencia oficial v3 de `getAggregateReport`, parámetro
  `report_end`, dice explícitamente que DAY/LIFETIME incluyen el día completo de la fecha final.
  HOUR incluye la hora final. Se mantiene el código y se añadió una regresión de bloques de 90 días.
  Fuente: [Aggregate report v3](https://developer.spotify.com/documentation/ads-api/reference/v3/getAggregateReport).
- **Google, ceros escalares seleccionados:** se decodifican como cero los campos de nuestras
  consultas fijas omitidos dentro de un objeto `metrics` válido. Valores explícitamente nulos,
  inválidos o imprecisos no se convierten en ceros. Un objeto ausente produce error; no se fabrican
  campañas/días ausentes. REST usa la representación canónica protobuf y la documentación de
  reporting aclara que las filas segmentadas con todas las métricas cero no se devuelven.
  Fuentes: [JSON mappings](https://developers.google.com/google-ads/api/rest/design/json-mappings),
  [ProtoJSON](https://protobuf.dev/programming-guides/json/),
  [Zero metrics](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics).
- **Meta, rangos grandes:** bloques inclusivos de 30 días diarios o un día horario, sin solapamiento,
  con paginación y un solo timeout. Se rechazan periodos repetidos o fuera del bloque. Regresiones
  de 366 días mantienen 732 conversiones, sin duplicar fechas, alias ni alterar atribución.
- **Google, consultas secuenciales:** hasta cuatro cuentas habilitadas en paralelo, manteniendo
  orden y avisos por permisos parciales. Un fallo global cancela y drena las otras consultas.
  Sigue siendo necesario filtrar por cuenta/cliente cuando la jerarquía supera el plazo de una petición.
- **Microsoft, dominio controlado por un atacante:** se rechazan destinos fuera de
  `bingadsappsstorageprod.blob.core.windows.net` antes de consultar DNS, incluidas otras cuentas
  Azure Blob. Se mantienen validación de IP pública, TLS, proxy y bloqueo de redirecciones.
  **Mitigación, no fijación de IP:** con `fetch` y el proxy actual aún hay dos resoluciones; no se
  declara eliminada esa ventana ante un cambio del DNS del host Microsoft confiado. Si Microsoft
  cambia el destino, la descarga falla hasta revisar explícitamente ese cambio.

Pruebas de estas correcciones: `tests/continuation-risks.test.ts` y suite existente. X está
implementado con contrato API 12, OAuth 1.0a, estados compartidos, timeout propio, conversiones web,
reportes asíncronos y fixtures; contrato y límites en [X_ADS.md](X_ADS.md).

### Validación de esta continuación

- `unified-ads-api`: **501 pruebas en 22 archivos**, incluidas 55 de X y 12 regresiones de riesgos.
  `typecheck`, `lint`, `format:check` y `build` pasan en Node 24.19.0. La CI conserva Node 22/24;
  no se afirma una ejecución local nueva en Node 22.
- `media-monitoring-center`: **202 pruebas en 20 archivos**; `npm run check` pasa (tipos, lint y pruebas).
  Se añadieron cinco comprobaciones de estados de X en el mismo esquema del panel.
- No se saltaron, desactivaron ni pusieron en cuarentena pruebas. Las pruebas de API bloquean red global.
- TikTok completó OAuth y lecturas reales; la conciliación sigue pendiente. X tiene cuatro
  variables privadas aplicadas; `GET /12/accounts` devuelve HTTP 403
  `UNAUTHORIZED_CLIENT_APPLICATION` y estado `access_required`. El usuario envió la solicitud
  de acceso el 1 de octubre de 2026; el formulario confirmó recepción con «Success!».
  La aprobación y la lectura real siguen pendientes. No se leyeron datos de X.
  Los bloqueos restantes están separados abajo.

## Cómo se auditó

- **Línea base sobre lo recibido**, en Node 22.22.2 (la versión mínima declarada): tipos, lint,
  formato y build en verde, y **408 pruebas en 14 archivos** aprobadas. Node 22 admite
  `NODE_USE_ENV_PROXY` para `fetch` (con aviso de función experimental).
- **Contratos oficiales.** Las páginas de documentación de Google, Meta, TikTok, Microsoft y Spotify
  están bloqueadas desde el entorno de la auditoría, así que se contrastó contra fuentes oficiales
  legibles por máquina:
  - Google: el documento de descubrimiento de Ads API v25 y la librería oficial `google-ads` 33.0.0.
  - Meta: el SDK `facebook-business` 26.0.2.
  - TikTok: el SDK `tiktok-business-api-sdk` 1.0.1.
  - Microsoft: los WSDL v13 del SDK `bingads` 13.0.30.
  - Spotify: no publica SDK oficial; no se pudo contrastar.
- **Pruebas de comportamiento.** Se escribieron pruebas que fallan con el código recibido y pasan
  con la corrección, en `tests/audit-*.test.ts`. No reproducen el código: comprueban el resultado
  financiero.
- **Lo que no se pudo hacer aquí:** lecturas reales y conciliación con las interfaces publicitarias.
  Las credenciales no viajan con el ZIP y no se pidieron por chat. Las cifras "reales" de la matriz
  vienen de los registros de Codex y no se volvieron a verificar.

Resultado final: **430 pruebas** (408 recibidas, más 22 de la auditoría), con la red bloqueada en
todas las pruebas, más tipos, lint, formato y build en verde. Hay CI nuevo en
`.github/workflows/unified-ads-api.yml`, sobre Node 22 y 24.

## Contratos confirmados

| Plataforma | Confirmado contra fuente oficial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google     | v25 es la versión vigente y la que usa por omisión la librería oficial (también existen v22–v24). En v25 el developer token es opcional: la librería 31 lo exigía, la 33 ya no, y el descubrimiento lo marca como _"sunset"_. Endpoints `customers:listAccessibleCustomers` y `googleAds:search`, paginación con `nextPageToken` y `pageSize` rechazado (`PAGE_SIZE_NOT_SUPPORTED`). Campos `metrics.video_trueview_views` y cuartiles como tasas, `campaign.advertising_channel_type`, códigos de error por familia, alcance OAuth `adwords` y endpoint de tokens. |
| Meta       | Graph/Marketing API v26.0 (SDK 26.0.2). Campos de Insights usados (`account_currency`, `inline_link_clicks`, `video_p25…p100_watched_actions`, `reach`, `frequency`). Breakdown `hourly_stats_aggregated_by_advertiser_time_zone`. Parámetros `action_report_time`, `use_unified_attribution_setting` y `time_increment`.                                                                                                                                                                                                                                           |
| TikTok     | `GET /open_api/v1.3/report/integrated/get/` con encabezado `Access-Token`. `page_size` de 1 a 1000, `query_mode` REGULAR/CHUNK, fechas en la zona horaria de la cuenta, filtros `field_name/filter_type/filter_value`. `oauth2/advertiser/get` exige `app_id` y `secret` en la consulta.                                                                                                                                                                                                                                                                            |
| Microsoft  | Las 11 columnas de rendimiento y las 10 de conversiones existen en los enums oficiales v13. `Aggregation` Daily/Hourly, `Format` Csv y los campos `ReportRequest` y `ReportTime` coinciden.                                                                                                                                                                                                                                                                                                                                                                         |

## Defectos confirmados y corregidos

Las líneas se refieren al código recibido (`39a65be`).

### Alta

**A1. Conversiones de Meta contadas varias veces.**

- Ubicación: `src/providers/meta/normalize.ts:98` y `:208`.
- Impacto: la sección de conversiones asignaba PURCHASE a `omni_purchase`, `purchase`,
  `offsite_conversion.fb_pixel_purchase` y `onsite_conversion.purchase` a la vez, y LEAD a sus
  equivalentes. Sumar por categoría, que es el uso natural en BigQuery y n8n, multiplica ventas y leads.
- Evidencia: la muestra del propio simulador (2 compras reportadas bajo tres tipos) daba
  **PURCHASE = 6**.
- Corrección: solo un tipo por categoría lleva la categoría por omisión: la acción principal de la
  cuenta o, si no coincide, el total agregado (`omni_purchase`, `lead`). Los demás conservan su fila
  con `category_hint` para conciliar.
- Prueba: `tests/audit-meta.test.ts`.

**A2. Un cero real de Meta salía como dato ausente.**

- Ubicación: `src/providers/meta/normalize.ts:144`.
- Impacto: con la acción principal configurada, un día con gasto y sin esa acción daba
  `conversions = null`. Meta solo lista las acciones que ocurrieron, así que ese día fue 0. Con
  `null`, el monitoreo no puede detectar "gasto sin conversiones" y los totales quedan incompletos.
- Corrección: el resultado es 0, con `raw_metrics.primary_action_present = false`, que además
  delata una acción mal elegida. Sin acción principal sigue en `null`, y las acciones externas por
  hora también.
- Prueba: `tests/audit-meta.test.ts`. Se actualizaron dos pruebas de Codex que fijaban el
  comportamiento anterior.

### Media

**M1. Vocabulario de conversiones distinto entre plataformas.**

- Ubicación: `src/providers/spotify/normalize.ts:131` y `src/providers/google/normalize.ts:81`.
- Impacto: Spotify emitía `lead` y `purchase` en minúsculas mientras el resto usa `LEAD` y
  `PURCHASE`. Google clasificaba SIGNUP como LEAD, mientras TikTok y Spotify lo tratan como
  registro. Así no se puede agrupar entre plataformas.
- Corrección: vocabulario común en `src/normalization/conversions.ts`.
- Prueba: `tests/audit-vocabulary.test.ts`.

**M2. Google: cuenta cliente de una MCC sin `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.**

- Ubicación: `src/providers/google/index.ts:108`.
- Impacto: tras reiniciar, consultar `account_id` de una cuenta cliente respondía
  `USER_PERMISSION_DENIED`, porque no se enviaba la MCC que la contiene y Google la exige.
- Corrección: la MCC se toma de la jerarquía (en caché) antes de consultar.
- Prueba: `tests/audit-google.test.ts`.

**M3. Google: jerarquías grandes.**

- Ubicación: `src/providers/google/index.ts:141` y `:146`.
- Impacto: en consultas de todas las cuentas se pedían métricas a cuentas canceladas o cerradas (la
  jerarquía documentada tiene 2274 cuentas). Además, cualquier `ACCESS_DENIED` distinto de
  `CUSTOMER_NOT_ENABLED` tumbaba toda la respuesta.
- Corrección: no se consultan cuentas no habilitadas, y una cuenta sin permiso queda como
  advertencia. Si se pidió esa cuenta, o ninguna responde, el error se devuelve.
- Prueba: `tests/audit-google.test.ts`.

**M4. Límite de tiempo por proveedor ignorado.**

- Ubicación: `src/routes/data.ts:119` y `src/providers/microsoft/config.ts:48`.
- Impacto: la ruta cortaba todo en `PROVIDER_TIMEOUT_MS` (15 s) aunque `MICROSOFT_ADS_TIMEOUT_MS`
  fuera mayor. Con la configuración por omisión, un informe asíncrono de Microsoft (solicitar,
  esperar, descargar) casi nunca alcanza a terminar. Codex lo compensaba subiendo el límite global
  a 120 s para todos.
- Corrección: el límite propio del proveedor manda, y Microsoft usa 120 s por omisión.
- Prueba: `tests/audit-routes.test.ts`.

**M5. Refresh tokens rotados que se pierden.**

- Ubicación: `src/providers/microsoft/client.ts:146` y `src/providers/spotify/client.ts:138`.
- Impacto: Microsoft entrega un refresh token nuevo en cada renovación (Spotify a veces), pero solo
  se guardaba en memoria. Al reiniciar se vuelve al original, que Microsoft invalida 90 días después
  de emitido. El acceso se caería sin aviso aunque se use a diario.
- Corrección: la rotación se notifica. Con `TOKEN_STORE_FILE` se guarda en un archivo privado 0600,
  con escritura atómica y serializada, que gana al arrancar; sin él, se avisa en el log sin el valor.
- Prueba: `tests/audit-tokens.test.ts`.

### Baja

| #   | Ubicación                                               | Defecto                                                                                                                                | Corrección                                                                            |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| B1  | `google/index.ts:86` y equivalentes en los otros cuatro | Un token vencido o revocado (`AUTH_ERROR`) se reportaba como `permission_denied`, y el operador buscaba permisos en vez de reautorizar | `stateFromError` común: `error` con `AUTH_ERROR`                                      |
| B2  | `google/errors.ts:80`                                   | Se ignoraba `QuotaErrorDetails.retryDelay` cuando faltaba `Retry-After`                                                                | Se respeta                                                                            |
| B3  | `routes/data.ts:132`                                    | Sin `provider`, cada respuesta traía `NOT_CONFIGURED` de todas las integraciones pendientes                                            | Solo se consultan las listas y configuradas; el estado completo sigue en `/providers` |
| B4  | `src/index.ts:1`                                        | Una variable vacía del entorno ocultaba el valor de `.env` (lo que reportó Codex)                                                      | `prepareEnv`                                                                          |
| B5  | Proyecto                                                | Sin CI; `axios` sin uso; las pruebas no bloqueaban la red de forma global                                                              | CI en Node 22 y 24; `fetch` bloqueado en pruebas; `axios` retirado                    |

## Riesgos por verificar (no confirmados como defecto)

| Sev.     | Ubicación                                           | Riesgo                                                                                                                                                                                            | Cómo cerrarlo                                                                                   |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Alta     | `microsoft/reports.ts:140`, `normalize.ts:106`      | Se asume que las filas del CSV vienen en **UTC**. Si vinieran en la zona de la cuenta, los días y las horas estarían desplazados. Los WSDL no lo especifican y la documentación no fue accesible. | Conciliar un día por hora contra la interfaz de Microsoft con una cuenta cuya zona no sea UTC.  |
| Media    | `google/queries.ts:45`                              | Las conversiones por hora combinan `segments.hour` con `segments.conversion_action`; la compatibilidad no está confirmada.                                                                        | Ejecutar una consulta horaria real de conversiones.                                             |
| Media    | `meta/queries.ts` (`action_report_time=impression`) | Puede diferir del criterio configurado en Ads Manager.                                                                                                                                            | Conciliar el mismo día y la misma cuenta con el mismo criterio de atribución.                   |
| Baja     | `tiktok/config.ts:8`                                | `total_complete_payment_rate` se usa como valor de `complete_payment`; la primera muestra real tiene ambos campos en cero y no confirma unidades.                                                 | Contrastar definición oficial, muestra no nula y columna equivalente de Ads Manager.            |
| Baja     | `microsoft/reports.ts`                              | Mitigación por host Microsoft fijo y DNS público; no hay IP fijada al transporte del proxy.                                                                                                       | Revisar un transporte que respete el proxy y fije la resolución; no desactivar TLS ni eludirlo. |
| Decisión | API                                                 | Las llaves internas ven a todos los clientes; `client_id` filtra, pero no aísla.                                                                                                                  | Definir un modelo de acceso por cliente antes de un uso multicliente.                           |

## Matriz de validación por plataforma

Google, Meta, Microsoft y Spotify conservan la evidencia histórica de Codex; la auditoría de
Claude no tuvo credenciales para repetirla. TikTok sí se verificó en esta continuación, el
1 de octubre de 2026; detalles y totales en [TIKTOK_PRIMERA_LECTURA.md](TIKTOK_PRIMERA_LECTURA.md).

| Plataforma | Simulador            | OAuth y credenciales reales                                            | Cuentas reales                     | Campañas reales     | Informes y métricas reales                               | Conciliación con la interfaz |
| ---------- | -------------------- | ---------------------------------------------------------------------- | ---------------------------------- | ------------------- | -------------------------------------------------------- | ---------------------------- |
| Google Ads | Sí                   | Sí                                                                     | Sí (33 raíces, 2274 en jerarquías) | Sí (muestra de 150) | Muestras diarias, horarias y de conversiones             | Pendiente                    |
| Meta       | Sí                   | Sí (token)                                                             | Sí (17 activas)                    | Sí (muestra)        | Muestras diarias, horarias y de conversiones             | Pendiente                    |
| TikTok     | Sí                   | Sí, OAuth y token real                                                 | Sí (4, monedas y zonas leídas)     | Sí (178)            | Sí: 76 filas diarias y 608 de conversiones; US sin filas | Pendiente                    |
| Microsoft  | Sí                   | Sí                                                                     | Sí (4)                             | Sí (43)             | No: el proxy bloquea la descarga del ZIP                 | No                           |
| Spotify    | Sí                   | Sí (refresh token)                                                     | No (403 `ACCESS_REQUIRED`)         | No                  | No                                                       | No                           |
| X Ads      | Sí, fixtures sin red | Variables aplicadas; HTTP 403; solicitud enviada, aprobación pendiente | No                                 | No                  | No                                                       | Pendiente                    |

## Pendientes y orden recomendado

El [traspaso actualizado a Claude](TRASPASO_CLAUDE.md) incluye el punto de partida, archivos a
auditar y tareas posibles sin permisos nuevos. La siguiente revisión debe comprobar también la
persistencia atómica del asistente Google y el tratamiento de fallos de lectura del almacén de
tokens; se señalan como puntos de revisión, sin afirmar un incidente real.

**Decisiones de negocio**

- Acción principal de Meta por cuenta. Para izzi hay dos universos que no se mezclan: las campañas
  CAPI WhatsApp se miden con _On-Facebook Purchase_ y las demás con _Compras Offline Web (Inbound)_.
- Evento principal de Spotify y métrica principal de TikTok.
- Mapeo de los eventos offline de Google (`MCC_Offline_Lead_Contact`, `MCC_Offline_Purchase`).
- Modelo de acceso por cliente.

**Permisos**

- Habilitación de Spotify Ads API (403).
- TikTok: lectura de las cuatro cuentas autorizada y verificada. No queda un bloqueo de permisos
  en la muestra; otros productos o ámbitos de reporting no se dan por validados.
- X: la app existe (ID mostrado en la consola: `33489379`) y la configuración está aplicada.
  Primera consulta real `GET /12/accounts`: HTTP 403 `UNAUTHORIZED_CLIENT_APPLICATION`;
  `stateFromError` produce `access_required`. El usuario envió la solicitud de acceso
  el 1 de octubre de 2026 y aportó la confirmación «Success!» del formulario oficial.
  Falta la aprobación de Standard Access (Analytics y Campaign Management); tras ella, renovar el par de tokens del usuario
  según la guía oficial. [Formulario de Ads API](https://docs.x.com/forms/ads-api-access) y
  evidencia detallada en [X_ADS.md](X_ADS.md). No se confunde una app activa para X API con
  aprobación de Ads API ni se afirma validación de cuentas o de Analytics.

**Configuración y entorno**

- Monitoreo: `UNIFIED_ADS_API_URL` y `UNIFIED_ADS_API_KEY` en el despliegue para el panel de presupuestos
  diarios (sin ellas muestra cómo conectarlo; en modo demo usa datos de ejemplo rotulados).
- `TOKEN_STORE_FILE` o un gestor de secretos en el despliegue.
- Acciones principales y mapeos.
- TikTok: conservar token y lista de cuatro IDs en la configuración privada del entorno destino.
  El token actual está en `.env` privado 0600; el código de retorno ya fue consumido.
- X: cuatro variables OAuth 1.0a ya inyectadas; actualizar el par de tokens de usuario después
  de la aprobación de Ads API. Timeout propio apropiado para backfills.
- Un entorno con salida a `*.blob.core.windows.net` para las descargas de Microsoft.
- Despliegue (Cloud Run) con sus secretos.

**Código**

- X (auditoría de Claude): confirmar `PUBLISHER_NETWORK` en v12 (se activa con `X_ADS_PLACEMENTS`) y
  la respuesta real de `active_entities` (el filtro ya está implementado con respaldo).
- Salud de entrega de TikTok cuando haya un vocabulario oficial de `secondary_status` verificable.
- Primera lectura real de `/budgets` y `/delivery-health` en Meta, Google y Microsoft para confirmar
  campos y seleccionabilidad (los contratos están confirmados con fuentes oficiales, no con datos reales).
- Presupuestos de Spotify y X cuando haya acceso (sus APIs los exponen en ad sets y line items).
- X: OAuth multiusuario y conversiones móviles, si se requieren; primera lectura real y conciliación pendientes.
- TikTok v2.0, si se decide migrar; el intercambio OAuth v1.3 ya existe.
- Microsoft: transporte con resolución fijada compatible con el proxy, o revisión explícita del riesgo residual del host confiado.
- Meta: informes asíncronos si una cuenta supera los bloques síncronos ya implementados.
- Google: extracciones persistentes fuera del ciclo HTTP para jerarquías que excedan el timeout; paralelismo limitado ya implementado.
- Persistencia real: `performance.repository.ts` es solo un contrato.
- Aislamiento multicliente, tras la decisión.

**Orden**

1. Conciliar Google y Meta contra sus interfaces: un día, una cuenta, mismo criterio de atribución
   (comprueba ceros reales y cierra atribución).
2. Decidir y configurar las acciones principales y los mapeos de conversiones.
3. Microsoft desde un entorno con salida al almacenamiento de informes; conciliar un día por hora
   (cierra el riesgo de UTC).
4. Spotify cuando se habilite: cuentas, campañas y un informe de dos días (confirma también la conciliación del final inclusivo documentado).
5. TikTok: conciliar los 12 totales cuenta/día, comprobar la ausencia de filas de izzi ABCW US y
   la zona de visualización de Sky Sports; verificar unidades de compra con una muestra no nula.
6. Despliegue con secretos y `TOKEN_STORE_FILE`; después n8n, BigQuery y alertas.
7. Modelo de acceso multicliente.
8. X Ads: conexión real y conciliación de cuentas/campañas/reportes; código ya implementado.

El proyecto **no está listo para producción** mientras los puntos 1 a 4 sigan sin comprobarse.
