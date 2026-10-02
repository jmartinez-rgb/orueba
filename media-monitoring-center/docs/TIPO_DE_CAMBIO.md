# Tipo de cambio mensual

Abre **Operación → Tipo de cambio** (`/tipo-de-cambio`). Captura cuántos MXN equivalen a
**1 USD** en la fila del mes y pulsa **Guardar**. Septiembre y octubre de 2026 están disponibles;
no se cargó una tasa por defecto. Las tasas se comparten entre izzi y Sky y se aplican al mes
de la fecha del costo, antes de agregar importes o calcular razones.

- Administradores y coadministradores con `settings:write` pueden editar. Juan Pablo conserva
  el control principal. Operadores y otros perfiles internos sin ese permiso solo consultan.
  Los clientes siguen en su vista restringida.
- La sección muestra las monedas de las cuentas de la marca elegida y señala las correcciones
  manuales del monitoreo si existen. No cambia
  la moneda en las plataformas. El mapeo autorizado contiene **cinco cuentas USD**, todas izzi:
  Google `7771629164`, `8110571939`, `4536282576`; Meta `465392948082619`; TikTok
  `7688066712031182866`. Las demás 26 cuentas son MXN.
- La captura prevalece sobre la tasa de la fuente para el mismo mes. Sin tasa exacta se conserva
  la regla existente de usar la anterior más cercana, señalada como **provisional** y con menor
  confianza. Una tasa futura nunca se usa para un mes anterior. Sin tasa anterior, los costos
  USD convertidos permanecen desconocidos y la consolidación queda pendiente.
- Se aceptan tasas positivas hasta 1000, con captura a cuatro decimales y meses válidos.
  Vaciar el campo y guardar elimina la captura; puede volver a aplicarse una tasa de la fuente
  o una anterior, según la misma regla.
- El almacén configurado conserva la configuración compartida e invalida los cálculos en memoria.
  **Usuarios y accesos → Bitácora de accesos y actividad** registra actor, fecha, mes y valor
  anterior/nuevo al guardar, quitar o restablecer tasas. La bitácora existente es de mejor esfuerzo:
  un fallo al registrar actividad no revierte la configuración; no es un libro financiero transaccional.

La tasa no determina conversiones ni eventos principales. CPA sigue siendo suma de costo /
suma de conversiones, cuando ambas magnitudes estén definidas y conciliadas. La edición general
de moneda/tasas en Settings utiliza la misma configuración.

Validación local: permisos nominales por HTTP, captura y eliminación con fixtures, meses
calendario consecutivos, límites, registro de cambios y correspondencia de la tasa visible con
la usada por la conversión. No se escribieron tasas ficticias en el almacén operativo.
