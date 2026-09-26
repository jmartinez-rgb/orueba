# Meta Bulk Editor · sitio 5.7.0 (Plan masivo de Paid Media OS 6.1)

Sitio estático que captura la estructura de una campaña de Meta y la envía al
motor de n8n **a través de la plataforma** (`/api/motor`, que exige sesión, aplica
permisos por rol y por cuenta y agrega la clave compartida). **No habla con Meta ni
con la hoja**: eso lo hace el motor. Sitio y motor deben ser la misma versión
(5.7.0); si no coinciden, el sitio bloquea el envío y lo avisa.

No hay compilación: HTML, CSS y JavaScript.

## Qué cambió en 5.7

- **Activar, pausar o eliminar un lote** vuelve a funcionar: la acción viaja en `accion_lote`
  (antes sobrescribía la ruta del motor y n8n respondía "Acción no reconocida").
- Aviso cuando la API de Meta configurada en n8n es anterior a la vigente (**v26.0**).
- Los scripts se cargan con `?v=5.7.0` para que el navegador no use versiones anteriores.
- En el motor: chequeo de Meta con datasets solo CAPI, WhatsApp confirmado por conjuntos existentes,
  gestor que verifica la cuenta de cada objeto, dataset de WhatsApp antes que el píxel web y el
  correo de quien publica en la bitácora. Detalle en `AUDITORIA.md` del repositorio.

## Qué cambió en 5.5

WhatsApp: conjunto de datos de compras (WhatsApp CAPI) por campaña, botón "Verificar con Meta" con la configuración
que Meta acepta y "Usar esta configuración en el plan"; el número deja de ser obligatorio; la configuración probada se
usa como fuente de valores, ya no se clona.

## Qué cambió en 5.4

Chequeo de configuración de Meta (icono de escudo), alertas dentro de cada tarjeta con salto al elemento,
estado del plan por paso en el resumen, barra de avance, tarjetas plegables, datos técnicos escondidos en la
revisión y barra inferior legible en móvil.

## Qué cambió en 5.3

Bloque "Entrega" en cada campaña nueva (ubicaciones, Advantage+ audience, compartir presupuesto entre
conjuntos en ABO), "Mejoras automáticas de Meta" por anuncio (también en bloque y en la columna `mejoras`
del Excel), aviso si la versión de la API en n8n ya no está vigente, compras por universo en resultados y
gestor, y el resultado de cada fila del gestor según lo que optimiza.

## Qué cambió en 5.2

Gestor multicuenta (editar lo publicado en varias cuentas a la vez, con revisión antes de aplicar),
publicación del plan en varias cuentas (réplicas), historial de publicaciones, primer paso con
tarjetas de cuenta y búsqueda. Archivo nuevo: `assets/gestor.js`.

## Qué cambió en 5.1

Publicaciones existentes de Facebook e Instagram como anuncio, descarga de leads en CSV
("Formularios y leads"), resultados de lo publicado, revisión con Meta antes de enviar,
centro de alertas por nivel con salto al paso, pasos con estado, fases de publicación,
pantalla de resultado con indicadores y hoja de estilos nueva. Archivo nuevo: `assets/ui.js`.

## Qué cambió en 5.0

| Cambio | Para qué |
|---|---|
| **Formularios instantáneos** como tercer destino (Sitio web · WhatsApp · Formulario) | Campañas de Clientes potenciales con formulario de Meta, en campañas nuevas y en conjuntos nuevos de campañas existentes |
| Selector de formulario por anuncio, con los formularios de la página | Cada anuncio puede usar su propio formulario; los borradores y archivados no se pueden elegir |
| **Creador de formularios** en el paso Anuncios | Nombre, preguntas (Meta las rellena), preguntas propias con opciones, aviso de privacidad y pantalla final con botón a sitio web, **WhatsApp** o llamada |
| Columna `formulario` en la carga desde Excel, y en la edición en bloque | Asignar formularios a muchos anuncios de una vez |
| El envío responde al instante y muestra el avance real | La validación ya no corre dentro de los 26 s del proxy de Netlify; el motor publica por tramos y el sitio pinta "N de M anuncios" |
| Estados nuevos del sondeo: `RECHAZADO`, `DETENIDO`, `NO_ENCONTRADO` | El rechazo del validador llega por el sondeo; una corrida cortada ya no deja el sitio esperando 32 minutos |
| `timeout` de `config.js` en 25 s | El proxy de Netlify corta a los 26 s: un valor mayor nunca se usaba |

WhatsApp como destino sigue igual que en v3/4.9 (número, configuración probada,
saludo, mensaje prellenado, preguntas frecuentes, secuencias).

## Archivos que se tocan

- **`config.js`**: `endpoint` (`/api/motor`) y `hojaUrl`. Con `endpoint` vacío, el sitio entra en **modo demostración** (nada se escribe).
- La URL de n8n y la clave compartida viven solo en Netlify (`MOTOR_URL`, `MOTOR_SHARED_SECRET`); en n8n,
  `APP_SHARED_SECRET` debe tener el mismo valor. El navegador nunca las conoce.

## Despliegue

Este sitio se publica junto con la plataforma (carpeta `paid-media-os`, ver `LEEME-PUBLICAR.md`).
Si el sitio avisa que el motor no es 5.7.0, importa en n8n `meta_bulk_motor.json`, **activa** el workflow nuevo
y desactiva el anterior (ambos ocupan la misma URL del webhook).

## Cómo se usa un formulario

1. En **Campañas**, elige "Formulario instantáneo". El objetivo queda en Clientes potenciales.
2. En **Anuncios**, cada anuncio que entra a un conjunto con formulario muestra el selector.
   Si la página no tiene uno adecuado, "Crear formulario" lo crea activo en la página y lo asigna a los anuncios que no tenían.
3. Pantalla final con WhatsApp: se intenta el botón nativo de WhatsApp de Meta; si la página no lo admite,
   el formulario se crea con un botón que abre el chat por enlace (`wa.me`) con tu número y mensaje. Se avisa cuál quedó.
4. Los leads llegan al **Centro de clientes potenciales** de la página (Meta Business Suite).

## Cuando algo falla

| Síntoma | Causa más probable |
|---|---|
| "No pude obtener el token de la página" | El system user no tiene la página asignada con permiso de anuncios, o el token no incluye `pages_manage_ads`, `pages_read_engagement` y `leads_retrieval` |
| "La página no ha aceptado las condiciones…" | Un administrador de la página debe aceptar las condiciones de Lead Ads en facebook.com/ads/leadgen/tos |
| El formulario no aparece en el selector | Está en borrador o archivado, o es de otra página. "Volver a cargar" relee la página elegida |
| El envío termina en `DETENIDO` | n8n cortó la ejecución. Reenvía el mismo plan: lo creado lleva la etiqueta del lote y no se duplica |
| "Page not found" al abrir el sitio | Se desplegó la carpeta equivocada: `index.html` tiene que estar en la raíz |
| Se queda en "Cargando" | `_redirects` mal escrito, workflow inactivo, o la regla apunta a `/webhook-test/` |
