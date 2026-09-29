import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/services/safe";
import { getAppContext } from "@/lib/services/context";
import { buildReportData } from "@/lib/services/report";
import { listReports } from "@/lib/records/reports";
import { friendlyError } from "@/lib/logging/logger";
import { PageHeader } from "@/components/monitoring/page-header";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { ReportBuilder } from "@/components/reports/report-builder";
import { hourLabel } from "@/lib/time/tz";

export const metadata: Metadata = { title: "Monitoreos" };
export const dynamic = "force-dynamic";

export default async function MonitoreosPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const ctx = await getAppContext();
  let data: Awaited<ReturnType<typeof buildReportData>>;
  try {
    data = await buildReportData(ctx, snap);
  } catch (err) {
    const f = friendlyError(ctx.mode === "mock" ? "api" : ctx.mode, err);
    return <ErrorPanel message={f.message} technical={f.technical} />;
  }
  const history = (await listReports(30, ctx.brand).catch(() => [])).map((r) => ({ id: r.id, at: r.at, by: r.by, text: r.text, summary: r.summary, cutoffHour: r.cutoffHour }));
  const perms = snap.meta.permissions;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Monitoreos"
        subtitle={`Mensaje de monitoreo para el grupo de WhatsApp, armado con los datos de hoy 00:00–${hourLabel(data.cutoffHour)} contra ayer y contra el ${data.lastWeekDay} pasado en la misma franja. Se copia y se envía manualmente.`}
      />
      <ReportBuilder data={data} history={history} canSave={perms.includes("reports:write")} canConfigure={perms.includes("settings:write")} timezone={snap.meta.timezone} />
    </div>
  );
}
