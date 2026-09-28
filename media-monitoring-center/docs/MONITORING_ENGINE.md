# Monitoring Engine

Código: `src/lib/monitoring/*`, `src/lib/anomaly-engine/*`. Pruebas: `tests/comparator.test.ts`,
`tests/anomaly-engine.test.ts`, `tests/data-health-pacing.test.ts`, `tests/mock-scenarios.test.ts`.

## 1. Regla principal de comparación

**Mismo día de la semana + misma franja horaria.** Si son las 12:20 del lunes 28 de septiembre:

- Ventana actual: lunes 28, 00:00–12:00 (horas completas; la hora en curso no entra).
- Referencias: lunes 21, 14, 7 de septiembre y 31 de agosto, 00:00–12:00.
- Se calculan: actual, semana anterior, promedio, mediana, valor esperado (promedio o mediana,
  configurable), desviación vs cada uno, desviación estándar y z-score.

El número de semanas es configurable (4 por defecto; 8, 12 o personalizado). Con menos de
`minSamples` semanas con dato no hay valor esperado: la entidad no se evalúa (no se inventa).

Todas las fechas y horas son **de negocio** (`APP_TIMEZONE`, por defecto
`America/Mexico_City`). `lib/time/tz.ts` convierte explícitamente; nunca se usa la zona del
servidor ni se mezcla UTC con hora local.

### Hora de corte efectiva

Un dato recibido hasta `cutoffToleranceMinutes` (20) antes del cierre de la hora cuenta como hora
completa (11:44–11:59 → corte 12:00). Si una plataforma llegó hasta las 11:00, se compara
00:00–11:00 contra 00:00–11:00: la ventana siempre es la misma en ambos lados.

### Ventana reciente

Además del acumulado se evalúan las últimas `intervalHours` (2 h) contra el mismo horario de
semanas anteriores. Detecta **plataformas o campañas que dejaron de gastar** aunque el acumulado
todavía no lo refleje.

### Métricas derivadas

CPA, CPL, CPC, CPM, CTR, ROAS y costo por resultado se calculan **desde totales**:
`SUMA(costo) ÷ SUMA(resultado)`. El esperado de un CPA es `gasto esperado ÷ resultados
esperados`, nunca el promedio de CPAs semanales.

## 2. Data Health (antes de cualquier análisis)

`lib/monitoring/data-health.ts`:

| Estado | Cuándo | Qué hace la app |
|---|---|---|
| `OK` | Último dato ≤ 120 min | Evalúa rendimiento |
| `PARTIAL` | La plataforma está al día pero alguna cuenta no | Excluye esas cuentas de la comparación (actual y referencia) y lo avisa |
| `DELAYED` | Último dato > `delayedAfterMinutes` (120) | Muestra **DATA DELAYED**, nunca $0; no evalúa rendimiento |
| `ERROR` | Última sincronización fallida y sin datos nuevos ≥ 60 min | Muestra ERROR con el motivo |
| `NO_DATA` | Nunca llegó un dato | Muestra SIN DATOS |

Chequeos adicionales por plataforma: última sincronización, horas faltantes en la ventana,
duplicados (si hay llave única configurada), gasto NULL, carga incompleta de la última hora y
retraso por cuenta. Cada plataforma tiene un puntaje 0–100.

`0` es un valor real (p. ej. conversiones = 0 dispara TRACKING_ISSUE); `NULL` significa "no se
reporta" y se muestra como "—" o "NULL (no se reporta)".

## 3. MonitoringEngine

`runMonitoring(source, { settings, asOf })`:

1. Frescura por plataforma y cuenta → cuentas excluidas → corte efectivo por plataforma.
2. Filas horarias por campaña del día y de las fechas de referencia (una consulta).
3. Series por campaña, cuenta, plataforma y total (el total solo incluye plataformas al día).
4. Evaluación de cada entidad: comparaciones acumuladas y recientes, KPI según objetivo,
   participación en el gasto esperado de su plataforma.
