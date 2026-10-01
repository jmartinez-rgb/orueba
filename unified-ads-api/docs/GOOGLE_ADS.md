# Google Ads · Fase 2

## Alcance y validación

Integración REST **de solo lectura**: estado de conexión, cuentas y jerarquías MCC, campañas,
rendimiento diario y horario, conversiones por acción, errores estándar, paginación, OAuth,
reintentos transitorios, cancelación y circuit breaker. La conexión con Google se verificó desde
Codex con cuentas reales; el servicio público sigue pendiente de despliegue.

Ajustes de la auditoría (1 de octubre de 2026):

- Sin `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, una cuenta cliente se consulta con la MCC accesible que la
  contiene (se toma de la jerarquía en caché), como exige Google para operar cuentas cliente.
- En consultas de varias cuentas no se piden métricas a cuentas canceladas, suspendidas o cerradas, y
  una cuenta sin permiso queda como advertencia en `errors` sin tumbar a las demás. Si se pide esa
  cuenta en específico, o ninguna responde, el error se devuelve.
- En errores de cuota se respeta `QuotaErrorDetails.retryDelay` cuando no llega `Retry-After`.
- La categoría `SIGNUP` se normaliza como `REGISTRATION` (vocabulario común), ya no como `LEAD`.

Las pruebas usan un simulador estricto de Google: ninguna requiere credenciales ni sale a Internet.
La aceptación real de las consultas GAQL se comprobó con una muestra de una cuenta activa.
Los permisos, las cuotas y los totales de otras cuentas requieren su propia comprobación.

## Validación real · 30 de septiembre de 2026

- OAuth renovó correctamente el token y Google devolvió 33 raíces accesibles.
- El endpoint de cuentas identificó 2274 cuentas en sus jerarquías, incluidas 55 MCC y
  2219 cuentas publicitarias. La lectura completa terminó en 10,62 segundos.
- Una cuenta inhabilitada produjo un aviso `CUSTOMER_NOT_ENABLED` en `errors`, mientras
  las demás cuentas conservaron sus datos. Las raíces ya obtenidas mediante un MCC se reutilizan,
  con hasta cuatro lecturas simultáneas para descubrir las restantes.
- En una cuenta con actividad, se leyeron 150 campañas, 59 filas de rendimiento diario y
  2038 filas de conversiones diarias para el 23–29 de septiembre. En un día con actividad
  del mismo período se comprobaron 158 filas de rendimiento horario y 1160 filas de
  conversiones horarias; ambas incluyeron la hora cero.
- Las lecturas usaron la moneda original de la cuenta (USD en la muestra), incluyeron gasto
  e impresiones reales y devolvieron HTTP 200. Salud y documentación también respondieron;
  las rutas rechazaron peticiones sin llave interna.
- Pasaron 98 pruebas con simulador, TypeScript, lint, compilación y formato.

Esta validación cubre una muestra de datos. La conciliación de totales con la interfaz de Google Ads
y la extracción de datos de todas las cuentas quedan fuera de esa comprobación. Para jerarquías
grandes, usa `account_id` o un `client_id` previamente mapeado en las rutas de campañas, rendimiento
y conversiones, respetando el timeout y las cuotas del nivel de acceso.

## Fuentes oficiales revisadas

Durante la implementación inicial, `developers.google.com` no era accesible desde este entorno.
Se revisaron directamente los repositorios oficiales, conservando versiones de referencia reproducibles:

- [googleapis/googleapis, commit 93d6085](https://github.com/googleapis/googleapis/tree/93d6085996d0b4ff7e7e86ca9945d5524bb380d1/google/ads/googleads/v25):
  servicios `GoogleAdsService` y `CustomerService`, `Metrics`, `Segments`, `CustomerClient`,
  errores y el alcance OAuth del archivo `googleads_v25.yaml`.
- [Cliente oficial Python, commit 48845cf](https://github.com/googleads/google-ads-python/tree/48845cfdb8c9d7ea96930a13d9a14c19286c35e8/google/ads/googleads):
  configuración e interceptor de metadatos, donde el developer token es opcional.
- Documentación de consulta:
  [autenticación REST](https://developers.google.com/google-ads/api/rest/auth),
  [GAQL](https://developers.google.com/google-ads/api/docs/query/overview),
  [OAuth](https://developers.google.com/google-ads/api/docs/oauth/overview),
  [OAuth para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server).
  Estos enlaces se incluyen para consulta.
- Durante la comprobación real se descargaron
  [niveles de acceso](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) y
  [errores de autorización v25](https://developers.google.com/google-ads/api/reference/rpc/v25/AuthorizationErrorEnum.AuthorizationError).
  Confirmaron que `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` requiere acceso Explorer, Basic
  o Standard. Desde la [descripción general de Google Ads API en Cloud](https://console.cloud.google.com/google/ads-apis/overview)
  se solicita Explorer en **Upgrade access level → Apply for access**. Tras habilitar ese acceso,
  las consultas de producción funcionaron.

Se usa v25 por defecto (la versión más alta publicada en ese snapshot) y se admite v24. `Search`
es POST a `/v25/customers/{customer_id}/googleAds:search`; `ListAccessibleCustomers` es GET a
`/v25/customers:listAccessibleCustomers`. Los resultados se leen en JSON camelCase.
No se envía `page_size`: su uso devuelve `PAGE_SIZE_NOT_SUPPORTED`. Se sigue `nextPageToken`
manteniendo exactamente la consulta y se rechazan tokens de página repetidos.

## Configuración

Desde `unified-ads-api/`, instala con `npm ci` y configura `.env` (ignorado por Git). La API interna
requiere `API_KEYS`; ninguna llave real se guarda en los fuentes. No compartas tokens por chat.

### OAuth con refresh token

- `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`.
- Alcance: `https://www.googleapis.com/auth/adwords`.
- El cliente OAuth y el proyecto Google Cloud necesitan acceso a la API; la cuenta de Google debe
  tener permisos sobre las cuentas publicitarias o el MCC. Para monitoreo basta acceso de lectura
  en Google Ads, aunque el alcance OAuth de Google no tiene variante de solo lectura.
