# Arquitectura

```
Google Ads · Meta · TikTok · Microsoft · Spotify · X
                      │
              Unified Ads API  ── /docs (OpenAPI)
                      │
            Capa de normalización
                      │
                  BigQuery ───────────────► Dashboard
                      │
             Motor de monitoreo
                      │
                     n8n ──► WhatsApp / Slack / correo
```

## Principios

1. **Un contrato para todas las plataformas.** Cada integración implementa `AdsProvider`
   (`listAccounts`, `listCampaigns`, `getPerformance`, `getConversions`, `status`) y devuelve el modelo
   normalizado (`NormalizedAccount`, `NormalizedCampaign`, `NormalizedPerformance`,
   `NormalizedConversion`). Una métrica que la plataforma no reporta es `null`, nunca un 0 inventado;
   lo original se conserva en `raw_metrics`.
2. **Un proveedor nunca tumba la API.** Las consultas a varios proveedores corren en paralelo
   (`Promise.allSettled`) con timeout por proveedor; el que falla queda marcado con su error.
3. **No bombardear a un proveedor caído.** Reintentos solo para lo transitorio (429, 5xx, red) con
   espera exponencial y variación, respetando `Retry-After`; tras fallas seguidas, el circuit breaker
   se abre y deja pasar una prueba después del tiempo de espera.
4. **Sin secretos en el código ni en los logs.** Las credenciales vienen de variables de entorno (y
   más adelante de Secret Manager, guardando solo la referencia); los logs ocultan llaves y tokens.
5. **Nada se asume de las plataformas.** Cada fase de integración empieza revisando la documentación
   oficial vigente (versión de la API, autenticación, permisos, límites) antes de programar.

## Modelo normalizado de rendimiento

Campos: `platform`, `client_id`, `account_id`, `account_name`, `campaign_id`, `campaign_name`,
`campaign_status`, `objective`, `date`, `hour`, `currency`, `spend`, `impressions`, `reach`,
`frequency`, `clicks`, `link_clicks`, `conversions`, `conversion_value`, `ctr`, `cpc`, `cpm`, `cpa`,
`video_views`, `video_25`, `video_50`, `video_75`, `video_100`, `source_timezone`, `extracted_at`,
`raw_metrics`.

Fórmulas: CTR = clics / impresiones × 100 · CPC = gasto / clics · CPM = gasto / impresiones × 1000 ·
CPA = gasto / conversiones. Con denominador 0, nulo o no finito el resultado es `null`.

La llave idempotente de una fila histórica es `client_id + platform + account_id + campaign_id + date +
hour` (para `MERGE` en BigQuery sin duplicados).

## Orden de construcción

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 17 → 21 → 23 → 24 → 25 → 20, y
después 16, 18, 19, 22 y 26 en adelante. Las fases no se construyen al mismo tiempo.
