import "server-only";
import { cookies } from "next/headers";
import type { Session } from "@/lib/auth/session";
import { BRAND_COOKIE, BRAND_IDS, parseBrand, type BrandId } from "@/lib/brands";

/** Marca vigente de la persona (cookie del botón izzi | Sky, limitada a las marcas que puede ver). */
export async function resolveBrand(session: Pick<Session, "brands">): Promise<BrandId> {
  const allowed = session.brands.length ? session.brands : BRAND_IDS;
  const wanted = parseBrand((await cookies()).get(BRAND_COOKIE)?.value);
  return allowed.includes(wanted) ? wanted : allowed[0];
}
