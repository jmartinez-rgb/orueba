# Auditoría de Google Ads cuenta por cuenta

Herramienta de diagnóstico **de solo lectura** para las cuentas de Google Ads de izzi y Sky. Lee cada
cuenta con la API (v25), aplica criterios conservadores y entrega un informe con el formato acordado:
22 secciones por cuenta, en orden de prioridad, y un resumen general al final.

No modifica campañas, presupuestos, pujas, conversiones, anuncios, assets, audiencias, keywords,
negativas, URLs, experimentos ni objetivos. Solo usa `googleAds:search` (consultas `SELECT`) y, si no
se desactiva, una petición `GET` sin cookies a cada página de destino para detectar errores 4xx/5xx.

## Cómo correrla

Requiere las variables de Google del `.env` (las mismas que usa la API: `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` del MCC y, si
aplica, `GOOGLE_ADS_DEVELOPER_TOKEN`). Si falta alguna, el comando lo dice sin mostrar valores.

```bash
npm run google:auditoria                                    # las 8 cuentas, hasta ayer
npm run google:auditoria -- --cuentas 877-953-6058,621-410-9105
npm run google:auditoria -- --hasta 2026-09-30 --sin-urls
```

Deja en `reportes/` (fuera de git, permisos 0600):

- `auditoria-google-ads-<fecha>.md`: informe completo para leer o compartir.
- `auditoria-google-ads-<fecha>.xlsx`: evidencia filtrable (Resumen, Hallazgos, Campañas, Tendencia,
  Términos candidatos, RSA, Conversiones, Geografía, Cambios, Recomendaciones Google, No tocar, URLs,
  Sin datos).

Cuentas y orden (máxima prioridad primero): Performance AO (877-953-6058), Performance AO 2
(621-410-9105), Ofertas (736-792-8294), Paquetes 2do Dominio (322-485-0043); después Apple TV
(811-057-1939), campañas (777-162-9164), Universal+ (453-628-2576) y Sky ABCW (197-084-2746).

Si una cuenta no está vinculada al MCC o el usuario no tiene acceso, aparece como "Sin lectura" con el
código de Google y no se emiten recomendaciones para ella. Si una consulta concreta falla, esa sección
queda marcada como "sin datos" y el resto continúa; autenticación inválida o proyecto sin aprobación
detienen la ejecución.

## Qué lee (por cuenta)

| Área                         | Lectura                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado y estructura          | Cuenta (moneda, zona, nivel de optimización, etiquetado automático, seguimiento), campañas (estado, estado principal y motivos, tipo, estrategia y su estado, tCPA/tROAS, redes, expansión de URL, presupuesto y recomendado), grupos de anuncios |
| Rendimiento                  | Serie diaria de 90 días por campaña; cuota de impresiones, perdida por presupuesto y ranking en 7/14/30 días y sus periodos previos                                                                                                               |
| Conversiones                 | Acciones (tipo, categoría, primaria, conteo, ventana, atribución, dueño), objetivos de cuenta y por campaña, conversiones por acción y día (90 días)                                                                                              |
| Search                       | Términos de búsqueda (30 días, hasta 10,000 por gasto), keywords con Quality Score y sus componentes, redes (Search, socios, Display)                                                                                                             |
| Creativos y assets           | RSA (títulos, descripciones, fijados, Ad Strength, políticas), assets de cuenta, campaña y grupo (sitelinks, textos destacados, fragmentos, imágenes, logotipo; vigencia y aprobación)                                                            |
| Performance Max              | Grupos de recursos (estado, Ad Strength, URLs), recursos por formato, temas de búsqueda y señales de audiencia, términos de búsqueda de PMax                                                                                                      |
| Demand Gen / Display / Video | Ubicaciones con gasto, frecuencia y usuarios únicos                                                                                                                                                                                               |
| Segmentos                    | Región por ubicación física, dispositivo, día y hora                                                                                                                                                                                              |
| URLs                         | Páginas de destino con gasto, velocidad móvil y revisión HTTP                                                                                                                                                                                     |
| Cambios                      | Historial de los últimos 30 días (límite de Google) con valores antes y después                                                                                                                                                                   |
| Recomendaciones              | Recomendaciones de Google vigentes, clasificadas como Aplicable, Validar o No recomendable                                                                                                                                                        |

