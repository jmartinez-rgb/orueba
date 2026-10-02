import "server-only";
import { z } from "zod";
import { BRAND_IDS, type BrandId } from "@/lib/brands";
import { getAuthConfig, normalizeUsername } from "./config";
import { hashPassword, verifyPassword } from "./password";
import { PERMISSIONS, permissionsOf, ROLES, type Permission, type Role } from "./roles";
import { withUserAdminWrite } from "./user-admin-lock";
import {
  effectiveUniversal,
  findEffectiveAccount,
  getUniversalConfig,
  listAccounts,
  listManagedUsers,
  passwordProblem,
  saveManagedUsers,
  saveUniversalConfig,
  USERNAME_RE,
  type EffectiveAccount,
  type ManagedUser,
} from "./users";

/**
 * Reglas para administrar cuentas desde la app (solo quien tiene "users:manage"):
 * - Nadie puede dar permisos que no tiene.
 * - Nadie puede quitarse a sí mismo la gestión de usuarios, desactivarse ni borrarse.
 * - Siempre queda al menos una cuenta activa con gestión de usuarios.
 * - Cambiar la contraseña o desactivar una cuenta cierra sus sesiones abiertas.
 */

export interface Actor {
  id: string;
  name: string;
  permissions: Permission[];
}

export type AdminResult<T = undefined> = { ok: true; value: T } | { ok: false; status: number; message: string };

const fail = (message: string, status = 400): AdminResult<never> => ({ ok: false, status, message });

const roleEnum = z.enum(ROLES as [Role, ...Role[]]);
const permissionList = z.array(z.enum(PERMISSIONS as [Permission, ...Permission[]])).max(PERMISSIONS.length);
const brandList = z.array(z.enum(BRAND_IDS as [BrandId, ...BrandId[]])).max(BRAND_IDS.length);
const email = z.email().max(254).transform(value => value.trim().toLowerCase()).nullable();
const displayName = z
  .string()
  .transform((v) => v.normalize("NFC").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(3, "El nombre debe tener al menos 3 caracteres.").max(60));

export const createSchema = z.object({
  username: z.string().transform((v) => normalizeUsername(v)),
  name: displayName,
  email: email.optional(),
  role: roleEnum,
  permissions: permissionList.nullable().default(null),
  brands: brandList.default([]),
  password: z.string(),
});

export const updateSchema = z.object({
  name: displayName.optional(),
  email: email.optional(),
  role: roleEnum.optional(),
  permissions: permissionList.nullable().optional(),
  brands: brandList.optional(),
  active: z.boolean().optional(),
  password: z.string().optional(),
});

export const universalSchema = z.object({
  enabled: z.boolean().optional(),
  role: z.enum(["viewer", "manager"]).optional(),
  brands: brandList.optional(),
  password: z.string().optional(),
});

/** Vista pública de una cuenta (nunca incluye el hash). */
export interface AccountView {
  username: string;
  email?: string | null;
  name: string;
  role: Role;
  permissions: Permission[];
  customPermissions: boolean;
  brands: BrandId[];
  active: boolean;
  source: EffectiveAccount["source"];
  passwordChangedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function toView(a: EffectiveAccount): AccountView {
  return {
    username: a.username,
    email: a.email ?? null,
    name: a.name,
    role: a.role,
    permissions: a.permissions,
    customPermissions: a.customPermissions,
    brands: a.brands,
    active: a.active,
    source: a.source,
    passwordChangedAt: a.managed?.passwordChangedAt ?? null,
    updatedAt: a.managed?.updatedAt ?? null,
    updatedBy: a.managed?.updatedBy ?? null,
  };
}

const normBrands = (b: BrandId[]) => (new Set(b).size === BRAND_IDS.length ? [] : [...new Set(b)]);

function grantProblem(actor: Actor, role: Role, permissions: Permission[] | null): string | null {
  const wanted = permissions ?? permissionsOf(role);
  return wanted.some((p) => !actor.permissions.includes(p)) ? "No puedes dar permisos que tú no tienes." : null;
}

function managersLeft(list: EffectiveAccount[]): number {
  return list.filter((a) => a.active && a.permissions.includes("users:manage")).length;
}

function withAccountWrite<T>(write: () => Promise<T>): Promise<T> {
  return withUserAdminWrite(async () => {
    // Refresh after waiting for earlier mutations, before checking identities,
    // permissions, current password or the last active administrator.
    await listManagedUsers(true);
    return write();
  });
}

export function createAccount(actor: Actor, input: unknown): Promise<AdminResult<{ account: AccountView }>> {
  return withAccountWrite(() => createAccountUnlocked(actor, input));
}

async function createAccountUnlocked(actor: Actor, input: unknown): Promise<AdminResult<{ account: AccountView }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const d = parsed.data;
  if (!USERNAME_RE.test(d.username)) return fail("Usuario inválido: de 3 a 40 caracteres, solo letras minúsculas, números, punto, guion o guion bajo.");
  const problem = passwordProblem(d.password);
  if (problem) return fail(problem);
  if (grantProblem(actor, d.role, d.permissions)) return fail("No puedes dar permisos que tú no tienes.", 403);
  const all = await listAccounts();
  if (all.some((a) => a.username === d.username)) return fail("Ya existe una cuenta con ese usuario.", 409);
  if (d.email && all.some(a => a.email === d.email)) return fail("Ya existe una cuenta con ese correo.", 409);
  const now = new Date().toISOString();
  const user: ManagedUser = {
    username: d.username,
    email: d.email ?? null,
    name: d.name,
    role: d.role,
    hash: await hashPassword(d.password),
    permissions: d.permissions ? [...new Set(d.permissions)] : null,
    brands: normBrands(d.brands),
    active: true,
    version: 1,
    createdAt: now,
    createdBy: actor.name,
    updatedAt: now,
    updatedBy: actor.name,
    passwordChangedAt: now,
  };
  await saveManagedUsers([...(await listManagedUsers(true)), user]);
  const created = await findEffectiveAccount(user.username);
  return { ok: true, value: { account: toView(created!) } };
}

