import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, isRole, permissionsOf, type Permission, type Role } from "./roles";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySessionToken, type AuthMode } from "./token";
import type { AuditUser, AuditUserKind } from "@/lib/records/audit";

export interface Session {
  authenticated: boolean;
  user: { id: string; name: string; email: string | null; kind: AuditUserKind };
  role: Role;
  mode: AuthMode;
  sid: string | null;
  expiresAt: string | null;
}

/** Rol elegido desde la interfaz en modo abierto (demo local). */
export const ROLE_COOKIE = "immc_role";

const ANON: Omit<Session, "mode" | "role"> = {
  authenticated: false,
  user: { id: "anon", name: "Sin sesión", email: null, kind: "anon" },
  sid: null,
  expiresAt: null,
};

/**
 * Sesión actual.
 * - password: cookie firmada emitida por /api/auth/login (cuenta nominal o contraseña universal).
 * - open: sin contraseña (demo local); el rol se elige desde el menú de usuario.
 * - header: identidad puesta por un proxy/SSO de confianza (x-immc-user, x-immc-role).
 * - locked: producción sin configuración de acceso → nadie entra hasta configurar AUTH_*.
 */
export async function getSession(): Promise<Session> {
  const cfg = getAuthConfig();
  if (cfg.mode === "header") {
    const h = await headers();
    const role = h.get("x-immc-role");
    const name = h.get("x-immc-user") ?? "Usuario";
    return {
      authenticated: true,
      user: { id: `sso:${(h.get("x-immc-email") ?? name).toLowerCase()}`, name, email: h.get("x-immc-email"), kind: "header" },
      role: isRole(role) ? role : "viewer",
      mode: "header",
      sid: null,
      expiresAt: null,
    };
  }
  if (cfg.mode === "open") {
    const c = await cookies();
    const role = c.get(ROLE_COOKIE)?.value;
    return {
      authenticated: true,
      user: { id: "open", name: "Acceso abierto", email: null, kind: "open" },
      role: isRole(role) ? role : cfg.openRole,
      mode: "open",
      sid: null,
      expiresAt: null,
    };
  }
  if (cfg.mode === "locked" || !cfg.secret) return { ...ANON, role: "viewer", mode: "locked" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token, cfg.secret) : null;
  if (!claims) return { ...ANON, role: "viewer", mode: "password" };
  // El rol de una cuenta nominal se relee de la configuración (si cambió, aplica de inmediato).
  const account = claims.kind === "named" ? cfg.accounts.find((a) => a.username === claims.sub) : undefined;
  if (claims.kind === "named" && !account) return { ...ANON, role: "viewer", mode: "password" };
  if (claims.kind === "universal" && !cfg.universalHash) return { ...ANON, role: "viewer", mode: "password" };
  return {
    authenticated: true,
    user: { id: claims.sub, name: account?.name ?? claims.name, email: null, kind: claims.kind },
    role: account?.role ?? cfg.universalRole,
    mode: "password",
    sid: claims.sid,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function auditUser(s: Session): AuditUser {
  return { id: s.user.id, name: s.user.name, role: s.authenticated ? s.role : null, kind: s.user.kind };
}

/** Para layouts y páginas: sin sesión válida redirige al inicio de sesión. */
export async function requireSession(nextPath?: string): Promise<Session> {
  const s = await getSession();
  if (!s.authenticated) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return s;
}

/** Para API routes: sesión autenticada con el permiso indicado (o null). */
export async function requirePermission(permission: Permission): Promise<Session | null> {
  const s = await getSession();
  return s.authenticated && can(s.role, permission) ? s : null;
}

/** Para API routes de solo lectura: cualquier sesión autenticada. */
export async function requireAuth(): Promise<Session | null> {
  const s = await getSession();
  return s.authenticated ? s : null;
}

export function sessionPermissions(s: Session): Permission[] {
  return s.authenticated ? permissionsOf(s.role) : [];
}
