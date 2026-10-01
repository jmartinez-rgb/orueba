# Unified Ads API

API intermedia entre las plataformas publicitarias (Google Ads, Meta, TikTok, Microsoft Advertising,
Spotify y X) y los sistemas internos (n8n, BigQuery, dashboard, alertas y WhatsApp). Cada plataforma
se traduce a un **modelo normalizado** y el resto de los sistemas nunca necesita conocer cómo funciona
cada API: n8n solo pregunta a esta API.

## Estado

| Fase | Contenido                                | Estado                                                                                                |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | Infraestructura base (sin integraciones) | **Lista**                                                                                             |
| 2    | Google Ads                               | **Implementada y verificada con Google real y simulador**                                             |
| 3    | Meta Marketing API                       | **Implementada y verificada con Meta real y simulador**                                               |
| 4    | TikTok Ads                               | **OAuth y lectura real de cuatro cuentas verificados; conciliación pendiente**                        |
| 5    | Microsoft Advertising                    | **Autorización y campañas reales verificadas; descarga de informes bloqueada por el proxy**           |
| 6    | Spotify Ads                              | **OAuth real validado; Ads API aún responde 403 (`ACCESS_REQUIRED`) tras aceptar términos**           |
| 7    | X Ads                                    | **API 12 y fixtures listos; credenciales aplicadas, Ads API bloqueada por habilitación de app (403)** |

La Fase 1 ya incluye piezas que las integraciones van a usar: fórmulas normalizadas (CTR, CPC, CPM,
CPA sin NaN ni Infinity), reintentos con espera exponencial y variación (respetan `Retry-After`),
circuit breaker (CLOSED / OPEN / HALF_OPEN), timeouts por proveedor y consulta en paralelo donde un
proveedor que falla no tumba la respuesta.

La auditoría del 1 de octubre de 2026 (hallazgos, correcciones, matriz de validación y pendientes) está
en [docs/AUDITORIA.md](docs/AUDITORIA.md).

`/api/v1/budgets` devuelve la configuración actual (no gasto): presupuesto diario o total, si vive en
la campaña o en el conjunto, presupuestos compartidos (con su ID, para contarlos una vez), si Google
reporta la campaña limitada por presupuesto y su recomendación. Los totales llevan un diario estimado
con su método en `raw_metrics.estimate_method`. Spotify y X aún no la ofrecen.

`/api/v1/delivery-health` devuelve señales que la plataforma reporta hoy, con severidad `critical`,
`warning` o `info`: estado y tope de gasto de la cuenta (Meta), campañas o conjuntos con problemas de
entrega o de políticas, limitadas por presupuesto o puja, en aprendizaje o con aprendizaje limitado
(Meta y Google), y campañas pausadas por presupuesto o suspendidas (Microsoft). TikTok queda fuera
porque su SDK oficial no publica los valores de estado.

## Endpoints

