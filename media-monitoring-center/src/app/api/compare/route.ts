import type { NextRequest } from "next/server";
import type { MetricId, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { getAppContext } from "@/lib/services/context";
import { ANALYSIS_METRICS, getCompare } from "@/lib/services/analysis";
import { badRequest, json, serverError } from "@/lib/services/http";
import { businessDate, zonedParts } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAppContext();
    const sp = req.nextUrl.searchParams;
    const now = ctx.source.now();
    const tz = ctx.settings.timezone;
    const date = sp.get("date") ?? businessDate(now, tz);
    const cutoff = Number(sp.get("cutoff") ?? zonedParts(now, tz).hour);
    const metric = (sp.get("metric") ?? "spend") as MetricId;
    const scope = (sp.get("scope") ?? "total") as PlatformId | "total";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(cutoff) || cutoff < 1 || cutoff > 24) return badRequest("Fecha u hora de corte inválida.");
    if (!ANALYSIS_METRICS.includes(metric)) return badRequest("Métrica no soportada.");
    if (scope !== "total" && !PLATFORM_IDS.includes(scope)) return badRequest("Plataforma inválida.");
    const weeksBack = (sp.get("weeks") ?? "1,2,3,4").split(",").map(Number).filter((n) => Number.isInteger(n));
    const customDates = (sp.get("custom") ?? "").split(",").filter(Boolean);
    return json({ ok: true, ...(await getCompare(ctx, { date, cutoffHour: cutoff, weeksBack, customDates, metric, scope })) });
  } catch (err) {
    return serverError("bigquery", err, "compare");
  }
}
