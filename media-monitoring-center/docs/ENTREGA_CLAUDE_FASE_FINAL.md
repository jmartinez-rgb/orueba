# Entrega vigente a Claude: auditoría final y candidata v1

Preparada el **2 de octubre de 2026, zona America/Bogota**.
Repositorio: `jmartinez-rgb/orueba`. Rama: **`codex/dominios-absolute-top`**.
Base funcional comprobada: **`2c8ca5608de8801af42524ffa0a5ef8a1e5d20ae`**.
La documentación de traspaso se añade después; usar el último HEAD publicado de esta rama
y registrar su hash exacto al empezar. Crear una rama propia, por ejemplo
`claude/auditoria-final-v1`, sin sustituir cambios ajenos ni hacer push a la base.

Esta entrega prepara la continuación hacia una candidata v1. **La conciliación independiente
está incompleta** (Absolute Top concilia contra la interfaz el 1 de octubre: 56 de 56 campañas y
516 de 516 grupos, con 2 filas de grupo por explicar; falta costo/impresiones/clics por cuenta) **y la aceptación de producción sigue
pendiente.** La publicación confirmada corresponde
al entorno de Codex: no se han proporcionado URLs públicas del monitoreo y de la API.
La extracción y aceptación son **solo izzi**; conservar Sky, sus datos y permisos.

## Resultado de la auditoría de Claude (2–4 de octubre de 2026)

Rama `claude/auditoria-final-v1`, desde el HEAD `07a6ae2`. [Informe con hallazgos por severidad,
reproducción y archivo/línea](AUDITORIA_FINAL_V1_2026-10-02.md) y [checklist de aceptación y
reversión](CANDIDATA_V1.md). API 803/803 y monitoreo 1377/1377 en Node 22.22.2; build aislado y matriz
completa de navegador 344/344. Se corrigieron 5 hallazgos altos, 10 medios y 7 bajos (autorización,
Absolute Top, concurrencia del backend File, capacidad del historial, accesibilidad), y se añadieron
`conciliar:absolute-top`, `datos:respaldo` y el diagnóstico seguro del 502 de Microsoft.
**La v1 sigue sin terminar:** faltan la conciliación con exports independientes de Ads Manager y la
aceptación del alojamiento autorizado. Al 7 de octubre, E2 (Absolute Top) concilia 56/56 campañas y 516/516
grupos, E1 concilia 3 cuentas de Google y 9 de Meta, y el resto está en el [acta para firma](ACTA_CONCILIACION_V1.md)
(monitoreo 1442/1442 y API 808/808 con PostgreSQL de prueba). Publicación elegida: Replit en
`monitoreo.abcw.global` ([guía](PUBLICACION_REPLIT.md)). Las secciones siguientes conservan la entrega de Codex.

## Lecturas y punto de partida

| Documento | Uso |
| --- | --- |
| [Prompt completo](PROMPT_PARA_CLAUDE.md) | Instrucción lista para pegar en Claude |
| [Informe A–J](DOMINIOS_ABSOLUTE_TOP.md) | Dominios, Absolute Top, arquitectura, límites y evidencia |
| [Contrato Google v25](../../unified-ads-api/docs/GOOGLE_ABSOLUTE_TOP.md) | Fuentes oficiales, métrica, GAQL, errores y ventanas |
| [Auditoría de la API](../../unified-ads-api/docs/AUDITORIA.md) | Matriz fechada y pendientes de las seis plataformas |
| [Accesos nominales](ACCESOS_NOMINALES.md) | Autorización, marcas, delegación y respondedores |
| [APIs directas](APIS_DIRECTAS.md) · [actualización](ACTUALIZACION_DIRECTA.md) | Fuente unified, histórico, cobertura y checkpoints |
| [Conciliación](CONCILIACION.md) | Contrato y CLI con una referencia independiente |
| [Producción](PRODUCCION.md) · [preparación](PREPARACION_PRODUCCION_2026-10-02.md) | Alojamiento, persistencia, smoke y aceptación |
| [Base histórica v1](ENTREGA_CLAUDE_V1.md) | Funciones previas, UX y revisión manual; rama/conteos históricos |

