Quiero que audites y mejores este proyecto continuando el trabajo que hizo Codex. Comienza por una revisión independiente del código y sus contratos; después propone y aplica correcciones justificadas con pruebas. No des por correcta la implementación porque sus pruebas pasan. Distingue defectos de código, limitaciones documentadas de cada plataforma y bloqueos del entorno. Entrega hallazgos con severidad, archivo/línea, impacto, evidencia y corrección recomendada, y un orden concreto para resolver los pendientes.

**Entrega y ubicación del trabajo**

Repositorio: `jmartinez-rgb/orueba`. El módulo trabajado es `unified-ads-api`, cuya raíz en Codex es `/workspace/orueba/unified-ads-api`. Es una API con Node.js, TypeScript y Fastify 5; no es el frontend `media-monitoring-center` mencionado al principio de la conversación.

La rama local es `codex/google-ads-phase-2`; el HEAD base es `37209600b548d06966d532d410a6b13fce37f295`. Hay numerosas modificaciones y archivos nuevos **sin commit ni push**. Abrir solamente GitHub no garantiza acceder a estos cambios. El ZIP adjunto contiene el estado actual completo de este módulo, con los archivos fuente, pruebas, documentación y lockfile, pero sin `.git`, credenciales, sesiones OAuth, dependencias instaladas ni compilados. Usa ese contenido como entrega del trabajo. No ejecutes reset, checkout, clean ni sustituyas cambios sin revisar y preservar el estado recibido. No publiques, despliegues ni subas credenciales.

**Alcance implementado**

Modelo unificado de cuentas, campañas, rendimiento diario/horario y conversiones, autenticación interna mediante `X-API-Key`, errores estándar, resultados parciales, validación de consultas, OpenAPI, reintentos, timeouts, cancelación y circuit breaker. Las integraciones consultan las plataformas; no implementan cambios de presupuestos ni gestión de campañas. Microsoft sí solicita y consulta trabajos de generación de informes.

Rutas principales: `/api/v1/health`, `/api/v1/providers`, `/api/v1/providers/{provider}/status`, `/api/v1/accounts`, `/api/v1/campaigns`, `/api/v1/performance`, `/api/v1/conversions`, más `/docs`. Las rutas de datos usan filtros `provider`, `client_id`, `account_id` y, donde corresponde, `campaign_id`, fechas y granularidad.

| Plataforma | Implementación y evidencia | Pendientes y límites |
| --- | --- | --- |
| Google Ads | REST v25, OAuth, cuentas/MCC, campañas, GAQL, métricas y conversiones. Lecturas reales y simulador verificados. Los registros documentan 33 raíces, 2274 cuentas de jerarquías y una muestra de 150 campañas, 59 filas diarias de rendimiento y 2038 filas por acción de conversión. También hubo muestras horarias. | Conciliar cifras con Google Ads y comprobar otras cuentas/permisos. No interpretar las filas como totales de conversiones ni la muestra como validación exhaustiva. |
| Meta | Marketing API v26.0. Token Bearer, permisos, cuentas, campañas, Insights diarios/horarios y acciones de conversión. Lecturas reales de 17 cuentas activas y muestras de datos verificadas. | Elegir la acción principal para CPA/conversiones en rendimiento. Las conversiones externas y alcance/frecuencia tienen restricciones horarias. El metadata `business` es opcional porque necesita permisos adicionales. |
| TikTok | Contrato GET v1.3, cuentas, campañas, reportes, paginación, bloques de fechas y normalización; validado con simulador. | App `Unified Ads Monitoring` pendiente de aprobación. No hay App ID, App Secret ni Access Token utilizables. No se verificó conexión real. El contrato v2.0 y la automatización OAuth completa necesitan revisión separada. |
| Microsoft Advertising | REST v13, OAuth, cuatro cuentas y 43 campañas reales verificados. Generación/polling y parser ZIP/CSV implementados y probados con simulador. | La API generó una URL de informe real, pero el proxy rechaza HTTPS CONNECT con 403 hacia `bingadsappsstorageprod.blob.core.windows.net`, incluso con política sin restricciones. No se descargaron/conciliaron filas reales de ese ZIP. Hubo consultas válidas sin datos; no demuestran funcionamiento de la descarga con datos. |
| Spotify Ads | Ads API v3, negocios, cuentas, campañas e informes agregados JSON; probado con simulador. OAuth real completado y refresh token guardado privadamente. | Ads API sigue respondiendo 403 / `ACCESS_REQUIRED`. El usuario confirmó aceptar los términos y la última consulta seguía bloqueada; la habilitación puede tardar hasta una hora. No se verificaron cuentas, campañas ni métricas reales. |
| X Ads | Permanece como proveedor base sin integración, fase 7. | Implementación, acceso y comprobaciones pendientes. |

