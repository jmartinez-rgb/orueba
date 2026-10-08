# Publicar el monitoreo izzi en Replit (monitoreo.abcw.global)

**Guía para el equipo de publicación.** El equipo tiene las credenciales y los accesos a Replit y Cloudflare, y
hace todos los pasos. Juan Pablo Martínez no entrega credenciales; solo da acceso al repositorio y, al final, la
aceptación.

**Resultado:** `https://monitoreo.abcw.global` con inicio de sesión. Monitoreo y API unificada en una sola
máquina de Replit siempre encendida (Reserved VM). La API queda interna, sin acceso desde fuera. Todos los datos
van en la base PostgreSQL de Replit. No se tocan `abcw.global` ni `app.abcw.global`.

Repositorio `jmartinez-rgb/orueba`, rama **`claude/auditoria-final-v1`**.

## Cómo queda armado

| Pieza | Dónde corre | Quién la ve |
| --- | --- | --- |
| Monitoreo (lo que abre el equipo) | Puerto 3000, publicado en el 80 | Público, con inicio de sesión |
| API unificada (Google, Meta, TikTok, Microsoft, Spotify, X) | `127.0.0.1:8787` de la misma máquina | Nadie desde fuera |
| Usuarios, bitácora, tickets, tasas, presupuestos, Absolute Top, histórico | PostgreSQL de Replit | Solo la máquina |
| Tokens que Microsoft y Spotify renuevan solos | La misma base, tabla aparte | Solo la API |
| Extracción de izzi y lectura diaria de Absolute Top | La misma máquina | **Apagadas hasta el paso 9** |

El arranque y la compilación ya están configurados en el repositorio (`.replit`, `deploy/replit/start.mjs`,
`deploy/replit/build.sh`); no hay que escribir comandos de arranque.

## Reglas

- Las credenciales se capturan solo en el panel **Secrets** de Replit. Nunca en chats, correos, capturas de
  pantalla, archivos del repositorio ni en el código.
- No modificar `abcw.global` ni `app.abcw.global`.
- No activar WhatsApp ni mensajes externos (`WHATSAPP_ALERTS_ENABLED=false`).
- No desactivar la verificación de certificados (TLS) en ningún paso.
- La extracción se enciende hasta el paso 9, después de comprobar todo.

## Paso 0. Antes de empezar

- [ ] Acceso de lectura al repositorio de GitHub `jmartinez-rgb/orueba` (lo da Juan Pablo).
- [ ] Cuenta de Replit con un plan que permita publicar como **Reserved VM**.
- [ ] Acceso a la zona DNS `abcw.global` en Cloudflare.
- [ ] Las credenciales de la lista del paso 3.

## Paso 1. Crear la app en Replit

1. En Replit: **Create App** → **Import from GitHub** → `jmartinez-rgb/orueba`.
2. Cambia a la rama **`claude/auditoria-final-v1`** (pestaña **Git** de Replit si no la ofrece al importar).
3. Si Replit propone otra configuración, conserva la del archivo `.replit` del repositorio.
4. Abre la **Shell** y escribe `node -v`. Debe empezar con **v22**. Si no, en la configuración de la app elige
   Node.js 22.

## Paso 2. Base de datos

En el panel **Database**, crea la base **PostgreSQL**. Replit agrega solo el secreto `DATABASE_URL`.

Replit usa dos bases: la de **desarrollo** (la del espacio de trabajo) y la de **producción** (la del sitio
publicado, que Replit crea y conecta sola al publicar). El código crea sus tablas al arrancar; no hay que crear
nada a mano.

## Paso 3. Secretos (panel **Secrets**)

### 3.1 Configuración fija (escribir tal cual)

| Nombre | Valor |
| --- | --- |
| `DATA_SOURCE` | `unified` |
| `RECORDS_BACKEND` | `postgres` |
| `UNIFIED_ADS_STORE` | `postgres` |
| `TOKEN_STORE` | `postgres` |
| `APP_TIMEZONE` | `America/Mexico_City` |
| `UNIFIED_ADS_MAPPING_FILE` | `config/unified.mapping.example.json` |
| `WHATSAPP_ALERTS_ENABLED` | `false` |
| `UNIFIED_REFRESH_ENABLED` | `false` (se cambia en el paso 9) |
| `ABSOLUTE_TOP_SYNC_ENABLED` | `false` (se cambia en el paso 9) |

### 3.2 Llave interna entre el monitoreo y la API

`UNIFIED_ADS_API_KEY`: una cadena nueva y larga. En la Shell de Replit, `openssl rand -hex 32` genera una;
cópiala directo al secreto. No hace falta `API_KEYS`; si ya existe, el arranque le agrega esta llave.

