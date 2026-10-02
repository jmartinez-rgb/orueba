# Nexus: consultas sobre campañas y uso del monitoreo

Nexus se abre desde el botón flotante en el monitoreo interno. Consulta la marca seleccionada
y muestra la fecha, hora de corte, zona horaria y enlaces que respaldan cada respuesta.
Es una primera versión de chat con búsqueda y respuestas locales: no utiliza un modelo
generativo ni requiere nuevas claves. No ejecuta acciones sobre registros o plataformas.

Ejemplos:

- «¿Cómo uso el monitoreo?»
- «¿Cómo delego un incidente?»
- «¿Qué campañas hay en Google?»
- «Campaña» seguido del nombre o ID de la campaña.
- «¿Cuánto gastó Google?»
- «¿Qué alertas hay?»
- «¿Los datos están actualizados?»
- «¿Cómo se calcula el CPA?» o «¿Dónde capturo el tipo de cambio?»

Las consultas de rendimiento corresponden al corte actual. Para otro día o un periodo, utiliza
Histórico o Comparar. Si varias campañas coinciden, Nexus pide identificar una y presenta
opciones; un estado activo en el catálogo no demuestra que esté entregando actualmente.

Los importes de gasto usan la conversión del monitoreo a MXN. Solo se suman cuentas con la
métrica disponible y la misma hora de corte. Una cuenta faltante impide presentar el subtotal
como total. Datos atrasados o parciales conservan su advertencia. No se ofrecen conversiones
de negocio, ventas o CPA numéricos mientras no estén confirmados sus eventos y cobertura.
Nexus sí explica las reglas existentes de Meta, Google y CPA sin decidir eventos pendientes.

El servidor exige sesión y `internal:view`, verifica las marcas autorizadas y descarta una
consulta si otra pestaña cambió la marca. La conversación se limpia al cambiar de marca.
Los clientes no reciben Nexus en esta versión. La proyección que utiliza no contiene notas,
responsables, contactos, destinatarios ni configuración privada.

Cada pregunta admite hasta 500 caracteres; el cuerpo está limitado a 4096 bytes. El límite de
12 consultas por minuto e identidad protege cada proceso, sin prometer un límite distribuido.
El panel guarda las últimas ocho consultas únicamente en memoria del navegador: no hay
historial persistente ni registro de preguntas en el servidor. Ofrece cancelación, espera
máxima de 30 segundos y reintento cuando falla una consulta. Enter envía; Shift+Enter añade
un salto de línea. Escape cierra el panel y devuelve el foco al botón Nexus.

Implementación: `src/app/api/nexus/route.ts`, `src/lib/nexus/` y `src/components/nexus/`.
Las pruebas cubren acceso, marca, ausencia de datos, ventanas distintas, ambigüedad de campañas,
reglas de negocio, límites y fallos sin detalles privados. La revisión UX incluye teclado,
móvil y errores de conexión; no constituye una certificación de accesibilidad.
