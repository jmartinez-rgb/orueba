# Auditoría de la entrega de Codex — Unified Ads API

Fecha: 1 de octubre de 2026. Rama: `codex/entrega-auditoria-claude`. Estado recibido: commit
`39a65be` (idéntico al ZIP `unified-ads-api-para-auditoria.zip`, comprobado archivo por archivo).

## Preauditoría de v1 — 2 de octubre de 2026 UTC

Esta revisión parte de `df5aeac` en `codex/finalizacion-verificador-meta-x`. Se corrigieron
seis defectos: acceso ampliado por registros corruptos, modo abierto ante credenciales inválidas,
duplicados en histórico, excepciones de advertencias demasiado amplias, pérdida concurrente de
configuración y caída del informe horario de Spotify al solicitar REVENUE. El control del layout
es defensa adicional, sin alterar permisos nominales. Evidencia, archivo/línea y riesgos restantes:
[PREAUDITORIA_V1.md](PREAUDITORIA_V1.md).

Spotify izzi se recuperó: **30 filas horarias UTC/MXN** guardadas del 30/09 al 01/10. El 502
se reprodujo agregando REVENUE; base, alcance/frecuencia y video funcionaron por separado.
La recuperación vuelve a pedir el bloque completo sin ingresos y declara esos ingresos
como desconocidos. No se afirmó que HOUR/REVENUE estén prohibidos por el contrato v3, ni se
inventaron conversiones o ceros. Totales agregados para conciliar:
[CSV Spotify](../../media-monitoring-center/docs/evidence/spotify-hourly-2026-09-30_10-01.csv).

API: **626 pruebas / 33 archivos**, tipos/lint/formato/build. Monitoreo: **310 pruebas / 34 archivos**,
tipos/lint/build, permisos por HTTP y `RECORD_IO_VERIFIED`. Se preservó configuración privada;
API actual **8086**, Next.js **3000**. Sin publicación ni despliegue. La cola de Settings solo
serializa este proceso; transacciones entre instancias y edición de formularios antiguos siguen
pendientes. No se volvieron a consultar X, Google, Meta, Microsoft ni TikTok en esta ronda.

## Cuentas autorizadas y captura mensual de divisas — 2 de octubre de 2026 UTC

Continuación en `codex/finalizacion-verificador-meta-x` después de `0350770`. El usuario entregó
31 cuentas: **25 izzi y seis Sky**, por ID y marca explícitos. Monedas comprobadas: 26 MXN/cinco
USD. Sky Sports corresponde a Sky; `izzi - Sky Social` corresponde a izzi; X sigue solo izzi.
Microsoft `F107U5WL` se resolvió por API a `138689064`. No se incorporaron cuentas extra del
descubrimiento ni se convirtieron IDs largos a números JavaScript.

Primera carga del **30 de septiembre**, sin declarar conciliación:

- Google: nueve catálogos; **100 filas diarias de ocho cuentas y 2390 horarias de nueve**.
  Universal+ (`4536282576`, Chicago) diario se rechaza con `DAILY_TIMEZONE_MISMATCH`.
- Meta: 15 catálogos; **109 filas diarias de 14 cuentas y 2789 horarias de 15**. izzi ABCW
  (`226733029954417`, Chicago) conserva el mismo bloqueo diario. La advertencia horaria de
  alcance/frecuencia/conversiones externas no bloquea las tres métricas base importadas;
  fixtures prueban que una advertencia sobre gasto sí bloquea.
- Microsoft: ZIP real descargado del host permitido, **266 filas horarias guardadas**, con
  `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`. El bloqueo previo del proxy es histórico;
  no se cambió TLS ni se eludió el proxy. El diario UTC se rechaza como día mexicano. Todavía
  hay que conciliar y completar las horas adyacentes del día local; no hay prueba de todas
  las cuentas Microsoft ni del riesgo residual DNS por esta lectura.
- Spotify de izzi: catálogo y diario UTC con una fila; advertencias de ingresos/evento principal
  no afectan gasto/impresiones/clics. El diario no se incorpora como día mexicano. Horario
  responde **502/PROVIDER_ERROR**, pendiente de diagnosticar; no se afirma conversión horaria.
- TikTok y X conservan el histórico ya descrito. Esta ronda no volvió a consultar X ni certifica
  su cuota actual. Una cuenta USD de Spotify sin permiso queda fuera del mapeo del usuario.

