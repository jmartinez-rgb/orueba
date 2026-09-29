import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isRole, permissionsOf, type Permission, type Role } from "./roles";
import { getAuthConfig } from "./config";
import { effectiveUniversal, findEffectiveAccount } from "./users";
import type { BrandId } from "@/lib/brands";
import { SESSION_COOKIE, verifySessionToken, type AuthMode } from "./token";
import type { AuditUser, AuditUserKind } from "@/lib/records/audit";

export interface Session {
  authenticated: boolean;
  user: { id: string; name: string; email: string | null; kind: AuditUserKind };
  role: Role;
  /** Permisos efectivos (los del rol o los asignados a la persona). */
  permissions: Permission[];
  /** Marcas que puede ver; vacío = todas. */
  brands: BrandId[];
  mode: AuthMode;
  sid: string | null;
  expiresAt: string | null;
}

/** Rol elegido desde la interfaz en modo abierto (demo local). */
export const ROLE_COOKIE = "immc_role";

const ANON: Omit<Session, "mode" | "role"> = {
  authenticated: false,
  user: { id: "anon", name: "Sin sesión", email: null, kind: "anon" },
  permissions: [],
  brands: [],
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
      permissions: permissionsOf(isRole(role) ? role : "viewer"),
      brands: [],
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
      permissions: permissionsOf(isRole(role) ? role : cfg.openRole),
      brands: [],
      mode: "open",
      sid: null,
      expiresAt: null,
    };
  }
  if (cfg.mode === "locked" || !cfg.secret) return { ...ANON, role: "viewer", mode: "locked" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token, cfg.secret) : null;
  if (!claims) return { ...ANON, role: "viewer", mode: "password" };
  // Rol, permisos y marcas se releen en cada request (un cambio aplica de inmediato). Si la cuenta
  // se desactivó o cambió de contraseña (versión distinta), la sesión deja de valer.
  const denied = { ...ANON, role: "viewer" as Role, mode: "password" as const };
  const base = { authenticated: true, mode: "password" as const, sid: claims.sid, expiresAt: new Date(claims.exp * 1000).toISOString() };
  if (claims.kind === "named") {
    const account = await findEffectiveAccount(claims.sub);
    if (!account || !account.active || account.version !== (claims.v ?? 0)) return denied;
    return { ...base, user: { id: claims.sub, name: account.name, email: null, kind: "named" }, role: account.role, permissions: account.permissions, brands: account.brands };
  }
  const universal = await effectiveUniversal();
  if (!universal.enabled || universal.version !== (claims.v ?? 0)) return denied;
  return { ...base, user: { id: claims.sub, name: claims.name, email: null, kind: "universal" }, role: universal.role, permissions: permissionsOf(universal.role), brands: universal.brands };
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

/** ¿La sesión tiene el permiso? (rol o permisos asignados a la persona). */
export function hasPermission(s: Pick<Session, "authenticated" | "permissions">, permission: Permission): boolean {
  return s.authenticated && s.permissions.includes(permission);
}

/** Para API routes: sesión autenticada con el permiso indicado (o null). */
export async function requirePermission(permission: Permission): Promise<Session | null> {
  const s = await getSession();
  return hasPermission(s, permission) ? s : null;
}

/** Para API routes de solo lectura: cualquier sesión autenticada. */
export async function requireAuth(): Promise<Session | null> {
  const s = await getSession();
  return s.authenticated ? s : null;
}

export function sessionPermissions(s: Session): Permission[] {
  return s.authenticated ? [...s.permissions] : [];
}
