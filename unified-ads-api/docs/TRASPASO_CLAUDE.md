# Traspaso a Claude: continuación de TikTok y X Ads

## Última continuación: preauditoría de v1 (2 de octubre de 2026 UTC)

Auditar el HEAD remoto de `codex/finalizacion-verificador-meta-x`, después de `df5aeac`.
Esta sección prevalece sobre todos los checkpoints anteriores. Lee primero
[PREAUDITORIA_V1.md](PREAUDITORIA_V1.md): seis defectos corregidos, regresiones demostradas,
lectura horaria real de Spotify y pendientes por código, permisos, configuración y negocio.

- **Spotify izzi:** 30 filas horarias UTC/MXN del 30/09 al 01/10 guardadas. REVENUE provocaba
  HTTP 502; el bloque se recupera sin ingresos con advertencia explícita. No mezclar día UTC
  y mexicano. CSV agregado sin secretos enlazado en el informe. Conciliación pendiente.
- **Acceso:** registros corruptos no amplían marcas/permisos ni reactivan usuarios; credenciales
  inválidas no abren desarrollo. Se preserva la migración nominal con versión cero y el control
  máximo de Juan Pablo. No se cambiaron las 15 identidades ni quién responde alertas.
- **Datos:** advertencias se validan por ruta/código/plataforma/cuenta; duplicados y alcance inválido
  bloquean lectura/escritura del histórico. Tasas de meses distintos no se pierden con dos PATCH
  simultáneos en un proceso. Multiinstancia, formularios antiguos y bitácora transaccional pendientes.
- **Validación:** API 626 pruebas + tipos/lint/formato/build; monitoreo 310 + tipos/lint/build;
  permisos nominales por HTTP y almacenamiento comprobado. No hay pruebas omitidas ni cuarentena.
- **Entorno actual:** API 8086, Next.js 3000; configuración privada conservada y arranque actualizado.
  No detener listeners antiguos sin identificar su propietario. No se publicó ni desplegó.

Mantener las 31 cuentas autorizadas, X solo izzi y las reglas de negocio. Capturar las tasas desde
la sección preparada, conciliar horas/días y preparar volumen/scheduler antes de liberar v1.
No repetir OAuth ni pedir secretos por chat. El código está en Git; credenciales e histórico
privado no viajan con la rama. Continuar en una rama propia, sin force-push ni sobrescribir trabajo.

## Actualización para retomar — cuentas y tipo de cambio (2 de octubre de 2026 UTC)

La rama activa es `codex/finalizacion-verificador-meta-x`, continuación después de `0350770`.
Esta sección prevalece sobre los estados históricos de acceso y configuración más abajo.

- El usuario confirmó **31 cuentas**, mapeadas en
  `media-monitoring-center/config/unified.mapping.example.json`: 25 izzi/seis Sky, nueve Google,
  15 Meta, cuatro TikTok y una de Microsoft, Spotify y X. Microsoft `F107U5WL` es `138689064`.
  X solo izzi. Las cinco cuentas USD están identificadas; no se decidió tipo de cambio.
- Nueva sección **Operación → Tipo de cambio** (`/tipo-de-cambio`), compartida entre marcas por mes,
  edición con `settings:write`, consulta interna y bitácora con valores anteriores/nuevos.
  Revisar [TIPO_DE_CAMBIO.md](../../media-monitoring-center/docs/TIPO_DE_CAMBIO.md). No se
  cargaron tasas ficticias. Se conserva la regla previa de tasa anterior provisional, ahora
  visible usando el mismo cálculo de conversión. La bitácora es de mejor esfuerzo; concurrencia
  entre instancias/registro financiero transaccional permanecen pendientes.
- Primera carga del 30/09: Google 100 diarias/2390 horarias; Meta 109/2789. Dos diarios en Chicago
  se rechazan por diferencia de zona. Los reportes horarios conservan su reloj y pasan al de México.
- **Microsoft descargó el ZIP** y guardó 266 filas horarias con datos completos. La configuración
  privada local exige `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`. El rechazo de proxy es
  histórico en este entorno; falta conciliar y revalidar en producción. No hubo evasión TLS/proxy.
