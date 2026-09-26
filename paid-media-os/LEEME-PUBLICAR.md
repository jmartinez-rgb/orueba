# Paid Media OS 6.1 · cómo actualizar en Netlify y n8n

Esta versión cambia **las dos piezas**: la plataforma (Netlify) y el motor del plan masivo (n8n 5.7.0).
El plan masivo se bloquea solo si las versiones no coinciden, así que publica ambas.

## 1. Variables de entorno (Netlify → Site configuration → Environment variables)

| Variable | Qué hacer |
|---|---|
| `META_API_VERSION` | Cámbiala a **`v26.0`** (hoy dice `v25.0`; el chequeo lo marca en amarillo mientras no se cambie). |
| `META_APP_ID` y `META_APP_SECRET` | Recomendado: con ellas las llamadas van firmadas (`appsecret_proof`) y desaparece el aviso del chequeo. Después activa "Require App Secret" en la app de Meta. |
| `META_WABA_IDS` | Opcional. Si el chequeo dice que el token no ve ninguna WABA, pon aquí el ID de la WABA (p. ej. `803058249331497`, el que muestra Events Manager junto al dataset). |

## 2. Publicar la plataforma

1. app.netlify.com → tu sitio → **Deploys**.
2. Arrastra la carpeta **paid-media-os** completa (la que contiene `sitio`, `functions` y `netlify.toml`).
3. Espera "Published" y confirma que diga **2 functions deployed**.
4. Abre `https://TU-SITIO/api/health` → debe decir `"version":"6.1.0"` y `"metaVersion":"v26.0"`.
5. Recarga con Ctrl+Shift+R (o Cmd+Shift+R). Los archivos del sitio cambiaron de nombre, así que el navegador toma la versión nueva aunque tuviera la anterior en caché.

## 3. Actualizar el motor en n8n

1. En n8n, variables: `META_API_VERSION` = **`v26.0`**. Opcional: `META_WABA_IDS` (igual que en Netlify).
2. Importa `meta_bulk_motor.json` (motor **5.7.0**). n8n crea un workflow nuevo.
3. Revisa que las credenciales de Google Sheets y Gmail sigan asignadas en los nodos que las usan.
4. **Activa** el workflow nuevo y **desactiva** el 5.6.0 (ambos usan la misma URL del webhook).
5. Abre el plan masivo en la plataforma: no debe aparecer el aviso "El motor de n8n no es la versión de este sitio".

## Qué revisar después de publicar

- **Conexión con Meta** (cuenta "MXN - IZZI WHATSAPP"):
  - "Facebook 3 B Event Data" ya no dice "No registra eventos": muestra el último evento, los eventos de 7 días
    y que llegan solo por servidor (CAPI).
  - "WhatsApp de izzi telecom" queda en verde si la cuenta ya anuncia a WhatsApp con esa página.
  - Si sigue "El token no ve ninguna WABA", el mensaje dice a qué usuario del sistema asignarla, o usa `META_WABA_IDS`.
- **Centro de eventos**: el mismo dataset aparece como "Dataset de WhatsApp" y con fecha de último evento.
- **Plan masivo → Resultados de un lote**: los botones Activar, Pausar y Eliminar ya funcionan.
- **Registro de actividad**: las descargas de leads hechas desde el plan masivo quedan registradas.

## Si algo no aparece

- `/api/health` sigue en 6.0.0: el deploy no terminó o se arrastró otra carpeta.
- El plan masivo dice que el motor no coincide: quedó activo el workflow 5.6.0 en n8n.
- Un usuario con cuentas asignadas ya no ve otras cuentas en el plan masivo ni en el historial: es intencional.

Primera instalación (sitio nuevo): define las variables de `variables-de-entorno.txt` y sigue los pasos de arriba.
