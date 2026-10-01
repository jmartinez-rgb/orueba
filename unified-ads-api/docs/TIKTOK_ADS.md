# TikTok Ads — fase 4

Integración de lectura de cuentas, campañas, rendimiento y conversiones en `unified-ads-api`.
Usa `fetch` de Node, sin dependencias nuevas. Los endpoints comparten autenticación `X-API-Key`
y el modelo normalizado de Google y Meta.

## Contrato y versión

Esta fase implementa **v1.3** con los endpoints GET publicados en el SDK oficial y en sus referencias:

| Operación           | Endpoint de TikTok                      |
| ------------------- | --------------------------------------- |
| Cuentas autorizadas | `/open_api/v1.3/oauth2/advertiser/get/` |
| Detalles de cuenta  | `/open_api/v1.3/advertiser/info/`       |
| Campañas            | `/open_api/v1.3/campaign/get/`          |
| Reporte de campaña  | `/open_api/v1.3/report/integrated/get/` |

Fuentes revisadas el 30 de septiembre de 2026. El portal también publica **v2.0** para autenticación
y reporting con cambios de contrato. Su referencia de reporte indica POST y su ejemplo muestra GET.
Se ha elegido el contrato v1.3 coherente con el SDK oficial y no se trasladan parámetros entre
versiones. `TIKTOK_API_VERSION` acepta `v1.3`; no se presenta esta implementación como v2.0.

## Conectar desde el navegador

