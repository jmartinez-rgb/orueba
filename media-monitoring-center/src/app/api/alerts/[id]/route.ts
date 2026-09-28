import { logActivity } from "@/lib/services/activity";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { invalidate } from "@/lib/data/cache";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";
import { ALERT_STATUSES } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

const body = z.object({ status: z.enum(ALERT_STATUSES as [string, ...string[]]) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("alerts:write");
  if (!session) return forbidden();
  const { id } = await ctx.params;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success || !/^ALT-[A-Z0-9]+$/.test(id)) return badRequest("Estado o id de alerta inválido.");
  try {
    const app = await getAppContext();
    await app.store.setAlertStatus(id, parsed.data.status as never, session.user.name);
    await logActivity(session, "ALERT_STATUS", `${id} → ${parsed.data.status}`);
    invalidate("state:");
    return json({ ok: true, id, status: parsed.data.status });
  } catch (err) {
    return serverError("api", err, "alerts/[id]");
  }
}