Consulta `README.md`, `docs/ARCHITECTURE.md`, `docs/GOOGLE_ADS.md`, `docs/META_ADS.md`, `docs/TIKTOK_ADS.md`, `docs/MICROSOFT_ADS.md` y `docs/SPOTIFY_ADS.md`. Algunos textos históricos todavía dicen «autorización pendiente» o «términos pendientes»; contrástalos con el estado anterior y actualízalos tras verificar. Las instrucciones de inicio de Codex conservan historial; los párrafos actuales tienen prioridad.

**Comprobaciones efectuadas y cómo reproducirlas**

Se trabajó con Node 24.19 y npm 11.9. El manifiesto declara Node >=22; comprueba la compatibilidad de la versión mínima, especialmente el uso de proxy para `fetch`. Desde la raíz del módulo:

```bash
npm ci --cache /tmp/unified-ads-npm-cache --no-audit --no-fund
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

La última suite completa ejecutada pasó **406 pruebas en 14 archivos**. Después se corrigió la ventana temporal del asistente OAuth de Spotify y se añadieron dos pruebas: la ejecución posterior de Spotify, OAuth y proveedores pasó **99 pruebas**. También pasaron tipos, lint, compilación y formato. No se volvió a ejecutar la suite completa después de esas dos nuevas pruebas; vuelve a correrla para auditar el estado recibido. Los simuladores no hacen llamadas reales y no reemplazan una conciliación con las plataformas.

Arranque probado en Codex:

```bash
NODE_USE_ENV_PROXY=1 HOST=127.0.0.1 PORT=8080 PROVIDER_TIMEOUT_MS=120000 npm start
```

Para desarrollo está disponible `npm run dev`. Salud y documentación respondieron HTTP 200. Es un servicio interno del entorno: no hay URL pública ni despliegue validado. El navegador del usuario no puede abrir el localhost de esa máquina. La publicación de un entorno conserva archivos del snapshot, pero no los procesos; vuelve a iniciar el servicio cuando corresponda. No copies `.env.example` encima de un `.env` existente.

**Credenciales y OAuth: información necesaria para continuar**

El usuario trabaja solo desde el navegador. Las credenciales se introdujeron mediante variables privadas del entorno, no en el código. El ZIP no incluye secretos. Si Claude trabaja en otra máquina, debe recibir configuración privada por su mecanismo seguro o repetir la autorización; conectar GitHub no transfiere las variables del entorno de Codex.

Los refresh tokens de Microsoft y Spotify están en un `.env` privado con permisos 0600 en el entorno original. El token de Microsoft se conservó al agregar Spotify. Ese archivo está excluido de Git. El asistente no sincroniza automáticamente esos valores al almacén del panel, y una variable del proceso vacía u obsoleta puede ocultar el valor de `.env`. Revisar persistencia, precedencia y rotación de tokens al reiniciar o cambiar de máquina. No pedir secretos por chat ni registrar cuerpos OAuth, cabeceras de autenticación, callbacks con códigos o URL firmadas de informes.

Asistentes existentes: `scripts/google-auth.ts`, `scripts/microsoft-auth.ts`, `scripts/spotify-auth.ts`, mediante scripts `npm run google:auth`, `microsoft:auth` y `spotify:auth`. Para Spotify, el redirect registrado es `http://127.0.0.1:8089/oauth/spotify/callback`; Spotify no permite `localhost`. El código se canjea con autenticación Basic del cliente confidencial, sin scopes de música ni flujo Client Credentials. La sesión de estado dura treinta minutos desde crear el enlace; el código de Spotify vence diez minutos después de autorizar, y Spotify valida esa vigencia. Se corrigió la confusión entre ambos tiempos y se verificó un canje real exitoso. La sesión privada de Spotify se eliminó al completarlo; no reutilices el callback consumido.

