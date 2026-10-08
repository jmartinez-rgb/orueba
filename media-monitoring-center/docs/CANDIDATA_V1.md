# Candidata v1: checklist de aceptación y reversión

Rama `claude/auditoria-final-v1`, desde `07a6ae2` (base funcional `2c8ca56`), 2 a 4 de octubre de 2026.
Esta lista convierte la candidata en v1 aceptada. **Mientras falte una casilla obligatoria, la v1 no
está terminada.** Al 7 de octubre siguen abiertas parte de la conciliación independiente (sección E: E2
concilia por campaña y por grupo; E1 concilia 3 cuentas de Google y 9 de
Meta) y la aceptación del alojamiento (secciones B, F y H). El informe de esta ronda está en
[AUDITORIA_FINAL_V1_2026-10-02.md](AUDITORIA_FINAL_V1_2026-10-02.md) y el acta para firmar la sección E, en
[ACTA_CONCILIACION_V1.md](ACTA_CONCILIACION_V1.md).

Alcance: **solo izzi** para extracción, conciliación y aceptación. Sky conserva sus datos, cuentas y
permisos, sin aceptarse en esta ronda. No se despliega, contrata, activa cron/n8n/WhatsApp ni se
envían mensajes externos como parte de estas comprobaciones salvo autorización explícita del equipo.

Quién firma: **Juan Pablo Martínez** (control máximo) con el operador autorizado que ejecute cada paso.

## A. Código (repetible en cualquier copia, sin datos privados)

| # | Comprobación | Comando o evidencia | Estado |
| --- | --- | --- | --- |
| A1 | Commit candidato identificado y sin cambios locales | `git rev-parse HEAD`, `git status` | Pendiente de elegir commit final |
| A2 | API: tipos, lint, formato, pruebas y build | `cd unified-ads-api && npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` | Pasa en la rama al 7 de octubre: 808/808 con `TEST_DATABASE_URL` (PostgreSQL 16); sin base, 805 y 3 omitidas (Node 22.22.2). CI de GitHub en Node 22 y 24 |
| A3 | Monitoreo: tipos, lint y pruebas | `cd media-monitoring-center && npm ci && npm run check` | Pasa en la rama al 8 de octubre: 1437/1437 con `TEST_DATABASE_URL` (PostgreSQL 16); sin base, 9 omitidas (Node 22.22.2) |
| A4 | Build del monitoreo aislado (mock/Memory, sin archivos privados) | `DATA_SOURCE=mock USE_MOCK_DATA=true RECORDS_BACKEND=memory npx next build --webpack` | Pasa en la rama; matriz de navegador completa 344/344 sobre ese build |
| A5 | CI de API en Node 22 y 24 sobre el commit final | GitHub Actions | Pendiente para el commit final |
| A6 | Imágenes Docker de ambos servicios construyen como usuario `node` | [PRODUCCION.md](PRODUCCION.md) | Histórico (base anterior); repetir sobre el commit final |

## B. Alojamiento y configuración (requiere autorización del equipo)

**Alojamiento elegido el 7 de octubre: Replit (Reserved VM) en `monitoreo.abcw.global`**, con registros, histórico
y tokens rotados en su PostgreSQL. Pasos en [PUBLICACION_REPLIT.md](PUBLICACION_REPLIT.md). En Replit, B1 se
cumple con una máquina siempre encendida (monitoreo público y API solo en loopback) y PostgreSQL en lugar del
disco; B3 con `v1:check -- --destino replit --registros`; B6 con `produccion:smoke -- --monitor … --api-interna`;
F1–F3 con reinicio y nueva publicación, `pg_dump` y restauración en una base vacía. La tabla conserva la
variante de contenedor con disco.

