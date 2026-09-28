import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/auth/config";
import { isRole } from "@/lib/auth/roles";
import { ROLE_COOKIE } from "@/lib/auth/session";
import { badRequest, forbidden, json, readJson } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Solo en acceso abierto (demo local): permite probar la app con cada rol. */
export async function POST(req: Request) {
  if (getAuthConfig().mode !== "open") return forbidden("El cambio de rol solo existe en acceso abierto (demo).");
  const body = await readJson<{ role?: string }>(req);
  if (!isRole(body?.role)) return badRequest("Rol inválido.");
  const c = await cookies();
  c.set(ROLE_COOKIE, body.role, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return json({ ok: true, role: body.role });
}
