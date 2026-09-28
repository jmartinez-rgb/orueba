# BigQuery

BigQuery es la **fuente única de verdad**. La app no asume nombres de tablas ni columnas: todo se
declara en un mapeo. Cuando lleguen proyecto, dataset, tablas y esquemas, la integración se
configura sin cambiar código.

## Pasos para conectar

1. **Service account** con permisos mínimos:
   - `roles/bigquery.jobUser` en el proyecto (ejecutar consultas).
   - `roles/bigquery.dataViewer` en el dataset de métricas (solo lectura).
   - `roles/bigquery.dataEditor` en el dataset de estado de la app.
2. **Tablas propias de la app**: ejecutar `sql/monitoring_tables.sql` en el dataset de estado.
3. **Mapeo**: copiar `config/bigquery.mapping.example.json` a `config/bigquery.mapping.json`
   (no es secreto, se versiona) o ponerlo en `BIGQUERY_MAPPING`. Ajustar tablas y columnas.
4. **Variables** (Netlify): `GOOGLE_CLOUD_PROJECT`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION`,
   credenciales (`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`, o `GOOGLE_SERVICE_ACCOUNT`) y
   `USE_MOCK_DATA=false`.
5. **Verificar**: Integrations → Google BigQuery → *Probar conexión* (`SELECT 1`, sin escanear
   tablas). Si el mapeo es inválido, la app sigue en MOCK y muestra los errores de validación.

## El mapeo

```jsonc
{
  "metricSources": [            // una o varias tablas/vistas; se unen con UNION ALL
    {
      "name": "cortes_monitoreo",
      "table": "tabla",          // "tabla", "dataset.tabla" o "proyecto.dataset.tabla"
      "shape": "cumulative_snapshot",   // o "hourly"
      "platformConstant": null,  // p. ej. "meta" si la tabla es de una sola plataforma
      "timestampTimezone": "UTC",       // o "local"
      "allowExpressions": false, // true permite expresiones simples (cost_micros / 1000000)
      "partition": { "field": "fecha", "type": "DATE" },  // DATE | TIMESTAMP | DATETIME
      "fields": {
        "date": "fecha", "hour": null, "timestamp": "corte_ts", "ingestedAt": "cargado_en",
        "platform": "plataforma", "accountId": "cuenta_id", "accountName": "cuenta",
        "campaignId": "campana_id", "campaignName": "campana",
        "campaignStatus": null, "objective": null,
        "spend": "costo", "impressions": "impresiones", "clicks": "clics",
        "conversions": "conversiones", "leads": "leads", "sales": "ventas",
        "whatsapp": "conversaciones_whatsapp", "calls": "llamadas",
        "purchases": "compras", "revenue": null
      },
      "platformValues": { "bing": "microsoft", "facebook": "meta" },
      "dedupe": null             // { "orderBy": "cargado_en" } solo si la llave es única
    }
  ],
  "budgets": { ... },            // opcional: presupuestos mensuales
  "syncLog": { ... },            // opcional: bitácora de cargas de n8n
  "state": { "alerts": "monitoring_alerts", ... }
}
```

- **Campos en `null` llegan como NULL**, nunca como 0 (p. ej. una plataforma sin WhatsApp).
- Nombres de plataforma de la fuente se normalizan (facebook→meta, bing→microsoft, twitter→x)
  y se pueden extender con `platformValues`.
- Validación estricta: identificadores simples, sin `;`, comentarios ni DDL/DML; si falta algo
  obligatorio se reporta exactamente qué.

### Formas soportadas

| `shape` | Una fila es… | Cómo se evalúa "00:00–12:00" |
|---|---|---|
| `hourly` | Métricas de una hora (fecha + hora local, o timestamp UTC) | Suma de horas 0–11 |
| `cumulative_snapshot` | Totales del día al momento de un corte (p. ej. carga cada 2 h) | Último corte cuya cobertura llega a las 12:00 (tolerancia configurable) |

Los cortes acumulados se convierten a incrementos horarios (diferencia entre cortes repartida en
las horas del intervalo) para que el motor y las gráficas trabajen igual.

## Consultas y costo

Todas en `src/lib/bigquery/queries.ts`, parametrizadas (`@dates`, `@tz`, `@platforms`...):

- Solo columnas mapeadas (sin `SELECT *` sobre tablas de origen).
- Filtro de partición siempre: `IN UNNEST(@partition_dates)` en particiones DATE (poda exacta
  de las 5 fechas de la comparación, ±1 día por zona horaria) o rango en TIMESTAMP/DATETIME.
- Agregación en BigQuery (`SUM` respeta NULL), deduplicación opcional con `QUALIFY`.
- `maximumBytesBilled` por consulta (`BIGQUERY_MAX_BYTES_BILLED`, 5 GB por defecto), etiquetas
  `app=izzi-media-monitoring` y `query=<nombre>` para auditar costo en INFORMATION_SCHEMA.
- Caché por fecha: histórico 6 h, día en curso 4 min. Las fechas faltantes se piden en una sola
  consulta.

Recomendaciones para las tablas de origen: particionar por fecha y agrupar por plataforma y
campaña; si son vistas, que el filtro de fecha se propague a la tabla base.

## Referencias conocidas (a confirmar)

Por el contexto de la cuenta: proyecto `izzi-485718`, dataset `izzi_ads`, raw tables por
plataforma sincronizadas por Apps Script y vistas como `master_google`, `master_meta`,
`control_presupuesto` y `forecast_diario`; el monitoreo cross-plataforma actual acumula cortes
cada 2 horas (Dataslayer). **No están codificados**: hay que confirmar esquemas y granularidad
(¿hay cortes horarios o solo diarios?) y reflejarlo en el mapeo. `control_presupuesto` es
candidata para `budgets` y la tabla de cortes para `cumulative_snapshot`.

Reglas de medición a respetar al mapear: en Meta, venta de campañas *CAPI WhatsApp* =
On-Facebook Purchase (`purchases`) y del resto = Compras Offline Web (Inbound) (`sales`); en
Google, `MCC_Offline_Purchase` (`sales`) y `MCC_Offline_Lead_Contact` (`leads`).

## Tablas de la app

`sql/monitoring_tables.sql` crea `monitoring_alerts`, `monitoring_incidents`,
`monitoring_notifications`, `monitoring_runs`, `monitoring_settings` y
`monitoring_budget_overrides`: append-only, particionadas por día, `payload` en JSON. La app lee
la última versión por `id` con `QUALIFY ROW_NUMBER()`.
