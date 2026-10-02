# Verificación real y selección de acciones de Meta

Continuación del 1 de octubre de 2026 desde `claude/auditoria-tiktok-x`, commit `c79b17f`, en
`codex/finalizacion-verificador-meta-x`. Los comandos solo leen las plataformas. No publican,
despliegan ni modifican campañas. La lectura real y la conciliación contra cada interfaz son
comprobaciones distintas.

## Ejecutar

Desde `unified-ads-api/`, con Node 22 o superior y las variables privadas del entorno ya aplicadas:

```bash
npm ci
npm run verificar -- --ayuda
npm run meta:acciones -- --ayuda
```

También se pueden ejecutar en el entorno de Codex si solo se usa el navegador; no hace falta
descargar el proyecto al Mac. No necesitan iniciar Fastify ni configurar `API_KEYS`. Respetan el
proxy y TLS del entorno. `.env`, los almacenes de tokens y `reportes/` permanecen fuera de Git.

## Primera lectura de las plataformas

```bash
npm run verificar
```

Comprueba las seis plataformas, registra las no configuradas sin llamarlas y, para las que tienen
acceso, obtiene cuentas, campañas, presupuestos y salud de entrega si están implementados, y
rendimiento diario de ayer **según la zona de reporting**: UTC para Spotify y Microsoft, zona
informada por la cuenta para las demás. La zona comercial no se inventa ni se confunde con la
zona contractual del informe. Presupuestos y salud son el estado
actual, no una reconstrucción de ayer. No consulta cuentas administradoras como cuentas de gasto.
Una zona desconocida bloquea el cálculo de ayer; `--fecha` permite pedir un día explícito.

Ejemplo acotado para las cuatro cuentas de TikTok autorizadas, sin App ID ni App Secret:

```bash
npm run verificar -- --proveedores tiktok --cuentas tiktok:7338571937913978882,7545502925565771792,7361545670072909840,7688066712031182866 --fecha 2026-09-29
```

Opciones:

