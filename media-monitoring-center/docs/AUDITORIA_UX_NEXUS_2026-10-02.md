# Auditoría funcional, diseño y Nexus — 2 de octubre de 2026 UTC

Base: `36bc07c4e32a87ecc15e653f55bf200c01d3e7dc`. Rama de entrega:
`codex/finalizacion-verificador-meta-x`. Esta revisión continúa la
[preauditoría anterior](../../unified-ads-api/docs/PREAUDITORIA_V1.md).
El resultado queda preparado para la auditoría de Claude; no declara la aceptación de v1.

## Alcance y método

Se revisaron autenticación y roles, rutas y formularios, asignación de incidentes, registros,
configuración, presupuesto, ingestión directa, aislamiento por marca, evaluación, transporte
n8n, errores y la integración con la API unificada. En la API se revisaron accesos, extracción,
rotación de tokens y descarga de informes Microsoft; se conservó su contrato y código.

Agentes separados revisaron navegación, alertas, UX en Chromium, integridad de registros,
presupuestos, seguridad y Nexus. Las pruebas de UX usan un servidor local aislado con datos
simulados y almacenamiento en memoria. Sus webhooks están vacíos y WhatsApp desactivado.
Los fixtures de navegador se limitan a respuestas locales; no simulan una validación real de
plataformas. No son entrevistas ni pruebas con usuarios humanos.

## Defectos comprobados y correcciones

| Área | Reproducción | Corrección y límite |
| --- | --- | --- |
| Simulación y n8n | Un entorno mock con un webhook configurado podía efectuar un POST real. La evaluación con contexto mock y `dryRun:false` podía despachar notificaciones aunque no persistiera el estado. | Barrera de simulación en el transporte y en la evaluación efectiva, incluido fallback a mock. El `dryRun:true` explícito conserva su protección previa. Fixtures comprueban cero llamadas de red. |
| IDs de registros | Doce creaciones simultáneas de feedback, tickets o novedades compartían un ID y sobrescribían registros. | Reserva con `RecordStore.update`, validación de contador y conservación de IDs históricos. Reserva y creación siguen siendo dos escrituras; pueden quedar huecos. File/Memory solo serializan este proceso; Blobs usa CAS. |
| Presupuesto mensual | Un día con datos de una sola cuenta podía hacer aparecer el total de dos cuentas como completo. | Cobertura por miembro del catálogo propagada a cuenta, plataforma y total. Los acumulados incompletos quedan `null/PARTIAL`; el gasto completo de hoy y los ceros reales se conservan. |
| Pronóstico | Se verificaban índices del array de días restantes en lugar de los días de semana, omitiendo histórico requerido. | Se exige el mínimo de muestras para cada día restante; sin muestras, el pronóstico queda desconocido. La ventana histórica continúa siendo de 28 días. |
| Tabla de campañas | Valores ausentes se sumaban como cero y se mostraban como un total completo. | Totales estrictos por métrica en las filas visibles, con advertencia de cobertura; un cero confirmado conserva cero. |
| Salud de entrega | Una cuenta fuera del mapeo, con nombre neutro, podía entrar en izzi por heurística. | En modo directo se filtra por ID compuesto y marca explícita del catálogo, incluidos presupuestos y fecha de extracción. Fuentes heredadas/mock conservan su comportamiento. |
| Diagnósticos | Fixtures con secretos ficticios demostraron que `Error.message` conservaba URL firmadas, parámetros y cabeceras; las respuestas ofrecían detalles técnicos sin comprobar permiso. La revisión cruzada final encontró el mismo problema en el mensaje devuelto por n8n. | Se eliminan ruta/query y credenciales reconocibles, se conserva el host y se exige `technical:view` antes de enviar detalles en errores HTTP y paneles. Los errores n8n se sanean antes de construir la respuesta. No se observó ni registró una fuga de credencial real. |
| Alertas e incidentes con teclado | Enter abría y cerraba inmediatamente el panel; Escape dejaba el foco fuera de la fila. | Enter/Espacio consumen el evento y el cierre restaura el foco. Fallos de conexión muestran feedback y no afirman que una escritura no ocurrió. |
| Alerta crítica obligatoria | Tab escapaba a controles detrás del diálogo. | Diálogo modal Radix con foco contenido, fondo inaccesible y retorno de foco; se conserva la obligación de documentar el acuse. |
| Prioridad de avisos obligatorios | Si la respuesta de arranque llegaba después del crítico, abría un segundo modal y enviaba el foco detrás del acuse. | `OperationalGates` suspende arranque y recordatorios mientras haya críticos, conserva su estado y los reactiva después del acuse. Fixtures comprueban ambos órdenes de respuesta y ambos tipos de aviso. |
| Móvil y movimiento reducido | Las pestañas desbordaban la página; la guía producía un error de hidratación al omitir el destello en cliente. | Pestañas adaptables, animación CSS con el mismo árbol inicial, movimiento reducido y contraste de insignias/ejes ajustados. |
| Cambio de marca en Nexus | La prueba de integración reprodujo dos botones después de cambiar a Sky, tanto en desarrollo como en el build. Dos componentes hermanos compartían la clave React de la marca. | Claves distintas para Nexus y arranque de mes; el navegador comprueba un único botón y conversación nueva tras cambiar de marca. |
| Ausencia de datos | Un resumen sin plataformas podía anunciar «Todo en orden». | Estado explícito de evaluación pendiente, cobertura visual y etiquetas de KPI sin dato. No se cambia el significado de `null` ni el motor de anomalías. |