| # | Comprobación | Condición de cierre |
| --- | --- | --- |
| B1 | Dos servicios Node/Docker con **disco persistente** montado en `/var/data`, una sola instancia escritora cada uno | URL HTTPS asignada a cada servicio; sin réplicas web/worker |
| B2 | Variables de runtime cargadas solo en el proveedor | Lista mínima de [PRODUCCION.md](PRODUCCION.md); nada con `NEXT_PUBLIC_` sensible; en la API `DOCS_ENABLED` vacío o `false` (inactivo por omisión en producción) |
| B3 | `DATA_SOURCE=unified`, `RECORDS_BACKEND=file`, rutas bajo `/var/data`; `AUTH_PRIMARY_ADMIN_ID` y `ALERT_RESPONDER_USER_IDS` definidos | `npm run v1:check -- --sin-red --destino contenedor --volumen /var/data --registros` sin códigos pendientes (incluye `PRIMARY_ADMIN_MISSING` y `ALERT_RESPONDERS_MISSING`) |
| B4 | `AUTH_MODE` no es `open`; `AUTH_SECRET` y las 15 cuentas existentes migradas sin regenerarlas | Login de cada identidad (sección C) |
| B5 | Mapeo privado revisado: IDs y marca de las cuentas izzi | Extracción con `--brand izzi` no consulta otras cuentas |
| B6 | Comprobación pública desde fuera | `npm run produccion:smoke -- --monitor https://… --api https://…` sale 0 (no certifica v1) |

## C. Acceso y permisos (servidor y UI)

| # | Identidad o rol | Debe poder | No debe poder |
| --- | --- | --- | --- |
| C1 | Juan Pablo (principal) | Todo, ambas marcas; administrar usuarios; responder alertas | Que otro administrador lo edite o elimine; eliminarse o cambiar su rol |
| C2 | Daniel Racines (coadmin) | Configurar y delegar; responder alertas | Gestionar cuentas o contraseñas |
| C3 | Sebastián Vargas, Santiago Tamayo, Victoria Cárdenas | Atender: notas, estados, acuses, cerrar con nota | Reasignar responsables (si son operativos) |
| C4 | Hernán (admin) | Administración amplia | Escribir en alertas (notas, estados, acuses, tickets, novedades, mensajes) |
| C5 | Guillermo, Operations y demás lectores | Leer alertas y su vista autorizada | Cualquier escritura de alertas |
| C6 | Cliente | Resumen de marca/dominio y alertas públicas de lectura | Notas, responsables, tickets, IDs de campaña, diagnósticos, Absolute Top técnico, Nexus interno |
| C7 | Cookies y formularios | Sesión HttpOnly, Secure y SameSite en HTTPS; mutaciones de otro origen rechazadas con 403 (comprobar que el proxy del alojamiento conserva `Host`/`X-Forwarded-Host` públicos) | Sesión válida tras desactivar usuario o cambiar contraseña/rol |

Cada fila se prueba con la identidad real en el alojamiento y, además, con una petición directa a la
API del monitoreo (ocultar un botón no basta). Resultado esperado: 403 o 401 en lo prohibido.

## D. Datos y frescura (izzi)

| # | Comprobación | Condición de cierre |
| --- | --- | --- |
| D1 | Extracción supervisada de izzi | `npm run unified:refresh -- --brand izzi` (una ronda) con checkpoints y backoff respetados |
| D2 | Seis proveedores con cobertura y frescura visibles en Salud de datos | Sin cuentas izzi esperadas sin extracción; N/D no se muestra como cero |
| D3 | Microsoft: causa del 502 identificada | `npm run verificar -- --proveedores microsoft --cuentas microsoft:ID --fecha D` muestra la etapa en la columna **Diagnóstico**; decisión documentada según la etapa |
| D4 | X y Spotify: acceso efectivo (aprobaciones ya concedidas) | Lectura acotada sin pedir aprobación nueva ni regenerar OAuth; Spotify sin REVENUE conserva ingresos N/D |
| D5 | Absolute Top: lectura diaria madura de las cuatro cuentas | `npm run absolute-top:sync -- --from D --to D --granularity daily` ejecutado ≥ 48 h después del cierre del día D. Frecuencia de v1: una vez al día y un solo día (≈ 18 MiB por cuenta a 90 días); no programar lecturas horarias (superan el tope de 64 MiB) |