| Opción                                                 | Uso                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--proveedores google,meta,tiktok,microsoft,spotify,x` | Limita las plataformas.                                                                                                              |
| `--cuentas plataforma:ID,ID`                           | Limita las cuentas de esa plataforma; se puede repetir. Un ID no descubierto produce un error, no una consulta de todas las cuentas. |
| `--fecha YYYY-MM-DD`                                   | Un día calendario, sin conversión a la zona del equipo.                                                                              |
| `--limite-cuentas 25`                                  | Máximo de cuentas por plataforma; admite 1–1000. Las omitidas se señalan.                                                            |
| `--salida reportes/lectura.xlsx`                       | Ruta de un archivo nuevo; nunca sobrescribe un archivo existente.                                                                    |

El límite adicional de 100.000 filas evita extracciones sin control. Las consultas son secuenciales
y respetan los plazos de cada proveedor; errores, avisos y límites quedan visibles en Cobertura.

El Excel contiene ocho hojas: Cobertura, Conexiones, Cuentas, Campañas, Presupuestos actuales,
Salud de entrega actual, Rendimiento diario y Notas. Se crea con permisos **0600** y nombre único
en `reportes/`. Exporta campos seleccionados: no exporta secretos, cuerpos de error, cabeceras,
callbacks, URL firmadas ni `raw_metrics` completos. Conserva IDs como texto y nombres como texto,
sin interpretarlos como fórmulas. No incluye datos de personas ni consulta hojas externas.

`empty` significa que la API no devolvió filas; no demuestra ventas cero. Una celda vacía mantiene
un dato desconocido y se distingue de un cero explícito. La hoja conserva moneda, zona, acción
principal y alcance de su selección. El valor asociado a `complete_payment` de TikTok se señala
como **unidades no confirmadas**: no debe tratarse como ingreso conciliado. No suma monedas,
eventos superpuestos ni presupuestos compartidos y no promedia CPAs.

Códigos de salida: **0** lectura sin errores ni cobertura limitada; **2** lectura parcial, avisos,
cuentas omitidas o ninguna plataforma comprobada; **1** fallo de opciones, configuración, escritura
o ejecución. Revisa siempre Cobertura, incluso si el archivo se generó.

Los refresh tokens que Microsoft o Spotify roten durante la lectura se guardan en `.env` y,
si está configurado, `TOKEN_STORE_FILE`. La escritura es atómica, con permisos 0600 y conservación
de las otras variables. El comando espera a que termine; un fallo no se oculta ni imprime el token.

## Inventario de acciones de Meta

```bash
npm run meta:acciones
npm run meta:acciones -- --cuentas 111,222 --desde 2026-09-23 --hasta 2026-09-29
```

Los IDs del segundo ejemplo son ficticios. Usa cuentas autorizadas. Sin fechas consulta siete días
hasta ayer en la zona de cada cuenta; un rango explícito debe incluir ambas fechas y no superar
31 días inclusivos. Utiliza `META_ACCESS_TOKEN` y las cuentas configuradas o descubiertas. Si falta
el token y hay terminal interactiva, permite entrada oculta sin guardarlo; desde el navegador usa
las variables privadas existentes del entorno.

El archivo incluye cobertura, detalle diario por campaña, totales por grupo y criterios. Separa
**CAPI WhatsApp**, **Resto** y **Sin nombre**, además de cuenta, moneda y acción exacta. No suma
alias de compras, acciones omnicanal ni eventos superpuestos y no decide la acción principal.
Un importe sin conteo deja el conteo desconocido. Un conteo o importe inválido no se vuelve cero.

Consulta `customconversions` para identificar nombres e IDs, con los campos confirmados en el
[SDK oficial de Meta 26.0.2](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.2/facebook_business/adobjects/customconversion.py):
`id`, `name`, `custom_event_type`, `event_source_type`, `is_archived`. Si no hay permiso para esos
nombres, mantiene las acciones y sus IDs y señala cobertura parcial. Insights utiliza
`action_report_time=impression` y `use_unified_attribution_setting=true`; concilia con ese criterio.

El inventario ignora la selección principal en su copia de configuración para permitir revisarla,
sin cambiar las variables reales ni el mapeo comercial.

## Reglas de acción principal por campaña

La variable opcional `META_PRIMARY_CONVERSION_RULES` admite un arreglo JSON. Este ejemplo es
**ficticio**: no debe activarse sin comprobar las acciones e IDs reales del negocio.

```json
[
  {
    "account_id": "111",
    "campaign_name_contains": "CAPI WhatsApp",
    "action": "onsite_conversion.purchase"
  },
  {
    "account_id": "111",
    "campaign_name_not_contains": "CAPI WhatsApp",
    "action": "offsite_conversion.custom.555"
  }
]
```

Cada regla exige cuenta, acción exacta y **una** condición: `campaign_id`,
`campaign_name_contains` o `campaign_name_not_contains`. Los nombres se comparan como texto literal
sin distinguir mayúsculas; no son expresiones regulares. Se permiten hasta 200 reglas.

Para una cuenta con reglas, estas tienen prioridad sobre el mapeo por cuenta y la acción global.
Si ninguna coincide, conversiones, valor y CPA quedan desconocidos; no se usa la acción global
como respaldo. Si varias coinciden con acciones distintas, la consulta informa `NOT_CONFIGURED`.
Sin reglas para esa cuenta se conserva el comportamiento anterior. `raw_metrics` identifica la
acción y el alcance de selección; una regla no cambia el vocabulario compartido de conversiones.

La regla de negocio permanece: CAPI WhatsApp se mide con **On-Facebook Purchase**; el resto con
**Compras Offline Web (Inbound)**. Solo se suman para la venta total. Los IDs exactos y la acción
por cuenta requieren decisión del equipo; el código no los inventa.

## Selección incremental de X

X Ads API **12** ofrece `GET /stats/accounts/:id/active_entities`, contrastado con la
[referencia oficial de Analytics](https://docs.x.com/x-ads-api/analytics).
Su ventana registra **cambios** en métricas, no es necesariamente el periodo del reporte:
ajustes de facturación y atribución pueden modificar fechas anteriores.

Por defecto se mantienen todas las campañas. Una sincronización incremental puede definir juntas
`X_ADS_ACTIVITY_START_TIME` y `X_ADS_ACTIVITY_END_TIME`, en horas UTC completas y con una ventana
de hasta 90 días. Esta configuración es opcional y **no se activó en el entorno**.

Se valida el contrato de respuesta, entidades conocidas, fechas, ubicaciones y cobertura antes de
seleccionar campañas cuyas fechas de actividad intersectan el reporte. La selección se marca
parcial/incremental. Una respuesta vacía, inesperada o no utilizable conserva todas las campañas
con un aviso. Autenticación, límites de tasa, timeout y cancelación se propagan sin consultas extra
de respaldo. Un filtro explícito de campañas conserva su alcance original.

`verificar` desactiva esa ventana en su copia de configuración para que la primera lectura sea
completa. Tras aplicar el nuevo par, la primera lectura real de X devolvió HTTP 200, tres cuentas,
1288 campañas y 3864 filas diarias del 27 al 29 de septiembre, sin selección incremental:
[X_PRIMERA_LECTURA.md](X_PRIMERA_LECTURA.md). El aviso de evento principal no elegido deja conversiones
y CPA desconocidos. El flujo incremental y la descarga asíncrona aún solo están comprobados con
fixtures; esta muestra síncrona no certifica esos accesos ni sustituye conciliación.

## Validación y pendientes

La suite bloquea `fetch` global y prueba fixtures: reglas ambiguas o sin coincidencia, separación
de acciones, conteos desconocidos, límites, fechas y zonas, escritura privada, rotación de tokens,
selección incremental y respaldo de X, y entrada oculta. Antes de cada commit:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
npm run build
```

La matriz y los pendientes por código, permisos, configuración y negocio están en
[AUDITORIA.md](AUDITORIA.md). Siguen pendientes la conciliación contra interfaces, las unidades no
nulas de compras en TikTok, el permiso de Spotify, la aprobación de X y la descarga de Microsoft
bloqueada por el proxy. Las herramientas no resuelven esos accesos ni deciden eventos comerciales.
