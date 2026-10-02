# Texto para pegar en Claude

Copia el contenido del bloque siguiente. No hace falta descargar un ZIP ni compartir secretos.

```text
Continúa la auditoría y el desarrollo de la v1 de mi monitoreo.

Repositorio: jmartinez-rgb/orueba.
Rama de entrega: codex/finalizacion-verificador-meta-x, en su HEAD publicado.
Base funcional auditada: f7431b2139c52925729f64ddbfbb22b033ed2bc2.
Después hay una entrega documental; conserva también esos documentos.

Antes de editar, revisa git status, rama, HEAD y cambios locales. Crea tu propia rama
desde esa entrega (por ejemplo claude/auditoria-v1-continuacion). No sustituyas cambios
ajenos, no hagas push a ramas anteriores, no reescribas historial ni force-push.

Lee primero:
- ENTREGA_CLAUDE.md en la raíz.
- media-monitoring-center/AGENTS.md y CLAUDE.md.
- media-monitoring-center/docs/ENTREGA_CLAUDE_V1.md: guía vigente y completa.
- README de ambos proyectos.
- media-monitoring-center/docs/CONTINUACION_ENTORNO_PUBLICADO_2026-10-02.md.
- unified-ads-api/docs/AUDITORIA.md y los documentos técnicos que enlaza la guía.

Dos proyectos: unified-ads-api (Node 22+, Fastify 5, seis proveedores) y
media-monitoring-center (Next.js 16). La fuente elegida para v1 son las APIs
directas, DATA_SOURCE=unified. Conserva Sky y sus permisos, pero la extracción,
conciliación y aceptación de cifras de esta ronda cubren SOLO IZZI.

Haz una auditoría de extremo a extremo y corrige los defectos demostrados.
Usa agentes independientes para UX/diseño, autorización/roles, integridad/
concurrencia y datos/contratos; coordina archivos para que no se sobrescriban.
Mejora diseño y funcionalidades dentro de las reglas vigentes. Prioriza que las
tareas funcionen y que los datos sean claros y confiables; documenta antes/después.

Orden:
1. Línea base de pruebas y acceso positivo/negativo por rol, marca y permiso nominal.
2. Integridad: edición obsoleta del plan, crash entre inicio y novedad,
   concurrencia entre procesos, auditoría y transacciones multiclave. Settings
   ya tiene revisión y CAS por clave en Blobs; audita lo pendiente real.
3. Cobertura/frescura de izzi, diagnóstico acotado de Microsoft respetando el
   checkpoint/backoff y conciliación con exports independientes de Ads Manager.
   Si faltan exports, registra el bloqueo; no compares la API consigo misma.
4. UX: Resumen -> alerta -> incidente -> delegar -> Mis pendientes -> cerrar
   con nota; usuarios de lectura, cliente, cuentas/campañas, histórico/comparar,
   presupuestos, tipo de cambio, plan mensual y Nexus. Móvil/teclado/ambos temas,
   errores, vacío, carga, conflicto 412/428 y cambio de marca. Con fixtures,
   crítico y aviso mensual simultáneos: un modal, foco en crítico, acuse con
   nota y reanudación del aviso; ambos órdenes de respuesta.
5. Preparación de producción y operación: discos, rotación, backups, worker único,
   permisos, cookies y HTTPS. No publiques ni despliegues ni actives notificaciones.

Estado comprobado anterior, no resultados nuevos:
- API 678/678 pruebas; monitoreo 1030/1030; build Next correcto en Node 24.19.
- 191 pruebas nuevas seleccionadas pasaron Node oficial 22.23.3; no toda la suite.
- 320 casos UX automatizados con fixtures y 15 accesos nominales locales.
- Seis proveedores connected el 02/10, sin certificar todos los reportes.
- Microsoft tuvo ZIP histórico y 266 filas horarias; la última ronda izzi dio
  502 en reportes, conservó histórico y backoff. DNS/HEAD al host fijo funcionó:
  transporte disponible no explica el 502 ni certifica descarga firmada.
- X y Spotify ya tienen aprobación y lecturas reales. No pedirla de nuevo ni
  regenerar OAuth por errores históricos. Spotify izzi recuperó horas sin
  REVENUE; ingresos desconocidos. report_end inclusivo ya confirmado.
- No hay export independiente para aceptar conciliación ni URLs públicas
  confirmadas. Lo publicado fue el entorno de Codex, no el hosting de la app.

Reglas de negocio, no cambiarlas ni decidir otras:
- Meta: CAPI WhatsApp -> On-Facebook Purchase; las demás -> Compras Offline Web
  (Inbound). Nunca mezclar en análisis; sumar solo para venta total.
- Google offline: solo MCC_Offline_Lead_Contact y MCC_Offline_Purchase.
- CPA = suma de costo / suma de conversiones. Nunca promediar CPAs.
- Identificadores Meta, eventos principales TikTok/Spotify, mapeo offline Google
  y tasas mensuales los decide el equipo. No inventes datos ni conviertas faltantes
  en cero, ni mezcles monedas/relojes. Las tasas tienen su sección de captura.

Acceso:
- Juan Pablo Martínez es administrador principal protegido y con control máximo.
- Hernán tiene administración amplia, pero atención nominal restringida.
- Solo Juan Pablo, Daniel Racines, Sebastián Vargas, Santiago Tamayo y Victoria
  Cárdenas pueden responder alertas. Los demás las leen sin escribir, incluso
  Hernán, Guillermo y Operations. No ampliar por dominio ABCW o título del rol.
- Daniel configura/delega sin gestionar cuentas/contraseñas. Operativos autorizados
  atienden sin reasignar. Clientes reciben solo resumen/alertas públicas.
- Conserva las 15 cuentas privadas, IDs, marcas y contraseñas. No ejecutar bootstrap
  otra vez ni regenerar accesos para probar. Verifica permisos también en servidor.

Nexus es consulta local determinista por marca, sin LLM ni acciones. Mejora su
precisión/UX dentro de ese modo; no envíes datos a servicios nuevos sin autorización.

Antes de cada commit:
unified-ads-api: npm run typecheck && npm run lint && npm run format:check && npm test
media-monitoring-center, si lo tocas: npm run check
Para cambios de código, también builds y regresiones pertinentes. No saltar,
desactivar ni poner en cuarentena pruebas. La suite API no debe salir a la red.
Revisa la guía antes de correr ux-regression.cjs: necesita demo aislada con fixtures,
sin cargar config privada, llaves, cuentas reales, n8n o WhatsApp.

No pedir ni imprimir secretos; no registrar tokens, cuerpos OAuth, cabeceras,
callbacks con códigos, URL firmadas ni contraseñas. No subir .env, .env.local,
.data, llaves JSON, reportes privados o capturas reales. No leer Ventas Detalle.
No desactivar TLS ni eludir proxy; no enviar mensajes externos ni activar cron.
No contratar, publicar ni desplegar. No declarar la v1 terminada o producción aceptada.

Entrega commits descriptivos y push a tu propia rama. Actualiza README, AUDITORIA
y guía vigente. Informe corto con severidad, reproducción, archivo/línea,
cambios, pruebas/resultados y bloqueos por código, datos, permisos, configuración
y negocio. Separa fixtures, local, plataformas y hosting. Deja una lista de tareas
para que yo pueda revisar funcionamiento, diseño y permisos con mi cuenta.
```
