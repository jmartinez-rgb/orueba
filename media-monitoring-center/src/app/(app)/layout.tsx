import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { hasPermission, requireSession } from "@/lib/auth/session";
import { isInternalRole } from "@/lib/auth/roles";

/**
 * Todas las páginas del monitoreo exigen sesión (el proxy ya redirige; esto es defensa en profundidad).
 * El rol cliente no entra al monitoreo interno: siempre va a su vista (/cliente).
 */
export default async function MonitoringLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  if (!isInternalRole(session.role) || !hasPermission(session, "internal:view")) redirect("/cliente");
  return <AppShell session={session}>{children}</AppShell>;
}
