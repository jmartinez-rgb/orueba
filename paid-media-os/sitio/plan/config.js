/* =====================================================================
   Meta Bulk Editor · configuración del sitio — 5.5

   Esto es lo único que se edita antes de subir a Netlify.

   El token de Meta NO va aquí y nunca va aquí: vive en n8n y no sale de ahí.

   Este archivo lo puede leer cualquiera que abra la página. Como la clave
   compartida está desactivada, la única barrera real es la protección de
   acceso de Netlify: actívala en Site configuration > Access control.
   ===================================================================== */

window.CONFIG = {

  /* 5.6: ruta del backend de la plataforma. La Function /api/motor exige sesión
     corporativa, aplica permisos y reenvía a n8n con la clave compartida
     (MOTOR_URL y MOTOR_SHARED_SECRET en Netlify). El navegador nunca habla
     con n8n. Modo demostración: deja este campo vacío. */
  endpoint: "/api/motor",

  /* Ya no se usa: la clave vive solo en el servidor (MOTOR_SHARED_SECRET). */
  clave: "",

  /* Enlace a la hoja de cálculo, para el botón "Hoja".
     Hoja nativa de Google, ID de 44 caracteres. Ese mismo ID va en la
     variable SHEET_ID de n8n. */
  hojaUrl: "https://docs.google.com/spreadsheets/d/1425x6oDWPyjNNzoMsjRSyFYpJCRNAUXlr5boLG_dfm8/edit",

  /* Texto que aparece junto al nombre del producto en la barra superior. */
  entorno: "ABCW",

  /* Segundos de espera de cada llamada suelta al webhook. 25: el proxy de
     Netlify corta a los 26 s, así que un valor mayor nunca llega a usarse.
     No limita la publicación: esa responde de inmediato con un run_id y el
     sitio va preguntando por el estado hasta que Meta termina. */
  timeout: 25,
};
