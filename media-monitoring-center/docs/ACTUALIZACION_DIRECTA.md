# Actualización acotada del histórico directo

Desde `media-monitoring-center/`, con API local y configuración privada ya preparada:

```bash
npm run unified:refresh -- --provider tiktok
```

Sin `--watch` realiza **una ronda**. Recupera hoy y los dos días anteriores, diario y horario,
únicamente para las cuentas del mapeo explícito. La fecha se calcula en la zona del monitoreo;
la validación de zona/moneda del sincronizador permanece activa. Releer días recientes permite
incorporar ajustes tardíos sin descargar todo el histórico. No modifica campañas ni decide eventos.
El motor sigue excluyendo el día diario abierto y horas abiertas/futuras.

## Intervalo, límites y reanudación

Por defecto, cada cuenta espera **120 minutos** entre rondas. El checkpoint privado en
`.data/unified/.scheduler/` conserva esa espera al reiniciar. Su clave incluye plataforma, ID,
marca y moneda. Un segundo proceso no entra mientras existe `.refresh-lock`; el bloqueo
`.sync-lock` del sincronizador también protege contra cargas manuales simultáneas.

Ante un fallo total o parcial, la espera crece: cuatro horas con el primer fallo, luego ocho,
16 y como máximo 24. Una lectura correcta reinicia el contador. No hay opción para saltar ese
intervalo. Una respuesta vacía válida es `EMPTY`, no cero ficticio ni fallo de autenticación.
El último histórico válido permanece disponible si falla la siguiente carga. Una lectura diaria
correcta con lectura horaria fallida se muestra `PARTIAL`; no se oculta su cobertura incompleta.

El checkpoint se escribe **antes** de consultar la red. Una interrupción no provoca consultas
inmediatas repetidas; un estado corrupto bloquea la operación en vez de borrar el control de cuotas.
No se registran llaves, URLs, errores originales ni cuerpos OAuth. Estado por archivo 0600,
escritura atómica heredada del almacén; los checkpoints no son evidencia de conciliación.
El campo `rows` cuenta filas diarias más horarias procesadas, **no una suma de métricas**.

Para un proceso local explícito:

```bash
npm run unified:refresh -- --provider tiktok --watch
```

Continúa hasta SIGINT/SIGTERM y cancela el transporte en vuelo. Espera hasta la próxima fecha
permitida; no es un cron instalado ni un despliegue. `--interval-minutes` admite 30–1440; no
cambiarlo para eludir las cuotas de plataforma. Omitir `--provider` incluye solo las cuentas ya
mapeadas, nunca las descubiertas sin marca confirmada. X de Sky continúa fuera.

Salida de una ronda: 0 si todo terminó correctamente, vacío válido o aún en espera; 2 si hubo
fallos/éxito parcial; 1 si configuración, bloqueo o checkpoint impiden iniciar. Cada resultado
incluye su código fijo y `nextDueAt`; `WAITING` con un código de error conserva el fallo anterior,
no prueba datos frescos. El comando no activa mensajes externos. Las alertas se evalúan y guardan
al abrir el monitoreo; su ejecución desatendida también necesita una integración autorizada.

## Operación y pendientes

Si un proceso se interrumpe bruscamente, el directorio de bloqueo puede quedar retenido. No se
elimina automáticamente por tiempo: revisar que no siga activo el proceso propietario antes de
recuperarlo. La espera persistida se conserva. El disco debe ser durable/compartido en producción;
este worker local no resuelve disco efímero ni transacciones de varios servidores.

Los IDs y marcas de las 31 cuentas ya fueron indicados por el usuario e incorporados al mapeo.
Microsoft descargó el ZIP y se guardaron 266 filas horarias del 30 de septiembre con datos
completos (`MICROSOFT_ADS_RETURN_ONLY_COMPLETE_DATA=true`). Los diarios UTC se rechazan como
días mexicanos. Spotify de izzi permite el reporte diario UTC; el horario sigue fallando con
`PROVIDER_ERROR`. La cuenta USD de Spotify sin permiso queda fuera del mapeo autorizado.
X necesita disponibilidad de cuota para horas/histórico ampliado. Capturar las tasas en
[Tipo de cambio](TIPO_DE_CAMBIO.md) antes de conciliar consolidaciones MXN.

El proceso no queda activado de forma permanente en esta entrega. Elegir supervisor/scheduler,
credenciales y almacenamiento del entorno destino precede a una propuesta de publicación.

## Validación del 2 de octubre de 2026 UTC

- `npm run check`: **284 pruebas** pasan, incluidos ocho casos de espera tras reinicio,
  rate limit parcial, concurrencia, errores seguros, vacío válido, estado corrupto y cancelación.
- Una ronda real TikTok releyó **755 filas combinadas diarias/horarias** de los tres días recientes
  (29 de septiembre–1 de octubre). Tres cuentas devolvieron filas y la cuarta, izzi US, una
  respuesta vacía válida para ese periodo. No se borró su histórico anterior ni se concilió
  contra Ads Manager. El conteo no representa nuevas filas ni inversión sumada.
- La segunda ronda quedó `WAITING` para las cuatro cuentas; el worker de prueba también
  respetó esa espera y salió con SIGTERM, código 0 y bloqueo liberado. No queda un watch activo.
- Descubrimiento real de cuentas: Meta **17**, Microsoft **4**, Spotify **6**; HTTP 200.
  Un inventario privado de 27 cuentas queda para confirmar marca antes de incorporarlas.
  Google se mantiene pendiente de la lista explícita; no se recorrió otra vez toda su jerarquía.

Los reportes de Microsoft, el permiso de una cuenta Spotify y las horas de X no se han
revalidado en esta ronda. No se cambian sus bloqueos anteriores ni se afirma que ya se resolvieron.
