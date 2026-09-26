# Auditoría · Paid Media OS 6.0 → 6.1 y motor n8n 5.6.0 → 5.7.0

Fecha: 26-sep-2026 · API de Meta objetivo: **v26.0**

Se revisaron las Functions de Netlify (`api.mjs`, `sync-background.mjs`), el sitio (React compilado y el plan
masivo), y los 19 Code nodes del motor de n8n. Todo lo de abajo está corregido en este repositorio y probado
en local contra la API simulada (ver "Cómo se verificó").

## 1. Lo que se veía en las capturas

| Síntoma | Causa | Arreglo |
|---|---|---|
| **"Píxel 'Facebook 3 B Event Data' — No registra eventos"**, aunque Events Manager muestra 1.7K ViewContent, 547 LeadSubmitted, 136 InitiateCheckout y 130 Purchase por Conversions API | El chequeo usaba solo `last_fired_time`, que Meta llena únicamente con el píxel del **navegador**. Un dataset que recibe solo CAPI lo trae vacío | La actividad se completa con `/{pixel}/stats` (7 días): último evento, volumen, eventos principales y "solo por servidor (CAPI)". Se corrige en un solo lugar (`accountAssets`), así que también desaparece el falso "Sin eventos" del **Centro de eventos**, el "el píxel no registra eventos" de **Nueva campaña** y la buena práctica de severidad alta "píxel sin eventos recientes" de **Informes**. El **Chequeo de Meta del motor n8n** tenía el mismo fallo y también se corrigió |
| **"WhatsApp de 'izzi telecom' — La página no tiene WhatsApp vinculado: los anuncios fallarán (2446886)"** | El campo `whatsapp_number` de la página viene vacío con números de la API en la nube o de un proveedor, aunque los anuncios funcionen | Se confirma con los conjuntos y anuncios que ya van a WhatsApp con esa página: queda en verde con el número usado. Solo avisa si no hay evidencia. Igual en el motor |
| **"Cuentas de WhatsApp Business — No hay WABA visibles para el token"** | Las WABA se buscaban solo en los portafolios del token (propias y de clientes). Una WABA compartida directamente con el usuario del sistema no aparece ahí | Se buscan también en los activos asignados al token (`debug_token → granular_scopes`) y en la variable nueva `META_WABA_IDS`. Si aun así no aparece, el mensaje dice a qué usuario del sistema asignarla (`n8n-bulk-editor`), qué datasets de WhatsApp usa ya la cuenta y qué respondió Meta |
| **"Versión de la API — v25.0" en verde** | El valor por defecto y los umbrales eran de v25 | v26.0 por defecto en plataforma y motor; el chequeo marca en amarillo una versión anterior y dice qué cambió en v26 |
| "appsecret_proof — Sin META_APP_SECRET" | Aviso correcto | Sin cambio de código: configura `META_APP_ID` y `META_APP_SECRET` |

## 2. Fallos que no se veían (corregidos)

**Plan masivo y motor n8n**

1. **Activar, pausar o eliminar un lote nunca funcionó.** El sitio mandaba la acción del lote en `accion` y
   sobrescribía la ruta `buscar`; n8n respondía "Acción no reconocida: ACTIVE". Ahora viaja en `accion_lote`.
2. **Conversiones a WhatsApp con el píxel equivocado.** Si la verificación previa no se completaba (p. ej. en
   campañas existentes), el motor optimizaba con el primer píxel de la cuenta en vez del dataset de WhatsApp
   elegido. Y la validación bloqueaba el plan si la cuenta no tenía píxel web aunque sí hubiera dataset de WhatsApp.
3. **El gestor multicuenta se saltaba la regla de presupuesto**: una subida mayor a 50 % requiere director en el
   Editor, pero no en el gestor. Ahora la plataforma la aplica con los valores **reales** de Meta (no los que manda
   el navegador).
4. **El gestor no verificaba la cuenta de cada objeto**: con cuentas en monedas distintas (MXN con centavos, COP
   sin centavos) un presupuesto podía quedar 100 veces mayor o menor. Ahora se rechaza el objeto ajeno (en la
   plataforma y en el motor).
5. **La bitácora y la hoja "runs" no registraban quién publicaba** (columna `operador` vacía): ahora se guarda el
   correo de la sesión.
6. El diagnóstico de referencia (crea y borra copias en Meta) no contaba como escritura: un analista podía lanzarlo.
7. Descargar leads desde el plan masivo no pedía el permiso de públicos ni quedaba en el registro de actividad.
8. En agencias con más de 100 páginas, la validación decía "La página elegida ya no está accesible".
9. Un creativo sin botón enviaba `call_to_action: null` (Meta lo rechaza).
10. Monedas sin centavos CRC e IDR no estaban en el motor (sí en la plataforma): presupuestos 100 veces mayores.
11. Las métricas del gestor no usaban la atribución de cada conjunto: no coincidían con Ads Manager ni con la plataforma.

