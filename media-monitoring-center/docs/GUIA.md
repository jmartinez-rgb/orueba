# Guía del Monitoring Center

Versión en documento de la sección **Guía** de la app (`/guia`), que además muestra los umbrales
vigentes y un probador de clasificadores. Explica qué hay en cada parte, cómo leerlo y qué hacer.

> **Solo monitoreo.** La plataforma no cambia campañas, presupuestos ni configuraciones en Google,
> Meta, TikTok, Microsoft, Spotify o X. Todo ajuste se hace manualmente en cada plataforma. Tampoco
> envía WhatsApp por sí misma: el mensaje de monitoreo se copia y se envía a mano, y las alertas
> automáticas las entrega n8n.

## izzi y Sky

izzi y Sky son **dos monitoreos separados**. El botón **izzi | Sky** de la barra superior cambia
entre ellos en un clic (se recuerda en tu navegador):

- El color de la app cambia (verde izzi, azul Sky) y el título dice la marca, para que nunca haya
  duda de qué se está viendo.
- Cada botón muestra el estado general de su marca; si la otra marca tiene críticos abiertos, su
  botón lleva un contador rojo.
- Cada marca tiene sus alertas, incidentes (los de Sky con folio `SKY-INC-0001`), tickets, mensajes
  de Monitoreos y presupuestos de referencia. El mensaje de Monitoreos de Sky dice "comparto el
  monitoreo de Sky".
- Las cuentas se asignan por su nombre ("Sky - ABCW", "Sky Performance - MXN", "Sky México" son
  Sky); la cuenta mixta "izzi - Sky Social" se separa por campaña ("Sky / …" y "izzi / …").
- Si tu cuenta solo tiene acceso a una marca, no ves el botón.

## Avisos de críticos

- Mientras haya un incidente crítico sin acusar, la pantalla se bloquea hasta registrar qué se revisó
  y a quién se reporta.
- La pestaña del navegador muestra el número de críticos pendientes, por ejemplo "(2) Overview".
- **Avisos de escritorio:** en el menú de tu usuario elige "Avisarme de críticos en el escritorio" (o
  el botón del mismo nombre en la alerta crítica). Cuando entra un crítico nuevo con la pestaña en
  segundo plano, llega una notificación del sistema.

## Cómo leer el semáforo

Regla principal: **hoy vs el mismo día de la semana en la misma franja horaria** (00:00 → hora de
corte) de las 4 semanas anteriores (promedio o mediana, configurable).

| Estado | Desviación vs lo esperado (default) |
|---|---|
| 🟢 Normal | menos de 15% |
| 🟡 Atención | 15% a 25% |
| 🟠 Alerta | 25% a 40% |
| 🔴 Crítico | más de 40% |
| ⚪ DATA DELAYED | La fuente está atrasada: no se evalúa rendimiento |

El porcentaje no decide solo. La severidad baja o sube por volumen (poco gasto o pocos resultados
no alertan), variabilidad histórica de esa entidad, hora del día (temprano, o antes del 20% del
volumen diario, baja un nivel), frescura del dato, peso en la inversión (una campaña chica no pinta
de rojo la plataforma; varias cayendo a la vez sí) y objetivo (cada campaña con el KPI de su
objetivo; cada plataforma con su métrica monitoreada).

**NULL no es cero y un atraso no es una caída**: sin dato se muestra "sin dato"; con la fuente
atrasada se muestra DATA DELAYED en gris.

Tres reglas más, pensadas para los datos reales de la hoja:

- **Conversiones que llegan con retraso.** Las conversiones de Google y las ventas offline de Meta
  (Compras Offline Web) se suben horas o días después. En el día no se juzgan (ni tracking, ni
  caída, ni costo por resultado); la tarjeta las marca "(llegan con retraso)" y en gris. El gasto sí
  se evalúa.
- **Curva típica.** Si la hoja solo trae el acumulado del día (sin pestañas por hora), el esperado
  a la hora de corte sale de una curva típica. Las alertas que dependen de ese esperado bajan un
  nivel (máximo Alerta) y la app no declara "dejó de gastar", porque no puede saber a qué hora
  paró. El gasto en cero sigue siendo crítico. Con las pestañas por hora (INSTALACION.md, A4) se
  vuelve exacto. Las plataformas sin pestaña por hora (TikTok) aprenden su curva sola: la app anota
  el acumulado de cada actualización de Dataslayer y en 3 días usa la curva real.
