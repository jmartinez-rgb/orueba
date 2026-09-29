# Instalación paso a paso

Guía completa para dejar funcionando el Media Monitoring Center (izzi y Sky) leyendo la hoja de
Google Sheets que actualiza Dataslayer. Síguela en orden; cada parte termina con una comprobación.

| Parte | Qué haces | Tiempo aprox. |
|---|---|---|
| A | Revisar la hoja de Dataslayer (y, recomendado, agregar las consultas por hora) | 15–30 min |
| B | Tener a la mano los accesos de Google (los entrega el administrador) | — |
| C | Probar todo en tu computadora | 15 min |
| D | Publicar en Netlify | 15 min |
| E | Ajustes finales dentro de la app | 10 min |
| F | Opcional: alertas automáticas por WhatsApp con n8n | — |

**Antes de empezar necesitas:**

- Permiso de edición en la hoja **"MONITOREO"** que llena Dataslayer (ID
  `1WjLM2CSsIiuNuJrGSRFe-5SMkvhI59cKp5cZpq7fxCc`).
- El **archivo JSON de la cuenta de servicio** y la hoja ya compartida con ella (los entrega el
  administrador; ver Parte B).
- Tu Mac con Node.js (ya instalado) y el proyecto clonado en `~/orueba`.
- Acceso al sitio en **Netlify**.
- Las contraseñas de acceso (`jmartinez`, `operaciones` y la universal) y el bloque `AUTH_*`
  que te pasé por chat. Nunca van en el repositorio.

> **Solo lectura.** La app nunca escribe en la hoja, ni en Dataslayer, ni en las plataformas.
> La cuenta de servicio tiene permiso de **Lector** y nada más.

---

## Parte A. La hoja de Dataslayer

### A1. Qué pestañas lee la app

La app lee estas pestañas de "MONITOREO" tal como las deja Dataslayer:

| Pestaña | Plataforma | Para qué |
|---|---|---|
| `Google` | Google Ads | Gasto, impresiones, clics, conversiones y moneda por campaña y día |
| `Google Conversiones` | Google Ads | Ventas (`MCC_Offline_Purchase`), leads (`MCC_Offline_Lead_Contact`), llamadas (`Calls from ads`) y tipo de campaña |
| `Meta` | Meta | Gasto, leads, conversaciones, llamadas de 20 s, Compras Offline Web (Inbound), On-Facebook Purchase y moneda |
| `TikTok` | TikTok | Gasto, impresiones, clics, conversiones y moneda |
| `Bing` | Microsoft Advertising | Gasto, impresiones, clics y conversiones |
| `Spotify` | Spotify | Gasto, impresiones y clics (llega con un día de atraso: ver A2) |
| `DataslayerQueries` | — | Hora y estado de la última actualización de cada consulta (Dataslayer la crea sola) |

- **`Ventas Detalle` no se lee nunca** (trae teléfonos de clientes).
- La hoja no trae IDs de cuenta ni de campaña: la app identifica cada cuenta y campaña por su
  **nombre**. Si se renombra una campaña, la app la ve como campaña nueva desde ese día.
- La pestaña de Google se llama `Google ` (con un espacio al final): la app la encuentra igual.

- **No cambies los nombres de las pestañas ni de las columnas.** Si algún día cambian, Integrations
  lo avisa ("No existe la pestaña…" o "faltan columnas…") y se ajusta en `config/sheets.mapping.json`.
- **No borres `DataslayerQueries`**: de ahí sale la hora de actualización con la que la app sabe si
  los datos están al día.
- Plataformas que no están en la hoja (por ejemplo X) no se monitorean ni aparecen.

### A2. Frecuencia de actualización

Dataslayer actualiza la hoja **cada 2 horas** y tarda **5 a 10 minutos**. La app ya lo toma en
cuenta:

- Un dato se considera **atrasado** si pasan más de 2 h 35 min sin actualización.
- Si la app lee la hoja justo mientras Dataslayer la reescribe, conserva la última lectura completa
  y lo indica ("Dataslayer está actualizando la pestaña"). Así una actualización a medias no se ve
  como una caída.

Comprobación: en Dataslayer, cada consulta debe tener su programación cada 2 horas activa.

**Spotify** entrega sus datos con un día de atraso (su última fila siempre es de ayer), así que no
se puede vigilar dentro del día: queda fuera del monitoreo en vivo y del mensaje de Monitoreos. Si
algún día llega al día, quita `"intraday": false` de Spotify en `config/sheets.mapping.json`.

