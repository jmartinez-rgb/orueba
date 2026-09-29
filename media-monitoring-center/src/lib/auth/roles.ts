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
  | "reports:write"
  | "feedback:manage";

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
  "reports:write",
  "feedback:manage",
];

const MATRIX: Record<Role, Permission[]> = {
  admin: PERMISSIONS,
  // Todo menos la bandeja de bugs y sugerencias, que solo le llega al administrador.
  coadmin: PERMISSIONS.filter((p) => p !== "feedback:manage"),
  manager: ["alerts:write", "incidents:write", "monitoring:trigger", "technical:view", "tickets:write", "tickets:manage", "reports:write"],
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
  admin: "Todo: configuración, métricas, presupuestos de referencia, usuarios, bitácora y la bandeja de bugs y sugerencias.",
  coadmin: "Igual que el administrador (configuración, métricas, bitácora de accesos), salvo la bandeja de bugs y sugerencias.",
  manager: "Gestiona alertas, incidentes y tickets; ejecuta evaluaciones manuales.",
  viewer: "Consulta el monitoreo, acusa alertas críticas, levanta tickets y genera el mensaje de monitoreo.",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "coadmin" || v === "manager" || v === "viewer";
}
