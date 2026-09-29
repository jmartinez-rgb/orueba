# Instalación paso a paso

Guía completa para dejar funcionando el izzi Media Monitoring Center leyendo la hoja de Google
Sheets que actualiza Dataslayer. Síguela en orden; cada parte termina con una comprobación.

| Parte | Qué haces | Tiempo aprox. |
|---|---|---|
| A | Revisar la hoja de Dataslayer (y, recomendado, agregar las consultas por hora) | 15–30 min |
| B | Crear la cuenta de servicio de Google para que la app pueda leer la hoja | 15 min |
| C | Probar todo en tu computadora | 15 min |
| D | Publicar en Netlify | 15 min |
| E | Ajustes finales dentro de la app | 10 min |
| F | Opcional: alertas automáticas por WhatsApp con n8n | — |

**Antes de empezar necesitas:**

- Permiso de edición en la hoja **"Monitoreo | Big Query"** (la que llena Dataslayer).
- Una cuenta con acceso a **Google Cloud** (console.cloud.google.com).
- Tu Mac con Node.js (ya instalado) y el proyecto clonado en `~/orueba`.
- Acceso al sitio en **Netlify**.
- Las contraseñas de acceso (`jmartinez`, `operaciones` y la universal) y el bloque `AUTH_*`
  que te pasé por chat. Nunca van en el repositorio.

> **Solo lectura.** La app nunca escribe en la hoja, ni en Dataslayer, ni en las plataformas.
> La cuenta de servicio tiene permiso de **Lector** y nada más.

---

## Parte A. La hoja de Dataslayer

### A1. Qué pestañas lee la app

La app lee estas pestañas de "Monitoreo | Big Query" tal como las deja Dataslayer:

| Pestaña | Plataforma | Para qué |
|---|---|---|
| `Google \| General` | Google Ads | Gasto, impresiones, clics y conversiones por campaña y día |
| `Google Conversiones` | Google Ads | Ventas (`MCC_Offline_Purchase`) y leads (`MCC_Offline_Lead_Contact`) por campaña |
| `Meta` | Meta | Gasto, leads, conversaciones, Compras Offline Web (Inbound) y On-Facebook Purchase |
| `TikTok` | TikTok | Gasto, impresiones, clics y conversiones |
| `Bing` | Microsoft Advertising | Gasto, impresiones, clics y conversiones |
| `Spotify` | Spotify | Gasto, impresiones y clics |
| `DataslayerQueries` | — | Hora y estado de la última actualización de cada consulta (Dataslayer la crea sola) |

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

### A3. Tamaño de la hoja (recomendado)

Hoy las consultas empiezan el 1 de julio de 2026 y terminan en 2030, así que la hoja crece todos
los días. La app necesita como mínimo las **últimas 5 semanas**. Para que la lectura siga siendo
rápida, cuando la hoja acumule más de unos 6 meses mueve la **fecha de inicio** de cada consulta
para conservar solo los últimos 2 o 3 meses.

### A4. Consultas por hora (recomendado, para comparar la misma franja con precisión)

La app compara **hoy hasta la hora de corte contra el mismo día de semanas anteriores hasta la
misma hora**. Las pestañas actuales son **diarias**. Sin datos por hora, la app estima la curva
horaria con una curva típica y lo marca como aviso ("Curva por hora · Parcial"), con −10 puntos de
confianza. Para que la comparación sea exacta, agrega **una consulta por hora a nivel cuenta**
para cada plataforma (son ligeras: una fila por cuenta y hora).

Para cada plataforma (Google Ads, Meta, TikTok y Microsoft/Bing):

1. En Dataslayer, **duplica** la consulta de esa plataforma (la de `Google | General`, `Meta`,
   `TikTok` o `Bing`).
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

Spotify no tiene desglose por hora: siempre usa la curva típica (su gasto es bajo).

### A5. Zona horaria de la hoja

