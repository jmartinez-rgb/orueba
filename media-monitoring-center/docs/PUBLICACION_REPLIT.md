# Publicar la v1 en Replit con monitoreo.abcw.global

Rama `claude/auditoria-final-v1`. Esta guía publica el monitoreo y la API unificada en **una sola máquina de
Replit siempre encendida (Reserved VM)**, con todos los datos en la **base PostgreSQL de Replit**, y lo deja en
**https://monitoreo.abcw.global**. No toca `abcw.global` ni `app.abcw.global`.

## Cómo queda armado

| Pieza | Dónde corre | Quién la ve |
| --- | --- | --- |
| Monitoreo (la página que abre el equipo) | Puerto 3000 de la máquina, publicado en el 80 | Público, con inicio de sesión |
| API unificada (habla con Google, Meta, TikTok, Microsoft, Spotify y X) | `127.0.0.1:8787` de la misma máquina | Nadie desde fuera: solo el monitoreo |
| Usuarios, bitácora, tickets, tasas, presupuestos, Absolute Top, histórico de APIs | PostgreSQL de Replit (`DATABASE_URL`) | Solo la máquina |
| Tokens que Microsoft y Spotify renuevan | La misma base (tabla aparte) | Solo la API |
| Extractor izzi y lectura diaria de Absolute Top | La misma máquina, **apagados hasta que los actives** | — |

Replit no conserva archivos al volver a publicar; por eso nada se guarda en disco. El arranque lo hace
`deploy/replit/start.mjs` y la compilación `deploy/replit/build.sh` (ambos ya configurados en `.replit`).

Probado antes de entregar, con PostgreSQL 16 y datos ficticios: arranque conjunto, API inaccesible desde fuera,
inicio de sesión, registros guardados en la base, sesión y usuarios intactos tras reiniciar, extractor activo
sin tumbar el sitio, apagado limpio, un `PORT` impuesto por la plataforma sin choque de puertos y
`v1:check --destino replit` listo. No se probó en la cuenta de Replit.

Las pruebas de PostgreSQL corren con `TEST_DATABASE_URL` apuntando a una base desechable (la vacían); sin esa
variable se reportan como omitidas, nunca como aprobadas.

## Paso 1. Importar el repositorio

1. En Replit: **Create App** → **Import from GitHub** → `jmartinez-rgb/orueba`.
2. Elige la rama **`claude/auditoria-final-v1`** (en la pestaña Git de Replit, si no la ofrece al importar).
3. Si Replit propone su propia configuración, conserva la de `.replit` del repositorio: Node.js 22 y PostgreSQL.

## Paso 2. Crear la base de datos

En el panel **Database** de Replit, crea la base **PostgreSQL**. Replit agrega solo el secreto `DATABASE_URL`.
Si Replit muestra base de desarrollo y base de producción por separado, la migración del paso 4 va a la que usa
la publicación (producción).

## Paso 3. Secretos (panel **Secrets**)

Nunca pegues estos valores en el chat ni en GitHub. Cópialos de tus archivos de la Mac
(`~/orueba/media-monitoring-center/.env.local` y `~/orueba/unified-ads-api/.env`).

**Configuración fija** (no son secretos, escríbelos tal cual):

| Nombre | Valor |
| --- | --- |
| `DATA_SOURCE` | `unified` |
| `RECORDS_BACKEND` | `postgres` |
| `UNIFIED_ADS_STORE` | `postgres` |
| `TOKEN_STORE` | `postgres` |
| `APP_TIMEZONE` | `America/Mexico_City` |
| `UNIFIED_ADS_MAPPING_FILE` | `config/unified.mapping.example.json` |
| `WHATSAPP_ALERTS_ENABLED` | `false` |
| `UNIFIED_REFRESH_ENABLED` | `false` (se activa en el paso 7) |
| `ABSOLUTE_TOP_SYNC_ENABLED` | `false` (se activa en el paso 7) |

**Llave interna** entre el monitoreo y la API: `UNIFIED_ADS_API_KEY`, una cadena nueva y larga. En la Terminal
de la Mac, `openssl rand -hex 32` genera una; cópiala directo al secreto. La API la acepta sola; no hace falta
`API_KEYS` (si ya existe, el arranque le agrega esta llave).

**Del monitoreo** (`.env.local`): `AUTH_SECRET`, `AUTH_USERS`, `AUTH_PRIMARY_ADMIN_ID`,
`ALERT_RESPONDER_USER_IDS` y, si existen, `AUTH_SESSION_HOURS` y `MONITORING_API_KEY`. Usa los mismos valores:
no regeneres contraseñas ni la firma de sesiones.

**De la API** (`.env`): todas las variables que empiezan con `GOOGLE_ADS_`, `META_`, `TIKTOK_`,
`MICROSOFT_ADS_`, `SPOTIFY_ADS_` y `X_ADS_`. Para Meta usa el **token de usuario del sistema** (no vence), no el
del Explorer. No copies `HOST`, `PORT`, `NODE_ENV`, `TOKEN_STORE_FILE` ni rutas de archivos.

Si en la Mac usabas `TOKEN_STORE_FILE`, ese archivo tiene los refresh tokens más recientes de Microsoft o
Spotify: usa esos valores para `MICROSOFT_ADS_REFRESH_TOKEN` y `SPOTIFY_ADS_REFRESH_TOKEN`.

