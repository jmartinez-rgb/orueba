import { cookies, headers } from "next/headers";
import { getAuthConfig, findAccount, normalizeUsername } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password";
import { isLocked, loginKey, registerFailure, registerSuccess } from "@/lib/auth/rate-limit";
import { randomId, SESSION_COOKIE, signSessionToken, type SessionClaims } from "@/lib/auth/token";
import { recordAudit, requestInfo, touchUser } from "@/lib/records/audit";
import { badRequest, json, readJson } from "@/lib/services/http";
import { logger } from "@/lib/logging/logger";

export const dynamic = "force-dynamic";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nombre visible de quien entra con la contraseña universal. */
function cleanDisplayName(v: string): string | null {
  const name = v.normalize("NFC").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 60) return null;
  if (!/[a-záéíóúüñ]/i.test(name)) return null;
  return name;
}

function guestId(name: string) {
  return `invitado:${name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export async function POST(req: Request) {
  const cfg = getAuthConfig();
  if (cfg.mode !== "password" || !cfg.secret) {
    return json({ ok: false, message: cfg.mode === "locked" ? "El acceso aún no está configurado. Pide al administrador que configure AUTH_* en Netlify." : "Este entorno no usa contraseña." }, 400);
  }
  const body = await readJson<{ username?: string; password?: string }>(req);
  const rawUser = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!rawUser.trim() || !password) return badRequest("Escribe tu usuario (o tu nombre) y la contraseña.");
  if (password.length > 200 || rawUser.length > 80) return badRequest("Datos inválidos.");

  const info = requestInfo(await headers());
  const username = normalizeUsername(rawUser);
  const key = loginKey(info.ip, username);
  const lock = isLocked(key);
  if (lock.locked) {
    await recordAudit({ type: "LOGIN_BLOCKED", user: { id: username, name: rawUser.trim(), role: null, kind: "anon" }, detail: `Bloqueado ${lock.retryInMin} min por intentos fallidos.`, ...info, sid: null }).catch(() => {});
    return json({ ok: false, message: `Demasiados intentos. Intenta de nuevo en ${lock.retryInMin} min.` }, 429);
  }

  const account = findAccount(username);
  let claimsBase: Omit<SessionClaims, "sid" | "iat" | "exp"> | null = null;
  if (account) {
    // Una cuenta nominal solo entra con su propia contraseña (la universal no sirve para suplantarla).
    if (await verifyPassword(password, account.hash)) claimsBase = { sub: account.username, name: account.name, role: account.role, kind: "named" };
  } else if (cfg.universalHash) {
    const name = cleanDisplayName(rawUser);
    if (!name) return badRequest("Con la contraseña universal escribe tu nombre y apellido (mínimo 3 letras).");
    const reserved = cfg.accounts.some((a) => normalizeUsername(a.name) === normalizeUsername(name));
    if (!reserved && (await verifyPassword(password, cfg.universalHash))) claimsBase = { sub: guestId(name), name, role: cfg.universalRole, kind: "universal" };
  }

  if (!claimsBase) {
    const r = registerFailure(key);
    await recordAudit({ type: "LOGIN_FAILED", user: { id: account ? account.username : username, name: rawUser.trim().slice(0, 60), role: null, kind: "anon" }, detail: account ? "Contraseña incorrecta para la cuenta." : "Usuario o contraseña incorrectos.", ...info, sid: null }).catch((err) =>
      logger.warn("audit.write_failed", { error: err }),
    );
    await pause(450);
    return json({ ok: false, message: r.locked ? "Demasiados intentos. Acceso bloqueado 10 minutos." : "Usuario o contraseña incorrectos." }, 401);
  }

  registerSuccess(key);
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { ...claimsBase, sid: randomId(9), iat: now, exp: now + cfg.sessionHours * 3600 };
  const token = await signSessionToken(claims, cfg.secret);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: cfg.sessionHours * 3600 });
  const user = { id: claims.sub, name: claims.name, role: claims.role, kind: claims.kind };
  await Promise.all([
    recordAudit({ type: "LOGIN_OK", user, detail: claims.kind === "universal" ? "Contraseña universal" : "Cuenta nominal", ...info, sid: claims.sid }),
    touchUser(user, { login: true, agent: info.agent }),
  ]).catch((err) => logger.warn("audit.write_failed", { error: err }));
  logger.info("auth.login", { user: claims.sub, kind: claims.kind, role: claims.role });
  return json({ ok: true, user: { name: claims.name, role: claims.role, kind: claims.kind } });
}
