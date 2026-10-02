# Entrega histórica a Claude: base v1 anterior a Dominios/Absolute Top

**La entrega vigente es [ENTREGA_CLAUDE_FASE_FINAL.md](ENTREGA_CLAUDE_FASE_FINAL.md), en
`codex/dominios-absolute-top`, base funcional `2c8ca56` más el traspaso documental.**
Este documento conserva evidencia y contexto de la base anterior; no usar la rama ni los
conteos que siguen como estado actual. El [prompt](PROMPT_PARA_CLAUDE.md) apunta a la entrega nueva.

Fecha: **2 de octubre de 2026 UTC**. Repositorio `jmartinez-rgb/orueba`.
Rama entregada: **`codex/finalizacion-verificador-meta-x`**. Base funcional:
**`f7431b2139c52925729f64ddbfbb22b033ed2bc2`**. El commit documental posterior no cambia código.

Objetivo: auditar de extremo a extremo, corregir defectos demostrados y mejorar diseño,
funcionalidades y operación sin cambiar las reglas de negocio. **No declarar v1 terminada o
producción aceptada**. La extracción y conciliación de esta aceptación cubren **solo izzi**;
conservar Sky y sus permisos, sin incorporar lecturas reales de Sky a este alcance.

Este documento reúne el estado de esa base anterior. Los informes conservan sus fechas y límites;
una comprobación anterior no cuenta como ejecución nueva. Ante discrepancias, revisar código,
evidencia fechada e instrucciones del usuario. No repetir bloqueos históricos ya superados.

## Empezar aquí

1. Revisar `git status`, rama, HEAD y diferencias locales antes de operar. Crear una rama propia
   desde el HEAD de la entrega, por ejemplo `claude/auditoria-v1-continuacion`. No sustituir cambios ajenos.
2. Leer `../AGENTS.md` y `../CLAUDE.md`; antes de cambiar Next.js, consultar las guías locales
   indicadas en AGENTS. Cada proyecto tiene su propio `package.json` y lockfile.
3. Leer los README de ambos proyectos y los documentos de la tabla siguiente.
4. Comprobar presencia de configuración privada y capacidades sin imprimir valores. No dar por
   disponibles procesos, volúmenes o archivos privados de una sesión anterior.
5. Establecer la línea base de pruebas y registrar cada hallazgo con reproducción, severidad,
   archivo/línea, impacto, corrección y regresión. Usar agentes independientes para UX,
   autorización, integridad y contratos de plataformas; evitar ediciones simultáneas del mismo archivo.

| Lectura                                                                       | Qué contiene                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Última continuación funcional](CONTINUACION_ENTORNO_PUBLICADO_2026-10-02.md) | 1030/678 pruebas, sondeo público, concurrencia y último resultado Microsoft |
| [Auditoría ampliada](AUDITORIA_AMPLIADA_2026-10-02.md)                        | Hallazgos reproducidos, 15 identidades, autorización y harness UX           |
| [Diseño, UX y Nexus](AUDITORIA_UX_NEXUS_2026-10-02.md)                        | Recorridos visuales, fixtures, limitaciones y mejoras previas               |
| [Auditoría de la API](../../unified-ads-api/docs/AUDITORIA.md)                | Contratos, matriz y pendientes por plataforma                               |
| [APIs directas](APIS_DIRECTAS.md) · [actualización](ACTUALIZACION_DIRECTA.md) | Mapeo, relojes, histórico y extracciones acotadas                           |
| [Accesos nominales](ACCESOS_NOMINALES.md) · [Nexus](NEXUS.md)                 | Permisos efectivos, delegación y consulta interna                           |
| [Conciliación](CONCILIACION.md) · [producción](PRODUCCION.md)                 | Referencia independiente, alojamiento y aceptación pendiente                |
| [Preparación de producción](PREPARACION_PRODUCCION_2026-10-02.md)             | Pruebas Docker y cobertura histórica, con evidencia sanitizada              |

