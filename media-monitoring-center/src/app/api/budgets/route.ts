import { logActivity } from "@/lib/services/activity";
import { invalidate } from "@/lib/data/cache";
import { z } from "zod";
import { requirePermission, requireAuth } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { getSnapshot } from "@/lib/services/snapshot";
import { getBudgetControl } from "@/lib/services/budget";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  try {
    const [ctx, snap] = await Promise.all([getAppContext(), getSnapshot()]);
    return json({ ok: true, ...(await getBudgetControl(ctx, snap)) });
  } catch (err) {
    return serverError("api", err, "budgets");
  }
}

const body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  level: z.enum(["total", "platform", "account", "campaign"]),
  platform: z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]).nullable(),
  accountId: z.string().max(80).nullable(),
  campaignId: z.string().max(80).nullable(),
  amount: z.number().positive().max(1e10),
});

export async function PUT(req: Request) {
  const session = await requirePermission("budgets:write");
  if (!session) return forbidden();
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest("Datos de presupuesto inválidos.");
  try {
    const ctx = await getAppContext();
    await ctx.store.setBudget(parsed.data);
    // El pacing del monitoreo usa estos presupuestos: la evaluación en vivo se recalcula.
    invalidate("live:");
    invalidate("brandstatus:");
    await logActivity(session, "BUDGET_REFERENCE", `${parsed.data.month} · ${parsed.data.level} ${parsed.data.campaignId ?? parsed.data.accountId ?? parsed.data.platform ?? "total"} = ${parsed.data.amount.toLocaleString("es-MX")} MXN`);
    return json({ ok: true });
  } catch (err) {
    return serverError("api", err, "budgets");
  }
}
