# Preparar las URLs y validar producción

Las URLs las asigna el proveedor de alojamiento al crear y publicar un servicio. El repositorio
GitHub y los puertos locales no son esas URLs. Esta entrega prepara artefactos y comprobaciones;
no crea servicios, contrata un plan, publica ni cambia los accesos privados existentes.

## Alojamiento compatible con el estado actual

Para la primera versión con APIs directas, la opción más cercana al código actual es **dos
servicios Node/Docker con discos persistentes**, cada uno con una única instancia escritora:

| Servicio | Directorio raíz en el repo | Puerto | Disco privado |
| --- | --- | --- | --- |
| Monitoreo Next.js | `media-monitoring-center` | `PORT`, predeterminado 3000 | `/var/data`: registros, histórico, catálogo, locks y checkpoints |
| API unificada | `unified-ads-api` | `PORT`, predeterminado 8080 | `/var/data/tokens`: tokens rotados |

Ambos directorios incluyen `Dockerfile` de Node 22, usuario sin privilegios y exclusión explícita
de secretos/datos del contexto de construcción. El monitoreo conserva las dependencias de
desarrollo necesarias para ejecutar `tsx` y los scripts operativos; no es una imagen mínima.
No monta discos, activa un worker ni configura OAuth por construirla.

Si la construcción necesita el proxy del entorno, los Dockerfiles aceptan secretos BuildKit
opcionales `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` y `npm_ca` (archivo de CA ya confiado por el
entorno). Se montan solo durante `npm ci`, sin `ARG`/`ENV` que persistan credenciales:

```bash
docker build --secret id=HTTP_PROXY,env=HTTP_PROXY \
  --secret id=HTTPS_PROXY,env=HTTPS_PROXY --secret id=NO_PROXY,env=NO_PROXY \
  --secret "id=npm_ca,src=$NODE_EXTRA_CA_CERTS" -t monitoreo-revisado .
```

Ejecutar desde el directorio del servicio y solo cuando esas variables/CA estén presentes. Sin
proxy se omiten los argumentos. No desactivar TLS, sustituir certificados por otros inventados
ni incluir valores en Dockerfiles, logs o argumentos de construcción. En la nube se debe
comprobar la confianza/red del runtime por separado: estos montajes solo cubren la instalación.