Leer también `../AGENTS.md`, `../CLAUDE.md` y los README de ambos proyectos. Antes de editar
Next.js, consultar las guías locales exigidas por AGENTS. Los package.json y lockfiles son
independientes. Las guías antiguas de Sheets/Dataslayer no sustituyen `DATA_SOURCE=unified`.
No rehacer desde cero integraciones, OAuth, `verificar`, `meta:acciones` ni Nexus existentes;
corregir los defectos reproducidos durante la auditoría.

## Estado comprobado y alcance de las pruebas

Estos resultados pertenecen al commit funcional citado; Claude debe ejecutar y fechar su propia
línea base. Los informes históricos mantienen sus fechas y no son pruebas nuevas.

| Capa | Evidencia comprobada | Límite |
| --- | --- | --- |
| API, Node 24.19.0 local | 775 pruebas / 39 archivos; tipos, lint, formato y build pasan | Fixtures; las pruebas bloquean red publicitaria |
| Monitoreo local | 1217 pruebas / 89 archivos; npm run check pasa | No certifica el alojamiento real |
| Build Next.js 16.3.6 | next build --webpack pasa con mock/Memory en copia aislada | Sin configuración ni datos privados de producción |
| CI API | Node 22 y 24 pasan en [run 37058044843](https://github.com/jmartinez-rgb/orueba/actions/runs/37058044843) para 2c8ca56 | CI API, no despliegue ni suite completa del monitoreo en Node 22 |
| Navegador | Primera matriz 342/343; regresión corregida 1/1; fuentes finales 25/25 | No se repitió la matriz completa final; no certifica WCAG ni cookies de producción |
| Google real, Absolute Top | Ocho lecturas diarias/horarias, 614 filas diarias y 14.736 intervalos | Cuatro cuentas izzi; día 2026-10-01 cerrado, America/Mexico_City; falta referencia independiente |

Navegador: 320/390/768/1024/1440 px y temas claro/oscuro. El fallo inicial de Nexus era una
carrera del ensayo al cambiar marca; se conserva el resultado y la espera explícita corregida.
Los [artefactos públicos](evidence/absolute-top-2026-10-02/) son sintéticos.

**Revalidación del traspaso documental, 2 de octubre:** en Node 24.19.0 pasan nuevamente
API `typecheck`, `lint`, `format:check`, 775/775 pruebas en 39 archivos; monitoreo `check`,
1217/1217 en 89 archivos. Se comprobaron 140 enlaces locales y `git diff --check`.
Cambios exclusivos de documentación; builds, lecturas reales y UX conservan la evidencia
del commit funcional. Un agente independiente revisó las instrucciones y sus límites.

Las 614 entidades diarias se importaron en File **local privado**; 365 tenían requisitos para
evaluar y el resto conservó N/D o volumen insuficiente. Los payloads horarios se validaron sin
sustituir el checkpoint diario. **.data, imports, configuración de cuentas nominales, catálogos
privados, contraseñas, secretos y procesos no viajan en Git.** Los IDs del maestro sí están
versionados. Comprobar disponibilidad sin imprimir valores; el nuevo entorno puede carecer
de ellos. Las transferencias privadas requieren canal y almacenamiento adecuados.

## Funcionalidad nueva que auditar

Maestro único: [google-ads-domains.json](../../unified-ads-api/src/config/google-ads-domains.json).

| Dominio | Customer IDs, siempre cadenas | Mínimo Absolute Top |
| --- | --- | --- |
| Primer Dominio | 8779536058, 6214109105 | 70% |
| Segundo Dominio | 3224850043 | 10% |
| Tercer Dominio | 7367928294 | 25% |

Se normalizan guiones del ID; no se clasifica por parecido del nombre. Campañas y grupos Search
activos se evalúan por separado. La métrica principal es
`metrics.absolute_top_impression_percentage`, distinta de Search Absolute Top IS. El endpoint
limita ventanas a siete días; el consumidor limita 25 MiB y 100.000 filas por cuenta, con error
explícito ante exceso. Catálogo sin métricas permanece visible como N/D.

El dashboard `/absolute-top` incorpora jerarquía, filtros, explicaciones, histórico, score y copia
manual. El selector global filtra antes de agregar y alcanza resumen, presupuesto, histórico,
informes y Nexus. La evaluación e incidentes conservan la marca completa: una proyección parcial
no debe reconciliar, cerrar incidentes ni avanzar auditorías.

Revisar cobertura antigua/parcial; relojes/cortes/períodos diferentes; tasa nula frente a cero;
cuotas censuradas; ponderación aproximada entre campañas; doble conteo padre/hijo; deduplicación
por auditoría válida; recuperación/recaída; cambios de política y persistencia coherente.
Presupuestos de marca se editan en «Todos los dominios»; los históricos sin dimensión no se
reparten artificialmente. Umbrales y retención están en A–J. Conversiones de plataforma no
acreditan los eventos de negocio.

## Prioridades de la continuación

1. **Línea base y auditoría independiente.** Registrar HEAD, pruebas y defectos reproducibles.
   Delegar UX/diseño, permisos, integridad/concurrencia y contratos a agentes con archivos
   asignados. Auditar también la base existente, no solo el módulo nuevo.
2. **Conciliación izzi.** Comparar cuatro cuentas Google y después cobertura de otros proveedores
   con exports independientes del mismo día, red, moneda, reloj y nivel. Registrar maduración,
   extracción/exportación y tolerancias justificadas. `npm run conciliar` cubre su contrato
   documentado; no asumir que acredita jerarquía/tasas de Absolute Top sin extenderlo. Sin exports,
   dejar plantilla/comparación lista y bloqueo explícito; no conciliar la API consigo misma.
3. **Microsoft y frescura.** Última ronda izzi: catálogo/campañas 200; reportes diario/horario
   502/PROVIDER_ERROR. Causa abierta; DNS/HEAD fijo no prueba descarga firmada. Respetar backoff
   y checkpoints, investigar con lecturas pequeñas si hay configuración. ZIP/266 filas son
   históricos. X/Spotify ya aprobados: revalidar acceso efectivo, sin solicitar aprobación por
   errores antiguos. Spotify recuperó horas sin REVENUE; ingresos N/D, report_end inclusivo confirmado.
4. **Integridad y operación.** Validar backend durable, CAS real entre instancias, escrituras
   multiclave, edición obsoleta, crash/reintentos, tokens, backup/restauración y recuperación.
   File/Memory no garantizan coordinación distribuida. Medir tamaño/retención y capacidad antes
   de definir frecuencia. La propuesta de disco persistente requiere una instancia escritora;
   Netlify Blobs para registros no mueve todo el histórico ni checkpoints.
5. **UX y acceso.** Recorrer alerta/delegación/cierre con nota, cliente de lectura, marca/dominio,
   errores 412/428, vacío/carga, móvil, teclado y temas. Comprobar modal crítico y mensual
   simultáneos, foco y reanudación. Nexus permanece determinista.
6. **Candidata v1.** Checklist de lanzamiento/reversión: autenticación, HTTPS, cookies/CSRF,
   secretos de servidor, persistencia, observabilidad y extracción supervisada. No crear hosting
   ni activar scheduler/notificaciones en esta fase de auditoría.

## Reglas y permisos que conservar

- Meta: «CAPI WhatsApp» usa On-Facebook Purchase; el resto, Compras Offline Web (Inbound).
  Universos separados en análisis; sumar solo para venta total.
- Google offline: solo MCC_Offline_Lead_Contact y MCC_Offline_Purchase.
- CPA = suma de costo / suma de conversiones. No promediar CPAs, inventar FX, mezclar monedas
  o relojes, ni tratar desconocidos como cero.
- Juan Pablo conserva control máximo y protección de administrador principal. Hernán mantiene
  administración amplia, con atención nominal restringida.
- Solo Juan Pablo, Daniel Racines, Sebastián Vargas, Santiago Tamayo y Victoria Cárdenas
  responden alertas. Los demás leen sin escribir, incluidos Hernán, Guillermo y Operations.
  No ampliar por pertenencia a ABCW o título de administrador.
- Daniel configura/delega sin gestionar cuentas/contraseñas. Operativos autorizados atienden
  sin reasignar; clientes conservan su vista autorizada sin detalle técnico interno.
- Conservar las 15 cuentas privadas, IDs, marcas y contraseñas; no repetir bootstrap ni
  regenerar accesos para pruebas. Validar permisos en servidor además de UI.

## Pendientes separados

| Categoría | Pendiente y condición de cierre |
| --- | --- |
| Código/operación | Corregir defectos reproducidos; demostrar concurrencia, recuperación, backups y capacidad del backend elegido |
| Datos | Exports independientes izzi y conciliación por cuenta/período; no usar la API como referencia de sí misma |
| Permisos | Verificar acceso efectivo por cuenta/reporte cuando haya credenciales; X/Spotify ya aprobados, sin solicitud nueva presupuesta |
| Configuración | URLs HTTPS, alojamiento durable, secretos, rotaciones y ejecutor supervisado; aún sin despliegue autorizado |
| Negocio | Acción principal/IDs Meta, eventos TikTok/Spotify, mapeos offline Google y FX mensual USD→MXN; decisión del equipo |

Si falta un dato/acceso, avanzar en tareas independientes y dejar el resultado revisable.
No pedir secretos por chat ni declarar conciliación sin referencia independiente o aceptación
de producción sin validación del alojamiento autorizado. La v1 actual sigue sin aceptación.

## Validación y entrega de Claude

Antes de **cada commit**, desde cada proyecto:

```sh
# unified-ads-api/
npm run typecheck && npm run lint && npm run format:check && npm test
# media-monitoring-center/, si se toca
npm run check
```

Para cambios de código, añadir builds y regresiones pertinentes. No saltar, desactivar ni poner
pruebas en cuarentena. Suites sin red; lecturas reales separadas y acotadas. El navegador usa
demo aislada sin .env, .data, config nominal o webhooks reales.

No registrar OAuth, cabeceras, códigos/callbacks, URL firmadas ni contraseñas. No subir secretos,
llaves JSON, reportes privados o capturas reales. No leer «Ventas Detalle». Conservar TLS/proxy;
no reset/clean/checkout sobre cambios ajenos ni force-push. No desplegar, contratar, activar
cron/n8n o enviar mensajes externos.

Entregar commits descriptivos y push a la rama propia, README/AUDITORIA/guía actualizados,
hallazgos por severidad con reproducción y archivo/línea, resultados fechados y sus límites,
conciliaciones/bloqueos concretos, y checklist manual para el equipo.

## Revisión manual del equipo antes de aceptar

- Con Juan Pablo: configuración, acceso protegido, delegación y ambas marcas; cifras de esta
  ronda solo izzi. Comprobar lectura/escritura con cada identidad autorizada.
- Con operador autorizado: abrir asignación, añadir nota y cerrar sin reasignar. Con cliente
  y otros lectores: alertas visibles sin rutas de escritura permitidas.
- En izzi: tres dominios, campañas/grupos, N/D y límites; cambiar dominio sin afectar historial
  o incidencias y copiar manualmente un reporte.
- Conciliar Ads Manager, conservando referencias privadas. Resolver IDs/eventos y FX en su
  sección antes de aceptar CPA consolidado.
- Tras autorizar alojamiento: ambas URLs HTTPS, persistencia tras reinicio, backup/restauración,
  rollback, extracción supervisada, cookies y smoke desde el destino. El resultado local no
  sustituye esta aceptación.
