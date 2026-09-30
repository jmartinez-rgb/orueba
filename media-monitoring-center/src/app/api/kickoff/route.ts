import { z } from "zod";
import { requireAuth, requirePermission } from "@/lib/auth/session";
import { PLATFORM_IDS, type PlatformId } from "@/lib/types";
import { getAppContext } from "@/lib/services/context";
import { getSnapshot } from "@/lib/services/snapshot";
import { confirmKickoff, kickoffStatus } from "@/lib/services/kickoff";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Estado del arranque del mes (aviso obligatorio para administradores y recordatorio diario de pendientes). */
export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    const ctx = await getAppContext();
    const snap = await getSnapshot().catch(() => null);
    return json({ ok: true, brand: ctx.brand, ...(await kickoffStatus(ctx, snap)) });
  } catch (err) {
    return serverError("api", err, "kickoff");
  }
}

const platform = z.enum(PLATFORM_IDS as [PlatformId, ...PlatformId[]]);
const body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  budgets: z
    .array(z.object({ platform, accountId: z.string().max(80).nullable(), accountName: z.string().max(160).nullable(), amount: z.number().positive().max(1e10) }))
    .min(1, "Captura al menos un presupuesto del mes.")
    .max(200),
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        platform,
        accountName: z.string().max(160).nullable(),
        campaignId: z.string().max(80).nullable(),
        name: z.string().trim().min(2).max(200),
        state: z.enum(["ACTIVE", "PENDING", "ENDED"]),
        expectedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        note: z.string().max(400).nullable(),
        startedAt: z.string().nullable().default(null),
      }),
    )
    .max(2000),
});

export async function PUT(req: Request) {
  const session = await requirePermission("kickoff:write");
  if (!session) return forbidden("Solo administradores y co-administradores confirman el arranque de mes.");
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Datos del arranque inválidos.");
  try {
    const ctx = await getAppContext();
    const k = await confirmKickoff(ctx, parsed.data, session.user.name);
    await logActivity(session, "KICKOFF_CONFIRMED", `${k.month} · ${k.budgets.length} presupuestos · ${k.items.filter((i) => i.state === "PENDING").length} pendientes`);
    return json({ ok: true, kickoff: k });
  } catch (err) {
    return serverError("api", err, "kickoff");
  }
}