La app interpreta las horas de `DataslayerQueries` con la zona horaria de la hoja (*Archivo →
Configuración → Zona horaria*). No hace falta cambiarla. Si la "Última actualización" que muestra
la app no coincide con la de `DataslayerQueries`, se fija la zona en `config/sheets.mapping.json`
(`control.timeZone`, por ejemplo `America/Bogota`).

### A6. Pestañas opcionales: presupuestos y tipo de cambio

Si quieres que Budget Control lea los presupuestos de la hoja, crea una pestaña **`Presupuestos`**
con las columnas de la plantilla `config/presupuestos.template.csv`:

| Mes | Plataforma | Cuenta | Campaña | Monto | Moneda | Nivel |
|---|---|---|---|---|---|---|
| 2026-10 | Google | izzi - Ofertas | | 510000 | MXN | Cuenta |

Y, si prefieres capturar el tipo de cambio en la hoja en lugar de en la app, una pestaña **`Tipo de
cambio`** (`config/tipo-de-cambio.template.csv`: `Mes`, `USD a MXN`). Ambas son opcionales: también
se capturan dentro de la app (Parte E).

---

## Parte B. Cuenta de servicio de Google

Es un "usuario robot" de Google con el que la app lee la hoja. Solo tendrá permiso de lector.

1. Entra a **https://console.cloud.google.com** con tu cuenta.
2. Arriba, elige un proyecto (puede ser el de izzi o uno nuevo, por ejemplo
   `izzi-monitoring-center`: *Seleccionar proyecto → Proyecto nuevo*).
3. Habilita la API: menú ☰ → **APIs y servicios → Biblioteca** → busca **Google Sheets API** →
   **Habilitar**.
4. Crea la cuenta: **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**.
   - Nombre: `monitoring-center-lector`.
   - En "Otorgar acceso al proyecto" **no elijas ningún rol** (no los necesita) → **Listo**.
5. Crea la llave: entra a la cuenta de servicio → pestaña **Claves** → **Agregar clave → Crear clave
   nueva → JSON → Crear**. Se descarga un archivo `.json`.
   - Guárdalo fuera del proyecto (por ejemplo en `Descargas`). **No lo subas a GitHub ni lo
     compartas por chat.** Contiene la llave privada.
   - Si Google dice que la creación de claves está bloqueada por una política de la organización,
     pídele al administrador de Google Workspace/Cloud que la habilite para este proyecto.
6. Comparte la hoja con la cuenta de servicio: abre el archivo JSON con TextEdit, copia el valor de
   `client_email` (termina en `.iam.gserviceaccount.com`), abre **"Monitoreo | Big Query" →
   Compartir** → pega el correo → rol **Lector** → desmarca **Notificar** → **Compartir**.

Comprobación: en *Compartir* de la hoja aparece el correo de la cuenta de servicio como Lector.

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

Con el archivo JSON de la Parte B y la URL de la hoja "Monitoreo | Big Query":

```
npm run sheets:setup -- ~/Downloads/NOMBRE-DEL-ARCHIVO.json "URL-COMPLETA-DE-LA-HOJA"
```

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
   correcta con "Monitoreo | Big Query"* y la zona horaria de la hoja.
3. En la misma tarjeta aparecen las pestañas con sus filas y la hora de la última actualización.
4. Abajo a la izquierda debe decir **Google Sheets (Dataslayer)** (no "Datos simulados").
5. En el **Overview** verás solo Google, Meta, TikTok, Microsoft y Spotify, con datos reales.

Si algo falla, Integrations explica qué falta (ver *Problemas frecuentes* al final).

---

## Parte D. Publicar en Netlify

### D1. Variables de entorno

Netlify → tu sitio → **Site configuration → Environment variables → Add a variable**. Agrega:

| Variable | Valor |
|---|---|
| `DATA_SOURCE` | `sheets` |
| `SHEETS_SPREADSHEET_ID` | El ID de la hoja (lo imprime `npm run sheets:setup`) |
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

1. **Settings → Moneda**: la hoja no dice en qué moneda está cada cuenta. Marca las cuentas en
   **USD** y captura la **tasa del mes** (1 USD = N MXN). Cada mes, captura la tasa nueva.
