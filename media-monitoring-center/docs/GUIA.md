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
| Análisis | Budget Control | Presupuesto vs gasto, pacing y forecast; nivel de presupuesto por cuenta | Anticipar sobre o subejercicio |
| Análisis | Compare | Cualquier fecha vs semanas anteriores por plataforma, cuenta, estrategia, objetivo o campaña, con gráfica y tabla | Explicar una variación con datos |
| Análisis | Historical | Tendencia diaria, perfil por día de la semana y mapa de calor por hora | Entender patrones normales |
| Análisis | Métricas | Métrica monitoreada y métricas fijas por plataforma, objetivos fijos y definiciones | Decidir qué se vigila |
| Análisis | Optimizaciones | Recomendaciones de la documentación oficial cruzadas con las anomalías de hoy, con enlace a la fuente | Saber qué revisar en la plataforma |
| Operación | Integrations | Flujo de datos, hoja de control, monedas, BigQuery, n8n y WhatsApp | Cuando baja la confianza o falta una carga |
| Operación | Automation | Workflows de n8n | Entender qué corre solo |
| Operación | Usuarios | Personas, accesos y bitácora (solo administradores) | Saber quién entró y qué hizo |
| Operación | Settings | Umbrales, horarios, histórico, destinatarios, tipo de cambio, moneda por cuenta y clasificadores | Ajustar cómo evalúa el monitoreo |
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
  compras…): es la que decide su semáforo. Se cambia en la tarjeta del Overview o en Métricas.
- **Métricas fijas**: hasta 6 por plataforma, siempre visibles en su tarjeta.
- **Objetivos fijos** (opcionales): un valor diario de referencia por métrica. Las métricas que se
  suman (gasto, conversiones…) se comparan contra la proyección del día; las calculadas (CPA,
  CTR…) contra su valor acumulado. CPA = SUMA(costo) ÷ SUMA(conversiones), nunca un promedio.

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

## Usuarios y contraseñas

Quien administra usuarios (de inicio, el administrador) crea las cuentas del equipo en **Usuarios →
Cuentas, contraseñas y permisos**: asigna la contraseña, el rol, permisos personalizados y las
marcas que cada persona ve. Cada persona puede cambiar su contraseña desde su menú (*Cambiar mi
contraseña*). Detalle en `docs/AUTH.md`.

## Bugs y sugerencias

¿Algo no funciona o se te ocurre una mejora? Menú de usuario → *Reportar bug o sugerencia* (o
Ayuda → Bugs y sugerencias). Escribe qué pasó o la idea, la sección y el impacto. Solo el
administrador lo recibe; tú ves el estado y su respuesta en "Mis envíos".

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