Las ventanas son: últimos 7 y 7 previos, 14 y 14 previos, 30 y 30 previos, mes actual contra los mismos
días del mes anterior, mes anterior completo, 90 días y los 30 días previos al 17 de agosto de 2026
(fecha en que Google cambió el comportamiento de tCPA y tROAS).

## Cómo decide

Cada hallazgo trae: cuenta, campaña, evidencia, diagnóstico, acción exacta, pasos, riesgo
(bajo/moderado/alto), prioridad (P0 a P4), confianza (alta/media/baja), impacto esperado, métrica a
vigilar, periodo de observación, rollback y fuentes. Un hallazgo repetible queda asociado a una regla
de monitoreo (RULE-GADS-001 a 010).

Principios aplicados:

- **Primero investigar.** Un deterioro (casos 1 a 10 del encargo) genera una investigación de bajo
  riesgo, no un cambio. Solo se marca como tendencia si aparece en más de una ventana; si depende de
  los últimos días y las conversiones son importaciones offline, la confianza baja por el retraso.
- **Estadística, no intuición.** Caídas de conversiones con prueba de Poisson, CTR y tasa de
  conversión con prueba de proporciones (p < 0.05), y corrección por comparaciones múltiples en
  geografía y horarios. Volumen mínimo: 1,000 impresiones, 100 clics o 10 conversiones en la base.
- **Menor riesgo primero.** Corregir errores, recuperar entrega, completar assets y creativos,
  negativas evidentes; después presupuesto en pasos de 15% con 7 días de observación; después
  pruebas; al final cambios estructurales.
- **No tocar lo reciente.** Si hubo un cambio de presupuesto o puja en los últimos 7 días, o la
  estrategia está en aprendizaje, el ajuste se programa para después de esa ventana.
- **Conversiones son estructurales.** Duplicadas, microconversiones primarias o eventos offline no
  reconocidos se reportan como P0/P4 de alto riesgo para validar con medición; la herramienta no elige
  acciones primarias.
- **Reglas de la cuenta.** CPA = suma de costo ÷ suma de conversiones; ventas = `MCC_Offline_Purchase`;
  eventos offline válidos solo `MCC_Offline_Lead_Contact` y `MCC_Offline_Purchase`; las conversiones
  de la columna Conversiones pueden sumar leads y ventas, por eso el informe muestra ventas y CPA de
  venta por separado.
- **Negativas con alta confianza.** Solo intenciones claramente irrelevantes (empleo: confianza
  alta; soporte de clientes actuales y "gratis/piratería": media) con gasto, sin conversiones, no
  excluidas y que no coinciden con una keyword activa. Competencia y términos ambiguos se listan para
  revisión, sin proponer negativas.
- **Recomendaciones de Google analizadas.** Nunca se asumen; cada tipo tiene un veredicto justificado.

Los umbrales están en `CRITERIA` (`src/providers/google/audit/context.ts`): los de CPA × 1.30 y cuota
perdida por presupuesto > 25% vienen del encargo; el resto son criterios explícitos de auditoría, no
metas de negocio.

## Fuentes

Consultadas el 2026-10-02. Las páginas de ayuda se consultaron mediante búsqueda restringida a dominios
de Google porque el entorno de desarrollo bloquea la salida directa a `support.google.com`; los campos,
enumeraciones y descripciones de métricas se verificaron contra el documento de descubrimiento v25
completo (todas las consultas de la auditoría se validaron campo por campo). La lista con enlaces está
al final de cada informe y en `src/providers/google/audit/sources.ts`.

## Limitaciones conocidas

- La compatibilidad conjunta de algunos campos (por ejemplo, `segments.search_term_match_type` con
  `search_term_view`, o `metrics.speed_score` en `landing_page_view`) no se puede confirmar sin una
  lectura real; cada una tiene una consulta de respaldo más simple.
- Exclusiones de marca y de URL de PMax, listados de productos y Merchant Center no se evalúan (las
  cuentas no usan feed).
- El historial de cambios solo cubre 30 días (límite de la API).
- La revisión HTTP no ejecuta JavaScript: una página que responde 200 pero falla en el navegador no se
  detecta; un 403/429/503 se reporta como "no verificable" para no confundir protección de bots con
  errores.