- **Cambio sostenido.** Si una cuenta o campaña lleva 3 días completos en otro nivel (por ejemplo,
  se le movió presupuesto), la severidad se mide contra ese nivel nuevo. Si hoy sigue igual, queda
  en Atención con la nota "parece un cambio de presupuesto"; si hoy cae además, conserva la alerta y
  dice cuánto cayó contra ese nivel. Los días se cambian en Settings.

## Flujo diario sugerido

Nexus es el botón de consulta del monitoreo interno. Puedes preguntar por una campaña usando
nombre o ID, por alertas o frescura, y por cómo delegar un incidente o leer una métrica.
Responde para la marca seleccionada y el corte disponible, con enlaces para comprobarlo.
No modifica registros ni plataformas; es búsqueda y guía local. [Uso y límites](NEXUS.md).

1. **Overview**: el estado general y el color de cada plataforma responden si todo está bien.
2. Si aparece la **alerta crítica a pantalla completa**, revisa, escribe qué revisaste y a quién lo
   reportas (puede crear un ticket).
3. Revisa **Carga de datos** y **Confianza**: si dice *Debe ejecutarse*, corre el paso pendiente
   (Dataslayer / Apps Script) antes de sacar conclusiones.
4. Entra a la plataforma en rojo o naranja y baja a cuentas, estrategias y campañas.
5. Consulta **Optimizaciones** para saber qué revisar según la documentación oficial.
6. Genera el mensaje en **Monitoreos**, ajusta semáforos si hace falta, marca las revisiones de
   Zapier, cópialo y envíalo por WhatsApp. Guárdalo en el historial.
7. Si el problema es grave, documenta el reporte en **Tickets** hasta cerrarlo.

## Qué hay en cada sección

| Grupo | Sección | Qué hay | Úsala para |
|---|---|---|---|
| Monitoreo | Overview | Estado general, semáforo por plataforma con su métrica monitoreada (se elige en la tarjeta), confianza, carga de datos, alertas, incidentes y curva de gasto | Lo primero al entrar |
| Monitoreo | Live Monitoring | Hora por hora de hoy vs el mismo día de semanas anteriores | Ver cuándo empezó una caída o un pico |
| Monitoreo | Platforms | Resumen y detalle por plataforma: cuentas, estrategias, curvas (gráfica o tabla), comparación histórica, campañas y salud de datos | Bajar de plataforma a cuenta y campaña |
| Monitoreo | Campaigns | Todas las campañas con el KPI de su objetivo, desviación y alertas | Encontrar qué campaña explica una variación |
| Monitoreo | Monitoreos | Mensaje de monitoreo para WhatsApp con el formato del equipo e historial | Cada corte: revisar, copiar y enviar |
| Alertas | Alerts | Una alerta por anomalía; las de la misma causa se agrupan | Cambiar estado o marcar falsos positivos |
| Alertas | Incidents | Anomalías persistentes o graves con línea de tiempo, notas y notificaciones | Seguimiento y documentación |
| Alertas | Tickets | Reportes de problemas graves: a quién, canal, número de caso y evolución | Problemas que hay que reportar |
| Análisis | Budget Control | Presupuesto diario configurado en cada plataforma por estrategia contra el gasto de hoy; presupuesto mensual vs gasto, pacing y forecast; nivel de presupuesto por cuenta | Anticipar sobre o subejercicio y ver dónde está el dinero hoy |
| Análisis | Compare | Cualquier fecha vs semanas anteriores por plataforma, cuenta, estrategia, objetivo o campaña, con gráfica y tabla | Explicar una variación con datos |
| Análisis | Historical | Tendencia diaria, perfil por día de la semana y mapa de calor por hora | Entender patrones normales |
| Análisis | Métricas | Métrica monitoreada y métricas fijas por plataforma, objetivos fijos y definiciones | Decidir qué se vigila |
| Análisis | Optimizaciones | Recomendaciones de la documentación oficial cruzadas con las anomalías de hoy, con enlace a la fuente | Saber qué revisar en la plataforma |
| Operación | Integrations | Flujo de datos, hoja de control, monedas, BigQuery, n8n y WhatsApp | Cuando baja la confianza o falta una carga |
| Operación | Automation | Workflows de n8n | Entender qué corre solo |
| Operación | Usuarios | Personas, accesos y bitácora (solo administradores) | Saber quién entró y qué hizo |
| Operación | Settings | Umbrales, horarios, histórico, destinatarios, tipo de cambio, moneda por cuenta y clasificadores | Ajustar cómo evalúa el monitoreo |
| Operación | Tipo de cambio | Captura mensual USD→MXN, tasa aplicada y monedas de las cuentas de la marca | Capturar la tasa del equipo y revisar pendientes de conversión |
| Ayuda | Guía | Esta guía | Resolver dudas |
| Ayuda | Bugs y sugerencias | Enviar un bug o una idea; ver el estado de lo enviado. El administrador tiene la bandeja completa | Cuando algo falla o se te ocurre una mejora |

