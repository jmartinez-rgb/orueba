/**
 * Roles y permisos. La app es SOLO DE MONITOREO: ningún permiso modifica campañas,
 * presupuestos ni configuraciones en Google, Meta, TikTok, Microsoft, Spotify o X.
 * Los permisos "write" solo cambian datos internos de la app (umbrales, notas, tickets...).
 */
export type Role = "admin" | "coadmin" | "manager" | "viewer" | "auditor" | "client";

export const ROLES: Role[] = ["admin", "coadmin", "manager", "viewer", "auditor", "client"];

export type Permission =
  | "internal:view"
  | "client:view"
  | "audit:view"
  | "audit:write"
  | "settings:write"
  | "alerts:write"
  | "incidents:write"
  | "budgets:write"
  | "monitoring:trigger"
  | "technical:view"
  | "users:view"
  | "tickets:write"
  | "tickets:manage"
  | "novedades:write"
  | "kickoff:write"
  | "reports:write"
  | "feedback:manage"
  | "users:manage";

export const PERMISSIONS: Permission[] = [
  "internal:view",
  "client:view",
  "audit:view",
  "audit:write",
  "settings:write",
  "alerts:write",
  "incidents:write",
  "budgets:write",
  "monitoring:trigger",
  "technical:view",
  "users:view",
  "tickets:write",
  "tickets:manage",
  "novedades:write",
  "kickoff:write",
  "reports:write",
  "feedback:manage",
  "users:manage",
];

/** Qué permite cada permiso (se muestra al asignar permisos a una persona). */
export const PERMISSION_LABEL: Record<Permission, { title: string; detail: string }> = {
  "internal:view": { title: "Monitoreo interno", detail: "Ver alertas, incidentes, notas, responsables, tickets y el resto del monitoreo del equipo." },
  "client:view": { title: "Vista del cliente", detail: "Ver el estado general que ve el cliente (sin notas, responsables ni detalle operativo)." },
  "audit:view": { title: "Auditoría de incidencias", detail: "Ver el cumplimiento del proceso: atención, seguimiento, reporte y cierre de cada incidente." },
  "audit:write": { title: "Dictaminar auditorías", detail: "Registrar el dictamen de auditoría de un incidente (cumple, observación o no cumple)." },
  "settings:write": { title: "Configuración", detail: "Settings, métricas monitoreadas y fijas, tipo de cambio, clasificadores y nivel de presupuesto." },
  "alerts:write": { title: "Alertas", detail: "Cambiar el estado de las alertas (en revisión, resuelta, falso positivo)." },
  "incidents:write": { title: "Incidentes", detail: "Asignar responsable, cambiar estado y agregar notas a incidentes." },
  "budgets:write": { title: "Presupuestos de referencia", detail: "Capturar o corregir presupuestos del mes." },
  "monitoring:trigger": { title: "Evaluación manual", detail: "Ejecutar la evaluación en el momento." },
  "technical:view": { title: "Detalle técnico", detail: "Ver consultas, errores técnicos y detalles de integración." },
  "users:view": { title: "Bitácora de accesos", detail: "Ver quién entra, cuándo y qué hace." },
  "tickets:write": { title: "Levantar tickets", detail: "Crear tickets y acusar alertas críticas." },
  "tickets:manage": { title: "Gestionar tickets", detail: "Cambiar estado, responsable y número de caso." },
  "novedades:write": { title: "Novedades", detail: "Registrar ajustes aprobados (presupuesto, pausas, activaciones) que el monitoreo toma en cuenta." },
  "kickoff:write": { title: "Arranque de mes", detail: "Capturar los presupuestos del mes y declarar qué está activo y qué está pendiente por iniciar." },
  "reports:write": { title: "Mensaje de monitoreo", detail: "Generar y guardar el mensaje de Monitoreos." },
  "feedback:manage": { title: "Bandeja de bugs y sugerencias", detail: "Ver todos los envíos, cambiar su estado y responder." },
  "users:manage": { title: "Usuarios y contraseñas", detail: "Crear cuentas, asignar contraseñas, roles, permisos y marcas." },
};

const MATRIX: Record<Role, Permission[]> = {
  admin: PERMISSIONS,
  // Todo menos la bandeja de bugs y sugerencias, la gestión de usuarios y el dictamen de auditoría
  // (lo emite el auditor o el administrador, no quien opera).
  coadmin: PERMISSIONS.filter((p) => p !== "feedback:manage" && p !== "users:manage" && p !== "audit:write"),
  // Operativo: atiende alertas, incidentes y tickets; registra novedades y ejecuta evaluaciones.
  manager: [
    "internal:view",
    "client:view",
    "alerts:write",
    "incidents:write",
    "monitoring:trigger",
    "technical:view",
    "tickets:write",
    "tickets:manage",
    "novedades:write",
    "reports:write",
  ],
  // Consulta interna: puede acusar alertas críticas, levantar tickets y generar el mensaje de monitoreo.
  viewer: ["internal:view", "client:view", "tickets:write", "reports:write"],
  // Auditor: lee todo el monitoreo y la bitácora sin poder operar; dictamina el cumplimiento del proceso.
  auditor: ["internal:view", "client:view", "audit:view", "audit:write", "users:view", "technical:view"],
  // Cliente: solo el estado general de su marca. Nunca ve notas, responsables, tickets ni configuración.
  client: ["client:view"],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  coadmin: "Co-administrador",
  manager: "Operativo",
  viewer: "Consulta interna",
  auditor: "Auditor",
  client: "Cliente",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Todo: configuración, métricas, presupuestos de referencia, usuarios y contraseñas, bitácora y la bandeja de bugs y sugerencias.",
  coadmin: "Igual que el administrador (configuración, métricas, bitácora de accesos), salvo usuarios y contraseñas y la bandeja de bugs y sugerencias.",
  manager: "Equipo operativo (Paid Media): gestiona alertas, incidentes, tickets y novedades; ejecuta evaluaciones manuales.",
  viewer: "Consulta el monitoreo, acusa alertas críticas, levanta tickets y genera el mensaje de monitoreo.",
  auditor: "Audita el proceso de incidencias: ve todo el monitoreo y la bitácora en modo lectura y dictamina si se atendió, se dio seguimiento, se reportó y se cerró como corresponde.",
  client: "Ve solo el estado general de su marca: si todo está en orden, cada plataforma y lo que se está atendiendo. Sin notas, responsables ni detalle operativo.",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/**
 * Permisos efectivos de una persona: los asignados (o los de su rol) más los implícitos. Un cliente
 * nunca recibe permisos internos aunque se le asignen por error; cualquier otro rol conserva el
 * acceso al monitoreo interno aunque sus permisos personalizados sean anteriores a ese permiso.
 */
export function effectivePermissions(role: Role, assigned: Permission[] | null): Permission[] {
  if (role === "client") return ["client:view"];
  const base = assigned ?? permissionsOf(role);
  return [...new Set<Permission>([...base, "internal:view", "client:view"])];
}

/**
 * Quién debe acusar las alertas críticas (revisé y lo voy a reportar): quien opera o consulta. El
 * auditor no: observa el proceso, y su acuse contaría como reporte del equipo en la propia auditoría.
 */
export function mustAcknowledgeCritical(role: Role): boolean {
  return role !== "client" && role !== "auditor";
}

/** El rol cliente solo usa su vista; los demás son roles internos del equipo. */
export function isInternalRole(role: Role): boolean {
  return role !== "client";
}

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as string[]).includes(v);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}