La metadata de zona de cuenta admite `null` (Spotify) o el identificador de Microsoft; nunca
se inventa UTC para ese catálogo. La zona de cada fila de rendimiento sigue siendo IANA válida.
Un `ACCESS_DENIED` de descubrimiento sobre otra cuenta explícita solo se tolera con la seleccionada
presente. Cuotas, errores sin alcance y avisos genéricos siguen bloqueando la carga.

**Operación → Tipo de cambio** permite capturar USD→MXN por mes, compartido entre marcas, con
edición administrativa y consulta interna. No se eligió tasa para septiembre/octubre. La tasa
visible usa el mismo cálculo que la conversión: exacta, anterior provisional o desconocida;
nunca una futura. La bitácora registra mes/actor/valor anterior y nuevo (mejor esfuerzo existente,
no registro financiero transaccional). Detalles: [TIPO_DE_CAMBIO.md](../../media-monitoring-center/docs/TIPO_DE_CAMBIO.md).

Validación del monitoreo: **295 pruebas**, tipos/lint y build; comprobaciones HTTP de la sección
con Juan Pablo, Daniel, Sebastián, Hernán y cliente. No se escribieron tasas ficticias en los
registros operativos. API: **619 pruebas**, tipos/lint/formato. Particiones, contraseñas y secretos
continúan privados. No hubo publicación ni despliegue.

Pendientes de esta carga: **configuración**, capturar tasas y activar almacenamiento/worker durable;
**código**, diagnosticar Spotify horario y completar/conciliar cobertura local; **permisos**,
ningún acceso adicional se presume para cuentas fuera del mapeo; **negocio**, eventos principales,
reglas offline y conciliación ya documentados. El proyecto sigue sujeto a auditoría.

## Actualización incremental local — 2 de octubre de 2026 UTC

El monitoreo incorpora `unified:refresh`: ronda acotada de tres días por cuenta del mapeo,
diaria/horaria, espera persistida y backoff de errores hasta 24 horas. Un worker opcional
`--watch` respeta esa espera y cancela transporte con SIGINT/SIGTERM. No se instaló un cron,
se desplegó ni se activaron mensajes externos. Particiones válidas se conservan ante fallos.

- TikTok real: cuatro cuentas, **755 filas procesadas** (diarias y horarias combinadas, no
  suma de métricas ni filas nuevas) del 29 de septiembre al 1 de octubre. Tres cuentas con filas;
  izzi US devolvió vacío válido para ese periodo y conserva su histórico anterior.
- Repetición inmediata: cuatro `WAITING`, sin consultas nuevas. Prueba de watch: espera,
  SIGTERM y bloqueo liberado. Monitoreo: **284 pruebas**, tipos/lint y build pasan.
- Cuentas reales reconsultadas: Meta 17, Microsoft 4, Spotify 6, HTTP 200; inventario privado
  de 27 cuentas, **sin asignar marcas por sus nombres**. Google no se recorrió de nuevo.
- Microsoft ZIP, permiso Spotify USD y X horario no se revalidaron en esta ronda: sus bloqueos
  siguen pendientes. No se confundió descubrimiento con acceso a reportes.

Comandos y evidencia: [ACTUALIZACION_DIRECTA.md](../../media-monitoring-center/docs/ACTUALIZACION_DIRECTA.md).
La extracción local está implementada; falta definir cuentas/marcas de los demás proveedores,
activación del worker, volumen durable y evaluación desatendida en el entorno destino.

## Monitoreo con APIs directas — 2 de octubre de 2026 UTC

El usuario eligió APIs directas para v1. En `media-monitoring-center`, `DATA_SOURCE=unified`
y `npm run unified:sync` incorporan extracción acotada, almacenamiento privado y adaptador de
rendimiento/histórico. Cuentas por ID, marca y moneda; no se decide el mapeo por nombres.
Solo se importan gasto, impresiones y clics. Conversiones e ingresos de negocio siguen sin
definir; no se trasladan eventos de optimización como ventas ni se promedian CPAs.

- **TikTok:** cuatro cuentas/178 campañas, **35 días (2026-08-28 a 2026-10-01)**, **1022 filas
  diarias y 10432 horarias guardadas**. Las dos filas diarias/27 horarias de izzi US ahora muestran
  actividad; sus periodos vacíos anteriores no se convierten en ceros. Cuenta y reporte mantienen
  `Etc/GMT+6`. El 1 de octubre está abierto; su agregado diario no se usa como día cerrado.
