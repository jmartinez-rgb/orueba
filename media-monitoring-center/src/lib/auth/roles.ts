/**
 * Roles y permisos. La arquitectura está lista para Admin, Paid Media Manager y Viewer;
 * el proveedor de identidad (Netlify Identity, Google OAuth, SSO) se conecta en session.ts.
 */
export type Role = "admin" | "manager" | "viewer";

export type Permission = "settings:write" | "alerts:write" | "incidents:write" | "budgets:write" | "monitoring:trigger" | "technical:view";

const MATRIX: Record<Role, Permission[]> = {
  admin: ["settings:write", "alerts:write", "incidents:write", "budgets:write", "monitoring:trigger", "technical:view"],
  manager: ["alerts:write", "incidents:write", "budgets:write", "monitoring:trigger", "technical:view"],
  viewer: [],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Paid Media Manager",
  viewer: "Viewer",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "manager" || v === "viewer";
}