## Paso 4. Pasar los datos de la Mac a la base de Replit

Copia usuarios creados en la app, bitácora, tickets, novedades, tasas, presupuestos, Absolute Top y el histórico
de APIs. No borra nada de la Mac, se niega si la base ya tiene datos y verifica cada registro. Hazlo **antes de
abrir el sitio publicado por primera vez** (el primer inicio de sesión ya escribe en la base) y con el monitoreo y
el extractor de la Mac detenidos, para copiar una foto quieta.

1. En Replit, abre el panel **Database** y copia la cadena de conexión (`DATABASE_URL`).
2. En la Terminal de la Mac:

```
cd ~/orueba/media-monitoring-center
git pull origin claude/auditoria-final-v1
npm install
grep -E '^(RECORDS_DIR|UNIFIED_ADS_DATA_DIR)=' .env.local
printf 'DATABASE_URL de Replit (no se verá al pegarla): '; read -rs DB; echo
DATABASE_URL="$DB" npm run datos:migrar-postgres -- --registros .data/records --unified .data/unified
unset DB
```

Si el `grep` mostró otras rutas, úsalas en `--registros` y `--unified`. Debe imprimir una línea con
`"results"` y, en cada grupo, `keys` igual a `verified`. Si la Mac no logra conectarse a la base de Replit,
avísame y lo hacemos desde la Shell de Replit subiendo un respaldo.

## Paso 5. Publicar

1. **Deploy** → **Reserved VM**. Elige una máquina con al menos **2 GB de RAM**.
2. Replit toma la compilación y el arranque de `.replit`; no cambies esos comandos.
3. Espera a que termine y abre `https://<tu-app>.replit.app/api/health`: debe decir `"mode":"unified"`.

## Paso 6. Dominio monitoreo.abcw.global

1. En la publicación: **Settings** → **Link a domain** → `monitoreo.abcw.global`.
2. Replit muestra dos registros (uno **A** y uno **TXT**). En **Cloudflare**, zona `abcw.global`, créalos con
   nombre `monitoreo`. Deja el registro A en **DNS only** (nube gris) hasta que Replit marque el dominio como
   verificado y con certificado.
3. No modifiques los registros de `abcw.global` ni de `app.abcw.global`.

## Paso 7. Comprobaciones y encendido del extractor

Desde la Terminal de la Mac (no necesita llaves):

```
cd ~/orueba/media-monitoring-center
npm run produccion:smoke -- --monitor https://monitoreo.abcw.global --api-interna
```

Debe salir `"exitCode":0`, con 4 comprobaciones del monitoreo en `pass` y 3 de la API en `internal`.

En la **Shell** de Replit (usa los mismos secretos):

```
cd media-monitoring-center
UNIFIED_ADS_API_URL=http://127.0.0.1:8787 npm run v1:check -- --destino replit --registros
```

Revisa que `deployment.configurationReady` sea `true` y que los proveedores izzi aparezcan conectados. Después
cambia `UNIFIED_REFRESH_ENABLED` y `ABSOLUTE_TOP_SYNC_ENABLED` a `true` y vuelve a publicar. El extractor lee
izzi cada dos horas respetando cuotas; Absolute Top lee una vez al día, a las 7:00 de Ciudad de México, el día
cerrado de hace tres días (más de 48 horas de maduración).

## Paso 8. Aceptación con el equipo

Con el sitio en `monitoreo.abcw.global`, sigue las secciones C y G de [CANDIDATA_V1.md](CANDIDATA_V1.md):
inicio de sesión de cada identidad, permisos de los cinco respondedores, Juan Pablo con control máximo, cliente
sin datos internos. Juan Pablo firma el [acta de conciliación](ACTA_CONCILIACION_V1.md) y la sección G.

## Si algo falla

- **El sitio no abre o reinicia en ciclo:** en **Deployments → Logs** busca la línea `"supervisor":true`; dice
  qué proceso se detuvo. `api_not_ready` suele ser un secreto faltante (`UNIFIED_ADS_API_KEY`) o la base sin
  crear.
- **`RECORDS_UNAVAILABLE` o error de certificado al conectar la base:** no desactives TLS ni cambies
  `sslmode`; revisa que `DATABASE_URL` sea la de la base de la publicación y avísame.
- **El inicio de sesión responde 403 en `monitoreo.abcw.global`:** el proxy no está pasando el dominio público
  (`Host` o `X-Forwarded-Host`); es la comprobación C7 de la candidata. Avísame antes de cambiar nada.
- **Proveedor con `NOT_CONFIGURED` o `AUTH_ERROR`:** falta o venció su secreto; `v1:check` lo indica por
  proveedor sin mostrar valores.

## Respaldo y reversión

- **Respaldo:** antes de cada cambio importante, desde la Mac con `pg_dump` (Homebrew: `brew install libpq`):
  `pg_dump "$DB" > respaldo-AAAA-MM-DD.sql`, guardado cifrado y fuera de Git. Replit también ofrece restaurar la
  base a un punto anterior desde su panel.
- **Reversión de código:** en Replit, vuelve a publicar la versión anterior desde el historial de publicaciones.
- **Reversión de datos:** restaurar el respaldo en una base vacía; nunca encima de datos vivos.
- **Detener extracción:** `UNIFIED_REFRESH_ENABLED=false` y volver a publicar.
