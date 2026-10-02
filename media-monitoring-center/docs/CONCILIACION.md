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
