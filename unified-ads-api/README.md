# Unified Ads API

API intermedia entre las plataformas publicitarias (Google Ads, Meta, TikTok, Microsoft Advertising,
Spotify y X) y los sistemas internos (n8n, BigQuery, dashboard, alertas y WhatsApp). Cada plataforma
se traduce a un **modelo normalizado** y el resto de los sistemas nunca necesita conocer cómo funciona
cada API: n8n solo pregunta a esta API.

## Estado

| Fase | Contenido                                | Estado                                                         |
| ---- | ---------------------------------------- | -------------------------------------------------------------- |
| 1    | Infraestructura base (sin integraciones) | **Lista**                                                      |
| 2    | Google Ads                               | Pendiente (se revisa primero la documentación oficial vigente) |
| 3    | Meta Marketing API                       | Pendiente                                                      |
| 4    | TikTok Ads                               | Pendiente                                                      |
| 5    | Microsoft Advertising                    | Pendiente                                                      |
| 6    | Spotify Ads                              | Pendiente                                                      |
| 7    | X Ads                                    | Pendiente (puede requerir aprobación de acceso)                |

La Fase 1 ya incluye piezas que las integraciones van a usar: fórmulas normalizadas (CTR, CPC, CPM,
CPA sin NaN ni Infinity), reintentos con espera exponencial y variación (respetan `Retry-After`),
circuit breaker (CLOSED / OPEN / HALF_OPEN), timeouts por proveedor y consulta en paralelo donde un
proveedor que falla no tumba la respuesta.

## Endpoints

| Método | Ruta                                  | Llave | Descripción                                                                      |
| ------ | ------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`                      | No    | Salud del servicio (Cloud Run, Docker, n8n)                                      |
| GET    | `/api/v1/providers`                   | Sí    | Los seis proveedores y su estado                                                 |
| GET    | `/api/v1/providers/{provider}/status` | Sí    | Estado de un proveedor (`google`, `meta`, `tiktok`, `microsoft`, `spotify`, `x`) |
| GET    | `/docs`                               | No    | Documentación Swagger (OpenAPI 3); `/docs/json` es la especificación             |

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