export function updateAccount(actor: Actor, username: string, input: unknown): Promise<AdminResult<{ account: AccountView; passwordChanged: boolean; changes: string[] }>> {
  return withAccountWrite(() => updateAccountUnlocked(actor, username, input));
}

async function updateAccountUnlocked(actor: Actor, username: string, input: unknown): Promise<AdminResult<{ account: AccountView; passwordChanged: boolean; changes: string[] }>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const d = parsed.data;
  const current = await findEffectiveAccount(normalizeUsername(username));
  if (!current) return fail("No existe la cuenta.", 404);
  // Login identifiers may be emails; protection and persistence use the canonical ID.
  const u = current.username;
  if (getAuthConfig().primaryAdminId === u && actor.id !== u) return fail("Solo el administrador principal puede modificar su propia cuenta.", 403);
  const self = actor.id === u;
  const touchesAccess = d.role !== undefined || d.permissions !== undefined || d.active !== undefined;
  if (self && touchesAccess) return fail("No puedes cambiar tu propio rol, permisos o estado. Pídeselo a otro administrador.", 403);
  if (d.password !== undefined) {
    const problem = passwordProblem(d.password);
    if (problem) return fail(problem);
  }
  const role = d.role ?? current.role;
  const permissions = d.permissions !== undefined ? d.permissions : current.managed ? current.managed.permissions : null;
  if ((d.role !== undefined || d.permissions !== undefined) && grantProblem(actor, role, permissions)) return fail("No puedes dar permisos que tú no tienes.", 403);

  const now = new Date().toISOString();
  const base: ManagedUser = current.managed ?? {
    username: current.username,
    email: current.email ?? null,
    name: current.name,
    role: current.role,
    hash: current.hash,
    permissions: current.customPermissions ? current.permissions : null,
    brands: current.brands,
    active: true,
    // Una cuenta de Netlify que pasa a la app conserva sus sesiones (versión 0).
    version: 0,
    createdAt: now,
    createdBy: actor.name,
    updatedAt: now,
    updatedBy: actor.name,
    passwordChangedAt: now,
  };
  const next: ManagedUser = { ...base, updatedAt: now, updatedBy: actor.name };
  const changes: string[] = [];
  if (d.email !== undefined && d.email !== (base.email ?? null)) {
    if (d.email && (await listAccounts()).some(a => a.username !== u && a.email === d.email)) return fail("Ya existe una cuenta con ese correo.", 409);
    next.email = d.email; changes.push("correo");
  }
  if (d.name !== undefined && d.name !== base.name) {
    next.name = d.name;
    changes.push("nombre");
  }
  if (d.role !== undefined && d.role !== base.role) {
    next.role = d.role;
    changes.push(`rol → ${d.role}`);
  }
  if (d.permissions !== undefined) {
    next.permissions = d.permissions ? [...new Set(d.permissions)] : null;
    changes.push(d.permissions ? `permisos personalizados (${d.permissions.length})` : "permisos del rol");
  }
  if (d.brands !== undefined) {
    next.brands = normBrands(d.brands);
    changes.push(next.brands.length ? `marcas: ${next.brands.join(", ")}` : "marcas: todas");
  }
  let revoke = false;
  if (d.active !== undefined && d.active !== base.active) {
    next.active = d.active;
    changes.push(d.active ? "activada" : "desactivada");
    if (!d.active) revoke = true;
  }
  const passwordChanged = d.password !== undefined;
  if (passwordChanged) {
    next.hash = await hashPassword(d.password!);
    next.passwordChangedAt = now;
    changes.push("contraseña");
    revoke = true;
  }
  if (revoke) next.version = base.version + 1;

  // Siempre debe quedar alguien que pueda administrar usuarios.
  const after = (await listAccounts()).map((a) => (a.username === u ? { ...a, active: next.active, permissions: next.permissions ?? permissionsOf(next.role) } : a));
  if (managersLeft(after) === 0) return fail("Debe quedar al menos una cuenta activa que pueda administrar usuarios.", 409);

  const list = await listManagedUsers(true);
  await saveManagedUsers([...list.filter((m) => m.username !== u), next]);
  const updated = await findEffectiveAccount(u);
  return { ok: true, value: { account: toView(updated!), passwordChanged, changes } };
}

