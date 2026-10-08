import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isInternalRole } from "@/lib/auth/roles";
import { resolveBrand } from "@/lib/services/brand";
import { getViewContext } from "@/lib/services/context";
import { getAbsoluteTopDashboard } from "@/lib/absolute-top/service";
import { normalizeGoogleCustomerId } from "@/lib/domains/config";
import { badRequest, forbidden, json, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Stored read only. No extraction, alert creation, platform mutation or external delivery. */
export async function GET(request: NextRequest) {
  const session = await requirePermission("internal:view");
  if (!session) return unauthorized();
  if (!isInternalRole(session.role)) return forbidden("Absolute Top requiere acceso al monitoreo interno.");
  if (session.brands.length && !session.brands.includes("izzi")) return forbidden("No tienes acceso al monitoreo de izzi.");
  if (await resolveBrand(session) !== "izzi") return forbidden("Selecciona izzi para consultar Absolute Top.");
  const params = request.nextUrl.searchParams;
  if (params.has("brand") && params.get("brand") !== "izzi") return badRequest("Absolute Top solo está configurado para izzi.");
  if (params.getAll("domain").length > 1) return badRequest("Selecciona un único dominio.");
  try {
    const context = await getViewContext(undefined, "domain");
    if (context.brand !== "izzi") return json({ ok: false, message: "La marca seleccionada cambió. Actualiza la página antes de consultar Absolute Top." }, 409);
    const domainId = params.get("domain") ?? context.domain?.id ?? "all";
    if (params.has("domain") && domainId !== "all" && domainId !== "unclassified" && !context.domainConfig?.domains.some((domain) => domain.id === domainId)) return badRequest("El dominio no existe en la configuración maestra disponible.");
    const catalog = await context.source.getCatalog();
    const allowedCustomerIds = catalog.accounts.filter((account) => account.platform === "google" && account.brand !== "sky").map((account) => normalizeGoogleCustomerId(account.id)).filter((id): id is string => id !== null);
    const snapshot = await getAbsoluteTopDashboard({ brand: "izzi", domainId, config: context.domainConfig ?? null, allowedCustomerIds });
    return json({ ok: true, module: "ABSOLUTE_TOP_MONITORING", ...snapshot });
  } catch {
    return json({ ok: false, message: "No se pudo leer la auditoría de Absolute Top. Revisa el almacenamiento y la configuración." }, 503);
  }
}
