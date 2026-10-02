import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as passwords from "@/lib/auth/password";
import { resetAuthConfig } from "@/lib/auth/config";
import { PERMISSIONS } from "@/lib/auth/roles";
import { changeOwnPassword, createAccount, deleteAccount, updateAccount, updateUniversal, type Actor } from "@/lib/auth/user-admin";
import { effectiveUniversal, findEffectiveAccount, listAccounts, resetUsersCache, saveManagedUsers, saveUniversalConfig, type ManagedUser } from "@/lib/auth/users";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";

const admin: Actor = { id: "jmartinez", name: "Administrador", permissions: PERMISSIONS };
const originalPassword = "Fixture-Inicial-2026";
const nextPassword = "Fixture-Siguiente-2026";
const finalPassword = "Fixture-Final-2026";
const hashes = new Map<string, string>();

function user(username: string, role: ManagedUser["role"] = "manager"): ManagedUser {
  const now = "2026-10-02T00:00:00Z";
  return { username, name: username, role, email: `${username}@example.test`, hash: hashes.get(originalPassword)!, permissions: null, brands: [], active: true, version: 1, createdAt: now, createdBy: "fixture", updatedAt: now, updatedBy: "fixture", passwordChangedAt: now };
}

function create(username: string, email = `${username}@example.test`) {
  return createAccount(admin, { username, email, name: `Cuenta ${username}`, role: "manager", password: originalPassword });
}

