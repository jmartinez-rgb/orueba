import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StateMessage } from "@/components/monitoring/states";

export default function NotFound() {
  return (
    <Card className="p-4">
      <StateMessage kind="empty" title="Página no encontrada" description="Revisa la dirección o vuelve al Overview." />
      <p className="pb-4 text-center text-sm">
        <Link href="/" className="text-primary hover:underline">
          Ir al Overview
        </Link>
      </p>
    </Card>
  );
}