## Monitoreos: el mensaje de WhatsApp

Compara la **misma franja** de hoy contra **ayer** y contra **el mismo día de la semana pasada**, por
cuenta y por campaña. Estructura:

```
Buenos días equipo, comparto el monitoreo:

🟢Presupuesto y Línea de crédito
🟢Problemas con Plataformas
🟠Campañas activas en Google
🟢Fluctuación de Conversiones en Google
🟠Campañas activas en Facebook
🟠Fluctuación de Conversiones en Facebook
👥 Conversiones en Facebook al momento en <cuenta>: N      (una línea por cuenta)
🟢Todas las campañas de Zapier están funcionando correctamente
🟢Todos los enlaces de Zapier están funcionando correctamente

(detalle de cada punto en naranja o rojo)
```

| Punto | Se marca 🟠 cuando… |
|---|---|
| Campañas activas | Una cuenta gasta 15% menos o más que la semana pasada, o 15% menos que ayer; una campaña activa gastó ayer o la semana pasada y hoy no; una campaña (mínimo $500 hoy) gasta 25% más que ayer; o el motor marca la plataforma fuera de lo normal |
| Fluctuación de conversiones | Una cuenta con al menos 10 conversiones de referencia baja 20% o más vs el mismo día pasado o vs ayer |
| Presupuesto | El cierre estimado del mes se desvía del presupuesto |
| Problemas con plataformas | Datos atrasados o con error, o pasos pendientes en la hoja de control |

🔴 se usa para caídas críticas de delivery o de tracking, errores de datos y desvíos críticos de
presupuesto. Cada semáforo se puede corregir a mano antes de copiar y las revisiones de Zapier se
marcan manualmente. Los umbrales, las revisiones manuales y la nota final (`{umbral}` se reemplaza
por el porcentaje) se editan en *Monitoreos → Configurar mensaje* (administradores). En Meta la plataforma se llama "Facebook", como en el mensaje del equipo. El
botón **Abrir en WhatsApp** solo abre WhatsApp con el texto; la app no envía nada.

## Confianza de datos

Qué tan confiable es lo que muestra el monitoreo (0–100%). Alta ≥ 85%, media ≥ 60%, baja < 60%.

| Motivo | Efecto |
|---|---|
| Sin datos del día / error de sincronización / datos atrasados | Máximo 0% / 20% / 40% |
| Cuentas atrasadas excluidas | Según su peso en el gasto (mínimo −10) |
| Horas faltantes, filas duplicadas, gasto NULL, última hora incompleta | Descuentos parciales |
| Hoja de control: error / pendiente / vencido / parcial | −30 / −20 / −15 / −10 |
| Tipo de cambio: mes sin tasa / usando la del mes anterior | −25 / −5 por mes |
| Histórico incompleto | −5 por semana de referencia sin dato |

Pasa el cursor sobre el indicador para ver el motivo de cada punto descontado.

## Métricas monitoreadas y fijas

