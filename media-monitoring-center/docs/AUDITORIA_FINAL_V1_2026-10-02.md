# Auditoría final hacia la candidata v1 — 2 a 4 de octubre de 2026

Rama propia `claude/auditoria-final-v1`. HEAD recibido de `codex/dominios-absolute-top`:
**`07a6ae227bb1117ceaa87526c1909e5fe6ab135f`** (contiene la base funcional `2c8ca56` y la entrega
documental). Árbol local limpio al empezar y sin cambios ajenos. No se hizo push a ramas anteriores,
no se reescribió historial, no se desplegó, no se activó cron/n8n/WhatsApp ni se enviaron mensajes.

**Estado: candidata v1 preparada; v1 NO terminada.** Faltan dos requisitos que no dependen del código:
la **conciliación independiente** con exports de Google Ads Manager y la **aceptación del
alojamiento** autorizado. La [checklist de aceptación y reversión](CANDIDATA_V1.md) define cómo
cerrarlos. Alcance de cifras: **solo izzi**; Sky conserva sus datos, cuentas y permisos.

## Método

- Cuatro auditorías independientes con propiedad de archivos y worktrees aislados: contratos/datos,
  autorización, integridad/concurrencia y UX/diseño. Contratos y autorización terminaron sus encargos.
  Integridad y UX se interrumpieron por límites de uso de la plataforma; el coordinador integró lo que
  produjeron (lock entre procesos, pruebas multiclave, almacén ante backfills) y completó directamente
  sus prioridades restantes (capacidad, respaldo/restauración y matriz completa de navegador).
- Cada corrección tiene una regresión que falla sobre la base y pasa con el cambio. Ninguna prueba se
  omitió, desactivó ni puso en cuarentena. Las suites bloquean la red publicitaria.
- El entorno no tiene `.env`, `.env.local`, mapeo privado, auditorías guardadas ni credenciales: no hubo
  lecturas reales y no se pidieron secretos. `v1:check -- --sin-red` sale 2 (datos demo, cuentas
  nominales, registros y API sin configurar en este entorno), como corresponde.

## Resultados (Node 22.22.2, npm 10.9.7, dependencias por `npm ci`)

| Comprobación | Línea base `07a6ae2` | Rama final | Alcance |
| --- | --- | --- | --- |
| API: `typecheck`, `lint`, `format:check`, `test`, `build` | 775 / 39 archivos | **803 / 42** | Fixtures, red bloqueada |
| Monitoreo: `npm run check` | 1217 / 89 | **1377 / 106** | Fixtures, red bloqueada |
| Monitoreo: `next build --webpack` aislado (mock/Memory) | Pasa | Pasa | Sin archivos privados |
| Navegador, matriz completa `ux-regression.cjs` (5 anchos × 2 temas + flujos) | — | **344/344** (antes de corregir: 342/344) | Demo aislada en loopback |
| Navegador, modo rápido | — | 152/152 | Demo aislada |

Primera ejecución documentada de la suite completa del monitoreo en Node 22 y primera matriz completa
de navegador sobre el build final ([resumen sintético](evidence/auditoria-final-v1/ux-matriz-completa.json)).
No certifica WCAG, cookies Secure reales ni el alojamiento.

## Hallazgos por severidad

Archivo:línea referidos a la base `07a6ae2` salvo indicación. Todos corregidos salvo los listados en
«Riesgos abiertos».

### Alta

| # | Hallazgo | Archivo | Reproducción | Commit |
| --- | --- | --- | --- | --- |
| A1 | `AUTH_MODE=open` se respetaba en producción: cualquiera entraba como administrador sin contraseña y `/api/session/role` fijaba cualquier rol | `media-monitoring-center/src/lib/auth/token.ts:51` | `NODE_ENV=production AUTH_MODE=open DATA_SOURCE=unified` | `7e4eac2` (solo demo aislada mock/Memory sin credenciales) |
| A2 | Un backfill sano de una ventana anterior confirmaba recuperación, reiniciaba persistencia y cerraba la incidencia vigente | `src/lib/absolute-top/engine.ts` (`evaluateAbsoluteTop`) | Auditoría vigente al 50%, después backfill de una fecha anterior al 95% | `ae8b7c3`, `ad7a857` |
| A3 | Capacidad del historial de Absolute Top: un documento por cuenta reescrito completo en cada ingesta; la lectura horaria agota la memoria | `src/lib/absolute-top/store.ts` | Medición sintética abajo | `5132764` (tope explícito de 64 MiB) |
| A4 | Pérdida de escrituras entre procesos en el backend File (servidor y scripts) | `src/lib/records/store.ts` | 2 procesos × 300 incrementos dejaban 303 | `ac13bed` (lock por archivo con `link` atómico, verificación antes de publicar, fsync de directorio) |
| A5 | Diagnóstico: el 502 de Microsoft era indistinguible. La API asigna 502 a todo `PROVIDER_ERROR` y el monitoreo descartaba el cuerpo | `unified-ads-api/src/utils/errors.ts`, `media-monitoring-center/src/lib/unified/sync.ts` (rama `!response.ok`) | Fixtures de cada etapa del informe | `82d054e`, `8c16423` |

