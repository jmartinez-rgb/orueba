# Conciliación offline de izzi

`npm run conciliar` prepara una matriz de cuenta/día para **izzi** y compara el histórico
privado validado con una referencia agregada que el operador declara procedente de Ads Manager.
No llama a las APIs, carga `.env`, convierte monedas, cambia relojes, calcula CPA ni decide
eventos. Sky queda fuera del comando, incluso cuando aparece en el mapeo.

Actualmente no existe aquí un export independiente de Ads Manager. Los CSV de `docs/evidence`
y los Excel de `unified-ads-api/reportes` provienen de las APIs: sirven como evidencia de lectura
y controles de ingesta, pero **no son referencias independientes para conciliar**. La etiqueta
`ADS_MANAGER` es una declaración del operador, no una verificación automática de procedencia.

## Preparar el archivo privado

Desde `media-monitoring-center`:

```bash
npm run conciliar -- --from 2026-09-30 --to 2026-09-30
```

El rango es inclusivo y admite de 1 a 45 días reales. Lee exclusivamente la configuración
no secreta inyectada `UNIFIED_ADS_DATA_DIR`, `UNIFIED_ADS_MAPPING` o `UNIFIED_ADS_MAPPING_FILE`.
Los valores predeterminados son `.data/unified` y `config/unified.mapping.json`; no necesita
URL de API, API key ni OAuth. Un mapeo inválido falla, sin inventar cuentas.
En esta instancia el mapeo publicado está en `config/unified.mapping.example.json`; puede
seleccionarlo explícitamente con la variable no secreta, tras revisar que siga representando
las cuentas autorizadas:

```bash
UNIFIED_ADS_MAPPING_FILE=config/unified.mapping.example.json \
  npm run conciliar -- --from 2026-09-30 --to 2026-09-30
```

Genera tres archivos nuevos en `reportes/` (o en `--output reportes/nombre.json`):

- JSON canónico del contrato, resultados, timestamps y política aplicada.
- CSV legible de los totales, subtotales observados y diferencias. `null` es desconocido;
  `0` es una cifra conocida. El ID lleva un apóstrofo para conservarlo como texto y evitar
  fórmulas o redondeos en Excel; el JSON conserva el ID exacto, sin apóstrofo.
- JSON `.reference-template.json` con `origin: "TEMPLATE"`, fecha de exportación y métricas
  vacías. No copia cifras observadas a los valores esperados. El comando rechaza una plantilla
  como referencia real.

Cada archivo tiene permisos `0600`; un directorio nuevo tiene `0700`. Nunca sobrescribe un
archivo existente ni sigue un enlace simbólico de archivo de salida. Si la reserva falla,
retira únicamente los archivos creados por esa ejecución. No es una transacción de tres archivos
frente a la terminación abrupta del proceso: use un nombre nuevo al repetir un intento interrumpido.
Mantenga estas salidas fuera de Git y compártalas únicamente con quienes deban revisar las cifras.

## Obtener la referencia independiente

Exporte de la interfaz publicitaria las cifras agregadas **por cuenta y día completo**, con
todas las campañas y estados, sin filtros de nombre/estado/actividad ni desglose de personas.
Conserve la moneda original, el reloj del reporte, su precisión y la fecha de exportación.
No incluya correos, teléfonos, filas de ventas, cuerpos OAuth o credenciales. No se utiliza la
pestaña **Ventas Detalle**.

Complete una copia de la plantilla a partir de ese export y cambie `origin` a `ADS_MANAGER`:

```json
{
  "version": 1,
  "origin": "ADS_MANAGER",
  "exportedAt": "2026-10-02T12:00:00Z",
  "scope": "ALL_CAMPAIGNS",
  "from": "2026-09-30",
  "to": "2026-09-30",
  "rows": [
    {
      "brand": "izzi",
      "platform": "google",
      "accountId": "ID_EXACTO_COMO_TEXTO",
      "date": "2026-09-30",
      "granularity": "daily",
      "currency": "MXN",
      "timezone": "America/Mexico_City",
      "metricDefinitions": {
        "spend": "ACCOUNT_CURRENCY",
        "impressions": "IMPRESSIONS",
        "clicks": "PLATFORM_CLICKS"
      },
      "spend": null,
      "impressions": null,
      "clicks": null
    }
  ]
}
```

