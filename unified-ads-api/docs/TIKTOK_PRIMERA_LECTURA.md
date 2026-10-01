# TikTok: primera lectura real de cuatro cuentas

Lectura del **1 de octubre de 2026**, en `codex/continuacion-tiktok-x`, mediante API v1.3.
Rango inclusivo: **27–29 de septiembre de 2026**, granularidad diaria, atribución por fecha de
interacción del anuncio. Se consultaron exclusivamente las cuatro cuentas indicadas por el usuario.
OAuth funcionó; el token quedó en `.env` privado, ignorado por Git y con permisos 0600. No se
guardan aquí credenciales, códigos, callbacks ni respuestas OAuth.

## Cobertura observada

| Cuenta         | Advertiser ID         | Moneda | Campañas leídas | Filas campaña/día | Filas de conversiones | Gasto del periodo |
| -------------- | --------------------- | ------ | --------------: | ----------------: | --------------------: | ----------------: |
| Sky México     | `7338571937913978882` | MXN    |              43 |                29 |                   232 |          10064.44 |
| Sky Sports MXN | `7545502925565771792` | MXN    |              17 |                10 |                    80 |           1428.63 |
| izzi - ABCW    | `7361545670072909840` | MXN    |             116 |                37 |                   296 |           4393.91 |
| izzi ABCW US   | `7688066712031182866` | USD    |               2 |                 0 |                     0 |         Sin filas |

Total: **178 campañas**, **76 filas de rendimiento** y **608 filas de conversiones** (ocho fuentes
separadas por fila campaña/día). Las cuatro cuentas devolvieron `STATUS_ENABLE`; no hubo errores
ni avisos de paginación o datos parciales. Todos los IDs de campaña del reporte aparecieron en la
lectura de campañas. Estas cifras no equivalen a una conciliación con Ads Manager.

Las peticiones reales a las rutas, mediante `app.inject`, devolvieron HTTP 200: salud, estado de
TikTok (`connected`), cuatro cuentas y 37 filas de rendimiento de izzi - ABCW. Esto comprueba
autenticación interna, registro del proveedor y serialización de respuestas; no es un despliegue.

## Zonas horarias verificadas en los metadatos

| Cuenta         | `timezone` del reporte | Equivalencia   | `display_timezone`    |
| -------------- | ---------------------- | -------------- | --------------------- |
| Sky México     | `Etc/GMT+6`            | UTC−06:00 fijo | `America/Mexico_City` |
| Sky Sports MXN | `Etc/GMT+6`            | UTC−06:00 fijo | `America/Chicago`     |
| izzi - ABCW    | `Etc/GMT+6`            | UTC−06:00 fijo | `America/Mexico_City` |
| izzi ABCW US   | `Etc/GMT+6`            | UTC−06:00 fijo | `America/Mexico_City` |

Se conserva `timezone` para los periodos; no se sustituye por la zona de visualización ni se
infiere a partir del nombre o la moneda. `Etc/GMT+6` tiene el signo invertido de la convención de
offsets y significa UTC−06:00. `America/Chicago` es UTC−05:00 en las fechas de esta muestra:
antes de conciliar Sky Sports, comprobar qué zona aplica a la exportación de Ads Manager. La
correspondencia entre ambas interfaces aún no está conciliada.

## Totales diarios para conciliar

Archivo: [evidence/tiktok-2026-09-27_29.csv](evidence/tiktok-2026-09-27_29.csv).
Contiene **12 filas**, una por cuenta y fecha, con costo, impresiones, clics y cada evento separado.
Los totales diarios se comprobaron contra las filas extraídas. Al importar, tratar `account_id`
como texto para conservar los 64 bits; no convertir monedas ni sumar MXN y USD.

- `data_status=rows_returned`: hay filas para ese día. El costo, impresiones y clics están
  presentes en todas las filas recibidas; los ceros de eventos son valores explícitos de TikTok.
- `data_status=no_rows_returned`: no hay filas. Los campos numéricos quedan vacíos; no se
  inventa gasto o conversiones cero. Esta es la situación de izzi ABCW US en los tres días.
- Una celda numérica vacía significa dato ausente, censurado o no comparable. TikTok devuelve
  `-` para `onsite_shopping` en parte de la muestra; `onsite_shopping_unavailable_rows` cuantifica
  esas filas y su suma de eventos queda vacía cuando es incompleta.
- `conversion` es el evento de optimización heredado, no una acción principal de negocio elegida
  en esta continuación. `cpa_optimization_conversion` = suma de costo / suma de `conversion`;
  queda vacío con denominador cero o ausente. No se promedian los CPAs de campañas.
- izzi - ABCW devuelve **29** `conversion` y **30** `onsite_form` en el periodo. Se mantienen
  separados; no se suman como 59 conversiones ni se usa esa diferencia para elegir la acción principal.
- No se suman alcance, frecuencia, tasas ni acciones potencialmente superpuestas.

En Ads Manager exportar las mismas fechas, moneda, cuentas y criterio de atribución. Comparar
costo, impresiones, clics y cada evento original por día; conservar diferencias, configuración y
fecha de extracción, porque la atribución puede actualizar periodos cerrados.

## Riesgo de valor de compra web

`complete_payment` y `total_complete_payment_rate` llegaron en **cero** en las 76 filas. Esto
verifica que el endpoint acepta y devuelve ambos campos, pero no permite distinguir una tasa
de un importe ni confirmar unidades. La referencia pública de métricas depende de JavaScript;
la página descargada en esta sesión no expone la definición del campo.

El CSV conserva las muestras originales del campo en `raw_total_complete_payment_rate_samples`,
sin sumarlas ni presentarlas como ingresos. La implementación heredada aún asigna ese campo a
`conversion_value`; el riesgo de `tiktok/config.ts` sigue abierto hasta contrastar documentación
con una muestra no nula y la columna equivalente de Ads Manager. No se modificó esa semántica
ni se eligieron eventos de negocio a partir de ceros.

## Pendientes

- Conciliar los 12 periodos contra TikTok Ads Manager, incluida la ausencia de filas de izzi ABCW US.
- Confirmar el significado y las unidades de `total_complete_payment_rate` con evidencia no nula.
- Decidir la acción principal de TikTok por cuenta y el mapeo cuenta → cliente; actualmente los
  cuatro `client_id` quedan en `null` sin una configuración explícita.
- Conservar el token en un gestor de secretos o en la configuración privada del entorno destino.
  El archivo `.env` actual no sustituye ese requisito para una máquina nueva o un despliegue.
  La URL de retorno ya se canjeó y no se debe volver a intercambiar el mismo código.

Fuentes de contrato y flujo: [TIKTOK_ADS.md](TIKTOK_ADS.md). Estado y riesgos de las demás
plataformas: [AUDITORIA.md](AUDITORIA.md).
