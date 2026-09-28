import "server-only";
import { cookies, headers } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { can, isRole, type Permission, type Role } from "./roles";

export interface Session {
  user: { name: string; email: string | null };
  role: Role;
  mode: "dev" | "header";
}

export const ROLE_COOKIE = "immc_role";

/**
 * Sesión actual.
 * - AUTH_MODE=dev (por defecto): rol elegido desde la interfaz (cookie), útil mientras no hay SSO.
 * - AUTH_MODE=header: el rol llega en cabeceras puestas por un proxy/identidad de confianza
 *   (x-immc-user, x-immc-role). Punto de conexión para Netlify Identity / Google OAuth.
 */
export async function getSession(): Promise<Session> {
  const env = getEnv();
  if (env.auth.mode === "header") {
    const h = await headers();
    const role = h.get("x-immc-role");
    return {
      user: { name: h.get("x-immc-user") ?? "Usuario", email: h.get("x-immc-email") },
      role: isRole(role) ? role : "viewer",
      mode: "header",
    };
  }
  const c = await cookies();
  const role = c.get(ROLE_COOKIE)?.value;
  return {
    user: { name: "Modo desarrollo", email: null },
    role: isRole(role) ? role : env.auth.defaultRole,
    mode: "dev",
  };
}

export async function requirePermission(permission: Permission): Promise<Session | null> {
  const s = await getSession();
  return can(s.role, permission) ? s : null;
}
