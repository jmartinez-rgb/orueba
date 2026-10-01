# X Ads — fase 7

## Contrato comprobado antes de implementar

Revisado el **1 de octubre de 2026** en la documentación oficial. La tabla de versiones
publica **12.0**, ruta `/12`, como la versión más reciente, introducida el 27 de octubre de
2022, sin fecha publicada de retirada. El origen es `https://ads-api.x.com/12`.
No se confunde Ads API con X API v2.

También se revisó el SDK oficial Python `twitter-ads` **11.0.0**, publicado en PyPI y mantenido
en `twitterdev/twitter-python-ads-sdk`. Ese SDK todavía declara API 11 y el dominio anterior;
corrobora OAuth y estructuras de recursos, pero **no sustituye el contrato actual de API 12**.
No se instaló como dependencia del proyecto.

| Operación                 | Endpoint relativo a `/12`                       |
| ------------------------- | ----------------------------------------------- |
| Cuentas                   | `GET /accounts`, `GET /accounts/:account_id`    |
| Moneda de cuenta          | `GET /accounts/:account_id/funding_instruments` |
| Campañas                  | `GET /accounts/:account_id/campaigns`           |
| Estadísticas síncronas    | `GET /stats/accounts/:account_id`               |
| Crear y consultar informe | `POST` y `GET /stats/jobs/accounts/:account_id` |

Las listas usan `next_cursor` y solicitan `with_deleted=true`: una campaña eliminada puede
tener gasto histórico. Los IDs de entidades son cadenas alfanuméricas; los trabajos conservan
`id_str`, evitando pérdida de precisión de su ID numérico de 64 bits. Un cursor, entidad o
periodo repetido produce error; no se devuelve una lista incompleta como éxito.

## Autenticación y configuración

OAuth **1.0a de usuario**, HMAC-SHA1, no un Bearer token ni `client_credentials`.
La firma incluye los parámetros de consulta, nonce nuevo y timestamp. Se comprobó contra el
vector de RFC 5849 con la corrección verificada de su errata 2550, incluidos parámetros repetidos
y caracteres escapados.

Guarda los cuatro valores en las **variables privadas del entorno**, nunca en el chat o Git:

| Variable                           | Uso                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `X_ADS_CONSUMER_KEY`               | API key de la aplicación aprobada para Ads API                                       |
| `X_ADS_CONSUMER_SECRET`            | Secret de esa aplicación                                                             |
| `X_ADS_ACCESS_TOKEN`               | Access token OAuth 1.0a del usuario con acceso publicitario                          |
| `X_ADS_ACCESS_TOKEN_SECRET`        | Secret asociado a ese mismo access token                                             |
| `X_ADS_API_VERSION`                | `12`, única versión admitida                                                         |
| `X_ADS_ACCOUNT_IDS`                | Opcional, IDs separados por comas; omite discovery global                            |
| `X_ADS_CLIENT_MAPPING`             | JSON cuenta → cliente interno                                                        |
| `X_ADS_PRIMARY_CONVERSION_METRIC`  | Opcional, evento web principal; sin él conversiones y CPA quedan `null`              |
| `X_ADS_PRIMARY_CONVERSION_MAPPING` | JSON cuenta → evento web principal                                                   |
| `X_ADS_CONVERSION_MAPPING`         | JSON evento web → categoría del vocabulario compartido, en mayúsculas                |
| `X_ADS_CONVERSION_ATTRIBUTION`     | `post_engagement` por omisión, o `post_view`; se mantienen separados                 |
| `X_ADS_REPORT_MODE`                | `auto`, `sync` o `async`                                                             |
| `X_ADS_TIMEOUT_MS`                 | 1.000–300.000 ms; hereda el límite común; para informes largos se recomienda 120.000 |
| `X_ADS_RETRIES`                    | 0–5, predeterminado 2                                                                |

Para una conexión administrada por el propietario, el portal de desarrolladores proporciona
el par de tokens de usuario. No hace falta un intercambio de refresh token ni un asistente
local para consumir esas cuatro credenciales. Autorizar usuarios ajenos mediante OAuth de tres
pasos y persistir sus pares de tokens queda fuera de esta integración de credenciales existentes.
La app debe tener acceso a Campaign Management para listar cuentas y campañas, además de Analytics;
una autorización limitada a Analytics puede no permitir esas lecturas. El código no modifica anuncios.

## Informes y semántica

Se reporta a nivel **CAMPAIGN**, sin segmentaciones demográficas, en grupos separados:
`ENGAGEMENT,BILLING,VIDEO` y `WEB_CONVERSION`. Se agrupa por día u hora. La versión inicial cubre
eventos web; los eventos móviles, MACT y lifetime value quedan fuera del contrato implementado.

El rango del usuario es inclusivo; `end_time` de X es **exclusivo** y se envía la medianoche
del día siguiente. La cuenta proporciona la zona IANA. Según la guía oficial, se utiliza el
**offset del día actual**, incluso para fechas históricas. Se conserva ese offset en
`raw_metrics.report_utc_offset_minutes`; las etiquetas de hora siguen el día solicitado en
esa convención de reporting. Rangos anteriores o que atraviesan `timezone_switch_at` se rechazan
para evitar unir horas históricas con zonas distintas sin conciliación específica.

