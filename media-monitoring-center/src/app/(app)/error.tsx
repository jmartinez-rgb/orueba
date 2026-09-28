"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateMessage } from "@/components/monitoring/states";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="p-4">
      <StateMessage kind="error" title="Algo salió mal al mostrar esta vista." description="El resto de la plataforma sigue disponible. Puedes reintentar." technical={`${error.name}: ${error.message}${error.digest ? ` (ref ${error.digest})` : ""}`} />
      <div className="flex justify-center pb-4">
        <Button size="sm" onClick={reset}>
          Reintentar
        </Button>
      </div>
    </Card>
  );
}
