# Conciliación y preparación de producción — 2 de octubre de 2026

Base `37cb65c`; rama propia `codex/finalizacion-verificador-meta-x`. No se publicó ni desplegó.
Esta ronda se limita a izzi. No hubo nuevas lecturas de plataformas, export de Ads Manager,
cambio de credenciales/cuentas/tasas ni envío de mensajes externos.

## Cambios para revisar

- `src/lib/reconciliation/{reconcile,output}.ts`, `scripts/reconcile.ts`: comparación offline de
  costo, impresiones y clics, por cuenta/día cerrado, en moneda y reloj nativos. Referencia estricta
  agregada, no datos personales; `null` conserva desconocidos, jamás equivale a cero. El catálogo
  actual sirve como control conservador de cobertura, sin certificar que sea exhaustivo.
- La revisión independiente corrigió falsos `MATCH` por catálogos futuros y offset fijo de X que
  difiere del inicio/cierre IANA durante horario de verano. JSON/CSV/plantilla privados `0600`,
  reserva exclusiva sin sobrescribir y lectura acotada de referencia. La plantilla no copia cifras
  origen a los valores esperados ni se acepta como una referencia independiente.
- `src/lib/release/deployment.ts`, `scripts/v1-check.ts`: destino explícito, HTTPS sin credenciales
  en URL y comprobación de rutas bajo volumen declarado. La preparación global combina los
  requisitos del destino; no llama una ruta durable solo por declararla. Netlify con histórico
  directo por archivo queda bloqueado incluso si los registros operativos usan Blobs.
- `src/lib/unified/cli-options.ts`, `scripts/unified-{sync,refresh}.ts`: `--brand izzi|sky`, combinado
  con plataforma, sin ampliar alcance cuando no hay cuentas. Para esta aceptación usar izzi;
  omitir el filtro conserva el comportamiento anterior con todas las marcas del mapeo.
- API `src/app.ts`, `src/providers/token-rotation.ts`, clientes Microsoft/Spotify y registry:
  esperar persistencia antes de usar acceso, deduplicar renovación/guardado y reintentar el token
  pendiente sin otra renovación. Fallo de almacenamiento: `PROVIDER_ERROR`, código seguro, sin
  causa privada. El cierre drena escrituras registradas, incluso tras deadline de la solicitud.
- Dockerfiles y `.dockerignore`: Node 22, usuario `node`, rutas privadas `/var/data`, contexto
  explícito de archivos permitidos, secretos BuildKit opcionales para proxy/CA ya confiado.
  El monitoreo mantiene `tsx` para sus scripts operativos. No hay worker automático ni secretos
  de runtime en la imagen. Guías [PRODUCCION.md](PRODUCCION.md) y [NETLIFY.md](NETLIFY.md) actualizadas.

## Evidencia comprobada

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| Monitoreo `npm run check` | **839 pruebas/66 archivos**, tipos y lint pasan | Node 24.19.0; fixtures sin red |
| API gate completo | **678 pruebas/37 archivos**, tipos/lint/formato pasan | Node 24.19.0; fetch global bloqueado |
| Compilaciones | Next 16.3.6 y API TypeScript pasan | Arranque local con build de producción |
| Node 22.23.3 | **181 casos nuevos monitoreo + 30 API** pasan | Distribución oficial comprobada por SHA-256; dependencias host reutilizadas |
| HTTP local | **8 comprobaciones** pasan | Health de ambos, login/redirección, API/rutas privadas sin autorización |
| Conciliación histórica | **25 filas izzi; salida 2** | 30/09, sin red: 25 sin referencia, 24 sin fuente completa |
| Preflight Netlify | **Salida 2 esperada** | Configuración de destino bloqueada; sondeo aislado de registros pasó |
| Docker Node 22 | **Ambas imágenes/healthchecks pasan** | Instalación con proxy/CA existente; contextos sin extras ni canarios |
| HTTP Docker | **18 comprobaciones** pasan | Sesión ficticia, rechazos, health, PORT, reinicio y recreación |
| Volúmenes Docker | **2 reinicios y 2 sustituciones pasan** | Seis elementos ficticios; tres archivos 0600 verificados, UID 1000 |

Evidencia pública sin cifras privadas en [docs/evidence/preparacion-produccion-2026-10-02](evidence/preparacion-produccion-2026-10-02).
Los JSON/CSV con métricas permanecen privados fuera de Git. Las 24 coberturas incompletas pueden
incluir campañas omitidas sin actividad o cambios de catálogo: no prueban un error de la plataforma.
Seis particiones no contienen filas diarias; las causas se pueden superponer.

