# Datos: conexión, hoja de control, monedas y presupuestos

BigQuery sigue siendo la **fuente única de verdad**: la app solo lee BigQuery (y, opcionalmente, la
hoja de control en Google Sheets, en modo lector). Nunca escribe en las plataformas, en las hojas
ni en las tablas de origen. El navegador nunca se conecta a BigQuery ni a Sheets.

## 1. Dos caminos de ingesta por plataforma

| Modo | Cómo llegan los datos a BigQuery | Cuándo usarlo |
|---|---|---|
| `api` (preferido) | n8n lee la API de la plataforma y hace MERGE en BigQuery (WF01–WF06, ver `docs/N8N.md`) | Cuando hay acceso a la API |
| `sheets` (respaldo) | Dataslayer actualiza Google Sheets → Apps Script sube a BigQuery | Cuando no hay acceso directo a la API |

El modo de cada plataforma se ve en **Integrations → Flujo de datos** y se guarda en
`settings.ingestion` (por defecto todas en `sheets`). Solo cambia cómo se interpreta la hoja de
control y qué pasos se esperan; la lectura de métricas es la misma (BigQuery).

## 2. Hoja de control de ejecución

Confirma en todo momento si **ya se ejecutó todo o hay que ejecutar algo**. Su estado aparece en el
Overview (chip *Carga de datos*), en Integrations y en el mensaje de Monitoreos, y baja la
confianza de datos cuando algo falta.

### Formato

Plantilla lista para importar: [`config/hoja-control.template.csv`](../config/hoja-control.template.csv)
(Google Sheets → Archivo → Importar → pestaña nueva llamada `Control`).

| Columna | Obligatoria | Qué va |
|---|---|---|
| Paso | Sí | Nombre del paso: `Dataslayer · Meta → Sheets`, `Apps Script · Sheets → BigQuery`… |
| Plataforma | No | `google`, `meta`, `tiktok`, `microsoft`, `spotify`, `x` (vacío si aplica a todas) |
| Fuente | No | `Dataslayer`, `Apps Script`, `API`, `n8n`, `BigQuery` |
| Estado | Sí | `OK`, `PARCIAL`, `PENDIENTE`, `EJECUTANDO`, `ERROR` (acepta también `Listo`, `Error`, `Por ejecutar`…) |
| Última ejecución | Sí | Fecha y hora de la última corrida (celda de fecha, `28/09/2026 10:05` o ISO) |
| Filas | No | Filas cargadas en la última corrida |
| Mensaje | No | Detalle del error o aviso |
| Cada (min) | No | Cada cuánto debe correr (default 120) |

Reglas de lectura:

- Un paso está **vencido** si su última ejecución tiene más de `1.5 × Cada (min) + 10` minutos: se
  reporta como *Debe ejecutarse* aunque diga OK.
- Resumen: cualquier `ERROR` → *Con errores: revisar*; algún pendiente o vencido → *Debe
  ejecutarse*; `PARCIAL`/`EJECUTANDO` → *Listo con avisos*; todo OK y al día → *Listo*.
- Fechas sin zona horaria se interpretan en la **zona de negocio** (Settings, por defecto
  `America/Mexico_City`), nunca en la del servidor. Configura la hoja en *Archivo → Configuración →
  Zona horaria: (GMT-06:00) Ciudad de México*. Las fechas con diagonal son día/mes/año.
- Una fecha que no se reconoce queda vacía y el paso cuenta como vencido (nunca se inventa).

### Conectarla

Opción A, directo a Sheets (sin tablas nuevas):

1. Comparte la hoja con el correo de la service account (`GOOGLE_CLIENT_EMAIL`) como **Lector**.
2. En el mapeo (`config/bigquery.mapping.json`) agrega `executionControl` con `"type": "sheets"`, el
   `spreadsheetId` (lo que va entre `/d/` y `/edit` en la URL), el rango (`Control!A1:H50`) y los
   encabezados de cada columna. Ejemplo en `config/bigquery.mapping.example.json`.

Opción B, desde BigQuery: una tabla (o tabla externa sobre la hoja) con `"type": "bigquery"`.
Ejemplo en `config/bigquery.mapping.hourly-example.json`; DDL opcional en
`sql/optional_source_tables.sql` (también trae la tabla de tipo de cambio).

En ambos casos `statusValues` permite declarar los textos exactos que usa el equipo para cada estado.

### Actualizarla desde Apps Script (ejemplo)

La app solo **lee** la hoja. Quien la actualiza son los propios procesos. Ejemplo para pegar en el
Apps Script del libro (Extensiones → Apps Script); no contiene credenciales:

