import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";

/** Todas las páginas del monitoreo exigen sesión (el proxy ya redirige; esto es defensa en profundidad). */
export default async function MonitoringLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
