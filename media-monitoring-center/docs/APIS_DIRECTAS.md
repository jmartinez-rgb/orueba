# APIs directas y almacenamiento del monitoreo

Continuación del **2 de octubre de 2026 UTC**, rama `codex/finalizacion-verificador-meta-x`.
El usuario eligió APIs directas para v1. Se implementó `DATA_SOURCE=unified` para consumir
catálogo, gasto, impresiones y clics de `unified-ads-api`. No se publicó ni desplegó.

```text
APIs publicitarias → unified-ads-api (OAuth privado) → unified:sync
                    → particiones privadas por marca/cuenta/fecha → motor y páginas Next.js
```

Las páginas leen archivos guardados: navegar no dispara extracciones de rendimiento. Los paneles
de conexión y presupuestos vigentes conservan sus consultas existentes a la API. Las credenciales
de cada plataforma siguen exclusivamente en el servidor de la API; Next.js usa su llave interna.

## Configuración local

En `unified-ads-api/.env`, conservar las credenciales vigentes y definir `PORT=8088`,
`HOST=127.0.0.1` y `TOKEN_STORE_FILE` en una ruta privada persistente. En este entorno se reutiliza
el `.env` privado para conservar rotaciones. No copiar valores al chat o al repositorio.
Iniciar la API desde su carpeta con `npm run dev` o, después del build, `npm start`.

En `media-monitoring-center/.env.local`, configurar:

```dotenv
DATA_SOURCE=unified
USE_MOCK_DATA=false
APP_TIMEZONE=America/Mexico_City
UNIFIED_ADS_API_URL=http://127.0.0.1:8088
# UNIFIED_ADS_API_KEY: una llave interna ya autorizada en API_KEYS; guardar privadamente.
UNIFIED_ADS_DATA_DIR=.data/unified
UNIFIED_ADS_MAPPING_FILE=config/unified.mapping.example.json
RECORDS_BACKEND=file
RECORDS_DIR=.data/records
```

El mapeo exige `{version:1, accounts:[{platform,accountId,brand,currency}]}`. `accountId` siempre
es texto; `brand` es `izzi` o `sky`; monedas admitidas: MXN y USD. Una misma cuenta no puede
asignarse a dos marcas. Se admite `UNIFIED_ADS_MAPPING` como alternativa JSON al archivo.
Un error de configuración detiene esta fuente: **no se reemplaza por mock**.

El mapeo incorpora las **31 cuentas indicadas por el usuario: 25 izzi y seis Sky**. Incluye nueve
Google, 15 Meta, cuatro TikTok, una Microsoft, una Spotify y **solo X `18ce53wx5ui` de izzi**.
Sky Sports pertenece a Sky; `izzi - Sky Social` pertenece a izzi. Los IDs se conservan como texto.
El número de Microsoft `F107U5WL` se resolvió mediante la API al ID `138689064`, sin inferirlo
por nombre. Se verificaron 26 monedas MXN y cinco USD. Las cuentas descubiertas adicionales
no se incorporan al monitoreo. Las tasas mensuales se capturan en [Tipo de cambio](TIPO_DE_CAMBIO.md).
El motor, los presupuestos vigentes y los filtros usan la marca explícita. IDs internos:
`plataforma:cuenta` y `plataforma:cuenta:campaña`; usar estos IDs en ajustes manuales.

```bash
cd media-monitoring-center
npm run unified:sync -- --provider tiktok --from 2026-09-25 --to 2026-10-01 --granularity both
npm run unified:sync -- --provider tiktok --from 2026-08-28 --to 2026-09-24 --granularity both
npm run unified:sync -- --provider x --from 2026-09-27 --to 2026-09-29 --granularity daily
npm run dev
```

Estos tres rangos ya fueron extraídos aquí; no repetirlos para arrancar. Sin opciones, la
extracción consulta hoy (fechas del reporte de cada plataforma), diaria y horaria. Hasta 45 días
por ejecución, bloques de tres días, máximo 100 cuentas y 100.000 filas/25 MiB por respuesta.
Una plataforma puede dividir internamente esos bloques según sus límites. Los trabajos son
secuenciales; no se programó un cron ni se activaron webhooks o mensajes externos.

