import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth/session";
import { BRAND_COOKIE, BRAND_IDS, isBrand } from "@/lib/brands";
import { badRequest, forbidden, json, readJson, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Cambia la marca del monitoreo (izzi / Sky) para este navegador. */
export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return unauthorized();
  const body = await readJson<{ brand?: string }>(req);
  if (!isBrand(body?.brand)) return badRequest("Marca inválida.");
  const allowed = session.brands.length ? session.brands : BRAND_IDS;
  if (!allowed.includes(body.brand)) return forbidden("Tu cuenta no tiene acceso a esa marca.");
  (await cookies()).set(BRAND_COOKIE, body.brand, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
  return json({ ok: true, brand: body.brand });
}