5. AnomalyEngine → estado por plataforma → estado general.
6. PacingEngine por plataforma y total, curvas para las gráficas y Data Health.

### KPI por objetivo de campaña

| Objetivo | Resultado | Costo |
|---|---|---|
| Sales | Ventas | CPA venta |
| Leads | Leads | CPL |
| WhatsApp | Conversaciones | Costo por conversación |
| Calls | Llamadas | Costo por llamada |
| Traffic / Engagement | Clics | CPC |
| Video / Awareness | Impresiones | CPM |
| Purchases | Compras | CPA compra |
| Conversions | Conversiones | CPA |

El objetivo se toma del catálogo, se infiere del nombre en BigQuery (`inferObjective`) o se
asigna en **Settings → Objetivos de campaña**.

### Métrica monitoreada por plataforma

Cada plataforma se evalúa con **una métrica elegida** (`settings.platformMetrics[p].primary`:
conversiones, leads, ventas, WhatsApp, llamadas, compras, clics o impresiones). Esa métrica y su
costo (CPA, CPL…) deciden el semáforo de la plataforma y aparecen en su tarjeta del Overview, donde
se cambia (o en **Métricas**). Además se pueden fijar hasta 6 métricas visibles por plataforma
(`pinned`). Las campañas siguen evaluándose con el KPI de su propio objetivo.

### Moneda

El motor recibe todo en **MXN**: `CurrencyConvertedSource` envuelve la fuente (mock o BigQuery) y
convierte gasto e ingresos de las cuentas en USD con la tasa del mes de cada fecha antes de
agregar a plataforma. Sin tasa, el gasto en USD queda NULL (nunca 0). Ver `docs/DATOS.md`.

Medición izzi (contexto de la cuenta): en Meta, las campañas *CAPI WhatsApp* se miden con
On-Facebook Purchase y el resto con Compras Offline Web (Inbound) — por eso son objetivos
distintos y no se mezclan; en Google, ventas con `MCC_Offline_Purchase` y leads con
`MCC_Offline_Lead_Contact`.

## 4. AnomalyEngine

### Semáforos (configurables)

| Estado | Desviación |
|---|---|
| 🟢 NORMAL | < 15% |
| 🟡 ATENCIÓN | 15%–25% |
| 🟠 ALERTA | 25%–40% |
| 🔴 CRÍTICO | > 40% |

### Reglas de patrón (en orden)

| Caso | Señal | Diagnóstico |
|---|---|---|
| — | Ventana reciente con gasto 0 o caída ≥ 90% (datos al día) | DELIVERY_CRITICAL · "dejó de gastar" |
| 4 | Campaña activa, gasto = 0, gasto esperado relevante | DELIVERY_CRITICAL |
| 6 | Gasto normal y resultados = 0 (o NULL cuando antes había dato) | TRACKING_ISSUE |
| 1 | Gasto ↓ y resultados ↓ | DELIVERY_ISSUE |
| — | Gasto ↓ con resultados estables | UNDERSPEND (baja un nivel) |
| 2 | Gasto normal, resultados ↓ | PERFORMANCE_ISSUE; TRACKING_ISSUE si los clics siguen normales y la caída es > 40% |
| 3 | Gasto ↑ y costo por resultado ↑ | EFFICIENCY_ISSUE |
| — | Gasto ↑ con resultados que acompañan | OVERSPEND |
| — | Costo por resultado ↑ con gasto y resultados en banda | COST_INCREASE |
| 5 | ≥ 3 campañas con caída de delivery que suman ≥ 40% del gasto esperado | PLATFORM_INCIDENT (sube un nivel, mínimo ALERTA) |
| 7 | Fuente atrasada o con error | DATA_ISSUE (nunca performance) |

### No solo porcentajes