**Permisos (usuarios con cuentas asignadas)**

12. El chequeo de Meta, "Evaluar ahora" de reglas, las alertas, y en el plan masivo la lista de cuentas, el
    gestor, la importación entre cuentas, el historial y los formularios aceptaban **cualquier cuenta**.
13. El Editor y la duplicación aceptaban objetos de otra cuenta si se indicaba una cuenta permitida. Ahora se
    verifica con Meta la cuenta dueña de cada objeto (y, para usuarios con cuentas asignadas, si Meta no lo
    confirma, no se aplica).
14. `/api/alerts/dismiss` podía escribir sobre cualquier clave del almacén (usuarios, sesiones, reglas).

**API v26.0 y Meta**

15. Nueva campaña seguía ofreciendo las ubicaciones Explorar y Búsqueda de Instagram (retiradas en v26); ahora no
    se ofrecen ni se envían, y si una lista de ubicaciones queda vacía ya no se manda vacía.
16. La atribución copiada de otros conjuntos podía traer ventanas de visualización de 7 o 28 días (retiradas el
    12-ene-2026): se dejan en 1 día, como ya hacía el motor.
17. Listas de clientes: los teléfonos locales de 10 dígitos se subían sin código de país (Meta no los empareja);
    ahora se completan según la moneda de la cuenta (MXN → 52, COP → 57…). Además, el público debe ser de la cuenta.

**Otros**

18. Reglas sin enfriamiento definido se repetían cada hora (el cálculo daba `NaN`); ahora 24 h.
19. El contador de intentos fallidos del ingreso con código nunca caducaba; ahora se olvida tras una hora.
20. El chequeo marcaba "WABA sin dataset" por WABA de otros portafolios que la cuenta no usa.
21. **Caché del sitio**: Netlify sirve `/assets/*` como inmutable durante un año; un archivo editado con el mismo
    nombre nunca llegaba a los navegadores. Los archivos que cambiaron tienen nombre nuevo y
    `herramientas/renombrar_assets.py` lo automatiza.

## 3. Mantenimiento

- `n8n/src/`: el código de cada Code node en su archivo (el cliente de Meta compartido en `_cliente_meta.js`) y
  `n8n/build.py` reconstruye `meta_bulk_motor.json` revisando la sintaxis. Ya no hay que copiar el mismo cambio en
  ocho nodos.
- `pruebas/`: `api.test.mjs` (21 pruebas de la plataforma), `motor.test.mjs` (8 pruebas con un simulador de Code nodes de n8n) y
  `servidor-local.mjs` (sitio + API simulada en `http://localhost:8888`).

## 4. Cómo se verificó

- `node pruebas/api.test.mjs` y `node pruebas/motor.test.mjs`: todas pasan.
- El mock de Meta reproduce tu caso real: un dataset de WhatsApp que recibe solo CAPI y una página sin
  `whatsapp_number` con anuncios a WhatsApp. El chequeo muestra ambos en verde.
- Sitio completo en Chromium (inicio, Conexión con Meta, Centro de eventos, Nueva campaña, Editor, Informes,
  Reglas, Públicos, WhatsApp, Plan masivo): sin errores de consola ni archivos faltantes.
- `sync-background` (reglas cada hora) corre completo en modo simulado.

**Límite:** desde aquí no hay acceso a tu cuenta real de Meta. Se usan endpoints documentados (`/{pixel}/stats`,
`debug_token`); si Meta no devolviera estadísticas para un dataset, el chequeo lo dice con el motivo en lugar de
"No registra eventos".

## 5. Lo que queda de tu lado

1. `META_API_VERSION = v26.0` en Netlify **y** en n8n.
2. `META_APP_ID` y `META_APP_SECRET` en Netlify (quita el aviso de `appsecret_proof`).
3. Si tras publicar el chequeo sigue sin ver la WABA `803058249331497`: asígnala al usuario del sistema
   `n8n-bulk-editor` con control total, o ponla en `META_WABA_IDS`.
4. Importar y activar el motor 5.7.0 en n8n (y desactivar el 5.6.0).

## 6. Recomendaciones (no incluidas en esta versión)

- **Ingreso con código compartido**: cualquiera con el código puede entrar como cualquier correo del dominio,
  incluido un administrador. Para producción conviene Google OAuth (ya soportado) o un enlace por correo.
- **Código fuente del sitio**: el frontend llegó compilado y minificado; los cambios de interfaz grandes necesitan el
  proyecto fuente (React/Vite). Conviene versionarlo en este repositorio.
- Las reglas de "% de presupuesto total consumido" solo ven los últimos 30 días de gasto; en presupuestos totales
  más largos subestiman el consumo.
- Confirmar en Netlify (Functions → `sync-background` → Logs) que la función programada corre cada hora.