### Media

| # | Hallazgo | Archivo | Commit |
| --- | --- | --- | --- |
| M1 | API que mutan sin comprobación de origen (CSRF por subdominios hermanos con SameSite=Lax) | `src/proxy.ts:11-14` | `7e4eac2` |
| M2 | Una cuenta con `users:manage` limitada a una marca se ampliaba a la otra y creaba/editaba cuentas o la universal con ella | `src/lib/auth/user-admin.ts` | `fbae074` |
| M3 | El freno de fuerza bruta se vaciaba al superar 5.000 claves (inundación con usuarios inventados) | `src/lib/auth/rate-limit.ts:38` | `9c8a4d3` |
| M4 | Absolute Top: corte con la hora de recepción; una hora o día abiertos se evaluaban como cerrados | `engine.ts` | `ae8b7c3` |
| M5 | Absolute Top: entidad que salía del catálogo activo se arrastraba como N/D y dejaba el ponderado del dominio en N/D para siempre | `engine.ts` | `ae8b7c3` |
| M6 | Salud de entrega: presupuesto diario desconocido sumado como 0, ocultando el aviso de tope de gasto | `src/lib/services/delivery-health.ts:99` | `5b37ecb` |
| M7 | El almacén convertía un backfill en la lectura vigente («insuficiente») | `src/lib/absolute-top/store.ts:33` | `ad7a857` |
| M8 | Si fallaba guardar la marca de extracción fallida, se abortaban las cuentas restantes | `src/lib/absolute-top/ingest.ts:60` | `5132764` |
| M9 | 20 desplegables sin nombre accesible (fallo intermitente de la matriz en `/settings`) | Componentes de configuración, metas, comparativo, novedades, tickets y usuarios | `829a1c1` |
| M10 | `v1:check` daba la autenticación por lista sin lista nominal ni administrador principal | `src/lib/release/readiness.ts:66-70` | `4f3df64` |

### Baja

| # | Hallazgo | Archivo | Commit |
| --- | --- | --- | --- |
| B1 | Cualquier cuenta con `users:manage` podía crear el ID del administrador principal si aún no existía | `user-admin.ts:142` + `roles.ts:148` | `fbae074` |
| B2 | La contraseña universal no comprobaba que quien la activa tenga los permisos que concede | `user-admin.ts:290-298` | `fbae074` |
| B3 | Login distinguía cuentas existentes por tiempo (sin scrypt para inexistentes) | `src/app/api/auth/login/route.ts:57-68` | `9c8a4d3` |
| B4 | Estados de alerta y dictámenes aceptaban IDs de otra marca o inexistentes | `src/app/api/alerts/[id]/route.ts:20`, `audit/incidents/[id]/route.ts:25` | `c754935` |
| B5 | `MONITORING_API_KEY` revelaba su longitud por tiempo | `src/app/api/monitoring/evaluate/route.ts:12-14` | `0aa281b` |
| B6 | Absolute Top descargaba todas las métricas antes de rechazar una lectura sobre el límite | `unified-ads-api/src/providers/google/absolute-top.ts` | `4f8f081` |
| B7 | `/docs` y `/docs/json` de la API activos por omisión en producción | `unified-ads-api/src/config/env.ts:24` | `4f3df64` |

### Verificado sin defecto (con prueba)

X-API-Key protege las diez rutas privadas de la API, incluidas `/api/v1/google/absolute-top` y
`/api/v1/google-domains` (`f516667`). Matriz de autorización: 39 rutas, 13 identidades sintéticas,
598 casos (`tests/authz-matrix.test.ts`); revocación inmediata al desactivar, rotar contraseña o
cambiar rol; selector de dominio sin efecto sobre evaluación, acuses, asignación ni arranque mensual.
Contratos: maestro único, filtros antes de agregar, N/D distinto de cero, censura `<10%`/`>90%`,
capacidad del consumidor (25 MiB, filas), FX solo de la sección de tasas, CPA = suma/suma
(`contract-*.test.ts`).