1. Abre [TikTok API for Business](https://business-api.tiktok.com/portal/) con tu cuenta de TikTok
   for Business. Regístrate como desarrollador si el portal lo solicita.
2. En [My Apps](https://ads.tiktok.com/marketing_api/apps/), crea o selecciona tu app.
   Solicita los permisos que corresponden a **Read Ad Account Information**, **Read Campaigns**
   y **Reporting / Consolidated Report**. La app puede requerir revisión y aprobación de TikTok.
3. En **App Detail → Basic Information** están el **App ID**, **Secret** y la
   **Advertiser authorization URL**. Autoriza con un usuario que puede leer las cuentas deseadas.
   Usa el redirect URL registrado para tu app y verifica el `state` del flujo antes de intercambiar
   el código. El código `auth_code` dura una hora y solo puede usarse una vez.
4. Usa la herramienta de pruebas del portal para ejecutar el intercambio documentado en
   [Generate an access token](https://business-api.tiktok.com/portal/docs?id=1738373164380162):
   `POST /open_api/v1.3/oauth2/access_token/`, formato JSON, con `app_id`, `secret`, `auth_code`.
   El token de anunciante emitido por ese contrato es de larga duración. Guarda el `access_token`
   de la respuesta en la configuración privada del entorno.
5. En **Edit environment → Variables de entorno**, completa `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`
   y `TIKTOK_ACCESS_TOKEN`. Guarda/publica la configuración y reinicia el entorno para inyectarlas.
   Estos valores se leen directamente del proceso; no uses una credencial de proxy sustituta.
6. Tras el reinicio, consulta el estado y una cuenta concreta. Una prueba con simulador no demuestra
   que la app tenga acceso real. El token es revocable y la app sigue sujeta a sus permisos.

El portal documenta también tokens cortos de 24 horas y renovación en v2.0. Esta fase recibe un token
vigente, usa el flujo largo v1.3 y **no renueva tokens automáticamente**. Un token revocado produce
`AUTH_ERROR`; se debe volver a autorizar y actualizar la variable privada.

### Obtener el token de acceso (`npm run tiktok:auth`)

Con la app aprobada (1 de octubre de 2026):

1. Guarda `TIKTOK_APP_ID` y `TIKTOK_APP_SECRET` en las variables privadas del entorno (nunca en el chat).
2. En el portal de TikTok for Business abre la app y usa su **enlace de autorización de anunciantes**.
   Entra con el usuario administrador de las cuentas y autoriza las cuentas publicitarias que se
   monitorean.
3. TikTok te regresa a la URL de retorno registrada con `auth_code` en la dirección. El código vence
   en minutos y solo sirve una vez.
4. Ejecuta `npm run tiktok:auth` y pega esa URL completa en la terminal (o guárdala antes en la variable
   privada `TIKTOK_AUTH_CALLBACK_URL`). El asistente canjea el código, guarda `TIKTOK_ACCESS_TOKEN` en
   `.env` con permisos 0600 sin mostrarlo y, si aún no hay lista, `TIKTOK_ADVERTISER_IDS` con las
   cuentas autorizadas.

El servidor necesita salida a `business-api.tiktok.com`.

## Variables

| Variable                             | Uso                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `TIKTOK_ACCESS_TOKEN`                | Requerida para todas las lecturas. Encabezado `Access-Token`.                                |
| `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` | Requeridas para descubrir cuentas autorizadas.                                               |
| `TIKTOK_ADVERTISER_IDS`              | Opcional: cuentas por comas. Con esta lista se omite discovery y basta el token.             |
| `TIKTOK_API_VERSION`                 | `v1.3`, predeterminada. Otras versiones requieren otro contrato.                             |
| `TIKTOK_CLIENT_MAPPING`              | JSON cuenta → cliente interno.                                                               |
| `TIKTOK_PRIMARY_CONVERSION_METRIC`   | Métrica para conversiones y CPA en rendimiento. Predeterminada: `conversion`.                |
| `TIKTOK_PRIMARY_CONVERSION_MAPPING`  | JSON cuenta → métrica principal; tiene prioridad sobre la global.                            |
| `TIKTOK_CONVERSION_METRICS`          | Lista por comas para `/conversions`; la acción principal se añade automáticamente.           |
| `TIKTOK_CONVERSION_MAPPING`          | JSON métrica → categoría interna; solo métricas admitidas.                                   |
| `TIKTOK_TIMEOUT_MS`                  | Tiempo total por consulta, 1.000–300.000 ms. Hereda el timeout común, 15.000 ms por omisión. |
| `TIKTOK_RETRIES`                     | 0–5 reintentos transitorios; predeterminado: 2.                                              |

Los IDs, incluidos los del JSON de mapeos, se conservan como cadenas numéricas: TikTok usa valores
de 64 bits que JavaScript no puede representar con precisión como `number`.

Ejemplo de selección de CPA: `TIKTOK_PRIMARY_CONVERSION_METRIC=complete_payment` usa compras web;
`form` usa leads web, `onsite_form` usa formularios de TikTok. Puede variar por cuenta:

```json
{ "7000000000000000011": "form", "7000000000000000022": "complete_payment" }
```

## Métricas

El reporte es `BASIC`, servicio `AUCTION`, nivel `AUCTION_CAMPAIGN`. Agrupa por `campaign_id` y
`stat_time_day` o `stat_time_hour`. Los rangos son inclusivos y usan la zona de la cuenta.
El código divide los rangos sin superposición en bloques de 30 días o un día, respectivamente.
Respeta el rango común máximo de 366 días y un único timeout para toda la lectura, no por página.

`spend` conserva la moneda original; no son micros. `clicks` de TikTok son clics a destino: alimentan
`clicks` y `link_clicks`. CTR se expresa en porcentaje; CPC, CPM y CPA se calculan de las métricas
base. Los denominadores cero o ausentes devuelven `null`.

El nombre y objetivo de campaña se leen del reporte; `campaign_status` en rendimiento queda `null`
porque el contrato consultado no devuelve ese atributo. `/campaigns` sí devuelve el estado actual
y `source_status`. Se solicitan campañas y reportes con `STATUS_ALL`, incluidas las eliminadas.
El estado habilitado con un problema de entrega se conserva como `unknown`, junto al estado original.

`conversion` representa el evento de optimización seleccionado para los anuncios, que puede variar
entre grupos de una campaña. Su categoría y su valor monetario quedan `null` sin un mapeo explícito.
No equivale necesariamente a compras, leads o conversaciones.

| Acción reportada     | Categoría predeterminada | Métrica de valor              |
| -------------------- | ------------------------ | ----------------------------- |
| `conversion`         | `null`                   | Sin valor comparable          |
| `complete_payment`   | PURCHASE, web            | `total_complete_payment_rate` |
| `form`               | LEAD, web                | Sin valor                     |
| `onsite_form`        | LEAD, TikTok             | Sin valor                     |
| `total_purchase`     | PURCHASE, app            | `total_purchase_value`        |
| `total_registration` | REGISTRATION, app        | Sin valor                     |
| `on_web_order`       | ORDER, web               | Sin valor                     |
| `onsite_shopping`    | PURCHASE, Shop           | `total_onsite_shopping_value` |

La implementación heredada usa `total_complete_payment_rate` como valor de compra web.
La auditoría deja esa semántica **pendiente de comprobación** con un reporte real y Ads Manager;
el nombre por sí solo no demuestra que sea valor monetario. Shop reporta ingreso bruto, que puede tener una definición distinta a otras
compras. No se suman estos valores entre acciones. `/conversions` devuelve cada fuente por separado
y marca `overlapping_action_types=true`: la métrica de optimización puede coincidir con alguna de
las compras o formularios. El CPA usa exclusivamente la métrica principal seleccionada.

Se preservan métricas y dimensiones en `raw_metrics`. `-`, valores censurados como `<5`, números
inválidos y campos ausentes quedan `null`. No se añade una conversión cero cuando TikTok omite la acción.
Las cifras estándar corresponden a atribución por interacción del anuncio; no se mezclan con las
métricas `real_time_*`, que usan la fecha de conversión.

En esta fase, alcance y frecuencia se solicitan en reportes diarios; en los horarios se omiten y
quedan `null`. Los informes horarios no incluyen métricas SKAN. Para iOS 14 Dedicated Campaigns,
Branded Mission y GMV Max consulta las restricciones específicas: Branded Mission solo se obtiene
a nivel anunciante y GMV Max utiliza otro endpoint. Este reporte de campañas no sustituye esos datos.

## Paginación y errores

Se valida `code`, además del HTTP: TikTok puede devolver HTTP 200 con un error como `40105`.
El cliente reconstruye la ruta fija en `business-api.tiktok.com`, bloquea redirecciones y valida
las páginas. Detecta campañas/periodos repetidos y paginación incompleta. Tiene circuit breaker.

| Resultado de TikTok                          | Error normalizado                                  |
| -------------------------------------------- | -------------------------------------------------- |
| `40102`, `40105` y errores de autenticación  | AUTH_ERROR, 401; sin reintentos                    |
| `40001`, HTTP 403                            | ACCESS_DENIED, 403; sin reintentos                 |
| `40000`, `40002` y errores de parámetros     | INVALID_REQUEST, 400; sin reintentos               |
| `40016`, `40100`, `40132`, `40133`, HTTP 429 | RATE_LIMITED, 429; respeta Retry-After             |
| Códigos 5xxxx, HTTP 5xx o fallo de conexión  | PROVIDER_ERROR, 502; reintentos transitorios       |
| Tiempo agotado/cancelación                   | PROVIDER_TIMEOUT, 504                              |
| `20001`, resultado parcialmente exitoso      | PROVIDER_ERROR; no se presume una lectura completa |

Si una cuenta tiene permisos denegados, una consulta global conserva las otras y agrega un aviso
en `errors`. Una cuenta solicitada expresamente conserva el HTTP de error. Errores de token,
parámetros generales, red o timeout no se ocultan como cuentas individuales sin permiso.

El reporte síncrono puede limitarse a 20.000 IDs. `extra_info.search_ads_throttle` se convierte en un
aviso de datos parciales: filtra una campaña para obtener una lectura completa.
`extra_info.uv_invalid` señala métricas de usuarios únicos temporalmente ausentes.
Los reportes asíncronos y grandes extracciones quedan fuera de esta fase. Una cuenta enorme puede
requerir filtros y un timeout ajustado. La lista de cuentas se cachea cinco minutos; el estado
comprueba credenciales de nuevo en cada llamada.

No se registran tokens, App Secret, URLs autenticadas o mensajes de error originales. El contrato
de discovery exige el secret en query; se limita a ese endpoint oficial y no se propagan errores de
transporte que puedan incluir esa URL.

## Validación

Se añadieron 70 pruebas aisladas con un simulador local: IDs largos, cuentas, permisos parciales,
campañas, reportes diarios/horarios, medianoche, bloques de fechas, compras/leads, CPA, alias,
paginación, cancelación, circuito, reintentos y rutas autenticadas. No salen a internet.
La app ya está aprobada; la conexión real queda pendiente de obtener el token con
`npm run tiktok:auth`, configurar las variables privadas y hacer la primera lectura acotada.

Rutas para comprobar con `X-API-Key` después de configurar el entorno:

```text
GET /api/v1/providers/tiktok/status
GET /api/v1/accounts?provider=tiktok
GET /api/v1/campaigns?provider=tiktok&account_id=<ID>
GET /api/v1/performance?provider=tiktok&account_id=<ID>&date_from=2026-09-29&date_to=2026-09-29
GET /api/v1/conversions?provider=tiktok&account_id=<ID>&date_from=2026-09-29&date_to=2026-09-29&granularity=hourly
```

## Fuentes oficiales

- [SDK oficial TikTok Business API](https://github.com/tiktok/tiktok-business-api-sdk).
- [Cuentas autorizadas](https://business-api.tiktok.com/portal/docs?id=1738455508553729).
- [Detalles de cuenta](https://business-api.tiktok.com/portal/docs?id=1739593083610113).
- [Campañas](https://business-api.tiktok.com/portal/docs?id=1739315828649986).
- [Reporte integrado v1.3](https://business-api.tiktok.com/portal/docs?id=1740302848100353).
- [Dimensiones](https://business-api.tiktok.com/portal/docs?id=1751443956638721),
  [métricas](https://business-api.tiktok.com/portal/docs?id=1751443967255553)
  y [filtros](https://business-api.tiktok.com/portal/docs?id=1751443975608321).
- [Permisos](https://business-api.tiktok.com/portal/docs?id=1753986142651394),
  [autorización](https://business-api.tiktok.com/portal/docs?id=1738373141733378)
  y [token largo v1.3](https://business-api.tiktok.com/portal/docs?id=1738373164380162).
- [Códigos de retorno](https://business-api.tiktok.com/portal/docs?id=1737172488964097).
- [Reporte v2.0](https://business-api.tiktok.com/portal/docs/run-a-synchronous-report/v2.0)
  y [token v2.0](https://business-api.tiktok.com/portal/docs/obtain-an-advertiser-access-token/v2.0), contratos revisados para distinguir versiones.

## Continuación: cuatro cuentas y variables privadas

App aprobada según el usuario; primera lectura real todavía bloqueada en esta sesión porque
no están inyectados token y lista. Los valores que el usuario agregó al panel deben guardarse con
Done/Publicar y aplicarse al entorno; declarar un requisito no equivale a recibir la credencial.

`TIKTOK_ADVERTISER_IDS` debe contener, como texto separado por comas:

```text
7338571937913978882,7545502925565771792,7361545670072909840,7688066712031182866
```

Corresponden a Sky México, Sky Sports MXN, izzi - ABCW e izzi ABCW US, respectivamente.
App ID va solo en `TIKTOK_APP_ID`; Secret solo en `TIKTOK_APP_SECRET`; ninguno sustituye
`TIKTOK_ACCESS_TOKEN`. Con token y lista no hacen falta App ID/Secret para reporting.
Si un campo de token vacío bloquea Done, retirarlo temporalmente; no rellenarlo con el Secret.
Después de autorizar en el portal, guardar la URL de retorno con código únicamente en
`TIKTOK_AUTH_CALLBACK_URL` privado y ejecutar `npm run tiktok:auth` con el proxy soportado.
No compartir esa URL por chat. El asistente guarda el token en `.env` privado 0600.