- Spotify izzi: diario UTC devuelve una fila, pero no se acepta como día mexicano. Horario:
  **502/PROVIDER_ERROR**, pendiente. X no se reconsultó en esta ronda; se conserva el límite
  horario observado y su histórico diario. La cuenta USD extra de Spotify está fuera del mapeo.
- El sincronizador admite solo advertencias concretas ajenas a las tres métricas importadas;
  fixtures prueban que errores de gasto, genéricos, de otra cuenta o cuotas bloquean la carga.
  No se importan conversiones/ventas por defecto ni se cambian las reglas de negocio.
- Validación: API **619 pruebas** y tipos/lint/formato; monitoreo **295 pruebas** y tipos/lint/build.
  HTTP local de permisos nominales y tasas sin capturas falsas. API local actual puerto **8088**,
  monitoreo **3000**, configuración privada preservada; el puerto anterior ocupado no se liberó
  sin identificar su propietario. No publicar ni desplegar.

Prioridad al retomar: auditar conversión/alcance de las 31 cuentas y permisos; capturar las tasas
del equipo desde la sección; diagnosticar Spotify horario; completar cobertura mexicana sin
inventar horas/ceros; conciliar; luego preparar worker y volumen durable del destino. Leer primero
[AUDITORIA.md](AUDITORIA.md) y [V1.md](../../media-monitoring-center/docs/V1.md).

**Documento histórico de la entrega `b4226e9`.** La continuación actual está en
`codex/finalizacion-verificador-meta-x`, desde la auditoría `c79b17f` de Claude.
Lee primero [VERIFICACION.md](VERIFICACION.md) y la sección más reciente de
[AUDITORIA.md](AUDITORIA.md); las instrucciones y pendientes siguientes corresponden a la
entrega anterior y no deben usarse para volver a una base antigua.

Actualizado el **1 de octubre de 2026**. Repositorio: `jmartinez-rgb/orueba`.
Rama entregada: **`codex/continuacion-tiktok-x`**, subida a GitHub.
Este documento describe la continuación posterior a la primera auditoría de Claude.
El proyecto requiere auditoría y conciliación; no se declara terminado ni listo para producción.

## Punto de partida y objetivo

Continúa desde el HEAD remoto de `codex/continuacion-tiktok-x`, creando tu propia rama de trabajo.
Primero revisa el estado local y preserva cambios ajenos. No hagas push a
`claude/blissful-goodall-vh8k7n`, `codex/entrega-auditoria-claude` ni a la rama de entrega de Codex.
No reescribas historial ni hagas force-push, reset, clean o checkout sobre trabajo ajeno.

La continuación parte del commit de Claude **`1bf278f`** de
`claude/blissful-goodall-vh8k7n`. Revisa de forma independiente el diff desde ese commit:

```bash
git status --short --branch
git log --oneline 1bf278f..origin/codex/continuacion-tiktok-x
git diff --stat 1bf278f..origin/codex/continuacion-tiktok-x
git diff 1bf278f..origin/codex/continuacion-tiktok-x -- unified-ads-api media-monitoring-center
```

Antes de usar esas referencias, actualiza las referencias remotas por el mecanismo normal de tu
entorno. GitHub contiene el código, pruebas, documentación y CSV agregado; no necesitas el ZIP
histórico. GitHub no transfiere las credenciales privadas del entorno de Codex.

Lee primero:

- [AUDITORIA.md](AUDITORIA.md): hallazgos previos, correcciones, matriz y pendientes.
- [README](../README.md), [X_ADS.md](X_ADS.md) y [TIKTOK_ADS.md](TIKTOK_ADS.md).
- [TIKTOK_PRIMERA_LECTURA.md](TIKTOK_PRIMERA_LECTURA.md) y su CSV de evidencia.
- [Guía del monitoreo](../../media-monitoring-center/docs/GUIA.md): roles, Auditoría y vista Cliente.
- `media-monitoring-center/AGENTS.md` y la documentación instalada de Next.js antes de modificar
  el monitoreo, como exige ese archivo.

## Qué se entregó

Dos proyectos separados:

- **`unified-ads-api/`**: Node >=22, TypeScript, Fastify 5, zod 4, vitest. Google v25, Meta v26.0,
  TikTok v1.3, Microsoft v13, Spotify v3 y X Ads API 12.
- **`media-monitoring-center/`**: Next.js 16, izzi y Sky. Conserva los roles admin, operativo,
  auditor y cliente, la Auditoría de incidencias y la vista Cliente de la base de Claude.

Commits que separan implementación de evidencia:

| Commit    | Contenido                                                                        |
| --------- | -------------------------------------------------------------------------------- |
| `9097a68` | Proveedor X Ads, panel, fixtures y correcciones de riesgos de otras plataformas. |
| `4fee3b9` | Primera lectura real de cuatro cuentas de TikTok y CSV diario para conciliar.    |
| `24376b9` | Guía de registro y solicitud de acceso para X.                                   |
| `6a8f1ff` | Primera petición real de X: HTTP 403 de aplicación sin habilitación.             |
| `d381102` | Solicitud de acceso enviada por el usuario; aprobación pendiente.                |

Áreas de código para auditar primero:

- `src/providers/x/{auth,client,config,errors,index,normalize,reports}.ts`: OAuth 1.0a HMAC-SHA1,
  registro, `stateFromError`, getter `timeoutMs`, vocabulario compartido de conversiones,
  métricas diarias/horarias, reintentos y cuotas, reportes síncronos y asíncronos.
  Revisar especialmente firma y codificación, permisos parciales, fechas y cambio de zona,
  tres ubicaciones, valores ausentes frente a nulos explícitos, monedas y trabajos de 64 bits.
  La descarga de gzip usa un destino fijo validado y no lleva cabeceras OAuth.
  El evento principal de X no se selecciona automáticamente.
- `src/providers/google/index.ts` y `normalize.ts`: hasta cuatro cuentas en paralelo, cancelación
  y drenaje; ceros protobuf de escalares seleccionados dentro de un objeto de métricas válido.
  No se fabrican filas de campañas/días ni se convierten nulos o valores inválidos en cero.
- `src/providers/meta/index.ts` y `queries.ts`: reportes diarios en bloques de 30 días y horarios
  en un día, con límite global y validación contra duplicados y filas fuera del periodo.
- `src/providers/microsoft/reports.ts`: descarga restringida a
  `bingadsappsstorageprod.blob.core.windows.net`, validación de IP pública y bloqueo de redirecciones.
  No se afirma haber eliminado la ventana entre resoluciones DNS del host confiado.
- Spotify: contrato oficial v3 confirma `report_end` inclusivo para el día/hora final;
  regresión de límites de 90 días en `tests/continuation-risks.test.ts`.
- `media-monitoring-center/src/components/monitoring/unified-api-panel.tsx` y
  `tests/unified-api.test.ts`: X se muestra con el esquema y estados compartidos de los demás.

Hay **55 pruebas específicas de X** y **12 regresiones de riesgos**, además de la suite previa.
Contrasta fixtures y supuestos con fuentes oficiales; pasar pruebas no sustituye esa revisión.

## Evidencia real y bloqueos

| Plataforma | Evidencia disponible                                                                                                     | Qué sigue pendiente                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Google     | Evidencia histórica: OAuth, cuentas/MCC y muestras de campañas, métricas y conversiones.                                 | Conciliar con Ads; confirmar consulta horaria por acción. No se revalidó la muestra histórica en esta continuación. |
| Meta       | Evidencia histórica: token, 17 cuentas activas y muestras de campañas/Insights.                                          | Conciliar atribución y las dos familias de eventos; acción principal por cuenta.                                    |
| TikTok     | Lectura nueva de cuatro cuentas: 178 campañas, 76 filas diarias y 608 filas de conversiones.                             | Conciliar CSV, unidades de compra web, zona de visualización y eventos principales.                                 |
| Microsoft  | Evidencia histórica: OAuth, cuatro cuentas y 43 campañas.                                                                | Proxy bloquea la descarga del ZIP de informes; falta lectura y conciliación horaria real.                           |
| Spotify    | OAuth histórico correcto; Ads API responde 403 `ACCESS_REQUIRED`.                                                        | Habilitación de cuenta; después cuentas, campañas y reporte acotado.                                                |
| X          | Cuatro variables aplicadas; `GET /12/accounts` devuelve 403 `UNAUTHORIZED_CLIENT_APPLICATION`, estado `access_required`. | Aprobación de app; después tokens posteriores a aprobación, cuentas y reportes reales.                              |

