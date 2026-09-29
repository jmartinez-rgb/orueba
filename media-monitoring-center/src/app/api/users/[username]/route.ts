import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/auth/config";
import { requirePermission } from "@/lib/auth/session";
import { SESSION_COOKIE, signSessionToken } from "@/lib/auth/token";
import { findEffectiveAccount } from "@/lib/auth/users";
import { deleteAccount, updateAccount } from "@/lib/auth/user-admin";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const DENIED = "Solo quien administra usuarios puede cambiar cuentas y contraseñas.";

export async function PATCH(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const session = await requirePermission("users:manage");
  if (!session) return forbidden(DENIED);
  const { username } = await ctx.params;
  if (!username || username.length > 40) return badRequest("Usuario inválido.");
  try {
    const res = await updateAccount({ id: session.user.id, name: session.user.name, permissions: session.permissions }, decodeURIComponent(username), await readJson(req));
    if (!res.ok) return json({ ok: false, message: res.message }, res.status);
    const { account, passwordChanged, changes } = res.value;
    // Si la persona cambió su propia contraseña desde la tabla, se renueva su sesión en este navegador.
    const cfg = getAuthConfig();
    if (passwordChanged && account.username === session.user.id && session.user.kind === "named" && cfg.secret && session.expiresAt) {
      const fresh = await findEffectiveAccount(account.username);
      const now = Math.floor(Date.now() / 1000);
      const exp = Math.floor(Date.parse(session.expiresAt) / 1000);
      const token = await signSessionToken({ sub: account.username, name: account.name, role: account.role, kind: "named", sid: session.sid ?? "", iat: now, exp, v: fresh?.version ?? 0 }, cfg.secret);
      (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(60, exp - now) });
    }
    if (changes.length) await logActivity(session, passwordChanged && changes.length === 1 ? "PASSWORD_CHANGED" : "USER_UPDATED", `${account.username}: ${changes.join(", ")}`);
    return json({ ok: true, account });
  } catch (err) {
    return serverError("api", err, "users/[username]");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ username: string }> }) {
  const session = await requirePermission("users:manage");
  if (!session) return forbidden(DENIED);
  const { username } = await ctx.params;
  try {
    const res = await deleteAccount({ id: session.user.id, name: session.user.name, permissions: session.permissions }, decodeURIComponent(username));
    if (!res.ok) return json({ ok: false, message: res.message }, res.status);
    await logActivity(session, "USER_DELETED", `${decodeURIComponent(username)}${res.value.revertedTo ? " (vuelve a la cuenta de Netlify)" : ""}`);
    return json({ ok: true, revertedTo: res.value.revertedTo });
  } catch (err) {
    return serverError("api", err, "users/[username]");
  }
}