| Método | Ruta                                  | Llave | Descripción                                                                            |
| ------ | ------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`                      | No    | Salud del servicio (Cloud Run, Docker, n8n)                                            |
| GET    | `/api/v1/providers`                   | Sí    | Los seis proveedores y su estado                                                       |
| GET    | `/api/v1/providers/{provider}/status` | Sí    | Estado de un proveedor (`google`, `meta`, `tiktok`, `microsoft`, `spotify`, `x`)       |
| GET    | `/api/v1/accounts`                    | Sí    | Cuentas y MCC; filtros `provider`, `client_id`                                         |
| GET    | `/api/v1/campaigns`                   | Sí    | Campañas; agrega filtro `account_id`                                                   |
| GET    | `/api/v1/performance`                 | Sí    | Rendimiento; `date_from`, `date_to`, `granularity` (`daily` o `hourly`), `campaign_id` |
| GET    | `/api/v1/conversions`                 | Sí    | Conversiones por acción con los mismos filtros de rendimiento                          |
| GET    | `/api/v1/budgets`                     | Sí    | Presupuestos vigentes de campañas activas (Meta, Google, TikTok y Microsoft)           |
| GET    | `/api/v1/delivery-health`             | Sí    | Salud de entrega que reporta la plataforma (Meta, Google y Microsoft)                  |
| GET    | `/docs`                               | No    | Documentación Swagger (OpenAPI 3); `/docs/json` es la especificación                   |

Estados de un proveedor: `connected`, `degraded`, `not_configured`, `not_implemented`,
`access_required`, `permission_denied`, `error`. Credenciales vencidas o revocadas quedan en `error`
con `last_error.code = AUTH_ERROR` (hay que reautorizar); `permission_denied` es solo un acceso negado.

Sin `provider`, las rutas de datos consultan únicamente las integraciones listas y configuradas; las
pendientes no aparecen como error en cada respuesta (su estado está en `/api/v1/providers`). Cada
proveedor tiene su propio límite de tiempo (`<PROVEEDOR>_TIMEOUT_MS`, por omisión
`PROVIDER_TIMEOUT_MS`), que la ruta respeta; Microsoft usa 120 s por omisión.

### Conversiones: vocabulario común y solapamientos

`normalized_conversion` usa el mismo vocabulario en mayúsculas en todas las plataformas: `PURCHASE`,
`LEAD`, `CALL`, `CONTACT`, `REGISTRATION`, `ORDER`, `ADD_TO_CART`, `BEGIN_CHECKOUT`, `VIEW_CONTENT`,
`PAGE_VIEW` (más las etiquetas que definas en los mapeos). Cuando una plataforma reporta el mismo evento
bajo varios tipos que se solapan (Meta: `omni_purchase`, `purchase`, pixel…), solo uno lleva la
categoría por omisión, así que sumar por categoría no duplica. Qué evento cuenta como venta para cada
cliente es una decisión de negocio que se fija con los mapeos y la acción principal de cada proveedor.

### Refresh tokens rotativos

Microsoft rota el refresh token en cada renovación (Spotify a veces). Configura `TOKEN_STORE_FILE`
(por ejemplo `.env.tokens`, ignorado por Git) para conservar el nuevo en un archivo privado 0600; al
arrancar, ese valor gana sobre `.env` y el panel. Sin él, el servicio avisa en el log (sin el valor) y,
tras reiniciar, vuelve al token original, que Microsoft invalida 90 días después de emitirlo. En un
contenedor sin disco persistente monta un volumen o usa el gestor de secretos de la nube.

### Autenticación

Encabezado `X-API-Key` en todas las rutas salvo salud y documentación. Las llaves se configuran en
`API_KEYS` (separadas por coma), en texto o como huella `sha256:<hex>`; la comparación es en tiempo
constante y nunca se escriben en los logs.

### Errores

Todas las respuestas de error tienen la misma forma:

```json
{ "error": { "code": "AUTH_ERROR", "message": "…", "details": {}, "request_id": "…" } }
```

| Código             | HTTP      | Cuándo                                                         |
| ------------------ | --------- | -------------------------------------------------------------- |
| `AUTH_ERROR`       | 401       | Falta la llave o no es válida                                  |
| `ACCESS_DENIED`    | 403       | Sin permiso para la operación                                  |
| `RATE_LIMITED`     | 429       | Límite de solicitudes (incluye `Retry-After`)                  |
| `NOT_CONFIGURED`   | 503       | Proveedor sin credenciales o sin integración todavía           |
| `ACCESS_REQUIRED`  | 403       | La plataforma pide aprobación o nivel de acceso                |
| `PROVIDER_ERROR`   | 502       | La plataforma respondió con error (o su circuito está abierto) |
| `PROVIDER_TIMEOUT` | 504       | La plataforma no respondió a tiempo                            |
| `INVALID_REQUEST`  | 400 / 404 | Parámetros inválidos o ruta inexistente                        |
| `UNKNOWN`          | 500       | Error inesperado (el detalle solo queda en el log)             |

Cada respuesta lleva `X-Request-Id` (se respeta el que envíe n8n si es válido) y los logs son JSON
estructurados con `request_id`.

## Google Ads (Fase 2)

Lee cuentas, jerarquías MCC, campañas, rendimiento diario/horario y conversiones mediante REST y
GAQL. OAuth con refresh token o cuenta de servicio; token cacheado con vencimiento y renovación
única después de un 401; paginación, reintentos transitorios, cancelación y circuit breaker.
No contiene endpoints de escritura de campañas.

La versión predeterminada es **v25**, verificada contra los contratos oficiales de Google. También
se admite v24 con developer token legacy. Los permisos del proyecto Cloud y la identidad OAuth
deben permitir consultar las cuentas; configurar variables no demuestra acceso real.

Configura `.env` usando `.env.example`. Para autorizar desde tu computadora:

```bash
npm run google:auth
```

El asistente usa un callback HTTP en `127.0.0.1`, estado aleatorio y PKCE; guarda el refresh token en
`.env` con permisos `0600` y no lo imprime. Debes registrar el callback en Google Cloud y autorizar
en el navegador. No hay credenciales reales incluidas en el proyecto.

Consulta [docs/GOOGLE_ADS.md](docs/GOOGLE_ADS.md) para configuración, ejemplos, semántica de métricas,
fuentes oficiales y comprobación de la conexión real.

Las rutas de datos responden `{ data, errors, request_id }`. Con `provider=google`, el error devuelve
su HTTP estándar. Las cuentas inhabilitadas no bloquean las demás: cuando se conserva una lectura
parcial, sus avisos aparecen en `errors`, también con proveedor explícito. Solicitar expresamente
una cuenta inhabilitada sigue devolviendo el error. Sin `provider`, se consultan los proveedores en paralelo y los fallos se incluyen
en `errors` conservando los datos de los demás. HTTP 200 en una consulta agregada no implica que
todos los proveedores funcionen: revisa `errors`.

La validación real del 30 de septiembre de 2026 comprobó cuentas y jerarquías MCC, campañas,
rendimiento y conversiones diarios y horarios. Para jerarquías grandes, dirige las consultas de
datos con `account_id` o un `client_id` previamente mapeado; la lectura de todas las cuentas
publicitarias está sujeta al timeout y a las cuotas de Google.

## Meta Marketing API (Fase 3)

Lee cuentas, campañas, rendimiento diario/horario y conversiones con **v26.0**. Incluye token Bearer,
proof opcional, paginación segura, reintentos transitorios y respuestas parciales por permisos de cuenta.
El token necesita `ads_read` y acceso a las cuentas. La validación real del 30 de septiembre de 2026
comprobó 17 cuentas activas y una muestra de campañas, rendimiento diario/horario y conversiones.
Los datos del negocio propietario son opcionales (`META_INCLUDE_BUSINESS_METADATA=true`) porque
el campo `business` requiere `business_management`; la consulta básica funciona con `ads_read`.

Configura `META_ACCESS_TOKEN` en las variables privadas del entorno; para usuarios del sistema puedes
fijar `META_AD_ACCOUNT_IDS`. Para conversiones y CPA en rendimiento elige una acción exacta mediante
`META_PRIMARY_CONVERSION_ACTION` o el mapeo por cuenta. No se suman alias que pueden duplicar eventos.
Si la acción principal no aparece en un día, ese día tuvo 0 (Meta solo lista acciones ocurridas) y
`raw_metrics.primary_action_present=false` ayuda a detectar una acción mal elegida.

Meta limita las conversiones externas por hora y no ofrece alcance/frecuencia con ese desglose.
Se conservan métricas `null` y avisos en `errors`; usa datos diarios para comparar esas cifras.
La fase no incluye reportes asíncronos de grandes extracciones ni escrituras de campañas.
Consulta [docs/META_ADS.md](docs/META_ADS.md) para el flujo desde el navegador, variables, semántica
completa, errores y fuentes oficiales.

## TikTok Ads (Fase 4)

Lee cuentas autorizadas, campañas y reportes diarios/horarios mediante el contrato **GET v1.3**
publicado en el SDK oficial. Incluye paginación, cancelación, reintentos transitorios y división
automática en bloques de hasta 30 días para datos diarios y un día para datos por hora.
Preserva los IDs de 64 bits como texto, las monedas y la zona horaria de cada cuenta.

Configura `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` y `TIKTOK_ACCESS_TOKEN` en las variables privadas del
entorno. Con cuentas explícitas en `TIKTOK_ADVERTISER_IDS`, basta el token para consultar datos.
El CPA usa una sola métrica: por defecto `conversion`, el evento de optimización elegido en TikTok.
Puedes cambiarla globalmente o por cuenta; no se suman métricas de conversiones superpuestas.

La fase está comprobada con un simulador local y con una lectura real del 27 al 29 de septiembre
de 2026: **cuatro cuentas, 178 campañas, 76 filas diarias y 608 filas de conversiones**.
izzi ABCW US no devolvió filas para ese periodo; no se fabrican ceros. Todas las cuentas reportan
`Etc/GMT+6` (UTC−06:00); Sky Sports tiene `America/Chicago` como zona de visualización.
Los [totales diarios y sus límites](docs/TIKTOK_PRIMERA_LECTURA.md) están listos para conciliar,
pero la comparación con Ads Manager y el significado de `total_complete_payment_rate` siguen pendientes.
Consulta [docs/TIKTOK_ADS.md](docs/TIKTOK_ADS.md) para el flujo desde el navegador, fuentes oficiales,
semántica de métricas y límites. El contrato v2.0 y los reportes asíncronos quedan fuera de esta fase.

Cuentas solicitadas para la primera lectura: Sky México `7338571937913978882`, Sky Sports MXN
`7545502925565771792`, izzi - ABCW `7361545670072909840` e izzi ABCW US `7688066712031182866`.
Guarda esos IDs como texto en `TIKTOK_ADVERTISER_IDS`. El token y la lista son suficientes para
reporting. App ID/Secret sirven para discovery y para `npm run tiktok:auth`, no sustituyen al token.

## Microsoft Advertising (Fase 5)

Lee cuentas, campañas de todos los tipos actuales e informes diarios/horarios de rendimiento y
conversiones con **REST v13**. Incluye OAuth con renovación del token, paginación, reintentos,
cancelación y generación/polling/descarga de informes ZIP/CSV. Microsoft entrega los informes en
**UTC** según la documentación consultada por Codex; cada fila lo identifica en `source_timezone` y
conserva la moneda original. Pendiente de conciliar contra la interfaz de Microsoft con datos reales
(ver docs/AUDITORIA.md): si las filas vinieran en la zona de la cuenta, los días se desplazarían.

El CPA usa `ConversionsQualified`, que incluye los objetivos habilitados para puja. Las conversiones
totales y secundarias se conservan por objetivo en `raw_metrics`. Un informe aún pendiente no se
interpreta como actividad cero. Para datos actuales se emite un aviso de posible procesamiento
pendiente; puedes exigir datos completos con `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`.

La conexión real requiere las cuatro variables privadas `MICROSOFT_ADS_*` indicadas en
[docs/MICROSOFT_ADS.md](docs/MICROSOFT_ADS.md). El asistente `npm run microsoft:auth -- --start` permite
autorizar desde el navegador, usando PKCE y un callback manual; el token se guarda en `.env` privado.
Los informes pueden tardar minutos: Microsoft usa 120 s por omisión y `MICROSOFT_ADS_TIMEOUT_MS`
(hasta `300000`) ajusta solo a este proveedor. Configura `TOKEN_STORE_FILE` para conservar el refresh
token que Microsoft rota en cada renovación. La autorización real, cuatro cuentas y 43 campañas se verificaron. El proxy del entorno
rechaza con HTTP 403 la descarga desde `bingadsappsstorageprod.blob.core.windows.net`, aunque la
API sí genera el informe. Los datos de los ZIP/CSV reales siguen sin validarse; el simulador cubre
su lectura y normalización.

## Spotify Ads (Fase 6)

Consulta negocios, cuentas, campañas e informes agregados de **Spotify Ads API v3** en los endpoints
existentes con `provider=spotify`. Usa autorización de usuario y renovación OAuth con Client ID y
Client Secret; incluye un asistente para completar la autorización desde el navegador sin instalar
el proyecto en tu computadora. Consulta [docs/SPOTIFY_ADS.md](docs/SPOTIFY_ADS.md).

Los informes son JSON, en UTC, con importes en la moneda original. Los rangos diarios se dividen
en bloques de 90 días; los horarios solo admiten las últimas dos semanas. El CPA requiere elegir
explícitamente un evento principal. Los cuartiles incluyen audio y video, y los ingresos combinan
compras y leads: se conservan en `raw_metrics` sin atribuirlos a métricas incompatibles.

Las pruebas usan un simulador que nunca llama a Spotify. OAuth real ya se completó y su refresh
token está guardado de forma privada. El usuario confirmó haber aceptado los términos, pero la última
consulta seguía devolviendo HTTP 403 (`ACCESS_REQUIRED`); la habilitación puede tardar. La lectura
de cuentas, campañas e informes sigue sin validarse con datos reales.
La fase incluye lecturas;
los cambios de campañas y los informes asíncronos CSV quedan fuera de su alcance.

## Desarrollo

```bash
cp .env.example .env        # define al menos API_KEYS
npm install
npm run dev                 # http://localhost:8080/docs
```

Comprobaciones (las mismas que correrá CI):

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Primera lectura real (con las credenciales de tu `.env`, solo lectura):

```bash
npm run verificar                                   # ayer, todas las plataformas configuradas
npm run verificar -- --fecha 2026-09-30 --plataformas meta,google
```

Recorre estado, cuentas, campañas, presupuestos, salud de entrega y rendimiento de un día, y deja en
`reportes/` (fuera de git) un Excel con conteos, códigos de error y totales por cuenta y moneda para
conciliar contra cada interfaz. No guarda tokens, cabeceras ni respuestas crudas. Si una plataforma
rota su refresh token durante la lectura, el nuevo se guarda en `.env` (0600).

## Docker

```bash
docker build -t unified-ads-api .
docker run -p 8080:8080 -e API_KEYS="sha256:<huella>" unified-ads-api
```

La imagen corre como usuario sin privilegios (`node`), escucha en `PORT` (8080 por omisión, como
espera Cloud Run) e incluye `HEALTHCHECK` contra `/api/v1/health`.

## Estructura

```
src/
  config/          variables de entorno validadas (zod)
  types/           enum de proveedores y modelo normalizado
  providers/       contrato AdsProvider, base común, un módulo por plataforma y el registro
  normalization/   fórmulas (CTR, CPC, CPM, CPA, micros → moneda)
  routes/          rutas /api/v1 con esquemas zod → OpenAPI
  services/        estado de proveedores en paralelo
  repositories/    contrato de almacenamiento histórico (BigQuery, fase posterior)
  middleware/      request_id, X-API-Key, manejador global de errores
  utils/           errores estándar, logger, llaves, reintentos, circuit breaker, timeout