### TikTok: preservar exactamente la muestra

Fechas inclusivas **2026-09-27 a 2026-09-29**, atribución por interacción del anuncio.
Se consultaron únicamente las cuatro cuentas elegidas por el usuario:

| Cuenta         | ID como texto         | Moneda | Campañas | Gasto del periodo |
| -------------- | --------------------- | ------ | -------: | ----------------: |
| Sky México     | `7338571937913978882` | MXN    |       43 |          10064.44 |
| Sky Sports MXN | `7545502925565771792` | MXN    |       17 |           1428.63 |
| izzi - ABCW    | `7361545670072909840` | MXN    |      116 |           4393.91 |
| izzi ABCW US   | `7688066712031182866` | USD    |        2 |         Sin filas |

Las cuatro cuentas reportan `Etc/GMT+6` = UTC−06:00 fijo. Sky Sports tiene
`display_timezone=America/Chicago`, UTC−05:00 en la muestra; no sustituir automáticamente
la zona del reporte por la de visualización. Los IDs de 64 bits deben permanecer como texto.

[evidence/tiktok-2026-09-27_29.csv](evidence/tiktok-2026-09-27_29.csv) contiene 12 filas cuenta/día.
Las celdas vacías de US representan ausencia de filas, no gasto o conversiones cero.
izzi devuelve 29 `conversion` y 30 `onsite_form`: se conservan separados, no son 59 ventas.
Los campos `complete_payment` y `total_complete_payment_rate` llegaron siempre en cero:
esto no confirma unidades monetarias. El normalizador heredado usa el segundo como valor;
ese riesgo sigue abierto y necesita contrato fiable y muestra no nula.

OAuth y las rutas autenticadas de TikTok se comprobaron con `app.inject`; no hubo despliegue.
El token quedó en `.env` privado 0600. El callback ya fue consumido: no volver a canjearlo.
Para reportes bastan `TIKTOK_ACCESS_TOKEN` y `TIKTOK_ADVERTISER_IDS`; App ID y Secret sirven
para OAuth y descubrimiento. La autorización cubría más IDs, pero no se amplió la muestra a ellos.

### X: solicitud recibida, sin aprobación todavía

App ID público **`33489379`**. El usuario envió el formulario oficial el 1 de octubre y aportó
captura con «Success! Someone from the X Developer Platform will reach out shortly.»
La integración requiere **Standard Access**. No hay número de caso ni plazo confirmado.

No pedir reenviar la solicitud ni repetir consultas bloqueadas sin aprobación o cambio relevante.
La presencia de las cuatro variables no valida por sí misma las parejas OAuth.
Después de la aprobación, según la guía oficial, regenerar únicamente el par de usuario
`X_ADS_ACCESS_TOKEN` y `X_ADS_ACCESS_TOKEN_SECRET`, mantener las consumer keys de la misma app,
aplicar la configuración privada y consultar cuentas. Una aplicación admite varias cuentas
autorizadas; listar las accesibles y acordar IDs antes de una lectura acotada de 3 a 7 días.
Los permisos de Analytics, cuentas, zonas y conversiones todavía no se verificaron con datos reales.

## Qué puede avanzar ahora

1. **Auditoría independiente y correcciones demostradas**, primero X y las regresiones citadas.
   Revisar timeouts, cancelación, resultados parciales, cuotas, dimensiones/fechas, nulos y ceros,
   redacción de errores y límites de descarga. Añadir pruebas de defectos reproducibles con fixtures.
2. **Persistencia segura de tokens, sin nuevas autorizaciones.** Revisar
   `scripts/google-auth.ts:81`, que escribe `.env` directamente, y
   `src/config/token-store.ts:48`, que trata cualquier fallo de lectura como archivo vacío.
   Son puntos concretos de revisión, no incidentes demostrados con credenciales reales.
   Comprobar escrituras atómicas 0600, errores distintos de ENOENT, conservación de líneas ajenas,
   limpieza de temporales y concurrencia. Validar con archivos temporales y valores sintéticos.