- **X:** por instrucción del usuario, solo `18ce53wx5ui` de izzi entra al monitoreo. Catálogo
  completo de **1276 campañas y 3828 filas diarias (27–29 de septiembre)** guardadas. X de Sky
  queda fuera. El intento horario falló y el diagnóstico acotado posterior fue **HTTP 429
  RATE_LIMITED**: horas/histórico ampliado pendientes; no es motivo para renovar OAuth.
- **Persistencia:** archivos 0600, escritura temporal/`fsync`/`rename`, validación de ámbito y
  bloqueo de extracciones concurrentes. Fallos no borran particiones válidas. Errores de registros
  por archivo/Blobs se propagan sin fallback silencioso a memoria ni mensajes privados.
- **Motor/UI:** fuente directa, catálogo y frescura por cuenta/plataforma; horas abiertas/futuras
  excluidas. Ventanas incompletas, mapas de calor sin muestras, costo USD sin FX y forecast sin
  cobertura quedan desconocidos. Días UTC no se aceptan como días mexicanos. Presupuestos
  vigentes usan marcas explícitas y claves de cuenta/campaña sin colisiones.
- **Configuración local:** fuente directa, API y registros por archivo reconocidos por
  `v1:check -- --sin-red --registros`; 15 cuentas nominales, cinco responsables autorizados y
  administrador principal protegido. Se comprobó escritura/lectura/eliminación de registros locales.
  No se consultó ni configuró un despliegue. Un archivo local no sustituye volumen durable,
  scheduler y permisos del entorno destino; Netlify Functions tiene disco efímero.

- **Acceso y delegación:** 15 cuentas privadas con ambas marcas; cinco IDs autorizados para
  responder. Principal con todos los permisos, protegido contra edición/eliminación por otros
  administradores. Usuarios operativos delegados por ID; clientes ven alertas públicas sin notas
  ni responsables. Estados/notas/cierre y asignación persisten por marca. No hay contraseñas reales
  en Git ni en consola; se entregan solo mediante archivo privado 0600.
- **Validación:** API, tipos/lint/formato y **619 pruebas**; monitoreo, tipos/lint y **276 pruebas**,
  build de producción. HTTP local: 15 logins, 15 controles de escritura, lista de cinco responsables,
  principal protegido, tres páginas y snapshot. `v1:check --sin-red --registros` reconoce cuatro
  grupos, `RECORD_IO_VERIFIED`; salida 2 esperada porque no se verificó acceso externo.
  Se corrigió el reporte para no presentar un subtotal de campañas como total completo ni
  conversiones desconocidas como un estado sano.

Evidencia, comandos y alcance:
[APIS_DIRECTAS.md](../../media-monitoring-center/docs/APIS_DIRECTAS.md),
[280 agregados TikTok](../../media-monitoring-center/docs/evidence/tiktok-direct-2026-08-28_10-01.csv)
y [V1.md](../../media-monitoring-center/docs/V1.md). El CSV conserva moneda/granularidad y
vacíos; no sumar filas diarias con horarias. No equivale a conciliación con Ads Manager.
Google/Meta no se revalidaron en esta extracción; Microsoft y el permiso de una cuenta Spotify
siguen bloqueados como se documenta abajo. No se publicaron ni desplegaron cambios.

## X conectado y primera lectura real — 1 de octubre de 2026 (Bogotá)

Continuación de `046079f` en `codex/finalizacion-verificador-meta-x`. Tras aplicar el nuevo par
OAuth, X respondió **HTTP 200**, estado `connected`. Discovery devolvió **tres cuentas**, todas
MXN y `America/Mexico_City`. El rango diario 2026-09-27 a 2026-09-29 produjo **1.288 campañas** y
**3.864 filas**; se consultó el catálogo completo sin selección incremental. Dos cuentas tienen
campañas y una devolvió catálogo vacío. Costo del periodo: **4167.128471 MXN**, **339.562
impresiones**. Monedas, zonas y agregados diarios se comprobaron contra las filas extraídas.

La única limitación fue `primary_conversion_not_selected`: conversiones y CPA desconocidos,
operaciones marcadas parciales y salida 2, sin errores o pérdida de filas de gasto. No se eligió
un evento principal. Clics normalizados cero no significan interacciones cero; hay una muestra
real con engagements no nulos. Falta conciliar ambas columnas y los ceros con Ads Manager.

