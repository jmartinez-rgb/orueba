import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StateMessage } from "@/components/monitoring/states";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md p-4">
        <StateMessage kind="empty" title="Página no encontrada" description="Revisa la dirección o vuelve al Overview." />
        <p className="pb-4 text-center text-sm">
          <Link href="/" className="text-primary hover:underline">
            Ir al Overview
          </Link>
        </p>
      </Card>
    </main>
  );
}