## Diseño y Nexus

Puntos de entrada para revisar los cambios (líneas de esta entrega):

- `src/lib/n8n/client.ts:45`, `src/lib/services/evaluate.ts:32` y
  `src/app/api/monitoring/run/route.ts:43`: barreras de simulación.
- `src/lib/records/counter.ts:18` y los módulos feedback/tickets/novedades: reserva de IDs.
- `src/lib/services/budget.ts:166` y `:257`: cobertura y muestras del pronóstico.
- `src/components/monitoring/campaigns-table.tsx:78`: totales de las filas visibles.
- `src/lib/services/delivery-health.ts:92` y `src/app/(app)/page.tsx:161`: alcance por cuenta.
- `src/lib/logging/logger.ts:28`, `src/lib/services/http.ts:27` y
  `src/components/monitoring/error-panel.tsx:7`: diagnóstico y permisos.
- `src/lib/n8n/client.ts:103` y `tests/n8n-redaction.test.ts:43`: mensaje n8n saneado,
  incluso para una sesión sin detalle técnico.
- `src/components/monitoring/critical-alert-gate.tsx:139`: diálogo obligatorio accesible.
- `src/components/monitoring/operational-gates.tsx:7` y
  `src/components/novedades/month-gate.tsx:95`: un único aviso operativo accesible.
- `src/components/monitoring/status-hero.tsx:34`: cobertura y evaluación pendiente.
- `src/components/layout/app-shell.tsx:149`: Nexus y prioridad de diálogos.
- `src/app/api/nexus/route.ts:35`, `src/lib/nexus/data.ts:22` y
  `src/lib/nexus/answer.ts:60`: acceso, proyección y búsqueda.


La navegación y los títulos principales están alineados en español, con sección activa, foco
visible, salto al contenido y menú móvil desplazable. Resumen muestra tarjetas de seguimiento,
cobertura y métricas con iconos; Alertas e Incidentes incluyen resúmenes y estado de acceso.
Los controles revisados tienen áreas de interacción mayores. Las señales críticas de entrega
permanecen visibles; advertencias y contexto se despliegan cuando se necesitan.

[Nexus](NEXUS.md) responde preguntas sobre el uso, cuentas, campañas, alertas y métricas del
corte actual. Es búsqueda y guía local, sin modelo generativo, acciones ni servicios externos.
No completa cifras desconocidas ni decide los eventos pendientes. Verifica permisos y marca;
los clientes permanecen fuera de esta primera versión. Sus enlaces abren el filtro de campaña
o el incidente correspondiente. No almacena conversaciones ni envía preguntas a terceros.

## Validación

