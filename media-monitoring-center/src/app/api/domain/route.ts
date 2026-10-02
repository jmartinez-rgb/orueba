import { cookies } from "next/headers";
import { requireClientView } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { DOMAIN_COOKIE, parseDomainFilter, selectDomain } from "@/lib/domains/scope";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";
/** Only a browser view preference. This cookie never changes authorized accounts or evaluation. */
export async function POST(req: Request) {
  if (!(await requireClientView())) return unauthorized();
  const body = await readJson<{ domain?: string }>(req);
  if (typeof body?.domain !== "string" || parseDomainFilter(body.domain) !== body.domain) return badRequest("Dominio inválido.");
  try {
    const ctx = await getAppContext();
    if (ctx.brand !== "izzi" && body.domain !== "all") return forbidden("La clasificación de dominios corresponde a Google Ads de izzi.");
    const selected = selectDomain(body.domain, ctx.brand, ctx.domainConfig ?? null);
    if (!selected.available) return badRequest("La configuración maestra de ese dominio no está disponible.");
    (await cookies()).set(DOMAIN_COOKIE, selected.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    return json({ ok: true, domain: selected });
  } catch (error) { return serverError("api", error, "domain"); }
}