```

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## X Ads (Fase 7)

Implementa **Ads API 12** con OAuth 1.0a de usuario, cuentas, campañas, métricas diarias/horarias,
conversiones web y reportes asíncronos para rangos largos. Comparte interfaz, timeout propio,
estados y vocabulario de conversiones. El panel de monitoreo lo muestra como el resto.
Configura los cuatro valores privados `X_ADS_CONSUMER_KEY`, `X_ADS_CONSUMER_SECRET`,
`X_ADS_ACCESS_TOKEN`, `X_ADS_ACCESS_TOKEN_SECRET`. No se elige un evento principal automáticamente.
Consulta [docs/X_ADS.md](docs/X_ADS.md) para versión, fuentes, permisos y límites comprobados.
Las pruebas no salen a red. La app ya existe y sus cuatro variables privadas llegaron al proceso;
la primera petición real devuelve HTTP 403 `UNAUTHORIZED_CLIENT_APPLICATION`, normalizado como
`ACCESS_REQUIRED`. El usuario envió la solicitud de acceso el 1 de octubre de 2026 y el formulario
confirmó recepción. Falta la aprobación/permisos de Ads API, seguida de lectura y conciliación real.
La guía incluye el formulario oficial y la renovación del par de tokens de usuario tras la aprobación.

## Continuación para auditoría de Claude

El [traspaso actualizado a Claude](docs/TRASPASO_CLAUDE.md) reúne la rama entregada, commits,
evidencias reales, validación, reglas vigentes y trabajo que puede avanzar sin accesos nuevos.

La rama `codex/continuacion-tiktok-x` parte de `1bf278f` y conserva las correcciones previas.
Meta divide reportes diarios en bloques de 30 días y horarios en un día. Google consulta hasta
cuatro cuentas a la vez y decodifica ceros escalares seleccionados sin fabricar filas.
Spotify mantiene el día final inclusivo, confirmado contra la referencia oficial v3.
Microsoft solo descarga de `bingadsappsstorageprod.blob.core.windows.net`: otros destinos se
rechazan hasta revisar una migración del proveedor. No se elude el bloqueo del proxy.
Los riesgos y pendientes separados por código, permisos, configuración y negocio están en
[docs/AUDITORIA.md](docs/AUDITORIA.md). La conciliación de plataformas sigue pendiente.