El ejemplo contiene desconocidos y **no demuestra coincidencia**. Use ID textual y números
JSON, sin separadores de miles. Los conteos deben ser enteros seguros no negativos; el costo
es un número finito no negativo. Un campo desconocido conserva `null`. No incluya columnas
adicionales: se rechazan para evitar importar datos personales u otro alcance por accidente.

`PLATFORM_CLICKS` declara la métrica que normaliza el proveedor, no cualquier columna que
contenga la palabra clic. Confirme su definición en la documentación del proveedor y seleccione
la misma en Ads Manager; clics de enlace, clics totales e interacciones pueden diferir.
El comando comprueba el contrato declarado; no puede verificar la columna elegida en la interfaz.

```bash
npm run conciliar -- --from 2026-09-30 --to 2026-09-30 \
  --reference reportes/referencia-ads-manager.json \
  --output reportes/conciliacion-con-referencia.json
```

La referencia debe tener exactamente el rango solicitado; sus filas deben pertenecer a las
cuentas izzi mapeadas y al rango. Se permiten referencias parciales, que quedan pendientes.
Una clave duplicada de marca/plataforma/cuenta/día/granularidad se rechaza, incluso si cambia
moneda o zona. Tampoco se aceptan plantillas, referencias futuras, exportaciones intradía,
archivos no regulares, enlaces de entrada, archivos de más de 8 MiB, URLs ni nombres `.env`.
Los errores muestran códigos; nunca cuerpos del archivo o extractos de JSON inválido.

## Qué significan los resultados

La clave incluye marca, plataforma, cuenta, fecha, granularidad diaria, moneda y zona nativa.
No suma cuentas ni monedas; no convierte un agregado UTC en un día de México. Una partición con
varias zonas queda bloqueada y sus subtotales también son desconocidos. Microsoft y Spotify
usan UTC para reporting aunque la zona comercial de la cuenta sea otra o esté sin definir.
Para otros proveedores se usa la zona de las filas y, cuando faltan, la zona válida del catálogo.
En X, el offset efectivo registrado en el reporte debe coincidir con la zona IANA tanto al
inicio como al cierre del día. Si no coincide, `INCOMPATIBLE_REPORT_OFFSET` bloquea la fila
con `INCOMPATIBLE_CLOCK`; totales y subtotales quedan desconocidos, aunque las cifras coincidan.

Solo compara días cerrados en el reloj nativo. La fecha de extracción de la partición y de cada
fila también debe ser posterior al cierre del día y no estar en el futuro. Los relojes/datos
intradía quedan pendientes; no se proyectan para fabricar un cierre diario.

La cobertura se verifica conservadoramente contra **el catálogo actual**: todas sus campañas
deben aparecer una vez en el reporte diario y ninguna fila puede tener una campaña ajena.
Una campaña omitida, partición vacía o catálogo faltante no implica cero. Esto puede bloquear
reportes históricos legítimos que omiten campañas sin actividad o fueron extraídos antes de
crear campañas actuales. Hasta disponer de cobertura explícita por fecha, ese bloqueo conserva
el desconocido; no prueba un error de la plataforma. `COMPLETE_CATALOG` significa cobertura del
catálogo observado, no certifica que el catálogo sea exhaustivo ni que los permisos cubran todo.

Los campos `sourceMetrics` son totales únicamente con esa cobertura y reloj válidos;
`observedSubtotal` describe solo las filas presentes y no se usa para compararlas con una cuenta
completa. Cada métrica se desconoce si alguna fila tiene `null`; un conteo fraccionario o una suma
fuera del rango numérico seguro también queda desconocido. No se mezclan archivos diarios y horarios.

| Código | Interpretación |
| --- | --- |
| `MATCH` | Coincidencia bajo la política declarada, para esa métrica y alcance. |
| `DIFFERENCE` | Diferencia superior a la tolerancia. |
| `MISSING_REFERENCE` | No hay fila independiente para comparar. |
| `MISSING_SOURCE` | Falta un día completo, catálogo o cobertura de campañas. |
| `INCOMPATIBLE_CLOCK` | Zonas distintas o varias zonas en el mismo agregado. |
| `INCOMPATIBLE_CURRENCY` | La moneda de la referencia difiere del mapeo/origen. |
| `UNKNOWN_METRIC` | La cobertura existe pero la cifra origen o referencia es desconocida. |

