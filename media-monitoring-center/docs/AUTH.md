# Acceso, usuarios y bitácora

El Monitoring Center es **solo de monitoreo**: ningún rol puede modificar campañas, presupuestos
ni configuraciones en Google, Meta, TikTok, Microsoft, Spotify o X. Los permisos de escritura solo
cambian datos internos de la app (umbrales, notas, tickets, métricas a vigilar…).

## Cómo se entra

Página `/login`. Todo lo demás (páginas y `/api/*`) exige sesión, salvo `/api/health` y
`/api/monitoring/evaluate` (este último protegido con `MONITORING_API_KEY` para n8n).

| Tipo de acceso | Usuario | Contraseña | Rol |
|---|---|---|---|
| Cuenta nominal | `jmartinez` | propia | Administrador |
| Cuenta nominal | `operaciones` | propia | Co-administrador |
| Cuentas creadas en la app | el que asigne el administrador (p. ej. `alopez`) | la que asigne el administrador | el rol y permisos que elija |
| Contraseña universal | Nombre y apellido de la persona (p. ej. `Ana López`) | la universal | Consulta (o Paid Media Manager si se configura) |

Nada de esto usa Google: las cuentas, contraseñas y permisos viven en la app (Netlify Blobs) y,
como respaldo, en las variables de Netlify.

- Cada persona recibe un **avatar blobatar** generado a partir de su nombre, visible en el menú, en
  Usuarios, en tickets y en acuses.
- La contraseña universal **no** sirve para entrar como una cuenta nominal ni con el nombre de una
  de ellas.
- Tras **5 intentos fallidos en 10 minutos** el acceso (IP + usuario) se bloquea 10 minutos. El
  contador vive en la memoria de cada instancia del servidor: es una defensa básica, no reemplaza
  una contraseña larga.
- La sesión es una cookie `immc_session` (httpOnly, `SameSite=Lax`, `Secure` en producción) firmada
  con HMAC-SHA256 y `AUTH_SECRET`. Dura `AUTH_SESSION_HOURS` (12 h por defecto). No contiene
  secretos: usuario, nombre visible, rol y vencimiento.

## Roles

| Permiso | Administrador | Co-administrador | Paid Media Manager | Consulta |
|---|:-:|:-:|:-:|:-:|
| Ver todo el monitoreo | ✅ | ✅ | ✅ | ✅ |
| Acusar alertas críticas, levantar tickets, generar el mensaje de Monitoreos | ✅ | ✅ | ✅ | ✅ |
| Cambiar estado de alertas e incidentes, ejecutar evaluación manual, ver detalles técnicos | ✅ | ✅ | ✅ | — |
| Gestionar tickets (estado, responsable, número de caso) | ✅ | ✅ | ✅ | — |
| Settings, métricas monitoreadas, métricas fijas, tipo de cambio, clasificadores, nivel de presupuesto | ✅ | ✅ | — | — |
| Usuarios y bitácora de accesos | ✅ | ✅ | — | — |
| Enviar bugs y sugerencias | ✅ | ✅ | ✅ | ✅ |
| Bandeja de bugs y sugerencias (ver todos, estado y respuesta) | ✅ | — | — | — |
| Usuarios y contraseñas (crear cuentas, asignar contraseñas, roles, permisos y marcas) | ✅ | — | — | — |

Los roles son el punto de partida: a cada persona se le pueden dar **permisos personalizados**
(cualquier combinación de los de arriba) y limitar las **marcas** que ve (izzi, Sky o ambas).

## Cuentas, contraseñas y permisos desde la app

Sección **Usuarios → Cuentas, contraseñas y permisos** (solo quien tiene el permiso *Usuarios y
contraseñas*; de inicio, el administrador):

- **Nueva cuenta**: nombre, usuario (se sugiere a partir del nombre), rol, marcas que puede ver y
  permisos (los del rol o personalizados). La contraseña inicial se genera sola (`Mmc-XXXX-XXXX-XXXX`)
  o se escribe; se muestra **una sola vez** para copiarla y compartirla por un canal seguro.