## Herramientas nuevas

- `npm run conciliar:absolute-top` (`83bfa53`): importa el CSV de Google Ads y compara
  Impr. (Abs. Top) % por campaña y grupo contra las auditorías guardadas. Detalle en
  [CONCILIACION.md](CONCILIACION.md#absolute-top-comparación-específica-por-campaña-y-grupo).
- `npm run datos:respaldo` (`894e978`): respaldo con manifiesto SHA-256, verificación y restauración
  en destinos vacíos, con el servidor y el extractor detenidos.
- Diagnóstico seguro de errores de proveedor en `npm run verificar` (columna Diagnóstico) y en los
  intentos del monitoreo (`diagnostic`).

## Dominios y Absolute Top

Checklist del encargo verificado con pruebas (detalle en
[DOMINIOS_ABSOLUTE_TOP.md, sección K](DOMINIOS_ABSOLUTE_TOP.md#k-auditoría-final-hacia-v1-rama-claudeauditoria-final-v1)):
maestro único y IDs como cadena; filtros antes de agregar y cachés con alcance; campañas y grupos
independientes sin doble conteo; N/D y censura; relojes y cortes (corregido); frescura y cobertura;
episodios, recuperación y recaída (backfill corregido); cambiar de dominio o abrir páginas no escribe;
límites de capacidad (corregido).

**Capacidad medida** (filas sintéticas con el ancho real, cuenta más grande: ~240 filas diarias y
~5.700 horarias por día; retención 90 días):

| Patrón de extracción | Documento por cuenta |
| --- | --- |
| Diaria, una vez al día, un día (`--from D --to D`) | ≈ 18 MiB |
| Diaria con la ventana por omisión de tres días | ≈ 54 MiB |
| Horaria, una vez al día | ≈ 430 MiB (supera el tope) |
| Horaria cada dos horas | ≈ 5 GB (imposible) |

**Recomendación para v1:** extracción de Absolute Top **diaria, una vez al día, de un solo día cerrado
y madurado**. La lectura horaria frecuente requiere rediseñar el almacenamiento (documentos por
auditoría o retención horaria por bytes) antes de programarla; el tope de 64 MiB la rechaza
explícitamente sin dañar lo guardado.

## Conciliación independiente

Lista para ejecutarse; **pendiente por falta de datos**. No hay exports de Ads Manager en el repositorio
ni en este entorno (los CSV/Excel existentes provienen de la API y no sirven como referencia). La lectura
real de 2026-10-01 se extrajo antes de la madurez de 48 h; repetirla después del 4 de octubre a las
06:00 UTC antes de comparar. Se necesitan, por cuenta izzi (8779536058, 6214109105, 3224850043,
7367928294): dos CSV de 2026-10-01 (campañas y grupos, solo Red de Búsqueda de Google) con su hora de
exportación, más el export por cuenta y día para `npm run conciliar`.

## Proveedores

- **Microsoft:** causa del 502 **no afirmada**. Cada fallo del informe indica ahora su etapa
  (`report_submit`, `report_poll`, `report_status`, `report_download_url`, `report_download`,
  `report_parse`) y, según el caso, estado HTTP, códigos de Microsoft, código de rechazo de Azure u
  host observado (nunca la URL firmada). Siguiente paso con credenciales:
  `npm run verificar -- --proveedores microsoft --cuentas microsoft:ID --fecha 2026-10-01` y leer la
  columna Diagnóstico. El extractor ya aplica espera exponencial persistida.
- **X y Spotify:** aprobaciones ya concedidas; no se pidió aprobación ni se regeneró OAuth. Acceso
  efectivo no comprobable aquí por falta de credenciales (checklist D4).
- **Google, Meta, TikTok:** matriz de contratos revisada (moneda, reloj, faltantes, límites) sin
  defectos nuevos fuera de Absolute Top.

## Integridad y producción

| Backend | En el proceso | Entre procesos del mismo host | Entre instancias |
| --- | --- | --- | --- |
| Memory | Cola por clave | No aplica (se pierde al reiniciar) | No |
| File | Cola por clave | **Sí desde `ac13bed`**: lock por archivo, locks abandonados detectados, verificación antes de publicar, escritura temporal + rename + fsync de archivo y directorio, sin seguir symlinks | No: un volumen de red compartido sigue requiriendo un único servidor |
| Blobs | Cola por clave | Escrituras condicionales | CAS declarado; **no validado en esta ronda** contra Netlify real |

Caídas entre escrituras multiclave (`tests/integrity-multikey.test.ts`): el contador deja un hueco sin
reutilizar IDs; el arranque mensual queda guardado y el reintento registra «actualizado»; una novedad de
activación detectada se pierde y no se reintenta (riesgo abierto). Respaldo y restauración: comando
nuevo con verificación por SHA-256 (`tests/integrity-backup.test.ts`). Alojamiento: se mantiene la
propuesta de [PRODUCCION.md](PRODUCCION.md) (dos servicios Docker con disco persistente y un único
escritor); Netlify con histórico por archivo y Cloud Run efímero siguen sin ser aptos.

## Riesgos abiertos (no corregidos: decisión, datos reales o fuera de alcance)

| Severidad | Riesgo | Propuesta |
| --- | --- | --- |
| Media | La IP del freno de fuerza bruta sale de `x-real-ip`/`x-forwarded-for` fuera de Netlify y el cliente puede rotarla (`src/lib/records/audit.ts:129`) | Confiar solo en el proxy configurado del alojamiento y añadir retraso progresivo por cuenta |
| Media | Una cuenta de una sola marca con `settings:write` cambia la configuración de ambas (`src/lib/services/context.ts:40`) | Clave de settings por marca o exigir ambas marcas para ese permiso (decisión) |
| Media | Quien tiene `users:manage` (Hernán) puede asignar contraseña a un responsable y entrar como él (queda en bitácora y cierra sesiones) | Exigir alcance igual o mayor, o reservarlo al principal para respondedores (decisión) |
| Media | Releer el mismo período cerrado incrementa la persistencia de Absolute Top | Decidir con la frecuencia del extractor |
| Media | Incidencias de entidades pausadas quedan abiertas indefinidamente | Cerrarlas manualmente con nota; nunca como recuperación |
| Media | Novedad de activación perdida si el proceso cae entre marcar el inicio y registrarla | Registrar la novedad antes de marcar o reintentar al detectar inicio sin novedad |
| Media | Google omite filas con todas las métricas en cero: la evaluación horaria resulta casi siempre insuficiente | Revisar con datos reales; no convertir N/D en cero |
| Baja | Un solo checkpoint por cuenta para diario y horario | Separar por granularidad al rediseñar el almacenamiento |
| Baja | Borrar la copia en la app de una cuenta de `AUTH_USERS` revive sesiones con versión 0 | Conservar la versión al volver a la cuenta del entorno |
| Baja | Tokens sin estado: el logout no revoca en servidor; caché de usuarios de 5 s por instancia | Aceptado para v1 con una sola instancia |
| Baja | Sin `ROW_LIMIT` explícito en los consumidores (se informa como respuesta inválida) | Código dedicado |

## Pendientes separados

| Categoría | Pendiente |
| --- | --- |
| Código | Riesgos abiertos de la tabla anterior; validar Blobs real si se elige; rediseño de almacenamiento antes de Absolute Top horario |
| Datos | Exports independientes de Ads Manager (8 CSV de Absolute Top + cuenta/día) y extracción madura de 2026-10-01 |
| Permisos | Acceso efectivo de Microsoft (etapa del 502), X y Spotify desde el entorno autorizado |
| Configuración | Alojamiento con disco persistente, URLs HTTPS, secretos de runtime, `ALERT_RESPONDER_USER_IDS` y `AUTH_PRIMARY_ADMIN_ID`, `DOCS_ENABLED` vacío o `false`, supervisor de extracción diaria |
| Negocio | Acción principal/IDs Meta, eventos TikTok/Spotify, mapeo offline Google (solo `MCC_Offline_Lead_Contact` y `MCC_Offline_Purchase`), FX mensual USD→MXN y las decisiones marcadas en la tabla de riesgos |

## Siguiente paso concreto hacia v1

1. Con la configuración privada del entorno autorizado: `npm run absolute-top:sync -- --from 2026-10-01
   --to 2026-10-01 --granularity daily` (ya madurado) y exportar desde Google Ads los 8 CSV de ese día.
2. `npm run conciliar:absolute-top -- importar …` y `comparar …`; `npm run conciliar` para cuenta/día.
3. `npm run verificar -- --proveedores microsoft --cuentas microsoft:ID --fecha 2026-10-01` y decidir
   según la etapa del diagnóstico.
4. Autorizar el alojamiento y recorrer [CANDIDATA_V1.md](CANDIDATA_V1.md) con Juan Pablo.