La política explícita es **0.01 unidades de moneda de cuenta** para costo y **cero** para conteos.
Esta tolerancia de comparación no cambia presupuestos, tasas ni reglas del monitoreo. Se permite
solo un pequeño margen numérico para la representación binaria. La diferencia es origen menos
referencia; el cociente relativo es `null` cuando la referencia es cero o el cociente no es finito.
El JSON registra extracción de catálogo/partición/filas, exportación de referencia y SHA-256 de
su contenido JSON validado y normalizado, para rastrear cambios de atribución o correcciones.

Salida del comando: **0** si todas las métricas/cuentas/días comparados coinciden sin pendientes;
**2** si hay diferencias, faltantes o desconocidos; **1** si falla configuración, validación o
escritura. Sin referencia independiente nunca devuelve 0. El CSV conserva todas las causas;
el resumen stdout solo informa conteos, códigos y rutas privadas, sin cifras ni nombres.
Una salida 0 no certifica procedencia del export, aceptación de v1 ni producción.

## Pendientes que este contrato conserva

El histórico del monitoreo guarda costo, impresiones y clics; no contiene conversiones, valor,
eventos ni criterios de atribución. No los infiere del costo. La conciliación de eventos requiere
otro contrato y datos explícitos, con grupos separados de Meta **CAPI WhatsApp** y resto, eventos
Google **MCC_Offline_Lead_Contact/MCC_Offline_Purchase** y las decisiones principales aún pendientes
de TikTok/Spotify/Meta. Si después se concilia CPA, será suma de costo / suma de conversiones.

Siguen pendientes los export independientes por cuenta, confirmar las columnas de clics y reloj
de cada interfaz, ampliar fechas/cobertura y definir tasas mensuales en la sección del monitoreo.
El comando conserva USD: no asigna tasas ni decide eventos. El disco histórico debe ser durable
y compartido en producción; los archivos locales no certifican Netlify Functions ni un scheduler.

La ejecución offline local del 2 de octubre sobre el 30 de septiembre produjo **25 filas izzi**,
salida **2**, sin ninguna referencia independiente: 25 `MISSING_REFERENCE` y 24 `MISSING_SOURCE`.
Las causas incluyen 24 coberturas incompletas contra catálogo actual y seis días sin filas diarias
(las causas pueden coincidir). La red estuvo bloqueada durante esta comprobación. Se validaron
**83 pruebas** del contrato, privacidad de archivos y CLI, además de tipos y lint del alcance.
Estos resultados describen esta muestra y no amplían la cobertura histórica ni certifican v1.

## Absolute Top: comparación específica por campaña y grupo

`npm run conciliar` compara totales de cuenta/día y **no acredita Absolute Top**: no contiene
tasas, niveles ni cuotas. Para eso existe `npm run conciliar:absolute-top` (añadido el 2 de octubre
de 2026 en `claude/auditoria-final-v1`). Compara el valor nativo de Google por entidad, guardado en
las auditorías del monitoreo, contra un **export independiente de la interfaz de Google Ads** del
mismo día cerrado, cuenta, reloj, moneda, red y nivel. Solo izzi; no llama APIs ni carga `.env`.

- Métrica principal: **Impr. (Abs. Top) %** = `metrics.absolute_top_impression_percentage`.
  No usar la columna «Search abs. top IS»: es otra métrica con otro denominador. Como defensa,
  el mapa de columnas se rechaza si la tasa apunta a una cabecera con «IS», «share» o «cuota».
- Secundarias opcionales: Impr. (Top) %, Search impr. share, Search lost IS (rank), Search lost IS
  (budget) (solo campaña; Google no la publica por grupo), Impr., Clicks y Cost.
- El agregado de dominio **no se compara**: es un indicador aproximado con otro denominador.
  Campañas y grupos se comparan por separado; nunca se suman entre niveles.