La consulta `Google` recién creada aparece en `DataslayerQueries` como *Created successfully* y
sin hora en *Updated*: mientras no tenga una actualización programada, la app usa su hora de
creación y, cuando se actualice, la de *Updated*.

### A3. Tamaño de la hoja

La hoja ya es grande (Google Conversiones pasa de 96 mil filas y Meta de 51 mil) y crece todos los
días. La app **no la lee completa**: primero lee solo la columna de fecha y después únicamente las
filas de los últimos 45 días (o más si en Settings eliges más semanas de comparación). No hace
falta recortar las consultas; si algún día Dataslayer tarda demasiado en escribirlas, puedes
mover su **fecha de inicio** para conservar los últimos 3 a 6 meses.

### A4. Consultas por hora (recomendado, para comparar la misma franja con precisión)

La app compara **hoy hasta la hora de corte contra el mismo día de semanas anteriores hasta la
misma hora**. Las pestañas actuales son **diarias**. Sin datos por hora, la app estima la curva
horaria con una curva típica y lo marca como aviso ("Curva por hora · Parcial"), con −10 puntos de
confianza. Para que la comparación sea exacta, agrega **una consulta por hora a nivel cuenta**
para cada plataforma (son ligeras: una fila por cuenta y hora).

Para cada plataforma (Google Ads, Meta, TikTok y Microsoft/Bing):

1. En Dataslayer, **duplica** la consulta de esa plataforma (la de `Google`, `Meta`, `TikTok` o
   `Bing`).
2. En la copia:
   - **Quita** las dimensiones de campaña (Campaign, Campaign ID, Advertising channel type,
     Objective…). Deja **Date** y la cuenta (Account / Account ID, o Advertiser en TikTok).
   - **Agrega la dimensión de hora**: en Google Ads y Microsoft se llama *Hour of day*; en Meta es la
     desagregación por hora del anunciante (*Hourly stats aggregated by advertiser time zone*); en
     TikTok, *Stat time hour*.
   - Deja las mismas métricas (costo, impresiones, clics, conversiones).
   - **Rango de fechas**: los últimos 35 días, incluyendo hoy.
3. Que escriba en una **pestaña nueva** con este nombre exacto:

   | Plataforma | Nombre de la pestaña |
   |---|---|
   | Google Ads | `Google \| Hora` |
   | Meta | `Meta \| Hora` |
   | TikTok | `TikTok \| Hora` |
   | Microsoft (Bing) | `Bing \| Hora` |

4. Programa la consulta **cada 2 horas**, como las demás.

Comprobación: en la app, Integrations deja de mostrar "Curva por hora · Parcial" para esa
plataforma. Si Dataslayer nombra la columna de hora de otra forma, Integrations mostrará "faltan
columnas" con el nombre esperado; ese nombre se agrega en `config/sheets.mapping.json`.


### A5. Zona horaria de la hoja

La app interpreta las horas de `DataslayerQueries` con la zona horaria de la hoja (*Archivo →
Configuración → Zona horaria*). No hace falta cambiarla. Si la "Última actualización" que muestra
la app no coincide con la de `DataslayerQueries`, se fija la zona en `config/sheets.mapping.json`
(`control.timeZone`, por ejemplo `America/Bogota`).

### A6. Pestañas opcionales: presupuestos y tipo de cambio

Si quieres que Budget Control lea los presupuestos de la hoja, crea una pestaña **`Presupuestos`**
con las columnas de la plantilla `config/presupuestos.template.csv`:

| Mes | Plataforma | Cuenta | Campaña | Monto | Moneda | Nivel | Marca |
|---|---|---|---|---|---|---|---|
| 2026-10 | Google | izzi - Ofertas | | 510000 | MXN | Cuenta | izzi |
| 2026-10 | Meta | Sky Performance - MXN | | 400000 | MXN | Cuenta | Sky |

La columna `Marca` es opcional: sin ella, la marca sale del nombre de la cuenta o campaña, y los
presupuestos por plataforma o totales se asignan a izzi.

Y, si prefieres capturar el tipo de cambio en la hoja en lugar de en la app, una pestaña **`Tipo de
cambio`** (`config/tipo-de-cambio.template.csv`: `Mes`, `USD a MXN`). Ambas son opcionales: también
se capturan dentro de la app (Parte E).