- **Volumen**: entidades con gasto esperado bajo (`minCampaignSpend`, `minPlatformSpend`) no se
  evalúan; resultados esperados bajos limitan la severidad a ATENCIÓN.
- **Significancia**: una caída de conteos dentro de ±2·√esperado (aprox. Poisson) es ruido.
- **Variabilidad**: si |z| < 1.5 frente al propio histórico, baja un nivel.
- **Hora**: antes de las 08:00 (`earlyHour`), o mientras no ha ocurrido el 20% del volumen típico
  del día según la curva horaria (`earlyDayShare`), baja un nivel. No aplica a "dejó de gastar"
  (DELIVERY_CRITICAL).
- **Materialidad**: una campaña afecta el color de su plataforma solo hasta ATENCIÓN, o hasta
  ALERTA si pesa ≥ 15% del gasto esperado.
- **Agrupación jerárquica (anti-spam)**: si la plataforma o la cuenta tienen la misma anomalía,
  las campañas quedan agrupadas bajo ella (visibles, sin incidente ni notificación propia).

## 5. PacingEngine

- Curva horaria histórica: fracción acumulada del gasto diario al cierre de cada hora, promedio
  de los mismos días de la semana (solo días completos). Sin histórico suficiente usa curva
  lineal (y lo indica).
- Gasto esperado ahora = presupuesto diario × participación de la curva a la hora de corte.
- Forecast del día = gasto actual ÷ participación de la curva.
- Mensual (Budget Control): gasto del mes, % usado vs % esperado por días transcurridos,
  varianza en puntos, forecast = gasto del mes + resto de hoy + días restantes al promedio
  reciente de cada día de la semana. Estado por umbrales de sobre/subejercicio configurables.

## 6. Confianza de datos

`lib/monitoring/confidence.ts`. Por plataforma, de 0 a 100 (alta ≥ 85, media ≥ 60, baja < 60). Un
problema grave pone un techo y el resto descuenta debajo de él:

| Señal | Efecto |
|---|---|
| Sin datos del día / sincronización con error / datos atrasados | Techo 0 / 20 / 40 |
| Cuentas atrasadas excluidas | −máx(10, 40 × participación en el gasto esperado) |
| Último dato con más de la mitad del umbral de atraso | −10 |
| Horas faltantes · duplicados · gasto NULL · última hora incompleta | −4 por hora (máx. 20) · −3 por fila (máx. 15) · −3 por fila (máx. 15) · −8 |
| Hoja de control: error · pendiente · vencido · parcial · en ejecución | −30 · −20 · −15 · −10 · −5 por paso |
| Tipo de cambio: mes sin tasa · mes con la tasa anterior | −25 · −5 por mes (máx. 10) |
| Histórico incompleto | −5 por semana sin dato (máx. 15) |

La confianza general es el promedio ponderado por el gasto esperado de cada plataforma. Cada punto
descontado lleva su motivo (se ve al pasar el cursor sobre el indicador). La confianza informa; no
cambia la severidad de las anomalías.

## 7. Objetivos fijos

Opcionales (`settings.fixedTargets`, sección **Métricas**): un valor diario de referencia por
plataforma y métrica. Las métricas que se suman (gasto, conversiones…) se comparan contra la
proyección del día (`actual ÷ participación de la curva`); las calculadas (CPA, CTR…) contra su
valor acumulado. Se muestran en la tarjeta de la plataforma; no generan alertas por sí solos.

## 8. Configuración

Todo lo anterior se ajusta en **Settings** (y se valida con zod): umbrales, frecuencia y horario,
semanas y método del esperado, zona horaria, frescura, volúmenes, reglas de detección, política
de alertas, presupuestos, destinatarios, objetivos de campaña, tipo de cambio, moneda por cuenta y
clasificadores. La métrica monitoreada y los objetivos fijos, en **Métricas**. Los cambios solo
afectan cómo evalúa el monitoreo: nunca se aplica nada en las plataformas.
