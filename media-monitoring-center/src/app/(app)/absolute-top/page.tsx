import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isInternalRole } from "@/lib/auth/roles";
import { resolveBrand } from "@/lib/services/brand";
import { getViewContext } from "@/lib/services/context";
import { getAbsoluteTopDashboard } from "@/lib/absolute-top/service";
import type { AbsoluteTopDashboard } from "@/lib/absolute-top/types";
import { normalizeGoogleCustomerId } from "@/lib/domains/config";
import { AbsoluteTopDashboardView } from "@/components/absolute-top/dashboard";
import { PageHeader } from "@/components/monitoring/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Absolute Top" };
export const dynamic = "force-dynamic";

/** Reading an already persisted audit does not extract Google reports or emit alerts. */
export default async function AbsoluteTopPage() {
  const session = await requirePermission("internal:view");
  if (!session) redirect("/login?next=%2Fabsolute-top");
  if (!isInternalRole(session.role)) redirect("/cliente");
  const brand = await resolveBrand(session);
  if (brand !== "izzi") return <div className="flex flex-col gap-4"><PageHeader title="Absolute Top" subtitle="Monitoreo de presencia absoluta superior de Google Ads." /><Card><CardContent className="pt-5"><p className="text-sm font-semibold">Disponible para el monitoreo de izzi</p><p className="mt-2 text-sm text-muted-foreground">Selecciona izzi en la barra superior si tienes acceso a esa marca. Esta vista no consulta ni muestra cuentas de otra marca.</p></CardContent></Card></div>;
  let snapshot: AbsoluteTopDashboard | null = null;
  let switched = false;
  try {
    const context = await getViewContext();
    // Another browser tab may have changed the shared brand cookie while this page loaded.
    switched = context.brand !== "izzi";
    if (!switched) {
      const catalog = await context.source.getCatalog();
      const allowedCustomerIds = catalog.accounts.filter((account) => account.platform === "google" && account.brand !== "sky").map((account) => normalizeGoogleCustomerId(account.id)).filter((id): id is string => id !== null);
      snapshot = await getAbsoluteTopDashboard({ brand: "izzi", domainId: context.domain?.id ?? "all", config: context.domainConfig ?? null, allowedCustomerIds });
    }
  } catch {
    // Deliberately keep raw storage/provider errors out of the page.
  }
  if (switched) return <Card><CardContent className="pt-5"><p className="text-sm">La marca seleccionada cambió. Vuelve a abrir Absolute Top desde izzi.</p></CardContent></Card>;
  if (!snapshot) return <div className="flex flex-col gap-4"><PageHeader title="Absolute Top Monitoring" /><Card><CardContent className="pt-5"><p role="alert" className="text-sm font-semibold">No se pudo leer la auditoría de Absolute Top.</p><p className="mt-2 text-sm text-muted-foreground">No se interpreta como cumplimiento. Reintenta la lectura o revisa el almacenamiento y la configuración de la API unificada.</p></CardContent></Card></div>;
  return <div className="flex flex-col gap-4"><PageHeader title="Absolute Top Monitoring" subtitle="Dominio → Cuenta → Campaña → Grupo de anuncios. Cada nivel se evalúa de forma independiente con % Abs. Top of Page." /><AbsoluteTopDashboardView key={snapshot.selectedDomain} initial={snapshot} /></div>;
}