### 1. Fuente madura

Google indica que las cuotas pueden actualizarse durante uno o dos días. El comparador marca
`SOURCE_MATURITY_PENDING` / `REFERENCE_MATURITY_PENDING` si la extracción o el export ocurrieron
antes de **48 h tras el cierre del día** en el reloj de la cuenta, y entonces nunca sale con 0.
La lectura real del 2 de octubre sobre 2026-10-01 se hizo antes de ese umbral (cierre
2026-10-02 06:00 UTC, madurez 2026-10-04 06:00 UTC). Para reproducir esa muestra:

```bash
# Con la configuración privada del entorno autorizado, después de 2026-10-04 06:00 UTC:
npm run absolute-top:sync -- --from 2026-10-01 --to 2026-10-01 --granularity daily
```

### 2. Export independiente desde Google Ads (por cuenta y nivel)

En cada una de las cuatro cuentas del maestro (8779536058, 6214109105, 3224850043, 7367928294):

1. Vista **Campañas** (y después **Grupos de anuncios**), período personalizado de un solo día
   (2026-10-01), filtro *Tipo de campaña = Búsqueda*. Incluir todas las campañas/grupos, sin filtro
   de nombre; el comparador listará como `MISSING_SOURCE` las entidades no activas.
2. Segmentar por **Red (con socios de búsqueda)** y conservar la etiqueta de la Red de Búsqueda
   de Google tal como aparece en el export, o filtrar la vista para excluir socios y declararlo.
   La API excluye socios de búsqueda: incluirlos cambia impresiones y tasas.
3. Columnas: ID de campaña, ID del grupo (nivel grupo), red, código de moneda y las métricas
   anteriores. Descargar CSV. Anotar la hora exacta de exportación (instante ISO con zona).
4. No incluir datos personales ni la pestaña «Ventas Detalle». Guardar fuera de Git.

### 3. Mapa de columnas e importación

Las cabeceras dependen del idioma de la interfaz; el operador las declara textualmente. Hay
ejemplos con cabeceras de la interfaz en inglés en `config/absolute-top-columns.*.example.json`;
copiarlos y **sustituir cada cabecera por la del export real** (no se adivina por parecido).

```bash
npm run conciliar:absolute-top -- importar --csv privado/at-8779536058-campaign.csv \
  --columnas privado/columnas-campaign.json --cuenta 877-953-6058 --nivel campaign \
  --fecha 2026-10-01 --zona America/Mexico_City --moneda MXN --exportado 2026-10-04T15:00:00-06:00 \
  --decimal . --miles , --separador coma --red-etiqueta "Google search" \
  --output reportes/ref-at-8779536058-campaign.json
```

Formato numérico declarado (`--decimal`, `--miles` con `,`, `.`, `espacio` o `ninguno`);
separador `coma`, `punto-y-coma` o `tab`; CSV UTF-8 o UTF-16 con BOM. Se omiten filas
`Total…`; una fila sin ID, otra moneda, otra fecha (si se mapea la columna de día), una celda
fuera de formato, un ID duplicado o cabeceras ausentes detienen la importación con un código y
el número de fila, sin mostrar el contenido. `--` queda desconocido, nunca cero. Solo se aceptan
como límites las censuras publicadas por Google: `< 10%` en Search impr. share y `> 90%` en lost IS.

#### Informe de campañas sin IDs (unión por nombre)

Un informe guardado de la interfaz con solo `Day`, `Campaign`, `Impr. (Top) %` e
`Impr. (Abs. Top) %` también sirve, mapeando `campaignName` en lugar de `campaignId`
(`config/absolute-top-columns.campaign-name.example.json`):

- Solo nivel campaña y solo las dos tasas superiores; cualquier otra métrica mapeada se rechaza.
- Unión por **nombre exacto** normalizado dentro de la cuenta, como con Dataslayer: un nombre repetido
  en el export detiene la importación y uno inexistente o ambiguo en la fuente se reporta
  (`NAME_NOT_FOUND`, `NAME_AMBIGUOUS`), nunca se adivina.