Salida **0**: todas las operaciones solicitadas exitosas y con filas. **2**: alguna operación
fallida o vacía (un histórico sin actividad sigue siendo válido). **1**: opciones/configuración,
escritura o bloqueo del trabajo. La salida incluye solo cuentas, estado, cantidades y códigos.
Ante `API_RATE_LIMITED`, respetar el límite del proveedor; no regenerar credenciales por eso.

## Histórico y señales de datos

- Catálogo, particiones e intentos son JSON privados 0600 en directorios 0700, fuera de Git.
  Escritura temporal, `fsync` y `rename`: un fallo conserva la partición anterior. La lectura
  valida nuevamente marca, moneda, plataforma, fecha y granularidad. Un bloque fallido no borra
  días válidos anteriores; bloques previos exitosos pueden quedar guardados.
- `.sync-lock` evita dos extracciones simultáneas en el mismo volumen. Después de un proceso
  interrumpido, comprobar que ningún trabajo sigue vivo antes de retirar un bloqueo huérfano.
- Solo se conservan las métricas admitidas y el offset horario de X. Se descartan payloads crudos,
  mensajes del proveedor, valores OAuth, cabeceras y URLs firmadas. Los registros operativos
  viven en otro directorio; errores de archivo o Blobs no se disfrazan de éxito en memoria.
- Una respuesta parcial se rechaza salvo advertencias explícitas que no afectan gasto,
  impresiones o clics: acción principal sin elegir; alcance/frecuencia/conversiones externas por
  hora de Meta; ingresos/conversiones desconocidos de Spotify. La excepción exige el proveedor
  y alcance esperados. Un `ACCESS_DENIED` del descubrimiento Google sobre otra cuenta explícita
  solo se admite si la seleccionada está presente. Errores sin alcance, cuotas, advertencias
  genéricas y datos provisionales de Microsoft siguen bloqueando la carga.
  Entidades ajenas, monedas distintas, duplicados y fechas inválidas se rechazan.
- No se rellenan filas ni horas ausentes con cero. Un día vacío no equivale a gasto cero. Las
  ventanas horarias incompletas y los totales con costos desconocidos quedan sin valor; los
  chequeos señalan horas faltantes. El mapa de calor tampoco inventa ceros.
- Se excluyen horas abiertas, futuras o que aún no estaban completas al extraer. Las filas
  horarias se convierten de su zona/offset al reloj de México. Un día agregado en UTC no se
  acepta como día mexicano: `DAILY_TIMEZONE_MISMATCH`. Para Spotify/Microsoft, usar horas reales
  y conciliar el reloj antes de ampliar la ingesta diaria.
- La frescura procede del fin de la última hora recibida, no de la hora de ejecutar un backfill.
  Las cuentas atrasadas/vacías se muestran por separado. Cargar 35 días no garantiza cuatro
  muestras completas para cada campaña ni resuelve una campaña que inició recientemente.
- USD se conserva en el histórico original y se convierte con tasas mensuales de Settings.
  Sin tasa, costo desconocido: no se publica solo el componente MXN como total completo. Un
  presupuesto diario/lifetime del proveedor no se transforma en presupuesto mensual autorizado.
  El gasto mensual o forecast incompletos también permanecen sin valor, con aviso.

No se importan conversiones, ventas ni ingresos a partir del evento de optimización por defecto.
Su mapeo requiere las decisiones de negocio ya documentadas. CPA permanece pendiente cuando
falta la acción principal; después deberá ser suma de costo / suma de conversiones.

## Lecturas reales de esta continuación

