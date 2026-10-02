# Spotify Ads API — Fase 6

Integración de lectura con **Ads API v3**, verificada contra su contrato oficial el 1 de octubre
de 2026. Usa `https://api-partner.spotify.com/ads/v3`, independiente de la API de música de Spotify.
La autorización OAuth real se completó y su refresh token está guardado de forma privada.
La lectura del 1–2 de octubre de 2026 comprobó **seis cuentas, 14 campañas accesibles y tres
filas diarias reales** del 29 de septiembre. Una cuenta USD conserva `ACCESS_DENIED` al leer
campañas e informes; no se confunde esa denegación con habilitación global de Ads API.
Falta conciliar contra Ads Manager. `normalized_conversion` usa el vocabulario común en mayúsculas (`LEAD`,
`PURCHASE`, `REGISTRATION`, `PAGE_VIEW`, `ADD_TO_CART`, `BEGIN_CHECKOUT`, `VIEW_CONTENT`). Spotify
puede rotar el refresh token: configura `TOKEN_STORE_FILE` para conservarlo. Las pruebas locales usan respuestas simuladas y nunca hacen
peticiones a Spotify.

## Crear la aplicación y habilitar acceso

1. En [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), crea una aplicación.
   Nombre sugerido: `Unified Ads Monitoring`. Descripción:
   `Internal monitoring service for authorized Spotify Ads Manager accounts, campaigns, performance and conversion reports.`
2. Selecciona **Ads API**. Registra exactamente
   `http://127.0.0.1:8089/oauth/spotify/callback`. Spotify permite HTTP para la IP de loopback;
   `localhost` no está permitido. El campo Website puede dejarse vacío.
3. En los ajustes de la app, obtén el Client ID y el Client Secret. Guarda ambos exclusivamente en
   las variables privadas `SPOTIFY_ADS_CLIENT_ID` y `SPOTIFY_ADS_CLIENT_SECRET` del entorno. Guarda
   con Done y publica la configuración para que lleguen a la sesión de trabajo.
