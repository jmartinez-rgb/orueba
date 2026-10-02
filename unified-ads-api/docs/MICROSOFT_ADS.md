# Microsoft Advertising — fase 5

Integración de lectura de **REST v13**, revisada con documentación oficial el 30 de septiembre de 2026. Incluye cuentas, campañas, rendimiento diario/horario y conversiones por objetivo. Microsoft
recomienda REST y programa la retirada de SOAP para el 31 de enero de 2027; esta integración no usa SOAP.

## Configuración desde el navegador

1. Entra con un usuario **Super Admin** en
   [Configuración de desarrolladores](https://ads.microsoft.com/cc/Settings/DevSettings) y solicita un
   Developer Token de producción. El portal anterior `developers.ads.microsoft.com` está retirado.
   Guárdalo como `MICROSOFT_ADS_DEVELOPER_TOKEN` en las variables privadas del entorno.
2. En [Microsoft Entra → Registros de aplicaciones](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade),
   registra `Unified Ads Monitoring`. El acceso al portal de registro requiere una cuenta de trabajo
   o escuela. Selecciona **Cualquier inquilino de Entra ID + cuentas personales de Microsoft**.
3. Si cambiar los tipos de cuenta produce `api.requestedAccessTokenVersion is invalid`, edita el
   manifiesto: `signInAudience` debe ser `AzureADandPersonalMicrosoftAccount` y el campo
   `api.requestedAccessTokenVersion` debe ser `2`. Guarda ambos cambios juntos.
4. Copia **Id. de aplicación (cliente)** en `MICROSOFT_ADS_CLIENT_ID`. El identificador de objeto y
   el de directorio no reemplazan este valor.
5. En **Certificados y secretos → Nuevo secreto de cliente**, copia su **Valor** en
   `MICROSOFT_ADS_CLIENT_SECRET`. El Id. del secreto no sirve para autenticar.
6. En **Authentication → Agregar plataforma → Web**, registra exactamente:
   `http://localhost:8089/oauth/microsoft/callback`. El flujo confidencial con secreto permite
   autorizar en tu navegador y renovar después desde el servidor en la nube.
7. Guarda/aplica las variables en el entorno. El scope solicitado es
   `https://ads.microsoft.com/msads.manage offline_access`; autoriza con el usuario que tiene acceso a
   las cuentas publicitarias. El Developer Token por sí solo no concede ese acceso.

### Asistente manual en Codex cloud

El usuario solo necesita el navegador. Codex ejecuta el asistente en el checkout existente; no es
necesario descargar el repositorio ni exponer una página del proyecto:

```bash
cd /workspace/orueba/unified-ads-api
NODE_USE_ENV_PROXY=1 npm run microsoft:auth -- --start
```

El comando imprime un enlace oficial de autorización y guarda estado/PKCE en un archivo local
ignorado `.microsoft-oauth-session` con permisos `0600`. Abre el enlace, inicia sesión y acepta los
permisos. La redirección a localhost puede mostrar «No se puede acceder a este sitio», porque no hay
servidor en tu computadora. Si la barra de direcciones contiene `code` y `state`, Microsoft ya devolvió
el código que requiere el asistente.

Guarda **la URL completa de esa barra** únicamente en la variable privada temporal
`MICROSOFT_ADS_AUTH_CALLBACK_URL`. No uses un comando con el código en sus argumentos. Codex completa
el flujo con:

```bash
NODE_USE_ENV_PROXY=1 npm run microsoft:auth -- --complete
```

El asistente valida origen, ruta, estado y antigüedad; intercambia el código con secreto de cliente y
PKCE, y actualiza solo `MICROSOFT_ADS_REFRESH_TOKEN` en el `.env` privado del checkout. No imprime
tokens. Después reinicia el servicio para que lea `.env` y elimina el callback temporal del panel de
variables. Si vence el código o la sesión, ejecuta `--cancel` y luego `--start` para autorizar de nuevo.

El `.env` permanece local e ignorado por Git: este asistente **no copia su token al almacén de
variables de la plataforma**. Un checkout nuevo necesita una nueva autorización o recibir el refresh
token mediante su configuración privada. Si `MICROSOFT_ADS_REFRESH_TOKEN` ya tiene un valor en el
proceso, este prevalece sobre `.env`; no mantengas una variable vacía/antigua que oculte el token nuevo.
Guardar el borrador del entorno no aplica sus variables ni reinicia el proceso.

## Comprobar el bloqueo de informes

```bash
npm run microsoft:red
```

Consulta únicamente DNS y HEAD HTTPS al host fijo
`bingadsappsstorageprod.blob.core.windows.net`, respetando TLS y el proxy. No requiere secretos,
genera trabajos ni registra URL firmadas. Distingue rechazo de proxy, DNS, TLS, timeout y fallo
de conexión. Un HTTP completado en la raíz prueba transporte, incluso si responde 403/404;
no valida permiso de descarga ni contenido del CSV. Salida 0: alcanzable; 2: bloqueo; 1: fallo de opciones.

La comprobación del 1–2 de octubre de 2026 produjo `proxy_denied`. El borrador del entorno ya
tiene red sin restricciones; el proxy de infraestructura rechaza CONNECT a ese host. Cambiar
el borrador o renovar OAuth no corrige ese rechazo. Debe habilitarse **ese host fijo** en la
infraestructura, o ejecutar la API en un entorno autorizado que permita la salida; no se elude
el proxy ni se desactiva TLS. Después ejecutar una lectura acotada y conciliar el CSV con la interfaz.

La autorización, cuatro cuentas y 43 campañas siguen comprobadas; la lectura añadió **11 filas
de presupuestos actuales y dos señales de entrega**. Tres cuentas devolvieron informes vacíos
válidos para 2026-09-30; la cuenta con actividad sigue bloqueada al descargar el ZIP. Una conexión
`connected` solo prueba discovery: no demuestra disponibilidad de métricas.

## Variables

| Variable                                  | Uso                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `MICROSOFT_ADS_DEVELOPER_TOKEN`           | Obligatoria, producción.                                                     |
| `MICROSOFT_ADS_CLIENT_ID`                 | Obligatoria, UUID de aplicación.                                             |
| `MICROSOFT_ADS_CLIENT_SECRET`             | Obligatoria, valor del secreto Web.                                          |
| `MICROSOFT_ADS_REFRESH_TOKEN`             | Obligatoria para el proveedor; el asistente la puede generar.                |
| `MICROSOFT_ADS_TENANT`                    | `common` por defecto; también `organizations`, `consumers` o UUID de tenant. |
| `MICROSOFT_ADS_ACCOUNT_IDS`               | Lista opcional de IDs Int64 como texto, separados por coma.                  |
| `MICROSOFT_ADS_CLIENT_MAPPING`            | JSON de AccountId a client_id interno.                                       |
| `MICROSOFT_ADS_CONVERSION_MAPPING`        | JSON de GoalId o nombre exacto a categoría interna; GoalId tiene prioridad.  |
| `MICROSOFT_ADS_RETRIES`                   | 2 por defecto, de 0 a 5. Solo fallos transitorios.                           |
| `MICROSOFT_ADS_POLL_INTERVAL_MS`          | 5000 por defecto, de 1000 a 30000.                                           |
| `MICROSOFT_ADS_TIMEOUT_MS`                | Límite propio; 120000 por omisión, máximo 300000. La ruta lo respeta.        |
| `PROVIDER_TIMEOUT_MS`                     | Límite general de los demás proveedores; ya no hace falta elevarlo.          |
| `TOKEN_STORE_FILE`                        | Archivo privado 0600 donde se conserva el refresh token rotado.              |
| `MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA` | `false` por defecto; `true` exige datos completos.                           |
| `MICROSOFT_ADS_REDIRECT_URI`              | Opcional, solo asistente; la URI de localhost indicada arriba por defecto.   |
| `MICROSOFT_ADS_AUTH_CALLBACK_URL`         | Opcional y temporal, retorno completo del asistente manual.                  |

Ejemplos de mapeos, sin credenciales:

```dotenv
MICROSOFT_ADS_CLIENT_MAPPING={"123456":"cliente-abc"}
MICROSOFT_ADS_CONVERSION_MAPPING={"765432":"PURCHASE","Formulario":"LEAD"}
```

## Contratos y semántica

La API unificada mantiene las rutas autenticadas `GET /api/v1/accounts`, `/campaigns`, `/performance`
y `/conversions`, usando `provider=microsoft` y el encabezado `X-API-Key` interno. Esta llave interna
es distinta del Developer Token y del token OAuth de Microsoft.

- **Cuentas:** `GetUser` identifica al usuario actual; `SearchAccounts` usa el predicado `UserId` y
  páginas de 1000. Se conserva `ParentCustomerId`, moneda y el identificador oficial `TimeZoneType`.
  Los datos personales del usuario y los roles no se exponen. Una lista explícita de AccountIds usa
  `GetAccount` y limita el descubrimiento a esas cuentas.
- **Campañas:** `GetCampaignsByAccountId` pide todos los tipos actualmente documentados y soportados,
  incluyendo Performance Max, Audience, Shopping y Search. Los flags REST se separan por comas.
  Una campaña sin objetivo explícito
  conserva `objective=null`; su tipo no se convierte en un objetivo inventado.
- **Informes:** `SubmitGenerateReport` crea un trabajo; `PollGenerateReport` espera `Success` y luego
  descarga el ZIP firmado. Solo `Success` con URL nula significa que no hay datos. `Pending`, errores
  y timeout conservan un error; no se convierten en cero actividad. No hay cola persistente ni se
  reutilizan trabajos entre solicitudes; filtra una cuenta/campaña para reducir el tiempo.
- **Tiempo:** el CSV 2.0 entrega días `YYYY-MM-DD` y horas `YYYY-MM-DD|0..23`, siempre en **UTC**.
  `ReportTimeZone` solo cambia la interpretación de periodos relativos como «Yesterday». La
  integración usa fechas explícitas UTC y conserva `source_timezone="UTC"`; no transforma días
  diarios ya agregados a otra zona horaria. Las conversiones conservan UTC en `raw_metrics`.
  **Por verificar con datos reales:** la auditoría no pudo consultar la documentación oficial desde
  su entorno. Antes de usar estos totales, concilia un día con la interfaz de Microsoft Advertising:
  si las filas vinieran en la zona de la cuenta (`TimeZone`), habría que etiquetarlas así.
- **Dinero:** gasto y revenue se conservan en la moneda original de la cuenta, sin micros ni
  conversión monetaria. CTR se deriva en porcentaje; CPC, CPM y CPA usan gasto/clics, impresiones y
  conversiones respectivamente. Denominadores cero y métricas ausentes producen `null`.
- **Conversiones:** se usan `ConversionsQualified` y `Revenue`. La columna antigua `Conversions`
  está deprecada y devolvería cero en datos actuales. Se respetan conversiones fraccionarias; se
  excluyen objetivos marcados `ExcludeFromBidding` de las cifras principales. Por objetivo también
  se conservan `AllConversionsQualified` y `AllRevenue` en `raw_metrics`, sin sumarlos otra vez.
  `GoalType=Event` no identifica por sí solo si es compra, lead o WhatsApp: el mapeo debe configurarse.
- **Datos recientes:** con `ReturnOnlyCompleteData=false` se devuelve un aviso
  `provisional_reporting` porque Microsoft puede seguir procesando actividad. Con `true`, el código
  2004 indica que aún no hay datos completos. Microsoft menciona hasta dos horas para clics y tres
  para conversiones, con posibles ajustes posteriores.
- **Métricas:** alcance, frecuencia, clics de enlace y métricas de video quedan `null` porque no se
  solicitan en este contrato común. No se incluyen métricas incompatibles que cambien la agrupación.

## Resiliencia y límites

OAuth renueva el acceso antes de vencer, comparte una renovación entre consultas concurrentes y
conserva el refresh token rotado; con `TOKEN_STORE_FILE` también lo guarda para el siguiente arranque
(sin él, al reiniciar se vuelve al token original, que vence 90 días después de emitido). Ante el
código oficial 109 renueva una
vez; credenciales inválidas y permisos denegados no generan renovaciones indefinidas. Los códigos
117 y `ConcurrentRequestOverLimit` admiten reintentos; el 207 de dirección inválida no se confunde
con el límite de informes. Se respetan `Retry-After`, circuit breaker y cancelación global.

Errores OAuth y REST se traducen a los códigos estándar sin repetir mensajes de Microsoft que
puedan contener parámetros privados. Los fallos de permisos de una cuenta se reportan como avisos
si otras cuentas tuvieron éxito; consultar esa cuenta explícitamente conserva el error HTTP.

Los dominios de descarga pueden cambiar según Microsoft. Solo se acepta HTTPS a destinos públicos,
sin credenciales ni redirecciones; el OAuth y Developer Token nunca se envían a la descarga. Se
limitan los datos a 10 MiB comprimidos, 25 MiB descomprimidos, un CSV y 250000 filas. Un informe mayor
requiere un rango o alcance menor. Duplicados, columnas faltantes, IDs sin precisión y filas fuera
de la cuenta/periodo solicitado producen error en lugar de alterar silenciosamente las métricas.

## Verificación y fuentes oficiales

Las pruebas aisladas simulan los endpoints REST, OAuth, paginación, polling, ZIP/CSV, horas UTC,
conversiones fraccionarias, throttling, errores y rutas HTTP autenticadas. No llaman a Microsoft.
La validación real se realiza después de aplicar credenciales y autorizar una cuenta publicitaria.

- [Inicio y Developer Token](https://learn.microsoft.com/en-us/advertising/guides/get-started?view=bingads-13)
- [Registro OAuth y clientes confidenciales](https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-register?view=bingads-13)
- [Tokens OAuth](https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-get-tokens?view=bingads-13)
- [Manifiesto Microsoft Graph: requestedAccessTokenVersion](https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest)
- [Migración a REST](https://learn.microsoft.com/en-us/advertising/guides/migrate-to-rest?view=bingads-13)
- [SearchAccounts](https://learn.microsoft.com/en-us/advertising/customer-management-service/searchaccounts?view=bingads-13&pivot=rest)
- [GetCampaignsByAccountId](https://learn.microsoft.com/en-us/advertising/campaign-management-service/getcampaignsbyaccountid?view=bingads-13&pivot=rest)
- [SubmitGenerateReport](https://learn.microsoft.com/en-us/advertising/reporting-service/submitgeneratereport?view=bingads-13&pivot=rest)
- [PollGenerateReport](https://learn.microsoft.com/en-us/advertising/reporting-service/pollgeneratereport?view=bingads-13&pivot=rest)
- [Descarga ZIP y ausencia de datos](https://learn.microsoft.com/en-us/advertising/reporting-service/reportrequeststatus?view=bingads-13)
- [Columnas de campañas](https://learn.microsoft.com/en-us/advertising/reporting-service/campaignperformancereportcolumn?view=bingads-13)
- [Columnas de conversiones](https://learn.microsoft.com/en-us/advertising/reporting-service/conversionperformancereportcolumn?view=bingads-13)
- [Formato, procesamiento y UTC](https://learn.microsoft.com/en-us/advertising/guides/reports?view=bingads-13)
- [Códigos de error](https://learn.microsoft.com/en-us/advertising/guides/operation-error-codes?view=bingads-13)

## Restricción del host de descarga (continuación de auditoría)

Solo se acepta HTTPS en `bingadsappsstorageprod.blob.core.windows.net`, el almacenamiento
observado en una respuesta auténtica de Reporting v13. Otros hosts, incluidas otras cuentas
Azure Blob, se rechazan antes de DNS. Se mantienen comprobación de IP pública, TLS, proxy y
prohibición de redirecciones. Si Microsoft migra el destino, hay que revisar el contrato antes
de actualizar la lista; no basta ampliar a `*.blob.core.windows.net`.

La IP no queda fijada al socket del proxy: el riesgo residual de otra resolución del host
Microsoft confiado permanece documentado. No se declara resuelto por la comprobación DNS.
La descarga real continúa bloqueada por la red; no se elude el proxy para validarla.