3. **Contratos de reporting.** Confirmar la compatibilidad GAQL de `segments.hour` junto con
   `segments.conversion_action` en v25. Ejecutar solo una consulta acotada si hay credenciales
   privadas y acceso disponibles; sin ellos, separar lo confirmado por contrato de lectura real.
   Buscar una definición oficial verificable de `total_complete_payment_rate` sin inferir ingresos
   a partir de ceros. Revisar el transporte Microsoft respetando TLS y proxy; una lista de hosts
   no demuestra fijación de IP y un fixture no elimina el riesgo de la red real.
4. **Conciliación con exportaciones autorizadas**, cuando estén disponibles: mismos días, cuenta,
   moneda, zona y criterio de atribución. Conservar diferencias y fecha de extracción.
5. **Arquitectura posterior:** persistencia histórica, trabajos fuera de HTTP, OAuth multiusuario
   de X, reportes asíncronos de Meta y aislamiento por cliente. Separar propuestas de decisiones
   aún no tomadas; no crear reglas de acceso o métricas de negocio por cuenta propia.

La acción principal, los mapeos por cliente y el modelo multicliente requieren decisión de negocio.
Spotify/X y la descarga de Microsoft requieren permisos o entorno. No declararlos resueltos por
fixtures. El usuario no autorizó despliegue; Cloud Run, n8n, BigQuery y alertas quedan pendientes.

## Reglas de negocio y manejo de datos

- Meta: campañas con **«CAPI WhatsApp»** se miden con **On-Facebook Purchase**; las demás,
  con **Compras Offline Web (Inbound)**. No mezclar en análisis; sumar solo para venta total.
- Google: únicos eventos offline válidos **`MCC_Offline_Lead_Contact`** y **`MCC_Offline_Purchase`**.
- CPA = **suma de costo / suma de conversiones**. Nunca promediar CPAs.
- No elegir acciones principales de Meta, Spotify o TikTok ni mapear eventos offline de Google.
  No sumar monedas, tasas, alcance ni eventos superpuestos sin una regla acordada.
- No leer la pestaña **Ventas Detalle**, que contiene teléfonos.
- No pedir secretos por chat ni registrar cuerpos OAuth, cabeceras, callbacks con códigos,
  tokens, claves o URL firmadas de informes. No subir `.env` ni la llave JSON de servicio.
- No desactivar TLS, eludir el proxy, publicar o desplegar. No saltar ni aislar pruebas.

El usuario opera desde el navegador. Una máquina distinta necesita configuración privada por
su propio mecanismo seguro; el Git de entrega no contiene secretos. No copiar `.env.example`
encima de archivos existentes. `TOKEN_STORE_FILE` o un gestor de secretos sigue pendiente en el
entorno destino; no confiar en que el panel tenga los refresh tokens rotados del `.env` local.

## Validación y resultado esperado

API: **501 pruebas en 22 archivos**, tipos, lint y formato pasan en Node 24.19.0.
`tests/setup.ts` bloquea la red global. La CI mantiene Node 22 y 24; no se afirma una nueva
ejecución local en Node 22. Build pasó en `9097a68`; los commits posteriores cambian documentación.
Monitoreo: **202 pruebas en 20 archivos** con `npm run check` en `9097a68`; no se modificó después.

Antes de **cada commit**, desde `unified-ads-api/`:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

Si modificas `media-monitoring-center/`, ejecuta allí `npm run check`.
Reproduce build o pruebas adicionales si las correcciones lo requieren. Instala con el lockfile
y `npm ci` si faltan dependencias, sin sustituir configuración privada.

Entrega commits descriptivos y push a tu propia rama. Actualiza README y AUDITORIA con evidencias
nuevas únicamente verificadas y pendientes separados en código, permisos, configuración y negocio.
Informa hallazgos con severidad, archivo/línea, impacto, evidencia y corrección, pruebas ejecutadas
y bloqueos. No des por correcto el código solo porque sus pruebas pasan ni declares el proyecto terminado.