| Cuenta | Marca | Moneda | Filas diarias | Filas horarias |
| --- | --- | --- | ---: | ---: |
| TikTok `7338571937913978882` | Sky | MXN | 366 | 2886 |
| TikTok `7545502925565771792` | Sky | MXN | 138 | 2088 |
| TikTok `7361545670072909840` | izzi | MXN | 516 | 5431 |
| TikTok `7688066712031182866` | izzi | USD | 2 | 27 |
| X `18ce53wx5ui` | izzi | MXN | 3828 | Pendiente: límite de solicitudes |

TikTok: **28 de agosto–1 de octubre**, 35 días, cuatro cuentas/178 campañas, **1022 filas diarias
y 10432 horarias**. La primera semana (25 de septiembre–1 de octubre) produjo 177/1626 filas,
salida 0; el backfill de 28 días produjo 845/8806 filas y salida 2 por las dos operaciones válidas
sin filas de la cuenta US. El 1 de octubre está abierto y su agregado diario no se usa como día
cerrado. La cuenta US ahora tiene actividad; su muestra anterior vacía no se convierte en ceros.

[evidence/tiktok-direct-2026-08-28_10-01.csv](evidence/tiktok-direct-2026-08-28_10-01.csv) conserva
280 totales cuenta/fecha/granularidad, con moneda original y vacíos explícitos. No sumar monedas
ni granularidades. Las revisiones de atribución pueden cambiar cifras extraídas en otro momento;
el CSV no reemplaza conciliación con Ads Manager. El riesgo de `total_complete_payment_rate`
sigue abierto; esta fuente no importa ese campo como ingresos.

X: **27–29 de septiembre**, catálogo completo de 1276 campañas de izzi, 3828 filas guardadas,
salida 0 para gasto/impresiones/clics. El intento horario del 1 de octubre falló; una comprobación
acotada posterior respondió **HTTP 429 RATE_LIMITED**. No se acreditan horas, informe asíncrono,
conversiones ni histórico de cuatro semanas para X. No hubo consultas nuevas a las cuentas X de
Sky para importarlas al monitoreo.

Prueba manual del motor con archivos reales, por marca: catálogos y métricas de TikTok se leen
sin cruzar cuentas; eventos de negocio siguen desconocidos y falta la tasa USD. Es una prueba
local del adaptador, no aceptación visual de producción ni conciliación de cifras.

## Pendientes para v1

1. Configurar cuentas individuales (`AUTH_SECRET`, `AUTH_USERS`) y probar roles/marcas en el
   entorno destino. Hay 15 cuentas configuradas y comprobadas localmente; producción permanece
   bloqueada si faltan. No trasladar contraseñas al repositorio.
2. Confirmar IDs por marca de Google, Meta, Microsoft y Spotify. Mantener X de Sky fuera.
3. Conciliar días/horas, atribución, ausencia de filas y tipos de cambio contra las plataformas.
4. Recuperar extracción horaria e histórico de X después del límite de solicitudes. Microsoft
   mantiene `proxy_denied` al ZIP; una cuenta USD de Spotify sigue sin permiso de reportes.
5. Definir eventos de negocio: Meta por cuenta/campaña; Spotify/TikTok; Google offline válidos.
6. Elegir almacenamiento durable compartido y scheduler para producción. El volumen de archivos
   funciona en este entorno; **no es compatible con disco efímero de Netlify Functions**. Un
   despliegue sin volumen requiere otro backend de métricas. No usar credenciales API en el navegador.
7. Los archivos se guardan atómicamente, pero operaciones de registros que leen/modifican/escriben
   contadores o listas todavía necesitan control de concurrencia para varias instancias.

Validación y aceptación: [V1.md](V1.md). Matriz por plataforma y reglas de negocio:
[AUDITORIA.md](../../unified-ads-api/docs/AUDITORIA.md). No se declara terminado el proyecto.

## Actualización incremental

`unified:refresh` relee hoy y los dos días anteriores por cuenta, con cooldown persistido y
backoff de fallos. [Comandos, límites y operación](ACTUALIZACION_DIRECTA.md). El worker local
está implementado; su activación y evaluación desatendida en producción siguen pendientes.
