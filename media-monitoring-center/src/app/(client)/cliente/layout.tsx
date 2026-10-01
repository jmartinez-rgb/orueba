import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Activity } from "lucide-react";
import { hasPermission, requireSession } from "@/lib/auth/session";
import { isInternalRole } from "@/lib/auth/roles";
import { BRAND_COOKIE, BRAND_IDS, BRANDS, parseBrand, type BrandId } from "@/lib/brands";
import { getBrandStatus } from "@/lib/services/snapshot";
import { BrandSwitch, type BrandStatus } from "@/components/layout/brand-switch";
import { ClientUserMenu } from "@/components/client/client-user-menu";

/** Vista del cliente: sin menú lateral ni secciones internas, solo el estado general de su marca. */
export default async function ClientLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession("/cliente");
  if (!hasPermission(session, "client:view")) redirect("/");
  const allowed: BrandId[] = session.brands.length ? session.brands : BRAND_IDS;
  const wanted = parseBrand((await cookies()).get(BRAND_COOKIE)?.value);
  const brand = allowed.includes(wanted) ? wanted : allowed[0]!;
  const statuses: BrandStatus[] =
    allowed.length > 1 ? (await Promise.all(allowed.map((b) => getBrandStatus(b).catch(() => null)))).filter((x): x is BrandStatus => x !== null) : [];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-(--hairline) bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden>
            <Activity className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{BRANDS[brand].name}</p>
            <p className="truncate text-[11px] text-muted-foreground">Estado de tus campañas</p>
          </div>
          {statuses.length > 1 && <BrandSwitch current={brand} statuses={statuses} />}
          <ClientUserMenu role={session.role} userName={session.user.name} userKind={session.user.kind} internal={isInternalRole(session.role)} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-12 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-[11px] text-muted-foreground sm:px-6">
        Información de monitoreo en solo lectura. El equipo revisa tus campañas de forma continua.
      </footer>
    </div>
  );
}