Las rutas autenticadas de estado, cuentas y rendimiento de una campaña devolvieron HTTP 200
mediante `app.inject`; no hubo despliegue. Alcance, nueve totales diarios, fechas y pendientes:
[X_PRIMERA_LECTURA.md](X_PRIMERA_LECTURA.md) y
[evidence/x-2026-09-27_29.csv](evidence/x-2026-09-27_29.csv). El Excel completo es privado 0600 y
no se agrega a Git. No se registraron valores OAuth ni se modificaron campañas.

El bloqueo de Microsoft sigue siendo de infraestructura (`proxy_denied` al host fijo de ZIP),
una cuenta USD de Spotify requiere permiso y la configuración de v1 del monitoreo continúa
pendiente. Los rechazos de X descritos abajo son históricos; la matriz actual refleja esta lectura.

## Correcciones de acceso y preparación de v1 — 1–2 de octubre de 2026

Continuación en `codex/finalizacion-verificador-meta-x` desde su entrega `77b3ce8`.
El usuario comunicó aprobación de X y Spotify. Solo se actualiza la matriz con lecturas realizadas;
esa comunicación no certifica permisos sobre cada cuenta, informes o aceptación de la v1.

- **Spotify v3:** DAY/HOUR requieren IDs explícitos de campañas. Se descubren y consultan lotes
  de 50, sin informe global sin alcance; fixtures cubren continuaciones, múltiples lotes,
  cuenta vacía y entidades ajenas. Los conteos `-5` documentados como ocultos por privacidad
  permanecen `null`. La muestra real también devolvió `REVENUE=-5`: se conserva ingreso desconocido
  y un aviso, sin rechazar gasto válido ni atribuirle el intervalo de los conteos.
- **Verificador:** acepta UUID de Spotify en `--cuentas`. Para determinar ayer, Spotify y Microsoft
  usan su día contractual UTC; las demás plataformas conservan la zona de cuenta. Los vacíos y
  errores no se convierten en ceros. Se sigue esperando escritura atómica de tokens rotados.
- **Microsoft v13:** diagnóstico `npm run microsoft:red`, sin credenciales ni URL firmadas.
  Distingue proxy, DNS, TLS, timeout y transporte; los errores de descarga conservan host fijo y
  categoría segura. El proxy rechaza CONNECT al host de informes incluso con borrador de red sin
  restricciones. No es un rechazo OAuth y no se eludió el proxy. DNS del host confiado sigue sin
  quedar fijado al transporte; no se declara cerrado el riesgo residual.
- **X Ads 12:** el primer rechazo de esta continuación fue `INSUFFICIENT_USER_AUTHORIZED_PERMISSION`, clasificado
  `permission_denied`/`user_authorization`. El usuario confirmó que la app estaba en Read.
  Después el usuario confirmó Read and Write y actualización solo del par de usuario; la nueva
  consulta respondió HTTP 401 `UNAUTHORIZED_ACCESS` (`AUTH_ERROR`, estado `error`). Las cuatro
  variables están presentes, sin duplicados o caracteres de copia detectados y sin valores X en
  `.env` que las oculten. Tras aplicar/reiniciar, la lectura posterior ya fue HTTP 200, descrita
  arriba. No se eligen eventos ni se modifican campañas desde el código.
- **Monitoreo:** `npm run v1:check` carga configuración de producción mediante `@next/env` y revisa
  fuente real, acceso nominal, backend de registros y API; comprueba la presencia única de las seis
  plataformas. No revela valores, URL, usuarios, hashes o mensajes de configuración. Un `/health`
  sano o discovery conectado no certifica métricas. Alcance y aceptación: [V1.md](../../media-monitoring-center/docs/V1.md).

### Evidencia real nueva

- Spotify: seis cuentas (dos USD/cuatro MXN), **14 campañas legibles**, una cuenta USD con
  `ACCESS_DENIED` en campañas e informes. El 2026-09-29 en UTC, una cuenta MXN devolvió **tres
  filas**, gasto **983.084134 MXN**, **18.465 impresiones** y **225 clics**; otra consulta devolvió
  **36 filas por evento** de conversiones. No se eligió evento principal. Informe Excel privado
  0600 generado; salida 2 por cobertura parcial/valores desconocidos. Falta conciliar con Ads Manager.
- Microsoft: OAuth, cuatro cuentas, **43 campañas, 11 filas de presupuesto vigente y dos señales
  de entrega**. Para 2026-09-30, tres cuentas devolvieron reportes vacíos válidos; la cuenta con
  actividad quedó bloqueada en descarga ZIP (`proxy_denied`). CSV y zona aún sin conciliación real.
