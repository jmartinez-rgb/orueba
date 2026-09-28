import type { Metadata } from "next";
import { getAppContext } from "@/lib/services/context";
import { getCompare } from "@/lib/services/analysis";
import { businessDate, zonedParts } from "@/lib/time/tz";
import { PageHeader } from "@/components/monitoring/page-header";
import { CompareView } from "@/components/monitoring/compare-view";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { friendlyError } from "@/lib/logging/logger";
import { safeSnapshot } from "@/lib/services/safe";
import { PLATFORMS } from "@/lib/platforms/registry";
import { PLATFORM_IDS } from "@/lib/types";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ dimension?: string; platform?: string }> }) {
  const sp = await searchParams;
  const dimension = (["platform", "account", "strategy", "objective", "campaign"].includes(sp.dimension ?? "") ? sp.dimension : "platform") as "platform" | "account" | "strategy" | "objective" | "campaign";
  const platformParam = sp.platform && (PLATFORM_IDS as string[]).includes(sp.platform) ? (sp.platform as (typeof PLATFORM_IDS)[number]) : "all";
  const ctx = await getAppContext();
  const now = ctx.source.now();
  const tz = ctx.settings.timezone;
  let initial: Awaited<ReturnType<typeof getCompare>>;
  try {
    initial = await getCompare(ctx, {
      date: businessDate(now, tz),
      cutoffHour: Math.max(1, zonedParts(now, tz).hour),
      weeksBack: [1, 2, 3, 4],
      customDates: [],
      metric: "spend",
      dimension,
      platform: platformParam,
      focus: null,
    });
  } catch (err) {
    const f = friendlyError(ctx.mode === "bigquery" ? "bigquery" : "api", err);
    return <ErrorPanel message={f.message} technical={f.technical} />;
  }
  const res = await safeSnapshot();
  const delayed = res.ok
    ? [
        ...PLATFORM_IDS.filter((p) => ["DELAYED", "ERROR", "NO_DATA"].includes(res.snap.platformStatus[p].dataState)).map((p) => PLATFORMS[p].name),
        ...PLATFORM_IDS.flatMap((p) => res.snap.run.dataHealth[p].delayedAccounts.map((a) => `${a.accountName} (${PLATFORMS[p].shortName})`)),
      ]
    : [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Compare"
        subtitle="Compara cualquier fecha contra el mismo día de semanas anteriores (o una fecha personalizada) en la misma franja horaria, por plataforma, cuenta, estrategia, objetivo o campaña."
      />
      <CompareView initial={initial} attention={ctx.settings.thresholds.attention} delayed={delayed} />
    </div>
  );
}