## E. Conciliación independiente (obligatoria)

| # | Comprobación | Condición de cierre |
| --- | --- | --- |
| E1 | Costo, impresiones y clics por cuenta/día cerrado contra export de Ads Manager | `npm run conciliar -- --from D --to D --reference ref.json` sale 0, o cada diferencia/desconocido explicado y aceptado |
| E2 | Absolute Top por campaña y grupo de las cuatro cuentas izzi | `npm run conciliar:absolute-top -- comparar --referencia …` (8 referencias: 4 cuentas × 2 niveles) sale 0, o diferencias explicadas |
| E3 | Mismo día, reloj (`America/Mexico_City`), moneda, red (solo Búsqueda de Google) y nivel | Declarados en cada referencia; el comparador bloquea discrepancias |
| E4 | Referencias privadas conservadas fuera de Git | JSON/CSV 0600 en el volumen privado |

No se acepta comparar la API consigo misma ni una plantilla. Una salida 0 no certifica producción.

Estado de E1 al 7 de octubre (día 2026-10-01), detalle y excepciones en
[ACTA_CONCILIACION_V1.md](ACTA_CONCILIACION_V1.md):

- [x] **Google 1445650307, 3224850043 y 7367928294; Meta, 9 de 12 cuentas:** costo, impresiones y clics coinciden.
- [ ] **Google 6214109105, 8779536058 y 7771629164:** diferencias con la fuente menor que el export (clics
  inválidos descontados) o de redondeo del export por campaña; se cierran con un export nuevo por cuenta.
- [ ] **Meta izzi ABCW (Chicago), izzi - Sky Social y Paquetes izzi Telecom:** verificación por horas,
  diagnóstico de la carga rechazada y export faltante, respectivamente.
- [ ] **Microsoft:** sin credenciales en la API local ni export en UTC. **TikTok, Spotify y X:** excepciones
  propuestas en el acta.

Estado de E2 al 4 de octubre (día 2026-10-01):

