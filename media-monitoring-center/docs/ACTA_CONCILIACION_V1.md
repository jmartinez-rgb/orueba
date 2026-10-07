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

Corrida del 7 de octubre (fuente leída ese día a las 19:26 UTC; export de Google del 4 de octubre; exports de
Meta del 7 de octubre). Dos pasadas: la segunda declara la zona de las cuentas que reportan en otro reloj.

| Plataforma | Cuenta | Resultado | Lectura |
| --- | --- | --- | --- |
| Google | 1445650307, 3224850043, 7367928294 | Coinciden costo, impresiones y clics | Conciliadas |
| Google | 7771629164 (USD, America/Denver) | Coinciden impresiones y clics; costo −0,021 USD | El export trae 10 campañas redondeadas a centavos (error posible hasta 0,05); se cierra con el export por cuenta |
| Google | 6214109105 | Costo −61,07 MXN, clics −7; impresiones coinciden | Fuente leída después del export y menor, con impresiones idénticas: patrón de clics inválidos descontados por Google. Se confirma con un export nuevo |
| Google | 8779536058 | Costo −0,33 MXN, impresiones −13, clics −3 | Mismo patrón; mismo cierre |
| Google | 8110571939, 4536282576 (USD) | Sin filas en la fuente ni en el export | Sin actividad el día |
| Meta | 902854812517704, 801573051220234, 1002273077117011, 1092413174550532, 761656674370974, 255028689061987, 465392948082619 (USD), 400085401160967, 1742111066053708 | Coinciden costo, impresiones y clics | Conciliadas |
| Meta | 226733029954417 (izzi ABCW, America/Chicago) | Sin día en la fuente | Por diseño, el monitoreo no acepta un día de Chicago como día de México (`DAILY_TIMEZONE_MISMATCH`) y usa horas convertidas a México. Se verifica sumando sus horas del día de Chicago contra el export |
| Meta | 568474318175977 (izzi - Sky Social) | Carga rechazada (`INVALID_PERFORMANCE_SCOPE`) | En diagnóstico: la carga ahora nombra la validación que falla |
| Meta | 1396016284226084 (Paquetes izzi Telecom) | Fuente leída; sin export | Falta su export |
| Microsoft | 138689064 | Sin fuente ni export en UTC | La API local no tiene configurado Microsoft; ver excepción 5 |
| TikTok y Spotify | Cuentas izzi | Sin export de la interfaz | Ver excepción 3 |
| X | Cuentas izzi | Fuera de esta ronda | Ver excepción 2 |

Las filas en verificación se actualizan con la última corrida antes de firmar.

## Excepciones que requieren aceptación por escrito

| # | Excepción | Motivo | Acepta (Sí/No) |
| --- | --- | --- | --- |
| 1 | 2 grupos de la campaña 22238774102 (6214109105) sin pareja en la fuente | Confirmado el 7 de octubre: ambos grupos están apagados, y la lectura de Absolute Top solo incluye grupos habilitados. Con 29 y 11 impresiones quedan además bajo el mínimo de 100 que evalúa el monitoreo | |
| 2 | X fuera de la conciliación de v1 | Decisión del 7 de octubre de avanzar sin X; se concilia antes de usar sus cifras para decisiones | |
| 3 | TikTok y Spotify sin conciliar el 1 de octubre | Inversión de izzi inmaterial ese día (TikTok 0,27 MXN y Spotify 0, según la hoja de monitoreo); se concilian el primer día con inversión material | |
| 4 | Meta 1396016284226084 sin export | Solo si no se entrega su export antes de firmar | |
| 5 | Microsoft sin conciliar en v1 local | La API local no tiene sus credenciales y falta el export en UTC; se concilia al configurarlo en el alojamiento (D2 exige los seis proveedores), antes del go | |
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
