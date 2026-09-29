# Datos: conexión, hoja de control, monedas y presupuestos

La app lee los datos de **una** fuente: la **hoja de Google Sheets que llena Dataslayer**
(`DATA_SOURCE=sheets`, la opción en uso), o BigQuery (`DATA_SOURCE=bigquery`). Solo lee: nunca
escribe en las plataformas, en las hojas ni en las tablas. El navegador nunca se conecta a Sheets
ni a BigQuery. La instalación completa está en [`docs/INSTALACION.md`](INSTALACION.md).

## 0. Lectura directa de la hoja de Dataslayer

`config/sheets.mapping.json` declara qué pestaña trae cada plataforma y cómo se llaman sus
columnas (ya viene configurado para la hoja "MONITOREO", ID
`1WjLM2CSsIiuNuJrGSRFe-5SMkvhI59cKp5cZpq7fxCc`):

| Pestaña | Forma | Qué aporta |
|---|---|---|
| `Google` | diaria por campaña | gasto, impresiones, clics, conversiones, moneda |
| `Google Conversiones` | diaria por campaña, formato largo | ventas (`MCC_Offline_Purchase`), leads (`MCC_Offline_Lead_Contact`), llamadas (`Calls from ads`) y tipo de campaña; otras acciones no suman métricas |
| `Meta` | diaria por campaña | gasto, leads, conversaciones, llamadas (20s Calls Placed), ventas (Compras Offline Web), compras (On-Facebook Purchase), moneda; conversiones = ventas + compras |
| `TikTok` | diaria por campaña | gasto, impresiones, clics, conversiones, moneda |
| `Bing` | diaria por campaña | gasto, impresiones, clics, conversiones (MXN) |
| `Spotify` | diaria por campaña, un día de atraso | gasto, impresiones, clics (sin cuenta: se fija en el mapeo). `"intraday": false`: no se vigila en vivo |
| `Google \| Hora`, `Meta \| Hora`, `TikTok \| Hora`, `Bing \| Hora` | por hora y cuenta (opcionales) | curva horaria real del día |
| `DataslayerQueries` | — | hora y estado de la última actualización de cada consulta |

Cómo se interpretan:

- **Sin IDs**: la hoja no trae IDs de cuenta ni de campaña; la llave sale del nombre
  (`google-izzi-ofertas`, `google-izzi-ofertas-mxsur-cpc-manual`; los nombres largos llevan una
  huella para no chocar). Si otra pestaña sí trae IDs, las llaves por nombre se unen al ID real.
- **Solo la historia necesaria**: la app lee la fila de encabezados (en caché 10 min), la columna
  de fecha y después solo las filas desde hace 45 días (semanas de comparación de Settings × 7 +
  10, mínimo 45). Dataslayer escribe ordenado por fecha; si una pestaña no lo está, se lee completa.
- `Ventas Detalle` no está en el mapeo y nunca se lee (contiene teléfonos).
- **La fila de hoy es el acumulado** hasta la actualización de Dataslayer (hora de
  `DataslayerQueries`, convertida desde la zona de la hoja a la de negocio). Esa hora define hasta
  dónde cubre el día y la frescura de la plataforma y de todas sus cuentas.
- **Franja horaria**: el total diario de cada campaña se reparte por hora con la curva real de su
  cuenta ese mismo día (pestañas por hora). Sin ellas se usa una curva típica, la app lo avisa
  ("Curva por hora · Parcial") y baja 10 puntos de confianza. La suma de las horas siempre es el
  total de la hoja. Con una semana en la pestaña por hora basta: la app aprende la curva real de
  cada cuenta (y de la plataforma) con esos días y la usa para repartir los días que no tienen datos
  por hora, como las semanas de referencia más viejas. Con curva típica, las alertas que dependen del gasto esperado a esa hora bajan
  un nivel (máximo ALERTA) y no se declara "dejó de gastar"; el costo por resultado y el gasto en
  cero no dependen de la curva y se evalúan igual.
- **Memoria del acumulado del día** (plataformas sin pestaña por hora, p. ej. TikTok y Bing): en
  cada actualización de Dataslayer la app anota cuánto llevaba gastado cada cuenta a esa hora
  (`curves/<plataforma>` en Netlify Blobs o `.data/records`, últimos 35 días). Cuando el día cierra,
  divide cada acumulado entre el total final y, con 3 días o más, usa esa curva real en lugar de la
  típica. Solo necesita que Dataslayer actualice cada 2 h y que la app lea la hoja en ese lapso
  (evaluaciones de n8n o alguien abriendo la app). Spotify no aplica: sus datos llegan al día
  siguiente.