- Sin columna ni filtro de red se declara `TOP_METRICS_SEARCH_ONLY` (las tasas superiores solo existen en
  Búsqueda); `--red-etiqueta` o `--red-filtrada-en-ui` siguen disponibles si el informe los tiene.
- Las filas con un `0` sin signo de porcentaje en ambas tasas (lo que la interfaz escribe para Performance
  Max, Display, Demand Gen o video) se omiten y se cuentan en `skippedRows`; un `0` suelto en una sola
  tasa es una celda inválida. El origen sigue siendo `GOOGLE_ADS_UI_EXPORT`.

```bash
npm run conciliar:absolute-top -- importar --csv privado/absolute-campaign-8779536058.csv \
  --columnas privado/columnas-campana-nombre.json --cuenta 877-953-6058 --nivel campaign \
  --fecha 2026-10-01 --zona America/Mexico_City --moneda MXN --exportado 2026-10-04T21:40:40Z \
  --decimal . --miles , --separador coma --output reportes/ui-at-8779536058-2026-10-01.json
```

#### Informe de grupos de anuncios con ID de campaña y nombre de grupo

Si el informe de grupos trae `Campaign ID` y `Ad group` pero no `Ad group ID`, se mapea `adGroupName`
junto con `campaignId` (`config/absolute-top-columns.ad-group-name.example.json`, `--nivel ad_group`). La
unión es **ID de campaña + nombre exacto del grupo**: Google rechaza dos grupos con el mismo nombre en una
campaña (`DUPLICATE_ADGROUP_NAME`), mientras que entre campañas los nombres sí se repiten. Mismas reglas que
la unión por nombre de campaña: solo las dos tasas superiores, `TOP_METRICS_SEARCH_ONLY` sin columna de red,
filas con `0` sin porcentaje en ambas tasas omitidas y contadas (grupos sin impresiones superiores en
Búsqueda de Google ese día), nombres ausentes o ambiguos reportados y nunca escritos en las salidas.

La fuente incluye todos los grupos habilitados de las campañas activas, también los que no tuvieron
impresiones ese día (métricas N/D); el informe de la interfaz solo lista grupos con datos. Esos grupos
aparecen como `MISSING_REFERENCE` y se explican con sus impresiones N/D en la fuente.

### 4. Comparación

```bash
npm run conciliar:absolute-top -- comparar \
  --referencia reportes/ref-at-8779536058-campaign.json \
  --referencia reportes/ref-at-8779536058-ad_group.json \
  --output reportes/conciliacion-absolute-top-2026-10-01.json
```

Hasta 64 referencias (cuatro cuentas × dos niveles por día). Usa la auditoría diaria completa más
reciente que cubra el día (`--auditoria ID` fija una concreta para una sola cuenta) y advierte
`NEWER_AUDIT_NOT_COMPLETE` si una más nueva falló. Lee el backend de registros inyectado por
`RECORDS_BACKEND`/`RECORDS_DIR`. Escribe JSON y CSV privados (0600, sin sobrescribir, IDs como
texto, sin nombres de cuenta/campaña/grupo); stdout solo muestra conteos y rutas.

| Código | Significado |
| --- | --- |
| `MATCH` | Diferencia dentro de **medio dígito del redondeo mostrado** por la interfaz (p. ej. ±0,005 pp con dos decimales); conteos exactos |
| `BOUND_MATCH` | Ambos lados publican el mismo límite censurado |
| `DIFFERENCE` | Fuera de esa tolerancia, o un lado censurado y el otro exacto |
| `UNKNOWN_METRIC` | Un lado es N/D (`SOURCE_UNKNOWN` / `REFERENCE_UNKNOWN`); no se convierte en cero |
| `NOT_EXPORTED` | La columna no se mapeó |
| `MISSING_SOURCE` / `MISSING_REFERENCE` | La entidad falta en la auditoría activa o en el export |
| `INCOMPATIBLE_CLOCK` / `INCOMPATIBLE_CURRENCY` | Zona o moneda distintas; no se convierten |

