/**
 * Roles y permisos. La app es SOLO DE MONITOREO: ningún permiso modifica campañas,
 * presupuestos ni configuraciones en Google, Meta, TikTok, Microsoft, Spotify o X.
 * Los permisos "write" solo cambian datos internos de la app (umbrales, notas, tickets...).
 */
export type Role = "admin" | "coadmin" | "manager" | "viewer";

export const ROLES: Role[] = ["admin", "coadmin", "manager", "viewer"];

export type Permission =
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
  // Todo menos la bandeja de bugs y sugerencias y la gestión de usuarios (solo del administrador).
  coadmin: PERMISSIONS.filter((p) => p !== "feedback:manage" && p !== "users:manage"),
  manager: ["alerts:write", "incidents:write", "monitoring:trigger", "technical:view", "tickets:write", "tickets:manage", "novedades:write", "reports:write"],
  // Consulta: puede acusar alertas críticas, levantar tickets y generar el mensaje de monitoreo.
  viewer: ["tickets:write", "reports:write"],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  coadmin: "Co-administrador",
  manager: "Paid Media Manager",
  viewer: "Consulta",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Todo: configuración, métricas, presupuestos de referencia, usuarios y contraseñas, bitácora y la bandeja de bugs y sugerencias.",
  coadmin: "Igual que el administrador (configuración, métricas, bitácora de accesos), salvo usuarios y contraseñas y la bandeja de bugs y sugerencias.",
  manager: "Gestiona alertas, incidentes y tickets; ejecuta evaluaciones manuales.",
  viewer: "Consulta el monitoreo, acusa alertas críticas, levanta tickets y genera el mensaje de monitoreo.",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as string[]).includes(v);
}

export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "coadmin" || v === "manager" || v === "viewer";
}