- **Métricas con retraso** (`laggingMetrics` en el mapeo): las conversiones de Google
  (`conversions`, `sales`, `leads`, `calls`) y las de Meta que incluyen ventas offline (`sales`,
  `conversions`) se suben horas o días después. En la evaluación del día no se juzgan; al cierre sí.
  Medido con la hoja: a las 11:00 Google llevaba 4% de sus conversiones de un martes normal con 22%
  del gasto, y las Compras Offline Web de Meta iban en cero.
- **Métrica monitoreada por omisión** (`defaultKpi`): TikTok usa `conversions` porque la hoja no
  trae leads. Lo que se elija en la tarjeta de la plataforma (Overview o Métricas) manda.
- **Campañas sin fila**: Dataslayer no escribe filas sin actividad; con la pestaña actualizada hoy,
  una campaña que gastó ayer y hoy no aparece cuenta como **gasto cero** (así se detecta que dejó de
  gastar). Una **celda vacía** es NULL, nunca cero.
- **Actualización en curso** (cada 2 h, tarda 5–10 min): si una pestaña llega vacía o recortada a
  menos del 40%, se usa la última lectura completa (hasta 6 h) y se marca "en ejecución".
- **Números**: se leen sin formato (moneda, porcentaje o separadores de la hoja no afectan).
- **Caché**: la hoja se vuelve a leer como máximo cada 5 minutos (`cacheSeconds`), con tres
  lecturas en lote (encabezados, fechas, filas). *Actualizar ahora* fuerza una lectura nueva y
  guarda la evaluación de izzi y de Sky.
- **Evaluación guardada sin n8n**: al abrir la app, si pasaron 2 horas desde la última evaluación
  guardada o aparece un incidente crítico nuevo, se guarda sola (así los incidentes conservan folio
  y hora de inicio).
- **Plataformas**: solo se monitorean las que aparecen en el mapeo con datos del día
  (`intraday`), y en cada marca solo las que tienen cuentas de esa marca.
- **Estado de alertas e incidentes**: en este modo se guarda en Netlify Blobs (no hay tablas de
  BigQuery), por separado para izzi (`state/…`) y Sky (`state/sky/…`).

### Marcas: izzi y Sky

Cada marca es un monitoreo aparte; el botón **izzi | Sky** de la barra superior cambia entre ellas
(se recuerda por navegador) y cada botón muestra el estado general de su marca y cuántos críticos
tiene abiertos. La marca se decide así (`src/lib/brands.ts`):

1. Por el **nombre de la cuenta**: si menciona solo "Sky" es Sky; si menciona solo "izzi", izzi.
2. Si la cuenta es **mixta** ("izzi - Sky Social") o no menciona ninguna, decide el **nombre de la
   campaña** ("Sky / Seguidores…" → Sky).
3. Si tampoco, es **izzi**.

Con la hoja actual: Sky = Google `Sky - ABCW`; Meta `Sky Performance - MXN`, `Sky - MXN`,
`Sky Sports` y las campañas "Sky / …" de `izzi - Sky Social`; TikTok `Sky México` y
`Sky Sports MXN`. Todo lo demás es izzi (incluidas campañas de izzi que promocionan Sky Sports).

Cada marca tiene sus propias alertas e incidentes (los de Sky con folio `SKY-INC-0001`), tickets,
mensajes de Monitoreos y presupuestos de referencia. Los presupuestos por plataforma o total sin
columna `Marca` se asignan a izzi. La evaluación programada (`/api/monitoring/evaluate`) evalúa las
dos marcas y devuelve el resultado de cada una en `brands`; los WhatsApp dicen "IZZI MEDIA ALERT" o
"SKY MEDIA ALERT".

Para cambiar el mapeo (pestaña renombrada, columna nueva) basta editar `config/sheets.mapping.json`:
cada columna acepta un nombre o una lista de alternativas, y una métrica puede sumar columnas
(`{"sum": [...]}`) o salir de un formato largo (`pivot`).

## 1. Dos caminos de ingesta por plataforma

| Modo | Cómo llegan los datos a BigQuery | Cuándo usarlo |
|---|---|---|
| `api` (preferido) | n8n lee la API de la plataforma y hace MERGE en BigQuery (WF01–WF06, ver `docs/N8N.md`) | Cuando hay acceso a la API |
| `sheets` (respaldo) | Dataslayer actualiza Google Sheets → Apps Script sube a BigQuery | Cuando no hay acceso directo a la API |

El modo de cada plataforma se ve en **Integrations → Flujo de datos** y se guarda en
`settings.ingestion` (por defecto todas en `sheets`). Solo cambia cómo se interpreta la hoja de
control y qué pasos se esperan; la lectura de métricas es la misma (BigQuery).

## 2. Hoja de control de ejecución

> Con la lectura directa de la hoja (sección 0), la pestaña **`DataslayerQueries`** cumple esta
> función sola: no hay que crear nada. Lo que sigue aplica al modo BigQuery o a pasos adicionales
> (por ejemplo, un Apps Script propio).

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
