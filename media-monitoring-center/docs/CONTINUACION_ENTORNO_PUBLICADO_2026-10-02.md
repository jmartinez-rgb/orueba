# Continuación después de publicar el entorno — 2 de octubre de 2026 UTC

Base `a7d1650`, rama `codex/finalizacion-verificador-meta-x`. La configuración de Codex se
comprobó como publicada; el checkout conservó el commit y los servicios necesitaron arrancar
de nuevo. Esto valida la instancia reconectada, no la restauración de una tarea independiente
ni un alojamiento público. No se crearon servicios, contrataron planes o desplegaron sitios.

## Cambios y defectos reproducidos

- `src/lib/release/production-smoke.ts`, `smoke-options.ts`, `scripts/production-smoke.ts`:
  comando `npm run produccion:smoke`. Siete GET sin llaves/cookies, sin cargar `.env`, sin
  redirecciones o escrituras. Contratos estrictos, timeout de transporte/cuerpo y lectura acotada;
  reporte solo de códigos. No convierte health 200 en aceptación de datos o de la v1.
- `src/lib/records/audit.ts`: doce accesos simultáneos antes dejaban `logins=1`; una presencia
  simultánea podía dejar `logins=0` y borrar el último acceso. Ahora se actualiza por clave con
  el mecanismo `update`, conservando el throttle y timestamps monotónicos. Recibos privados
  limitados a 50 operaciones previenen el duplicado durante replay; no se exponen al directorio.
- `src/lib/records/novedades.ts`, `src/lib/services/kickoff.ts`: dos detecciones perdían un
  inicio o entregaban dos veces la misma campaña para crear novedades; una confirmación antigua
  borraba `startedAt`. Ahora se aplica el patch al documento actual. El autoenlace exige que
  nombre, plataforma, cuenta e ID no hayan cambiado desde la lectura; la detección exige además
  la campaña resuelta. La confirmación devuelve lo guardado. No se cambió la selección por nombre,
  los presupuestos ni las reglas de alertas; solo se impide aplicar el snapshot obsoleto.

## Comprobaciones de esta ronda

- Arranque de Next y API desde la configuración publicada: ocho comprobaciones HTTP correctas,
  incluidos health, login y rechazo de rutas privadas. Solo sesiones anónimas en este sondeo.
- Estados reales: Google, Meta, TikTok, Microsoft, Spotify y X respondieron `connected` el
  02/10 a las 16:44 UTC. No prueba acceso a todas las cuentas/reportes ni conciliación; una
  renovación OAuth puede escribir únicamente en el almacén privado configurado.
- Microsoft, ronda explícita `unified:refresh --brand izzi --provider microsoft`: una cuenta,
  tres días incluyendo hoy, diaria/horaria. Cuentas y campañas HTTP 200 (cuatro descubiertas,
  quince campañas de izzi); ambos reportes HTTP 502/`PROVIDER_ERROR`, cero filas nuevas.
  Se conservaron particiones previas y la espera persistida hasta 20:47 UTC. No se forzó retry.
- `npm run microsoft:red`: DNS y HEAD con TLS/proxy normales llegan al host fijo de informes;
  HTTP 400 de la raíz, salida 0. Esa respuesta acredita transporte, no una descarga firmada.
  El 502 necesita diagnóstico posterior; no se atribuye a credenciales o falta de red ni se
  afirma que el código de Microsoft fuera 2004 sin haberlo verificado.
- `produccion:smoke` sin URL: salida 2 esperada, siete `URL_MISSING`, cero solicitudes. Las URL
  públicas siguen sin estar disponibles para ejecutar el sondeo real.

Validación final en Node 24.19.0: monitoreo **1030/1030 pruebas en 71 archivos**, tipos y lint;
API **678/678 en 37 archivos**, tipos/lint/formato. Build Next 16.3.6 correcto. Hay **191 pruebas
nuevas** del monitoreo: 107 del núcleo de sondeo, 24 del CLI y 60 de concurrencia. La prueba CLI
positiva sustituye `fetch` antes del arranque y exige exactamente siete GET sin llaves: es fixture,
no HTTPS real. No hubo omisiones ni cuarentenas. Docker y recorridos UX del checkpoint anterior
son históricos, no se vuelven a certificar en esta ronda.

El primer pase del sondeo tuvo un fallo de fixture por no esperar la microtarea de cancelación;
se mantuvo la aserción y se corrigió su espera. El typecheck inicial del CLI detectó el `NODE_ENV`
obligatorio en el entorno del subproceso; se corrigió el fixture y los gates finales pasan.
Node **22.23.3 oficial**, descargado por HTTPS y verificado con SHASUMS antes de extraer:
**191/191** casos nuevos pasan en cinco archivos. Se reutilizaron dependencias; no es toda la
suite ni prueba Docker. El aviso experimental `UNDICI-EHPA` apareció sin filtrar y no falló.
El primer reinicio de Next dejó el proceso hijo escuchando al terminar el wrapper npm; se
diagnosticó `EADDRINUSE`, se detuvo únicamente ese proceso propio y se arrancó el build nuevo.
Las ocho comprobaciones HTTP pasaron otra vez a las 17:04 UTC después de ese reinicio. No se
hicieron nuevos accesos nominales ni escrituras en arranques reales durante las pruebas HTTP.
Evidencia sin cifras publicitarias privadas:
[entorno-publicado-2026-10-02](evidence/entorno-publicado-2026-10-02).

## Pendientes separados

**Código:** transacciones entre procesos para archivo/memoria; Blobs real sin validar. Los
recibos solo cubren las últimas 50 operaciones y no garantizan ejecución exactamente una vez.
Marcar inicio y crear novedad siguen siendo dos registros: un crash entre ellos puede perder
la novedad. Guardados completos del plan por administradores todavía carecen de revisión de
formulario y conservan `startedAt` por clave; no sustituyen el control de edición obsoleta.
Bitácora, contador y sesión siguen sin transacción multiclave.

**Datos/configuración:** conseguir las URL del monitoreo/API si solo se publicó Codex; montar
volúmenes, backup/restauración y activar el extractor izzi supervisado en el alojamiento elegido.
No hay un worker permanente en esta entrega. Diagnosticar el fallo actual de reportes Microsoft
tras la espera; health/conexión son distintos del resultado del reporte. Completar cobertura por
reloj/moneda y conciliar con exports independientes, sin convertir desconocidos en ceros.

**Permisos:** no se solicitaron secretos ni regeneraciones. Las aprobaciones existentes se
conservan; verificar desde el alojamiento el acceso efectivo a cada cuenta/reporte. El estado
`connected` de seis proveedores no amplía el mapeo ni incorpora cuentas Sky a esta aceptación.

**Negocio:** acciones Meta por cuenta, eventos principales TikTok/Spotify, mapeo offline Google
y tasas mensuales siguen pendientes. CAPI WhatsApp y resto permanecen separados en análisis;
solo se suman para venta total. Google offline solo MCC_Offline_Lead_Contact y
MCC_Offline_Purchase; CPA = suma de costo / suma de conversiones. No se eligió ninguna regla nueva.

**Aceptación:** sondeo público, origen TLS/DNS detrás del proxy, cookies Secure, 15 identidades,
marcas/cinco respondedores, discos/rotaciones/backup, worker y conciliación en el alojamiento.
Juan Pablo conserva el control máximo. No se declara v1 aceptada ni producción validada.