Salida **0** solo si todas las entidades de todas las particiones coinciden (`MATCH`/`BOUND_MATCH`)
con la métrica principal comparada, ambos lados maduros y sin motivos pendientes; **2** si hay
diferencias, faltantes, desconocidos o maduración pendiente; **1** ante opciones, archivos o
referencias inválidas. Una referencia intradía o futura se rechaza. La declaración de red
(`SEGMENT_COLUMN` o `FILTERED_IN_UI`) y el origen del export son declaraciones del operador.
`certifiesV1` es siempre `false`.

**Estado al 2 de octubre de 2026:** no hay export independiente en este entorno ni configuración
privada para leer las auditorías guardadas. La comparación está lista y probada con fixtures
(19 casos: formato, censura, N/D frente a cero, niveles, reloj/moneda, madurez, selección de
auditoría, importación UTF-16 y CLI sin red); **la conciliación real sigue pendiente**.

### Referencia independiente de Dataslayer (contraste, no interfaz)

La hoja de Absolute Top que mantiene Dataslayer (`Date`, `Account`, `Campaign`,
`Absolute top impression percentage`, `Top impression percentage`, en porcentaje con dos decimales)
es una **extracción independiente** de la API unificada: sirve para contrastar el valor nativo por
campaña sin comparar la API consigo misma. **No sustituye** el export de la interfaz de Google Ads:
la referencia queda marcada `origin: "DATASLAYER"` en el informe.

```bash
# Descargar la hoja como CSV (o convertirla desde el libro, sin abrir «Ventas Detalle»):
npm run conciliar:absolute-top -- importar-dataslayer --csv privado/hoja-absolute-top.csv \
  --fecha 2026-10-01 --zona America/Mexico_City --moneda MXN \
  --exportado 2026-10-04T12:03:37-05:00 --directorio reportes/referencias-dataslayer
npm run conciliar:absolute-top -- comparar --referencia reportes/referencias-dataslayer/dataslayer-at-8779536058-2026-10-01.json …
```

- `--exportado` es el instante de la última actualización de esa consulta (hoja `DataslayerQueries`,
  columna «Updated»), con su zona. Debe ser al menos 48 h posterior al cierre del día comparado.
- Las cuentas se identifican por el **nombre exacto del maestro** (`google-ads-domains.json`); las demás
  (Sky u otras cuentas izzi) se omiten y se cuentan. Las campañas se unen por **nombre exacto**
  normalizado dentro de la cuenta: un nombre inexistente o repetido se reporta (`NAME_NOT_FOUND`,
  `NAME_AMBIGUOUS`, con el número de fila de la referencia privada) y nunca se adivina.
- Solo nivel campaña y solo las dos tasas superiores: Dataslayer no segmenta por red, y esas tasas
  existen únicamente en la Red de Búsqueda (`TOP_METRICS_SEARCH_ONLY`). Impresiones, clics, gasto y
  cuotas no se comparan por esta vía; las columnas de «Search absolute top impression share» y sus
  pérdidas son otras métricas y no se importan.
- Una celda vacía queda desconocida; `0` en la referencia frente a N/D en la fuente es `UNKNOWN_METRIC`.

La hoja de rendimiento por campaña de Dataslayer excluye por filtro una campaña (`CampaignId`
23619568244), por lo que **no sirve** como total de cuenta con todas las campañas para `npm run conciliar`.

#### Primera ejecución: 1 de octubre de 2026 (salida 2, no concilia)

Ejecutada el 4 de octubre en el equipo del responsable, contra las auditorías diarias guardadas por
`absolute-top:sync` (extraídas 18:51–18:52 UTC) y las referencias de Dataslayer actualizadas a las
17:03:37 UTC. Las cuatro particiones quedan maduras de ambos lados y sin razones de bloqueo.

| Métrica | Comparadas | Coinciden | Difieren | Diferencia absoluta en las que difieren |
| --- | --- | --- | --- | --- |
| Impr. (Top) % | 56 | 54 | 2 | 0,005 pp en ambas (frontera de redondeo) |
| Impr. (Abs. Top) % (principal) | 56 | 19 | 37 | mediana 0,013 pp; p75 0,022 pp; máxima 0,111 pp; 36 de 37 por debajo de 0,1 pp |

