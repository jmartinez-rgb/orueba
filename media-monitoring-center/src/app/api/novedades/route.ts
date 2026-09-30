import { z } from "zod";
import { requireAuth, requirePermission } from "@/lib/auth/session";
import { APPROVAL_CHANNELS, createNovedad, listNovedades, NOVEDAD_KINDS, type ApprovalChannel, type NovedadKind } from "@/lib/records/novedades";
import { PLATFORM_IDS, type PlatformId } from "@/lib/types";
import { logActivity } from "@/lib/services/activity";
import { resolveBrand } from "@/lib/services/brand";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorized();
  try {
    return json({ ok: true, novedades: await listNovedades(await resolveBrand(session)) });
  } catch (err) {
    return serverError("api", err, "novedades");
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const id = z.string().trim().max(80).nullable().default(null);

const body = z
  .object({
    kind: z.enum(NOVEDAD_KINDS as [NovedadKind, ...NovedadKind[]]),
    title: z.string().trim().min(5, "El título necesita al menos 5 caracteres.").max(160),
    detail: z.string().trim().max(4000).default(""),
    platform: z.enum(PLATFORM_IDS as [PlatformId, ...PlatformId[]]).nullable(),
    accountId: id,
    accountName: id,
    campaignId: id,
    campaignName: z.string().trim().max(200).nullable().default(null),
    approvedBy: z.string().trim().min(2, "Indica quién aprobó el ajuste.").max(120),
    approvalChannel: z.enum(APPROVAL_CHANNELS as [ApprovalChannel, ...ApprovalChannel[]]),
    approvalRef: z.string().trim().max(160).nullable().default(null),
    effectiveFrom: date,
    effectiveUntil: date.nullable().default(null),
    budget: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number().positive().max(1e10) }).nullable().default(null),
    expectedChange: z.number().min(-1).max(10).nullable().default(null),
    includesFullStop: z.boolean().default(false),
    silenceAlerts: z.boolean().default(true),
    incidentId: z.string().regex(/^(?:[A-Z]+-)?INC-\d+$/).nullable().default(null),
    alertFingerprint: z.string().max(200).nullable().default(null),
  })
  .refine((b) => !b.effectiveUntil || b.effectiveUntil >= b.effectiveFrom, "La fecha final no puede ser anterior al inicio.")
  .refine((b) => b.kind !== "PRESUPUESTO" || b.budget !== null, "Indica el nuevo presupuesto mensual.")
  .refine((b) => !b.silenceAlerts || b.platform !== null, "Para que el monitoreo lo tome en cuenta, elige la plataforma.");

export async function POST(req: Request) {
  const session = await requirePermission("novedades:write");
  if (!session) return forbidden("Tu rol no puede registrar novedades.");
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Datos de la novedad inválidos.");
  try {
    const n = await createNovedad(parsed.data, session.user.name, await resolveBrand(session));
    await logActivity(session, "NOVEDAD_CREATED", `${n.id} · ${n.title} (aprobó ${n.approvedBy})`);
    return json({ ok: true, novedad: n });
  } catch (err) {
    return serverError("api", err, "novedades");
  }
}
