# X Ads: primera lectura real de tres cuentas

Lectura del **1 de octubre de 2026** (hora de Bogotá), en
`codex/finalizacion-verificador-meta-x`, mediante **Ads API 12** y OAuth 1.0a.
Extracción iniciada a `2026-10-02T00:25:54.792Z`; Excel terminado a `2026-10-02T00:27:06Z`.
Rango inclusivo: **27–29 de septiembre de 2026**, granularidad diaria.

Después de aplicar el nuevo par de usuario, `GET /12/accounts` devolvió **HTTP 200** y el
estado del proveedor fue `connected`. Se leyeron todas las cuentas que devolvió discovery,
sin filtro incremental ni selección de campañas. Esto sustituye el bloqueo OAuth anterior;
no certifica acceso a otras cuentas que el usuario pueda administrar fuera de esta identidad.

## Cobertura observada

| Cuenta                      | Account ID    | Moneda | Zona                  | Campañas leídas | Filas campaña/día | Costo del periodo |
| --------------------------- | ------------- | ------ | --------------------- | --------------: | ----------------: | ----------------: |
| iz                          | `18ce53wx5ui` | MXN    | `America/Mexico_City` |            1276 |              3828 |       4167.128471 |
| SKY \| ABCW \| 2024         | `18ce53zbn6a` | MXN    | `America/Mexico_City` |               0 |                 0 |         Sin filas |
| Sky México - Socialand LLYC | `18ce55mysa4` | MXN    | `America/Mexico_City` |              12 |                36 |                 0 |

Total: **1.288 campañas** y **3.864 filas diarias**. El catálogo incluye campañas históricas y
eliminadas; ese total no es el número de campañas activas. Las monedas y zonas de todas las
filas de rendimiento coinciden con los metadatos de sus cuentas. El catálogo vacío de la segunda
cuenta y los ceros devueltos para la tercera se conservan como situaciones distintas.

Se solicitaron `ALL_ON_TWITTER`, `SPOTLIGHT` y `TREND`, grupos `ENGAGEMENT,BILLING,VIDEO`, mediante
reportes síncronos por lotes. No hubo errores de transporte, paginación, tasa ni entidades omitidas.
El único aviso fue `INVALID_REQUEST` con limitación `primary_conversion_not_selected`: no está
configurada una acción principal. Conversiones y CPA permanecen `null`, también en las campañas
con costo. El Excel marca esas operaciones como parciales y el lector terminó con salida 2 por
ese aviso; no significa que se haya recortado el catálogo o que haya fallado el gasto extraído.

También se probaron las rutas reales mediante `app.inject`, con autenticación interna y sin
despliegue: estado de X (`connected`), tres cuentas y tres filas de rendimiento de una campaña
con actividad devolvieron **HTTP 200**. Esa muestra conservó offset **−360 minutos**, moneda MXN,
las tres ubicaciones y conversiones/CPA desconocidos. Esto comprueba serialización y contrato de
la API, no una conexión del monitoreo publicado.

## Totales diarios para conciliar

Archivo: [evidence/x-2026-09-27_29.csv](evidence/x-2026-09-27_29.csv).
Contiene **nueve filas**, una por cuenta y día, comprobadas contra el Excel privado. Para la cuenta
`18ce53wx5ui`:

| Día        |   Costo MXN | Impresiones | Clics normalizados |
| ---------- | ----------: | ----------: | -----------------: |
| 2026-09-27 | 1694.508515 |      152694 |                  0 |
| 2026-09-28 | 1239.592947 |       77519 |                  0 |
| 2026-09-29 | 1233.027009 |      109349 |                  0 |

- `rows_returned`: hay filas. Los conteos explícitos `null` de X se decodifican como cero según
  su contrato; los campos ausentes permanecen desconocidos. Una campaña de la muestra tiene
  `engagements=105` y `clicks=null` original: no se sustituyen clics por interacciones ni se deduce
  ausencia de interacción a partir del cero normalizado. `link_clicks` permaneció desconocido
  en esa muestra. Estas columnas requieren conciliación específica con Ads Manager.
- `no_rows_returned`: catálogo sin campañas y reporte sin filas. Los campos numéricos quedan
  vacíos; no se inventan cero costo o cero conversiones.
- Una celda vacía de conversiones o CPA significa desconocido. No se suman eventos ni se elige
  el principal a partir de esta lectura. CPA, cuando se configure, será suma de costo dividida
  por suma de conversiones; nunca un promedio de CPAs.

Comparar en Ads Manager las mismas cuentas, fechas, moneda, granularidad, ubicaciones y zona.
Se aplicó el offset vigente de `America/Mexico_City` (UTC−06:00), conforme al contrato de X;
el final solicitado a X fue exclusivo, medianoche del 30 de septiembre. La muestra no verifica
transiciones DST ni cambios históricos de zona. Conservar la fecha de extracción porque X puede
revisar gasto y atribución. No hubo conversión de moneda ni redondeo intermedio.

El Excel completo está en `reportes/x-primera-lectura-2026-10-02T00-27-06-328Z-f79cd6.xlsx`,
ignorado por Git y con permisos **0600**. Contiene ocho hojas y filas de campañas; el CSV publicado
solo contiene agregados por cuenta/día. No se registraron secretos, cabeceras OAuth, códigos de
callback, cuerpos OAuth ni URL firmadas. TLS y el proxy se mantuvieron.

## Pendientes

- Conciliar las nueve filas con Ads Manager, incluidos clics, interacciones y el catálogo vacío;
  comprobar si estas son todas las cuentas que debe cubrir la v1.
- Definir el evento principal y su atribución por cuenta; después leer y conciliar conversiones web.
- Validar con datos reales reportes horarios, descarga asíncrona gzip y selección incremental
  `active_entities`. Esta primera lectura no los ejecutó; sus fixtures siguen sin red.
- Confirmar `PUBLISHER_NETWORK` para Ads API 12 antes de ampliar ubicaciones.
- Presupuestos y salud de entrega de X siguen sin implementarse. No se deducen del costo histórico.
- Configurar fuente real, usuarios, persistencia y conexión API del monitoreo según
  [V1.md](../../media-monitoring-center/docs/V1.md). Esta lectura no publica ni declara terminada la v1.

Contrato y fuentes oficiales: [X_ADS.md](X_ADS.md). Matriz vigente: [AUDITORIA.md](AUDITORIA.md).