- **Asignar contraseña** a cualquier cuenta, incluidas `jmartinez` y `operaciones`: la nueva
  contraseña aplica de inmediato y **cierra las sesiones abiertas** de esa persona.
- **Editar** rol, permisos y marcas (aplica desde la siguiente página que abra la persona),
  **desactivar/activar** (desactivar cierra sus sesiones) y **eliminar**.
- **Contraseña universal**: activarla o desactivarla, cambiarla, elegir su rol (Consulta o Paid
  Media Manager, nunca administrador) y sus marcas. Cambiarla cierra las sesiones abiertas con la
  anterior.
- Cada persona puede **cambiar su propia contraseña** desde su menú (*Cambiar mi contraseña*).

Reglas de seguridad:

- Contraseñas de al menos 10 caracteres con letras y números; se guardan en hash scrypt y nadie
  puede verlas después.
- Nadie puede dar permisos que no tiene, ni cambiar su propio rol, permisos o estado, ni borrarse.
- Siempre queda al menos una cuenta activa que pueda administrar usuarios.
- Todo queda en la bitácora (cuenta creada, modificada, eliminada, contraseña cambiada).

Cuentas de Netlify (`AUTH_USERS`): siguen funcionando como **respaldo**. Si una cuenta existe en
ambos lados manda la de la app; al eliminarla en la app vuelve a la de Netlify. Mantén al menos al
administrador en `AUTH_USERS` para no quedarte sin acceso si se borrara el almacén de la app.

## Configuración (variables de entorno)

Los valores reales **solo** van en `.env.local` (local) y en Netlify (producción). Nunca en el
repositorio.

| Variable | Qué es |
|---|---|
| `AUTH_SECRET` | Firma de sesiones, 32+ caracteres aleatorios. Secreta |
| `AUTH_USERS` | JSON en una línea con las cuentas: `[{"u":"jmartinez","n":"J. Martínez","r":"admin","h":"scrypt:…"}]` |
| `AUTH_UNIVERSAL_PASSWORD_HASH` | Hash de la contraseña universal |
| `AUTH_UNIVERSAL_ROLE` | `viewer` (default) o `manager`. Nunca admin |
| `AUTH_SESSION_HOURS` | Duración de la sesión (default 12, máximo 336) |
| `AUTH_MODE` | Vacío = automático (recomendado). `open` = sin contraseña (solo demo local). `header` = identidad desde un proxy/SSO |
| `AUTH_DEFAULT_ROLE` | Rol en modo abierto (default `admin`) |

Modo automático:

- `AUTH_SECRET` válido + al menos una credencial → **pide contraseña**.
- Sin configurar, en local (`npm run dev`) → **modo abierto** con aviso en pantalla y selector de rol.
- Sin configurar, en producción → **bloqueado**: el login explica qué variables faltan.
- El valor `AUTH_MODE=dev` de la primera versión cuenta como automático (nunca apaga contraseñas).

Las contraseñas se guardan como hash **scrypt** (`scrypt:N:r:p:sal:hash`, sin `$` para que
dotenv no lo altere). La app nunca guarda ni registra contraseñas en claro.

### Generar las contraseñas

```bash
npm run auth:setup              # imprime contraseñas nuevas + variables (no escribe nada)
npm run auth:setup -- --write   # además guarda las variables en .env.local
```

Crea `jmartinez` (Administrador), `operaciones` (Co-administrador) y la contraseña universal, con
contraseñas aleatorias sin caracteres ambiguos (`Izzi-XXXX-XXXX-XXXX`). Se muestran **una sola vez**:
compártelas por un canal seguro. Es la configuración inicial; después, las demás cuentas y cambios
de contraseña se hacen desde la app (sección anterior).

En Netlify: *Site configuration → Environment variables* → agrega cada variable (el valor de
`AUTH_USERS` se pega tal cual, sin comillas) → marca `AUTH_SECRET` como secreta → *Deploys →
Trigger deploy*.

### Cambiar una contraseña o agregar una cuenta

```bash
npm run auth:hash -- "NuevaContraseñaLarga"   # imprime el hash scrypt
```