La [guía de uso](GUIA.md), INSTALACION, DATOS y NETLIFY incluyen rutas heredadas de Sheets,
Dataslayer y publicación. Para esta v1 la fuente elegida es **`DATA_SOURCE=unified`**. No sustituir
el mapeo explícito de cuenta/marca por nombres de campañas ni ejecutar un despliegue siguiendo
una guía antigua. La guía [VERIFICACION](../../unified-ads-api/docs/VERIFICACION.md) conserva
comandos válidos; sus muestras tienen una fecha y no certifican el estado presente.

## Qué existe y dónde revisar

| Proyecto / área            | Implementación y límites                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unified-ads-api/`         | Node 22+, TypeScript, Fastify 5, Zod 4, Vitest. Seis proveedores con interfaz, estado, timeout y vocabulario de conversiones compartidos               |
| `media-monitoring-center/` | Next.js 16.3.6, React 19; escritorio/móvil, temas claro/oscuro, monitoreos separados izzi/Sky                                                          |
| Extracción directa         | `src/lib/unified/`: catálogo, particiones, cobertura, zona horaria, checkpoints y backoff persistido; `scripts/unified-sync.ts` / `unified-refresh.ts` |
| Operación                  | Alertas, incidentes, responsables, notas, tickets, arranque mensual, comparación, histórico, presupuestos, tasas y auditoría                           |
| Acceso                     | 15 identidades privadas; administrador principal protegido, marcas y cinco respondedores nominales; validación en servidor                             |
| Integridad                 | Settings con revisión de formulario y CAS por clave en Blobs; contadores/seguimiento con actualizaciones concurrentes y recibos acotados               |
| Nexus                      | `src/lib/nexus/` y rutas/página de Nexus; consulta local determinista, filtrada por marca y acceso interno; sin modelo generativo ni acciones          |
| Conciliación               | `src/lib/reconciliation/`, `scripts/reconcile.ts`; costo/impresiones/clics diarios, moneda/reloj original, referencia independiente                    |
| Preparación de alojamiento | Dos Dockerfiles Node 22, contextos sin secretos, usuario `node`, rutas de volumen y preflight; no servicios publicados                                 |
| Sondeo público             | `src/lib/release/production-smoke.ts`, `smoke-options.ts`, `scripts/production-smoke.ts`; siete GET anónimos acotados, sin escribir                    |

La API incluye `verificar`, `meta:acciones` y los asistentes OAuth. No hay que reimplementarlos.
La selección incremental opcional de X tiene respaldo acotado; no certifica por sí sola informes
asíncronos reales. En el servidor, con **`TOKEN_STORE_FILE` configurado**, los callbacks de
rotación Microsoft/Spotify esperan el guardado registrado antes de reutilizar el token; el cierre
espera escrituras pendientes. Los CLI usan una cola y esperan `flush` al finalizar. Sin almacén
configurado, el servidor advierte y continúa: no garantiza persistencia. Tampoco se asegura
durabilidad ante pérdida de energía ni coordinación multiproceso.

El mapeo autorizado contiene **31 cuentas: 25 izzi y 6 Sky**, con 26 MXN y 5 USD. Los IDs se
conservan como texto, incluyendo los de 64 bits. La fuente directa aporta costo, impresiones y
clics; **conversiones de negocio, ingresos y CPA no están aceptados de extremo a extremo**.
Los datos desconocidos conservan su estado; no convertir ausencia de filas en cero.

## Evidencia comprobada y límites

| Comprobación previa              | Resultado                                                                                                                               | Qué no demuestra                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Gates en `f7431b2`, Node 24.19.0 | API 678/678, 37 archivos; monitoreo 1030/1030, 71 archivos; tipos/lint y formato API correctos                                          | No son lecturas de plataformas ni pruebas nuevas de esta entrega documental    |
| Build Next 16.3.6                | Correcto                                                                                                                                | No despliega ni prueba datos de producción                                     |
| Node oficial 22.23.3             | 191/191 pruebas nuevas seleccionadas del monitoreo; checksum verificado                                                                 | No fue toda la suite en Node 22                                                |
| UX anterior                      | 320/320 casos: 300 página/tema/ancho y 20 de teclado, roles, aislamiento y formularios                                                  | Automatización con fixtures; no pruebas humanas ni certificación WCAG          |
| Acceso nominal anterior          | 15 logins y comprobaciones de permisos por HTTP local                                                                                   | No demuestra cuentas configuradas en alojamiento público                       |
| Docker anterior                  | 18 comprobaciones HTTP; reinicios/recreaciones y seis registros sintéticos conservados; usuario sin privilegios y exclusión de secretos | No transfirió datos reales ni aceptó persistencia del proveedor de alojamiento |
| Último arranque local            | Ocho comprobaciones HTTP anónimas tras reinicio, 02/10 a las 17:04 UTC                                                                  | Un 401 solo no demuestra que un usuario permitido pueda entrar                 |
| Estado de proveedores            | Seis `connected`, 02/10 a las 16:44 UTC                                                                                                 | No asegura reportes, cuotas, todas las cuentas o conciliación                  |
| Conciliación inicial 30/09       | 25 filas izzi; 25 sin referencia, 24 con fuente incompleta, seis sin cobertura diaria; cero coincidencias aceptadas                     | No hay export independiente ni discrepancia financiera demostrada              |

La evidencia sanitizada está en `docs/evidence/`. Los reportes reales y el histórico privado no
se entregan en Git. Los conteos de 310/367/485/658/839 en informes anteriores son checkpoints
históricos. La validación de esta ronda documental se registra al final sin reclasificarlos.

## Estado de las plataformas

| Proveedor / versión | Verificado                                                                                            | Pendiente vigente                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Google Ads v25      | Muestras reales diarias/horarias; ceros protobuf seleccionados corregidos                             | Conciliación izzi, atribución/acciones offline y cobertura horaria por acción                                            |
| Meta v26.0          | Muestras reales; acciones separadas, reglas por nombre y bloques de reporte                           | Identificadores de acciones por cuenta, conciliación sin mezclar universos                                               |
| TikTok v1.3         | OAuth y cuatro cuentas; 35 días de lectura/histórico en la continuación                               | Conciliación izzi, timezone por cuenta y unidades no nulas de `total_complete_payment_rate`                              |
| Microsoft Ads v13   | OAuth, cuentas/campañas; ZIP real y 266 filas horarias históricas                                     | Última ronda izzi diaria/horaria devolvió 502; causa sin confirmar, cobertura adyacente UTC/México y conciliación        |
| Spotify Ads v3      | Permiso concedido; izzi recuperó 30 filas horarias UTC sin REVENUE; `report_end` inclusivo confirmado | Ingresos desconocidos, cobertura/conciliación y evento principal; cuenta USD extra denegada fuera del alcance autorizado |
| X Ads v12           | Aprobación y OAuth 1.0a; tres cuentas y lectura diaria real, izzi mapeado                             | Cuota/horas, selección incremental real, descarga asíncrona, eventos y conciliación                                      |

Microsoft, última ronda: filtro explícito izzi, tres días 30/09–02/10 incluyendo hoy; cuatro
cuentas descubiertas, quince campañas izzi, cero filas nuevas en reportes. Las particiones previas
se conservaron y el siguiente intento quedó diferido a **02/10 20:47 UTC**. Antes de repetir,
leer el checkpoint vigente; no forzar retries ni asumir que ese plazo histórico sigue vigente.
`microsoft:red` alcanzó la raíz del host fijo con HTTP 400, TLS/proxy normales y salida 0: prueba
transporte, **no descarga firmada ni causa del 502**. No atribuir un código Microsoft 2004 sin evidencia.

No solicitar otra aprobación de X/Spotify ni regenerar OAuth por rechazos históricos. Para una
lectura TikTok acotada bastan token e IDs; App ID/Secret son necesarios para descubrimiento/OAuth.
No ampliar el mapeo al descubrir cuentas adicionales. Las muestras históricas de Sky no amplían
la aceptación izzi.

## Reglas que deben mantenerse

- Meta: campañas con **CAPI WhatsApp** en el nombre usan **On-Facebook Purchase**; las demás,
  **Compras Offline Web (Inbound)**. Nunca mezclar ambos universos en análisis; sumar solo para venta total.
- Google: únicos eventos offline válidos **MCC_Offline_Lead_Contact** y **MCC_Offline_Purchase**.
- **CPA = suma de costo / suma de conversiones**, nunca promedio de CPAs.
- Eventos principales de TikTok/Spotify, identificadores exactos de acciones Meta, mapeo offline
  Google y tasas mensuales USD→MXN los decide el equipo. No inferirlos ni inventar valores.
- Hay una sección de captura mensual de tipo de cambio. Preservar la distinción exacto/anterior
  provisional/desconocido, sin usar tasas futuras ni sumar monedas diferentes como si fueran MXN.
- Juan Pablo Martínez es el **administrador principal con control máximo**, protegido contra
  edición/eliminación por otros. Hernán conserva administración amplia, sujeta a la lista de atención.
- Solo **Juan Pablo, Daniel Racines, Sebastián Vargas, Santiago Tamayo y Victoria Cárdenas**
  pueden atender alertas; validar sus IDs privados, sin inventar IDs a partir del correo.
- Los demás ven alertas sin responder, incluidos Hernán, Guillermo y Operations. Ser ABCW,
  operativo, administrador o cliente jefe no agrega permiso de atención por sí solo.
- Daniel puede configurar y delegar, pero no gestionar cuentas/contraseñas. Los operativos
  autorizados atienden y dan seguimiento sin reasignar. Santiago es la persona de `stamayo`.
- Clientes reciben resumen y alertas públicas de lectura, sin notas, responsables, tickets,
  contactos, diagnósticos internos o IDs técnicos de campañas. Respetar marcas también en cada endpoint.

No volver a ejecutar `auth:bootstrap`/`auth:setup` en la instalación nominal existente. Las
contraseñas iniciales privadas pueden haber dejado de ser vigentes. No regenerar accesos para
hacer una prueba ni exportar el roster. La lista nominal privada y el administrador principal
siguen siendo la autoridad; ocultar controles en UI no reemplaza autorización en servidor.

## Continuar en este orden

1. **Línea base y auditoría P0:** ejecutar gates; revisar autorización positiva/negativa de las
   15 identidades con comprobaciones no destructivas, ambas marcas, cinco respondedores y
   protección del principal. Preparar fixtures aislados para notas, cierres y cambios de acceso.
2. **Integridad sin accesos nuevos:** reproducir edición obsoleta del plan mensual, crash entre
   inicio y novedad, transacciones multiclave, límites de recibos y concurrencia multiproceso.
   Settings ya tiene revisión y CAS por clave en Blobs: auditar pendientes reales, no rehacer
   correcciones existentes. Blobs real sigue sin validar; no simular esa aceptación con memoria.
3. **Datos izzi:** inventariar cobertura/frescura por cuenta, moneda y reloj. Diagnosticar Microsoft
   tras el backoff sin exponer URLs firmadas. Toda lectura nueva debe ser acotada; preservar datos
   anteriores si falla. No rellenar faltantes con cero ni ejecutar backfills masivos para probar UX.
4. **Conciliación:** obtener export independiente agregado de Ads Manager, mismo día cerrado,
   misma definición de clic y moneda/reloj. Ejecutar la herramienta existente; conservar pendientes
   si no hay referencia. Resolver cobertura por fecha frente al catálogo actual, sin reducir el
   alcance para conseguir coincidencias. No usar un export propio de la API como verdad externa.
5. **Diseño y funciones:** revisar los recorridos siguientes con agentes UX y capturas de fixtures.
   Corregir prioridades, accesibilidad, estados vacíos/error y claridad de datos antes de añadir
   gráficos. Añadir funciones solo dentro del alcance autorizado y con aceptación comprobable.
6. **Preparar producción:** revisar Docker, volumen/backup, rotación y extractor único supervisado.
   Faltan alojamiento y URLs. Dejar cambios concretos y comprobables; no publicar, contratar,
   desplegar ni activar cron/webhooks/notificaciones. La publicación de Codex no es hosting de la app.

## Revisión de diseño y UX

Los agentes deben reportar tarea, rol, marca, ancho/tema, reproducción, severidad y propuesta.
Después de cada cambio relevante, probar el flujo completo, errores y teclado; las capturas
deben usar datos simulados rotulados, sin sesiones ni cifras reales en artefactos públicos.

| Recorrido                                                          | Criterio para mejorar / aceptar                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Administrador: Resumen → alerta → incidente → responsable → cierre | Prioridad visible, acción principal clara, responsable y estado reconocibles; cierre exige nota y persiste                             |
| Operativo: Mis pendientes → atender → nota → actualización         | Solo permisos autorizados, feedback de guardado, foco conservado y errores recuperables                                                |
| Otro usuario / cliente                                             | Alertas de lectura, sin controles operativos ni exposición de datos internos; denegación también por API                               |
| Campaña / cuenta / histórico / comparar                            | Moneda, zona, periodo, corte, cobertura y frescura junto a cifras; CPA agregado correcto; desconocido distinto de cero                 |
| Tipo de cambio / presupuestos / plan mensual                       | Etiquetas y formatos claros, diferencia entre guardado/provisional/pendiente; conflictos 412/428 no descartan borrador silenciosamente |
| Cambio de marca / navegación móvil                                 | Título y filtros coherentes, sin datos cruzados; tablas legibles y navegación con teclado a 320–1440 px                                |
| Nexus                                                              | Consultas por marca, explicación de límites, cancelación/reintento; no afirma conversiones o CPA sin datos/eventos aceptados           |
| Error, vacío, carga y falta de conexión                            | Acción recuperable y mensaje útil, sin secretos ni falsa señal verde de salud                                                          |

Regresión obligatoria al rediseñar: crítico junto con aviso de arranque mensual o recordatorio,
en ambos órdenes de respuesta. Debe existir un solo modal activo, con prioridad/foco contenido
en el crítico, acuse documentado y reanudación del aviso después. Probarlo con fixtures aislados.

Revisar contraste en ambos temas, foco visible, orden de tabulación, labels, modales, scroll,
zoom, targets táctiles, lectores de pantalla y estados de carga. Los 320 casos automatizados
previos no certifican WCAG ni sustituyen probar tareas con personas. No añadir color/movimiento
sin significado ni gráficas que oculten falta de datos o mezclen monedas y periodos.

Nexus es un asistente **local determinista**, no un LLM conectado: preguntas acotadas, sin
acciones ni envíos externos, límite de 500 caracteres y permisos de consulta interna. No enviar
campañas, preguntas, contactos o credenciales a un servicio generativo para mejorarlo sin definir
y autorizar primero ese nuevo flujo. Revisar exactitud, cobertura y aislamiento del modo actual.

## Pruebas y comandos de continuación

Desde cada proyecto, instalar con `npm ci` solo si hace falta y respetando sus lockfiles. No
desactivar TLS/proxy. Antes de **cada commit**, sin omitir/desactivar/poner en cuarentena pruebas:

```bash
# unified-ads-api/
npm run typecheck && npm run lint && npm run format:check && npm test

