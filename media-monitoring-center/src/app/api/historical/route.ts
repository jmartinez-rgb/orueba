import { requireAuth } from "@/lib/auth/session";
import type { NextRequest } from "next/server";
import type { MetricId } from "@/lib/types";
import { getViewContext } from "@/lib/services/context";
import { ANALYSIS_METRICS, getHistorical } from "@/lib/services/analysis";
import { badRequest, json, serverError, unauthorized } from "@/lib/services/http";
import { businessDate, zonedParts } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireAuth())) return unauthorized();
  try {
    const ctx = await getViewContext();
    const sp = req.nextUrl.searchParams;
    const weeks = Number(sp.get("weeks") ?? ctx.settings.history.weeks);
    const metric = (sp.get("metric") ?? "spend") as MetricId;
    if (![4, 8, 12].includes(weeks) && !(Number.isInteger(weeks) && weeks >= 1 && weeks <= 12)) return badRequest("Periodo inválido.");
    if (!ANALYSIS_METRICS.includes(metric)) return badRequest("Métrica no soportada.");
    const now = ctx.source.now();
    const tz = ctx.settings.timezone;
    const cutoff = Math.max(1, zonedParts(now, tz).hour);
    return json({ ok: true, ...(await getHistorical(ctx, { today: businessDate(now, tz), weeks, metric, cutoffHour: cutoff })) });
  } catch (err) {
    return serverError("bigquery", err, "historical");
  }
}