En Node 22 el primer intento del monitoreo pasó 136/140 casos de conciliación/preflight; cuatro
asserts fallaron por el aviso experimental `UNDICI-EHPA` del proxy en stderr. Pasaron 140/140 con
el filtro específico `--disable-warning=UNDICI-EHPA`, conservando proxy, TLS y barrera fetch.
Después pasaron los 41 casos del filtro de marca. No se omitieron ni desactivaron pruebas.
No confundir esa selección de 181 pruebas con toda la suite en Node 22.

Las pruebas de navegador del checkpoint anterior se conservan como históricas, no se suman a
esta ronda. No se modificó el diseño de páginas ni se afirma una nueva certificación de UX/WCAG.

La [evidencia Docker](evidence/preparacion-produccion-2026-10-02/docker.json) cubre 314 archivos
permitidos de monitor y 103 API, con 17/16 canarios excluidos y cero extras/faltantes. Ambas imágenes
arrancan con Node 22.23.3 como `node`; la API deniega proveedores sin llave y el monitoreo deniega
alertas sin sesión, redirige páginas y acepta una sesión totalmente ficticia. Configuración `PORT`
distinta del valor inicial comprobada. Los tokens/registro/histórico sobrevivieron reinicio y
recreación de contenedores propios con los mismos volúmenes, usando los stores reales de la app.
No se usaron credenciales o cifras publicitarias reales para estas pruebas.

Se corrigieron fallos de preparación del entorno: cliente Docker intentaba escribir en HOME de
solo lectura (configuración temporal en `/tmp`), y `npm ci` no tenía el proxy/CA inyectados dentro
de la construcción (secretos BuildKit opcionales). Un diagnóstico separado recibió Docker Hub
429; no se cambió de imagen ni se evadió el límite. Se conservaron TLS y origen oficial, y se
reutilizó la base descargada. No hay variables proxy/auth persistidas en las imágenes finales.
Contenedores de prueba detenidos: API salida 0; Next SIGTERM salida 143, sin fuerza ni afirmación
de drenaje de peticiones en Next. Volúmenes ficticios conservados. No se probó el almacenamiento,
backup, red o HTTPS de un alojamiento externo.

## Pendientes separados

**Datos/configuración:** exports independientes de Ads Manager, misma métrica de clic/reloj/moneda
y campañas incluidas. Ampliar cobertura diaria/horaria antes de interpretar alertas. Tasas mensuales
del equipo en Tipo de cambio, sin inventar consolidación USD→MXN. Elegir alojamiento, cargar
configuración privada y mapeo, montar volúmenes, configurar supervisor/extractor y evaluar después
de una extracción válida. No existen URLs de producción ni se contrataron recursos.

**Código/arquitectura:** backend compartido de histórico/checkpoints antes de Functions/Cloud Run
efímero; transporte ID token si se exige Cloud Run IAM; transacciones de usuarios/contadores/listas
y varios escritores. La declaración de volumen no detecta symlinks/montaje ni prueba durabilidad.
Una rotación perdida por crash antes de guardado no se recupera; callbacks que nunca resuelven
pueden demorar cierre. La conciliación futura de conversiones/atribución necesita otro contrato.

**Permisos:** revisar desde el alojamiento los accesos a las cuentas/reportes y host de descarga
Microsoft. La cuenta USD adicional de Spotify sin permiso continúa fuera del mapeo. Las aprobaciones
existentes de X/Spotify se conservan: no se pidió regenerar credenciales por errores históricos.

**Negocio:** acción principal Meta por cuenta, eventos TikTok/Spotify, mapeo offline Google y tasas
del equipo. CAPI WhatsApp y resto permanecen separados en análisis; solo se suman para venta total.
Google offline admite únicamente MCC_Offline_Lead_Contact y MCC_Offline_Purchase. CPA siempre es
suma de costo / suma de conversiones. No se eligieron otras reglas.

**Aceptación:** HTTPS/DNS/red/credenciales, backup/restauración, reinicio/reemplazo en el alojamiento,
flujos de las 15 identidades, marcas y los cinco respondedores. Juan Pablo conserva control máximo.
Controles de acceso se prueban en servidor, no solo por botones ocultos. No activar mensajes
externos en pruebas. Esta entrega no certifica producción ni declara terminada la v1.