Un proveedor que documenta servicios Docker, URL `onrender.com` y discos persistentes es
[Render Web Services](https://render.com/docs/web-services) y
[Persistent Disks](https://render.com/docs/disks). El disco requiere un servicio/plan compatible:
no se presupone que un plan gratuito incluya persistencia ni se ha contratado nada. También
puede usarse otro alojamiento con las mismas garantías o un servidor administrado por el equipo.

Netlify ofrece URL `netlify.app`, pero **el histórico de APIs directas sigue usando archivos**;
`RECORDS_BACKEND=blobs` solo mueve los registros operativos. No mueve histórico ni checkpoints.
`v1:check --destino netlify` bloquea esa combinación; ver [NETLIFY.md](NETLIFY.md).
Cloud Run asigna URL `run.app`, pero su [filesystem es efímero](https://cloud.google.com/run/docs/container-contract#file_system).
Una instancia máxima no garantiza conservación del histórico/tokens tras sustituir una instancia
o revisión. Para esa ruta faltan almacenes compartidos durables y coordinación.

## Pasos para obtener las dos direcciones

Cuando el equipo autorice el alojamiento y la publicación:

1. Conectar GitHub y seleccionar la rama revisada; desactivar publicación automática mientras
   se revisa. Crear los dos servicios por separado con los directorios raíz de la tabla.
2. Elegir Docker y configurar un disco **persistente**, accesible por el usuario `node`, montado
   en `/var/data`. Una ruta o `mkdir` dentro de la imagen no sustituye ese disco. Cada servicio
   conserva su propio volumen; solo el monitoreo y su extractor comparten su histórico.
3. Cargar variables privadas solo para runtime en el proveedor. Conservar identidades, permisos y
   contraseñas actuales: no ejecutar `auth:setup` ni regenerar credenciales para desplegar.
   Nunca usar `NEXT_PUBLIC_` para llaves, OAuth o usuarios.
4. Configurar en el monitoreo la URL HTTPS asignada a la API y su llave interna. La dirección del
   monitoreo será la que abra el equipo para iniciar sesión. Las direcciones no son credenciales.
5. Antes de operar con datos reales, ejecutar la aceptación descrita abajo desde ese alojamiento.

La migración del histórico y de los registros locales es privada: hacer backup antes de copiar,
transferir por un canal cifrado al volumen de runtime y comprobar integridad/permisos sin
registrar cuerpos. No copiar `.data` a Git, Docker, artefactos públicos ni previews. Preservar
cuentas, auditoría y tasas existentes; no regenerarlas desde una plantilla al migrar. Esta entrega
no efectuó una transferencia de datos reales a ningún alojamiento ni contenedor.

Variables mínimas de runtime del monitoreo:

- `NODE_ENV=production`, `APP_TIMEZONE=America/Mexico_City`, `DATA_SOURCE=unified`.
- `RECORDS_BACKEND=file`, `RECORDS_DIR=/var/data/records`, `UNIFIED_ADS_DATA_DIR=/var/data/unified`.
- `UNIFIED_ADS_MAPPING` privado o `UNIFIED_ADS_MAPPING_FILE` montado; la imagen contiene solo el
  ejemplo público, no copia el mapeo local. Revisar IDs/marca y extraer **izzi** para esta aceptación.
- `UNIFIED_ADS_API_URL` HTTPS y `UNIFIED_ADS_API_KEY` solo en servidor.
- `AUTH_SECRET` y las 15 cuentas nominales existentes; mismas marcas, roles y cinco respondedores.
- `MONITORING_API_KEY` si un ejecutor autorizado llama al endpoint de evaluación.

En la API: conservar `API_KEYS`, las variables de proveedores autorizados y
`TOKEN_STORE_FILE=/var/data/tokens/rotated.env`. No copiar `.env` al Dockerfile ni escribir
secretos en comandos visibles/argumentos de construcción. La API no necesita CORS abierto para
consultas servidor a servidor. Inyectar secretos iniciales **no guarda automáticamente** rotaciones.

El cliente actual envía `X-API-Key`; no genera ID tokens de Google para Cloud Run IAM. No se da
por compatible una API protegida exclusivamente por IAM sin implementar ese transporte. Usar
HTTPS, controles de red del alojamiento y la autenticación implementada; validar desde el destino.

## Comprobación antes de publicar

Con configuración de runtime ya cargada, desde el monitoreo:

```bash
npm run v1:check -- --sin-red --destino contenedor --volumen /var/data --registros
```

Verifica configuración de HTTPS y rutas declaradas bajo el volumen. Rechaza `/` como raíz,
prefijos parecidos, escapes por `..`, localhost/loopback, HTTP, credenciales en URL, query y fragmento.
Solo muestra códigos; no valores privados. No resuelve DNS, detecta symlinks de directorio, prueba
TLS, montajes, varias instancias ni reinicios. `--registros` sondea escritura/lectura/eliminación
aisladas; tampoco demuestra durabilidad. `--sin-red` evita llamadas a proveedores y conserva salida
2 porque el acceso no se comprobó. Sin esa opción, consulta estados y puede renovar OAuth: debe
estar preparado el almacén privado. Salida 0 es configuración/acceso, **no aceptación**.

`--destino` predeterminado sigue siendo `local`. En un contenedor, generar conciliación con
`--output /var/data/reportes/<nombre-nuevo>.json`: `/app` pertenece a root y no es un destino
durable/escribible para reportes. No usar el directorio de la imagen como almacenamiento permanente.

## Aceptación en el alojamiento elegido

- HTTPS/DNS y health de ambos servicios; páginas privadas, API sin llave y rutas fuera del rol
  deben denegarse. Health 200 por sí solo no certifica datos, permisos ni preparación.
- Login y cookie Secure, 15 cuentas nominales, marcas y delegación de los cinco respondedores;
  Juan Pablo conserva el control máximo. Clientes sin notas/escrituras internas.
- Escribir un sondeo aislado, reiniciar **y sustituir** la instancia, leerlo y retirarlo; comprobar
  también catálogo, particiones/checkpoints y almacenamiento de tokens ficticios. Después probar
  una rotación autorizada sin registrar el token. Validar backup/restauración del volumen.
- Un único escritor/extractor sobre el volumen del monitoreo, con supervisor/scheduler explícito.
  No añadir réplicas web/worker para escalar: usuarios, contadores y listas aún requieren
  coordinación entre procesos. Los locks locales no sustituyen transacciones distribuidas.
- Para esta aceptación, el comando explícito del worker es `npm run unified:refresh -- --brand
  izzi --watch`; una ronda sin watch permite comprobar primero la configuración. `unified:sync`
  también admite `--brand izzi`. No omitir el filtro: sin él conserva todas las marcas del mapeo.
  Una selección vacía falla sin consultar otras cuentas ni ampliar el alcance.
- Extraer izzi respetando checkpoints/cuotas y comprobar frescura. `/api/monitoring/run` no extrae
  por sí sola APIs directas. Tras extracción válida, evaluar con autenticación y comprobar
  incidentes. No habilitar mensajes externos durante estas pruebas.
- Conciliar cuenta/día/reloj/moneda con exports independientes: [CONCILIACION.md](CONCILIACION.md).
  Distinguir diferencias, cobertura y desconocidos. Aceptar conversiones/atribución y tasas del
  equipo antes de CPA o consolidación MXN; no inventarlas.

Pruebas locales de imágenes, fixtures y reinicio son preparación reproducible. No certifican
el disco, permisos, red o datos de un proveedor de alojamiento todavía no creado.