`auto` usa consultas síncronas hasta siete días y trabajos asíncronos para rangos mayores.
La extracción divide rangos en bloques de hasta 30 días y lotes de hasta 20 campañas.
Los trabajos se ejecutan y descargan secuencialmente, con polling acotado y un único límite
temporal para toda la consulta. Un trabajo fallido, pendiente al vencer el plazo, una descarga
inválida o entidades omitidas **no se convierten en cero actividad**.

Se solicitan las tres ubicaciones oficiales: `ALL_ON_TWITTER`, `SPOTLIGHT` y `TREND`.
Se suman sus conteos e importes y después se calcula CPA como costo / conversiones seleccionadas.
Nunca se promedian los CPA de ubicaciones, campañas o días. Alcance y frecuencia permanecen `null`.

`billed_charge_local_micro` se divide por un millón y conserva la moneda original de la campaña.
La cuenta obtiene moneda de sus instrumentos de financiación solo cuando es única; nunca se
inventa USD ni se unen monedas distintas. X indica que el costo puede revisarse durante tres días.
`clicks` incluye interacciones; `url_clicks` se conserva por separado en `link_clicks`.
Los cuartiles de video son conteos, no tasas. El objetivo comercial reside en los line items;
no se infiere del recurso de campaña y queda `null`.

La documentación de Analytics define los valores **explícitamente devueltos como `null`**
como equivalentes a los ceros de la interfaz. Para conteos aditivos se decodifican como cero,
preservando el `null` original en `raw_metrics`. Campos ausentes o de atribución no devuelta
permanecen desconocidos. No se fabrican filas que faltan en el reporte.

Las conversiones web se devuelven por evento. Compras usan `PURCHASE`, registros `REGISTRATION`,
carritos `ADD_TO_CART` y checkout `BEGIN_CHECKOUT`; eventos sin equivalencia segura quedan `null`.
Sin selección explícita no se suman todos los eventos para un supuesto evento principal.
Los eventos pueden superponerse. `post_view`, `assisted`, `order_quantity` y `sale_amount`
se conservan por ubicación cuando llegan; no se atribuye ese importe a un subconjunto de conteos
sin un contrato comprobado, por lo que `conversion_value` permanece `null`.

## Errores, límites y descarga

HTTP 401 → `AUTH_ERROR`; 403/404 de recurso → `ACCESS_DENIED`; restricciones de la app
`READONLY_CLIENT_APPLICATION` / `UNAUTHORIZED_CLIENT_APPLICATION` → `ACCESS_REQUIRED`;
400 → `INVALID_REQUEST`; 429 → `RATE_LIMITED`; fallos transitorios → `PROVIDER_ERROR`.
Los estados usan `stateFromError`, igual que los demás proveedores.

Se respetan `Retry-After`, `x-account-rate-limit-reset` y `x-rate-limit-reset` como timestamps
epoch, con prioridad del límite por cuenta. Si la espera excede el plazo disponible se devuelve
el error, sin adelantar el reintento. La creación de un trabajo no se reintenta tras un fallo
ambiguo de red/5xx, para evitar duplicarlo. GET tiene reintentos y circuit breaker.

El resultado asíncrono se descarga únicamente de HTTPS en **`ton.twimg.com`**, ruta
`/advertiser-api-async-analytics/stats_job_<ID>.json.gz`. No se siguen redirecciones ni se envía
OAuth al CDN. JSON y descargas están acotados a 10 MiB; expansión gzip a 25 MiB. TLS y el proxy
del entorno se mantienen. No se registran cabeceras, tokens, respuestas OAuth, mensajes originales
de errores ni URLs de descarga.

## Validación y pendientes

Pruebas con fixtures y transporte inyectado, con `fetch` global bloqueado por `tests/setup.ts`.
Incluyen RFC OAuth, estados compartidos, moneda, fechas no UTC, medianoche, ubicaciones, CPA,
trabajos de 64 bits, gzip, polling, límites de tasa, permisos parciales y rutas autenticadas.
El panel del monitoreo consume X mediante el mismo esquema y estados de los otros proveedores.

**No se realizó una conexión real de X:** faltan sus cuatro credenciales en esta sesión.
Quedan por validar aprobación/permisos de la app, forma real de conversiones, conciliación con
Ads Manager, offset/DST y las tres ubicaciones. No se declara esta fase lista para producción.

## Fuentes oficiales

- [Versiones](https://docs.x.com/x-ads-api/fundamentals/versioning).
- [OAuth y solicitudes autenticadas](https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests).
- [Cuentas, campañas e instrumentos](https://docs.x.com/x-ads-api/campaign-management/reference).
- [Analytics: métricas, ubicaciones, reportes síncronos y trabajos asíncronos](https://docs.x.com/x-ads-api/analytics).
- [Zonas horarias](https://docs.x.com/x-ads-api/fundamentals/timezones).
- [Monedas](https://docs.x.com/x-ads-api/fundamentals/currency).
- [Límites de tasa](https://docs.x.com/x-ads-api/fundamentals/rate-limiting).
- [Errores](https://docs.x.com/x-ads-api/fundamentals/error-codes-and-responses).
- [Permisos de acceso](https://docs.x.com/x-ads-api/getting-started/increasing-access).
- [SDK oficial](https://github.com/twitterdev/twitter-python-ads-sdk), [publicación 11.0.0](https://pypi.org/project/twitter-ads/11.0.0/).
- [RFC 5849, sección 3.4](https://www.rfc-editor.org/rfc/rfc5849#section-3.4).

- [Errata oficial 2550: firma HMAC-SHA1 del ejemplo RFC 5849](https://www.rfc-editor.org/errata/eid2550).
