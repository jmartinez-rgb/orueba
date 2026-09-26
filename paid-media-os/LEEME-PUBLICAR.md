# Paid Media OS 6.0 · cómo actualizar en Netlify

Ya tienes el sitio publicado y las variables configuradas. Para pasar a la 6.0:

1. app.netlify.com → tu sitio → **Deploys**.
2. Arrastra la carpeta **paid-media-os** completa (la que contiene `sitio`, `functions` y `netlify.toml`)
   al recuadro "Drag and drop your project folder here".
3. Espera "Published" y confirma que diga **2 functions deployed**.
4. Abre `https://TU-SITIO/api/health` → debe decir `"version":"6.0.0"`.
5. Entra al sitio y recarga con Ctrl+Shift+R (o Cmd+Shift+R) para no ver la versión anterior en caché.

No hay que tocar variables de entorno ni n8n (el motor sigue siendo el 5.6.0).

## Qué revisar después de publicar
- **Nueva campaña → WhatsApp compras**: en el conjunto verás "Configuraciones de WhatsApp que ya funcionan en
  esta cuenta". Pulsa **Usar esta configuración** en una de compras, elige la página y **Verificar con Meta**.
- La página ya no se bloquea por "no tiene WhatsApp vinculado": si Meta no expone el número, aparece como
  advertencia y Meta lo comprueba al verificar.
- **Centro de eventos → WhatsApp de la cuenta**: números, WABA (propias y de cliente), portafolios revisados
  y errores de lectura, si los hay.
- **Informes** (menú Análisis): elige cuentas y periodo → Generar informe. Por hora, día × hora, insights,
  recomendaciones de Meta, CSV y PDF.

## Si algo no aparece
- En el conjunto de WhatsApp abre "Diagnóstico de WhatsApp": dice qué portafolios se revisaron y qué respondió
  Meta. Si falta el permiso `whatsapp_business_management` en el token, agrégalo al usuario del sistema.
- "Volver a leer de Meta" (en ese mismo diagnóstico) ignora la caché.

Primera instalación (sitio nuevo): define las variables de `variables-de-entorno.txt` en Site configuration →
Environment variables y luego sigue los pasos de arriba.