### 3.3 Acceso al monitoreo (las cuentas actuales)

`AUTH_SECRET`, `AUTH_USERS`, `AUTH_PRIMARY_ADMIN_ID` y `ALERT_RESPONDER_USER_IDS`. Opcionales:
`AUTH_SESSION_HOURS` y `MONITORING_API_KEY`.

Deben ser **los valores que ya existen**: con ellos las 15 personas entran con sus contraseñas de siempre,
Juan Pablo conserva el control máximo y solo Juan Pablo, Daniel Racines, Sebastián Vargas, Santiago Tamayo y
Victoria Cárdenas responden alertas. Si el equipo no los tiene, detenerse y avisar: no crear cuentas nuevas ni
regenerar contraseñas.

`AUTH_USERS` es un JSON en una línea: se pega completo, sin comillas exteriores.

### 3.4 Credenciales de las plataformas

Mismos nombres y valores que ya usan. Una plataforma sin credenciales aparece como "no configurada" y no
detiene el sitio.

| Plataforma | Variables |
| --- | --- |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` y, si los usan, `GOOGLE_ADS_CUSTOMER_IDS`, `GOOGLE_ADS_CLOUD_PROJECT` |
| Meta | `META_ACCESS_TOKEN` (**token de usuario del sistema, sin vencimiento**; uno del Graph API Explorer vence en horas) y, si los usan, `META_APP_SECRET`, `META_AD_ACCOUNT_IDS`, `META_BUSINESS_IDS` |
| TikTok | `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_IDS` |
| Microsoft Advertising | `MICROSOFT_ADS_DEVELOPER_TOKEN`, `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET`, `MICROSOFT_ADS_REFRESH_TOKEN` y, si los usan, `MICROSOFT_ADS_TENANT`, `MICROSOFT_ADS_ACCOUNT_IDS` |
| Spotify | `SPOTIFY_ADS_CLIENT_ID`, `SPOTIFY_ADS_CLIENT_SECRET`, `SPOTIFY_ADS_REFRESH_TOKEN` |
| X | `X_ADS_CONSUMER_KEY`, `X_ADS_CONSUMER_SECRET`, `X_ADS_ACCESS_TOKEN`, `X_ADS_ACCESS_TOKEN_SECRET` |

Si hoy configuran mapeos o reglas de conversión (`*_MAPPING`, `*_RULES`, `*_PRIMARY_*`), cópienlos igual.

**No agregar:** `HOST`, `PORT`, `NODE_ENV`, `TOKEN_STORE_FILE`, `UNIFIED_ADS_API_URL`, `RECORDS_DIR`,
`UNIFIED_ADS_DATA_DIR`. El arranque los fija.

## Paso 4. Probar en el espacio de trabajo (antes de publicar)

1. Pulsa **Run**. La primera vez compila (varios minutos). Espera en la consola la línea
   `{"supervisor":true,"event":"started",...}`.
2. En la vista previa debe aparecer la pantalla de inicio de sesión. Entra con una cuenta real y revisa que
   cargue el resumen.
3. En la **Shell**:

```
cd media-monitoring-center
UNIFIED_ADS_API_URL=http://127.0.0.1:8787 npm run v1:check -- --destino replit --registros
```

**Resultado esperado:** `"configurationReady":true` arriba y dentro de `deployment`, `"RECORD_IO_VERIFIED"` y,
en `providerAccess`, las plataformas con credenciales como conectadas. La salida no contiene secretos: guárdala
para el paso 10.

4. Detén **Run**.

## Paso 5. Publicar

1. **Deploy** (o **Publish**) → **Reserved VM**, con al menos **2 GB de RAM**.
2. Confirma que la publicación tenga los mismos secretos del paso 3 (Replit los muestra en la configuración de
   publicación; un cambio de secreto requiere volver a publicar).
3. Publica y espera a que termine.
4. Abre `https://<la-app>.replit.app/api/health`. Debe decir `"ok":true` y `"mode":"unified"`.

## Paso 6. Datos locales de Juan Pablo (solo si se decide conservarlos)

Sin este paso el sitio arranca limpio. Las cuentas de `AUTH_USERS` entran igual y el histórico de las
plataformas lo completa la extracción del paso 9 (últimos 35 días). Empiezan vacíos: cambios hechos a usuarios
dentro de la app, bitácora, tickets, novedades, presupuestos, tasas de cambio e historial de Absolute Top.

Si se conservan, hacerlo **antes de que alguien inicie sesión en el sitio publicado**. Abrir el sitio sin
iniciar sesión no escribe nada; la importación se niega si la base ya tiene datos.

1. **Juan Pablo**, en la Terminal de su Mac (detenidos el monitoreo y la API locales):

