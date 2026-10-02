# Prompt para Claude: auditoría final y continuación de v1

Copia el bloque completo. La entrega está en GitHub; no requiere ZIP ni secretos por chat.
La [guía vigente](ENTREGA_CLAUDE_FASE_FINAL.md) separa resultados, limitaciones y pendientes.

```text
Continúa la auditoría final y el desarrollo de la candidata v1 de mi monitoreo.

Repositorio: jmartinez-rgb/orueba.
Base: último HEAD publicado de codex/dominios-absolute-top. Debe contener el commit
funcional 2c8ca5608de8801af42524ffa0a5ef8a1e5d20ae y la entrega documental posterior.
Registra el HEAD exacto recibido y revisa git status y cambios ajenos antes de operar.
Crea una rama propia desde esa base, por ejemplo claude/auditoria-final-v1; si existe,
usa un nombre nuevo. No trabajes ni hagas push sobre las ramas de Codex o de Claude
anteriores. No reescribas historial ni hagas force-push.

Lee primero:
1. ENTREGA_CLAUDE.md.
2. media-monitoring-center/AGENTS.md y media-monitoring-center/CLAUDE.md; antes de cambiar Next.js, lee las
   guías locales indicadas en AGENTS.md.
3. media-monitoring-center/docs/ENTREGA_CLAUDE_FASE_FINAL.md: entrega vigente.
4. media-monitoring-center/docs/DOMINIOS_ABSOLUTE_TOP.md: informe A–J y evidencia.
5. unified-ads-api/docs/GOOGLE_ABSOLUTE_TOP.md, unified-ads-api/docs/AUDITORIA.md y ambos README.
6. Documentos de accesos, conciliación y producción enlazados en la guía vigente.
ENTREGA_CLAUDE_V1.md conserva la base histórica; no uses su rama o conteos como actuales.

Dos proyectos: unified-ads-api (Node 22+, Fastify 5, seis proveedores implementados)
y media-monitoring-center (Next.js 16.3.6). Fuente de v1: DATA_SOURCE=unified.
Conserva Sky y sus permisos, pero extracción, conciliación y aceptación de esta ronda
son SOLO IZZI. No rehagas desde cero proveedores, OAuth, verificar, meta:acciones ni
Nexus existentes; corrige sus defectos reproducidos.

Audita de extremo a extremo, reproduce y corrige defectos demostrados y mejora UX,
diseño y funcionalidades dentro de las reglas existentes. Usa agentes independientes
para UX/diseño, autorización, integridad/concurrencia y contratos/datos; coordina
archivos. Continúa el trabajo independiente si faltan accesos o datos.

Orden:
1. Establece tu propia línea base de pruebas, build y permisos positivos/negativos.
   Comprueba configuración por presencia, sin imprimir valores. Los archivos privados
   y procesos anteriores no viajan en Git ni se presuponen disponibles.
2. Audita Dominios/Absolute Top: maestro único, filtros antes de agregar, campañas y
   grupos independientes, N/D distinto de cero, cuotas censuradas, relojes, frescura,
   cobertura y políticas. Evita doble conteo padre/hijo y falsas recuperaciones.
   Cambiar dominio o abrir páginas no debe avanzar auditorías, reconciliar incidentes
   ni guardar presupuestos parciales. Verifica episodios, deduplicación, cambios de
   configuración y checkpoints coherentes.
3. Conciliación independiente de las cuatro cuentas Google izzi: mismo día cerrado,
   cuenta, reloj, moneda, red y nivel que Ads Manager. El campo principal es
   metrics.absolute_top_impression_percentage, NO Search Absolute Top IS.
   Prioriza 2026-10-01 para reproducir la muestra y considera maduración de cuotas.
   No compares la API consigo misma. El conciliador genérico no acredita por sí solo
   Absolute Top: revisa su contrato y prepara una comparación específica si hace falta.
4. Verifica cobertura/frescura de los seis proveedores configurados y diagnostica
   Microsoft con lecturas izzi acotadas, respetando checkpoints, backoff y límites.
   Su último reporte dio 502: no inventes la causa. X/Spotify ya están aprobados;
   comprueba acceso efectivo sin pedir aprobación otra vez ni regenerar OAuth por
   errores históricos. Sin credenciales, deja pruebas offline y bloqueos concretos.
5. Integridad/producción: concurrencia entre procesos, CAS real, escrituras multiclave,
   edición obsoleta, caída entre inicio y novedad, persistencia/rotación de tokens,
   tamaño/retención de auditorías, backup/restauración y observabilidad sin secretos.
   File/Memory no garantizan transacciones distribuidas. Revisa las limitaciones de
   Netlify y filesystem efímero antes de proponer alojamiento.
6. UX completo: Resumen -> alerta -> incidente -> delegar -> Mis pendientes -> cerrar
   con nota; cliente de lectura, dominio/marca, Absolute Top, histórico, presupuesto,
   tasas, arranque mensual, informes y Nexus. Prueba móvil, teclado, foco, ambos temas,
   vacío/carga/error, conflictos 412/428 y aviso mensual/crítico simultáneos.
   Usa fixtures aislados sin config privada ni canales reales. Documenta antes/después.
7. Prepara candidata v1 y checklist de aceptación/rollback. No despliegues, contrates
   ni actives cron, n8n, WhatsApp o mensajes externos. Si faltan exports, URLs o decisiones,
   deja el resultado revisable y especifica el bloqueo concreto.

Evidencia anterior, no resultados nuevos tuyos:
- Commit funcional 2c8ca56: API 775 pruebas/39 archivos, typecheck/lint/formato/build;
  monitoreo 1217 pruebas/89 archivos, check y build aislado con fixtures; todo pasa.
- CI de API pasa Node 22 y 24 en ese commit: Actions run 37058044843.
- Absolute Top: ocho lecturas (diario/horario x cuatro cuentas izzi), 2026-10-01,
  America/Mexico_City: 614 filas diarias y 14736 intervalos horarios. Importación diaria
  local privada; no está en Git. Falta conciliación independiente.
- UX: primera matriz 342/343, regresión corregida 1/1, verificación final 25/25.
  No equivale a repetir 343/343 sobre el build final, certificar WCAG o producción.
- Microsoft: catálogo/campañas 200 y último reporte diario/horario 502. ZIP y 266 filas
  horarias son históricos. DNS/HEAD disponible no acredita descarga firmada ni causa del 502.
- Spotify izzi recuperó horas sin REVENUE; ingresos N/D. report_end inclusivo confirmado.
- Lo publicado es el entorno de Codex. No hay URLs públicas confirmadas ni producción aceptada.

Maestro único: unified-ads-api/src/config/google-ads-domains.json.
Primer Dominio: 8779536058 y 6214109105, mínimo 70%.
Segundo Dominio: 3224850043, mínimo 10%.
Tercer Dominio: 7367928294, mínimo 25%.
IDs como cadenas, sin clasificación por nombres. Agregación por impresiones solo
aproximada entre campañas compatibles; no ocultar afectaciones por un promedio.
Consulta A–J para límites, umbrales configurables y garantías de almacenamiento.

Reglas de negocio: no modificarlas ni decidir otras.
- Meta: campañas con CAPI WhatsApp -> On-Facebook Purchase; las demás -> Compras
  Offline Web (Inbound). Universos separados en análisis; sumar solo venta total.
- Google offline: únicamente MCC_Offline_Lead_Contact y MCC_Offline_Purchase.
- CPA = suma de costo / suma de conversiones; nunca promediar CPAs.
- Identificadores principales Meta, eventos TikTok/Spotify, mapeos offline Google
  y FX mensual USD->MXN los decide el equipo. No inventes valores, mezcles monedas
  o relojes, ni conviertas faltantes en cero. Las tasas tienen sección de captura.

Acceso:
- Juan Pablo Martínez conserva control máximo y protección de administrador principal.
- Hernán tiene administración amplia, pero no escritura de alertas por ese título.
- Solo Juan Pablo, Daniel Racines, Sebastián Vargas, Santiago Tamayo y Victoria
  Cárdenas responden alertas. Los demás leen sin escribir, incluso Hernán, Guillermo
  y Operations. No ampliar por dominio ABCW ni título del rol.
- Daniel configura/delega sin gestionar cuentas/contraseñas. Operativos autorizados
  atienden sin reasignar. Clientes conservan su vista autorizada sin detalle técnico interno.
- Conserva las 15 cuentas privadas, IDs, marcas y contraseñas. No repetir bootstrap
  ni regenerar accesos para probar. Verifica autorización en servidor y UI.
- Nexus es consulta local determinista por marca/dominio, sin LLM ni acciones.
  No envíes datos a servicios nuevos sin autorización.

Antes de CADA commit:
unified-ads-api: npm run typecheck && npm run lint && npm run format:check && npm test
media-monitoring-center, si lo tocas: npm run check
Para cambios de código, también builds y regresiones pertinentes. No saltar,
desactivar ni poner en cuarentena pruebas. Las suites bloquean la red publicitaria.
Lee la guía antes de ejecutar ux-regression.cjs: demo aislada, fixtures y ausencia
de config privada. Las lecturas reales autorizadas son separadas y acotadas.

No pedir secretos por chat ni imprimirlos. No registrar cuerpos OAuth, cabeceras,
callbacks con códigos, URLs firmadas o contraseñas. No subir .env, .env.local, .data,
llaves JSON, reportes privados ni capturas reales. No leer Ventas Detalle (teléfonos).
No desactivar TLS ni eludir proxy. No ejecutar reset, clean ni checkout sobre cambios
ajenos, sustituirlos sin revisar, reescribir historial ni hacer force-push.
No publicar/desplegar, activar cron o enviar mensajes externos. No declarar la v1 terminada.

Entrega commits descriptivos y push a tu rama. Actualiza README, AUDITORIA y la guía
vigente. Informe con severidad, reproducción, archivo/línea, cambios, comandos y
resultados; distingue fixtures/local, plataformas, conciliación y hosting.
Separa pendientes en código, datos, permisos, configuración y decisiones de negocio.
Incluye checklist manual para mi cuenta y siguiente paso concreto hacia la v1.
```
