import { Card } from "@/components/ui/card";
import { StateMessage } from "./states";
import { requirePermission } from "@/lib/auth/session";
import { sanitizeDiagnostic } from "@/lib/logging/logger";

export async function ErrorPanel({ message, technical }: { message: string; technical: string }) {
  const permitted = await requirePermission("technical:view").catch(() => null);
  return (
    <Card>
      <StateMessage kind="error" title={message} description="Reintenta en unos minutos o revisa el estado en Integrations. Si el problema persiste, avisa al equipo de datos." technical={permitted ? sanitizeDiagnostic(technical) : undefined} />
    </Card>
  );
}
