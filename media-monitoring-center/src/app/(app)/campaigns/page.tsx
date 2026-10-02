import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { campaignRows } from "@/lib/services/view-models";
import { hourLabel } from "@/lib/time/tz";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { CampaignsTable } from "@/components/monitoring/campaigns-table";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { campaignQuery } from "@/lib/nexus/campaign-query";

export const metadata: Metadata = { title: "Campañas" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ search?: string | string[]; platform?: string | string[] }> }) {
  const filters = campaignQuery(await searchParams);
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campañas"
        subtitle={`Todas las campañas de las 6 plataformas · ventana 00:00–${hourLabel(snap.meta.cutoffHour)} vs mismo día de ${snap.meta.historyWeeks} semanas · el objetivo define el KPI evaluado (ventas, leads, WhatsApp, llamadas…).`}
      />
      <Card>
        <CardContent className="pt-4">
          <CampaignsTable key={`${filters.initialPlatform ?? "all"}:${filters.initialSearch}`} rows={campaignRows(snap)} attention={snap.settings.thresholds.attention} weeks={snap.meta.historyWeeks} initialSearch={filters.initialSearch} initialPlatform={filters.initialPlatform} />
        </CardContent>
      </Card>
    </div>
  );
}