# media-monitoring-center/, si se modifica
npm run check
```

Para cambios de código/runtime, ejecutar también builds pertinentes y regresiones que prueben
el defecto. Evitar tests que repitan implementación o ampliar pruebas sin un riesgo concreto.
No usar secretos reales en fixtures; la API tiene un guard global de `fetch` sin red.

UX: `scripts/ux-regression.cjs` requiere Playwright/Chromium disponibles; sus herramientas no
están fijadas como dependencias del proyecto. Preparar una instancia **aislada de demo** en
loopback con fuente mock/almacenamiento de pruebas, sin cargar `.env.local`, cuentas nominales,
URLs reales, llaves, n8n o WhatsApp. Las cookies de roles de demo no validan sesiones nominales.
Revisar la preparación en la auditoría ampliada antes de ejecutar:

```bash
# media-monitoring-center/, contra la demo aislada ya arrancada
node scripts/ux-regression.cjs --base http://127.0.0.1:3003 --out /tmp/auditoria-ux
```

Comandos operativos existentes, a usar solo con sus precondiciones y límites documentados:

- `unified:refresh -- --brand izzi`: una ronda acotada; `--provider microsoft` limita a Microsoft.
  Sin `--brand` conserva todas las marcas. No activar `--watch` permanente antes de preparar operación.
- `conciliar -- --from YYYY-MM-DD --to YYYY-MM-DD --reference <archivo-privado>`: offline,
  solo izzi, 1–45 días cerrados; salidas privadas nuevas. El rango real se elige según cobertura.
- `v1:check -- --sin-red --registros`: validación local con sondeo aislado de registros; salida 2
  esperada al no comprobar proveedores. Las rutas declaradas no prueban montaje durable.
- `produccion:smoke -- --monitor <URL-HTTPS> --api <URL-HTTPS>`: cuando existan ambas URLs;
  siete GET sin llaves/cookies ni OAuth. Sin URLs queda pendiente, salida 2 y cero solicitudes.

El smoke no certifica datos, identidades, almacenamiento, worker, TLS del origen detrás del proxy
ni fijación DNS; sus flags de certificación siguen en falso incluso con salida 0. Para producción
hacen falta además pruebas de permisos reales, cookies Secure, reinicio/reemplazo, backup/
restauración, rotaciones, extracción supervisada y conciliación desde el alojamiento.

## Bloqueos y pendientes por categoría

| Categoría     | Pendientes que no deben declararse resueltos                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código        | Usuarios/archivos entre procesos, transacciones multiclave, bitácora financiera durable, revisión del plan mensual, crash inicio/novedad, cuotas/asíncronos X y transporte DNS Microsoft compatible con proxy |
| Datos         | Exports independientes, cobertura diaria/horaria por fecha, unidades de compras TikTok, ingresos Spotify, reglas/atribución para conversiones de negocio                                                      |
| Configuración | URLs y alojamiento, volúmenes privados, backup/restauración, scheduler único izzi, cuentas nominales en destino, tasas mensuales del equipo                                                                   |
| Permisos      | Acceso efectivo por cuenta/reporte en destino; las aprobaciones X/Spotify ya concedidas no prueban todos los productos; cuenta USD extra Spotify queda fuera del alcance                                      |
| Negocio       | Identificadores Meta, eventos principales TikTok/Spotify, mapeo offline Google, tasas; cualquier ampliación de marcas, clientes o funciones debe respetar decisiones del usuario                              |
| Aceptación    | UX humano, conciliación, Blobs real si se elige, HTTPS/origen/DNS, identidades, datos y persistencia/worker del alojamiento                                                                                   |

El allowlist Microsoft sigue limitado a `bingadsappsstorageprod.blob.core.windows.net`.
La IP no está fijada al socket del proxy: DNS público comprobado no cierra ese riesgo residual.
Netlify con histórico directo por archivo sigue bloqueado, aunque los registros usen Blobs.
Cloud Run efímero requiere migrar almacenes/coordinación; el cliente actual no genera ID tokens
para IAM. Dos servicios Node/Docker con discos persistentes y un escritor son la preparación
actual; no hay servicios contratados, despliegue, worker permanente ni URLs públicas confirmadas.

## Protección de la entrega

No pedir secretos por chat, imprimir tokens, cuerpos OAuth, cabeceras de autenticación, callbacks
con códigos, URL firmadas o contraseñas. No subir `.env`, `.env.local`, `.data`, credenciales,
llave JSON, reportes privados ni imágenes de datos reales. No leer **Ventas Detalle** ni teléfonos.
No eludir proxy, desactivar TLS, ampliar hosts de descarga por comodidad o guardar secretos en
`NEXT_PUBLIC_`. No enviar mensajes por correo/Slack/WhatsApp ni activar notificaciones.

No ejecutar reset/clean/checkout sobre cambios ajenos, reescribir historial ni force-push.
No hacer push a las ramas anteriores de Claude/Codex; commits descriptivos y push solo a la rama
propia. No desplegar/publicar/contratar. Registrar lo bloqueado y su causa sin inventar evidencia.

## Revisión manual del equipo

El equipo puede comprobar estas tareas cuando tenga un acceso privado al entorno correcto:

1. Entrar con su cuenta y comprobar nombre, rol y marca; Juan Pablo conserva control máximo.
2. Cambiar izzi/Sky sin mezclar datos; esta aceptación de cifras es solo izzi.
3. Juan Pablo/Daniel delegan una incidencia; un operativo autorizado la ve en Mis pendientes.
4. El responsable añade nota/cambia estado/cierra con nota; verificar conservación tras recarga.
5. Un usuario fuera de los cinco ve alertas pero no responde; cliente no ve información interna.
6. Revisar una campaña con periodo/moneda/frescura/cobertura; distinguir cero de desconocido.
7. Revisar tasa mensual y su condición provisional; en Nexus consultar campaña y cómo usar la app.
8. En demo aislada, probar crítico y aviso mensual/recordatorio simultáneos: un solo modal,
   foco en el crítico, acuse con nota y reanudación del aviso; ambos órdenes de respuesta.
9. Repetir en móvil y ambos temas. Reportar ruta, tarea, rol, resultado esperado y observado,
   sin incluir credenciales ni capturas con datos personales.

Usar fixtures para cambios destructivos, de contraseña, rol o borrado; no alterar cuentas reales
solo para comprobar el control. Una tarea bloqueada por configuración no equivale a prueba aprobada.

## Qué debe entregar Claude al terminar su ronda

Informe con hallazgos por severidad y archivo/línea, cambios justificados, pruebas exactas y
resultado, evidencia separada en fixture/local/plataforma/alojamiento, bloqueos y siguiente paso.
Actualizar README, esta guía y AUDITORIA sin borrar evidencia histórica. Para diseño, incluir
capturas sanitizadas y los recorridos antes/después; para datos, referencias independientes.
Commits descriptivos y push de su rama, con revisión final de secretos/diff y sin declarar v1 terminada.

## Validación de esta entrega documental

Esta ronda organiza el traspaso y corrige estados documentales obsoletos. No cambia código,
credenciales, reglas de negocio, mapeo, procesos o despliegues.

Comprobaciones nuevas del **02/10/2026 UTC, Node 24.19.0**:

- API: `typecheck`, `lint`, `format:check` y `test` pasan; **678/678 pruebas, 37 archivos**.
- Monitoreo: `npm run check` pasa; tipos/lint y **1030/1030 pruebas, 71 archivos**.
- **113 enlaces locales** de los 11 documentos de entrega revisados, sin destinos ausentes;
  `git diff --check` correcto. Dos agentes revisaron claridad, estados y límites del traspaso.

No se repitieron builds, Docker, navegador, accesos nominales ni lecturas reales en esta ronda
documental. Sus evidencias anteriores conservan el alcance y fecha indicados arriba.