---

## Parte B. Accesos de Google (los da el administrador)

Los accesos de Google los gestiona el administrador. Para instalar solo necesitas que te entregue:

- El **archivo JSON de la cuenta de servicio** (guárdalo en Descargas; no lo subas a GitHub ni lo
  compartas por chat).
- La confirmación de que la hoja **MONITOREO** ya está compartida con esa cuenta como **Lector**.

---

## Parte C. En tu computadora

### C1. Actualiza el código

```
cd ~/orueba
git pull
```

Si responde que tus cambios en `package-lock.json` se sobrescribirían (npm lo modificó al
instalar; no pierdes nada):

```
git checkout -- media-monitoring-center/package-lock.json
git pull
```

### C2. Instala lo nuevo

```
cd ~/orueba/media-monitoring-center
npm install
```

### C3. Conecta la hoja

Con el archivo JSON que te dio el administrador y el ID de la hoja "MONITOREO":

```
npm run sheets:setup -- ~/Downloads/NOMBRE-DEL-ARCHIVO.json "1WjLM2CSsIiuNuJrGSRFe-5SMkvhI59cKp5cZpq7fxCc"
```

Si ya lo habías corrido con la hoja anterior, vuelve a correrlo con el ID nuevo: reemplaza
`SHEETS_SPREADSHEET_ID` en `.env.local`.

(Arrastra el archivo JSON a la Terminal para pegar su ruta.) El comando guarda en `.env.local`:
`DATA_SOURCE=sheets`, `SHEETS_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY`, y te
recuerda compartir la hoja. No muestra la llave en pantalla.

Si aún no agregaste las contraseñas de acceso, pega también el bloque `AUTH_*` que te pasé por
chat al final de `.env.local` (ver `docs/AUTH.md`).

### C4. Arranca y comprueba

```
rm -rf .next
npm run dev
```

1. Abre **http://localhost:3000** e inicia sesión con `jmartinez`.
2. Ve a **Integrations → Google Sheets (Dataslayer) → Probar conexión**. Debe decir *Conexión
   correcta con "MONITOREO"* y la zona horaria de la hoja.
3. En la misma tarjeta aparecen las pestañas con sus filas y la hora de la última actualización.
4. Abajo a la izquierda debe decir **Google Sheets (Dataslayer)** (no "Datos simulados").
5. En el **Overview** verás izzi con Google, Meta, TikTok y Microsoft. Arriba, junto al logo,
   el botón **izzi | Sky** cambia de monitoreo en un clic (Sky: Google, Meta y TikTok).

Si algo falla, Integrations explica qué falta (ver *Problemas frecuentes* al final).

---

## Parte D. Publicar en Netlify

### D1. Variables de entorno

Netlify → tu sitio → **Site configuration → Environment variables → Add a variable**. Agrega:

| Variable | Valor |
|---|---|
| `DATA_SOURCE` | `sheets` |
| `SHEETS_SPREADSHEET_ID` | `1WjLM2CSsIiuNuJrGSRFe-5SMkvhI59cKp5cZpq7fxCc` (si ya existía con la hoja anterior, **edítala** y pon este valor) |
| `GOOGLE_CLIENT_EMAIL` | El `client_email` del JSON |
| `GOOGLE_PRIVATE_KEY` | El `private_key` del JSON, completo (desde `-----BEGIN PRIVATE KEY-----` hasta `-----END PRIVATE KEY-----`). Márcala como secreta |
| `APP_TIMEZONE` | `America/Mexico_City` |
| `AUTH_SECRET`, `AUTH_USERS`, `AUTH_UNIVERSAL_PASSWORD_HASH`, `AUTH_UNIVERSAL_ROLE`, `AUTH_SESSION_HOURS` | Los valores que te pasé por chat (el de `AUTH_USERS` sin comillas). `AUTH_SECRET` como secreta |

- También puedes usar **Add a variable → Import from a .env file** y pegar las líneas.
- Si existen `USE_MOCK_DATA` o `AUTH_MODE=dev` de la primera versión, bórralas (ya no hacen falta).
- Deja las variables con el alcance por defecto (todos los scopes).

### D2. Sitio y rama

Si el sitio ya existe, salta a D3. Si no: **Add new site → Import an existing project → GitHub** →
repositorio `jmartinez-rgb/orueba` → rama `claude/blissful-goodall-vh8k7n` → **Base directory**:
`media-monitoring-center` (lo demás se lee de `netlify.toml`).

