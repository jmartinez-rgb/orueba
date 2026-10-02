# Auditoría final hacia la candidata v1 — 2 de octubre de 2026

Rama propia `claude/auditoria-final-v1`. HEAD recibido de `codex/dominios-absolute-top`:
**`07a6ae227bb1117ceaa87526c1909e5fe6ab135f`** (contiene la base funcional `2c8ca56` y la entrega
documental). Árbol local limpio al empezar; sin cambios ajenos. No se hizo push a ramas anteriores,
no se reescribió historial, no se desplegó ni se enviaron mensajes externos.

**Estado: en curso.** Las auditorías independientes de UX/diseño, autorización, integridad/concurrencia
y contratos/datos siguen en ejecución; sus hallazgos se integrarán en este informe. La v1 **no** está
terminada: faltan la conciliación independiente y la aceptación del alojamiento
([checklist](CANDIDATA_V1.md)).

## Línea base propia (fixtures, sin red publicitaria)

Node **22.22.2**, npm 10.9.7, dependencias desde los lockfiles (`npm ci`).

| Proyecto | Comprobación | Resultado |
| --- | --- | --- |
| API | `typecheck`, `lint`, `format:check`, `test`, `build` | Pasa; 775/775 en 39 archivos (base) |
| Monitoreo | `npm run check` | Pasa; 1217/1217 en 89 archivos (base) |
| Monitoreo | `next build --webpack` con mock/Memory, sin archivos privados | Pasa |
| Configuración | `npm run v1:check -- --sin-red` | Salida 2: datos demo, cuentas nominales, registros y API sin configurar en este entorno |

Es la primera ejecución documentada de la suite completa del monitoreo en Node 22 (antes solo la API
tenía CI en Node 22). Este entorno no tiene `.env`, `.env.local`, mapeo privado ni auditorías
guardadas: no hay lecturas reales posibles aquí y no se pidieron secretos.

## Cambios confirmados

| Commit | Cambio | Pruebas |
| --- | --- | --- |
| `83bfa53` | `npm run conciliar:absolute-top`: importador del CSV de Google Ads y comparación por campaña/grupo de Impr. (Abs. Top) % contra las auditorías guardadas ([guía](CONCILIACION.md#absolute-top-comparación-específica-por-campaña-y-grupo)) | 19 nuevas |
| `82d054e` | API, Microsoft: etapa del fallo del informe en `details.stage` y diagnóstico permitido en `npm run verificar` | 10 nuevas |

Después de ambos: API **785/785** (40 archivos) con tipos, lint, formato y build; monitoreo
**1236/1236** (90 archivos).

## Conciliación independiente

El conciliador genérico compara totales de cuenta/día; **no acredita Absolute Top**. Se añadió una
comparación específica: valor nativo por entidad, mismo día cerrado, reloj, moneda, red (solo Búsqueda
de Google) y nivel; tolerancia de medio dígito del redondeo mostrado por la interfaz; madurez de 48 h.
La lectura real previa de 2026-10-01 se extrajo antes de esa madurez, por lo que debe repetirse
después de 2026-10-04 06:00 UTC antes de comparar.

**Bloqueo concreto:** no hay exports independientes de Ads Manager en el repositorio ni en este
entorno (los CSV/Excel existentes provienen de la API). Se necesitan, por cada cuenta izzi
(8779536058, 6214109105, 3224850043, 7367928294), dos exports CSV de 2026-10-01 (campañas y grupos,
solo Búsqueda de Google) con la hora de exportación, más el export por cuenta/día para `conciliar`.

## Microsoft: 502

Hallazgo **alto (diagnóstico)**: el 502 de los últimos reportes izzi es el estado que la API
unificada asigna a cualquier `PROVIDER_ERROR` (`unified-ads-api/src/utils/errors.ts`), y el
monitoreo descarta el cuerpo de la respuesta y guarda solo `API_RESPONSE_ERROR`
(`media-monitoring-center/src/lib/unified/sync.ts`, rama `!response.ok`). Por eso la causa no era
visible. Varios fallos del informe (estado distinto de Success, host de descarga distinto, ZIP
inválido) no traían detalles. **No se afirma la causa**: hipótesis abiertas, cada una ahora
distinguible por `details.stage`/`limitation`:

| Etapa | Qué indicaría |
| --- | --- |
| `report_submit` / `report_poll` con `http_status` 5xx | Fallo del servicio de reporting de Microsoft |
| `report_status` con `report_status` | El informe se generó con error en Microsoft |
| `report_download_url` + `report_download_host_unexpected` | Microsoft cambió la cuenta de almacenamiento; requiere revisión antes de ampliar el host de confianza |
| `report_download` + `report_download_rejected` + `blob_error_code` | Azure rechazó la URL firmada (p. ej. firma expirada o permisos) |
| `report_download` + `report_download_network` | Salida de red/proxy al host de informes |
| `report_parse` | Cambio de formato del ZIP/CSV |

Siguiente paso (con credenciales, lectura acotada, respetando backoff):
`npm run verificar -- --proveedores microsoft --cuentas microsoft:ID --fecha 2026-10-01` y leer la
columna **Diagnóstico** de la hoja Cobertura. El extractor del monitoreo ya aplica espera
exponencial persistida tras un fallo (`src/lib/unified/refresh.ts`).

## X y Spotify

Aprobaciones ya concedidas; no se solicitó aprobación ni se regeneró OAuth. El acceso efectivo no se
puede comprobar en este entorno por falta de credenciales: queda en la checklist (D4).

## Pendientes separados (actualizado al cierre de esta ronda)

| Categoría | Pendiente |
| --- | --- |
| Código | Integrar correcciones de las auditorías independientes; registrar en el monitoreo el diagnóstico seguro de errores de la API (hoy solo `API_RESPONSE_ERROR`) |
| Datos | Exports independientes izzi y conciliación por cuenta/día y por entidad Absolute Top; extracción madura de 2026-10-01 |
| Permisos | Acceso efectivo de X, Spotify y Microsoft desde el entorno autorizado |
| Configuración | Alojamiento durable, URLs HTTPS, secretos de runtime, supervisor de extracción |
| Negocio | Acción principal/IDs Meta, eventos TikTok/Spotify, mapeo offline Google, FX mensual USD→MXN |
