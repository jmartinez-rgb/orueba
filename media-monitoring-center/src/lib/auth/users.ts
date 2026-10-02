import "server-only";
import { getRecordStore, RecordStoreError } from "@/lib/records/store";
import { BRAND_IDS, isBrand, type BrandId } from "@/lib/brands";
import { getAuthConfig, normalizeUsername, type NamedAccount } from "./config";
import { isPasswordHash } from "./password";
import { applyAlertResponderPolicy, effectivePermissions, isPermission, isRole, type Permission, type Role } from "./roles";

/**
 * Cuentas administradas desde la app (sección Usuarios → Cuentas y permisos). Se guardan en el
 * almacén de registros (Netlify Blobs en producción) con la contraseña en hash scrypt; nunca en
 * claro. Las cuentas de AUTH_USERS (Netlify) siguen funcionando como respaldo: si una cuenta
 * existe en ambos lados, manda la de la app (así el administrador puede cambiar cualquier
 * contraseña sin tocar Netlify), y si se borra de la app vuelve a la de Netlify.
 */

export interface ManagedUser {
  username: string;
  email?: string | null;
  name: string;
  role: Role;
  hash: string;
  /** Permisos propios; null = los del rol. */
  permissions: Permission[] | null;
  /** Marcas que puede ver; vacío = todas. */
  brands: BrandId[];
  active: boolean;
  /** Sube al cambiar la contraseña o desactivar la cuenta: cierra sus sesiones abiertas. */
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  passwordChangedAt: string;
}

/** Contraseña universal administrada desde la app (tiene prioridad sobre AUTH_UNIVERSAL_*). */
export interface UniversalConfig {
  enabled: boolean;
  hash: string | null;
  role: Role;
  brands: BrandId[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** Cuenta efectiva (Netlify + app) tal como la usa el inicio de sesión. */
export interface EffectiveAccount {
  username: string;
  email?: string | null;
  name: string;
  role: Role;
  hash: string;
  permissions: Permission[];
  customPermissions: boolean;
  brands: BrandId[];
  active: boolean;
  version: number;
  source: "netlify" | "app" | "netlify+app";
  managed: ManagedUser | null;
}

export interface EffectiveUniversal {
  enabled: boolean;
  hash: string | null;
  role: Role;
  brands: BrandId[];
  version: number;
  source: "netlify" | "app" | "none";
}

const USERS_KEY = "auth/users";
const UNIVERSAL_KEY = "auth/universal";
const TTL_MS = 5000;

let usersCache: { at: number; value: ManagedUser[] } | null = null;
let universalCache: { at: number; value: UniversalConfig | null } | null = null;

export const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function cleanBrands(v: unknown): BrandId[] {
  if (!Array.isArray(v)) return [];
  const list = [...new Set(v.filter(isBrand))];
  return list.length === BRAND_IDS.length ? [] : list;
}

function cleanPermissions(v: unknown): Permission[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter(isPermission))];
}

/** Missing legacy fields keep their defaults; present, invalid access fields never widen access. */
function validAccessFields(u: Partial<ManagedUser>): boolean {
  return (u.brands === undefined || (Array.isArray(u.brands) && u.brands.every(isBrand)))
    && (u.permissions == null || (Array.isArray(u.permissions) && u.permissions.every(isPermission)))
    && (u.active === undefined || typeof u.active === "boolean")
    && (u.version === undefined || (Number.isSafeInteger(u.version) && u.version >= 0))
    && (u.email == null || (typeof u.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())));
}

