# Google Ads · posición absoluta

## Alcance

Lectura acotada para el monitoreo de **izzi**, mediante
`GET /api/v1/google/absolute-top`. Consulta una cuenta por petición, campañas Search activas y
sus grupos de anuncios activos; conserva datos diarios u horarios en la zona de la cuenta.
No modifica anuncios, presupuestos ni estrategias y conserva el comportamiento de los
otros proveedores.

El contrato se revisó el **2 de octubre de 2026** con fuentes oficiales de **Google Ads API v25**.
La revisión del catálogo confirma compatibilidad declarada de campos y segmentos; no sustituye
una ejecución real de todas las combinaciones GAQL ni la conciliación con Google Ads Manager.
Esta funcionalidad queda pendiente de esa comprobación real.

## Petición y filas

La ruta utiliza la autenticación interna `X-API-Key` y la configuración privada de Google ya
existente. No requiere una credencial nueva ni acepta secretos en parámetros.
Esta nueva lectura exige `GOOGLE_ADS_API_VERSION=v25` (el valor predeterminado). Bajo v24 se
rechaza con `INVALID_REQUEST` antes de consultar Google; los endpoints legacy mantienen su contrato.

```text
GET /api/v1/google/absolute-top?account_id=1234567890&date_from=2026-09-28&date_to=2026-09-30&granularity=daily
```

El ID del ejemplo es ilustrativo. `account_id` es obligatorio; `date_from` y `date_to` son fechas
reales, inclusivas y ordenadas, con un máximo de **7 días**. `granularity` admite `daily` y
`hourly`. No hacer una consulta sin cuenta para descubrir o leer todas las cuentas.

El resultado usa `GoogleAbsoluteTopRow`:

| Grupo de campos                | Contenido                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Identidad                      | `platform`, `account_id`, `account_name`, `campaign_id`, `campaign_name`, `campaign_status`, `level` |
| Grupo de anuncios              | `ad_group_id`, `ad_group_name`, `ad_group_status`; nulos en filas de campaña                         |
| Reloj y moneda                 | `date`, `hour`, `currency`, `source_timezone`, `extracted_at`                                        |
| Posición                       | `absolute_top_rate`, `top_of_page_rate`                                                              |
| Cuotas                         | `search_impression_share`, `search_lost_is_rank`, `search_lost_is_budget`, `share_bounds`            |
| Actividad                      | `impressions`, `clicks`, `ctr`, `cpc`, `spend`, `conversions`                                        |
| Configuración de campaña       | `bidding_strategy`, `daily_budget`                                                                   |
| Clasificación y disponibilidad | Metadatos del dominio maestro de Google y `warnings`                                                 |

`level` distingue `campaign` de `ad_group`. El catálogo de entidades activas se consulta por
separado y se une a las métricas mediante una unión izquierda: una entidad del catálogo sin
métricas conserva su identidad y los valores desconocidos permanecen nulos, presentados como
**N/D**. Tener una fila no certifica disponibilidad de todas sus métricas. El catálogo activo al
consultar tampoco representa todas las campañas que pudieron estar activas en un período histórico.

`hour` es nulo en granularidad diaria; **0 es una hora válida** en la horaria. `source_timezone`
es la zona original de la cuenta, no la del navegador. Los importes y el presupuesto diario
conservan la moneda original; este endpoint no realiza conversiones a MXN. El presupuesto es
de campaña: `daily_budget` permanece nulo en grupos, sin copiar el presupuesto del padre.
`ctr` sigue la convención de la API unificada: clics ÷ impresiones × 100; los rates y cuotas
usan fracciones de 0 a 1. `cpc` conserva unidades monetarias por clic. Un denominador nulo o cero
produce un valor derivado nulo, sin dividir ni inventar precisión.
Una lectura que exceda 100.000 observaciones por nivel se rechaza; no se devuelve una muestra
truncada presentada como cobertura completa.

Las filas de campaña y grupo describen niveles distintos del mismo tráfico. No sumar ambos
niveles ni mezclar filas diarias y horarias del mismo período.

## Tasas y cuotas distintas

| Campo del DTO             | Campo GAQL v25                                | Definición                                                                                                               |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `absolute_top_rate`       | `metrics.absolute_top_impression_percentage`  | **Impr. (Abs.Top) %**: proporción de impresiones recibidas que aparece como primer anuncio entre los anuncios superiores |
| `top_of_page_rate`        | `metrics.top_impression_percentage`           | Proporción de impresiones recibidas entre los anuncios superiores                                                        |
| `search_impression_share` | `metrics.search_impression_share`             | Impresiones recibidas en Search respecto a las oportunidades estimadas elegibles                                         |
| `search_lost_is_rank`     | `metrics.search_rank_lost_impression_share`   | Cuota estimada de impresiones Search perdida por Ad Rank                                                                 |
| `search_lost_is_budget`   | `metrics.search_budget_lost_impression_share` | Cuota estimada de impresiones Search perdida por presupuesto                                                             |