```js
/** Registra (o actualiza) la fila de un paso en la pestaña "Control". */
function registrarEjecucion(paso, plataforma, fuente, estado, filas, mensaje, cadaMin) {
  const hoja = SpreadsheetApp.getActive().getSheetByName("Control");
  const pasos = hoja.getRange(2, 1, Math.max(hoja.getLastRow() - 1, 1), 1).getValues().flat();
  const i = pasos.indexOf(paso);
  const fila = i >= 0 ? i + 2 : hoja.getLastRow() + 1;
  const nFilas = filas === undefined || filas === null ? "" : filas;
  hoja.getRange(fila, 1, 1, 8).setValues([[paso, plataforma || "", fuente || "", estado, new Date(), nFilas, mensaje || "", cadaMin || 120]]);
}

// Al final del script que sube Sheets → BigQuery:
//   registrarEjecucion("Apps Script · Sheets → BigQuery", "", "Apps Script", "OK", filasSubidas, "");
// En el catch del mismo script:
//   registrarEjecucion("Apps Script · Sheets → BigQuery", "", "Apps Script", "ERROR", 0, String(e));

/**
 * Revisa las pestañas que llena Dataslayer (activador por tiempo cada 30 min): si la fecha más
 * reciente de la columna indicada es hoy, marca OK; si no, PENDIENTE.
 */
function revisarDataslayer() {
  const fuentes = [
    // [paso, plataforma, pestaña, columna de fecha (1 = A)]
    ["Dataslayer · Meta → Sheets", "meta", "Meta", 1],
    ["Dataslayer · Google Ads → Sheets", "google", "Google", 1],
  ];
  const hoy = Utilities.formatDate(new Date(), "America/Mexico_City", "yyyy-MM-dd");
  for (const [paso, plataforma, pestana, col] of fuentes) {
    const h = SpreadsheetApp.getActive().getSheetByName(pestana);
    const fechas = h.getRange(2, col, Math.max(h.getLastRow() - 1, 1), 1).getValues().flat().filter((v) => v instanceof Date);
    const ultimo = fechas.reduce((a, d) => Math.max(a, d.getTime()), 0);
    const max = ultimo ? Utilities.formatDate(new Date(ultimo), "America/Mexico_City", "yyyy-MM-dd") : null;
    registrarEjecucion(paso, plataforma, "Dataslayer", max === hoy ? "OK" : "PENDIENTE", h.getLastRow() - 1, max === hoy ? "" : "Último dato: " + (max || "sin datos"), 120);
  }
}
```

## 3. Varias cuentas por plataforma

Cada plataforma puede tener varias cuentas (Google, Meta, etc.). La cuenta sale de las columnas
`accountId`/`accountName` del mapeo. Cada cuenta:

- se evalúa por separado y además suma a su plataforma;
- si está atrasada se **excluye** de la comparación de su plataforma (plataforma *Parcial*) sin
  contaminar a las demás, y descuenta confianza según su peso en el gasto;
- aparece en el detalle de la plataforma, en Budget Control, en Compare (dimensión *Cuenta*) y en
  el mensaje de Monitoreos (conversiones por cuenta).

## 4. Monedas (MXN y USD)

Todo se reporta en **MXN**. Las cuentas en USD se convierten con la **tasa del mes de cada fecha**
(1 USD = N MXN), también en presupuestos.

1. **Moneda de cada cuenta**: columna `currency` del mapeo (acepta `USD`, `usd`, `US$`,
   `Dólares`…; todo lo demás es MXN). Se puede corregir por cuenta en *Settings → Moneda*.
2. **Tasa mensual**: se captura en *Settings → Moneda* o se lee de una tabla con `fxRates`
   (`mes`, `tasa`, opcional `moneda`; acepta `18,45` o `18.45`). La de Settings tiene prioridad.
3. **Mes sin tasa**: se usa la del mes anterior y se avisa (−5 de confianza por mes). **Sin ninguna
   tasa**: el gasto en USD queda NULL (nunca se inventa una conversión) y la confianza baja 25.

## 5. Presupuesto a nivel cuenta o campaña

Algunas cuentas tienen un presupuesto único y otras uno por campaña. Budget Control detecta el
nivel con los datos de `budgets` y pide confirmarlo:

| Detectado | Qué significa | Qué se usa para el pacing |
|---|---|---|
| Cuenta | Solo hay monto de cuenta | El monto de la cuenta |
| Campaña | Solo hay montos por campaña | La suma de las campañas (`campaign_sum`) |
| Mixto | Hay ambos | **Requiere confirmación**: se elige cuenta o campaña para no duplicar |
| Sin presupuesto | No hay montos | Solo se muestra el gasto |

La confirmación se guarda en `settings.budgetLevels` (solo administradores y co-administradores).
Es una lectura del monitoreo: no cambia ningún presupuesto en las plataformas.

## 6. Estrategias (clasificadores)

La estrategia de cada campaña se calcula igual que las fórmulas de la hoja del equipo:

- **Meta**: nombre de campaña (columna C) y un campo secundario (columna D, donde se busca
  `LEAD`). En el mapeo: `campaignName` y `campaignType` u `objective` (si no hay `campaignType`, se
  usa el objetivo, p. ej. `OUTCOME_LEADS`).
- **Google**: nombre de campaña (columna D) y, si ninguna regla coincide, el tipo de campaña
  (columna L). En el mapeo: `campaignName` y `campaignType` (`advertising_channel_type`).

Las reglas se editan en *Settings → Clasificadores* y se prueban en la *Guía*. Detalle de reglas en
[`docs/GUIA.md`](GUIA.md#clasificadores-de-estrategia).

## 7. Registros de la app (no son métricas)

Bitácora de accesos, tickets, acuses de alertas críticas e historial de mensajes de Monitoreos se
guardan en **Netlify Blobs** (en local, `.data/records`, ignorado por git). No se duplican
métricas: las métricas viven solo en BigQuery. Ver `docs/AUTH.md`.