- **API unificada:** `npm run typecheck && npm run lint && npm run format:check && npm test`,
  **626 pruebas en 33 archivos**, y `npm run build`.
- **Monitoreo:** `npm run check` (tipos, lint y **485 pruebas en 49 archivos**) y
  `npm run build`. Son **118 pruebas nuevas** respecto de la base de 367; ninguna se omitió
  ni puso en cuarentena. La última corrección n8n tiene cuatro regresiones que fallaban antes.
- **Navegador sobre `next start`:** 15 combinaciones de cinco vistas y anchos 1440/390/320 px,
  otras 20 rutas a 390 px y 24 comprobaciones de rutas para seis roles en demo. Sin errores
  de página ni desbordamiento global en las vistas revisadas. Se probaron tema claro/oscuro,
  navegación por teclado, retorno de foco, movimiento reducido, conexión fallida, cancelación,
  reintento y cambio de marca en Nexus. El rol cliente no ve Nexus y su POST recibe 403.
- **Avisos operativos:** tres órdenes de llegada en la app compilada conservan un único acuse
  crítico y el foco dentro de él; cuatro fixtures del componente verifican ambos órdenes y
  la reanudación del aviso obligatorio o recordatorio después de acusar el crítico.
- **HTTP con configuración nominal conservada:** health de API 200, Nexus anónimo 401;
  cuatro muestras internas reciben 200 y la muestra cliente 403. Se comprobaron permisos
  de Usuarios para administrador frente a coadministrador/operador. Siguen **15 cuentas**
  y **cinco responsables**; no se cambiaron contraseñas ni tasas.
- **Contraste:** las insignias muestreadas dan un mínimo de 4.82:1 en las capturas claro/oscuro.
  Es una comprobación parcial, sin certificación de accesibilidad.

[Resultados de navegador](evidence/ux-2026-10-02/resultados.json),
[resumen en escritorio](evidence/ux-2026-10-02/resumen-escritorio.png) y
[Nexus móvil](evidence/ux-2026-10-02/nexus-movil.png). Las imágenes contienen datos simulados.
El recorrido usa un entorno local aislado, no producción publicada. El último saneamiento
n8n no cambia la interfaz; después se repitieron check/build y el smoke de la compilación final.

Las comprobaciones reales por plataforma de la matriz anterior conservan sus fechas:
esta ronda no realizó nuevas lecturas de proveedores ni una conciliación con Ads Manager.

## Pendientes separados

- **Código:** transacciones/CAS de usuarios entre instancias y otros escritores de estado;
  evaluación multiclave y outbox/idempotencia de notificaciones; bitácora financiera durable;
  transporte Microsoft con resolución DNS fijada compatible con el proxy; cobertura histórica
  y DST. El contador no garantiza ejecución única. El límite de consultas de Nexus es local
  al proceso y su buscador reconoce un conjunto acotado de preguntas, sin contexto conversacional
  general. No se certifica ausencia de otros defectos por estas pruebas.
- **Permisos:** esta ronda no verificó accesos nuevos. No se incorporaron cuentas ajenas al mapeo;
  la cuenta adicional Spotify USD sigue fuera. Los roles y cinco responsables de alertas se
  conservaron; no se ampliaron permisos a clientes para Nexus.
- **Configuración:** pruebas de persistencia/reinicio y CAS en Netlify real, worker/scheduler,
  entrega real de notificaciones y captura de tasas USD→MXN por mes. La configuración privada,
  las 15 cuentas nominales y sus contraseñas no se cambiaron en esta ronda.
- **Negocio y datos:** conciliar costos y cobertura contra las plataformas; confirmar eventos
  principales de TikTok/Spotify, acciones exactas de Meta y mapeo offline de Google. Verificar
  una muestra no nula de `total_complete_payment_rate`. CPA sigue siendo suma de costo dividida
  entre suma de conversiones. Meta CAPI WhatsApp y el resto permanecen separados en análisis.

No hubo publicación, despliegue, envío a personas ni edición de campañas. Los puertos locales
no son direcciones públicas. La auditoría de Claude debe revisar esta rama y los límites
anteriores antes de considerar la aceptación de v1.
