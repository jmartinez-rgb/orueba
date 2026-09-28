import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { campaignRows } from "@/lib/services/view-models";
import { hourLabel } from "@/lib/time/tz";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { CampaignsTable } from "@/components/monitoring/campaigns-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campaigns"
        subtitle={`Todas las campañas de las 6 plataformas · ventana 00:00–${hourLabel(snap.meta.cutoffHour)} vs mismo día de ${snap.meta.historyWeeks} semanas · el objetivo define el KPI evaluado (Sales, Leads, WhatsApp, Calls…).`}
      />
      <Card>
        <CardContent className="pt-4">
          <CampaignsTable rows={campaignRows(snap)} attention={snap.settings.thresholds.attention} weeks={snap.meta.historyWeeks} />
        </CardContent>
      </Card>
    </div>
  );
}
