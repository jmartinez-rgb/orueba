import { cookies } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { isRole } from "@/lib/auth/roles";
import { ROLE_COOKIE } from "@/lib/auth/session";
import { badRequest, forbidden, json, readJson } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Solo en AUTH_MODE=dev: permite probar la app con cada rol. */
export async function POST(req: Request) {
  if (getEnv().auth.mode !== "dev") return forbidden("El cambio de rol solo existe en modo desarrollo.");
  const body = await readJson<{ role?: string }>(req);
  if (!isRole(body?.role)) return badRequest("Rol inválido.");
  const c = await cookies();
  c.set(ROLE_COOKIE, body.role, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return json({ ok: true, role: body.role });
}