### D3. Publica y comprueba

1. **Deploys → Trigger deploy → Deploy site** (las variables solo aplican con un deploy nuevo).
2. Abre `https://TU-SITIO/api/health`: debe decir `"mode":"sheets"`.
3. Abre `https://TU-SITIO/`: te lleva a *Iniciar sesión*. Entra con `jmartinez`.
4. **Integrations → Google Sheets (Dataslayer) → Probar conexión**.

La protección con contraseña de Netlify (Visitor access) ya no hace falta porque la app tiene su
propio acceso. Si la dejas, el equipo tendrá que escribir dos contraseñas.

---

## Parte E. Ajustes dentro de la app (una sola vez)

1. **Settings → Moneda**: Google, Meta y TikTok traen la moneda de cada cuenta (las cuentas en
   **USD** se detectan solas: izzi - campañas, izzi - Apple TV, izzi Discovery, izzi Universal+,
   izzi APPLE TV, izzi ABCW US). Captura la **tasa del mes** (1 USD = N MXN) cada mes. Bing y
   Spotify no traen moneda y se toman como MXN; corrígelo ahí si alguna no lo es.
2. **Budget Control**: si no creaste la pestaña `Presupuestos`, captura los presupuestos de
   referencia y confirma, en las cuentas mixtas, si el presupuesto es por cuenta o por campaña.
3. **Métricas**: elige la métrica monitoreada de cada plataforma. En Meta, "Conversiones" es la
   venta total (Compras Offline Web + On-Facebook Purchase); las campañas CAPI WhatsApp se evalúan con
   On-Facebook Purchase y el resto con Compras Offline Web.
4. **Monitoreos → Configurar mensaje**: plataformas del mensaje, umbrales y revisiones de Zapier.
5. **Settings → Frecuencia de monitoreo**: *Cada (horas)* = 2, *Primera corrida* = 0 h, *Última
   corrida* = 22 h. Así son **12 evaluaciones al día** (00:00, 02:00 … 22:00). El valor de fábrica
   es de 07:00 a 23:00 (9 al día).
6. **Usuarios → Cuentas, contraseñas y permisos**: crea la cuenta de cada persona (o usa la
   contraseña universal), elige su rol, sus permisos y si ve izzi, Sky o ambas. Las contraseñas
   se asignan ahí mismo; no hace falta tocar Netlify (ver `docs/AUTH.md`).
7. Revisa ambos monitoreos con el botón **izzi | Sky** (cada uno tiene sus propias alertas,
   incidentes, tickets y mensajes).

---

## Parte F. Opcional: evaluación automática y alertas por WhatsApp

Las **12 evaluaciones automáticas al día con aviso por WhatsApp** necesitan n8n: es quien llama a
la app cada 2 horas y entrega los mensajes. Sin n8n todo lo demás funciona igual.

Sin n8n, la app vuelve a leer la hoja como máximo cada 5 minutos y **guarda la evaluación sola**
(alertas e incidentes de izzi y de Sky) cuando alguien la abre y ya pasaron 2 horas desde la
última, o en cuanto aparece un incidente crítico nuevo. **Actualizar ahora** vuelve a leer la hoja
y guarda la evaluación de las dos marcas en ese momento.

Para que evalúe sola cada 2 horas y envíe alertas por WhatsApp, configura n8n (WF07
Monitoring Runner y WF08 WhatsApp Alert) siguiendo `docs/N8N.md` y agrega en Netlify
`MONITORING_API_KEY`, `N8N_BASE_URL`, `N8N_ALERT_WEBHOOK`, `N8N_WEBHOOK_SECRET` y, cuando las
plantillas estén aprobadas, `WHATSAPP_ALERTS_ENABLED=true`. La app nunca envía WhatsApp por sí misma.

---

## Cómo lee la app la hoja (para entender lo que ves)

- **La fila de hoy es el acumulado** hasta la hora de la actualización de Dataslayer (por eso el
  corte del día sigue a `DataslayerQueries`).
- **Una campaña que gastó ayer y hoy no tiene fila** (Dataslayer no escribe filas sin actividad)
  cuenta como **gasto cero**, no como dato faltante: así se detecta que dejó de gastar y aparece en
  "campañas sin gasto" del mensaje de Monitoreos.