```
cd ~/orueba/media-monitoring-center
git pull origin claude/auditoria-final-v1 && npm install
R=$(grep -E '^RECORDS_DIR=' .env.local | cut -d= -f2- | tr -d '"'); U=$(grep -E '^UNIFIED_ADS_DATA_DIR=' .env.local | cut -d= -f2- | tr -d '"')
RECORDS_DIR="${R:-.data/records}" UNIFIED_ADS_DATA_DIR="${U:-.data/unified}" npm run datos:respaldo -- respaldar --destino ~/Desktop/respaldo-monitoreo
```

   Comprime la carpeta `respaldo-monitoreo` del Escritorio y compártela por Google Drive solo con la persona del
   equipo. Contiene datos privados, así que no se envía por correo ni chat.

2. **Equipo**, en Replit: sube la carpeta descomprimida a `media-monitoring-center/.data/importacion/` (ignorada
   por Git). En la Shell:

```
cd media-monitoring-center
npm run datos:respaldo -- verificar --respaldo .data/importacion/respaldo-monitoreo
DATABASE_URL='<cadena de la base de PRODUCCIÓN>' npm run datos:migrar-postgres -- --registros .data/importacion/respaldo-monitoreo/records --unified .data/importacion/respaldo-monitoreo/unified
rm -rf .data/importacion
```

   La cadena de producción está en el panel **Database**, eligiendo la base de producción. Debe imprimir
   `"results"` con `keys` igual a `verified` en cada grupo. Si la Shell no alcanza la base de producción, detenerse
   y avisar.

## Paso 7. Dominio monitoreo.abcw.global

1. En Replit, en la publicación: **Settings** → **Link a domain** (dominio personalizado) → `monitoreo.abcw.global`.
2. Replit muestra un registro **A** y uno **TXT**. En Cloudflare, zona `abcw.global` → **DNS** → **Add record**:
   - Tipo **A**, nombre `monitoreo`, la IP que da Replit, **Proxy status: DNS only** (nube gris).
   - Tipo **TXT**, con el nombre y el valor exactos que da Replit.
3. Espera a que Replit marque el dominio como verificado y con certificado. Puede tardar de minutos a horas.
4. No modificar ningún otro registro de la zona.

## Paso 8. Comprobación pública

Desde cualquier computadora con Node.js 22 y el repositorio en la rama `claude/auditoria-final-v1`:

```
cd media-monitoring-center
npm install
npm run produccion:smoke -- --monitor https://monitoreo.abcw.global --api-interna
```

**Resultado esperado:** `"exitCode":0`; 4 comprobaciones del monitoreo en `pass` y 3 de la API en `internal`.
Además, a mano: abrir `https://monitoreo.abcw.global`, iniciar sesión con una cuenta real y abrir **Salud de
datos**.

## Paso 9. Encender la extracción

1. En los secretos de la publicación: `UNIFIED_REFRESH_ENABLED=true` y `ABSOLUTE_TOP_SYNC_ENABLED=true`.
2. Vuelve a publicar.
3. En los logs de la publicación debe aparecer `"refresh":true,"absolute_top":true`.
4. En unos minutos, **Salud de datos** muestra lecturas recientes por plataforma.

La extracción lee izzi cada dos horas respetando cuotas. Absolute Top lee una vez al día, a las 7:00 de Ciudad
de México, el día cerrado de hace tres días (más de 48 horas de maduración).

**Histórico.** Cada ronda lee hoy y los dos días anteriores. En una base nueva, la primera ronda, después de leer hoy
en todas las cuentas, completa una sola vez los 35 días anteriores que falten, del más reciente al más antiguo (la comparación usa el mismo día
de las cuatro semanas previas). Un día ya guardado no se vuelve a pedir. En los logs, cada cuenta muestra
`"history":{"rows":…,"missingDays":…}`; `missingDays` en `0` significa histórico completo. Si una plataforma
rechaza esa carga (por ejemplo, por cuota), solo esa carga espera 12 horas y la lectura de hoy sigue normal.
Hasta que termine, el monitoreo puede mostrar «Histórico incompleto» y la curva horaria lineal.

**Tipo de cambio.** Las cuentas en USD necesitan la tasa de cada mes. Un administrador la captura en
**Tipo de cambio** del monitoreo (mes en curso y mes anterior). Sin ella, el gasto en USD no se convierte y la
confianza de datos baja.

## Paso 10. Entregar a Juan Pablo

Enviar, sin ningún secreto:

- La dirección final y la confirmación de que abre con inicio de sesión.
- La salida del paso 4 (`v1:check`) y del paso 8 (`produccion:smoke`).
- Qué plataformas quedaron conectadas y cuáles no.
- Si se importaron o no los datos locales (paso 6).