function sanitize(raw: unknown): ManagedUser | null {
  const u = raw as Partial<ManagedUser> | null;
  if (!u || typeof u.username !== "string" || !USERNAME_RE.test(u.username) || !isRole(u.role) || !isPasswordHash(u.hash) || !validAccessFields(u)) return null;
  return {
    username: u.username,
    email: typeof u.email === "string" ? u.email.trim().toLowerCase() : null,
    name: typeof u.name === "string" && u.name.trim() ? u.name.trim() : u.username,
    role: u.role,
    hash: u.hash!,
    permissions: cleanPermissions(u.permissions),
    brands: cleanBrands(u.brands),
    active: u.active !== false,
    version: typeof u.version === "number" ? u.version : 1,
    createdAt: u.createdAt ?? new Date(0).toISOString(),
    createdBy: u.createdBy ?? "",
    updatedAt: u.updatedAt ?? new Date(0).toISOString(),
    updatedBy: u.updatedBy ?? "",
    passwordChangedAt: u.passwordChangedAt ?? u.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function listManagedUsers(fresh = false): Promise<ManagedUser[]> {
  if (!fresh && usersCache && Date.now() - usersCache.at < TTL_MS) return usersCache.value;
  const raw = (await getRecordStore().get<unknown[]>(USERS_KEY)) ?? [];
  if (!Array.isArray(raw)) throw new RecordStoreError();
  const value = raw.map(sanitize);
  if (value.some(u => u === null)) throw new RecordStoreError();
  const valid = value as ManagedUser[];
  const emails = valid.flatMap(u => u.email ? [u.email] : []);
  if (new Set(valid.map(u => u.username)).size !== valid.length || new Set(emails).size !== emails.length) throw new RecordStoreError();
  usersCache = { at: Date.now(), value: valid };
  return valid;
}

export async function saveManagedUsers(list: ManagedUser[]): Promise<void> {
  await getRecordStore().set(USERS_KEY, list);
  usersCache = { at: Date.now(), value: list };
}

export async function getUniversalConfig(fresh = false): Promise<UniversalConfig | null> {
  if (!fresh && universalCache && Date.now() - universalCache.at < TTL_MS) return universalCache.value;
  const raw = await getRecordStore().get<Partial<UniversalConfig>>(UNIVERSAL_KEY);
  if (raw !== null && (typeof raw !== "object" || !isRole(raw.role) || (raw.hash !== null && !isPasswordHash(raw.hash))
    || !validAccessFields({ brands: raw.brands, version: raw.version }) || (raw.enabled !== undefined && typeof raw.enabled !== "boolean"))) throw new RecordStoreError();
  const value: UniversalConfig | null =
    raw && typeof raw === "object"
      ? {
          enabled: raw.enabled !== false,
          hash: isPasswordHash(raw.hash) ? raw.hash! : null,
          role: isRole(raw.role) && raw.role !== "admin" && raw.role !== "coadmin" ? raw.role : "viewer",
          brands: cleanBrands(raw.brands),
          version: typeof raw.version === "number" ? raw.version : 1,
          updatedAt: raw.updatedAt ?? "",
          updatedBy: raw.updatedBy ?? "",
        }
      : null;
  universalCache = { at: Date.now(), value };
  return value;
}

export async function saveUniversalConfig(cfg: UniversalConfig): Promise<void> {
  await getRecordStore().set(UNIVERSAL_KEY, cfg);
  universalCache = { at: Date.now(), value: cfg };
}

function effective(env: NamedAccount | undefined, app: ManagedUser | undefined): EffectiveAccount | null {
  if (app) {
    return {
      username: app.username,
      email: app.email ?? null,
      name: app.name,
      role: app.role,
      hash: app.hash,
      permissions: applyAlertResponderPolicy(effectivePermissions(app.role, app.permissions), app.username, getAuthConfig().alertResponders ?? null, getAuthConfig().primaryAdminId ?? null),
      customPermissions: app.permissions !== null,
      brands: app.brands,
      active: app.active,
      version: app.version,
      source: env ? "netlify+app" : "app",
      managed: app,
    };
  }
  if (!env) return null;
  return { username: env.username, name: env.name, role: env.role, email: env.email ?? null, hash: env.hash, permissions: applyAlertResponderPolicy(effectivePermissions(env.role, env.permissions ?? null), env.username, getAuthConfig().alertResponders ?? null, getAuthConfig().primaryAdminId ?? null), customPermissions: env.permissions != null, brands: env.brands ?? [], active: true, version: 0, source: "netlify", managed: null };
}

/** Todas las cuentas nominales (Netlify + app). Un fallo del almacén impide confirmar los permisos; nunca restaura credenciales previas. */
export async function listAccounts(): Promise<EffectiveAccount[]> {
  const env = getAuthConfig().accounts;
  const managed = await listManagedUsers();
  const names = [...new Set([...env.map((a) => a.username), ...managed.map((u) => u.username)])];
  return names
    .map((u) =>
      effective(
        env.find((a) => a.username === u),
        managed.find((m) => m.username === u),
      ),
    )
    .filter((a): a is EffectiveAccount => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function findEffectiveAccount(username: string): Promise<EffectiveAccount | null> {
  const identifier = normalizeUsername(username);
  return (await listAccounts()).find(a => a.username === identifier || a.email === identifier) ?? null;
}

/** Contraseña universal vigente: la de la app si existe, si no la de Netlify. */
export async function effectiveUniversal(): Promise<EffectiveUniversal> {
  const cfg = getAuthConfig();
  const app = await getUniversalConfig();
  if (app && (app.hash || !app.enabled)) return { enabled: app.enabled && app.hash !== null, hash: app.hash, role: app.role, brands: app.brands, version: app.version, source: "app" };
  if (cfg.universalHash) return { enabled: true, hash: cfg.universalHash, role: app?.role ?? cfg.universalRole, brands: app?.brands ?? [], version: 0, source: "netlify" };
  return { enabled: false, hash: null, role: "viewer", brands: [], version: 0, source: "none" };
}

/** Contraseña aleatoria legible, sin caracteres ambiguos: Mmc-XXXX-XXXX-XXXX. */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  // Muestreo por rechazo: todos los caracteres con la misma probabilidad; se repite hasta que
  // traiga letras y números (la regla mínima de contraseña).
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) {
      for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < limit && chars.length < 12) chars.push(alphabet[b % alphabet.length]);
    }
    const body = chars.join("");
    if (/\d/.test(body) && /[a-zA-Z]/.test(body)) return `Mmc-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
  }
}

/** Reglas mínimas de contraseña. Devuelve el problema o null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (password.length > 128) return "La contraseña es demasiado larga (máximo 128).";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "Usa letras y números.";
  return null;
}

/** Solo para pruebas. */
export function resetUsersCache() {
  usersCache = null;
  universalCache = null;
}