- X: HTTP 403 de permisos de usuario y, después del ajuste comunicado, HTTP 401 de autorización;
  ninguna cuenta, campaña ni métrica en esos intentos. Ese bloqueo se resolvió después de aplicar
  el nuevo par: el estado vigente es `connected`, con lectura de cuentas y métricas descrita arriba.
- Configuración de producción del monitoreo en este checkout: fuente efectiva mock, sin usuarios
  nominales configurados, registros en memoria y sin URL/llave de API. `v1:check -- --sin-red`
  devuelve salida 2 y las cuatro carencias. Esto no describe un despliegue externo no consultado.

Fuentes vigentes consultadas: [Spotify v3.0 Aggregate Report](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getAggregateReport),
[X: acceso tras aprobar la app](https://docs.x.com/x-ads-api/getting-started),
[X: permisos y reautorización](https://docs.x.com/resources/fundamentals/developer-apps) y
[X: roles publicitarios](https://docs.x.com/x-ads-api/fundamentals/accessing-ads-accounts).
Los apartados siguientes conservan las pruebas y bloqueos históricos, fechados; la matriz y los
pendientes al final reflejan esta continuación. No hubo publicación ni despliegue.

### Validación de estas correcciones

Node **24.19.0**: API `typecheck`, `lint`, `format:check`, **619 pruebas/33 archivos** y build
aprobados. Monitoreo `npm run check`, **229 pruebas/24 archivos** y build Next.js **16.3.6**
aprobados. No se saltaron pruebas. Las pruebas de API conservan el bloqueo global de fetch;
las lecturas reales se ejecutaron separadas. El nuevo comando del monitoreo prueba carga de
producción en un directorio temporal, sin red, y exclusión de valores privados de la salida.

## Finalización del verificador, acciones de Meta y selección incremental de X

Fecha: **1 de octubre de 2026**. Base publicada de Claude: `claude/auditoria-tiktok-x`,
commit **`c79b17f`**. Rama propia: **`codex/finalizacion-verificador-meta-x`**. Conserva esa
auditoría y sus mejoras de presupuestos, entrega y monitoreo. Los comandos y reglas que Claude
estaba desarrollando no estaban publicados en esa base; esta continuación los implementa.

- `npm run verificar`: primera lectura acotada de las plataformas configuradas, cuentas, campañas,
  presupuestos y salud disponibles, y rendimiento diario según la zona de cada cuenta. Excel con
  cobertura, vacíos distintos de cero y campos seleccionados; IDs como texto, archivo exclusivo
  0600 en `reportes/`, sin secretos ni cuerpos originales de error.
- `npm run meta:acciones`: inventario diario y totales por cuenta, moneda, grupo CAPI WhatsApp/resto
  y acción exacta. Resuelve nombres de conversiones personalizadas cuando el permiso lo permite.
  No mezcla alias, elige eventos principales ni cambia el mapeo comercial.
- `META_PRIMARY_CONVERSION_RULES`: selección literal por nombre o ID de campaña. Cuentas con
  reglas sin coincidencia mantienen conversiones y CPA desconocidos; conflictos se informan.
  No se activaron reglas privadas ni se eligieron IDs de negocio.
- Tokens rotados de Microsoft/Spotify: los comandos esperan escritura atómica en `.env` y en el
  almacén configurado, conservando las otras variables. La entrada oculta se comparte con
  `meta:exclusiones`, con limpieza de terminal y sin eco de credenciales.
- X Ads 12: `active_entities` opcional para sincronización incremental. Su ventana de cambios
  se distingue del periodo del reporte. Se valida el contrato y se advierte cobertura parcial;
  respuestas no utilizables conservan todas las campañas, mientras autenticación, cuota y
  cancelación se propagan. Primera lectura e históricos conservan el comportamiento completo por
  defecto. No se activó la ventana ni se repitió la consulta de la app pendiente de aprobación.

Fuentes: [Analytics oficial de X Ads 12](https://docs.x.com/x-ads-api/analytics) y
[SDK oficial de Meta 26.0.2, CustomConversion](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.2/facebook_business/adobjects/customconversion.py).
Guía y contratos: [VERIFICACION.md](VERIFICACION.md). Las siguientes secciones conservan la
evidencia histórica y la autoría de las auditorías anteriores.

### Lectura real del nuevo comando

Se ejecutó `verificar` **solo para las cuatro cuentas autorizadas de TikTok**, con fecha explícita
**2026-09-29**. Salida 0, conexión comprobada, 178 campañas, 26 filas de presupuestos actuales,
25 filas de rendimiento y ninguna advertencia/error en las secciones implementadas. Salud de
entrega se registra `not_supported`, sin simular una comprobación. Archivo privado generado y
comprobado como 0600; no se incorpora a Git.

| Cuenta             | Filas diarias | Gasto 2026-09-29 (MXN) | Filas de presupuestos actuales |
| ------------------ | ------------: | ---------------------: | -----------------------------: |
| Sky México         |            12 |                3417.24 |                              7 |
| Sky Sports MXN     |             3 |                 437.22 |                              4 |
| izzi - ABCW        |            10 |                1576.14 |                             15 |
| izzi ABCW US (USD) |     Sin filas |              No aplica |                      Sin filas |

Los costos y cantidades de filas coinciden con el CSV agregado anterior para el día solicitado.
Las cuatro cuentas mantienen `Etc/GMT+6`; el verificador no sustituye esa zona por la de
visualización. Los presupuestos son **vigentes al extraer**, no los del 29 de septiembre.
Esto prueba el comando contra la API real, **no** la conciliación con Ads Manager ni las unidades
de `total_complete_payment_rate`. El Excel marca ese valor de compras como unidades no confirmadas.
No se realizaron nuevas consultas reales de Google, Meta, Microsoft, Spotify o X en esta continuación.

### Validación de la finalización

- Node **24.19.0**: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` y
  `npm run build`; **600 pruebas, 32 archivos**. La suite bloquea red mediante el stub global
  existente; no se omitieron ni desactivaron pruebas. Node 22 conserva la validación de Claude
  sobre la base y la configuración de CI; no se afirma una ejecución nueva local en Node 22.
- Monitoreo conservado: `npm run check`, **215 pruebas, 23 archivos**. No se modificó el centro
  ni su registro de seis plataformas; no se afirma una nueva revisión visual o despliegue.
- Ayuda de ambos comandos ejecutada sin acceso a plataformas; lectura real de TikTok separada
  de las pruebas de fixtures. Escenarios nuevos: reglas ambiguas/sin coincidencia, acciones
  separadas y cantidades desconocidas, zonas/fechas/límites, Excel privado y rotaciones,
  filtros incrementales de X/respaldo y entrada oculta con restauración de terminal.

Pendientes externos y de negocio permanecen en la sección de pendientes, separados de estas
mejoras verificadas con código. No se declara el proyecto terminado ni listo para producción.

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

| Sev.  | Ubicación                      | Riesgo                                                                                                                                                                       | Cómo cerrarlo                                                                                                 |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Media | `x/config.ts` (`X_PLACEMENTS`) | Se suman `ALL_ON_TWITTER`, `SPOTLIGHT` y `TREND`; el SDK oficial también define `PUBLISHER_NETWORK`. Una campaña en X Audience Platform quedaría subcontada.                 | Confirmar en la referencia v12 si `PUBLISHER_NETWORK` sigue vigente y revisar `placements` de los line items. |
| Media | `x/reports.ts`                 | Se piden métricas de todas las campañas (incluidas eliminadas) por lote, ubicación y bloque; con muchas campañas puede agotar el límite de tasa. El polling es cada segundo. | Filtrar con `stats/accounts/:id/active_entities` (en el SDK) y espaciar el polling según el límite real.      |
| Baja  | `x/client.ts` (descarga)       | El patrón `stats_job_<ID>.json.gz` en `ton.twimg.com` no se ha visto en una respuesta real. Si difiere, la descarga falla cerrada.                                           | Primera lectura asíncrona real tras la aprobación.                                                            |
| Baja  | `google/budgets.ts`            | La consulta de presupuestos usa campos confirmados en v25, pero no se ejecutó contra Google real (seleccionabilidad conjunta).                                               | Una consulta real acotada a una cuenta.                                                                       |
| Baja  | `microsoft/budgets.ts`         | Con `LifetimeBudgetStandard` se asume que `DailyBudget` lleva el monto total; no suma al diario, solo se informa.                                                            | Comparar una campaña con presupuesto total contra la interfaz.                                                |

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
- **X:** `X_ADS_PLACEMENTS` permite sumar `PUBLISHER_NETWORK` si se confirma en v12, y la consulta del
  estado de trabajos asíncronos espera 1, 2, 4, 8 y luego 10 s.
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

Google y Meta conservan la evidencia histórica de Codex; la auditoría de Claude no tuvo
credenciales para repetirla. Esta continuación sí comprobó nuevas lecturas de Microsoft,
Spotify y la primera lectura real de X, descritos al inicio. TikTok se verificó el 1 de octubre de 2026;
detalles y totales en [TIKTOK_PRIMERA_LECTURA.md](TIKTOK_PRIMERA_LECTURA.md). La finalización del
verificador añadió una lectura de un día y 26 presupuestos actuales, descrita arriba.

| Plataforma | Simulador            | OAuth y credenciales reales                  | Cuentas reales                              | Campañas reales         | Informes y métricas reales                                                                         | Conciliación con la interfaz |
| ---------- | -------------------- | -------------------------------------------- | ------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| Google Ads | Sí                   | Sí                                           | Sí (9 mapeadas; jerarquías verificadas)     | Sí                      | Monitoreo 30/09: 100 diarias/2390 horarias; Universal+ diario fuera de zona                        | Pendiente                    |
| Meta       | Sí                   | Sí (token)                                   | Sí (15 mapeadas de 17 activas)              | Sí                      | Monitoreo 30/09: 109 diarias/2789 horarias; izzi ABCW diario fuera de zona                         | Pendiente                    |
| TikTok     | Sí                   | Sí, OAuth y token real                       | Sí (4, monedas y zonas leídas)              | Sí (178)                | Monitoreo: 35 días, 1022 filas diarias/10432 horarias; US con actividad                            | Pendiente                    |
| Microsoft  | Sí                   | Sí                                           | Sí (4; monitoreo 1 izzi)                    | Sí (43; cuenta izzi 15) | ZIP descargado: 266 horarias completas; diario UTC fuera de zona                                   | Pendiente                    |
| Spotify    | Sí                   | Sí (refresh token)                           | Sí (6; monitoreo 1 MXN izzi)                | Sí (14 accesibles)      | Diarios UTC; izzi: 30 filas horarias UTC recuperadas; ingresos desconocidos; USD extra sin permiso | Pendiente                    |
| X Ads      | Sí, fixtures sin red | Sí, OAuth 1.0a; HTTP 200, estado `connected` | Sí (3); monitoreo solo izzi por instrucción | Sí (1288); izzi 1276    | API: 3864 filas diarias; monitoreo izzi: 3828; horas HTTP 429                                      | Pendiente                    |

## Pendientes y orden recomendado

La guía actual es [VERIFICACION.md](VERIFICACION.md); [TRASPASO_CLAUDE.md](TRASPASO_CLAUDE.md)
conserva la entrega histórica. La persistencia atómica del asistente Google y el tratamiento de
fallos de lectura del almacén de tokens ya fueron corregidos y probados por Claude (C2 y C3),
y esta rama conserva esas correcciones.

**Decisiones de negocio**

- Acción principal de Meta por cuenta. Para izzi hay dos universos que no se mezclan: las campañas
  CAPI WhatsApp se miden con _On-Facebook Purchase_ y las demás con _Compras Offline Web (Inbound)_.
- Evento principal de Spotify y métrica principal de TikTok.
- Mapeo de los eventos offline de Google (`MCC_Offline_Lead_Contact`, `MCC_Offline_Purchase`).
- Modelo de acceso por cliente.

**Permisos**

- Spotify: habilitación global comprobada por lecturas reales. Revisar acceso del usuario a
  campañas e informes de la cuenta USD `4bf9f073-8f04-4d76-8074-970f364c3e52` (`ACCESS_DENIED`).
- TikTok: lectura de las cuatro cuentas autorizada y verificada. No queda un bloqueo de permisos
  en la muestra; otros productos o ámbitos de reporting no se dan por validados.
- X: app `33489379`, OAuth y lectura síncrona de tres cuentas comprobados. No queda un bloqueo
  OAuth en esta muestra. Confirmar si las tres cuentas descubiertas cubren todas las requeridas;
  no se afirma acceso a otras identidades, ubicaciones o productos. Los rechazos previos se
  conservan como históricos en [X_ADS.md](X_ADS.md).

**Configuración y entorno**

- Monitoreo: `UNIFIED_ADS_API_URL` y `UNIFIED_ADS_API_KEY` en el despliegue para el panel de presupuestos
  diarios (sin ellas muestra cómo conectarlo; en modo demo usa datos de ejemplo rotulados).
- Monitoreo v1: APIs directas e histórico por archivo implementados y configurados localmente.
  Acceso nominal validado localmente; faltan su configuración en producción, tasas mensuales USD,
  scheduler y volumen durable compartido en el entorno destino. Los 31 IDs y marcas del usuario ya están mapeados; X de Sky queda fuera.
  Tasas mensuales capturables desde Operación → Tipo de cambio, aún sin valores del equipo. `v1:check` valida configuración, no cobertura de datos ni aceptación de producción.
- `TOKEN_STORE_FILE` o un gestor de secretos en el despliegue.
- Acciones principales y mapeos.
- TikTok: conservar token y lista de cuatro IDs en la configuración privada del entorno destino.
  El token actual está en `.env` privado 0600; el código de retorno ya fue consumido.
- X: conservar en el entorno destino las cuatro variables OAuth 1.0a comprobadas; no volver
  a regenerarlas por los errores históricos ya resueltos. Configurar evento principal por cuenta
  y timeout apropiado para backfills. La primera lectura usó un plazo de 120 segundos.
- Microsoft: la descarga al host permitido se comprobó en esta continuación. Conservar salida
  HTTPS al mismo host y `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`; volver a validar
  desde el entorno destino. El rechazo previo del proxy queda como evidencia histórica.
- Despliegue (Cloud Run) con sus secretos.

**Código**

- Preauditoría: transacciones entre instancias para Settings/usuarios/incidentes, control de edición
  sobre formularios antiguos y bitácora financiera durable. La cola local de Settings no cubre
  estos casos; ver [PREAUDITORIA_V1.md](PREAUDITORIA_V1.md).

- X (auditoría de Claude): confirmar `PUBLISHER_NETWORK` en v12 (se activa con `X_ADS_PLACEMENTS`).
  `active_entities` ya está implementado y probado con fixtures como selección incremental
  opcional, sin confundir la ventana de cambios con el periodo del reporte; falta comprobarlo
  con la app aprobada. El polling espaciado de Claude se conserva.
- Salud de entrega de TikTok cuando haya un vocabulario oficial de `secondary_status` verificable.
- Primera lectura real de `/budgets` y `/delivery-health` en Meta y Google para confirmar campos y
  seleccionabilidad; Microsoft ya devolvió 11 presupuestos y dos señales, falta conciliarlos.
- Presupuestos de Spotify y X (sus APIs los exponen en ad sets y line items); lectura real de
  cuentas/campañas ya comprobada, implementación de presupuestos pendiente.
- X: OAuth multiusuario y conversiones móviles, si se requieren. Primera lectura diaria real
  comprobada; conciliación, horas, conversiones web y descarga asíncrona siguen pendientes.
- TikTok v2.0, si se decide migrar; el intercambio OAuth v1.3 ya existe.
- Microsoft: transporte con resolución fijada compatible con el proxy, o revisión explícita del riesgo residual del host confiado.
- Meta: informes asíncronos si una cuenta supera los bloques síncronos ya implementados.
- Google: extracciones persistentes fuera del ciclo HTTP para jerarquías que excedan el timeout; paralelismo limitado ya implementado.
- API: `performance.repository.ts` sigue siendo un contrato. El monitoreo ya tiene histórico
  privado por archivo; migrar ese backend antes de usar disco efímero de Functions. Todavía
  falta control transaccional de contadores/listas operativas entre varias instancias.
- Aislamiento multicliente, tras la decisión.

**Orden**

1. Conciliar Google y Meta contra sus interfaces: un día, una cuenta, mismo criterio de atribución
   (comprueba ceros reales y cierra atribución).
2. Decidir y configurar las acciones principales y los mapeos de conversiones.
3. Microsoft: conciliar las 266 filas horarias reales, completar las horas adyacentes del día
   mexicano y comprobar nuevamente el host de descarga desde producción.
4. Spotify: diagnosticar el horario de izzi (502/PROVIDER_ERROR), ampliar la muestra y conciliar
   gasto, conversiones y final inclusivo documentado. El permiso USD solo aplica si el usuario
   incorpora esa cuenta adicional; hoy queda fuera del mapeo autorizado.
5. TikTok: conciliar los nuevos 35 días diarios/horarios y sus vacíos, el gasto US ahora presente
   y la zona de visualización de Sky Sports; verificar unidades de compra con una muestra no nula.
6. Despliegue con secretos y `TOKEN_STORE_FILE`; después n8n, BigQuery y alertas.
7. Modelo de acceso multicliente.
8. X Ads: conciliar los nueve agregados cuenta/día, clics/interacciones y cobertura de cuentas;
   probar horas, conversiones configuradas e informes asíncronos. Conexión diaria real ya comprobada.

El proyecto **no está listo para producción** mientras los puntos 1 a 4 sigan sin comprobarse.