**Impr. (Abs.Top) %** y **Search abs. top IS** no son la misma métrica. La primera usa impresiones
recibidas; la segunda, oportunidades elegibles estimadas. El campo
`metrics.search_absolute_top_impression_share` corresponde a la segunda y **no forma parte del
DTO actual**. Tampoco se incluyen las variantes de cuota perdida específicamente en posición
absoluta. No sustituir un campo por otro por semejanza de nombres.

La descripción corta de v25 llama «share» a `absolute_top_impression_percentage`, aunque la
define respecto a impresiones recibidas. Para distinguirla de IS se utilizan el campo exacto y
las definiciones completas de Google Help. «Absolute top» significa primer anuncio entre los
anuncios superiores; no garantiza estar encima de todos los resultados orgánicos. Search
partners no distingue posiciones top/others y se excluye de estos datos de posición y cuota.

## Ausencia, cero y límites publicados

Los ratios son opcionales. El SDK oficial v25 los declara con presencia explícita; un campo
ausente o nulo permanece desconocido. **No convertirlo a cero**. Un cero explícito, cuando es
válido para la métrica, se conserva. Google también omite filas segmentadas cuando todas las
métricas seleccionadas son cero; la ausencia de esa fila no demuestra una tasa o cuota cero.

Google publica valores censurados para las cuotas:

| Respuesta Google                   | Significado                                           | Representación del DTO                                                        |
| ---------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `search_impression_share = 0.0999` | Cuota **menor que 10%**, sin valor exacto publicado   | Valor nulo y `share_bounds.search_impression_share = "lt_10_percent"`         |
| Lost IS rank o budget = `0.9001`   | Pérdida **mayor que 90%**, sin valor exacto publicado | Valor nulo y el campo correspondiente de `share_bounds` con `"gt_90_percent"` |

Los bordes `0.1` y `0.9` son valores exactos según estas reglas, no sentinelas. No mostrar
`0.0999` como 9.99% exacto ni `0.9001` como 90.01% exacto. La descripción de
`absolute_top_impression_percentage` no publica esa censura: no trasladarla al rate.
`warnings` conserva las limitaciones de disponibilidad y de interpretación.

## Compatibilidad de consultas y frescura

Se revisaron tanto las descripciones de métricas como el catálogo del recurso utilizado en
`FROM`. La lista genérica `selectable_with` puede incluir un recurso atribuido sin permitir
usarlo como recurso principal de la consulta.

En **`FROM campaign`**, el catálogo v25 admite los cinco campos de tasas/cuotas del DTO.
En **`FROM ad_group`**, admite `absolute_top_impression_percentage`,
`top_impression_percentage`, `search_impression_share` y `search_rank_lost_impression_share`,
pero **no `search_budget_lost_impression_share`**. La consulta de grupos excluye ese campo y
`search_lost_is_budget` permanece siempre nulo en esas filas. No copiar la pérdida presupuestal
de campaña al grupo ni presentarla como cero.

Las combinaciones revisadas incluyen `segments.date`, `segments.hour` y
`segments.ad_network_type` en el catálogo correspondiente. La selección compatible no
garantiza que Google publique valores para cada grupo/hora. Una cuota horaria ausente sigue
siendo N/D; **no rellenarla con la cuota diaria**. La aceptación real de estas consultas y la
disponibilidad de los datos quedan pendientes de prueba con una cuenta autorizada.

Las consultas están implementadas en `src/providers/google/absolute-top.ts`. Ejemplos de la
selección diaria, con fechas ilustrativas y un catálogo previo sin métricas:

```sql
SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_type, campaign.bidding_strategy_type,
       segments.date, segments.ad_network_type,
       metrics.absolute_top_impression_percentage, metrics.top_impression_percentage,
       metrics.search_impression_share, metrics.search_rank_lost_impression_share,
       metrics.search_budget_lost_impression_share,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.ad_network_type = 'SEARCH'
  AND segments.date BETWEEN '2026-09-28' AND '2026-09-30'
```

```sql
SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_type, campaign.bidding_strategy_type,
       ad_group.id, ad_group.name, ad_group.status,
       segments.date, segments.ad_network_type,
       metrics.absolute_top_impression_percentage, metrics.top_impression_percentage,
       metrics.search_impression_share, metrics.search_rank_lost_impression_share,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM ad_group
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND ad_group.status = 'ENABLED'
  AND segments.ad_network_type = 'SEARCH'
  AND segments.date BETWEEN '2026-09-28' AND '2026-09-30'
```

La lectura horaria añade `segments.hour` al `SELECT` y al orden; no transforma una tasa diaria
en una horaria. Cada catálogo utiliza el mismo recurso principal y filtros de entidades activas,
sin segmentos ni métricas, para conservar la identidad de las entidades sin filas reportadas.

Google Help limita Search lost IS (budget) al nivel campaña y advierte que lost IS (rank)
puede no mostrarse en grupos si se agotó el presupuesto durante cualquier parte del período.
Los datos de cuota se actualizan en **1–2 días**: las lecturas recientes pueden cambiar o carecer
de valores. No interpretar su ausencia como caída de cuota ni como prueba de un fallo de entrega.

