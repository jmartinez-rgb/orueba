import { requireAuth } from "@/lib/auth/session";
import type { NextRequest } from "next/server";
import type { MetricId, PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { getAppContext } from "@/lib/services/context";
import { ANALYSIS_METRICS, getCompare, type CompareDimension } from "@/lib/services/analysis";
import { badRequest, json, serverError, unauthorized } from "@/lib/services/http";
import { businessDate, zonedParts } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireAuth())) return unauthorized();
  try {
    const ctx = await getAppContext();
    const sp = req.nextUrl.searchParams;
    const now = ctx.source.now();
    const tz = ctx.settings.timezone;
    const date = sp.get("date") ?? businessDate(now, tz);
    const cutoff = Number(sp.get("cutoff") ?? zonedParts(now, tz).hour);
    const metric = (sp.get("metric") ?? "spend") as MetricId;
    const dimension = (sp.get("dimension") ?? "platform") as CompareDimension;
    const platform = (sp.get("platform") ?? "all") as PlatformId | "all";
    const focus = sp.get("focus");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(cutoff) || cutoff < 1 || cutoff > 24) return badRequest("Fecha u hora de corte inválida.");
    if (!ANALYSIS_METRICS.includes(metric)) return badRequest("Métrica no soportada.");
    if (platform !== "all" && !PLATFORM_IDS.includes(platform)) return badRequest("Plataforma inválida.");
    if (!["platform", "account", "strategy", "objective", "campaign"].includes(dimension)) return badRequest("Dimensión inválida.");
    if (focus && focus.length > 160) return badRequest("Selección inválida.");
    const weeksBack = (sp.get("weeks") ?? "1,2,3,4").split(",").map(Number).filter((n) => Number.isInteger(n));
    const customDates = (sp.get("custom") ?? "").split(",").filter(Boolean);
    return json({ ok: true, ...(await getCompare(ctx, { date, cutoffHour: cutoff, weeksBack, customDates, metric, dimension, platform, focus })) });
  } catch (err) {
    return serverError("bigquery", err, "compare");
  }
}