4. Acepta los [términos de Ads API](https://adsmanager.spotify.com/api-terms) con el Client ID de la
   app. Spotify indica que la habilitación puede tardar **hasta una hora**. La cuenta de Spotify
   que autoriza debe tener acceso a la cuenta publicitaria de Ads Manager.

No se utiliza una API key ni el flujo Client Credentials de música. Las credenciales de app por
sí solas no autorizan el acceso a las cuentas publicitarias.

## Autorizar trabajando solo desde el navegador

El asistente se ejecuta en el entorno en la nube, desde `/workspace/orueba/unified-ads-api`:

```bash
npm run spotify:auth -- --start
```

Abre en tu navegador la URL de autorización que genera el asistente. Inicia sesión con el usuario
que tiene acceso a Spotify Ads Manager y autoriza. El navegador volverá a la IP de loopback y puede
mostrar un error de conexión: no hay un servidor en tu computadora. Copia la **URL completa de la
barra de direcciones**, incluyendo `code` y `state`, a la variable privada
`SPOTIFY_ADS_AUTH_CALLBACK_URL`. No la pegues en el chat. Guarda y aplica la configuración.
El agente ejecuta después:

```bash
npm run spotify:auth -- --complete
```

La sesión del asistente dura treinta minutos desde que genera el enlace. El código de Spotify
vence diez minutos después de autorizar, y Spotify comprueba esa vigencia al canjearlo. Si vencen,
usa `--cancel` y después `--start` para generar una autorización nueva; no reutilices el callback anterior. El archivo
`.spotify-oauth-session` debe conservarse durante la publicación. No se necesita una web pública
para este flujo de desarrollo. Una integración desplegada requerirá su propio callback HTTPS.

La autorización usa `https://accounts.spotify.com/authorize`, código de autorización, estado
aleatorio y el secreto del cliente confidencial. El intercambio y la renovación se realizan en
`https://accounts.spotify.com/api/token` con autenticación HTTP Basic. El flujo oficial de Ads
no solicita permisos de música. Nunca se siguen redirecciones con credenciales.

El asistente guarda únicamente `SPOTIFY_ADS_REFRESH_TOKEN` en `.env` privado (permisos 0600),
preservando el token de Microsoft y las demás variables. No muestra los tokens. Reinicia el
servicio que hayas iniciado para cargarlo; las credenciales se leen al construir el proveedor.
El archivo está excluido de Git. Si una variable del proceso ya tiene un valor vacío u obsoleto,
puede ocultar el de `.env`: corrige ese binding privado. No se sincroniza automáticamente el
token generado al almacén de variables del panel; una tarea con otro checkout necesita ese binding
privado o repetir la autorización. La publicación conserva los archivos del snapshot, no procesos.

## Configuración

| Variable                                 | Uso                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `SPOTIFY_ADS_CLIENT_ID`                  | Client ID de la aplicación con Ads API habilitada.                         |
| `SPOTIFY_ADS_CLIENT_SECRET`              | Secreto de esa misma aplicación; privado.                                  |
| `SPOTIFY_ADS_REFRESH_TOKEN`              | Autorización del usuario, generada por el asistente; privada.              |
| `SPOTIFY_ADS_AUTH_CALLBACK_URL`          | Retorno temporal completo, privado, solo para el asistente.                |
| `SPOTIFY_ADS_API_VERSION`                | Opcional; solo admite `v3`.                                                |
| `SPOTIFY_ADS_REDIRECT_URI`               | Opcional para el asistente; debe coincidir con el registro de la app.      |
| `SPOTIFY_ADS_ACCOUNT_IDS`                | UUIDs separados por comas; evita descubrir negocios.                       |
| `SPOTIFY_ADS_BUSINESS_IDS`               | UUIDs separados por comas; consulta sus cuentas.                           |
| `SPOTIFY_ADS_CLIENT_MAPPING`             | JSON de UUID de cuenta → cliente interno.                                  |
| `SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC`  | Evento principal global; por ejemplo `PURCHASES` o `LEADS`.                |
| `SPOTIFY_ADS_PRIMARY_CONVERSION_MAPPING` | JSON de UUID de cuenta → evento; tiene prioridad sobre el global.          |
| `SPOTIFY_ADS_CONVERSION_MAPPING`         | JSON de evento de Spotify → categoría interna.                             |
| `SPOTIFY_ADS_TIMEOUT_MS`                 | Tiempo total de consulta; 1000–300000 ms. Hereda el timeout del proveedor. |
| `SPOTIFY_ADS_RETRIES`                    | Reintentos transitorios; 0–5, por defecto 2.                               |

No se declara un refresh token vacío en el panel mientras el asistente lo genera. Las
configuraciones inválidas muestran solo los nombres de las variables, nunca sus valores.

## Rutas y contrato

Usa los endpoints existentes con `provider=spotify` y `x-api-key`. Los filtros de cuenta y
campaña son UUIDs; `client_id` es la asociación interna configurada. Ejemplo de ruta:

```text
/api/v1/performance?provider=spotify&date_from=2026-09-01&date_to=2026-09-29&granularity=daily
```

| Operación             | Endpoint de Spotify                                  |
| --------------------- | ---------------------------------------------------- |
| Negocios autorizados  | `GET /businesses`                                    |
| Cuentas de un negocio | `GET /businesses/{business_id}/ad_accounts`          |
| Cuenta explícita      | `GET /ad_accounts/{ad_account_id}`                   |
| Campañas              | `GET /ad_accounts/{ad_account_id}/campaigns`         |
| Rendimiento y eventos | `GET /ad_accounts/{ad_account_id}/aggregate_reports` |

Las campañas se paginan con `offset` y `limit=50`, ordenadas por ID. Los informes solicitan
`entity_type=CAMPAIGN`, campos repetidos `fields`, granularidad `DAY` o `HOUR` y fechas UTC.
DAY/HOUR requieren `entity_ids` explícitos. La consulta sin una campaña seleccionada descubre
el catálogo y solicita lotes de hasta **50 IDs**, validando cada respuesta contra su lote.
Una cuenta sin campañas devuelve vacío sin enviar un informe sin alcance; un catálogo que falla
no se interpreta como vacío.
Después de recibir `continuation_token`, la siguiente petición lleva **solo ese token**.
Se rechazan continuaciones, campañas o periodos repetidos, totales inconsistentes, dimensiones
incorrectas, valores no numéricos y respuestas que exceden los límites establecidos.

Los intervalos diarios incluyen la fecha final y se dividen en bloques de hasta 90 días sin
solaparse. Para un día horario completo, los límites son 00:00 y 23:00 UTC, ambas horas incluidas.
La retención horaria es de dos semanas; un día cuyo inicio ya salió de esa ventana se rechaza.
La API unificada admite hasta 366 días diarios y rechaza fechas futuras. La zona de la cuenta no
se inventa: `timezone=null`; los informes identifican `source_timezone="UTC"`.

## Semántica de métricas

- `SPEND` ya está expresado en unidades de la moneda de la cuenta, **no micros**. CTR, CPC, CPM y
  CPA se calculan con los mismos criterios del modelo unificado.
- El CPA solo usa el evento principal elegido explícitamente. Sin esa elección, `conversions`
  y `cpa` son `null` y se emite `primary_conversion_not_configured`. No se suman compras, leads,
  acciones personalizadas ni conversiones de oyentes.
- `VIDEO_VIEWS` conserva la métrica reportada por Spotify. `FIRST_QUARTILES`, `MIDPOINTS`,
  `THIRD_QUARTILES` y `COMPLETES` incluyen **audio y video**: permanecen en `raw_metrics`, mientras
  `video_25`, `video_50`, `video_75` y `video_100` quedan `null`.
- Eventos de conversión: `PAGE_VIEWS`, `LEADS`, `ADD_TO_CART`, `PURCHASES`, `START_CHECKOUT`,
  `PRODUCTS`, `SIGN_UPS`, `CUSTOM_EVENT_1` a `CUSTOM_EVENT_5`. Cada evento informado produce su
  propia fila. Los eventos ausentes no producen ceros inventados; cero real y `null` se preservan.
- `REVENUE` combina ingresos atribuidos a compras y leads. Se conserva en `raw_metrics`, se
  emite `revenue_not_split_by_event` y `conversion_value` queda `null`. No se duplica ese importe
  entre eventos ni se atribuye automáticamente al principal.
- Spotify documenta el sentinel `-5` para conteos de conversiones entre 1 y 4: se conservan como
  desconocidos, con `censored_conversion_fields` y `privacy_suppression_source_value`, sin
  sustituirlos por cero, cinco o el punto medio. Si afecta al evento principal, CPA permanece `null`.
  La muestra real también devolvió `REVENUE=-5`; ese importe se guarda como desconocido con
  `unavailable_revenue_source_value` y aviso `revenue_unavailable`. No se atribuye a ese importe
  el intervalo documentado para conteos. Otros negativos incompatibles, incluido gasto negativo,
  siguen produciendo error.
- La respuesta normalizada de cuentas excluye datos de facturación, impuestos y otros metadatos
  que no forman parte del modelo unificado.

Las advertencias se incluyen en la envoltura existente. Las denegaciones de cuentas individuales
permiten resultados parciales de otras cuentas; una cuenta explícitamente solicitada o el fallo
de todas las cuentas produce error. No se silencian fallos de autenticación, términos ni informes
inválidos. Una respuesta vacía válida se conserva vacía sin crear métricas.

## Errores y comprobaciones

`401` provoca una sola renovación y repetición de la petición. `403` de términos o habilitación
se informa como `ACCESS_REQUIRED`; los demás permisos como `ACCESS_DENIED`. `429` respeta
`Retry-After` o `X-RateLimit-Reset` (segundos restantes). Solo se reintentan límites, fallos 5xx y
errores de transporte; se incluyen timeout, cancelación y circuit breaker. Los mensajes libres
y trazas de Spotify nunca se propagan a las respuestas públicas.

```bash
npm run typecheck
npm test -- tests/spotify.test.ts tests/spotify-oauth.test.ts tests/providers.test.ts
npm run build
```

El simulador verifica autenticación Basic/Bearer, destinos y métodos, renovación, paginación,
errores, límites temporales, normalización y rutas. La comprobación real requiere `/status`,
cuentas, campañas y consultas de informes con el usuario autorizado; solo un intercambio de
tokens no demuestra acceso a Ads API.

## Fuentes oficiales

- [Ads API](https://developer.spotify.com/documentation/ads-api)
- [Quickstart y autorización](https://developer.spotify.com/documentation/ads-api/quick-start)
- [Guías y versiones](https://developer.spotify.com/documentation/ads-api/guides)
- [Negocios](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getBusinesses)
- [Cuentas](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getAdAccountsInBusiness)
- [Campañas](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getCampaigns)
- [Informes agregados y métricas](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getAggregateReport)
- [Requisitos de redirección](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

## Confirmación del final inclusivo (1 de octubre de 2026)

La [referencia oficial v3 de Aggregate Report](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getAggregateReport)
indica en `report_end` que DAY/LIFETIME incluyen **el día completo** de la fecha final;
HOUR incluye la hora final. Se mantiene `T00:00:00Z` del último día en reportes diarios,
y `T23:00:00Z` en horarios. La prueba de bloques de 90 días en
`tests/continuation-risks.test.ts` verifica sus límites sin solapamiento.
Esto cierra la duda contractual; la conciliación con Ads Manager sigue pendiente.

## Muestra real y alcance (1–2 de octubre de 2026)

`npm run verificar -- --proveedores spotify --fecha 2026-09-29` encontró seis cuentas (dos USD,
cuatro MXN), 14 campañas legibles y tres filas de rendimiento en una cuenta MXN: **983.084134 MXN,
18.465 impresiones y 225 clics**, periodo UTC. Otras cuentas accesibles no devolvieron filas para
ese día. La cuenta USD `4bf9f073-8f04-4d76-8074-970f364c3e52` requiere revisar permisos del usuario
en Ads Manager para campañas e informes. Descubrirla no demuestra permiso sobre esas operaciones.
Salida 2 por cobertura parcial y valores desconocidos; Excel privado 0600 fuera de Git.
No se eligió evento principal ni se validó gasto, atribución o conversión contra la interfaz.

## Recuperación horaria comprobada — 2 de octubre de 2026 UTC

La cuenta izzi `f154306e-82ce-4c8b-a772-09140c1a24c6` devolvió HTTP 502 al pedir REVENUE
con HOUR. Consultas base, alcance/frecuencia y video funcionaron. La referencia v3 enumera
REVENUE y HOUR: no se generaliza este fallo observado como una incompatibilidad contractual.

Solo ante un HTTP 502 del informe horario con REVENUE se vuelve a pedir el mismo bloque
sin ese campo, desde la primera página. Páginas parciales se descartan. Se mantienen IDs,
fechas, granularidad, límites y señal de cancelación. Si la recuperación falla, la operación
falla; 401/403/429/500, errores de transporte y JSON inválido no se ocultan. La respuesta recuperada
incluye `revenue_unavailable` y `retry_without_revenue=true`; ingresos y valor de conversión
permanecen desconocidos. No se modifica la elección del evento principal ni los informes diarios.

API y sincronizador del monitoreo guardaron 30 filas UTC/MXN del 30/09 al 01/10.
[Preauditoría y evidencia](PREAUDITORIA_V1.md). Las horas ausentes no son ceros; conciliación pendiente.