describe("escrituras concurrentes de cuentas nominales (un proceso)", () => {
  const previous = { ...process.env };
  beforeAll(async () => {
    for (const password of [originalPassword, nextPassword, finalPassword]) hashes.set(password, await passwords.hashPassword(password));
  });
  beforeEach(() => {
    process.env.RECORDS_BACKEND = "memory";
    process.env.AUTH_SECRET = "fixture-auth-secret-".repeat(3);
    process.env.AUTH_USERS = JSON.stringify([{ u: "jmartinez", n: "Administrador", r: "admin", email: "principal@example.test", h: hashes.get(originalPassword) }]);
    process.env.AUTH_PRIMARY_ADMIN_ID = "jmartinez";
    process.env.AUTH_UNIVERSAL_PASSWORD_HASH = hashes.get(originalPassword)!;
    delete process.env.ALERT_RESPONDER_USER_IDS;
    resetAuthConfig(); resetRecordStore(); resetUsersCache();
    // Fixture hashes keep each concurrent branch asynchronous and deterministic, without
    // weakening production password derivation or writing credentials to disk.
    vi.spyOn(passwords, "hashPassword").mockImplementation(async password => hashes.get(password)!);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...previous };
    resetAuthConfig(); resetRecordStore(); resetUsersCache();
  });

  it("conserva las dos altas simultáneas", async () => {
    expect((await Promise.all([create("primera"), create("segunda")])).every(result => result.ok)).toBe(true);
    expect((await listAccounts()).map(account => account.username).sort()).toEqual(["jmartinez", "primera", "segunda"]);
  });

  it("rechaza el segundo usuario simultáneo con la misma identidad", async () => {
    const results = await Promise.all([create("repetida"), create("repetida")]);
    expect(results.map(result => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ status: 409 });
    expect((await listAccounts()).filter(account => account.username === "repetida")).toHaveLength(1);
  });

  it("rechaza altas simultáneas con el mismo correo", async () => {
    const results = await Promise.all([create("primera", "comun@example.test"), create("segunda", "comun@example.test")]);
    expect(results.map(result => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ status: 409 });
  });

  it("conserva cambios independientes de la misma cuenta", async () => {
    await saveManagedUsers([user("operador")]);
    const results = await Promise.all([
      updateAccount(admin, "operador", { name: "Nombre actualizado" }),
      updateAccount(admin, "operador", { brands: ["izzi"] }),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await findEffectiveAccount("operador")).toMatchObject({ name: "Nombre actualizado", brands: ["izzi"] });
  });

  it("una actualización en cola no recrea una cuenta que acaba de borrarse", async () => {
    await saveManagedUsers([user("operador")]);
    const results = await Promise.all([deleteAccount(admin, "operador"), updateAccount(admin, "operador", { name: "Nombre actualizado" })]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, status: 404 });
    expect(await findEffectiveAccount("operador")).toBeNull();
  });

  it("cada restablecimiento de contraseña incrementa la versión de revocación", async () => {
    await saveManagedUsers([user("operador")]);
    const results = await Promise.all([
      updateAccount(admin, "operador", { password: nextPassword }),
      updateAccount(admin, "operador", { password: finalPassword }),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await findEffectiveAccount("operador")).toMatchObject({ version: 3, hash: hashes.get(finalPassword) });
  });

  it("la contraseña anterior autoriza solo uno de dos cambios propios concurrentes", async () => {
    await saveManagedUsers([user("operador")]);
    const results = await Promise.all([
      changeOwnPassword("operador", originalPassword, nextPassword),
      changeOwnPassword("operador", originalPassword, finalPassword),
    ]);
    expect(results.map(result => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ status: 403 });
    expect(await findEffectiveAccount("operador")).toMatchObject({ version: 2, hash: hashes.get(nextPassword) });
  });

  it("el administrador principal puede cambiar su propia contraseña sin perder la protección de su cuenta", async () => {
    expect(await changeOwnPassword("jmartinez", originalPassword, nextPassword)).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await findEffectiveAccount("jmartinez")).toMatchObject({ version: 1, hash: hashes.get(nextPassword), role: "admin", permissions: PERMISSIONS });
    const other = { ...admin, id: "otro-admin" };
    expect(await updateAccount(other, "jmartinez", { password: finalPassword })).toMatchObject({ ok: false, status: 403 });
    expect(await deleteAccount(other, "jmartinez")).toMatchObject({ ok: false, status: 403 });
  });

  it("el correo del principal no elude su protección nominal", async () => {
    const other = { ...admin, id: "otro-admin" };
    expect(await updateAccount(other, "principal@example.test", { password: nextPassword })).toMatchObject({ ok: false, status: 403 });
    expect(await findEffectiveAccount("jmartinez")).toMatchObject({ source: "netlify", version: 0, hash: hashes.get(originalPassword) });
  });

  it("actualizar por correo conserva una sola identidad y su protección contra cambios propios de acceso", async () => {
    await saveManagedUsers([user("operador")]);
    expect(await updateAccount(admin, "operador@example.test", { name: "Operador actualizado" })).toMatchObject({ ok: true });
    expect(await getRecordStore().get("auth/users")).toHaveLength(1);
    resetUsersCache();
    expect((await listAccounts()).filter(account => account.username === "operador")).toHaveLength(1);
    expect(await findEffectiveAccount("operador")).toMatchObject({ name: "Operador actualizado" });
    expect(await updateAccount({ ...admin, id: "operador" }, "operador@example.test", { active: false })).toMatchObject({ ok: false, status: 403 });
  });

  it("un cambio de contraseña universal concurrente no deshace su desactivación", async () => {
    await saveUniversalConfig({ enabled: true, hash: hashes.get(originalPassword)!, role: "viewer", brands: [], version: 4, updatedAt: "2026-10-02T00:00:00Z", updatedBy: "fixture" });
    const results = await Promise.all([
      updateUniversal(admin, { enabled: false }),
      updateUniversal(admin, { password: nextPassword, brands: ["sky"] }),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await effectiveUniversal()).toMatchObject({ enabled: false, version: 6, hash: hashes.get(nextPassword), brands: ["sky"] });
  });

  it("no permite desactivar al último administrador con solicitudes simultáneas cruzadas", async () => {
    delete process.env.AUTH_PRIMARY_ADMIN_ID;
    process.env.AUTH_USERS = "[]";
    resetAuthConfig();
    await saveManagedUsers([user("admin-uno", "admin"), user("admin-dos", "admin")]);
    const results = await Promise.all([
      updateAccount({ ...admin, id: "admin-uno" }, "admin-dos", { active: false }),
      updateAccount({ ...admin, id: "admin-dos" }, "admin-uno", { active: false }),
    ]);
    expect(results.map(result => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ status: 409 });
    expect((await listAccounts()).filter(account => account.active && account.permissions.includes("users:manage"))).toHaveLength(1);
  });

  it("libera la cola después de un fallo del almacén", async () => {
    vi.spyOn(getRecordStore(), "set").mockRejectedValueOnce(new Error("fixture write failed"));
    const results = await Promise.allSettled([create("fallida"), create("valida")]);
    expect(results[0]).toMatchObject({ status: "rejected" });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(await findEffectiveAccount("fallida")).toBeNull();
    expect(await findEffectiveAccount("valida")).toMatchObject({ username: "valida" });
  });
});
