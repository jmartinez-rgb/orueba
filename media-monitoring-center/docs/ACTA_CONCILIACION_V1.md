# Acta de conciliación independiente v1 (izzi, día 2026-10-01)

Rama `claude/auditoria-final-v1`. Borrador del 7 de octubre de 2026 para firma de **Juan Pablo Martínez**.
Cierra la sección E de [CANDIDATA_V1.md](CANDIDATA_V1.md) cuando cada fila queda conciliada o con su
excepción aceptada por escrito. **No cierra la v1:** la aceptación de producción (secciones B, C, F, G y H)
sigue pendiente de la decisión de alojamiento, y no se ha desplegado nada.

## Qué se comparó

- **Fuente:** la API unificada (`DATA_SOURCE=unified`), leída por `npm run unified:sync` y guardada en el
  volumen privado. Solo cuentas izzi del mapeo; Sky conserva sus datos sin aceptarse en esta ronda.
- **Referencia:** exports de la interfaz de cada plataforma (origen `ADS_MANAGER`), convertidos con
  `npm run conciliar:referencia` y `npm run conciliar:absolute-top -- importar`. Nunca la API contra sí misma;
  Dataslayer se usó solo como contraste.
- **Política:** costo con tolerancia de 0,01 en la moneda de la cuenta; impresiones y clics exactos;
  Absolute Top con media unidad del decimal mostrado (±0,005 pp). Sin conversión de moneda ni de reloj:
  cada cuenta se compara en su moneda y en la zona en que su interfaz reporta.
- **Evidencia:** los JSON/CSV de referencia y de resultado quedan en `reportes/` del equipo que ejecutó,
  con permisos 0600 y fuera de Git (E4).

## E2. Absolute Top por campaña y grupo: conciliado

| Nivel | Resultado | Explicación de lo no comparado |
| --- | --- | --- |
| Campaña (4 cuentas) | 56 de 56 coinciden en Abs. Top y Top | 1 campaña sin métricas ese día (N/D) |
| Grupo (4 cuentas) | 516 de 516 coinciden; mayor diferencia 0,005 pp | 38 grupos de la fuente sin fila en el export: 34 N/D, 1 con 0 y 3 con 1 impresión. 2 filas del export sin pareja (ver excepción 1) |

Detalle en [CONCILIACION.md](CONCILIACION.md#conciliación-apiinterfaz-nivel-grupo-1-de-octubre-516-de-516).

## E1. Costo, impresiones y clics por cuenta y día

Estado de la segunda corrida (fuente leída el 7 de octubre; export de Google del 4 de octubre):

| Plataforma | Cuenta | Resultado | Lectura |
| --- | --- | --- | --- |
| Google | 1445650307 | Coinciden costo, impresiones y clics | Conciliada |
| Google | 3224850043 | Coinciden costo, impresiones y clics | Conciliada |
| Google | 7367928294 | Coinciden costo, impresiones y clics | Conciliada |
| Google | 6214109105 | Costo −61,07 MXN, clics −7; impresiones coinciden | La fuente, leída después, es menor que el export: patrón de ajuste por tráfico inválido de Google. Se confirma con un export nuevo del mismo día |
| Google | 8779536058 | Costo −0,33 MXN, impresiones −13, clics −3 | Mismo patrón; mismo cierre |
| Google | 7771629164 (USD) | Reloj incompatible | La cuenta reporta en otra zona; se declara con `--zona-cuenta` y se vuelve a comparar |
| Google | 8110571939, 4536282576 (USD) | Sin filas en la fuente ni en el export | Sin actividad el día |
| Meta | 11 cuentas con export | Referencia armada; fuente sin leer | La API local no tenía el token de Meta (`NOT_CONFIGURED`); se repite con el token cargado solo en memoria |
| Meta | 1396016284226084 (Paquetes izzi Telecom) | Sin export | Ver excepción 4 |
| Microsoft | 138689064 | Pendiente | El export recibido estaba en GMT-6 por hora; la API reporta Microsoft en UTC. Se requiere el mismo informe en UTC |
| TikTok y Spotify | Cuentas izzi | Sin export de la interfaz | Ver excepción 3 |
| X | Cuentas izzi | Fuera de esta ronda | Ver excepción 2 |

Esta tabla se reemplaza con el resultado de la corrida final antes de firmar.

## Excepciones que requieren aceptación por escrito

| # | Excepción | Motivo | Acepta (Sí/No) |
| --- | --- | --- | --- |
| 1 | 2 grupos de la campaña 22238774102 (6214109105) sin pareja en la fuente | La lectura de Absolute Top solo incluye grupos habilitados al extraer; con 29 y 11 impresiones quedan bajo el mínimo de 100 que evalúa el monitoreo, así que no cambian ninguna alerta. Se confirma su estado actual en Google Ads | |
| 2 | X fuera de la conciliación de v1 | Decisión del 7 de octubre de avanzar sin X; se concilia antes de usar sus cifras para decisiones | |
| 3 | TikTok y Spotify sin conciliar el 1 de octubre | Inversión de izzi inmaterial ese día (TikTok 0,27 MXN y Spotify 0, según la hoja de monitoreo); se concilian el primer día con inversión material | |
| 4 | Meta 1396016284226084 sin export | Solo si no se entrega su export antes de firmar | |
| 5 | Microsoft sin export en UTC | Solo si no se entrega antes de firmar | |
| 6 | Diferencias de Google por ajuste posterior | Solo si el export nuevo no las cierra y la diferencia sigue siendo menor (fuente leída después del export) | |

Cualquier diferencia que no tenga explicación es **no-go** (criterio de salida de CANDIDATA_V1.md).

## Lo que esta acta no cubre

- Aceptación de producción: alojamiento con disco persistente, variables en el proveedor, permisos por
  identidad en el alojamiento, respaldo y restauración, observabilidad (secciones B, C, F, G y H).
- Commit final (A1) y CI sobre ese commit (A5).
- Conversiones, valor y CPA consolidado: requieren las decisiones de negocio listadas en CANDIDATA_V1.md.

## Firma

Juan Pablo Martínez (control máximo): ______________________  Fecha: ____________

Operador que ejecutó la corrida: ______________________