**Puntos prioritarios de auditoría y mejora**

1. Contrastar versiones, endpoints, tipos, campos de métricas, permisos y paginación con documentación oficial actual. Validar fixtures contra esos contratos y añadir pruebas de comportamientos que puedan estar mal implementados, no pruebas que solo reproduzcan el código.
2. Revisar normalización y conciliación financiera: moneda sin conversión implícita, micros solo donde corresponda, UTC frente a zona de cuenta, días inclusivos, hora cero, fracciones, valores nulos frente a ceros reales, dimensiones y periodos duplicados. No agregar monedas o zonas distintas sin reglas explícitas.
3. Revisar conversiones solapadas y elección del evento principal. Google usa sus métricas documentadas; Meta necesita una acción principal explícita; TikTok usa por defecto `conversion`; Microsoft usa `ConversionsQualified` y conserva objetivos secundarios; Spotify requiere elegir un evento. Estos conceptos no son equivalentes automáticamente entre plataformas.
4. En Spotify, `SPEND` ya es moneda, no micros. Los cuartiles incluyen audio y video, por lo que no se asignan a `video_25/50/75/100`. `REVENUE` combina compras y leads y permanece en `raw_metrics`; no se duplica como valor de cada conversión. Rangos diarios en bloques de 90 días; horarios solo últimas dos semanas; continuación con el token como único parámetro. Auditar estas decisiones y los límites con casos reales cuando haya acceso.
5. Revisar seguridad y resiliencia: saneamiento de mensajes, redacción de logs, destinos fijos, redirecciones, SSRF en descargas de Microsoft, límites de JSON/ZIP/CSV, errores de parseo, reintentos anidados, cuotas, expiración de cachés, estado `connected`, concurrencia de renovación, cancelación compartida y resultados parciales. Un status o una respuesta vacía no prueba acceso a informes ni corrección de sus métricas.
6. Revisar autorización interna: las llaves de API actuales permiten consultar la API y los filtros/mapeos de clientes no constituyen aislamiento entre clientes. Antes de uso multicliente, decidir y verificar controles de acceso, no asumir que ya existen.
7. Resolver primero los bloqueos externos: habilitación de Spotify, aprobación/credenciales de TikTok y descarga de Microsoft por la ruta de red soportada. No desactivar TLS ni eludir el proxy. Después hacer lecturas acotadas y conciliar gasto, impresiones, conversiones y moneda con las interfaces publicitarias usando el mismo periodo y criterio de atribución.
8. Revisar Docker/CI y preparación para producción. No se ha validado el despliegue ni el flujo completo hacia dashboard, n8n, BigQuery o alertas. `src/repositories/performance.repository.ts` es una base de contrato para persistencia; no se debe asumir almacenamiento histórico funcionando. Planificar X Ads después de estabilizar las integraciones actuales.

Necesito como resultado: lista priorizada de defectos confirmados y riesgos por verificar; correcciones con diff y pruebas relevantes; matriz final por plataforma separando simulador, OAuth, cuentas, campañas e informes reales; documentación corregida; y un plan de pendientes indicando qué requiere código, permisos, configuración o decisión de negocio. Preserva los archivos y credenciales existentes y no declares el proyecto completamente listo mientras esos puntos sigan sin comprobarse.
