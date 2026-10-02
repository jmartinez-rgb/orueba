import "server-only";
import { z } from "zod";
import { isPasswordHash } from "./password";
import { isRole, PERMISSIONS, type Permission, type Role } from "./roles";
import { MIN_SECRET_LENGTH, resolveAuthMode, type AuthMode } from "./token";
import { logger } from "@/lib/logging/logger";
import { BRAND_IDS, type BrandId } from "@/lib/brands";

/**
 * Configuración de acceso leída de variables de entorno (nunca del repositorio):
 * - AUTH_SECRET: firma de las sesiones (≥ 32 caracteres aleatorios).
 * - AUTH_USERS: JSON con las cuentas nominales y el hash de su contraseña.
 * - AUTH_UNIVERSAL_PASSWORD_HASH: hash de la contraseña universal (cada persona entra con su nombre).
 */

export interface NamedAccount {
  username: string;
  name: string;
  role: Role;
  hash: string;
  brands?: BrandId[];
  email?: string | null;
  permissions?: Permission[] | null;
}

export interface AuthConfig {
  mode: AuthMode;
  secret: string | null;
  accounts: NamedAccount[];
  universalHash: string | null;
  universalRole: Role;
  sessionHours: number;
  /** Rol inicial en modo abierto (demo local). */
  openRole: Role;
  /** Problemas de configuración que se muestran a administradores (sin revelar valores). */
  issues: string[];
  /** null conserva roles existentes; [] significa que nadie responde alertas. */
  alertResponders?: string[] | null;
  primaryAdminId?: string | null;
}

const accountSchema = z
  .object({
    username: z.string().optional(),
    u: z.string().optional(),
    name: z.string().optional(),
    n: z.string().optional(),
    role: z.string().optional(),
    r: z.string().optional(),
    hash: z.string().optional(),
    h: z.string().optional(),
    permissions: z.array(z.enum(PERMISSIONS as [Permission, ...Permission[]])).max(PERMISSIONS.length).nullable().optional(),
    email: z.email().max(254).nullable().optional(),
    brands: z.array(z.enum(BRAND_IDS as [BrandId, ...BrandId[]])).max(2).default([]),
  })
  .transform((a) => ({ username: (a.username ?? a.u ?? "").trim().toLowerCase(), name: (a.name ?? a.n ?? "").trim(), role: (a.role ?? a.r ?? "viewer").trim().toLowerCase(), hash: (a.hash ?? a.h ?? "").trim(), brands: [...new Set(a.brands)], email: a.email?.toLowerCase() ?? null, permissions: a.permissions ?? null }));

export function normalizeUsername(v: string): string {
  return v.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

let cached: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cached) return cached;
  const env = process.env;
  const issues: string[] = [];
  const primaryAdminId = (env.AUTH_PRIMARY_ADMIN_ID ?? "").trim().toLowerCase() || null;
  if (primaryAdminId && !/^[a-z0-9._-]{3,40}$/.test(primaryAdminId)) issues.push("AUTH_PRIMARY_ADMIN_ID tiene el formato inválido.");
  const responderSetting = env.ALERT_RESPONDER_USER_IDS;
  let alertResponders: string[] | null = responderSetting === undefined ? null : responderSetting.split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
  if (alertResponders?.some(id => !/^[a-z0-9._-]{3,40}$/.test(id))) { issues.push("ALERT_RESPONDER_USER_IDS tiene el formato inválido."); alertResponders = []; }
  const secret = (env.AUTH_SECRET ?? "").trim();
  if (secret && secret.length < MIN_SECRET_LENGTH) issues.push(`AUTH_SECRET es muy corto (mínimo ${MIN_SECRET_LENGTH} caracteres).`);

  const accounts: NamedAccount[] = [];
  const rawUsers = (env.AUTH_USERS ?? "").trim();
  if (rawUsers) {
    try {
      const parsed = z.array(accountSchema).safeParse(JSON.parse(rawUsers));
      if (!parsed.success) issues.push("AUTH_USERS no tiene el formato esperado (arreglo JSON).");
      else {
        for (const a of parsed.data) {
          if (!a.username || !/^[a-z0-9._-]{3,40}$/.test(a.username)) {
            issues.push(`Usuario inválido en AUTH_USERS: "${a.username || "(vacío)"}".`);
            continue;
          }
          if (!isPasswordHash(a.hash)) {
            issues.push(`El usuario ${a.username} no tiene un hash scrypt válido.`);
            continue;
          }
          if (!isRole(a.role)) {
            issues.push(`Rol inválido para ${a.username}: ${a.role}.`);
            continue;
          }
          if (a.email && accounts.some(existing => existing.email === a.email)) { issues.push("AUTH_USERS contiene correos duplicados."); continue; }
          if (accounts.some(existing => existing.username === a.username)) { issues.push("AUTH_USERS contiene usuarios duplicados."); continue; }
          accounts.push({ username: a.username, name: a.name || a.username, role: a.role, hash: a.hash, brands: a.brands, email: a.email, permissions: a.permissions });
        }
      }
    } catch {
      issues.push("AUTH_USERS no es JSON válido.");
    }
  }
  const universal = (env.AUTH_UNIVERSAL_PASSWORD_HASH ?? "").trim();
  if (universal && !isPasswordHash(universal)) issues.push("AUTH_UNIVERSAL_PASSWORD_HASH no es un hash scrypt válido.");
  const universalRole = (env.AUTH_UNIVERSAL_ROLE ?? "viewer").trim().toLowerCase();
  const openRole = (env.AUTH_DEFAULT_ROLE ?? "admin").trim().toLowerCase();
  const hours = Number.parseInt(env.AUTH_SESSION_HOURS ?? "", 10);

  let mode = resolveAuthMode(env);
  const usable = secret.length >= MIN_SECRET_LENGTH && (accounts.length > 0 || isPasswordHash(universal));
  // An intended password setup with invalid credentials must never become an open demo.
  if (mode === "password" && !usable) mode = "locked";
  if (issues.length) logger.warn("auth.config_issues", { issues });

  cached = {
    mode,
    secret: secret.length >= MIN_SECRET_LENGTH ? secret : null,
    accounts,
    universalHash: isPasswordHash(universal) ? universal : null,
    universalRole: isRole(universalRole) && universalRole !== "admin" && universalRole !== "coadmin" ? universalRole : "viewer",
    sessionHours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 14 ? hours : 12,
    openRole: isRole(openRole) ? openRole : "admin",
    issues,
    alertResponders,
    primaryAdminId,
  };
  return cached;
}

export function findAccount(username: string): NamedAccount | undefined {
  const u = normalizeUsername(username);
  return getAuthConfig().accounts.find((a) => a.username === u);
}

/** Solo para pruebas. */
export function resetAuthConfig() {
  cached = null;
}
