# Auditoría de la entrega de Codex — Unified Ads API

Fecha: 1 de octubre de 2026. Rama: `codex/entrega-auditoria-claude`. Estado recibido: commit
`39a65be` (idéntico al ZIP `unified-ads-api-para-auditoria.zip`, comprobado archivo por archivo).

## Continuación desde la auditoría de Claude

Rama de trabajo: `codex/continuacion-tiktok-x`, basada en `claude/blissful-goodall-vh8k7n`
(commit `1bf278f`). Se preservó el trabajo local anterior antes de cambiar de rama.
La línea base de esta continuación fue **434 pruebas**, con `fetch` global bloqueado;
no se sustituyeron las correcciones de Claude ni se eliminaron pruebas.

La documentación oficial de X y Spotify pudo consultarse en esta sesión. Las evidencias históricas
reales de Google, Meta, Microsoft y Spotify se conservan y **no se presentan como revalidadas**.
No se ejecutaron escrituras publicitarias, despliegues ni lecturas de `Ventas Detalle`.

### TikTok: primer intento condicionado, bloqueado

El usuario confirmó app aprobada y proporcionó cuatro cuentas:

| Cuenta         | Advertiser ID (texto) |
| -------------- | --------------------- |
| Sky México     | `7338571937913978882` |
| Sky Sports MXN | `7545502925565771792` |
| izzi - ABCW    | `7361545670072909840` |
| izzi ABCW US   | `7688066712031182866` |

En la comprobación de esta sesión no estaban inyectados `TIKTOK_ACCESS_TOKEN` ni
`TIKTOK_ADVERTISER_IDS`; tampoco App ID/Secret. El usuario indicó que los introdujo en el panel,
pero eso aún no demuestra inyección en el proceso. Los requisitos están declarados en el borrador.
Se omitieron lecturas reales conforme a la condición solicitada y se continuó con X.
La salida al host de reporting **no se da por validada** sin esas condiciones.

Al recibir token y lista privada, extraer cuentas, campañas y métricas diarias del **27 al 29 de
septiembre de 2026** (tres días cerrados), verificando permisos, moneda y zona de cada cuenta.
Preparar por cuenta y fecha sumas de costo y conteos, CPA = costo total / conversiones totales,
y los valores originales de compra para conciliar. `total_complete_payment_rate` y la zona horaria
siguen sin comprobación real. No elegir un evento principal ni sumar tipos superpuestos.

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
- La conexión real de TikTok y X no está validada; los bloqueos están separados abajo.

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
| Baja     | `tiktok/config.ts:8`                                | `total_complete_payment_rate` se usa como valor de `complete_payment`; el nombre sugiere una tasa.                                                                                                | Revisar un reporte real cuando haya credenciales.                                               |
| Baja     | `microsoft/reports.ts`                              | Mitigación por host Microsoft fijo y DNS público; no hay IP fijada al transporte del proxy.                                                                                                       | Revisar un transporte que respete el proxy y fije la resolución; no desactivar TLS ni eludirlo. |
| Decisión | API                                                 | Las llaves internas ven a todos los clientes; `client_id` filtra, pero no aísla.                                                                                                                  | Definir un modelo de acceso por cliente antes de un uso multicliente.                           |

## Matriz de validación por plataforma

"Real" proviene de los registros de Codex del 30 de septiembre y del 1 de octubre; la auditoría no
tuvo credenciales para repetirlo.

| Plataforma | Simulador            | OAuth y credenciales reales                        | Cuentas reales                     | Campañas reales     | Informes y métricas reales                   | Conciliación con la interfaz |
| ---------- | -------------------- | -------------------------------------------------- | ---------------------------------- | ------------------- | -------------------------------------------- | ---------------------------- |
| Google Ads | Sí                   | Sí                                                 | Sí (33 raíces, 2274 en jerarquías) | Sí (muestra de 150) | Muestras diarias, horarias y de conversiones | Pendiente                    |
| Meta       | Sí                   | Sí (token)                                         | Sí (17 activas)                    | Sí (muestra)        | Muestras diarias, horarias y de conversiones | Pendiente                    |
| TikTok     | Sí                   | No: app aprobada según usuario, token no inyectado | No                                 | No                  | No                                           | Pendiente                    |
| Microsoft  | Sí                   | Sí                                                 | Sí (4)                             | Sí (43)             | No: el proxy bloquea la descarga del ZIP     | No                           |
| Spotify    | Sí                   | Sí (refresh token)                                 | No (403 `ACCESS_REQUIRED`)         | No                  | No                                           | No                           |
| X Ads      | Sí, fixtures sin red | No: faltan cuatro credenciales                     | No                                 | No                  | No                                           | Pendiente                    |

## Pendientes y orden recomendado

**Decisiones de negocio**

- Acción principal de Meta por cuenta. Para izzi hay dos universos que no se mezclan: las campañas
  CAPI WhatsApp se miden con _On-Facebook Purchase_ y las demás con _Compras Offline Web (Inbound)_.
- Evento principal de Spotify y métrica principal de TikTok.
- Mapeo de los eventos offline de Google (`MCC_Offline_Lead_Contact`, `MCC_Offline_Purchase`).
- Modelo de acceso por cliente.

**Permisos**

- Habilitación de Spotify Ads API (403).
- TikTok: autorización de las cuatro cuentas y permisos de lectura/reporting; app aprobada según usuario.
- X: app aprobada para Ads API y usuario con acceso a Analytics y lectura de cuentas/campañas.

**Configuración y entorno**

- `TOKEN_STORE_FILE` o un gestor de secretos en el despliegue.
- Acciones principales y mapeos.
- TikTok: aplicar App ID/Secret guardados en el panel, completar OAuth y cargar token más lista de cuatro IDs.
- X: cuatro credenciales OAuth 1.0a; timeout propio apropiado para backfills.
- Un entorno con salida a `*.blob.core.windows.net` para las descargas de Microsoft.
- Despliegue (Cloud Run) con sus secretos.

**Código**

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
5. TikTok con la app aprobada: inyección de variables, OAuth, lectura de las cuatro cuentas y revisión de valores/zonas.
6. Despliegue con secretos y `TOKEN_STORE_FILE`; después n8n, BigQuery y alertas.
7. Modelo de acceso multicliente.
8. X Ads: conexión real y conciliación de cuentas/campañas/reportes; código ya implementado.

El proyecto **no está listo para producción** mientras los puntos 1 a 4 sigan sin comprobarse.
