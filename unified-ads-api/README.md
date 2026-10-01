# Unified Ads API

API intermedia entre las plataformas publicitarias (Google Ads, Meta, TikTok, Microsoft Advertising,
Spotify y X) y los sistemas internos (n8n, BigQuery, dashboard, alertas y WhatsApp). Cada plataforma
se traduce a un **modelo normalizado** y el resto de los sistemas nunca necesita conocer cómo funciona
cada API: n8n solo pregunta a esta API.

## Estado

| Fase | Contenido                                | Estado                                                                                      |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | Infraestructura base (sin integraciones) | **Lista**                                                                                   |
| 2    | Google Ads                               | **Implementada y verificada con Google real y simulador**                                   |
| 3    | Meta Marketing API                       | **Implementada y verificada con Meta real y simulador**                                     |
| 4    | TikTok Ads                               | **Implementada y verificada con simulador; faltan credenciales reales**                     |
| 5    | Microsoft Advertising                    | **Autorización y campañas reales verificadas; descarga de informes bloqueada por el proxy** |
| 6    | Spotify Ads                              | **OAuth real validado; lectura bloqueada hasta aceptar términos de Ads API**                |
| 7    | X Ads                                    | Pendiente (puede requerir aprobación de acceso)                                             |

La Fase 1 ya incluye piezas que las integraciones van a usar: fórmulas normalizadas (CTR, CPC, CPM,
CPA sin NaN ni Infinity), reintentos con espera exponencial y variación (respetan `Retry-After`),
circuit breaker (CLOSED / OPEN / HALF_OPEN), timeouts por proveedor y consulta en paralelo donde un
proveedor que falla no tumba la respuesta.

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
| GET    | `/docs`                               | No    | Documentación Swagger (OpenAPI 3); `/docs/json` es la especificación                   |

Estados de un proveedor: `connected`, `degraded`, `not_configured`, `not_implemented`,
`access_required`, `permission_denied`, `error`.

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

La fase está comprobada con un simulador local. **La conexión real aún no se ha validado** porque
faltan las credenciales. El estado permanecerá en `not_configured` hasta configurarlas; una app
con credenciales necesita autorización de las cuentas y permisos de lectura/reporting.
Consulta [docs/TIKTOK_ADS.md](docs/TIKTOK_ADS.md) para el flujo desde el navegador, fuentes oficiales,
semántica de métricas y límites. El contrato v2.0 y los reportes asíncronos quedan fuera de esta fase.

## Microsoft Advertising (Fase 5)

Lee cuentas, campañas de todos los tipos actuales e informes diarios/horarios de rendimiento y
conversiones con **REST v13**. Incluye OAuth con renovación del token, paginación, reintentos,
cancelación y generación/polling/descarga de informes ZIP/CSV. Microsoft entrega los informes en
**UTC**; cada fila lo identifica en `source_timezone` y conserva la moneda original.

El CPA usa `ConversionsQualified`, que incluye los objetivos habilitados para puja. Las conversiones
totales y secundarias se conservan por objetivo en `raw_metrics`. Un informe aún pendiente no se
interpreta como actividad cero. Para datos actuales se emite un aviso de posible procesamiento
pendiente; puedes exigir datos completos con `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`.

La conexión real requiere las cuatro variables privadas `MICROSOFT_ADS_*` indicadas en
[docs/MICROSOFT_ADS.md](docs/MICROSOFT_ADS.md). El asistente `npm run microsoft:auth -- --start` permite
autorizar desde el navegador, usando PKCE y un callback manual; el token se guarda en `.env` privado.
Los informes pueden tardar minutos: configura `PROVIDER_TIMEOUT_MS=120000` o hasta `300000` cuando sea
necesario. La autorización real, cuatro cuentas y 43 campañas se verificaron. El proxy del entorno
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
token está guardado de forma privada. Ads API respondió HTTP 403 por términos pendientes; la lectura
de cuentas, campañas e informes sigue sin validarse. Acepta los términos con el Client ID de la app.
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
