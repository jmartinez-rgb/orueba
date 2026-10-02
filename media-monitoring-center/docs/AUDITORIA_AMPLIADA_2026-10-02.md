# Auditoría ampliada del monitoreo — 2 de octubre de 2026

Base `501e45f`, rama `codex/finalizacion-verificador-meta-x`. Continúa la
[auditoría de diseño y Nexus](AUDITORIA_UX_NEXUS_2026-10-02.md). Se ampliaron las pruebas
por riesgo y se reprodujeron defectos antes de corregirlos, con revisiones paralelas de
acceso, datos, concurrencia, proveedores y UX. Los conteos de esta ronda prevalecen sobre
los checkpoints anteriores; las lecturas reales de plataformas conservan sus fechas originales.
No hubo despliegue ni publicación. V1 sigue pendiente de conciliación y aceptación.

## Correcciones comprobadas

| Área y archivo | Defecto reproducido | Resultado y alcance |
| --- | --- | --- |
| [tickets/[id]/route.ts](../src/app/api/tickets/[id]/route.ts#L34) | Conocer el ID permitía actualizar y devolver un ticket de la otra marca. Cuatro regresiones fallaban. | PATCH exige que el ticket pertenezca a la marca seleccionada. Los registros heredados sin marca se consideran izzi. Respuesta 404 fuera del alcance. |
| [integrations.ts](../src/lib/services/integrations.ts#L28), [snapshot.ts](../src/lib/services/snapshot.ts) y API de integraciones | Nueve casos exponían diagnósticos de integraciones sin sanear o sin permiso técnico; cubren Sheets, mapeo BigQuery y eventos BigQuery/n8n. | Los mensajes se sanean también dentro de la metadata; API y vistas respetan `technical:view`. Los lectores reciben una explicación operativa. No se leyó ninguna hoja real. |
| [account-coverage.ts](../src/lib/data/account-coverage.ts#L5), [brand-source.ts](../src/lib/data/brand-source.ts#L128), [unified/source.ts](../src/lib/unified/source.ts) | La ausencia completa de una cuenta/plataforma podía desaparecer de los agregados. Nueve casos fallaron contra los módulos de la base. | Dentro de los días/horas observados, una cuenta esperada ausente aporta métricas desconocidas. Un cero confirmado se conserva. Comparar obtiene su total general de cobertura por plataforma, no solo de campañas visibles. |
| [analysis.ts](../src/lib/services/analysis.ts#L19) | Comparar y el perfil semanal de Histórico promediaban CPAs diarios: costo 100/1 conversión y costo 100/9 conversiones daban 55,56. También omitían del numerador el gasto de días sin conversiones. Dos regresiones fallaron en cada vista. | Referencias de CPA: 200/10 = **20**. CPC, CPL, CPM, CTR y ROAS también se derivan de componentes agregados. Un denominador cero queda desconocido; no se suman parejas con un componente desconocido. Las métricas base conservan su promedio y la mediana conserva su significado de distribución. |
| [budget.ts](../src/lib/services/budget.ts) | Se contaban horas de otra fecha, se duplicaba gasto diario con horario y se pronosticaba con cuentas ausentes o curva insuficiente. | La ventana del día y la cobertura histórica se comprueban antes de calcular gasto/proyección. Sin base suficiente, el pronóstico queda desconocido. Incluye escenarios generados con varias cuentas, campañas y plataformas. |
| [records/tickets.ts](../src/lib/records/tickets.ts), [feedback.ts](../src/lib/records/feedback.ts), [novedades.ts](../src/lib/records/novedades.ts) | Guardar seguimientos en paralelo perdía respuestas; un reintento tras respuesta perdida podía duplicarlas. | Append con `RecordStore.update`; UUID y fecha se crean fuera de la transformación pura. Hasta 50 recibos privados deduplican reintentos de la misma operación y se eliminan de las respuestas públicas. No supone transacciones multiclave ni ejecución única indefinida. |
| [nexus/answer.ts](../src/lib/nexus/answer.ts), [api/nexus/route.ts](../src/app/api/nexus/route.ts) | Fechas DD/MM/YYYY y otros cortes se ignoraban; nombres de campaña con meses se confundían con periodos; se consolidaban cuentas parciales y podía resultar infinito. Había ambigüedad entre plataformas y entrada UTF-8 inválida sin cancelar el stream. | Periodos no soportados se remiten a Histórico/Comparar. Nombres completos no se confunden con solicitudes de fecha. Totales exigen cuentas al día y misma ventana; resultados no finitos quedan desconocidos. Se pide aclaración del alcance y se cancela la entrada inválida. |
| API: [google/normalize.ts](../../unified-ads-api/src/providers/google/normalize.ts#L43), [meta/normalize.ts](../../unified-ads-api/src/providers/meta/normalize.ts#L62) | `2026-09-31` se aceptaba por formato/normalización de Date en rendimiento y conversiones; cuatro casos fallaron. | Validación de calendario con `z.iso.date()`, coherente con las consultas. Fixtures de seis proveedores cubren monedas, unidades, ceros, fracciones y cancelación previa a OAuth. |
| [settings-form.tsx](../src/components/monitoring/settings-form.tsx#L58), [feedback-center.tsx](../src/components/feedback/feedback-center.tsx#L56) | 29 controles numéricos de Settings y dos selectores del formulario de sugerencias carecían de asociación accesible con sus etiquetas. | IDs únicos, labels asociados y descripciones de unidades/contexto; también se identifica el selector de estado en filas duplicadas. Siete pruebas de markup. |
| En vivo, Cliente, Novedades, [pacing-cards.tsx](../src/components/monitoring/pacing-cards.tsx#L141) y [sheet.tsx](../src/components/ui/sheet.tsx) | Desbordamientos a 320 px y botón de cierre de 36 px en tablet. | Grids/controles se adaptan al ancho, los nombres largos conservan texto completo accesible y el cierre mantiene 44 px. Es una mejora de ergonomía, no una declaración de incumplimiento ni certificación WCAG. |

## Validación ejecutada

Entorno local: Node **24.19.0**, Next **16.3.6**, Chromium/Playwright. Node 22 está en la
matriz de CI de la API, pero no se ejecutó localmente en esta ronda. Ninguna prueba se saltó,
desactivó ni puso en cuarentena.

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| Monitoreo: `npm run check` | **658 pruebas / 61 archivos**, tipos y lint pasan | 173 pruebas adicionales frente a la base de 485. Permisos, marcas, revocación, estado corrupto, conflictos, replay, cálculos, reloj, formularios y Nexus. |
| Monitoreo: `npm run build` | Pasa | Compilación de producción local; no despliega. |
| API: `npm run typecheck && npm run lint && npm run format:check && npm test` | **648 pruebas / 35 archivos**, todos los checks pasan | 22 pruebas adicionales frente a 626. Fixtures sin llamadas a plataformas. |
| API: `npm run build` | Pasa | Artefacto local. |
| Componentes heredados: `node pruebas/api.test.mjs` y `node pruebas/motor.test.mjs` | **21 + 8 comprobaciones pasan** | API y motor con simuladores locales, sin campañas reales. |
| Navegador: `scripts/ux-regression.cjs` | **320/320 pasan**, cero fallas | 300 páginas (30 rutas × cinco anchos × dos temas), ocho recorridos de teclado, seis roles demo, cuatro bloqueos/reanudaciones, un flujo Nexus y un flujo de formularios offline. |
| Nexus con handler real local | **10 casos pasan** | Intercambio completo móvil de guía; resumen, métricas, lista/ambigüedad, fecha no soportada, reglas de negocio, tema desconocido, entrada vacía, cambio a Sky y cliente denegado. Datos mock; las respuestas de Nexus no se interceptan. |
| Acceso nominal por HTTP | **15 accesos pasan**, cinco responsables conservados | Dos administradores pueden consultar Usuarios; los otros 13 no. Ocho usuarios internos acceden a Nexus; siete clientes reciben 403. Nexus anónimo 401. Sin cambios de roles/contraseñas; entrar sí agrega su registro normal de acceso. |
| `npm run v1:check -- --sin-red --registros` | Configuración presente y `RECORD_IO_VERIFIED`; salida **2 esperada** | Sondeo aislado de escritura/lectura/eliminación local. No valida proveedores ni persistencia de producción. |

Ambas suites bloquean `fetch` por defecto, incluso después de `vi.unstubAllGlobals()`;
los fixtures de transporte se instalan explícitamente. Esto evita llamadas accidentales desde
esas pruebas: no es un bloqueo del sistema operativo ni de todos los sockets HTTP.

El harness de navegador solo admite un origen loopback en modo mock y sin n8n/WhatsApp.
Todas las escrituras se interceptan salvo cookies locales de rol/marca. La prueba nominal usa
el entorno local con acceso por contraseña y consulta el histórico guardado, sin extraer datos
publicitarios nuevos. Cookies y credenciales se mantienen en memoria, fuera de evidencia.
Resultados: [evidencia saneada](evidence/auditoria-ampliada-2026-10-02/resultados.json).
La primera compilación ampliada pasó 318/320; los dos fallos fueron el selector de En vivo
a 320 px en ambos temas. Tras corregirlo y repetir el recorrido completo, pasan 320/320.
[Captura de Cliente en móvil](evidence/auditoria-ampliada-2026-10-02/cliente-movil.png), con datos simulados.

## Repetir la revisión UX

Requiere Node ≥22.3, Playwright resoluble por Node y Chromium disponible en `CHROMIUM_PATH`
o `/usr/bin/chromium`. No instala dependencias automáticamente. Usar una demo aislada con
`DATA_SOURCE=mock`, `RECORDS_BACKEND=memory`, `AUTH_MODE=open`, sin valores privados de
autenticación/API/webhooks y con WhatsApp desactivado. No dirigirla al entorno nominal ni a producción.

```bash
node scripts/ux-regression.cjs --base http://127.0.0.1:3003 --out /tmp/auditoria-ux
```

`--quick` reduce los anchos a 390 y 1440. El modo completo verifica 320, 390, 768, 1024 y 1440
en claro/oscuro. Comprueba geometría, nombres de controles, errores de ejecución/hidratación,
foco, teclado y recuperación de formularios. No sustituye un lector de pantalla ni certifica WCAG.

## Pendientes separados para Claude

- **Código:** CAS/transacciones de usuarios y otros escritores entre instancias; evaluación
  multiclave, outbox e idempotencia de notificaciones; bitácora financiera durable; transporte
  Microsoft con resolución DNS fijada compatible con el proxy. En Settings, una escritura
  aplicada cuya respuesta se pierde puede terminar en conflicto 412 al reintentar: recargar para
  confirmar antes de repetir. Existe una regresión que documenta ese límite, no lo oculta.
  Los recibos de append cubren solo las últimas 50 operaciones. File/Memory serializan dentro
  del proceso; los fixtures de CAS no prueban Netlify real. Nexus tiene búsqueda acotada y límite
  por proceso, sin memoria conversacional general ni LLM.
  Los recibos estabilizan el replay de una operación en el almacén; solicitudes HTTP distintas
  generan IDs nuevos y no adquieren idempotencia por este cambio.
- **Permisos:** no se comprobaron nuevos permisos publicitarios. Mantener el mapeo autorizado;
  Spotify USD adicional sigue fuera. Los 15 usuarios y cinco responsables se conservan; clientes
  no obtienen acceso interno a Nexus ni edición de alertas.
- **Configuración:** pruebas de Netlify Blobs/ETag, volumen compartido durable, reinicios,
  scheduler y entrega efectiva de avisos en el destino. Capturar tasas USD→MXN por mes en su
  sección; no se inventaron tasas ni se trasladaron secretos a Git.
- **Negocio y datos:** conciliar costos/monedas/reloj/atribución contra plataformas. Confirmar
  eventos principales de TikTok/Spotify, acciones exactas de las dos reglas de Meta y mapeo
  offline de Google. Falta una muestra no nula de `total_complete_payment_rate`. Meta CAPI
  WhatsApp y las demás campañas permanecen separados en análisis; Google conserva los dos
  eventos offline válidos. La cobertura nueva depende del catálogo actual y los buckets observados:
  no certifica cada campaña/evento esperado ni intervalos históricos de activación de cuentas.

La configuración local quedó conservada. API en 8086 y monitoreo nominal en 3000 son puertos
locales, no URL públicas. Claude debe auditar el HEAD de la rama antes de aceptar v1.