- **Métrica monitoreada** de cada plataforma (conversiones, leads, ventas, WhatsApp, llamadas,
  compras, clics o impresiones): es la que decide su semáforo. Se cambia en la tarjeta del Overview
  o en Métricas y aplica al momento para todo el equipo: tarjeta, detalle de la plataforma y la
  gráfica "Ritmo de resultados".
- **Métricas fijas**: hasta 3 por plataforma, siempre visibles en su tarjeta.
- **Objetivos fijos** (opcionales): un valor diario de referencia por métrica. Las métricas que se
  suman (gasto, conversiones…) se comparan contra la proyección del día; las calculadas (CPA,
  CTR…) contra su valor acumulado. CPA = SUMA(costo) ÷ SUMA(conversiones), nunca un promedio.

## Estado de campaña

Cuando la hoja trae la columna de estado de la campaña, la app usa el estado que reporta cada
plataforma (en Campañas se ve junto a su texto original; sin la columna dice "por gasto").

- **Pausada o terminada a propósito**: no genera alertas propias, y si explica una caída del gasto
  de su plataforma o cuenta, la alerta baja a Atención con la explicación ("la caída se explica por
  la campaña X, pausada…"). Si solo explica una parte, la severidad sale del resto.
- **Pausada por presupuesto, rechazada, en revisión o sin pago** no cuenta como pausa planeada: la
  caída se sigue alertando y la alerta cita el estado de la plataforma.
- **Activa en la plataforma pero sin gasto desde ayer**: queda como Alerta (no Crítico), con la
  sugerencia de revisar conjuntos, anuncios, pago o aprobación.

## Cuándo alerta y cuándo no

Criterios para no llenar de alertas (medidos con los datos reales de septiembre: de ~27 alertas
visibles por día a ~12, de las que ~7 piden acción; de 27 críticos en tres semanas a 1):

1. **Crítico solo para una cuenta o plataforma completa.** Una campaña sola llega como máximo a
   Alerta y solo si pesa al menos 5% del gasto esperado de su plataforma; las demás se ven dentro de
   la alerta de su cuenta (desglose "¿Qué pasó?") y en Campañas.
2. **Apagado masivo = Crítico**, aunque sean pausas: casi todo el gasto esperado de una cuenta o
   plataforma se detuvo de golpe (ayer sí gastaba). Si ya venía apagada, baja a Alerta hasta que se
   registre en Novedades.
3. **Caída explicada por pausas** confirmadas en la plataforma o **rotación de campañas** (se apagan
   unas y arrancan otras) con el resto normal: Atención, con el desglose.
4. **Reasignación entre cuentas**: una cuenta baja, otra de la misma plataforma sube y el total va
   normal: Atención.
5. **Cambio sostenido**: si lleva 3 días en otro nivel, se mide contra ese nivel. Si el cambio es
   fuerte (la mitad o el doble), sigue en Alerta hasta que se explique en Novedades.
6. **Plataformas chicas también se vigilan**: el mínimo de volumen es relativo a su propio gasto
   (antes Bing o TikTok con 5-6 mil al día nunca alertaban).
7. **Costo por resultado es secundario** en el día: máximo Alerta en plataforma y Atención en cuenta.
8. **Sobreinversión** de una cuenta o campaña: máximo Alerta / Atención; el riesgo de pasarse se
   vigila contra presupuesto.
9. **Novedades vigentes** silencian su alcance (salvo que empeore).
10. **Incidentes**: se abren desde Alerta, o por Atención persistente solo en cuenta o plataforma y
    cuando el cambio no está explicado.

## Clasificadores de estrategia

Replican las fórmulas de la hoja: se evalúan **en orden** y gana la primera coincidencia. Igual que
`HALLAR`, no distinguen mayúsculas pero **sí acentos**. Se editan en Settings → Clasificadores y se
prueban en la Guía de la app.

### Meta (C = nombre de campaña, D = objetivo)

| # | Si contiene | Campo | Estrategia |
|---|---|---|---|
| 1 | Negocios | C | Negocios |
| 2 | CAPI WHATSAPP | C | CAPI WhatsApp |
| 3 | Sitio Web | C | Web |
| 4 | Venta | C | Venta |
| 5 | WhatsApp | C | WhatsApp o Messenger |
| 6 | SALES | C | Sales Force |
| 7 | Auronix | C | Auronix |
| 8 | Performance 2024 \| Móvil | C | Formulario móvil |
| 9 | Performance \| Móvil | C | Formulario móvil |
| 10 | LEAD | **D** | Formulario |
| 11 | Temporal | C | Branding - Temporales |
| 12 | Brand 100% l Digital | C | Branding 100% Digital |
| 13 | móvil | C | Branding móvil |
| 14 | Performance 2024 \| Nuevos Artes \| | C | WhatsApp o Messenger |
| 15 | Llamada | C | Llamadas |
| 16 | WhatsApp | C | WhatsApp o Messenger (nunca se aplica: la regla 5 ya lo cubre) |
| — | ninguna | | Branding |

### Google (D = nombre de campaña, L = tipo de campaña)

| # | Si contiene | Estrategia |
|---|---|---|
| 1 | Genéricas Maradona | SEARCH MARADONA |
| 2 | gené | SEARCH GENÉRICA |
| 3 | izzi móvil DEMAND GEN | DEMAND GEN |
| 4 | maradona | SEARCH MARADONA |
| 5 | nego | SEARCH NEGOCIOS |
| 6 | competencia | SEARCH COMPETENCIA |
| 7 | Pmax | PERFORMANCE_MAX |
| 8 | izzi móvil DEMAND GEN | DEMAND GEN (nunca se aplica: la regla 3 ya lo cubre) |
| — | ninguna | el tipo de campaña (columna L) |

Puntos a cuidar:

- En Google "gené" encuentra "Genéricas" pero no "Genericas" (sin acento): esa campaña cae en su
  tipo de campaña.
- La regla 3 asigna "DEMAND GEN" (con espacio) y el respaldo usa el tipo "DEMAND_GEN": aparecen
  como dos estrategias distintas en Compare. Conviene unificar el texto de la regla.
- TikTok, Microsoft, Spotify y X usan el objetivo reportado por la plataforma.

## Presupuesto diario por plataforma

En **Budget Control**, el panel *Presupuesto diario por plataforma* lee cada 5 minutos, desde la API
unificada, lo que Meta, Google, TikTok y Microsoft tienen configurado hoy en campañas activas. No es
gasto ni presupuesto mensual: es lo que cada plataforma tiene autorizado gastar en el día.

- **Todas:** presupuesto diario total, gastado hoy, esperado a esta hora (curva histórica de cada
  plataforma) y una barra por plataforma. La raya vertical marca lo esperado a esta hora; el color de
  la barra indica el ritmo con los umbrales de Settings.
- **Una pestaña por plataforma:** el mismo desglose por estrategia (con el clasificador de Settings),
  los presupuestos más altos y la lectura: dónde se concentra el dinero, qué estrategias van fuera de
  ritmo, campañas con presupuesto que no han gastado hoy y, en Google, campañas limitadas por
  presupuesto con la recomendación de la plataforma.
- Las cuentas en USD se convierten con la tasa del mes. Un presupuesto compartido se cuenta una vez.
  Un presupuesto total cuenta con un diario estimado; si la plataforma no informa cómo estimarlo, se
  avisa y no suma.
- **Cierre de mes:** si cada plataforma entrega su diario configurado, en cuánto cerraría el mes contra
  el presupuesto mensual, y qué diario cerraría justo en presupuesto. Es un escenario, no un pronóstico:
  las plataformas pueden entregar menos del diario.
- **Cambios de presupuesto:** cada día se guarda una foto de los presupuestos por marca. El panel
  compara hoy contra el último día guardado y lista lo que subió o bajó más que el umbral de atención
  de Settings, lo nuevo y lo que dejó de estar activo, con un acceso para registrarlo en Novedades.
- En modo demo el panel muestra datos de ejemplo rotulados como *Datos de demostración*.

## Salud de entrega

En **Overview**, el panel *Salud de entrega en las plataformas* muestra lo que Meta, Google y Microsoft
reportan hoy, ordenado por gravedad:

- **Críticas:** cuenta con problema de pago, revisión o cierre; campaña o conjunto que no entrega
  (`WITH_ISSUES`, no elegible, suspendida); anuncios rechazados; tope de gasto de Meta que no alcanza ni
  un día al diario actual.
- **Advertencias:** limitadas por presupuesto o puja, anuncios limitados o en revisión, pausadas por
  presupuesto (Microsoft), aprendizaje limitado y topes de gasto que se acaban antes de fin de mes.
- **Contexto** (plegado): elementos en aprendizaje (sus variaciones son esperadas) y campañas
  pendientes de iniciar.

## Usuarios y contraseñas

Quien administra usuarios (de inicio, el administrador) crea las cuentas del equipo en **Usuarios →
Cuentas, contraseñas y permisos**: asigna la contraseña, el rol, permisos personalizados y las
marcas que cada persona ve. Cada persona puede cambiar su contraseña desde su menú (*Cambiar mi
contraseña*). Detalle en `docs/AUTH.md`.

### Roles

| Rol | Para quién | Qué puede hacer |
| --- | --- | --- |
| Administrador | Responsable de la herramienta | Todo, incluidos usuarios, la bandeja de bugs y el dictamen de auditoría. |
| Co-administrador | Líder del equipo | Igual que el administrador, sin usuarios, sin bandeja de bugs y sin dictaminar auditorías (las ve). |
| Operativo | Equipo de Paid Media | Atiende alertas, incidentes, tickets y novedades; ejecuta evaluaciones. |
| Consulta interna | Quien solo revisa | Ve el monitoreo, acusa críticos, levanta tickets y genera el mensaje de monitoreo. |
| Auditor | Equipo de auditoría | Ve todo el monitoreo y la bitácora en modo lectura y dictamina el proceso de cada incidente. No opera ni acusa críticos. |
| Cliente | El cliente (izzi, Sky) | Solo su **Vista del cliente**: si todo está en orden, cada plataforma y lo que se atiende. Nunca ve notas, responsables, tickets ni configuración. |

El acceso del cliente se bloquea en el servidor (no solo en el menú): cualquier consulta interna le
responde "sin sesión". El equipo puede abrir **Control → Vista del cliente** para ver exactamente lo
mismo que ve el cliente.

## Auditoría de incidencias

**Control → Auditoría** (auditores y administración) revisa si el proceso se cumple en cada
incidente del periodo (7, 30 o 90 días), con lo que el equipo dejó registrado:

| Verificación | Se cumple si… |
| --- | --- |
| Atención a tiempo | Una persona actuó (estado, responsable, nota o acuse crítico) dentro de la meta: crítico 30 min, alerta 2 h, atención 8 h. |
| Responsable asignado | Desde alerta, el incidente tiene responsable. |
| Seguimiento | Mientras estuvo abierto nunca pasó más de 4 h (crítico), 12 h (alerta) o 24 h (atención) sin actualización. |
| Reportado por el equipo | Desde alerta hay un ticket, un acuse crítico con destinatario o un mensaje de monitoreo de esa plataforma. |
| Aviso automático | El sistema envió el aviso (se mide aparte de lo que hizo el equipo). |
| Cierre documentado | Se recuperó solo, se cerró por un cambio autorizado o novedad, o se cerró con nota. |
| Resuelto a tiempo | Crítico en 24 h, alerta en 72 h, atención en 168 h. |

Cada incidente muestra su porcentaje de cumplimiento, lo que hizo el equipo (quién y cuándo) y una
evaluación automática. El auditor registra su **dictamen** (Cumple, Con observación o No cumple; las
dos últimas con comentario). Cada dictamen queda en la bitácora y en el historial del incidente, y se
puede exportar todo a CSV. Desde esta versión, cada cambio de estado o responsable guarda quién y
cuándo lo hizo; los incidentes anteriores se auditan con sus notas y acuses.

## Bugs y sugerencias

¿Algo no funciona o se te ocurre una mejora? Menú de usuario → *Reportar bug o sugerencia* (o
Ayuda → Bugs y sugerencias). Escribe qué pasó o la idea, la sección y el impacto. Solo el
administrador lo recibe; tú ves el estado y su respuesta en "Mis envíos".

## Novedades y arranque de mes

**Novedades** es la bitácora de ajustes aprobados durante el mes: cambios de presupuesto, pausas o
apagados, activaciones, cambios de plataforma o de estrategia. Cada novedad guarda qué se ajustó, en
qué alcance (plataforma, cuenta o campaña), **quién lo aprobó**, **por qué medio** (WhatsApp, correo,
llamada, reunión…) y desde cuándo aplica. Nunca se borra: se cierra.

El monitoreo las toma en cuenta:

- Mientras una novedad está vigente, los cambios de gasto de su alcance **no generan alertas ni
  incidentes** (quedan en "Lo que el monitoreo está tomando en cuenta hoy").
- Si el gasto empeora más de 10 puntos por debajo del cambio esperado, o si se apaga todo el alcance
  sin que la novedad lo haya aprobado, **vuelve a alertar** y lo explica.
- Un **ajuste de presupuesto** reemplaza el presupuesto del alcance para el mes y el pacing lo usa
  desde ese día.
- Desde cualquier alerta o incidente: **Registrar novedad** llega con el alcance y el cambio ya
  llenos; el incidente se cierra con la explicación.

**Arranque de mes** (obligatorio): el día 1 un administrador o co-administrador captura los
presupuestos de cada plataforma y marca qué campañas están **activas**, **pendientes por iniciar**
(con su fecha) o **no corren** este mes. Hasta que se confirme, un aviso que no se puede cerrar se lo
pide al entrar. Lo pendiente por iniciar no se alerta como campaña sin gasto, se recuerda **una vez
al día** y se marca solo como iniciado cuando empieza a gastar (queda como novedad).

## Tickets

Registro de cada problema grave que se reporta. Estados: Abierto → Reportado → En seguimiento →
Escalado → Resuelto → Cerrado. Categorías: Delivery / gasto, Tracking / conversiones, Datos /
sincronización, Presupuesto / línea de crédito, Falla de plataforma, Otro. Canales: WhatsApp,
Correo, Soporte de la plataforma, Llamada, Reunión, Otro. Cada actualización queda en el historial
del ticket con fecha y persona; el histórico se puede filtrar y exportar.

## Optimizaciones

Recomendaciones tomadas de la documentación oficial de cada plataforma (Google Ads, Meta, TikTok,
Microsoft Advertising, Spotify, X), con enlace a la fuente, priorizadas según las anomalías de hoy.
Son guías de revisión: nada se aplica automáticamente.

## Glosario

| Término | Significado |
|---|---|
| Franja horaria | 00:00 → hora de corte; siempre contra la misma franja del mismo día de la semana |
| Esperado | Promedio (o mediana) de las semanas de referencia en la misma franja |
| Desviación | (Hoy − esperado) ÷ esperado |
| NULL | No hay dato (no se reporta, no aplica o la fuente está atrasada). Nunca es cero |
| DATA DELAYED | La fuente no ha enviado datos recientes: no se evalúa rendimiento |
| Parcial | Una o más cuentas de la plataforma están atrasadas y se excluyen |
| Alerta | Una anomalía detectada en una evaluación |
| Incidente | Anomalía grave o persistente; se actualiza en vez de duplicarse |
| Acuse | Confirmación obligatoria de que alguien revisó una alerta crítica y la reportará |
| Pacing | Gasto real vs el esperado a esa hora según la curva horaria histórica |
| Forecast | Proyección de cierre del día o del mes |
| CPA / CPL / CPR | SUMA(costo) ÷ SUMA(conversiones / leads / resultados) |
| CTR / CPC / CPM | Clics ÷ impresiones · costo ÷ clics · costo ÷ impresiones × 1,000 |

Más detalle técnico: [DATOS.md](DATOS.md) (conexión, hoja de control, monedas, presupuestos),
[AUTH.md](AUTH.md) (accesos y bitácora), [MONITORING_ENGINE.md](MONITORING_ENGINE.md) y
[ALERTS.md](ALERTS.md).

## Continuación de acceso nominal y atención

Ver [ACCESOS_NOMINALES.md](ACCESOS_NOMINALES.md): administrador principal protegido,
lista nominal de cinco responsables, delegación por ID y clientes en modo lectura.
La configuración local tiene 15 cuentas; no certifica configuración de producción.