- El token se obtiene en `https://oauth2.googleapis.com/token`, se cachea hasta 30 s antes de vencer
  y se deduplican renovaciones concurrentes. Un HTTP 401 permite una sola renovación adicional.

`npm run google:auth` ayuda a conseguir el refresh token desde **tu computadora**, donde está el
navegador. Primero configura el ID y secreto OAuth y registra el callback exacto:
`http://127.0.0.1:8089/oauth/google/callback` (o `GOOGLE_ADS_REDIRECT_URI`, siempre loopback).
El asistente imprime la URL de autorización; tras el consentimiento verifica `state`, intercambia
el código con PKCE y actualiza únicamente `GOOGLE_ADS_REFRESH_TOKEN` en `.env`, manteniendo las
demás variables. El archivo queda con permisos `0600`; no se imprimen tokens. Expira a los 5 min.
El callback es un servidor local separado, sin exponer una ruta OAuth pública en la API.

### Autorizar desde el navegador

Si no tienes el proyecto instalado en tu computadora, puedes obtener el refresh token con
[OAuth 2.0 Playground de Google](https://developers.google.com/oauthplayground):

1. En el cliente OAuth de tipo Aplicación web, añade como URI de redireccionamiento autorizada
   `https://developers.google.com/oauthplayground` y guarda los cambios. Debe coincidir exactamente,
   sin barra final. Puedes conservar el callback local para usar el asistente más adelante.
2. Abre Playground y, en el engranaje de configuración, marca **Use your own OAuth credentials**.
   Introduce allí el ID y el secreto de tu cliente; usar las credenciales propias es necesario
   para obtener un token destinado a este proyecto.
3. En **Step 1**, introduce `https://www.googleapis.com/auth/adwords`, pulsa **Authorize APIs**
   y autoriza con una cuenta que tenga acceso a Google Ads o al MCC. Si la aplicación es externa
   y está en pruebas, esa cuenta debe estar agregada como usuario de prueba.
4. En **Step 2**, pulsa **Exchange authorization code for tokens**. Guarda el **Refresh token**
   como `GOOGLE_ADS_REFRESH_TOKEN`, junto con `GOOGLE_ADS_CLIENT_ID` y
   `GOOGLE_ADS_CLIENT_SECRET`, en `.env` o en las variables privadas del entorno que ejecutará
   la API. No lo confundas con el access token temporal.

Playground permite completar la autorización en el navegador, pero no despliega ni ejecuta la API.
La conexión se verifica después con `/api/v1/providers/google/status`. Con una aplicación externa
en estado de prueba y este alcance, los refresh tokens normalmente vencen a los siete días;
para una conexión duradera hay que revisar el público y el estado de publicación de la aplicación.

### Cuenta de servicio (alternativa)

Configura **una** de `GOOGLE_ADS_SERVICE_ACCOUNT_JSON` (JSON completo) o
`GOOGLE_ADS_SERVICE_ACCOUNT_FILE` (archivo privado fuera de los fuentes). Requiere `client_email`
y `private_key`. La implementación genera un JWT RS256 con `iss`, `scope`, `aud`, `iat` y `exp`
para el intercambio OAuth. La cuenta de servicio debe tener acceso a Google Ads y al proyecto.
`GOOGLE_ADS_IMPERSONATED_USER` agrega `sub` únicamente cuando se ha autorizado delegación de
dominio; no se necesita para acceso directo de la cuenta de servicio.

### Acceso, cuentas y mapeos

| Variable                        | Uso                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GOOGLE_ADS_API_VERSION`        | `v25` por defecto; también `v24`                                                                       |
| `GOOGLE_ADS_DEVELOPER_TOKEN`    | Opcional en v25; obligatorio en el modo legacy v24. Se envía si existe                                 |
| `GOOGLE_ADS_CLOUD_PROJECT`      | Opcional: proyecto de cuota en `x-goog-user-project`; exige los permisos correspondientes              |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID`  | MCC usado en `login-customer-id`; ID de 10 dígitos con o sin guiones                                   |
| `GOOGLE_ADS_CUSTOMER_IDS`       | Raíces usadas para descubrimiento, separadas por coma; si falta se usa el MCC o las cuentas accesibles |
| `GOOGLE_ADS_CLIENT_MAPPING`     | JSON `{ "1234567890": "cliente-interno" }`; `client_id` filtra por este mapeo                          |
| `GOOGLE_ADS_CONVERSION_MAPPING` | JSON que asigna acción completa, ID, nombre o categoría a la categoría interna                         |
| `GOOGLE_ADS_TIMEOUT_MS`         | Tiempo máximo de la operación Google (15000 ms por defecto)                                            |
| `GOOGLE_ADS_RETRIES`            | Reintentos transitorios, 0–5 (2 por defecto)                                                           |

Los contratos v25 marcan los developer tokens como legacy y describen la aprobación de proyecto
Cloud (`CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`). Un proyecto sin aprobación devuelve
`ACCESS_REQUIRED`; un usuario sin permiso o un MCC incorrecto devuelve `ACCESS_DENIED`.
`ListAccessibleCustomers` no envía `login-customer-id`: devuelve las raíces accesibles de la
identidad OAuth. A partir de los MCC se consultan clientes directos e indirectos, se deduplican
cuentas y se conserva el contexto de login. Las cuentas MCC se incluyen con `is_manager=true`,
pero se excluyen de las consultas de campañas/rendimiento/conversiones.

`client_id` y las raíces configuradas son filtros operativos, **no aislamiento de seguridad entre
clientes**. Las llaves internas autorizan a la API completa; los permisos reales los aplica Google.

## Rutas

Todas requieren `X-API-Key`:

```text
GET /api/v1/providers/google/status
GET /api/v1/accounts?provider=google
GET /api/v1/campaigns?provider=google&account_id=1234567890
GET /api/v1/performance?provider=google&account_id=1234567890&date_from=2026-09-01&date_to=2026-09-02&granularity=hourly
GET /api/v1/conversions?provider=google&account_id=1234567890&date_from=2026-09-01&date_to=2026-09-02
```

`granularity` es `daily` por defecto; `hourly` conserva `segments.hour` (0 es una hora válida).
Fechas inclusivas, reales, ordenadas, hasta 366 días, en la zona horaria de la cuenta. Se permiten
`client_id` y, en rendimiento/conversiones, `campaign_id`. Los IDs Google se validan antes de
interpolarlos en GAQL. Sin cuenta se consultan las cuentas publicitarias descubiertas.

Sin `provider`, los proveedores se consultan en paralelo. La respuesta es
`{ data, errors, request_id }`; revisa `errors` aunque el HTTP sea 200. Con proveedor explícito, el
fallo conserva el código HTTP estándar (401, 403, 429, 502, 503 o 504). Esquemas OpenAPI en `/docs`.

Cuando Google identifica una cuenta inhabilitada con `CUSTOMER_NOT_ENABLED`, una lectura agregada
conserva las demás cuentas y devuelve el aviso, con su `account_id`, en `errors` (HTTP 200 también
con `provider=google`). Los avisos del descubrimiento se conservan al usar su caché. Pedir esa cuenta
explícitamente, o encontrar únicamente cuentas inhabilitadas, devuelve el error. Fallos de aprobación,
autenticación, consultas, cuotas o permisos diferentes siguen siendo fatales para el proveedor.

## Semántica de métricas

- `cost_micros / 1_000_000` produce `spend` en la moneda original; no se convierte USD a MXN.
- CTR, CPC, CPM y CPA se derivan de métricas base. Denominador cero o ausente produce `null`.
  Se conservan conversiones fraccionarias; valores no finitos o enteros imprecisos producen `null`.
- `reach`, `frequency` y `link_clicks` permanecen `null`: no se inventan equivalencias.
- `objective` es `null`: `advertising_channel_type` es el canal, no el objetivo comercial.
  Se conserva el canal en `raw_metrics` de rendimiento.
- v25 usa `metrics.video_trueview_views` para `video_views`. Los cuartiles se reportan como tasas:
  las tasas quedan en `raw_metrics` y los conteos normalizados `video_25`…`video_100` son `null`.
- Rendimiento usa `metrics.conversions` y `metrics.conversions_value` (acciones principales).
  Las conversiones por acción usan las mismas métricas y conservan además `all_conversions` y
  `all_conversions_value` en `raw_metrics`; no se suman principales y secundarias ni se mezclan
  costos en una consulta segmentada por acción.
- La acción original se conserva en `source_conversion` y su recurso/categoría en `raw_metrics`.
  Se puede sobrescribir la categoría normalizada por recurso, ID, nombre o categoría, en ese
  orden. Categorías oficiales conocidas tienen mapeo básico; las desconocidas son `null`.

## Comprobación de la conexión real

1. Configura credenciales, permisos de proyecto y el MCC o raíces, sin subir `.env` ni archivos
   privados. Para recolección se requieren destinos de red `oauth2.googleapis.com` y
   `googleads.googleapis.com`; para el asistente, también `accounts.google.com` en tu navegador.
2. Ejecuta `npm run build` y `npm start`, o `npm run dev`.
3. Consulta `/api/v1/providers/google/status` con tu llave: debe responder `state=connected`.
4. Consulta cuentas, una campaña conocida, rendimiento de un día cerrado y sus conversiones.
   Compara moneda, zona horaria, acciones y totales con Google Ads usando las mismas columnas.
5. No interpretes `not_configured`, una respuesta vacía o las pruebas del simulador como evidencia
   de conexión real. `last_successful_sync` solo cambia tras una lectura de datos exitosa, no tras
   un chequeo de estado.

Los reintentos respetan `Retry-After` y solo cubren fallos de red, 429 y fallos transitorios 5xx;
no reintentan permisos ni consultas inválidas. La API propaga cancelación al proveedor para
detener consultas y esperas al agotar `PROVIDER_TIMEOUT_MS`. Una renovación OAuth compartida tiene
su propio timeout: cancelar un caller no cancela la renovación que otros callers pueden necesitar.
Los errores retornan códigos y request IDs de Google, sin copiar tokens ni mensajes originales
potencialmente sensibles.