- Las 56 filas de Dataslayer encontraron su campaña por nombre (ningún `NAME_NOT_FOUND` ni
  `NAME_AMBIGUOUS`). Una campaña de la fuente (cuenta 8779536058) no tiene fila en Dataslayer
  (`MISSING_REFERENCE`): en la fuente sus impresiones y tasas son N/D (Google no devolvió métricas ese
  día), se guarda como desconocido y no como 0, y el monitoreo no la evalúa. Dataslayer solo lista
  campañas con datos. No es una diferencia de valores.
- En Abs. Top las diferencias no tienen dirección (22 por encima, 15 por debajo) y el cociente
  fuente/referencia va de 0,994 a 1,007. Por cuenta: 4/14, 2/4, 8/24 y 5/14 coinciden (3224850043,
  8779536058, 6214109105, 7367928294).
- Lectura: que Impr. (Top) % coincida descarta un problema de unión, día, reloj o red; el cociente
  descarta que Dataslayer entregue otra métrica (como «Search abs. top IS»); el signo mixto descarta un
  sesgo. **Causa no afirmada.** Candidatas: el instante distinto de extracción (unas 2 h) y la forma de la
  consulta (la API filtra `segments.ad_network_type = 'SEARCH'`; Dataslayer no segmenta por red).
- Efecto operativo: con los mínimos del maestro (70 %, 10 % y 25 %, y la banda «cerca» de 5 pp), las 56
  campañas quedan en el mismo estado (cumple, cerca o debajo) con ambas fuentes; el valor más próximo a
  una frontera está a 0,11 pp de ella. Ninguna alerta cambiaría por estas diferencias.
- La tolerancia no se relajó: medio dígito de los decimales mostrados es el criterio para el export de
  la interfaz. Aceptar una tolerancia operativa para este contraste es una decisión de negocio. E2 se
  cierra con el export de la interfaz de Google Ads del mismo día, no con Dataslayer.

#### Interfaz de Google Ads frente a Dataslayer (1 de octubre)

El responsable exportó el mismo día, después de las 21:40 UTC del 4 de octubre, el informe de campañas
de la interfaz de las cuatro cuentas (sin IDs ni segmento de red; 56 campañas de Búsqueda y 17 filas de
otros tipos con `0`). Comparado con Dataslayer por nombre, reproduce exactamente el patrón de la API: Abs.
Top igual en 19 de 56 y distinto en 37 (22 por encima, 15 por debajo, máximo 0,11 pp); Top igual en 54 y
distinto en 2 (+0,01 pp). En las 12 campañas con mayor y menor diferencia API–Dataslayer cuyos valores de
la API se conocen, **la interfaz coincide con la API dentro del redondeo y no con Dataslayer** (por
ejemplo 17,021 % en la API, 17,02 % en la interfaz y 16,91 % en Dataslayer). La desviación está en la
extracción de Dataslayer.

#### Conciliación API–interfaz, nivel campaña (1 de octubre): 56 de 56

`comparar` sobre las mismas auditorías diarias guardadas (extraídas 18:51–18:52 UTC) contra las cuatro
referencias de la interfaz importadas por nombre (`GOOGLE_ADS_UI_EXPORT`, `CAMPAIGN_NAME`,
`TOP_METRICS_SEARCH_ONLY`; `--exportado 2026-10-04T21:40:40Z`, cota inferior de la hora de exportación;
4, 24, 14 y 14 campañas, 17 filas de otros tipos omitidas). Ambos lados maduros.

| Métrica | Comparadas | Coinciden (±0,005 pp) | Difieren |
| --- | --- | --- | --- |
| Impr. (Abs. Top) % (principal) | 56 | 56 | 0 |
| Impr. (Top) % | 56 | 56 | 0 |

- Salida 2 únicamente por una entidad `MISSING_REFERENCE`: la campaña de la cuenta 8779536058 sin métricas
  de Google ese día (impresiones y tasas N/D en la fuente), que el export no trae como campaña de Búsqueda
  con datos. Explicada; no es una diferencia de valores.
- Con esto E2 queda conciliada **a nivel campaña** para el 1 de octubre. Siguen abiertos el nivel grupo
  (requiere un export con ID de campaña e ID de grupo, porque los nombres de grupo se repiten) y E1
  (costo, impresiones y clics por cuenta y día con `npm run conciliar`).