Con eso Juan Pablo y los cinco respondedores hacen la aceptación (secciones C y G de
[CANDIDATA_V1.md](CANDIDATA_V1.md)) y Juan Pablo firma el [acta de conciliación](ACTA_CONCILIACION_V1.md).

## Si algo falla

- **El sitio no abre o se reinicia en ciclo:** en los logs de la publicación busca `"supervisor":true`; dice qué
  proceso se detuvo. `api_not_ready` suele ser un secreto faltante (`UNIFIED_ADS_API_KEY`) o la base sin crear.
- **Error de certificado al conectar la base** (`self-signed certificate`, `unable to verify` o
  `RECORDS_UNAVAILABLE`): la conexión verifica el certificado de la base a propósito. No desactivar la
  verificación ni cambiar `sslmode`; avisar.
- **El inicio de sesión responde 403 en `monitoreo.abcw.global`:** el proxy no está pasando el dominio público
  (`Host` o `X-Forwarded-Host`). Avisar antes de cambiar nada.
- **Plataforma con `NOT_CONFIGURED` o `AUTH_ERROR`:** falta o venció su credencial. `v1:check` lo indica por
  plataforma sin mostrar valores.
- **La importación del paso 6 dice `DESTINATION_NOT_EMPTY`:** alguien ya inició sesión en el sitio publicado.
  No borrar datos sin acuerdo; avisar.
- **«Histórico incompleto: 0 de 4 semanas» o curva horaria lineal:** la extracción todavía no completa los 35
  días (ver paso 9). Revisar en los logs que `missingDays` baje a `0`. Si una cuenta sigue con días faltantes,
  su lectura normal también está fallando: revisar esa plataforma en **Salud de datos**. Mientras una cuenta
  con gasto hoy no tenga su histórico, la plataforma muestra «Esperado —» en lugar de comparar el gasto de
  todas las cuentas contra el histórico de solo algunas (eso daba desviaciones falsas como +675 %).
- **Una plataforma sigue «Sin datos» después de cargar o corregir sus credenciales:** cada fallo duplica la
  espera de esa cuenta (4, 8, 16 y hasta 24 horas). Al **volver a publicar**, la primera ronda reintenta de
  inmediato las cuentas que fallaron (salvo por límite de cuota). Después revisar **Integraciones**: cada
  plataforma debe aparecer conectada. `MICROSOFT_ADS_REFRESH_TOKEN`, `SPOTIFY_ADS_REFRESH_TOKEN` y
  `TIKTOK_ACCESS_TOKEN` deben tener el token generado con su asistente, nunca la dirección de regreso
  (`https://…/oauth/...?code=...`).
- **Ventas, CPA de venta y conversiones en «—»:** no es un problema de tokens. Con APIs directas, la v1 importa
  gasto, impresiones y clics; las ventas todavía no se importan porque requieren el mapeo de negocio
  (Google: `MCC_Offline_Purchase`; Meta: On-Facebook Purchase para campañas «CAPI WhatsApp» y Compras Offline
  Web (Inbound) para las demás). Ver [APIS_DIRECTAS.md](APIS_DIRECTAS.md).
- **Una cuenta de Meta con `DAILY_TIMEZONE_MISMATCH`:** la cuenta está configurada en otra zona horaria
  (por ejemplo, Chicago) y sus días no coinciden con el de Ciudad de México. Es una limitación conocida: sus días
  completos no se cargan (la lectura por hora sí) y la confianza de datos baja. No se corrige desde el
  monitoreo; la zona horaria de la cuenta la decide quien administra Meta.

## Respaldo y reversión

- **Respaldo de la base:** antes de cada cambio importante, `pg_dump "<cadena de producción>" > respaldo.sql`,
  guardado cifrado y fuera de Git. Replit también permite restaurar la base a un punto anterior desde su panel.
- **Volver a la versión anterior:** desde el historial de publicaciones de Replit.
- **Detener la extracción:** `UNIFIED_REFRESH_ENABLED=false` y volver a publicar.

## Qué se probó antes de entregar

Con PostgreSQL 16 y datos ficticios, fuera de Replit:

- Arranque conjunto; la API no es alcanzable desde fuera.
- Inicio de sesión y registros guardados en la base; sesión y usuarios intactos tras reiniciar.
- Extracción encendida sin tumbar el sitio; apagado limpio; sin choque de puertos aunque la plataforma imponga
  `PORT`.
- Respaldo e importación verificados, incluso con el sitio ya publicado y sin sesiones.
- `v1:check --destino replit` listo.
- Pruebas: monitoreo 1437/1437 y API 808/808 con base de prueba; CI de GitHub en Node 22 y 24.

**No se probó dentro de una cuenta de Replit.**