- Una **celda vacía** es "sin dato" (NULL), nunca cero.
- **Google**: ventas y leads salen solo de `MCC_Offline_Purchase` y `MCC_Offline_Lead_Contact`, y
  llamadas de `Calls from ads`; las demás acciones de conversión (clics a WhatsApp o Llamar,
  formularios, etc.) no se suman a esas métricas. Las cuentas de Sky no usan eventos offline: en
  Sky se vigilan gasto y conversiones de la plataforma.
- **Los eventos offline llegan con atraso** (se cargan días después): el acumulado de ventas de hoy
  siempre se verá bajo contra semanas anteriores. Para decidir en el día, usa gasto, conversiones
  de plataforma, WhatsApp y leads; las ventas se leen mejor al día siguiente.
- **izzi y Sky se separan por el nombre de la cuenta** ("Sky - ABCW", "Sky Performance - MXN",
  "Sky México"… son Sky; "izzi - Ofertas", "MXN - izzi 1"… son izzi). La cuenta mixta
  **"izzi - Sky Social"** se separa por campaña ("Sky / Seguidores…" va a Sky, "izzi /
  Seguidores…" a izzi). Una campaña de una cuenta de izzi que promociona Sky Sports sigue siendo
  de izzi.
- Los números se leen con su valor real aunque la celda tenga formato de moneda o porcentaje.
- **Bugs y sugerencias**: cualquier persona los envía desde el menú de usuario → *Reportar bug o
  sugerencia*; solo el administrador los recibe.

---

## Problemas frecuentes

| Qué ves | Causa probable | Qué hacer |
|---|---|---|
| Abajo a la izquierda dice "Datos simulados" | Falta `DATA_SOURCE=sheets`, el ID o la cuenta de servicio | Integrations → tarjeta Google Sheets dice qué falta |
| "Google Sheets respondió 403" o "404" | La hoja no está compartida con la cuenta de servicio, o su API no está habilitada | Pídeselo al administrador (Parte B) |
| "No existe la pestaña …" | Se renombró una pestaña | Devuélvele el nombre o ajusta `config/sheets.mapping.json` |
| "… faltan columnas …" | Dataslayer cambió un encabezado | Ajusta la consulta o el mapeo |
| Todas las plataformas en "Datos atrasados" | Dataslayer no ha corrido en más de 2 h 35 min | Revisa la programación y la pestaña `DataslayerQueries` |
| Una consulta aparece "Con error" | En `DataslayerQueries` el estado no es "Refreshed successfully" (p. ej. token vencido) | Reconecta la cuenta en Dataslayer y vuelve a correr la consulta |
| "Curva por hora · Parcial" | No existe la pestaña por hora de esa plataforma | Parte A4 (opcional pero recomendado) |
| La hora de actualización está desfasada una hora | Zona horaria distinta en la hoja | Parte A5 |
| "El acceso aún no está configurado" | Faltan las variables `AUTH_*` en Netlify | Parte D1 y D3 |
| El gasto de una cuenta en USD se ve muy bajo | Falta la tasa del mes (o la cuenta es de Bing/Spotify y no trae moneda) | Parte E1 |
| Una cuenta aparece en la marca equivocada | Su nombre no dice "Sky" o dice ambas marcas | Renómbrala en la plataforma o avísalo en Bugs y sugerencias |
| Spotify no aparece en el Overview | Llega con un día de atraso y no se vigila en vivo | Parte A2 |

## Lista final

- [ ] La hoja "MONITOREO" tiene las 6 pestañas y `DataslayerQueries`, actualizándose cada 2 horas.
- [ ] (Recomendado) Pestañas `Google | Hora`, `Meta | Hora`, `TikTok | Hora`, `Bing | Hora`.
- [ ] Archivo JSON de la cuenta de servicio recibido y hoja compartida como Lector (administrador).
- [ ] En local: Integrations → Probar conexión dice "Conexión correcta".
- [ ] En Netlify: variables `DATA_SOURCE`, `SHEETS_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`,
      `GOOGLE_PRIVATE_KEY`, `APP_TIMEZONE` y `AUTH_*`; deploy nuevo; `/api/health` dice `sheets`.
- [ ] Moneda, tasa del mes, presupuestos y métricas revisados en la app.
- [ ] Cuentas del equipo creadas en Usuarios (con sus marcas) y el botón izzi | Sky probado.