Lo más simple es hacerlo desde la app (Usuarios → Asignar contraseña). Si prefieres Netlify:
reemplaza el `h` de esa cuenta en `AUTH_USERS` (o agrega un objeto nuevo con `u`, `n`, `r`, `h`),
o reemplaza `AUTH_UNIVERSAL_PASSWORD_HASH`, y vuelve a desplegar. Usuario: 3 a 40 caracteres
`a-z 0-9 . _ -`. Roles: `admin`, `coadmin`, `manager`, `viewer`.

**Cerrar todas las sesiones**: cambia `AUTH_SECRET` y despliega (todas las cookies dejan de ser
válidas). Hazlo también si alguien sale del equipo y conocía la contraseña universal, junto con
una contraseña universal nueva.

### Modo `header` (SSO)

Con `AUTH_MODE=header` la identidad llega en las cabeceras `x-immc-user`, `x-immc-role` y
`x-immc-email`. Úsalo **solo** detrás de un proxy de identidad que borre y reescriba esas
cabeceras: si el sitio es accesible directamente, cualquiera podría enviarlas.

## Registro de quién entra y qué hace

Cada evento queda en la bitácora (sección **Usuarios**, solo administradores y co-administradores):

- Inicio y cierre de sesión, intentos fallidos y bloqueos.
- Acuses de alertas críticas (texto escrito, a quién se reporta y por qué canal).
- Tickets creados y actualizados, mensajes de monitoreo guardados.
- Cambios de configuración, estados de alertas e incidentes, presupuestos de referencia y
  evaluaciones manuales.

Por evento se guarda: fecha, persona, rol, tipo de acceso, IP **enmascarada** (`189.203.45.x`) y un
resumen del navegador (`Chrome · macOS`). Usuarios muestra también la presencia (quién está
activo) y el último acceso de cada persona.

### Dónde se guardan

| Entorno | Almacenamiento |
|---|---|
| Netlify | **Netlify Blobs** (store `immc-records`, consistencia fuerte). No requiere configuración |
| Local | Archivos JSON en `.data/records` (ignorado por git) |
| Pruebas | Memoria |

`RECORDS_BACKEND=blobs|file|memory` y `RECORDS_DIR` permiten forzarlo. Estos registros no son
métricas: las métricas viven solo en BigQuery y nunca se copian aquí.

## Bugs y sugerencias

Sección **Bugs y sugerencias** (`/sugerencias`, también desde el menú de usuario → *Reportar bug
o sugerencia*, que guarda la sección desde donde se abrió). Cualquier persona con sesión envía un
bug o una sugerencia (título, descripción, sección e impacto); recibe un folio `FB-0001`.

- **Solo el administrador** ve la bandeja completa, cambia el estado (Nuevo → En revisión → En
  proceso → Resuelto / Descartado), responde y exporta a CSV. El menú le muestra cuántos hay nuevos.
- Cada persona ve únicamente **sus propios envíos**, con su estado y la respuesta del administrador.
- El co-administrador no ve la bandeja (permiso `feedback:manage`, solo del rol administrador).
- Envíos y cambios quedan en la bitácora. Límite: 30 envíos por persona al día.

## Alerta crítica a pantalla completa

Cuando hay un incidente **crítico** abierto que la persona no ha acusado, aparece una alerta a
pantalla completa que no se puede cerrar hasta que escribe qué revisó (mínimo 20 caracteres), a
quién lo va a reportar y por qué canal, y confirma. Un solo acuse cubre todos los críticos
pendientes; puede crear un ticket con el historial. Cada persona acusa por su cuenta y el acuse
queda en la bitácora. Si el problema vuelve después de resolverse (incidente nuevo), se vuelve a pedir.

## Continuación de acceso nominal y atención

Ver [ACCESOS_NOMINALES.md](ACCESOS_NOMINALES.md): administrador principal protegido,
lista nominal de cinco responsables, delegación por ID y clientes en modo lectura.
La configuración local tiene 15 cuentas; no certifica configuración de producción.
