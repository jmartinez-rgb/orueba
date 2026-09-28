import { Card } from "@/components/ui/card";
import { StateMessage } from "./states";

export function ErrorPanel({ message, technical }: { message: string; technical: string }) {
  return (
    <Card>
      <StateMessage kind="error" title={message} description="Reintenta en unos minutos o revisa el estado en Integrations. Si el problema persiste, comparte los detalles técnicos con el equipo de datos." technical={technical} />
    </Card>
  );
}
