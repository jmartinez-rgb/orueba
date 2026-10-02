# Cuentas nominales y delegación de alertas

Validación local del 2 de octubre de 2026 UTC (1 de octubre, Bogotá). No es una publicación ni
aceptación de producción. Las identidades y credenciales reales viven solo en archivos privados.

## Política configurada

- Administrador principal: todos los permisos y ambas marcas. `AUTH_PRIMARY_ADMIN_ID` protege
  su cuenta: ningún otro administrador puede editarla o eliminarla. Tampoco puede eliminarse a
  sí mismo ni cambiar su propio rol/estado. Puede cambiar su contraseña y administrar al equipo.
- Segundo administrador: administración y ambas marcas; atención de alertas según la lista nominal.
- Subadministrador (`coadmin`): configuración y delegación, sin gestión de cuentas/contraseñas.
- Operativos (`manager`): atención y seguimiento; no reasignan responsables.
- Clientes (`client`): resumen de ambas marcas y alertas públicas de lectura. Sin notas, responsables,
  tickets, datos de acceso ni formularios operativos. Los títulos de jefatura no otorgan permisos internos.
- Consulta administrativa limitada de Operations: permisos operativos de base y lectura de accesos
  y auditoría. La política nominal restringe su atención de alertas.

La configuración local contiene **15 cuentas**, todas con acceso a izzi y Sky. Solo las **cinco
identidades autorizadas** atienden alertas. Este permiso depende del ID de usuario, nunca de que
su correo pertenezca a ABCW. Los demás ven las alertas sin poder escribir, incluso si administran
otras secciones. El principal conserva todos los permisos aunque no aparezca en esa lista.

`ALERT_RESPONDER_USER_IDS` define la lista privada; si se omite, se conserva la política por rol
heredada. Una lista vacía restringe la atención a todos salvo al administrador principal. Su efecto
incluye notas, estados, acuses, tickets, novedades, mensajes manuales y evaluaciones operativas.
Los permisos se vuelven a consultar en el servidor; ocultar botones no sustituye la autorización.

## Acceso inicial y contraseñas

Desde `media-monitoring-center/`, únicamente en un entorno sin cuentas configuradas:

```bash
npm run auth:bootstrap -- --roster .data/access/roster.json --responders usuario1,usuario2 --primary-admin usuario1
```

El roster privado contiene `username`, `name`, `email`, `role`, `brands` y opcionalmente
`permissions`. `brands: []` significa ambas. Se rechazan IDs/correos duplicados. Cada persona
puede iniciar sesión con usuario o correo; Santiago Tamayo tiene su identidad individual.

El comando genera contraseñas aleatorias y hashes scrypt. Guarda hashes y secreto de sesión en
`.env.local` y contraseñas iniciales en `.data/access/initial-credentials.json`: archivos **0600**,
ignorados por Git, escritos mediante temporal y renombrado atómico. No imprime contraseñas,
hashes ni secretos, y se niega a sobrescribir una instalación existente. No ejecutar bootstrap
concurrentemente. El archivo inicial deja de representar la contraseña vigente cuando se cambia.

El administrador entrega cada acceso individual por un canal privado y solicita cambiar la
contraseña. La aplicación no envía correos ni entrega esas contraseñas públicamente. La gestión
posterior se realiza en **Usuarios y accesos**; nunca copiar `.env` ni el archivo de entrega al Git.
El entorno destino requiere su configuración privada y almacenamiento durable; los archivos
locales no prueban que esté configurado.

## Delegación y seguimiento

En **Incidentes**, abre una alerta vinculada a un incidente. Principal/subadministrador eligen
un responsable activo de la misma marca en la lista nominal. El servidor deriva el nombre del
ID y rechaza nombres libres, usuarios desactivados, clientes o usuarios sin atención autorizada.
**Mis pendientes** filtra por identidad; **Sin delegar** muestra los incidentes sin responsable.
El operativo registra notas y estados; **Resolver con nota** exige documentación del cierre.
Cada asignación conserva responsable, ID, actor y fecha. Los registros quedan separados por
marca. Alertas agrupadas se atienden mediante su incidente principal, sin duplicar casos.

Los demás pueden leer, pero no editar ni acusar alertas. Cliente recibe categorías generales,
severidad y fecha; no recibe diagnósticos internos, IDs de campaña, responsables o notas.

## Evidencia local y límites

- `npm run check`: tipos, lint y pruebas; incluye autorización en API, administrador principal,
  asignación por marca, persistencia de notas/cierre y deduplicación al reconstruir el estado.
- `npm run build`: build de producción comprobado. Reinicio local y nuevo login del principal,
  cambio de marca izzi/Sky, snapshot y página de Usuarios verificados después del reinicio.
- HTTP local: **15 accesos por correo**, **15 comprobaciones de escritura**, cinco responsables
  elegibles, denegación de edición/eliminación del principal a otro administrador; tres páginas y
  snapshot comprobados. Archivo de contraseñas no servido públicamente ni presente en el HTML.
- `npm run v1:check -- --sin-red --registros`: cuatro grupos configurados y
  `RECORD_IO_VERIFIED`. Salida **2 esperada** porque no comprueba proveedores externos.

El backend de archivos pasó una prueba de escritura/lectura/eliminación y pruebas de reapertura.
No certifica disco durable entre máquinas ni concurrencia transaccional de varias instancias.
Ninguna notificación externa se activó para esta validación local. La conciliación de métricas,
permisos externos pendientes y aceptación del equipo siguen en [V1.md](V1.md).
