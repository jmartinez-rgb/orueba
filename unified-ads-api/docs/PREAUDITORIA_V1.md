# Preauditoría de v1 — 2 de octubre de 2026 UTC

## Continuación de la preauditoría — 2 de octubre de 2026 UTC

Base: `fe7a62e`, misma rama `codex/finalizacion-verificador-meta-x`. Esta sección prevalece
sobre los pendientes y conteos de la primera ronda más abajo. No se publicaron cambios ni se
consultaron plataformas publicitarias en esta continuación; se avanzó en integridad y acceso.

| Archivo y línea                                                   | Problema comprobado                                                                                                                                                                  | Corrección y alcance                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media-monitoring-center/src/app/api/settings/route.ts:29`        | PUT/DELETE desde una pantalla antigua revertían o borraban cambios posteriores; dos capturas del mismo mes se sobrescribían. Tres regresiones respondían 200 antes de la corrección. | PUT/DELETE requieren `If-Match`, ligado al contenido, marca y modo; 428 sin revisión y 412 si cambió. PATCH de tasas/monedas requiere el valor anterior del campo. Meses distintos siguen siendo independientes.                                          |
| `media-monitoring-center/src/lib/services/context.ts:162`         | La revisión podía cambiar entre leer la configuración y guardarla.                                                                                                                   | El guardado exige la base leída y usa `RecordStore.update`. En Blobs, CAS por clave evita sobrescribir otra versión; un conflicto no genera bitácora de éxito. Reset guarda JSON null condicionalmente. BigQuery sigue protegido solo dentro del proceso. |
| `media-monitoring-center/src/lib/auth/user-admin.ts:120`          | Altas/ediciones simultáneas perdían usuarios, versiones de revocación o cambios del acceso universal. La comprobación de contraseña podía quedar desactualizada antes del guardado.  | Cola compartida del proceso abarca lectura fresca, validación y escritura. Trece regresiones cubren carreras, duplicados, borrados, revocación y liberación ante errores. Usuarios entre instancias siguen pendientes de CAS/transacción.                 |
| `media-monitoring-center/src/lib/auth/user-admin.ts:176` y `:316` | El principal no podía cambiar su contraseña; usar su correo eludía su protección en una actualización y podía duplicar la identidad.                                                 | Identidad canónica para proteger y persistir; autocambio verifica y guarda en la misma cola con la identidad real. Se preservan Juan Pablo, los 15 usuarios y los cinco responsables.                                                                     |
| `media-monitoring-center/src/lib/records/store.ts:180`            | El SDK instalado `@netlify/blobs` 11.1.1 devuelve `modified:true` incluso ante HTTP 401 en una escritura condicional. Confirmado con fetch simulado del SDK real.                    | Guard de HTTP antes del SDK, comprobación de ETag y hasta cinco intentos CAS. Errores no incluyen cuerpos, URL ni credenciales. File/Memory serializan por clave y raíz dentro del proceso; no se certifica Blobs real ni varios procesos por archivo.    |
| `media-monitoring-center/src/lib/records/incident-reviews.ts:25`  | Dictámenes concurrentes se perdían; repetir un append después de una respuesta perdida podía duplicarlo.                                                                             | Append mediante CAS; UUID por operación y últimos 50 recibos evitan duplicación en esa ventana. Fixtures prueban dos actores y una escritura aplicada con respuesta ambigua. Registros anteriores siguen admitidos.                                       |

La interfaz conserva los borradores de tasas de otros meses después de guardar uno. Settings
mantiene los cambios locales ante conflicto y ofrece una recarga explícita que avisa que los
reemplazará. Los campos se bloquean durante guardado/recarga. Si DELETE funciona pero falla
la recarga, se informa que el restablecimiento se aplicó y queda pendiente cargar los valores.
Estos ajustes de interfaz se revisaron también de forma independiente; no se certificó una
prueba visual automatizada del navegador.

**Validación final:** API `typecheck`, `lint`, `format:check`, **626 pruebas/33 archivos**.
Monitoreo `npm run check`: **367 pruebas/38 archivos**, más build de Next.js. Hay 57 pruebas
nuevas, sin saltos ni cuarentenas. HTTP local: GET Settings 200; PUT/DELETE antiguos 412;
PUT sin revisión 428; tasa con valor anterior distinto 412. La configuración permaneció
idéntica, sin tasas ficticias. Login nominal, 15 cuentas y health de API 8086 comprobados.
Monitoreo local en 3000; no son URL públicas. No se cambiaron contraseñas reales.

**Pendientes separados:**

- **Código:** CAS/transacción de usuarios y otros escritores de registros aún incondicionales;
  evaluación multiclave y outbox/idempotencia de notificaciones; bitácora financiera durable.
  La primitive CAS no garantiza ejecución única de cualquier transformación: deben ser puras
  y deduplicar operaciones si hay respuesta perdida. File/Memory no protegen otros procesos;
  BigQuery no tiene CAS aquí. Permanecen cobertura/DST, transporte Microsoft con DNS fijado
  compatible con proxy y muestra no nula de `total_complete_payment_rate`.
- **Permisos:** ningún acceso nuevo fue comprobado. Spotify USD adicional continúa fuera
  del mapeo autorizado; no repetir OAuth para un límite de cuota de X.
- **Configuración:** validar CAS/ETag, persistencia y reinicio en Netlify real; definir volumen
  y scheduler; capturar tasas mensuales del equipo y llevar identidades privadas al destino.
- **Negocio/datos:** conciliación por reloj/moneda/atribución y eventos principales pendientes.
  Se mantienen las reglas de Meta, los dos eventos offline válidos de Google y CPA agregado.

V1 continúa pendiente de auditoría y aceptación.

## Primera ronda de preauditoría (base `df5aeac`)

Rama: `codex/finalizacion-verificador-meta-x`. Base de esta revisión: `df5aeac`.
Se corrigieron seis problemas de acceso, integridad y disponibilidad antes de la siguiente
auditoría de Claude. No se declara v1 terminada ni aceptada para producción.

## Hallazgos y correcciones

| Prioridad | Archivo y línea                                                                                                            | Defecto comprobado                                                                                                                                                                                | Resultado y prueba                                                                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alta      | `media-monitoring-center/src/lib/auth/users.ts:93`                                                                         | Una marca desconocida se filtraba hasta `[]` (todas las marcas); permisos mal formados restauraban los del rol; `active: "false"` activaba la cuenta. Identidades duplicadas resultaban ambiguas. | Los registros inválidos bloquean la comprobación de acceso sin volver a credenciales del entorno. También se valida la configuración universal. Fixtures de corrupción, duplicados, defaults heredados y migración nominal con versión cero.                                                                       |
| Alta      | `media-monitoring-center/src/lib/auth/config.ts:114`                                                                       | Credenciales de contraseña configuradas pero inválidas cambiaban el modo efectivo a abierto en desarrollo.                                                                                        | El modo queda bloqueado. Tres casos prueban lista vacía, JSON inválido y hash inválido. La demo local sin configuración conserva su comportamiento.                                                                                                                                                                |
| Media     | `media-monitoring-center/src/lib/unified/store.ts:10`                                                                      | La lectura del histórico no detectaba campañas/filas duplicadas. El guardado validaba tipos, pero podía sustituir una partición válida por filas de otra cuenta o granularidad.                   | Lectura y escritura validan el mismo alcance y unicidad. Corrupción y escrituras inválidas fallan sin duplicar gasto ni reemplazar el histórico correcto. Se rechazan fechas inexistentes.                                                                                                                         |
| Media     | `media-monitoring-center/src/lib/unified/sync.ts:45`                                                                       | `primary_conversion_not_selected` se toleraba sin verificar código, plataforma, cuenta ni ruta; otras excepciones no comprobaban toda su procedencia.                                             | La excepción corresponde únicamente al contrato actual de X en rendimiento; errores de acceso/cuota, otras cuentas o proveedores siguen bloqueando. Fixtures reproducen esos casos. Granularidades no admitidas se rechazan antes de tocar red o disco.                                                            |
| Media     | `media-monitoring-center/src/app/api/settings/route.ts:38` y `media-monitoring-center/src/lib/services/settings-lock.ts:6` | Dos PATCH de meses distintos respondían 200 pero perdían una tasa. DELETE propagaba errores del almacén sin la respuesta controlada.                                                              | PUT/PATCH/DELETE serializan lectura, cambio y escritura dentro del proceso; DELETE devuelve error controlado. La prueba concurrente falló antes de la corrección y ahora conserva ambos meses. El fallo de una operación no bloquea la siguiente.                                                                  |
| Media     | `unified-ads-api/src/providers/spotify/queries.ts:163`                                                                     | Spotify devolvía HTTP 502 al pedir `REVENUE` por hora y se perdían también las métricas base válidas.                                                                                             | Se vuelve a pedir el bloque entero sin REVENUE solo ante ese 502 horario. Se descartan páginas parciales, se conservan límites/IDs/fechas y se avisa que ingresos son desconocidos. No se ocultan errores 401/403/429/500 ni fallos de la recuperación. Siete regresiones sin red; tres fallaron antes del cambio. |

`media-monitoring-center/src/app/(app)/layout.tsx:13` comprueba también `internal:view`, igual que
las API. Es defensa adicional: los roles internos válidos ya reciben ese permiso por compatibilidad;
no se presenta como una vulnerabilidad demostrada en cuentas actuales. Dos pruebas ejercen el límite.

## Spotify: contrato y lectura real acotada

Se volvió a consultar la [referencia oficial v3 Aggregate Report](https://developer.spotify.com/documentation/ads-api/reference/v3.0/getAggregateReport).
Admite HOUR y enumera REVENUE: el 502 observado es un fallo del backend, no una prohibición
contractual que se pueda generalizar a todas las cuentas. Las pruebas reales de la cuenta izzi
`f154306e-82ce-4c8b-a772-09140c1a24c6` separaron campos: base, alcance/frecuencia y video funcionaron;
agregar REVENUE produjo 502. La recuperación mantiene ingresos desconocidos y una advertencia
`revenue_unavailable` con `retry_without_revenue=true`, solo después de recuperar el bloque completo.

Con la API corregida se ejecutó:

```bash
cd media-monitoring-center
npm run unified:sync -- --from 2026-09-30 --to 2026-10-01 --provider spotify --granularity hourly
```

Salida 0: **30 filas horarias** guardadas, 24 del 30/09 y seis del 01/10, **UTC/MXN**.
El adaptador del monitoreo leyó 24 filas correspondientes al 30/09 en el reloj mexicano,
sin trasladar conversiones de negocio. Los totales originales para conciliar están en
[el CSV agregado](../../media-monitoring-center/docs/evidence/spotify-hourly-2026-09-30_10-01.csv).
Las cifras pueden revisarse entre extracciones; el CSV refleja la carga guardada, no la primera
sonda de diagnóstico. Las horas ausentes no se convierten en ceros y no se certifica cobertura
completa de todas las campañas ni conciliación con Ads Manager.

Esta ronda reconsultó solamente Spotify. Microsoft conserva la descarga real previa de su ZIP;
X conserva el bloqueo horario por cuota observado anteriormente.

## Validación

- API: `npm run typecheck && npm run lint && npm run format:check && npm test`;
  **626 pruebas, 33 archivos**, sin pruebas omitidas. `npm run build` pasó.
- Monitoreo: `npm run check`; **310 pruebas, 34 archivos**, tipos y lint. Build de Next.js pasó.
- HTTP local: login nominal por correo, consulta de tipo de cambio, administración y denegación
  de edición para operador/cliente; principal y Hernán administran, Daniel no administra usuarios.
  Cliente redirige a su vista; health de la API responde 200.
- `v1:check -- --sin-red --registros`: configuración reconocida y `RECORD_IO_VERIFIED`.
  Salida 2 esperada: esta modalidad no valida proveedores ni significa aceptación de v1.

API local actual: **8086**, monitoreo: **3000**. Se conservó la configuración privada y se
reinició solo el servidor Next.js identificado como propio. Los listeners anteriores de la API
se dejaron intactos al no poder atribuirles un PID con certeza. Las instrucciones de arranque
actualizadas deben usar 8086; esto no es una URL pública ni un despliegue.

## Pendientes para Claude

**Código:** control transaccional entre varias instancias para configuración/usuarios/incidentes,
protección frente a formularios completos abiertos con valores antiguos y bitácora financiera
durable. La cola actual solo protege un proceso; no convierte Netlify Blobs en una transacción.
Revisar alertas con horas ausentes, DST, cobertura y el transporte Microsoft con DNS fijado
compatible con el proxy. Verificar `total_complete_payment_rate` con muestra no nula.

**Permisos:** la cuenta USD adicional de Spotify sigue fuera del mapeo autorizado y sin acceso
comprobado a informes. No renovar OAuth por el límite de cuota de X.

**Configuración:** capturar tasas mensuales del equipo en Operación → Tipo de cambio; definir
volumen durable y scheduler; configurar identidades/secretos y validar persistencia tras reinicio
en el destino. Hay 15 cuentas locales; no se trasladaron contraseñas a Git.

**Negocio y datos reales:** conciliar costes, relojes y atribución contra las plataformas; decidir
eventos principales de Spotify/TikTok, identificadores de las dos reglas de Meta y mapeo offline
de Google. Se preservan CAPI WhatsApp / Compras Offline Web por separado, los dos eventos offline
válidos de Google y CPA = suma de costo / suma de conversiones. No se eligieron tasas ni eventos.