/** Borra la cuenta de la app. Si también existe en Netlify, vuelve a la de Netlify. */
export function deleteAccount(actor: Actor, username: string): Promise<AdminResult<{ revertedTo: "netlify" | null }>> {
  return withAccountWrite(() => deleteAccountUnlocked(actor, username));
}

async function deleteAccountUnlocked(actor: Actor, username: string): Promise<AdminResult<{ revertedTo: "netlify" | null }>> {
  const u = normalizeUsername(username);
  if (getAuthConfig().primaryAdminId === u) return fail("No se puede eliminar al administrador principal.", 403);
  if (actor.id === u) return fail("No puedes eliminar tu propia cuenta.", 403);
  const list = await listManagedUsers(true);
  if (!list.some((m) => m.username === u)) {
    return getAuthConfig().accounts.some((a) => a.username === u) ? fail("Esta cuenta está configurada en Netlify (AUTH_USERS): desactívala aquí o quítala en Netlify.", 409) : fail("No existe la cuenta.", 404);
  }
  const inEnv = getAuthConfig().accounts.some((a) => a.username === u);
  const after = (await listAccounts()).filter((a) => a.username !== u || inEnv).map((a) => (a.username === u ? { ...a, permissions: permissionsOf(getAuthConfig().accounts.find((x) => x.username === u)!.role), active: true } : a));
  if (managersLeft(after) === 0) return fail("Debe quedar al menos una cuenta activa que pueda administrar usuarios.", 409);
  await saveManagedUsers(list.filter((m) => m.username !== u));
  return { ok: true, value: { revertedTo: inEnv ? "netlify" : null } };
}

export function updateUniversal(actor: Actor, input: unknown): Promise<AdminResult<{ enabled: boolean; changes: string[] }>> {
  return withUserAdminWrite(() => updateUniversalUnlocked(actor, input));
}

async function updateUniversalUnlocked(actor: Actor, input: unknown): Promise<AdminResult<{ enabled: boolean; changes: string[] }>> {
  const parsed = universalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const d = parsed.data;
  if (d.password !== undefined) {
    const problem = passwordProblem(d.password);
    if (problem) return fail(problem);
  }
  const cur = await getUniversalConfig(true);
  const eff = await effectiveUniversal();
  const now = new Date().toISOString();
  const next = {
    enabled: d.enabled ?? cur?.enabled ?? true,
    hash: cur?.hash ?? null,
    role: d.role ?? cur?.role ?? eff.role,
    brands: d.brands !== undefined ? normBrands(d.brands) : (cur?.brands ?? []),
    version: cur?.version ?? eff.version,
    updatedAt: now,
    updatedBy: actor.name,
  };
  const changes: string[] = [];

  if (d.enabled !== undefined && d.enabled !== (cur?.enabled ?? eff.enabled)) changes.push(d.enabled ? "activada" : "desactivada");
  if (d.role !== undefined) changes.push(`rol → ${d.role}`);
  if (d.brands !== undefined) changes.push(next.brands.length ? `marcas: ${next.brands.join(", ")}` : "marcas: todas");
  if (d.password !== undefined) {
    next.hash = await hashPassword(d.password);
    changes.push("contraseña");
  }
  // Una contraseña nueva o desactivarla cierra las sesiones abiertas con la anterior.
  if (d.password !== undefined || d.enabled === false) next.version += 1;
  if (next.enabled && !next.hash && !getAuthConfig().universalHash) return fail("Escribe o genera una contraseña universal para activarla.");
  await saveUniversalConfig(next);
  return { ok: true, value: { enabled: next.enabled, changes } };
}

/** La persona cambia su propia contraseña (cuentas nominales). */
export function changeOwnPassword(username: string, current: string, next: string): Promise<AdminResult<{ version: number }>> {
  return withAccountWrite(() => changeOwnPasswordUnlocked(username, current, next));
}

async function changeOwnPasswordUnlocked(username: string, current: string, next: string): Promise<AdminResult<{ version: number }>> {
  const account = await findEffectiveAccount(username);
  if (!account || !account.active) return fail("Solo las cuentas con usuario pueden cambiar su contraseña.", 403);
  if (!(await verifyPassword(current, account.hash))) return fail("La contraseña actual no es correcta.", 403);
  const problem = passwordProblem(next);
  if (problem) return fail(problem);
  if (current === next) return fail("La contraseña nueva debe ser distinta de la actual.");
  // Keep verification and mutation inside the same queue, without acquiring it twice.
  // The real identity also preserves the principal administrator's self-service access.
  const res = await updateAccountUnlocked({ id: account.username, name: account.name, permissions: account.permissions }, account.username, { password: next });
  if (!res.ok) return res;
  const updated = await findEffectiveAccount(account.username);
  return { ok: true, value: { version: updated!.version } };
}