## Agregación e interpretación

Google documenta una diferencia de denominador relevante: para las tasas top/absolute top se
cuenta como máximo una impresión por anunciante y búsqueda, usando la más prominente. La tabla
de campañas y otras superficies cuentan todas las impresiones, incluso varias de una misma búsqueda.

Por eso, `sum(absolute_top_rate * impressions) / sum(impressions)` es, como máximo, un
**indicador aproximado ponderado por impresiones reportadas**. No se presenta como reproducción
exacta del rate nativo de Google. Debe conservar el alcance, los pesos y la cobertura de valores
conocidos; no incluir nulos ni sentinelas como cero y no certificar el conjunto con cobertura parcial.
La tasa nativa por campaña y período conserva prioridad para conciliación.

Las cuotas IS y lost IS tienen denominadores estimados elegibles. No se agregan exactamente
con pesos de gasto, clics o impresiones recibidas, ni se reconstruyen a partir de sentinelas.
Google indica además que las cuotas se reportan por tipo de campaña y no se agregan a toda la
cuenta. Este endpoint no inventa una cuota consolidada entre cuentas, redes o tipos de campaña.

`conversions` es el total de conversiones Google seleccionado en el reporte, acompañado de
advertencia. **No identifica un evento offline de negocio** ni equivale a ventas offline. Este
módulo no decide acciones principales ni mapeos de eventos. Siguen vigentes los únicos eventos
offline Google autorizados: `MCC_Offline_Lead_Contact` y `MCC_Offline_Purchase`; el mapeo de
negocio pendiente se resuelve por separado. Si se calcula un CPA fuera de este módulo, se usa
la suma de costo dividida por la suma de conversiones comparables, nunca el promedio de CPAs.

## Fuentes y comprobaciones pendientes

Fuentes oficiales consultadas por HTTPS, sin desactivar TLS ni eludir el proxy:

- [Campos Metrics v25](https://developers.google.com/google-ads/api/fields/v25/metrics) y
  [referencia RPC Metrics v25](https://developers.google.com/google-ads/api/reference/rpc/v25/Metrics):
  nombres, definiciones y límites `0.0999`/`0.9001`.
- [Recurso campaign v25](https://developers.google.com/google-ads/api/fields/v25/campaign) y
  [recurso ad_group v25](https://developers.google.com/google-ads/api/fields/v25/ad_group):
  campos admitidos para cada `FROM`; se distingue esa compatibilidad de `selectable_with`.
- [Top y absolute top](https://support.google.com/google-ads/answer/7501826?hl=en):
  rate frente a IS, denominador de la impresión más prominente y exclusión de Search partners.
- [Obtención de datos de cuota](https://support.google.com/google-ads/answer/7103314?hl=en):
  presupuesto a nivel campaña, limitación de rank en grupos, frescura y separación por tipo.
- [Impression share](https://support.google.com/google-ads/answer/2497703?hl=en):
  elegibilidad estimada según segmentación, aprobación y calidad.
- [Filas con métricas cero](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics):
  omisión de filas segmentadas cuyas métricas seleccionadas son todas cero.
- [SDK oficial Python, archivo Metrics v25](https://github.com/googleads/google-ads-python/blob/main/google/ads/googleads/v25/common/types/metrics.py):
  ratios opcionales con presencia. El enlace `main` es mutable; se revisó la estructura v25 en
  la fecha indicada, sin afirmar una versión fijada del paquete Python.
- [ProtoJSON: presencia y valores por defecto](https://protobuf.dev/programming-guides/json/#presence-and-default-values):
  un campo con presencia se emite según su presencia, no según un cero supuesto por el consumidor.

El 2 de octubre de 2026 UTC se ejecutó GAQL diario y horario de campaña/grupo para el día
cerrado **2026-10-01**, en las cuatro cuentas izzi del maestro. Las ocho lecturas pasaron,
con `America/Mexico_City` como reloj de origen en todas. La lectura diaria devolvió 614 filas
(57 campañas y 557 grupos), con tasa disponible en 574; la horaria, 14.736 filas/intervalos,
con tasa disponible en 10.011. Los catálogos conservan entidades sin métricas, con N/D.
Los datos y sus importes se guardaron en archivos privados; no forman parte del repositorio.

La importación detectó y corrigió dos diferencias del contrato consumidor: `share_bounds`
puede omitirse cuando no hay censura y un CTR derivado segmentado puede superar 100%. Se
conserva ese CTR sin ampliar el límite 0–1 de Absolute Top. Ambas tienen regresiones sin red.

Pendientes: contrastar rate, cobertura, volúmenes y cuotas con una exportación independiente
de Google Ads Manager para el mismo período, cuenta, red y nivel; verificar su maduración.
No se confirmó
un denominador deduplicado expuesto por API que permita reconstruir exactamente el rate entre
cuentas. Esta primera lectura no acredita conciliación ni producción.