- [x] **Nivel campaña contra la interfaz de Google Ads: 56 de 56** en Abs. Top y Top, sin diferencias;
  salida 2 solo por una campaña sin métricas ese día (N/D), explicada.
  [Detalle](CONCILIACION.md#conciliación-apiinterfaz-nivel-campaña-1-de-octubre-56-de-56).
- [x] **Nivel grupo: 516 de 516 coinciden**, sin diferencias; 38 grupos de la fuente sin fila en el export
  explicados por impresiones N/D, cero o una; 2 filas del export de 6214109105 sin pareja por nombre
  (campaña 22238774102; 29 y 11 impresiones, bajo el mínimo de 100 que evalúa el monitoreo). **El 7 de
  octubre se confirmó que ambos grupos están apagados**: la lectura de Absolute Top solo incluye grupos
  habilitados, así que su ausencia es la esperada.
  [Detalle](CONCILIACION.md#conciliación-apiinterfaz-nivel-grupo-1-de-octubre-516-de-516).
- Contraste adicional con Dataslayer: salida 2 por diferencias de 0,005 a 0,111 pp atribuibles a la
  extracción de Dataslayer (la interfaz coincide con la API). No afecta E2.

## F. Persistencia, respaldo y recuperación

| # | Comprobación | Condición de cierre |
| --- | --- | --- |
| F1 | Sondeo aislado sobrevive a reinicio **y sustitución** de la instancia | Escrito, leído tras sustituir, retirado |
| F2 | Respaldo del volumen del monitoreo y del almacén de tokens de la API | Con servidor y extractor detenidos: `npm run datos:respaldo -- respaldar --destino …` y `… verificar --respaldo …` (manifiesto SHA-256); el archivo `TOKEN_STORE_FILE` de la API se copia aparte con permisos 0600. Guardar cifrado y fuera de Git |
| F3 | Restauración probada en un entorno de ensayo | `npm run datos:respaldo -- restaurar --respaldo … --registros <vacío> --unified <vacío>`; datos restaurados legibles; cuentas, auditoría, tasas e histórico intactos |
| F4 | Rotación de tokens persistida | Tras una rotación autorizada, reinicio sin perder acceso; ningún token en logs |
| F5 | Un único escritor/extractor sobre el volumen | Supervisor documentado; sin réplicas |

## G. Flujos de uso (con fixtures primero, después con datos reales en el alojamiento)

- [ ] Resumen → alerta → incidente → delegar (principal/coadmin) → **Mis pendientes** → cerrar con nota.
- [ ] Conflicto de edición: dos pestañas, la segunda recibe 412/428 y no sobrescribe.
- [ ] Modal crítico y aviso mensual simultáneos: foco correcto y reanudación.
- [ ] Cambiar dominio: cambia la vista, no avanza auditorías, no reconcilia incidentes, no guarda presupuestos.
- [ ] Absolute Top: tres dominios, jerarquía, N/D y límites censurados, copia manual de un resumen.
- [ ] Presupuesto editable solo en «Todos los dominios»; tasas FX en su sección (decisión del equipo).
- [ ] Arranque mensual, informes y Nexus por marca/dominio.
- [ ] Móvil 320–1440 px, teclado, ambos temas, estados vacío/carga/error.

## H. Observabilidad

| # | Comprobación |
| --- | --- |
| H1 | Health de ambos servicios y reloj dentro de 5 minutos (`produccion:smoke`) |
| H2 | Logs sin tokens, cuerpos OAuth, cabeceras, URL firmadas ni contraseñas (revisión de una muestra tras D1) |
| H3 | Errores de proveedor con código y diagnóstico permitido (etapa, estado), no con mensajes del proveedor |

## Decisiones de negocio previas al CPA consolidado

No bloquean la operación de monitoreo de gasto, pero sí cualquier CPA consolidado o conversión a MXN:
acción principal e IDs de Meta por cuenta, eventos de TikTok y Spotify, mapeo offline de Google
(únicamente `MCC_Offline_Lead_Contact` y `MCC_Offline_Purchase`) y tasas mensuales USD→MXN.

## Criterio de salida

**Go** solo si A1–A6, B1–B6, C1–C7, D1–D5, E1–E4, F1–F5 y H1–H3 están cerrados y Juan Pablo firma la
sección G con datos reales. Cualquier fallo de C (permisos) o E (cifras) es **no-go** inmediato.

## Reversión

Disparadores: fallo de permisos, pérdida o corrupción de registros, cifras que no concilian después
del cambio, errores repetidos de extracción que antes no ocurrían, o decisión de Juan Pablo.

1. **Detener escrituras:** parar el extractor/supervisor; no ejecutar `unified:refresh` ni evaluaciones.
2. **Congelar evidencia:** copiar logs (sin secretos) y el estado del volumen antes de tocar nada.
3. **Volver al commit/imagen anterior** aprobado en el proveedor (sin force-push a ramas compartidas;
   el proveedor redepliega la imagen previa etiquetada).
4. **Restaurar datos** solo si la versión nueva los modificó: `npm run datos:respaldo -- verificar` sobre el
   respaldo F2 tomado antes del cambio y `restaurar` en directorios vacíos del volumen afectado.
5. **Tokens:** si se perdió una rotación, restaurar el almacén de tokens del respaldo; si el token ya
   fue invalidado por el proveedor, reautorizar con el procedimiento existente (no por errores históricos).
6. **Comprobar:** `produccion:smoke`, login del principal, Salud de datos y una ronda supervisada.
7. **Comunicar** al equipo con el motivo y reabrir la casilla afectada en esta lista.

No existe hoy un despliegue que revertir: la reversión aplica desde la primera publicación autorizada.
