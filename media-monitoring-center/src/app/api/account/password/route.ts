import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { SESSION_COOKIE, signSessionToken, type SessionClaims } from "@/lib/auth/token";
import { changeOwnPassword } from "@/lib/auth/user-admin";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/**
 * La persona cambia su propia contraseña (cuentas con usuario). Sus otras sesiones se cierran;
 * la de este navegador se renueva para que no tenga que volver a entrar.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.authenticated) return unauthorized();
  if (session.user.kind !== "named") return forbidden("Quien entra con la contraseña universal no tiene contraseña propia. Pide una cuenta al administrador.");
  const body = await readJson<{ current?: string; next?: string }>(req);
  if (typeof body?.current !== "string" || typeof body?.next !== "string") return badRequest("Escribe tu contraseña actual y la nueva.");
  try {
    const res = await changeOwnPassword(session.user.id, body.current, body.next);
    if (!res.ok) return json({ ok: false, message: res.message }, res.status);
    const cfg = getAuthConfig();
    if (cfg.secret && session.expiresAt) {
      const now = Math.floor(Date.now() / 1000);
      const exp = Math.floor(Date.parse(session.expiresAt) / 1000);
      const claims: SessionClaims = { sub: session.user.id, name: session.user.name, role: session.role, kind: "named", sid: session.sid ?? "", iat: now, exp, v: res.value.version };
      (await cookies()).set(SESSION_COOKIE, await signSessionToken(claims, cfg.secret), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(60, exp - now) });
    }
    await logActivity(session, "PASSWORD_CHANGED", "Cambió su propia contraseña.");
    return json({ ok: true });
  } catch (err) {
    return serverError("api", err, "account/password");
  }
}
