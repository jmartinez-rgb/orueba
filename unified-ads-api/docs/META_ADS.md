# Meta Marketing API — fase 3

Integración de **lectura** de cuentas, campañas, rendimiento y conversiones mediante Graph API.
Versión predeterminada **v26.0**, vigente según el changelog oficial consultado el 30 de septiembre de 2026. También admite v25.0. No necesita dependencias nuevas ni utiliza el SDK para hacer las llamadas.

## Conectar desde el navegador

1. Abre [Meta for Developers](https://developers.facebook.com/apps/) y selecciona una app con acceso
   a Marketing API. Si necesitas crearla, elige el caso de uso para administrar anuncios; los nombres
   de los formularios pueden variar según tu app.
2. Para consultar datos necesitas **`ads_read`** y una identidad con acceso a las cuentas publicitarias.
   Puedes usar un token de usuario para probar desde
   [Graph API Explorer](https://developers.facebook.com/tools/explorer/): selecciona tu app, agrega
   `ads_read` y autoriza con el usuario que puede ver las cuentas. Los tokens de prueba pueden vencer;
   el código reporta `AUTH_ERROR` y no puede renovarlos por sí solo.
3. Para una conexión del negocio, puedes usar un token de usuario del sistema. En la configuración
   del portafolio comercial, asigna a ese usuario la app y las cuentas con las tareas de lectura
   necesarias; genera el token para tu app con `ads_read`. Para este flujo configura
   `META_AD_ACCOUNT_IDS` con las cuentas asignadas y evita depender de `/me/adaccounts`.
4. En la configuración del entorno de Codex, sección **Variables de entorno**, guarda el token como
   `META_ACCESS_TOKEN`. No lo pegues en el chat ni en GitHub. Son valores directos para el proceso,
   no marcadores de secretos de proxy. Publica/aplica los cambios y reinicia el entorno para que
   el proceso reciba la nueva variable. Guardar el borrador por sí solo no la activa.
5. Pide a Codex que compruebe la conexión de Meta. El primer chequeo valida autenticación y acceso
   a cuentas; después debe leer campañas e Insights de una cuenta conocida y comparar con Ads Manager.
   El acceso al endpoint de estado por sí solo no demuestra todos los permisos de Insights.

La API de esta fase no modifica campañas y no necesita `ads_management` para consultar Insights.
Para cuentas de terceros, Meta puede exigir acceso avanzado a `ads_read`, revisión de la app y
verificación del negocio. Los niveles de permiso Standard/Advanced son distintos de los niveles
Limited/Full de Marketing API Access Tier. Sigue los requisitos que muestre el panel de tu app.
Configurar un token no demuestra que esas aprobaciones ya existan.

## Variables

| Variable                          | Uso                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `META_ACCESS_TOKEN`               | Obligatoria. Token de usuario o usuario del sistema con `ads_read`.                                                                                                                                   |
| `META_API_VERSION`                | `v26.0` por defecto; también admite `v25.0`.                                                                                                                                                          |
| `META_APP_SECRET`                 | Opcional. Calcula `appsecret_proof` con HMAC SHA-256. Obligatoria si tu app exige ese proof.                                                                                                          |
| `META_INCLUDE_BUSINESS_METADATA`  | `false` por defecto. `true` pide el campo `business` y necesita `business_management`; no es necesario para cuentas e Insights con `ads_read`.                                                        |
| `META_AD_ACCOUNT_IDS`             | Opcional. Lista por comas de IDs numéricos o con prefijo `act_`; limita el descubrimiento. Tiene prioridad sobre Business discovery.                                                                  |
| `META_BUSINESS_IDS`               | Opcional. Consulta `owned_ad_accounts` y `client_ad_accounts` de esos negocios; puede necesitar `business_management` y las aprobaciones correspondientes. Sin estas dos listas usa `/me/adaccounts`. |
| `META_CLIENT_MAPPING`             | JSON cuenta → cliente interno, por ejemplo `{"123456789":"cliente-a"}`.                                                                                                                               |
| `META_CONVERSION_MAPPING`         | JSON tipo de acción → categoría interna. Permite categorías como `LEAD`, `PURCHASE`, `CONTACT`, `WHATSAPP`.                                                                                           |
| `META_PRIMARY_CONVERSION_ACTION`  | Acción exacta usada para conversiones, valor y CPA en rendimiento. Sin ella esas métricas quedan en `null`.                                                                                           |
| `META_PRIMARY_CONVERSION_MAPPING` | JSON cuenta → acción principal. Sobrescribe la acción global por cuenta.                                                                                                                              |
| `META_PRIMARY_CONVERSION_RULES`   | JSON `[{"campaign_contains":"CAPI WhatsApp","action":"..."}]`. Acción por nombre de campaña (sin acentos ni mayúsculas); gana sobre la de cuenta y la global.                                         |
| `META_TIMEOUT_MS`                 | Tiempo máximo de la operación completa; por defecto el timeout común, 15000 ms.                                                                                                                       |
| `META_RETRIES`                    | Reintentos transitorios por llamada, 2 por defecto, máximo 5.                                                                                                                                         |

Los IDs públicos de cuenta son numéricos; `account_id=act_123456789` también se acepta al consultar.
El `client_id` solo es un filtro del mapeo interno, no un nombre o ID de negocio descubierto por Meta.
`manager_account_id` identifica el negocio propietario cuando está disponible, no una jerarquía MCC.
La consulta básica con `ads_read` deja ese campo en `null`. `META_INCLUDE_BUSINESS_METADATA=true`
solicita `business` y necesita `business_management`; las cuentas de `owned_ad_accounts` también
identifican su propietario por el negocio consultado. Un negocio de `client_ad_accounts` no se presume propietario.
`status` de cuenta conserva el código numérico original como texto. Estado y objetivo de campaña son
los actuales al consultar, no una reconstrucción histórica.

## Endpoints

Se usan las rutas existentes, con encabezado `X-API-Key` configurado en `API_KEYS`:

```text
GET /api/v1/providers/meta/status
GET /api/v1/accounts?provider=meta
GET /api/v1/campaigns?provider=meta&account_id=123456789
GET /api/v1/performance?provider=meta&account_id=123456789&date_from=2026-09-23&date_to=2026-09-29&granularity=daily
GET /api/v1/conversions?provider=meta&account_id=123456789&date_from=2026-09-23&date_to=2026-09-29&granularity=daily
```

También hay filtros `client_id`, `campaign_id` y `granularity=hourly`. Para muchas cuentas dirige
las consultas con `account_id` o un cliente mapeado. Se usan consultas síncronas paginadas, sujetas
al timeout: los reportes asíncronos de Meta para grandes extracciones no están implementados.
Las cuentas descubiertas se cachean cinco minutos; el chequeo de estado siempre vuelve a consultar Meta.

## Métricas y conversiones

- Insights usa nivel `campaign`, `time_increment=1`, rango inclusivo y la zona horaria de la cuenta.
  La moneda es la original; no se convierten micros ni divisas. CTR/CPC/CPM/CPA se calculan con los
  campos base y quedan en `null` si el denominador es cero o no está disponible.
- `link_clicks` corresponde a `inline_link_clicks`. `video_views` corresponde a reproducciones
  iniciadas de `video_play_actions`, no a vistas de tres segundos ni ThruPlay. Los porcentajes de
  vídeo conservan los valores `video_p25/p50/p75/p100_watched_actions`.
- Las conversiones usan `action_report_time=impression` y la atribución unificada de los ad sets
  (`use_unified_attribution_setting=true`). Para comparar totales en Ads Manager usa el mismo rango,
  zona, nivel, ventanas de atribución y momento de reporte. La atribución puede actualizar cifras anteriores.
- `purchase`, `omni_purchase` y `offsite_conversion.fb_pixel_purchase` pueden describir eventos que
  se solapan. El endpoint de conversiones conserva una fila por acción, con el original y la marca
  `overlapping_action_types=true`. Por omisión **solo una acción por categoría lleva categoría**: la
  acción principal de la cuenta o, si no coincide, el total agregado (`omni_purchase` para compras,
  `lead` para leads). Las demás conservan `normalized_conversion=null` y `raw_metrics.category_hint`,
  así que sumar por categoría ya no duplica la misma compra. No sumes todas las filas sin filtrar.
- El rendimiento usa una única acción principal configurada. Sin acción principal, conversiones,
  valor y CPA quedan en `null`. Con acción principal, si Meta no la lista ese día, el día tuvo 0
  (Meta solo devuelve las acciones ocurridas); `raw_metrics.primary_action_present=false` lo marca
  para detectar una acción mal elegida. Por hora, las acciones externas siguen en `null`.
- Compras y leads conocidos tienen categorías básicas; acciones desconocidas conservan categoría
  `null` hasta configurar el mapeo. Mensajería no se clasifica automáticamente como WhatsApp:
  `onsite_conversion.messaging_conversation_started_7d` puede representar otros destinos.
  Clics y vistas no aparecen como conversiones salvo que los selecciones explícitamente en el mapeo.
  Las acciones `onsite_conversion.post_*` (reacciones, guardados y sus cambios netos) y
  `onsite_conversion.messaging_block` se conservan en el rendimiento original y solo aparecen
  como conversiones si configuras un mapeo o las seleccionas expresamente como acción principal.
- Por hora se usa `hourly_stats_aggregated_by_advertiser_time_zone`, conservando la hora cero.
  Meta no admite únicos, alcance ni frecuencia en ese desglose: los campos normalizados quedan en
  `null`. También omite conversiones off-Meta; la integración no atribuye a una hora los alias globales
  `purchase`, `lead` u `omni_*`. Conserva acciones internas identificables cuando Meta las reporta.
  El resultado incluye un aviso en `errors` y metadatos en `raw_metrics`; una lista vacía de conversiones
  horarias no demuestra cero conversiones externas. Consulta granularidad diaria para esas métricas.

## Errores y seguridad

Token por `Authorization: Bearer`; proof opcional calculado en el servidor. Host HTTPS fijo, redirecciones
bloqueadas y paginación mediante cursores sobre la misma ruta: nunca se sigue una URL `paging.next`, que
puede contener tokens. No se guardan ni se imprimen respuestas de autenticación.

Los errores mantienen códigos numéricos, subcódigos y trace ID seguros; no publican mensajes crudos
que puedan incluir credenciales. Código 190/102 → `AUTH_ERROR`; permisos 3/10/200–299 → `ACCESS_DENIED`;
parámetros 100 → `INVALID_REQUEST` (si el mensaje identifica el permiso `business_management`,
se traduce a `ACCESS_DENIED` con ese requisito); límites 4/17/32/341/613/80000/80004 → `RATE_LIMITED`.
Se reintenta solo red, límites y fallos transitorios. Se respeta `Retry-After` y el tiempo en minutos de
`X-Business-Use-Case-Usage`. Si la espera excede el timeout, se devuelve el límite sin reintentar antes.
Tras fallos transitorios consecutivos se abre el circuit breaker.

Las consultas agregadas conservan las cuentas accesibles y reportan en `errors` las cuentas sin permiso.
Una cuenta solicitada explícitamente devuelve su error HTTP. Fallos globales de token, cuota o respuesta
inválida no se ocultan. La falta de credenciales de Meta no bloquea Google Ads ni el resto del servidor.

## Validación

Simulador local estricto, sin llamadas reales, con casos de cuentas propias/compartidas, filtros,
paginación segura, cálculos y eventos solapados, límites, token vencido, permisos, circuit breaker,
cancelación, datos parciales y rutas HTTP autenticadas. Ejecutar `npm test`, `npm run typecheck`,
`npm run lint` y `npm run build`.

Validación real del **30 de septiembre de 2026**: autenticación, 17 cuentas activas en MXN/USD y una
muestra de 260 campañas, 132 filas diarias de rendimiento y 1664 filas diarias por acción de conversión,
para el periodo del 23 al 29 de septiembre. Una consulta de una campaña/día devolvió 24 filas horarias de
rendimiento con hora cero. Una campaña de mensajería devolvió 120 filas por acción/hora con valores
positivos; esa muestra no incluyó hora cero. Se comprobaron las limitaciones de conversiones externas y la omisión de
reacciones/bloqueos. Estos conteos son filas de la muestra, no totales agregados de conversiones.

La lectura real detectó que pedir `business` necesita `business_management`, aunque el token tenga
`ads_read`. Se hizo opcional y se verificó la consulta sin ese permiso. También se corrigió el filtro
para excluir acciones de interacción etiquetadas por Meta como `onsite_conversion`.

Pasaron **162 pruebas**, además de typecheck, lint, build y formato. Google Ads conserva conexión real.
Las pruebas con simulador no reemplazan la verificación de permisos y datos de cada cuenta. La acción
principal aún debe configurarse según la medición del cliente; sin ella rendimiento mantiene
conversiones, valor y CPA en `null`.

## Elegir la acción principal (`npm run meta:acciones`)

La regla de medición de izzi es por campaña: las que dicen «CAPI WhatsApp» se miden con On-Facebook
Purchase y las demás con Compras Offline Web (Inbound). `META_PRIMARY_CONVERSION_RULES` la expresa
sin código; los identificadores exactos (`action_type`) los confirma el equipo.

```bash
npm run meta:acciones -- 902854812517704 801573051220234            # últimos 7 días completos
npm run meta:acciones -- --desde 2026-09-01 --hasta 2026-09-30 <IDs>
```

Deja en `reportes/` un Excel con las acciones que reporta cada cuenta por universo, su volumen, el peso
del gasto de las campañas que las usan y el nombre de las conversiones personalizadas. Marca como
«Revisar» las que coinciden por nombre con la regla y propone las líneas de configuración solo si hay
una única candidata; si hay varias o ninguna, lo dice. Nada se aplica solo. Solo lectura.

## Revisión de públicos excluidos (clientes activos)

`npm run meta:exclusiones` genera un Excel con las cuentas, campañas y grupos de anuncios que excluyen la
audiencia de clientes activos y los que no, considerando **solo campañas activas**. Es solo lectura: no
cambia nada en Meta. Usa
`META_ACCESS_TOKEN` del `.env` local (requiere `ads_read`); si no existe, lo pide en la terminal sin mostrarlo
y solo lo usa en esa ejecución, sin guardarlo.

```bash
npm run meta:exclusiones -- 902854812517704 801573051220234 1002273077117011
npm run meta:exclusiones -- --patron "clientes activos|base activa" <IDs>
```

- Sin IDs usa `META_AD_ACCOUNT_IDS`. El archivo queda en `reportes/` (ignorado por git, permisos 0600);
  `--salida <ruta>` lo cambia.
- Un grupo cuenta como "excluye clientes activos" si alguna audiencia en
  `targeting.excluded_custom_audiences` tiene un nombre que coincide con el patrón (por omisión
  `client.*activ|activ.*client`, sin acentos ni mayúsculas). La hoja _Audiencias excluidas_ lista todas
  las audiencias excluidas para confirmar el criterio.
- Hojas: _Resumen por cuenta_, _Campañas activas_ (cobertura Sí / Parcial / No), _Grupos activos_,
  _Audiencias excluidas_ y _Criterios_. Las campañas con "CAPI WhatsApp" en el nombre se marcan en su
  propio universo.
- Alcance: grupos con `effective_status` Activo (Meta marca `CAMPAIGN_PAUSED` cuando la campaña está
  pausada). También descarta los que siguen como Activo pero ya pasaron su `end_time` o el `stop_time`
  de su campaña; el resumen dice cuántos. Los que aún no inician se marcan como _Programado_. Una cuenta
  sin permiso queda registrada y no detiene a las demás.
- Si Meta rechaza los subcampos de `targeting`, repite la lectura con la segmentación completa en páginas
  de 25. No cubre exclusiones a nivel cuenta ni listas de clientes existentes de campañas Advantage+ de
  ventas.

## Fuentes oficiales consultadas

- [Changelog Graph y Marketing API](https://developers.facebook.com/docs/graph-api/changelog/) — v26.0, publicada el 29 de julio de 2026.
- [Autorización y niveles de acceso](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization).
- [Ads Insights](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights).
- [Breakdowns y restricciones horarias/off-Meta](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns).
- [Errores Graph](https://developers.facebook.com/docs/graph-api/guides/error-handling/).
- [Límites Graph y BUC](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/).
- [App secret proof](https://developers.facebook.com/docs/graph-api/guides/secure-requests/).
- [SDK oficial Node, campos y edges v26](https://github.com/facebook/facebook-nodejs-business-sdk/tree/main/src/objects).
- [SDK oficial Python, parámetros de Insights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py).