2. **Budget Control**: si no creaste la pestaña `Presupuestos`, captura los presupuestos de
   referencia y confirma, en las cuentas mixtas, si el presupuesto es por cuenta o por campaña.
3. **Métricas**: elige la métrica monitoreada de cada plataforma. En Meta, "Conversiones" es la
   venta total (Compras Offline Web + On-Facebook Purchase); las campañas CAPI WhatsApp se evalúan con
   On-Facebook Purchase y el resto con Compras Offline Web.
4. **Monitoreos → Configurar mensaje**: plataformas del mensaje, umbrales y revisiones de Zapier.
5. Comparte las contraseñas con el equipo: cada persona entra con su nombre y la contraseña universal.

---

## Parte F. Opcional: evaluación automática y alertas por WhatsApp

Sin n8n, la app evalúa cada vez que alguien la abre (vuelve a leer la hoja como máximo cada 3
minutos) y **Actualizar ahora** vuelve a leer la hoja y guarda la evaluación (alertas e
incidentes). Para que evalúe sola cada 2 horas y envíe alertas por WhatsApp, configura n8n (WF07
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
- **Google**: ventas y leads salen solo de `MCC_Offline_Purchase` y `MCC_Offline_Lead_Contact`;
  las demás acciones de conversión se ignoran.
- Los números se leen con su valor real aunque la celda tenga formato de moneda o porcentaje.
- **Bugs y sugerencias**: cualquier persona los envía desde el menú de usuario → *Reportar bug o
  sugerencia*; solo el administrador los recibe.

---

## Problemas frecuentes

| Qué ves | Causa probable | Qué hacer |
|---|---|---|
| Abajo a la izquierda dice "Datos simulados" | Falta `DATA_SOURCE=sheets`, el ID o la cuenta de servicio | Integrations → tarjeta Google Sheets dice qué falta |
| "Google Sheets respondió 403" o "404" | La hoja no está compartida con la cuenta de servicio, o la API no está habilitada | Parte B, pasos 3 y 6 |
| "No existe la pestaña …" | Se renombró una pestaña | Devuélvele el nombre o ajusta `config/sheets.mapping.json` |
| "… faltan columnas …" | Dataslayer cambió un encabezado | Ajusta la consulta o el mapeo |
| Todas las plataformas en "Datos atrasados" | Dataslayer no ha corrido en más de 2 h 35 min | Revisa la programación y la pestaña `DataslayerQueries` |
| Una consulta aparece "Con error" | En `DataslayerQueries` el estado no es "Refreshed successfully" (p. ej. token vencido) | Reconecta la cuenta en Dataslayer y vuelve a correr la consulta |
| "Curva por hora · Parcial" | No existe la pestaña por hora de esa plataforma | Parte A4 (opcional pero recomendado) |
| La hora de actualización está desfasada una hora | Zona horaria distinta en la hoja | Parte A5 |
| "El acceso aún no está configurado" | Faltan las variables `AUTH_*` en Netlify | Parte D1 y D3 |
| No puedo crear la llave de la cuenta de servicio | Política de la organización en Google Cloud | Pide al administrador de Google Workspace que la habilite |
| El gasto de una cuenta en USD se ve muy bajo | La cuenta no está marcada como USD o falta la tasa del mes | Parte E1 |

## Lista final

- [ ] La hoja tiene las 6 pestañas y `DataslayerQueries`, actualizándose cada 2 horas.
- [ ] (Recomendado) Pestañas `Google | Hora`, `Meta | Hora`, `TikTok | Hora`, `Bing | Hora`.
- [ ] Cuenta de servicio creada, Google Sheets API habilitada y hoja compartida como Lector.
- [ ] En local: Integrations → Probar conexión dice "Conexión correcta".
- [ ] En Netlify: variables `DATA_SOURCE`, `SHEETS_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`,
      `GOOGLE_PRIVATE_KEY`, `APP_TIMEZONE` y `AUTH_*`; deploy nuevo; `/api/health` dice `sheets`.
- [ ] Moneda, tasa del mes, presupuestos y métricas revisados en la app.
